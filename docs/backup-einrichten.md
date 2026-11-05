# Nächtliche Sicherung einrichten (Supabase → Hetzner)

Jede Nacht sichert die Supabase-Funktion `backup` alle Tabellen der Datenbank (Firmen, Benutzer-Zuordnungen,
Einladungen, Foto-Verzeichnis, Datensätze aller Werkzeuge, Kontaktanfragen) gepackt in den Hetzner-Bucket
`baupad-dateien` unter `backups/<JJJJ-MM-TT>/`. Aufbewahrt werden die letzten 30 Sicherungen und der Stand vom
1. jedes Monats für 12 Monate. **Kosten: keine** (Supabase kostenloser Tarif, vorhandener Hetzner-Speicher).

Nicht enthalten: die Anmeldekonten selbst (Supabase Auth) und die Dateien (Fotos, Pläne, PDFs) – diese liegen
ohnehin bei Hetzner.

## 1. Funktion veröffentlichen (2 Minuten)
Supabase → Edge Functions → „Deploy a new function“ → „Via Editor“:
- **Zuerst** unten rechts „Function name“ auf `backup` ändern.
- Code aus `supabase/functions/backup/index.ts` einfügen → Deploy.
- Settings: **„Verify JWT with legacy secret“ ausschalten** – die Funktion prüft selbst das Geheimwort.

## 2. Zeitplan anlegen (1 Minute)
Supabase → SQL Editor → New query → Inhalt von `docs/supabase/backup.sql` einfügen → Run.
Das Ergebnis zeigt ganz unten eine Zeile `backup_token` (64 Zeichen).

## 3. Geheimwort eintragen
Supabase → Edge Functions → Secrets → Add: Name `BACKUP_TOKEN`, Wert = die Zeichenkette aus Schritt 2.
Die Hetzner-Secrets (`HETZNER_S3_…`) sind schon für die Funktion `storage` eingetragen und gelten für alle Funktionen.

## 4. Einmal von Hand prüfen
SQL Editor:
```sql
select net.http_post(
  url := 'https://knaskwuhjixxpnqjfqpx.supabase.co/functions/v1/backup',
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-backup-token', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_token')),
  body := '{"action":"run"}'::jsonb, timeout_milliseconds := 140000);
-- nach ca. 10 Sekunden:
select status_code, content from net._http_response order by created desc limit 1;
```
Erwartet: `200` und `{"date":"…","counts":{"workspaces":…,"records":…},…}`. In der Hetzner-Konsole liegt dann
`backups/<heute>/` mit je einer Datei pro Tabelle und `manifest.json`.

- `401 token` → Secret `BACKUP_TOKEN` stimmt nicht mit Schritt 2 überein.
- `501 not-configured` → `BACKUP_TOKEN` oder Hetzner-Secrets fehlen.
- `502 Datenbank …: 401` → der Standardschlüssel ist abgeschaltet: unter Project Settings → API Keys einen
  Secret Key (`sb_secret_…`) anlegen und als Secret `BACKUP_SERVICE_KEY` eintragen.

Lauf der letzten Nächte: `select status, start_time, return_message from cron.job_run_details order by start_time desc limit 5;`
(„succeeded“ heißt nur, dass der Aufruf abgeschickt wurde – das Ergebnis steht in `net._http_response`.)

## Wiederherstellen
Vorhandene Sicherungen: wie Schritt 4, aber `body := '{"action":"list"}'::jsonb`.

Datensätze und Foto-Verzeichnis einer Firma auf den Stand eines Tages zurückschreiben:
`body := '{"action":"restore","date":"2026-11-05","workspace":"<Arbeitsbereich-ID>"}'::jsonb`
(ohne `workspace` = alle Firmen). Es wird nur eingefügt bzw. überschrieben, nichts gelöscht; die Geräte holen den
Stand beim nächsten Abgleich. Die übrigen Tabellen (Firmen, Benutzer-Zuordnungen) bei Bedarf von Hand aus den
Dateien in `backups/<Datum>/` einspielen.

**Vor dem ersten echten Einsatz einmal testen:** eine Testfirma anlegen, sichern, einen Datensatz ändern,
wiederherstellen und prüfen.
