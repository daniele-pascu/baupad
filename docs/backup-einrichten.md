# Nächtliche Sicherung einrichten (Supabase → Hetzner)

**Erledigt 05.11.2026:** Funktion, Zeitplan und Geheimwort eingerichtet; erster Lauf erfolgreich (8 Tabellen, 363 Datensätze, 21 Fotos im Verzeichnis, 90 KB gepackt).

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

- `401 UNAUTHORIZED_NO_AUTH_HEADER` → bei der Funktion ist „Verify JWT“ noch an (Supabase-Schleuse) – ausschalten.
- `401 token` → Secret `BACKUP_TOKEN` stimmt nicht mit Schritt 2 überein.
- `501 not-configured` → `BACKUP_TOKEN` oder Hetzner-Secrets fehlen.
- `501 BACKUP_KEY …` bzw. `501 BACKUP_LOCK_MODE …` → Schlüssel nicht 32 Byte (Base64) bzw. Sperre nicht GOVERNANCE/COMPLIANCE –
  dann wird absichtlich gar nicht gesichert (lieber keine als eine unverschlüsselte Sicherung).
- `502 Hetzner PUT …: 400` mit Object Lock → der Bucket wurde ohne Object Lock angelegt: neuen Bucket mit Object Lock anlegen.
- `502 Datenbank …: 401` → der Standardschlüssel ist abgeschaltet: unter Project Settings → API Keys einen
  Secret Key (`sb_secret_…`) anlegen und als Secret `BACKUP_SERVICE_KEY` eintragen.

Lauf der letzten Nächte: `select status, start_time, return_message from cron.job_run_details order by start_time desc limit 5;`
(„succeeded“ heißt nur, dass der Aufruf abgeschickt wurde – das Ergebnis steht in `net._http_response`.)

## 5. Sicherungen schützen: verschlüsselt, eigener Speicher, unlöschbar (17.11.2026)

Bisher liegen die Sicherungen unverschlüsselt im selben Bucket wie die Fotos und Pläne. Wer an diesen Speicher kommt,
käme auch an die Sicherungen – und könnte beides löschen. So wird das getrennt (einmalig, ca. 20 Minuten):

**a) Eigener Speicher bei Hetzner** (eigenes Projekt = eigene Schlüssel, die die App nie sieht)
1. https://console.hetzner.com → **Neues Projekt** „BauPad-Sicherungen“.
2. Darin **Object Storage → Bucket erstellen**: Name z. B. `baupad-sicherungen`, Standort Nürnberg oder Falkenstein,
   Sichtbarkeit **privat**, und **Object Lock einschalten** (geht nur beim Anlegen; schaltet die Versionierung mit ein).
3. Im selben Projekt **Security → S3-Zugangsdaten → Erstellen** – Access Key und Secret Key notieren.

**b) Schlüssel für die Verschlüsselung erzeugen**
Supabase → SQL Editor: `select encode(extensions.gen_random_bytes(32), 'base64');` → das Ergebnis (44 Zeichen) ist
der Schlüssel (meldet Supabase „function … does not exist“: vorher einmal `create extension if not exists pgcrypto with schema extensions;` ausführen). **Zusätzlich sicher außerhalb von Supabase aufbewahren** (Passwort-Manager oder ausgedruckt im Tresor):
ohne ihn lassen sich die Sicherungen nicht mehr lesen – auch nicht von uns.

**c) Secrets eintragen** (Supabase → Edge Functions → Secrets):

| Name | Wert |
|---|---|
| `BACKUP_KEY` | Schlüssel aus b) |
| `BACKUP_S3_BUCKET` | `baupad-sicherungen` |
| `BACKUP_S3_KEY` / `BACKUP_S3_SECRET` | Zugangsdaten aus a) 3. |
| `BACKUP_S3_ENDPOINT` | nur bei anderem Standort, z. B. `https://fsn1.your-objectstorage.com` (Nürnberg = wie bisher, weglassen) |
| `BACKUP_LOCK_MODE` | `COMPLIANCE` (niemand kann vorher löschen, auch nicht Hetzner-Admins) – zum Ausprobieren erst `GOVERNANCE` |

**d) Funktion `backup` neu veröffentlichen** (Code aus `supabase/functions/backup/index.ts` → Deploy).

**e) Prüfen** – wie Schritt 4, nacheinander mit diesen `body`-Werten:
- `'{"action":"setup"}'` → erwartet `"ok":true`, `"bucketObjectLock":true`, `"encrypted":true`, `"separate":true`
  (setzt die Regel, die abgelaufene Stände nach der Sperrfrist wirklich entfernt).
- `'{"action":"run"}'` → erwartet `"encrypted":true`, `"locked":{"mode":"COMPLIANCE",…}`. In der Hetzner-Konsole liegt
  dann `backups/<heute>/` im neuen Bucket mit Dateien `….ndjson.gz.enc`.
- `'{"action":"list"}'` → zeigt neue und alte Stände.

Danach: Die alten, unverschlüsselten Sicherungen im Bucket `baupad-dateien` laufen von selbst aus (Tagesstände nach
30 Tagen, Monatsstände nach 12 Monaten) und bleiben bis dahin wiederherstellbar. Gesperrt bleibt jede Datei gut einen
Monat (Monatsstände gut 13 Monate) – passend zur Aufbewahrung.

Eine einzelne Datei von Hand lesen (z. B. Firmen oder Benutzer-Zuordnungen einspielen): Datei aus der Hetzner-Konsole
laden, dann `BACKUP_KEY='…' node scripts/sicherung-entschluesseln.mjs records.ndjson.gz.enc`.

## Wiederherstellen
Vorhandene Sicherungen: wie Schritt 4, aber `body := '{"action":"list"}'::jsonb`.

Datensätze und Foto-Verzeichnis einer Firma auf den Stand eines Tages zurückschreiben:
`body := '{"action":"restore","date":"2026-11-05","workspace":"<Arbeitsbereich-ID>"}'::jsonb`
(ohne `workspace` = alle Firmen). Es wird nur eingefügt bzw. überschrieben, nichts gelöscht; die Geräte holen den
Stand beim nächsten Abgleich. Die übrigen Tabellen (Firmen, Benutzer-Zuordnungen) bei Bedarf von Hand aus den
Dateien in `backups/<Datum>/` einspielen.

**Vor dem ersten echten Einsatz einmal testen:** eine Testfirma anlegen, sichern, einen Datensatz ändern,
wiederherstellen und prüfen.
