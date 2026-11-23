-- Sicherheit härten (Nov. 2026). Im Supabase SQL Editor einmal ausführen; mehrfaches Ausführen schadet nicht.
-- Als letztes Skript ausführen – nach schema.sql, project-access.sql, records-access.sql, time-access.sql usw.
--
-- 1) Nicht Angemeldete (anon) erreichen keine Tabelle und keine Funktion mehr – die App ruft alles erst nach der
--    Anmeldung auf (Kontaktformular und Sicherung laufen über Edge Functions mit eigenem Schlüssel).
-- 2) Angemeldete schreiben direkt nur noch Datensätze und Fotos (über RLS geprüft); Profil, Arbeitsbereich,
--    Mitglieder und Einladungen nur noch über die geprüften Funktionen der App. Damit kann niemand mehr
--    selbst seine E-Mail im Profil ändern (Vortäuschen einer anderen Person) oder den Arbeitsbereich ohne
--    Zahlung freischalten (workspaces.active).
-- 3) Vertrauen über die E-Mail-Adresse (Einladung annehmen, Betreiber/Büro) nur mit bestätigter Adresse.
-- 4) Interne Funktionen (Trigger, Zeitplan) sind von außen gar nicht aufrufbar; fester search_path überall.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

revoke truncate, trigger, references on all tables in schema public from authenticated;
revoke insert, update, delete on public.profiles, public.workspaces, public.memberships, public.invitations, public.operators, public.contact_messages from authenticated;
revoke delete on public.records, public.photos from authenticated;

grant execute on function
  public.accept_invitations(), public.delete_own_account(), public.is_admin(uuid), public.is_member(uuid), public.is_office(uuid),
  public.is_operator(), public.my_context(), public.my_storage_usage(), public.update_my_profile(text, text)
to authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('list_workspace_users','my_admin_workspace','my_office_workspace','operator_set_workspace',
      'operator_workspaces','project_access','remove_workspace_user','rename_my_workspace','set_project_access','upsert_workspace_user')
  loop execute format('grant execute on function %s to authenticated', f.sig); end loop;
end $$;
revoke execute on function public.handle_new_user(), public.sync_profile_email(), public.cleanup_contact_messages(), public.touch_updated_at() from authenticated;

alter function public.cleanup_contact_messages() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- Ist die E-Mail-Adresse der angemeldeten Person bestätigt?
create or replace function public.email_confirmed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null);
$$;
revoke execute on function public.email_confirmed() from public, anon;
grant execute on function public.email_confirmed() to authenticated;

create or replace function public.is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select public.email_confirmed() and exists (select 1 from public.operators o where lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.is_office(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.active and m.role in ('admin', 'buero')
  ) or public.is_operator();
$$;

create or replace function public.accept_invitations() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text;
begin
  if uid is null then return; end if;
  -- E-Mail aus dem Konto (nicht aus dem Token) und nur, wenn bestätigt
  select lower(coalesce(u.email, '')) into em from auth.users u where u.id = uid and u.email_confirmed_at is not null;
  if coalesce(em, '') = '' then return; end if;
  insert into public.memberships (workspace_id, user_id, role, tools, pkg, active, sites, tool_sites)
    select i.workspace_id, uid, i.role, i.tools, i.pkg, i.active, i.sites, i.tool_sites from public.invitations i where lower(i.email) = em
  on conflict do nothing;
  delete from public.invitations where lower(email) = em;
end;
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws_id uuid;
  nm text;
  co text;
  em text := lower(coalesce(new.email, ''));
begin
  nm := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  co := coalesce(nullif(trim(new.raw_user_meta_data ->> 'company'), ''), nm);
  insert into public.profiles (id, email, name) values (new.id, coalesce(new.email, ''), nm) on conflict (id) do nothing;
  -- Eingeladen? Beitritt nur mit bestätigter Adresse – sonst nach der Bestätigung beim Anmelden (accept_invitations)
  if new.email_confirmed_at is not null then
    insert into public.memberships (workspace_id, user_id, role, tools, pkg, active, sites, tool_sites)
      select i.workspace_id, new.id, i.role, i.tools, i.pkg, i.active, i.sites, i.tool_sites
      from public.invitations i where lower(i.email) = em
    on conflict do nothing;
    delete from public.invitations where lower(email) = em;
  end if;
  -- eigener Arbeitsbereich nur ohne Mitgliedschaft und ohne offene Einladung
  if not exists (select 1 from public.memberships where user_id = new.id)
     and not exists (select 1 from public.invitations where lower(email) = em) then
    insert into public.workspaces (name, created_by) values (co, new.id) returning id into ws_id;
    insert into public.memberships (workspace_id, user_id, role) values (ws_id, new.id, 'admin');
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.accept_invitations() from public, anon;
revoke execute on function public.is_operator() from public, anon;
revoke execute on function public.is_office(uuid) from public, anon;
grant execute on function public.accept_invitations(), public.is_operator(), public.is_office(uuid) to authenticated;
