-- Rechte je Projekt, Werkzeug und Preise am Server (17.11.2026): Die Tabellen `records` (alle Daten der Werkzeuge) und
-- `photos` (Fotoverzeichnis) dürfen direkt nur noch Admin, Büro und Betreiber (mit Mitgliedschaft) lesen und schreiben.
-- Polier und Arbeiter bekommen ihre Daten ausschließlich über die Funktion „storage“: dort nur freigegebene Projekte,
-- firmenweite Daten nur mit dem passenden Werkzeug und Preise nur mit der Freigabe „Preise und Summen“.
-- Ersetzt die Regeln aus storage.sql und time-access.sql (Zeitdaten waren schon nur für das Büro).
--
-- WICHTIG: zuerst die Funktion „storage“ neu veröffentlichen (Supabase → Edge Functions → storage → Code ersetzen →
-- Deploy), dann dieses SQL im SQL Editor ausführen. Andersherum können Polier und Arbeiter bis zum Veröffentlichen
-- nichts abgleichen. Kann jederzeit erneut laufen.

-- is_office kommt aus security.sql (Betreiber nur mit bestätigter E-Mail) – hier bewusst nicht neu angelegt,
-- sonst würde eine ältere Fassung die Prüfung wieder entfernen. Eingespielt am 24.11.2026.

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
