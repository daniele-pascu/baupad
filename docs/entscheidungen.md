# Entscheidungen (Betreiber)

Festgelegte Grundsätze für BauPad / PAD Software. Bitte hier ergänzen, wenn sich etwas ändert.

## Firma und Produkt (Oktober 2026)
- Firma und Website: **PAD Software** (PAD = Initialen Pascu Andrea Daniele). Domain-Wunsch: pad-software.com / .at.
- Erstes Produkt: **BauPad**. Store-Anbieter ist die Firma, Bundle-Kennung z. B. `com.padsoftware.baupad`.

## Anmeldung (Oktober 2026)
- Anmelden und Registrieren in der App und auf der Website: Google, Apple, Microsoft (Outlook), E-Mail mit Passwort.
- Jede Registrierung legt einen Arbeitsbereich an; die Person ist Admin (Einzelperson = Firma mit einem Benutzer).
- Admin verwaltet Benutzer: E-Mail, Name, Funktion (Admin, Büro, Polier, Arbeiter), Werkzeuge, Paket, aktiv/gesperrt.
- Konto löschen muss in der App möglich sein (Apple-Vorgabe bei Registrierung in der App).
- Dienst: Supabase, Projekt „BauPad“ (angelegt 29.10.2026, Region West EU/Irland – EU, daher belassen). Fotos später: Hetzner Object Storage (EU).
- Betreiber-Konten (Betreiber-Übersicht) werden in der Tabelle `operators` per E-Mail freigeschaltet.

## Zugang (29.10.2026)
- Alle Werkzeuge (Tools, Aufmaß, Arbeitereinteilung, Berichte, Fotos, Kamera, Konto) nur mit Anmeldung – im Browser und in der installierten App, auf jedem Gerät. Kein „ohne Konto weiter“.
- Eine auf dem Gerät gespeicherte Anmeldung gilt auch offline; nur Abmelden oder eine vom Dienst zurückgewiesene Sitzung beenden sie.
- Öffentlich bleiben: Startseite, Produktseiten, Über uns, Kontakt, Impressum, Datenschutz, Anmelden/Registrieren, neues Passwort.
- Angemeldet führen Startseite, Produktseiten und „Über uns“ direkt zu den Tools; Kontakt und Rechtliches stehen unter Konto → Weitere Einstellungen.
- Konto und Einstellungen: alle Bereiche aktiv (Persönliche Daten, E-Mail und Konto, Passwort und Anmeldemethoden, Abonnement, Firmeninformationen, Benutzer & Rollen, App und Speicher, Weitere Einstellungen).

## Abrechnung (Oktober 2026)
- **Keine In-App-Käufe** (kein Apple-Abo, kein Google-Abo). Grundlage: Apple-Regel 3.1.3(c) Enterprise Services, Verkauf an Firmen.
- Pakete werden **nur auf der Website** gekauft und verwaltet: **Karte, SEPA-Lastschrift, Rechnung mit Überweisung** (Stripe, alternativ Paddle).
- In der Store-App keine Preise, keine Kauf-Knöpfe, keine Links zum Kauf; nur „Paket wird vom Admin deiner Firma verwaltet“.
- Rechnungen an Firmen mit UID und Umsatzsteuer automatisch; Betreiber-Übersicht mit Firmen, Benutzern, Einnahmen.

## Werkzeuge (29.10.2026)
- Fünftes Werkzeug **Mängelplan** (Symbol: gefalteter Plan mit Pin, Rot #d6242b): Pläne je Baustelle als Bild ohne Maßstab, Markierungen (Pin, Rechteck, Kreis, Linie, Freihand, Text) mit Nummer, Art (Mangel, Ausbesserung, Hinweis, Erledigt), Titel, Beschreibung, Fotos aus der Fotodokumentation; PDF mit Plan und Liste. Datenbank-Version 8.
- Berichte & Formulare: „Teilen“ je Bericht und „Alle teilen“ je Baustelle (PDF direkt an Mail, WhatsApp, Dateien).

## Preis (29.10.2026)
- BauPad ist ab dem öffentlichen Start kostenpflichtig (Abo). Bis dahin Testphase mit Testkonten, keine Gratis-Version.
- Vor dem Start nötig: Gewerbe, Stripe-Konto (office@), Preise, Kaufseite, AGB. Offen: Preismodell (je Benutzer oder je Firma) und Testzeit (z. B. 14 Tage).

## Stores (Oktober 2026)
- Store-Apps als Hülle, die die Web-App von der eigenen Adresse lädt (Updates automatisch, Store-Update nur bei Änderungen an der Hülle).
- Google Play zuerst, Apple danach (Developer Program nötig, damit auch „Mit Apple anmelden“).

## Domains (Oktober 2026)
- Gekauft bei World4You: **pad-software.at** (Website und App) und **baupad.at** (Weiterleitung auf pad-software.at).
- Hosting weiter über GitHub Pages mit eigener Domain; E-Mail über World4You (E-Mail Grow). Einrichtung: `docs/domain-einrichten.md`.
