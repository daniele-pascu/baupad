-- Freigabe je Projekt: Admin und Büro legen fest, welche Poliere und Arbeiter ein Projekt sehen
-- (Taste „Freigabe“ im Projekt). Im Supabase SQL Editor einmal ausführen; mehrfaches Ausführen schadet nicht.
-- Gespeichert wird in der vorhandenen Liste memberships.sites bzw. invitations.sites (Schlüssel „p:<Projekt>“).

-- Arbeitsbereich, in dem die angemeldete Person Admin oder Büro ist (der erste, falls mehrere)
create or replace function public.my_office_workspace() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.memberships where user_id = auth.uid() and active and role in ('admin', 'buero') order by created_at limit 1;
$$;
revoke all on function public.my_office_workspace() from public;
grant execute on function public.my_office_workspace() to authenticated;

-- Poliere und Arbeiter des Arbeitsbereichs (Mitglieder und Einladungen) mit dem Stand der Freigabe für ein Projekt
create or replace function public.project_access(p_key text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.name, x.email), '[]'::json)
  from (
    select p.id::text as id, p.name, p.email, m.role, (p_key = any(m.sites)) as allowed
    from public.memberships m join public.profiles p on p.id = m.user_id
    where m.workspace_id = public.my_office_workspace() and m.active and m.role in ('polier', 'arbeiter')
    union all
    select 'inv:' || i.email, i.name, i.email, i.role, (p_key = any(i.sites))
    from public.invitations i
    where i.workspace_id = public.my_office_workspace() and i.active and i.role in ('polier', 'arbeiter')
  ) x;
$$;
revoke all on function public.project_access(text) from public;
grant execute on function public.project_access(text) to authenticated;

-- Freigabe setzen: p_ids = alle Personen (id aus project_access), die das Projekt sehen dürfen; alle anderen verlieren es
create or replace function public.set_project_access(p_key text, p_ids text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  ws uuid := public.my_office_workspace();
begin
  if ws is null then raise exception 'Nur Admin oder Büro können Projekte freigeben.'; end if;
  if p_key !~ '^p:.+' then raise exception 'Unbekanntes Projekt.'; end if;
  update public.memberships
    set sites = case when user_id::text = any(p_ids) then array_append(array_remove(sites, p_key), p_key) else array_remove(sites, p_key) end
    where workspace_id = ws and role in ('polier', 'arbeiter');
  update public.invitations
    set sites = case when ('inv:' || email) = any(p_ids) then array_append(array_remove(sites, p_key), p_key) else array_remove(sites, p_key) end
    where workspace_id = ws and role in ('polier', 'arbeiter');
end;
$$;
revoke all on function public.set_project_access(text, text[]) from public;
grant execute on function public.set_project_access(text, text[]) to authenticated;
