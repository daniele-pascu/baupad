-- Zentrale Ablage (Hetzner Object Storage) – Verzeichnis der Fotos je Arbeitsbereich.
-- Die Bilddaten liegen bei Hetzner unter ws/<workspace_id>/photos/<id>/…; hier stehen nur die Angaben
-- (Projekt, Datum, Beschreibung …), damit alle Geräte einer Firma dieselbe Liste sehen.
-- Im Supabase SQL Editor einmal ausführen (kann jederzeit erneut laufen).

create table if not exists public.photos (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  data jsonb not null,
  size bigint not null default 0,
  has_original boolean not null default false,
  uploaded boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid default auth.uid()
);
create index if not exists photos_ws_updated on public.photos (workspace_id, updated_at);

alter table public.photos enable row level security;

drop policy if exists "Mitglieder lesen Fotos" on public.photos;
create policy "Mitglieder lesen Fotos" on public.photos for select using (public.is_member(workspace_id));
drop policy if exists "Mitglieder schreiben Fotos" on public.photos;
create policy "Mitglieder schreiben Fotos" on public.photos for insert with check (public.is_member(workspace_id));
drop policy if exists "Mitglieder ändern Fotos" on public.photos;
create policy "Mitglieder ändern Fotos" on public.photos for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- updated_at immer vom Server setzen (Abgleich „alles seit …“ bleibt verlässlich)
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists photos_touch on public.photos;
create trigger photos_touch before insert or update on public.photos for each row execute function public.touch_updated_at();

-- Speicherverbrauch je Arbeitsbereich (Anzeige unter Konto)
create or replace function public.my_storage_usage() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'photos', count(*) filter (where p.deleted_at is null),
    'bytes', coalesce(sum(p.size) filter (where p.deleted_at is null), 0)
  )
  from public.photos p
  where p.workspace_id = (select m.workspace_id from public.memberships m where m.user_id = auth.uid() and m.active order by m.created_at limit 1);
$$;
revoke all on function public.my_storage_usage() from public;
grant execute on function public.my_storage_usage() to authenticated;
