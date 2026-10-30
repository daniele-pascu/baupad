# Zentrale Ablage einrichten (Hetzner Object Storage + Supabase-Funktion „storage“)

Fotos (später auch Pläne und Berichte) liegen damit nicht mehr nur auf dem Gerät, sondern in einer Ablage,
auf die alle Geräte einer Firma zugreifen. Speicherort: Hetzner Object Storage, Nürnberg (Deutschland).
Kosten: etwa 6 € pro Monat für 1 TB Speicher und 1 TB Datenverkehr.

So funktioniert es: Die App fragt bei der Supabase-Funktion `storage` nach einem kurzlebigen, signierten Link
und lädt die Datei damit direkt zu Hetzner hoch bzw. herunter. Die Hetzner-Schlüssel kennt nur die Funktion.
Jeder Benutzer kommt nur an Dateien seines eigenen Arbeitsbereichs (`ws/<Arbeitsbereich>/…`). Das Verzeichnis
der Fotos (Projekt, Datum, Beschreibung) steht in der Tabelle `photos` in Supabase mit Zugriffsregeln je Firma.

## Erledigt (30.10.2026)
- Hetzner-Konto (office@pad-software.at), Projekt „BauPad“, Bucket `baupad-dateien` in Nürnberg, privat.
- S3-Zugangsdaten erzeugt (Access Key, Secret Key) – liegen beim Betreiber, nie im Code.

## 1. Tabelle anlegen (1 Minute)
Supabase → SQL Editor → New query → Inhalt von `docs/supabase/storage.sql` einfügen → Run.

## 2. Funktion veröffentlichen (erledigt 30.10.2026)
Supabase → Edge Functions → „Deploy a new function“ → „Via Editor“:
- **Zuerst** unten rechts „Function name“ auf `storage` ändern (der zufällige Vorschlag wird sonst zur festen
  Adresse; ein späteres Umbenennen ändert nur den Anzeigenamen, die App findet die Funktion dann nicht).
- Code aus `supabase/functions/storage/index.ts` einfügen → Deploy.
- Settings: **„Verify JWT with legacy secret“ ausschalten** (wie beim Kontaktformular). Sonst blockt die
  Supabase-Schleuse schon die Voranfrage des Browsers und die App meldet „Keine Verbindung“. Die Funktion prüft
  die Anmeldung selbst (ohne gültiges Token → 401).

Secrets (Edge Functions → Secrets):

| Name | Wert |
|---|---|
| `HETZNER_S3_ENDPOINT` | `https://nbg1.your-objectstorage.com` |
| `HETZNER_S3_BUCKET` | `baupad-dateien` |
| `HETZNER_S3_REGION` | `eu-central` (Hetzner nennt die Region so; falls „Verbindung prüfen“ einen Signaturfehler meldet: `nbg1` versuchen) |
| `HETZNER_S3_KEY` | Access Key aus Hetzner |
| `HETZNER_S3_SECRET` | Secret Key aus Hetzner |

## 3. Prüfen und freischalten (als Betreiber in der App)
1. https://pad-software.at anmelden → Konto → „App und Speicher“ → Bereich „Zentrale Ablage“.
2. **„Verbindung prüfen“**: meldet „verbunden“ mit Bucket und Region. Bei einem Fehler steht die Antwort von
   Hetzner dabei (z. B. SignatureDoesNotMatch → Region oder Schlüssel prüfen).
3. **„Browser-Zugriff einrichten“**: setzt die CORS-Regeln am Bucket, damit der Browser direkt hoch- und
   herunterladen darf (pad-software.at, www, localhost). Einmalig.
4. Danach: ein Foto aufnehmen – Status „zentral gespeichert“, in der Hetzner-Konsole erscheint die Datei
   unter `ws/<Arbeitsbereich>/photos/…`. Auf einem zweiten Gerät mit derselben Firma anmelden: das Foto ist da.

## Verhalten in der App
- Fotos werden weiterhin zuerst auf dem Gerät gespeichert (offline-fähig) und dann hochgeladen
  (Status: wartet auf Upload → wird hochgeladen → zentral gespeichert; bei Fehler: Upload fehlgeschlagen, erneuter Versuch).
- Beim Start, beim Wiederverbinden und alle paar Minuten gleicht die App das Verzeichnis ab; Bilder anderer
  Geräte werden bei Bedarf nachgeladen (Vorschau zuerst).
- Löschen entfernt den Eintrag für alle Geräte und die Dateien bei Hetzner.
- Ohne Anmeldung bei einer Firma (Konto ohne Arbeitsbereich) bleibt alles lokal.

## Sicherheit und Datenschutz
- Hetzner-Schlüssel nur als Supabase-Secrets; Links sind 15 Minuten (Upload) bzw. 60 Minuten (Download) gültig.
- Dateien sind privat (kein öffentlicher Zugriff), Zugriff nur über signierte Links des eigenen Arbeitsbereichs.
- Datenschutzerklärung: Abschnitt „Zentrale Ablage“ nennt Hetzner Online GmbH (Deutschland) als Auftragsverarbeiter.
  Mit Hetzner ist ein Auftragsverarbeitungsvertrag (AVV) abzuschließen: Hetzner-Konto → „Auftragsverarbeitung“ (ist dort elektronisch möglich).

## Später
- Pläne, Berichte, Projekte über dieselbe Funktion (Präfixe `plans/`, `reports/` …).
- Aufräumen gelöschter Dateien, Speicherübersicht je Firma in der Betreiber-Ansicht.
