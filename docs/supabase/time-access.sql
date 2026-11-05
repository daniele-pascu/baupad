-- Zeitaufzeichnung schützen (05.11.2026): Stunden (timeDays) und Monatsfreigaben (timeMonths) in der Tabelle
-- `records` dürfen direkt nur Admin, Büro und Betreiber lesen und schreiben. Polier und Arbeiter bekommen sie
-- ausschließlich gefiltert über die Funktion „storage“ (Polier: seine Projekte, Arbeiter: eigene Stunden).
-- WICHTIG: zuerst die Funktion „storage“ neu veröffentlichen, dann dieses SQL ausführen.

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

drop policy if exists "Mitglieder lesen Datensätze" on public.records;
create policy "Mitglieder lesen Datensätze" on public.records for select
  using (public.is_member(workspace_id) and (store not in ('timeDays', 'timeMonths') or public.is_office(workspace_id)));

drop policy if exists "Mitglieder schreiben Datensätze" on public.records;
create policy "Mitglieder schreiben Datensätze" on public.records for insert
  with check (public.is_member(workspace_id) and (store not in ('timeDays', 'timeMonths') or public.is_office(workspace_id)));

drop policy if exists "Mitglieder ändern Datensätze" on public.records;
create policy "Mitglieder ändern Datensätze" on public.records for update
  using (public.is_member(workspace_id) and (store not in ('timeDays', 'timeMonths') or public.is_office(workspace_id)))
  with check (public.is_member(workspace_id) and (store not in ('timeDays', 'timeMonths') or public.is_office(workspace_id)));
