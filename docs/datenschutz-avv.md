# Datenschutz: Verträge zur Auftragsverarbeitung (AVV) und Pflichten

Stand 17.11.2026. Kurz: BauPad verarbeitet Daten der Kundenfirmen (z. B. ihrer Beschäftigten) **in deren Auftrag** –
PAD Software ist dafür **Auftragsverarbeiter** (Art. 28 DSGVO) und setzt selbst Dienstleister ein
(**Unterauftragsverarbeiter**). Dafür braucht es Verträge in beide Richtungen. Kein Code – das meiste ist ein Klick
im Konto des jeweiligen Anbieters. **Die Texte sind ein sorgfältiger Entwurf, keine Rechtsberatung: AVV-Seite und
Datenschutzerklärung einmal von einer Rechtsanwältin bzw. einem Rechtsanwalt (oder über die WKO) prüfen lassen.**

## 1. Verträge mit unseren Dienstleistern abschließen (du, ca. 20 Minuten)

Die Datenschutzerklärung sagt bereits, dass diese Verträge bestehen – bitte jetzt abschließen bzw. prüfen und die
PDFs in einem Ordner „Datenschutz“ ablegen:

| Dienst | Wofür | So geht es |
|---|---|---|
| **Hetzner** (Speicher, Sicherungen) | Dateien, Fotos, Sicherungen | Hetzner-Konto (accounts.hetzner.com) → Bereich Datenschutz / „Auftragsverarbeitung“: AVV elektronisch abschließen und als PDF speichern. Findest du den Punkt nicht: Hetzner-Support über die Konsole fragen. |
| **Supabase** (Datenbank, Anmeldung) | Konten, Datensätze | Das Data Processing Addendum gilt mit den Nutzungsbedingungen: https://supabase.com/legal/dpa – PDF speichern. Für eine unterschriebene Fassung im Supabase-Dashboard über „Support“ anfragen. |
| **Resend** (E-Mails) | Konto- und Kontakt-E-Mails | Gilt mit den Nutzungsbedingungen: https://resend.com/legal/dpa – PDF (auch unterschrieben verfügbar) speichern. |
| **GitHub** (Auslieferung der App-Dateien) | IP-Adressen beim Laden der Seite | Teil der GitHub-Bedingungen (GitHub Data Protection Agreement) – Link/PDF ablegen. |

Zusätzlich (steht so in den technischen und organisatorischen Maßnahmen, Anlage 1 der AVV-Seite):
- **Zwei-Faktor-Anmeldung** bei Hetzner, Supabase, GitHub und Resend einschalten (Hetzner laut Doku schon erledigt).
- Zugänge nur persönlich, keine geteilten Passwörter.

## 2. Vertrag mit unseren Kunden (erledigt in der Website)

- Seite **„Auftragsverarbeitung (AVV)“**: https://pad-software.at/auftragsverarbeitung (Fußzeile → Rechtliches; Englisch
  /en/data-processing mit deutschem Vertragstext). Inhalt: Vertrag nach Art. 28 DSGVO, Anlage 1 technische und
  organisatorische Maßnahmen, Anlage 2 Unterauftragsverarbeiter. Text: `src/site/legal/avv.ts`.
- Geltung: mit der Freischaltung des Arbeitsbereichs Teil des Nutzungsvertrags; unterschriebene Fassung auf Anfrage
  („Drucken oder als PDF speichern“ auf der Seite, unterschreiben, schicken).
- **Wichtig für die AGB/Bestellung:** Beim Freischalten einer Firma auf den AVV hinweisen (z. B. Satz in der
  Bestellbestätigung: „Es gilt der Vertrag zur Auftragsverarbeitung unter pad-software.at/auftragsverarbeitung.“).
- Neuer oder anderer Dienstleister → Anlage 2 ändern **und** die Admins der Firmen 30 Tage vorher per E-Mail
  informieren (so steht es im Vertrag, Punkt 7).

## 3. Eigene Pflichten als Auftragsverarbeiter

- **Verzeichnis der Verarbeitungstätigkeiten** (Art. 30 Abs. 2 DSGVO) führen: je Kunde Name/Kontakt, Art der
  Verarbeitung (Bereitstellung BauPad), Unterauftragsverarbeiter (Anlage 2), Drittlandübermittlung (USA: DPF/SCC),
  Maßnahmen (Anlage 1). Eine Tabelle genügt.
- **Datenschutzverletzung** (z. B. verlorener Laptop mit Zugängen, gehackter Zugang): betroffene Firmen unverzüglich,
  möglichst binnen 24 Stunden informieren (Vertrag Punkt 9); sie melden innerhalb von 72 Stunden an die
  Datenschutzbehörde.
- **Vertragsende einer Firma**: 30 Tage zum Sichern geben, dann Arbeitsbereich löschen; Sicherungen laufen nach
  ihrer Aufbewahrung aus (Vertrag Punkt 10).

## 4. Was die Datenschutzerklärung jetzt zusätzlich sagt

- Rechte je Projekt, Werkzeug und Preise werden am Server geprüft (seit 17.11.2026 – Funktion `storage` und
  `records-access.sql` müssen dafür eingespielt sein, siehe `docs/ablage-einrichten.md`).
- App-Sperre, „Abmelden und Daten löschen“, automatisches Löschen der Firmendaten am Gerät bei beendetem Zugang.
- Sicherungen verschlüsselt, getrennt und gesperrt – **stimmt erst, wenn `docs/backup-einrichten.md` Schritt 5
  erledigt ist.**
- E-Mails zum Konto über Supabase bzw. Resend; Hinweis auf die AVV-Seite für Firmen.
