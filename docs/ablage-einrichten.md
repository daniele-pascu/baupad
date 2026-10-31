# Zentrale Ablage einrichten (Hetzner Object Storage + Supabase-Funktion „storage“)

Alle Daten der Werkzeuge (Projekte, Pläne, Aufmaße, Berichte, Einteilung, Mängelpläne, Firmenformulare) und die
Dateien dazu (Originalpläne, Planbilder, Formular-PDFs, Fotos) liegen damit nicht mehr nur auf dem Gerät, sondern
in einer Ablage, auf die alle Geräte einer Firma zugreifen. Speicherort: Hetzner Object Storage, Nürnberg (Deutschland).
Kosten: etwa 6 € pro Monat für 1 TB Speicher und 1 TB Datenverkehr.

So funktioniert es: Die App fragt bei der Supabase-Funktion `storage` nach einem kurzlebigen, signierten Link
und lädt die Datei damit direkt zu Hetzner hoch bzw. herunter. Die Hetzner-Schlüssel kennt nur die Funktion.
Jeder Benutzer kommt nur an Dateien seines eigenen Arbeitsbereichs (`ws/<Arbeitsbereich>/…`). Das Verzeichnis
der Fotos (Projekt, Datum, Beschreibung) steht in der Tabelle `photos` in Supabase mit Zugriffsregeln je Firma.

## Erledigt (30.10.2026)
- Hetzner-Konto (office@pad-software.at), Projekt „BauPad“, Bucket `baupad-dateien` in Nürnberg, privat.
- S3-Zugangsdaten erzeugt (Access Key, Secret Key) – liegen beim Betreiber, nie im Code.

## 1. Tabellen anlegen (1 Minute)
Supabase → SQL Editor → New query → Inhalt von `docs/supabase/storage.sql` einfügen → Run.
Legt `photos` (Verzeichnis der Fotos) und `records` (Datensätze aller Werkzeuge) an. **Nach dem 31.10.2026 einmal erneut
ausführen** (Tabelle `records` ist neu) und die Funktion `storage` neu veröffentlichen (Schritt 2, neue Aktionen
`records-upsert`/`records-pull` und Dateischlüssel `files/…`).

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
- **Alle Daten:** Jede Änderung (Projekt, Plan, Messung, Bericht, Woche, Arbeiter, Mängelplan, Formular, Firmeneinstellung)
  wird zuerst auf dem Gerät gespeichert und in die Warteschlange gestellt; mit Verbindung geht sie innerhalb weniger
  Sekunden in die Ablage (Dateien zuerst, dann die Angaben). Ohne Netz bleibt sie in der Warteschlange und wird bei der
  nächsten Verbindung übertragen (Konto → App und Speicher zeigt „n Änderungen warten auf Upload“).
- **Andere Geräte:** holen Änderungen beim Start, beim Wiederverbinden, beim Zurückkehren in die App und alle 5 Minuten;
  Listen aktualisieren sich von selbst. Beispiel: am iPad auf der Baustelle Aufmaß erfassen, im Büro am PC anmelden –
  Projekt und Plan sind da; die Originaldatei des Plans wird beim ersten Öffnen nachgeladen.
- **Konflikte:** Lokale, noch nicht übertragene Änderungen gewinnen; sonst gilt die zuletzt übertragene Änderung
  (je Datensatz). Löschen gilt für alle Geräte.
- **Erste Anbindung eines Geräts:** Alles, was schon auf dem Gerät ist, wird einmalig in die Ablage übernommen.
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
- Aufräumen gelöschter Dateien (Originalpläne gelöschter Projekte bleiben vorerst bei Hetzner), Speicherübersicht je
  Firma in der Betreiber-Ansicht (die Anzeige unter Konto zählt nur Fotos).
- Vorab-Download aller Dateien eines Projekts fürs Arbeiten ohne Netz („Projekt aufs Gerät holen“).
