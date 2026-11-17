-- Rechte je Projekt, Werkzeug und Preise am Server (17.11.2026): Die Tabellen `records` (alle Daten der Werkzeuge) und
-- `photos` (Fotoverzeichnis) dürfen direkt nur noch Admin, Büro und Betreiber (mit Mitgliedschaft) lesen und schreiben.
-- Polier und Arbeiter bekommen ihre Daten ausschließlich über die Funktion „storage“: dort nur freigegebene Projekte,
-- firmenweite Daten nur mit dem passenden Werkzeug und Preise nur mit der Freigabe „Preise und Summen“.
-- Ersetzt die Regeln aus storage.sql und time-access.sql (Zeitdaten waren schon nur für das Büro).
--
-- WICHTIG: zuerst die Funktion „storage“ neu veröffentlichen (Supabase → Edge Functions → storage → Code ersetzen →
-- Deploy), dann dieses SQL im SQL Editor ausführen. Andersherum können Polier und Arbeiter bis zum Veröffentlichen
-- nichts abgleichen. Kann jederzeit erneut laufen.

-- is_office: Admin oder Büro im Arbeitsbereich, oder Betreiber (wie in time-access.sql – hier zur Sicherheit erneut)
create or replace function public.is_office(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.active and m.role in ('admin', 'buero')
  ) or exists (
    select 1 from public.operators o where lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_office(uuid) from public;
grant execute on function public.is_office(uuid) to authenticated;

-- Datensätze: nur Mitglieder mit Büro-Rechten (Betreiber nur in einem Arbeitsbereich, in dem sie Mitglied sind)
drop policy if exists "Mitglieder lesen Datensätze" on public.records;
create policy "Mitglieder lesen Datensätze" on public.records for select
  using (public.is_member(workspace_id) and public.is_office(workspace_id));

drop policy if exists "Mitglieder schreiben Datensätze" on public.records;
create policy "Mitglieder schreiben Datensätze" on public.records for insert
  with check (public.is_member(workspace_id) and public.is_office(workspace_id));

drop policy if exists "Mitglieder ändern Datensätze" on public.records;
create policy "Mitglieder ändern Datensätze" on public.records for update
  using (public.is_member(workspace_id) and public.is_office(workspace_id))
  with check (public.is_member(workspace_id) and public.is_office(workspace_id));

-- Fotos: ebenso
drop policy if exists "Mitglieder lesen Fotos" on public.photos;
create policy "Mitglieder lesen Fotos" on public.photos for select
  using (public.is_member(workspace_id) and public.is_office(workspace_id));

drop policy if exists "Mitglieder schreiben Fotos" on public.photos;
create policy "Mitglieder schreiben Fotos" on public.photos for insert
  with check (public.is_member(workspace_id) and public.is_office(workspace_id));

drop policy if exists "Mitglieder ändern Fotos" on public.photos;
create policy "Mitglieder ändern Fotos" on public.photos for update
  using (public.is_member(workspace_id) and public.is_office(workspace_id))
  with check (public.is_member(workspace_id) and public.is_office(workspace_id));
