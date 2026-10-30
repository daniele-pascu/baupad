-- Kontaktformular der Website: Sicherung der eingegangenen Nachrichten (längstens 12 Monate).
-- Im Supabase SQL Editor einmal ausführen. Nur die Funktion „contact“ (service_role) schreibt hier hinein;
-- für angemeldete Benutzer und den anon-Schlüssel ist die Tabelle unsichtbar.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  company text,
  email text not null,
  subject text not null,
  message text not null,
  lang text not null default 'de',
  ip text
);

alter table public.contact_messages enable row level security;
-- keine Richtlinien: nur service_role (die Funktion) darf lesen und schreiben

-- Aufräumen: Nachrichten älter als 12 Monate löschen (manuell oder per Cron)
create or replace function public.cleanup_contact_messages() returns void language sql security definer as $$
  delete from public.contact_messages where created_at < now() - interval '12 months';
$$;
