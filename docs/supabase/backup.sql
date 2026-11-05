-- Nächtliche Sicherung der Datenbank nach Hetzner (Supabase-Funktion „backup“), siehe docs/backup-einrichten.md.
-- Im Supabase SQL Editor ausführen. Kostenlos (pg_cron, pg_net und Vault gibt es in jedem Tarif).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Geheimwort einmalig in der Datenbank erzeugen (bleibt im Vault, steht in keinem Code)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'backup_token') then
    perform vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'backup_token', 'Geheimwort der Funktion backup');
  end if;
end $$;

-- 2) Jede Nacht um 02:15 UTC (03:15 bzw. 04:15 Uhr in Österreich) sichern
select cron.schedule(
  'baupad-backup',
  '15 2 * * *',
  $job$
  select net.http_post(
    url := 'https://knaskwuhjixxpnqjfqpx.supabase.co/functions/v1/backup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-backup-token', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_token')),
    body := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 140000
  );
  $job$
);

-- 3) Geheimwort anzeigen → in Edge Functions → Secrets als BACKUP_TOKEN eintragen
select decrypted_secret as backup_token from vault.decrypted_secrets where name = 'backup_token';
