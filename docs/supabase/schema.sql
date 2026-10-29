-- BauPad: Arbeitsbereiche, Profile, Mitgliedschaften, Betreiber.
-- Einmal im Supabase SQL Editor ausführen (Projekt BauPad → SQL Editor → New query → einfügen → Run).
-- Das Skript ist wiederholbar: bestehende Tabellen und Daten bleiben erhalten.

-- 1) Tabellen -----------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'buero', 'polier', 'arbeiter')),
  tools text[] not null default '{projects,workers,reports,photos}',
  pkg text not null default 'einzel' check (pkg in ('einzel', 'team', 'firma')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Betreiber (PAD Software): E-Mail-Adressen, die die Betreiber-Übersicht sehen dürfen
create table if not exists public.operators (
  email text primary key
);
insert into public.operators (email) values ('danielepascu.a@gmail.com') on conflict do nothing;

-- 2) Zugriffsregeln (Row Level Security) ----------------------------------------
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.operators enable row level security;

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where workspace_id = ws and user_id = auth.uid() and active);
$$;

create or replace function public.is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where workspace_id = ws and user_id = auth.uid() and active and role = 'admin');
$$;

drop policy if exists "Eigenes Profil lesen" on public.profiles;
create policy "Eigenes Profil lesen" on public.profiles for select using (id = auth.uid());
drop policy if exists "Eigenes Profil ändern" on public.profiles;
create policy "Eigenes Profil ändern" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Mitglieder sehen Arbeitsbereich" on public.workspaces;
create policy "Mitglieder sehen Arbeitsbereich" on public.workspaces for select using (public.is_member(id));
drop policy if exists "Admin ändert Arbeitsbereich" on public.workspaces;
create policy "Admin ändert Arbeitsbereich" on public.workspaces for update using (public.is_admin(id)) with check (public.is_admin(id));

drop policy if exists "Mitgliedschaften lesen" on public.memberships;
create policy "Mitgliedschaften lesen" on public.memberships for select using (user_id = auth.uid() or public.is_admin(workspace_id));
drop policy if exists "Admin verwaltet Mitgliedschaften" on public.memberships;
create policy "Admin verwaltet Mitgliedschaften" on public.memberships for all using (public.is_admin(workspace_id)) with check (public.is_admin(workspace_id));
-- operators: keine Policy → nur über die Funktion my_context lesbar

-- 3) Bei jeder Registrierung: Profil, Arbeitsbereich und Admin-Mitgliedschaft anlegen ------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws_id uuid;
  nm text;
  co text;
begin
  nm := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  co := coalesce(nullif(trim(new.raw_user_meta_data ->> 'company'), ''), nm);
  insert into public.profiles (id, email, name) values (new.id, coalesce(new.email, ''), nm) on conflict (id) do nothing;
  if not exists (select 1 from public.memberships where user_id = new.id) then
    insert into public.workspaces (name, created_by) values (co, new.id) returning id into ws_id;
    insert into public.memberships (workspace_id, user_id, role) values (ws_id, new.id, 'admin');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 4) Kontext der angemeldeten Person (liest die App nach jeder Anmeldung) -------------------------
create or replace function public.my_context() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'workspace_id', m.workspace_id,
    'workspace_name', w.name,
    'role', m.role,
    'name', p.name,
    'operator', exists (select 1 from public.operators o where lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  )
  from public.profiles p
  left join public.memberships m on m.user_id = p.id and m.active
  left join public.workspaces w on w.id = m.workspace_id
  where p.id = auth.uid()
  order by m.created_at
  limit 1;
$$;
revoke all on function public.my_context() from public;
grant execute on function public.my_context() to authenticated;

-- 5) Eigenes Konto löschen (Vorgabe der Stores) --------------------------------------------------
create or replace function public.delete_own_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  -- Arbeitsbereiche löschen, in denen die Person das einzige Mitglied ist
  delete from public.workspaces w
  where w.id in (select workspace_id from public.memberships where user_id = uid)
    and not exists (select 1 from public.memberships m2 where m2.workspace_id = w.id and m2.user_id <> uid);
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
