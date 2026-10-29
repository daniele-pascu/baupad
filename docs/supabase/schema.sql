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
alter table public.profiles add column if not exists phone text not null default '';
-- Zugriff je Benutzer: Baustellen-Schlüssel (p:<Projekt> bzw. n:<Name>); leer = alle Baustellen
alter table public.memberships add column if not exists sites text[] not null default '{}';
alter table public.invitations add column if not exists sites text[] not null default '{}';

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

-- Einladungen: vom Admin eingetragene Personen, die sich noch nicht registriert haben
create table if not exists public.invitations (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'polier' check (role in ('admin', 'buero', 'polier', 'arbeiter')),
  tools text[] not null default '{photos,reports}',
  pkg text not null default 'team' check (pkg in ('einzel', 'team', 'firma')),
  active boolean not null default true,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);

-- 2) Zugriffsregeln (Row Level Security) ----------------------------------------
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.operators enable row level security;
alter table public.invitations enable row level security;

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
drop policy if exists "Admin verwaltet Einladungen" on public.invitations;
create policy "Admin verwaltet Einladungen" on public.invitations for all using (public.is_admin(workspace_id)) with check (public.is_admin(workspace_id));

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
  -- Eingeladen? Dann Mitglied im einladenden Arbeitsbereich, kein eigener
  insert into public.memberships (workspace_id, user_id, role, tools, pkg, active, sites)
    select i.workspace_id, new.id, i.role, i.tools, i.pkg, i.active, i.sites
    from public.invitations i where lower(i.email) = lower(coalesce(new.email, ''))
  on conflict do nothing;
  delete from public.invitations where lower(email) = lower(coalesce(new.email, ''));
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
    'pkg', m.pkg,
    'tools', m.tools,
    'sites', m.sites,
    'name', p.name,
    'phone', p.phone,
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

-- 6) Benutzerverwaltung des Admins ------------------------------------------------------------------
-- Offene Einladungen für die angemeldete Person übernehmen (wenn sie schon ein Konto hatte)
create or replace function public.accept_invitations() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if uid is null or em = '' then return; end if;
  insert into public.memberships (workspace_id, user_id, role, tools, pkg, active, sites)
    select i.workspace_id, uid, i.role, i.tools, i.pkg, i.active, i.sites from public.invitations i where lower(i.email) = em
  on conflict do nothing;
  delete from public.invitations where lower(email) = em;
end;
$$;
revoke all on function public.accept_invitations() from public;
grant execute on function public.accept_invitations() to authenticated;

-- Arbeitsbereich, in dem die angemeldete Person Admin ist (der erste, falls mehrere)
create or replace function public.my_admin_workspace() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.memberships where user_id = auth.uid() and active and role = 'admin' order by created_at limit 1;
$$;

-- Liste: Mitglieder und Einladungen des eigenen Arbeitsbereichs
create or replace function public.list_workspace_users() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.name, x.email), '[]'::json)
  from (
    select p.id::text as id, p.email, p.name, m.role, m.tools, m.pkg, m.active, m.sites, 'member' as status,
           (m.user_id = auth.uid()) as me, extract(epoch from m.created_at) * 1000 as created_at
    from public.memberships m join public.profiles p on p.id = m.user_id
    where m.workspace_id = public.my_admin_workspace()
    union all
    select 'inv:' || i.email, i.email, i.name, i.role, i.tools, i.pkg, i.active, i.sites, 'invited', false, extract(epoch from i.created_at) * 1000
    from public.invitations i where i.workspace_id = public.my_admin_workspace()
  ) x;
$$;
revoke all on function public.list_workspace_users() from public;
grant execute on function public.list_workspace_users() to authenticated;

-- Benutzer anlegen oder ändern: vorhandenes Konto → Mitgliedschaft, sonst Einladung
drop function if exists public.upsert_workspace_user(text, text, text, text[], text, boolean);
create or replace function public.upsert_workspace_user(p_email text, p_name text, p_role text, p_tools text[], p_pkg text, p_active boolean, p_sites text[] default '{}') returns json
language plpgsql security definer set search_path = public as $$
declare
  ws uuid := public.my_admin_workspace();
  em text := lower(trim(p_email));
  target uuid;
begin
  if ws is null then raise exception 'Nur ein Admin kann Benutzer verwalten.'; end if;
  if em = '' or position('@' in em) = 0 then raise exception 'Bitte eine gültige E-Mail-Adresse eingeben.'; end if;
  if p_role not in ('admin', 'buero', 'polier', 'arbeiter') then raise exception 'Unbekannte Funktion.'; end if;
  select id into target from public.profiles where lower(email) = em;
  if target is not null then
    if target = auth.uid() and (p_role <> 'admin' or not p_active) then
      raise exception 'Du kannst dir selbst die Admin-Rechte nicht nehmen.';
    end if;
    insert into public.memberships (workspace_id, user_id, role, tools, pkg, active, sites)
      values (ws, target, p_role, p_tools, p_pkg, p_active, coalesce(p_sites, '{}'))
    on conflict (workspace_id, user_id) do update set role = excluded.role, tools = excluded.tools, pkg = excluded.pkg, active = excluded.active, sites = excluded.sites;
    if p_name <> '' then update public.profiles set name = p_name where id = target and name = ''; end if;
    return json_build_object('status', 'member', 'id', target::text);
  end if;
  insert into public.invitations (workspace_id, email, name, role, tools, pkg, active, invited_by, sites)
    values (ws, em, p_name, p_role, p_tools, p_pkg, p_active, auth.uid(), coalesce(p_sites, '{}'))
  on conflict (workspace_id, email) do update set name = excluded.name, role = excluded.role, tools = excluded.tools, pkg = excluded.pkg, active = excluded.active, sites = excluded.sites;
  return json_build_object('status', 'invited', 'id', 'inv:' || em);
end;
$$;
revoke all on function public.upsert_workspace_user(text, text, text, text[], text, boolean, text[]) from public;
grant execute on function public.upsert_workspace_user(text, text, text, text[], text, boolean, text[]) to authenticated;

-- Benutzer entfernen (Mitgliedschaft oder Einladung), nie sich selbst
create or replace function public.remove_workspace_user(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  ws uuid := public.my_admin_workspace();
  em text := lower(trim(p_email));
begin
  if ws is null then raise exception 'Nur ein Admin kann Benutzer verwalten.'; end if;
  if em = lower(coalesce(auth.jwt() ->> 'email', '')) then raise exception 'Du kannst dich nicht selbst entfernen.'; end if;
  delete from public.memberships m using public.profiles p where m.workspace_id = ws and m.user_id = p.id and lower(p.email) = em;
  delete from public.invitations where workspace_id = ws and lower(email) = em;
end;
$$;
revoke all on function public.remove_workspace_user(text) from public;
grant execute on function public.remove_workspace_user(text) to authenticated;

-- 7) Eigenes Profil und Arbeitsbereich pflegen ----------------------------------------------------
create or replace function public.update_my_profile(p_name text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if trim(p_name) = '' then raise exception 'Bitte den Namen eingeben.'; end if;
  update public.profiles set name = trim(p_name), phone = trim(coalesce(p_phone, '')) where id = auth.uid();
end;
$$;
revoke all on function public.update_my_profile(text, text) from public;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- E-Mail-Änderung im Profil nachziehen (Supabase ändert auth.users nach der Bestätigung)
create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users for each row execute function public.sync_profile_email();

create or replace function public.rename_my_workspace(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  ws uuid := public.my_admin_workspace();
begin
  if ws is null then raise exception 'Nur ein Admin kann den Firmennamen ändern.'; end if;
  if trim(p_name) = '' then raise exception 'Bitte den Firmennamen eingeben.'; end if;
  update public.workspaces set name = trim(p_name) where id = ws;
end;
$$;
revoke all on function public.rename_my_workspace(text) from public;
grant execute on function public.rename_my_workspace(text) to authenticated;
