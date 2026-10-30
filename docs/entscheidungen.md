# Entscheidungen (Betreiber)

Festgelegte Grundsätze für BauPad / PAD Software. Bitte hier ergänzen, wenn sich etwas ändert.

## Firma und Produkt (Oktober 2026)
- Firma und Website: **PAD Software** (PAD = Initialen Pascu Andrea Daniele). Domain-Wunsch: pad-software.com / .at.
- Erstes Produkt: **BauPad**. Store-Anbieter ist die Firma, Bundle-Kennung z. B. `com.padsoftware.baupad`.

## Anmeldung (Oktober 2026)
- Anmelden und Registrieren in der App und auf der Website: Google, Apple, Microsoft (Outlook), E-Mail mit Passwort.
- Jede Registrierung legt einen Arbeitsbereich an; die Person ist Admin (Einzelperson = Firma mit einem Benutzer).
- Admin verwaltet Benutzer: E-Mail, Name, Funktion (Admin, Büro, Polier, Arbeiter), Werkzeuge, Paket, aktiv/gesperrt, **Baustellen** (alle oder ausgewählte). Der Admin gilt für die ganze Firma und alle Werkzeuge. Nicht freigegebene Werkzeuge erscheinen nicht in den Tools, nicht freigegebene Baustellen nicht in den Listen.
- Baustellen sind in allen Werkzeugen dieselben (Projekte, Fotos, Berichte, Einteilung, Mängelplan); Fotos aus dem Mängelplan liegen auch in der Fotodokumentation.
- Baustelle bearbeiten (Name, Nummer, Adresse) geht in jedem Werkzeug und wird überall nachgezogen – auch das Projekt in Aufmaß & Abrechnung und umgekehrt. Ändern dürfen derzeit Admin und Büro.
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

## Website-Relaunch (30.10.2026)
- **Markenarchitektur:** PAD Software ist die Dachmarke, BauPad das erste Produkt; weitere Produkte sind als „In Planung“ sichtbar, ohne Namen und Termine (erst nennen, wenn in Entwicklung). Ein Konto gilt für alle Produkte.
- **Seiten:** Home, Produkte, BauPad (mit fünf Werkzeug-Unterseiten), Unternehmen, Kontakt (+ Danke), Zukunft, Impressum, Datenschutz, Konto löschen. Sticky-Navigation, Hauptaktion „Kontakt aufnehmen“.
- **Design:** Palette Midnight Blue (White #FFFFFF, Mist #E8EDF4, Steel Blue #8FA7C4, Navy #193B63, Midnight #0B1526), Wechsel heller und dunkler Flächen, starke Typografie (Systemschrift), Scroll-Einblenden, dezente Parallaxe, schwebende Software-Panels; `prefers-reduced-motion` wird beachtet. Keine Videos, keine Baustellenfotos.
- **Logo:** Für PAD Software gibt es keine Logo-Datei; der bestehende Text-Schriftzug bleibt unverändert, bis die Originaldatei vorliegt. Das BauPad-Logo bleibt unangetastet.
- **Software-Ansichten:** vorerst gekennzeichnete schematische Platzhalter (keine echten Bildschirmfotos, Entscheidung des Betreibers); echte Bilder können ohne Umbau eingesetzt werden.
- **Sprachen:** Deutsch (ohne Präfix) und Englisch (`/en/…`), Texte zentral in `src/site/i18n`, Umschalter DE | EN. Die App bleibt deutsch.
- **Adressen:** saubere Adressen ohne `#`; alte `#/…`-Adressen werden umgeschrieben. Website-Seiten werden vorgerendert (Titel, Meta, canonical, hreflang, Open Graph, JSON-LD), dazu sitemap.xml, robots.txt, 404.html als App-Fallback.
- **Kontaktformular:** Supabase Edge Function `contact` + Resend (kostenlos bis 3.000 Mails/Monat) an office@pad-software.at, Sicherung in `contact_messages` (12 Monate), Honigtopf, Mindestdauer, Bremse. Einrichtung durch den Betreiber: `docs/kontaktformular.md`. Bis dahin meldet das Formular ehrlich „noch nicht eingerichtet“.
- **Cookies/Analyse:** nichts vorhanden, kein Banner nötig; Einführung nur nach Entscheidung und mit Einwilligung.

## Zentrale Ablage (30.10.2026)
- **Speicherort:** Hetzner Object Storage (S3-kompatibel), Bucket `baupad-dateien`, Nürnberg (Deutschland), 1 TB für rund 6 €/Monat; Konto office@pad-software.at mit Zwei-Faktor-Anmeldung. Kein Supabase Storage (bei 1 TB deutlich teurer).
- **Zugang:** Die App kennt keine Hetzner-Schlüssel. Die Supabase-Funktion `storage` prüft die Anmeldung, bestimmt den Arbeitsbereich und gibt kurzlebige signierte Links (Upload 15 min, Download 60 min) nur unter `ws/<Arbeitsbereich>/…` aus. Verzeichnis der Dateien in der Tabelle `photos` mit Zugriffsregeln je Firma.
- **Reihenfolge:** 1. Fotos (umgesetzt: Upload nach dem Speichern, Abgleich zwischen Geräten, Nachladen, Löschen für alle), 2. Pläne/Berichte/Projekte, 3. Datenschutzerklärung und AVV mit Hetzner.
- **Verhalten:** Gerät bleibt Zwischenspeicher (offline-fähig); Konto ohne Firma oder nicht eingerichtete Ablage → alles bleibt lokal, Konto zeigt den Zustand. Einrichtung: `docs/ablage-einrichten.md`.

## Store-App (30.10.2026)
- **Technik:** Capacitor verpackt die bestehende Web-App (eine Code-Basis) als Android-App, später iOS. App-ID `at.padsoftware.baupad`. Native Kamera in der Fotodokumentation (volle Qualität), sonst gleiche Oberfläche und Daten wie die Website.
- **Reihenfolge:** Jetzt Android-App als Test-APK (Build über GitHub Actions, weil der Android-SDK-Server aus der Entwicklungsumgebung nicht erreichbar ist). Store-Veröffentlichung erst zum Verkaufsstart, weil jede Änderung der App einen neuen Store-Upload mit Prüfung bräuchte; die Website aktualisiert sich von selbst. iPhone braucht einen Mac mit Xcode oder einen Cloud-Build-Dienst – Entscheidung offen.
- **Anbieter im Store:** ohne Firma der Name der Person; nach der Gründung Umstellung auf PAD Software.

## Projektregister und Rechte je Werkzeug (30.10.2026)
- **Ein Projektregister für alle Werkzeuge:** „Neues Projekt“ in Fotos, Berichten, Mängelplan oder Einteilung legt ein echtes Projekt an (auch in Aufmaß & Abrechnung sichtbar, dort ohne Pläne). Gleicher Name = dasselbe Projekt, keine Dubletten. Frei eingetippte Baustellen aus älteren Ständen werden beim Start einmalig übernommen.
- **Projekte anlegen:** nur Admin und Büro (Betreiber auch). Polier und Arbeiter wählen aus dem Register; „Neues Projekt“ ist für sie in allen Werkzeugen ausgeblendet, und das Anlegen wird in der App abgewiesen.
- **Rechte je Werkzeug und Projekt:** Admin legt pro Benutzer je Werkzeug fest: Werkzeug an/aus und „Alle Projekte“ oder ausgewählte (Spalte `tool_sites` in `memberships`/`invitations`). Die ältere gemeinsame Baustellenliste bleibt als Rückfall. Durchsetzung zuerst in der App; serverseitig mit dem Datenabgleich (nächster Schritt).
