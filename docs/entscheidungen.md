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
- **Freischaltung:** Neue Registrierungen haben keinen Zugang zu den Werkzeugen, bis der Betreiber die Firma nach der Bestellung freischaltet (Konto → Betreiber: Kunden freischalten). Gesperrte sehen eine Hinweisseite („im Aufbau, Zugang nach Bestellung“). Je Firma vereinbart der Betreiber einen **Preis je Benutzer und Monat**; keine Nutzer-Obergrenze, jeder angelegte Benutzer zählt. Betreiber hat keinen Zugriff auf Daten oder Anmeldung der Firmen.
- **Einstellungen (Konto):** Bereiche als Kästen; Antippen öffnet eine eigene ganze Seite (`/konto/<bereich>`), keine Fenster (am Handy/Tablet zu klein).

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
- **Später (vorgemerkt 18.11.2026): App nur mit BauPad-Anmeldung.** In der App (Store-App bzw. vom Home-Bildschirm) gibt es nur die BauPad-Anmeldung – ohne Website-Leiste, ohne Link „Zur Startseite“, Website-Seiten leiten zur Anmeldung um. Die Website öffnet man am Handy in Chrome oder Safari.
- **PAD Software ist nicht Bau (18.11.2026):** Die Firma entwickelt Software in alle Richtungen. Bau, Baustelle und Pläne gehören nur zu BauPad – Startseite und Firmenseiten von PAD Software bleiben branchenneutral.
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
- **Reihenfolge:** 1. Fotos (umgesetzt: Upload nach dem Speichern, Abgleich zwischen Geräten, Nachladen, Löschen für alle), 2. Pläne/Berichte/Projekte (umgesetzt 31.10.2026, siehe unten), 3. Datenschutzerklärung und AVV mit Hetzner.
- **Alle Daten (31.10.2026):** Datensätze aller Werkzeuge liegen als JSON in der Supabase-Tabelle `records` (je Arbeitsbereich, Zugriffsregeln wie bei `photos`), Dateien (Originalpläne, Mängelplan-Bilder, Formular-PDFs) bei Hetzner unter `ws/<Arbeitsbereich>/files/<id>/…`. Jede lokale Änderung kommt in die Warteschlange (`outbox`) und wird bei Verbindung übertragen – Dateien vor Datensätzen. Änderungen anderer Geräte holt die App beim Start, beim Wiederverbinden, beim Zurückkehren in die App und alle 5 Minuten (Cursor Zeit + Kennung). Regel bei Konflikten: noch nicht übertragene lokale Änderungen gewinnen, sonst die zuletzt übertragene Änderung. Dateien anderer Geräte werden erst beim Öffnen geladen (kein Vorab-Download – Baustellen-Geräte sollten den Plan vorher einmal öffnen). Rechte je Werkzeug/Projekt gelten weiter in der App; serverseitig sieht jedes Mitglied die Datensätze seiner Firma.
- **Verhalten:** Gerät bleibt Zwischenspeicher (offline-fähig); Konto ohne Firma oder nicht eingerichtete Ablage → alles bleibt lokal, Konto zeigt den Zustand. Einrichtung: `docs/ablage-einrichten.md`.

## Store-App (30.10.2026)
- **Technik:** Capacitor verpackt die bestehende Web-App (eine Code-Basis) als Android-App, später iOS. App-ID `at.padsoftware.baupad`. Native Kamera in der Fotodokumentation (volle Qualität), sonst gleiche Oberfläche und Daten wie die Website.
- **Reihenfolge:** Jetzt Android-App als Test-APK (Build über GitHub Actions, weil der Android-SDK-Server aus der Entwicklungsumgebung nicht erreichbar ist). Store-Veröffentlichung erst zum Verkaufsstart, weil jede Änderung der App einen neuen Store-Upload mit Prüfung bräuchte; die Website aktualisiert sich von selbst. iPhone braucht einen Mac mit Xcode oder einen Cloud-Build-Dienst – Entscheidung offen.
- **Anbieter im Store:** ohne Firma der Name der Person; nach der Gründung Umstellung auf PAD Software.

## Projektregister und Rechte je Werkzeug (30.10.2026)
- **Ein Projektregister für alle Werkzeuge:** „Neues Projekt“ in Fotos, Berichten, Mängelplan oder Einteilung legt ein echtes Projekt an. Es gehört zuerst nur dem Werkzeug, in dem es angelegt wurde (Feld `tools` am Projekt) und erscheint nur dort in der Übersicht. In allen anderen Werkzeugen steht es in der Projektauswahl zum Übernehmen (Aufmaß: im Formular „Aus dem Projektregister übernehmen“); mit dem ersten Foto, Bericht, Plan oder der ersten Woche gilt es dort als benutzt. Gleicher Name = dasselbe Projekt, keine Dubletten. Frei eingetippte Baustellen aus älteren Ständen werden beim Start einmalig übernommen.
- **Projekte anlegen:** nur Admin und Büro (Betreiber auch). Polier und Arbeiter wählen aus dem Register; „Neues Projekt“ ist für sie in allen Werkzeugen ausgeblendet, und das Anlegen wird in der App abgewiesen.
- **Rechte je Werkzeug und Projekt:** Admin legt pro Benutzer je Werkzeug fest: Werkzeug an/aus und „Alle Projekte“ oder ausgewählte (Spalte `tool_sites` in `memberships`/`invitations`). Die ältere gemeinsame Baustellenliste bleibt als Rückfall. Durchsetzung zuerst in der App; serverseitig mit dem Datenabgleich (nächster Schritt).

## Eigene Firmenformulare (31.10.2026)
- Firmen laden ihre Regieliste/ihren Bautagesbericht als PDF hoch; BauPad erkennt Felder und Tabellen selbst, der Admin prüft einmal in der Vorschau. Beim Export wird das Original-PDF beschrieben (keine Vorlagen hin- und herschicken).
- Regieliste bleibt in BauPad **pro Tag**; Firmenformulare als Wochenblatt werden aus allen Regielisten der Kalenderwoche gefüllt (Datum → Wochentagsspalte). Variante „BauPad-Regieliste auf Wochenblatt umbauen“ verworfen.
- **Eine Taste „Neues Projekt“ in jedem Werkzeug → Fenster „Projekt“ (Variante B):** oben „Neues Projekt anlegen“ (überall derselbe Dialog: Projektname Pflicht, Bauvorhaben/Adresse, Projektnummer, Kostenstelle als ein Feld „Nr – Bezeichnung“, Auftraggeber, Baubeginn, Bemerkung), darunter alle Projekte aus dem Register zum Übernehmen mit Suche und Marken, wo sie schon benutzt werden. Antippen übernimmt sofort. Aufmaß, Fotos, Berichte, Mängelplan und Arbeitereinteilung (dort in die Woche) gleich. Weitere Kostenstellen im Aufmaß über „Projektangaben bearbeiten“.
- **Projekte in Listen (alle Werkzeuge gleich):** Kostenstelle (sonst Projektnummer) vor dem Projektnamen, fett und groß; darunter dünn und klein in einer Zeile Bauvorhaben · Auftraggeber · Baubeginn · Bemerkung. Gilt für Aufmaß-Projektliste, Fotos, Berichte, Mängelplan und die Baustellenkarten der Einteilung.
- **Seitenleiste einklappen (PC/Tablet ab 900 px):** Aufmaß-Tabelle und Mängelliste lassen sich mit dem Knopf „›“ am rechten Rand des Plans nach rechts einklappen und mit „‹“ wieder ausklappen; der Zustand bleibt je Werkzeug gemerkt. Am Handy bleiben die Reiter „Plan | Liste“.
- **Werkzeugleisten (Aufmaß, Zeichenmodus, Mängelplan):** nie zwei Knöpfe zugleich – ein Werkzeug antippen schließt offene Menüs (Messung, Stil) und beendet eine laufende Messung; bei offenem Menü leuchtet nur dessen Knopf. Esc beendet überall alles (Zeichnung, Messung, Menü, Auswahl) und schaltet auf „Auswahl“, auch im Mängelplan.
- **Mängelplan Auswahlwerkzeug wie im Aufmaß:** gleicher Knopf („Auswahl“, Pfeilsymbol, Taste V), Griffe an Rechteck/Ellipse (Ecken ○, Seiten □) und Linien-Endpunkten zum Ziehen der Größe, gestrichelter Rahmen, Auswahlleiste unten (Nr., Form, Titel, Fotos, Verschieben/Größe, Fotos, Bearbeiten, Löschen), Entf löscht, Esc hebt die Auswahl auf.
- **Mängelplan Dialog:** Farbkästen 48 px (vorher ohne Stil winzig); Mangel-Fotos antippen öffnet eine Großansicht mit Zoom (Mausrad, Doppeltipp, zwei Finger), Blättern und Schließen – auch aus der Mängelliste.
- **Mängelplan scharf wie Aufmaß:** Bei PDF-Plänen bleibt die Originaldatei gespeichert; die Ansicht rendert beim Zoomen den sichtbaren Ausschnitt aus dem PDF nach (Detailebene wie im Aufmaß), der PDF-Export nimmt den Plan in hoher Auflösung aus dem Original. Grundbild 3200 px. Früher hochgeladene Pläne ohne PDF bleiben beim Grundbild (neu hochladen hilft).
- **Einteilung:** „Noch nicht eingeteilt“ ist eine kleine Zeile mit Anzahl und Tagen; antippen zeigt die Namen je Tag. **Doppelt einteilen** ist im Einteilen-Dialog als Option möglich (sonst wird umgesetzt); doppelt eingeteilte Namen sind rot mit „+ andere Baustelle“ gekennzeichnet, der Namensdialog nennt die andere Baustelle.
- **Personalliste** als eigene Seite der Arbeitereinteilung (`/arbeitereinteilung/personal`): oben Kasten „+ Neuer Mitarbeiter“ (Fenster mit Vorname, Nachname, Funktion, Qualifikation/Zusatz, Personalnummer, Telefon), darunter die Liste alphabetisch oder nach Funktion (mit Gruppen). Mitarbeiter antippen klappt auf: Funktion ändern, Bearbeiten, Urlaub, Krank, Deaktivieren, Löschen (mit Rückfrage; entfernt aus allen Wochen). Funktion und Qualifikation stehen **nie auf Ausdrucken**. Einteilung (offene Arbeiter, Auswahl), Tagesliste/Wochen-PDF und Mannschaftsvorschlag im Bericht sind nach Funktion geordnet (Projektleiter → … → Hilfsarbeiter, innerhalb alphabetisch).
- Arbeiter bekommen in der Arbeitereinteilung eine **Funktion** zur Auswahl: Projektleiter, Techniker, Bautechniker, Polier, Vorarbeiter, Facharbeiter, Hilfsarbeiter (Freitext nur noch als Zusatz/Qualifikation). Personalstand im Bautagesbericht kommt daraus aus der Einteilung und bleibt änderbar. Firmenformulare mit nur „Bauleiter“ bekommen PL + Techniker + Bautechniker, mit nur „Vorarbeiter“ Vorarbeiter + Polier.
- Zusatzangaben nur für Firmenformulare: Wegzeit je Arbeiter, Fahrtkosten, Nächtigung, Div. Kosten (Regie), Schlussabnahme (Tagesbericht).

## Ansicht der Planunterlage (31.10.2026)
- **Frage:** nur Wände oder nur Rohbau anzeigen. Ein Filter nach PDF-Ebenen, Text, Strichstärke und Farben war gebaut und wurde auf Wunsch wieder entfernt: Menü „Ansicht“ enthält nur Farbig / Schwarz-weiß (Aufmaß und Mängelplan gleich, Ansicht und PDF, je Plan gespeichert).
- **KI-Erkennung** bleibt Option für später: Kosten je Plan gering (Cent-Bereich), Genauigkeit für Maße unzureichend, Datenschutz (Pläne beim Anbieter) zu klären.
- **Handy/Tablet:** kein Knopf „Auswahl“; ein Werkzeug endet nach Gebrauch mit dem nächsten Fingerkontakt (Tipp ins Leere = Auswahl, Ziehen = Plan verschieben), Pin/Text/Bauteil sofort nach dem Setzen, Messungen nach dem Speichern.

## Firmenformulare mit eigenen Feldern (02.11.2026)
- Jede Firma richtet ihre PDF-Vorlagen selbst ein (Feldname, Typ, Hinweis, Pflicht); keine einheitlichen Formulare.
- Die bisherigen BauPad-Berichte (Regieliste, Bautagesbericht, Bauwochenbericht) bleiben; freie Firmenformulare kommen daneben.
- Vorlagenverwaltung wandert von Konto → Firmeninformationen nach Berichte & Formulare → Vorlagen (unter Konto nur ein Verweis).
- Nummerierung je Vorlage **und Projekt** (nicht firmenweit); Lücken bleiben; doppelte Nummern werden markiert, nicht automatisch geändert.
- Ausgefüllte Formulare speichern einen Schnappschuss der Felder und die Vorlagenversion; Vorlagenänderungen wirken nur auf neue Formulare.
- Eingerichtet wird die erste Seite einer PDF; Rechte über die Rollen (Admin/Büro verwalten, alle füllen aus) – kein eigenes Rechteschema je Benutzer.

## Zeitaufzeichnung (02.11.2026)
- Stunden **je Person und Tag** aus **von, bis und Pause** (Stunden werden berechnet), Wegzeit optional; der **Polier** tippt für seine Arbeiter.
- Einmal in „Tag erfassen“ eingetragene Zeiten bleiben **je Arbeiter** als Vorschlag, bis sie wieder geändert werden (Firmen-Einstellung `timeDefaults`, abgeglichen). Korrekturen im Monatszettel ändern den Vorschlag nicht.
- **Monatszettel je Person**; Vorschlag aus Arbeitereinteilung (Baustelle) und Firmen-Arbeitszeit (Stunden, über 6 h 0,5 h Pause) – gezählt wird nur Bestätigtes.
- Freigabe je Person und Monat durch Admin/Büro; danach für den Polier gesperrt, Änderungen des Büros werden mit Name und Zeit vermerkt.
- Excel für die Lohnverrechnung (Blätter Monat, Je Baustelle, Einzeln). Keine Ortung/GPS.
- Eigene Kachel, Rechte wie Arbeitereinteilung (kein neues Recht am Server nötig). Keine Verbindung zu Regieliste/Bautagesbericht.
- **Jahresdatei je Arbeiter in der Firmenvorlage** „Zeit_aufzeichnung.xlsx“ (bereinigt mit `scripts/make-time-template.py`, eingebettet in `src/lib/time-template.ts`): je Jahr eine neue Datei; alle Formeln, Farben und Pausenregeln der Vorlage bleiben, BauPad trägt nur Eingaben ein (Jahr, Name, Soll je Wochentag, österreichische Feiertage des Jahres inkl. Ostern/Pfingsten/Fronleichnam, je Tag bis zu drei Blöcke Beginn/Ende, U/K, Pause nur wenn abweichend, Baustellen und Wegzeit als Kommentar). Excel rechnet beim Öffnen neu.
- **Ergebnisse mitgespeichert:** BauPad rechnet alle Formeln der Vorlage selbst aus (`src/lib/xlsx-calc.ts`, nur die 12 Funktionen der Vorlage) und speichert die Ergebnisse wie Excel in der Datei. Sonst zeigen Excel in der geschützten Ansicht sowie Handy- und Mail-Vorschauen leere Felder. Geprüft: alle 3194 Formelwerte gleich wie die Neuberechnung (bis auf Rundungsreste, die Excel genauso speichert). Excel rechnet beim Öffnen zusätzlich neu.
- **Fortsetzung je Jahr:** Der Jänner übernimmt Resturlaub („Stand Urlaub“) und Stunden („neuer Stand“) aus dem Dezember des Vorjahres – BauPad rechnet die Vorjahre genau wie die Vorlage nach (mit LibreOffice geprüft). Ohne Vorjahr: Urlaubsanspruch 5 Wochen × Arbeitstage je Woche, 0 Stunden. Zeiten werden in voller Genauigkeit geschrieben (sonst 10:44 statt 10:45). In der Vorlage überschriebene Formeln (Soll 15.08./05.09., Pausen August, Pause 02.11.) stellt das Bereinigungsskript wieder her.
- Beim **Freigeben** wird der Monatsstand als Datei je Arbeiter gespeichert (`timeFiles`, DB v12, Abgleich über die Ablage) und ist im Monatszettel unter „Gespeichert …“ abrufbar. „Jahresdateien“ lädt alle Arbeiter als ZIP.
- „Tag erfassen“: Wochentag + Datum mit Pfeilen für Vortag/nächsten Tag; je Arbeiter Kästchen anwesend/Urlaub/Krank (schreibt in die gemeinsamen Abwesenheiten der Einteilung, Tag ohne Stunden).

## Projekt löschen im Register (02.11.2026)
- **Projektregister nur für Admin und Büro** (Kachel und Seite); alle anderen übernehmen Projekte im jeweiligen Tool über „Projekt übernehmen“.
- **Löschen gilt auf allen Geräten:** Die Projekt-ID kommt in die abgeglichene Firmen-Einstellung `deletedProjects`. Jedes Gerät räumt beim Start und nach jedem Abgleich Reste dieses Projekts weg (z. B. offline erfasste Fotos/Berichte oder noch nicht abgeglichene Wochen), statt das Projekt daraus neu anzulegen.
- „Neues Projekt“ im Register legt nur die Projektinfos an (in keinem Tool, Kennung `register` in `tools`); in Tools übernimmt man es danach im Register oder direkt im Tool.
- Admin/Büro löschen ein Projekt im Projektregister – auch wenn noch Einträge daran hängen. Der Dialog zählt auf, was mitgelöscht wird (Aufmaß-Pläne/Schadstellen, Berichte, Firmenformulare, Fotos, Mängelpläne; die Baustelle verschwindet aus den Wochen der Einteilung, sonst würde das Projekt beim Start wieder angelegt). Erfasste Stunden der Zeitaufzeichnung bleiben (Lohnverrechnung), die Baustelle steht dort nur noch als Name.

## Alles online (03.11.2026)
- Mit Firmen-Arbeitsbereich wird alles mit der Online-Ablage abgeglichen: Projekte (Projektliste/Register), Pläne, Messungen, Zeichnungen, LV, Arbeiter, Wochen, Berichte, Firmenformulare, Mängelpläne, Zeitaufzeichnung inkl. gespeicherter Monatsdateien, Fotos und die Firmen-Einstellungen – jetzt auch das **Firmenlogo** (als Base64 in `companyLogo`).
- Nur auf dem Gerät bleiben Bedien-Einstellungen (Sortierung, zuletzt gewählte Baustelle, Zoom-Ansicht, Vorschaubilder).
- Mit Online-Ablage entfallen die Hinweise „Sicherung empfohlen“; die Projektliste zeigt je Projekt „Online: gespeichert / wartet auf Upload“. Löschen in Aufmaß & Abrechnung löscht wie im Register überall.
- **Ohne Empfang:** Jede Änderung landet zuerst auf dem Gerät (Warteschlange) und wird bei Empfang automatisch hochgeladen – beim Online-Ereignis, beim Zurückkehren in die App, alle 5 Minuten und nach einem Fehlschlag (schwacher Empfang) mit Wiederholung nach 10 s, 20 s, 40 s … höchstens alle 2 Minuten (Daten und Fotos). Oben in der Leiste steht „Offline · N warten“ bzw. „N warten auf Upload“, solange etwas aussteht.

## Aufmaß: Überschrift, Planliste, Aufmaßblatt, iPad (03.11.2026)
- Überschrift im Plan-PDF: Titel Nummer Planbezeichnung Ebene (z. B. „Aufmaßplan 009 BA. 4 UG2“). Planbezeichnung und Ebene stehen standardmäßig drin (auch bei bestehenden Plänen, sofern ausgefüllt), je Plan über „Im Plan anzeigen“ abwählbar. In den Planangaben überträgt „für alle Pläne dieses Projekts übernehmen“ Titel und Anzeige auf alle Pläne.
- Planliste nach Plannummer auf- oder absteigend (auf dem Gerät gemerkt).
- Aufmaßblatt (Excel): im Dialog Pläne frei zusammenstellen, auch über Kostenstellen hinweg.
- iPad: Stift-Vorrang – sobald ein Stift benutzt wurde, zeichnet nur der Stift; Finger verschieben/zoomen; aufliegende Hand wird ignoriert, ihr Abheben löst keinen Klick aus.
- „BauPad als App installieren“ bleibt für den Betreiber (operator) auch in der installierten App sichtbar.


## Sicherung (05.11.2026)
- Laufende Daten bleiben in Supabase (kostenloser Tarif), **Sicherungen bei Hetzner** (anderer Anbieter, Deutschland): jede Nacht über die Funktion `backup` (pg_cron), 30 Sicherungen + Monatsstände für 12 Monate, Wiederherstellung je Firma. Keine Zusatzkosten. Supabase Pro (~25 $/Monat) erst mit zahlenden Kunden. Einrichtung: `docs/backup-einrichten.md` (eingerichtet und erster Lauf erfolgreich am 05.11.2026).
- Materialverwaltung: gleiche Architektur (Supabase + Hetzner), Symbol „Wagen mit Material“ (Variante N); vorher Versionsprüfung gegen stilles Überschreiben und Schutz vor Doppelten im Abgleich.

## Materialverwaltung (05.11.2026)
- Ein Tool „Materialverwaltung“ (Kachel mit Wagen-Symbol), in Etappen: 1. Materialstamm (Bezeichnung, Artikelnummer, Einheit, Preis netto, Lieferant, Kategorie, Notiz) und Lieferanten – **umgesetzt**; 2. Materiallisten je Baustelle mit Bestellmenge, Liefertermin, Status und Verlauf – **umgesetzt** (Bereich „Baustellen“, Projekte aus dem Register, nur freigegebene; gleiches noch nicht geliefertes Material → Rückfrage „dazurechnen“; Datenart `materialItems`); 3. Angebote/Lieferscheine als PDF, PDF-Export.
- Doppelte Einträge: Hinweis schon beim Tippen und Rückfrage beim Speichern (gleiche Artikelnummer beim selben Lieferanten bzw. gleicher Name mit gleicher Einheit; Schreibweise, Umlaute, „m2“/„m²“, „Stück“/„Stk“ egal). Lieferanten: gleicher Name, Rechtsform egal.
- Abgleich wie alle Tools (Datenarten `materials`, `suppliers`). Solange die Funktion `storage` nicht neu veröffentlicht ist, bleiben nur diese Datensätze in der Warteschlange – alles andere wird normal übertragen.
- Standardfreigabe: Admin, Büro und Polier; bestehende Benutzer bekommen das Tool vom Admin unter Benutzer & Rollen.

## Material: Bestand, Verbrauch und Bedarf (17.11.2026)
- **Material anlegen** zusätzlich (alles optional): Inhalt je Einheit (1 Sack = 25 kg), Einheiten je Palette (40 Sack), Verbrauch als Richtwert (z. B. 8 kg je m² – in der Einheit oder im Inhalt des Gebindes, je m², m, m³ oder Stk).
- **Je Baustelle „Bestand und Bedarf“:** je Material vorhanden (= geliefert − verbraucht), verbraucht, unterwegs (bestellt), gemeldet (offen). Beim Hinzufügen gleich den Status wählen: offen, bestellt oder schon geliefert (auf der Baustelle).
- **Verbrauch eintragen** (jeder mit Zugriff auf die Baustelle): Menge, Tag, optional „dabei geschafft“ (z. B. 40 m²) und Notiz. Ein Eintrag je Erfassung (Datenart `materialUses`), damit zwei Geräte gleichzeitig eintragen können.
- **Rechnen** je Baustelle und Material (Datenart `materialPlans`, Kennung `<Projekt>:<Material>`): Gesamtmenge der Baustelle – **automatisch aus dem Aufmaß** (Summe je Messart bzw. aller Messungen einer Einheit) oder **aus dem LV** (Menge laut LV oder gemessen je Position; wird nachgeführt, wenn sich das Aufmaß ändert) oder eingetippt – × Verbrauch je Bezugsgröße. Verbrauch **automatisch erkannt**: Durchschnitt dieser Baustelle (verbraucht ÷ geschafft), sonst Durchschnitt aller Baustellen, sonst Richtwert aus dem Material; oder ein eigener Wert.
- Ergebnis: Bedarf gesamt, noch nötig (Bedarf − verbraucht), gedeckt (vorhanden + unterwegs + gemeldet), **nachbestellen** = Differenz, auf ganze Einheiten (Maßeinheiten auf 0,1) bzw. auf Wunsch ganze Paletten aufgerundet. „Als Bedarf eintragen“ legt eine offene Position an (bzw. erhöht die offene) – bestellt wird wie bisher unter „Bestellungen“ je Lieferant.
- **Später: Benachrichtigung** an den zuständigen Projektleiter mit der Nachbestellmenge. Erkannt über die Bauleitung des Projekts (bzw. die Vertretung der Woche im Team) → Person in der Personalliste → deren BauPad-Konto (E-Mail). Noch nicht umgesetzt; Weg (E-Mail über Resend, Push in der App) offen.

## Zeitaufzeichnung: Rechte (05.11.2026)
- Eigene Freigabe „Zeitaufzeichnung“ (getrennt von der Arbeitereinteilung; ältere Freigaben „Arbeitereinteilung“ gelten weiter).
- **Admin/Büro:** alles (alle Arbeiter und Projekte, Monatszettel, Freigabe, Excel). **Polier:** nur Stunden auf seinen freigegebenen Projekten erfassen und sehen (Projekte der Freigabe „Zeitaufzeichnung“, sonst „Arbeitereinteilung“, sonst Baustellenliste; leer = alle); Zeilen anderer Projekte bleiben beim Speichern erhalten; keine Monatszettel, kein Excel. **Arbeiter:** nur die eigenen Stunden ansehen – verknüpft über „BauPad-Konto (E-Mail)“ in der Personalliste.
- Durchgesetzt auch am Server: Funktion `storage` liefert Polier/Arbeiter Zeitdaten nur gefiltert (Dienstschlüssel), die Tabelle `records` lässt Zeitdaten direkt nur für das Büro zu (`docs/supabase/time-access.sql`). Reihenfolge: erst Funktion veröffentlichen, dann SQL.

## Gerät, Sicherungen, Verträge (17.11.2026)
- **App-Sperre** (Konto → Sicherheit, je Gerät, freiwillig): PIN 4–8 Ziffern, gespeichert nur als PBKDF2-Prüfwert in localStorage; optional Face ID/Fingerabdruck über WebAuthn (Gerät prüft, Kennzeichen „Person geprüft“; im Android-WebView nicht verfügbar → nur PIN). Gesperrt beim Öffnen der App und nach 0/1/5/15 Minuten im Hintergrund („sofort“ sperrt schon beim Wechsel, damit auch das Vorschaubild nichts zeigt). Sperrbildschirm liegt über der Seite (Seite bleibt erhalten, App darunter `inert`). Ab der 5. falschen PIN warten (30 s, verdoppelt), bei der 10. Daten löschen und abmelden. Die Sperre schützt die Bedienung; die Daten im Browser-Speicher sind nicht zusätzlich verschlüsselt – dafür die Gerätesperre.
- **Gerätedaten löschen** (`device-wipe.ts`): Datenbank des Geräts entfernen, App-Einstellungen bis auf Darstellung, bei „Abmelden und Daten löschen“ auch die Anmeldung. Automatisch, wenn die online geprüfte Anmeldung (`contextLoaded`) eine andere oder keine Firma meldet als die, deren Daten auf dem Gerät liegen (`dataSyncWorkspace`) – also gesperrt, entfernt oder Firma gewechselt. Offline nie (Firma unbekannt).
- **Sicherungen**: optional (Secrets) AES-256-GCM je Datei (`BACKUP_KEY`), eigener Bucket in eigenem Hetzner-Projekt (`BACKUP_S3_*`), Object Lock je Datei bis Ende der Aufbewahrung (`BACKUP_LOCK_MODE`), Lifecycle-Regel räumt abgelaufene Versionen auf. Ungültiger Schlüssel → keine Sicherung statt einer unverschlüsselten. Alte Sicherungen im Bucket der Ablage bleiben lesbar und laufen aus. Entschlüsseln von Hand: `scripts/sicherung-entschluesseln.mjs`.
- **AVV für Kunden** als Website-Seite (`/auftragsverarbeitung`, Text `src/site/legal/avv.ts`, deutsch und verbindlich auch auf Englisch); Datenschutzerklärung ergänzt. Verträge mit Hetzner, Supabase, Resend, GitHub: `docs/datenschutz-avv.md`.

## Rechte je Projekt, Werkzeug und Preise am Server (17.11.2026)
- Bisher galten die Freigaben nur in der App; über die Datenbank kam jedes Mitglied an alle Daten der Firma. Jetzt prüft die Funktion `storage` jeden Datensatz, jedes Foto und jede Datei für Polier und Arbeiter; die Tabellen `records`/`photos` lassen sie nicht mehr direkt zu (`docs/supabase/records-access.sql`). Admin, Büro und Betreiber: unverändert alles.
- **Projekte:** nur freigegebene (gemeinsame Liste oder bei einem Werkzeug ausgewählt; die Preis-Freigabe gibt kein Projekt frei). Einträge ohne Projekt (frei eingegebene Baustelle) wie in der App: ohne Auswahl sichtbar, sonst nur ausgewählte Namen. Mängelpunkte über ihren Mängelplan. Projekte anlegen und löschen nur das Büro.
- **Firmenweite Daten:** Personalliste mit Team, Zeiten oder Berichte (Mannschaft im Tagesbericht; Arbeiter mit nur „Zeiten“ sehen nur sich selbst), Wochen-Einteilung mit Team, Zeiten, Berichte oder Fotos, Materialstamm/Lieferanten mit Material, Formularvorlagen lesen mit Berichte (ändern nur Büro). Firmen-Einstellungen (Name, Logo, gelöschte Projekte) ändert nur das Büro; Urlaub/Krank, Arbeitszeiten und Vorgaben der Zeiten auch Polier/Arbeiter mit dem Werkzeug.
- **Preise:** ohne „Preise und Summen“ kommen LV-Preise (Einheits- und Positionspreis) und Materialpreise leer; beim Speichern bleiben die gespeicherten Preise erhalten (LV weiter bearbeitbar, neue Positionen ohne Preis).
- **Abgelehnte Änderungen** (z. B. offline in einem inzwischen entzogenen Projekt): der Server schickt seinen Stand, das Gerät übernimmt ihn; die Warteschlange bleibt nicht hängen.
- **Freigaben geändert:** das Gerät gleicht Daten und Fotos einmal komplett neu ab (neu freigegebene Projekte kommen dazu, entzogene verschwinden vom Gerät). Beim ersten Start nach dieser Änderung einmal für Polier/Arbeiter, nicht für das Büro.
- Das Projektregister (frei eingegebene Baustellen → Projekte) pflegen nur noch Geräte von Admin/Büro mit bekannter Rolle – Polier-Geräte sehen nur freigegebene Projekte und würden sonst Doppel-Projekte anlegen.

## Plan zeichnen: Maßlinie und Spurlinien (05.11.2026)
- **Maßlinie wie im CAD:** Punkt A, Punkt B (beide mit Fang), dann auf den gewünschten Abstand ziehen und klicken. Gespeichert wird die Maßlinie in ihrer Lage (`shape`) und der Abstand zu den gemessenen Punkten (`offset`, m); Hilfslinien zu A und B werden am Bildschirm und im PDF gezeichnet. Das Werkzeug bleibt aktiv für die nächste Maßlinie.
- **Spurlinien (F11, Standard ein):** angefahrene Fangpunkte (End-, Mittel-, Schnittpunkte) werden gemerkt (bis zu 4, grünes +); in der Waagrechten/Senkrechten durch einen gemerkten Punkt oder den letzten Punkt erscheint eine grüne gestrichelte Linie und der Punkt rastet in der Flucht ein, an zwei Fluchten im Schnittpunkt. Nur mit eingeschaltetem Einrasten.

## Zeiten, Team, Aufmaß, Papierkorb (19.11.2026)
- **Arbeiter tragen ihre eigenen Stunden ein** („Meine Stunden“ und eigener Monatszettel), nur für sich (Konto über „BauPad-Konto (E-Mail)“ in der Personalliste), bis das Büro den Monat freigibt. Urlaub/Krank tragen weiter Polier bzw. Büro ein. Am Server geprüft (`ownTimeDayAllowed`): nur eigene Tage, nicht im freigegebenen Monat; sonst bekommt das Gerät den gespeicherten Stand zurück.
- **SV-Nummer** beim Arbeiter (10 Ziffern, gespeichert als „1234 010180“), nur Admin und Büro sehen und ändern sie; Polier/Arbeiter bekommen sie vom Server nicht, beim Speichern durch sie bleibt die gespeicherte. Steht auf keinem Ausdruck.
- **Material:** keine Meldung an den Projektleiter bei Nachbestellung (vorerst nicht).
- **Aufmaß:** Messart heißt überall „Betoninstandsetzung“ (vorher in der App „Schadstelle“; die einzelne Stelle heißt weiter Schadstelle, gespeicherte Kennung bleibt `schadstelle`). Excel-Blatt „Freie Messungen“ ohne Überschrift.
- **Papierkorb:** 15 Tage für die Benutzer, danach endgültig gelöscht (wirklich: Tombstone für Ablage und alle Geräte; mit Online-Ablage erst nach einem Abgleich, damit ein Gerät mit altem Stand nichts löscht, was woanders wiederhergestellt wurde). Später: 30 Tage beim Betreiber, Wiederherstellung danach kostenpflichtig.
- **Was in den Papierkorb kommt:** Projekte, Pläne/Aufmaß (Kostenstellen, LV/MFK, Originalpläne), Berichte und alle Unterlagen, Fotos, Mängelpläne, Material. Nicht: Lieferanten, Einteilung, Zeiten; einzelne Messungen/Punkte nur über Rückgängig. Wiederherstellen darf jeder mit Zugriff; ein Projekt in den Papierkorb legen nur Admin/Büro (am Server geprüft).
- **Papierkorb-Taste oben im Seitenkopf – nur in den Tools, nicht in der Tool-Übersicht:** ein Tool zeigt alles Gelöschte des Tools (Projekte gehören allen Tools), Projekt bzw. Baustelle nur deren Daten. Die Speicher-Taste steht in der Leiste; für eine zweite Taste ist dort am iPhone kein Platz.
- **Projekt im Papierkorb** (`deletedAt` am Projekt): in allen Tools samt seinen Daten ausgeblendet (zentral in den Listen von `db.ts`). Die Baustelle verschwindet sofort aus den Wochen der Einteilung und kommt beim Wiederherstellen nicht zurück; Stunden bleiben. Nach 15 Tagen wie früher „Projekt löschen“ (`deleteProjectEverywhere`).
- **Fotos im Papierkorb** (`trashedAt`): Bilddateien bleiben 15 Tage in der Ablage, danach werden Eintrag und Dateien gelöscht.

## Aufmaß: Länge Linie für Linie (19.11.2026)
- **Messart Länge mit „Freie Form“:** je zwei Tipps eine Linie (Anfang, Ende); die nächste Linie beginnt frei – mit Abstand oder per Fang an Ende bzw. Mitte einer schon gesetzten Linie (z. B. Risse, die nicht durchgehen). Eine Messung, Länge = Summe aller Linien. Gespeichert als offene Freihand-Form mit `breaks` (Punkt, an dem eine neue Linie beginnt); Darstellung, PDF, Antippen, Punkte verschieben/einfügen/entfernen berücksichtigen die Lücken.
- Während des Zeichnens unten statt der Leiste nur vier Tasten in dieser Reihenfolge: **X** (verwerfen), **Zurück** (letzten Punkt), **Vor** (wiederherstellen), **Häkchen** (übernehmen). Kein Doppeltippen zum Beenden (Ende und nächster Anfang liegen oft auf demselben Punkt); Enter beendet am PC.
- Andere Messarten behalten die Freie Form wie bisher (Knick an Knick, schließen = Fläche).
- **Bewehrung** (lfm) gibt es nur bei der Messart Betoninstandsetzung; bei allen anderen Messarten wird sie weder gezeigt noch gespeichert.
- **Beschreibung je Messart** („Was wird gemessen?“): Formel und typische Beispiele, z. B. Länge „Meter · Risse, Fugen, Kanten, Anschlüsse, Leitungen“ (`measure-types.ts`).
- **Untere Leiste:** Tipp ins Leere (Auswahl, neben die Messungen oder außerhalb des Plans) klappt sie zu.
- **Handy:** Hinweis „Neue Messungen: …“ (Leistung) steht unter der Ansichtsleiste statt darauf.
- **Doppeltipp auf ein Maß „aus Plan“:** die Tastatur am Handy/Tablet geht sofort auf (unsichtbares Hilfsfeld im selben Antippen, dann ins Längenfeld).

## Papierkorb: Auswählen (19.11.2026)
- In jedem Papierkorb „Auswählen“: einzelne oder alle Einträge markieren, dann **Wiederherstellen** oder **Endgültig löschen** (Rückfrage; sofort auf allen Geräten).

## Aufmaß: Bereiche, Neue Messung, Tabelle (19.11.2026)
- **Bereich** = Gruppe in der Aufmaß-Tabelle: je Position, ohne Position je Messart (Fläche, Wände, Linien, Volumen …).
- **„Neue Messung“** (Messleiste oben bzw. Hinweis „Neue Messungen: …“ antippen): Position wählen → Messart stellt sich aus der Einheit ein (m² Fläche, m/lfm Länge, m³ Volumen, Stk Stück, sonst Frei; Positionen mit Betoninstandsetzungs-Regel → Betoninstandsetzung), alle neuen Messungen zählen dort. „Frei – ohne Position“ öffnet die Messarten. Ohne LV gleich die Messarten. Das Messfenster bleibt wie gewohnt (vorbelegt).
- **Tabelle:** Gruppen (Messart und Position) wie in der Einteilung auf-/zuklappbar (Winkel › / ⌄, auf dem Gerät gemerkt); die Summe steht oben im Balken – zu und offen.
- „Auswählen“ steht oben neben dem Titel der Messleiste.
- Speicher-Taste: „Online gespeichert“ statt „Gespeichert“. Papierkorb nur in den Tools, nicht in der Tool-Übersicht.
- **Planliste im Projekt:** Spalte „Menge“ je vorkommender Einheit untereinander (m², m, m³, Stk …) statt immer m²; Leistungen höchstens zwei, dann „+n weitere“. Aufmaß-Karten ebenso (z. B. „114 Messungen · 556,70 m“).

## Papierkorb in Berichte, Mängel, Material (19.11.2026)
- Berichte, Firmenformulare, Mängelpläne, Material (Materialstamm, Geräte) und Positionen der Materialliste kommen beim Löschen 15 Tage in den Papierkorb (`trashedAt`), danach endgültig gelöscht. Verbrauchseinträge, Mängelpunkte und Lieferanten wie bisher direkt.
- Papierkorb-Taste oben in Berichte, Mängel und Material sowie im jeweiligen Projekt bzw. auf der Baustelle.

## Vier Tasten beim Zeichnen (19.11.2026)
- **Tasten-Design:** noch offen – Entwürfe als Vorschau (Glas G1–G5, Liquid L1–L3, Wunsch M1/M2: hell Rauchglas durchsichtiger, dunkel weiße Tasten). Abschalten später über „Transparenz reduzieren“ (Konto → Darstellung).
- **Vier Tasten X · Zurück · Vor · Häkchen** im Aufmaß für alle Mehrpunkt-Tools (Freie Form, Vieleck, Wand, Stück-Punkte) und für Freihand – statt „Offen beenden“, „Schließen (Fläche)“, „Fertig“. Kein Tipp mehr als vorher; offen oder geschlossen ergibt sich aus der Messart. Stück zeigt die laufende Anzahl neben dem Häkchen.
- **Freihand im Aufmaß:** Striche sind ein Entwurf (Zurück/Vor je Strich), das Häkchen übernimmt. Bei Länge zählen mehrere Striche als eine Messung (Lücken dazwischen), bei Flächen gilt der letzte Strich.
- Ein-Zug-Tools (Rechteck, Kreis, Linie) bleiben ohne Häkchen (sonst +1 Tipp je Messung).

## Planbibliothek nur mit Plänen (19.11.2026)
- Die Planbibliothek zeigt nur die Originalpläne – je Seite eine große Vorschau mit „Neues Aufmaß“. Keine Angabe mehr, in welchen Aufmaßen ein Plan verwendet wird (Suche findet ihn trotzdem auch über Plannummer/Bezeichnung).
- „Neues Aufmaß“ übernimmt Kalibrierung, Papierformat und Nummernvorschlag vom ältesten Aufmaß mit der ganzen, ungedrehten Seite. Einen Planbereich (Ausschnitt) erneut verwenden geht weiter über das Aktionsmenü des Aufmaßes („Neues Aufmaß mit diesem Plan“).
- „Plan ansehen“ nutzt die Planansicht des Aufmaßes: mit zwei Fingern bzw. Mausrad zoomen, beim Hineinzoomen scharf in voller Auflösung, Originalfarben; + / Ganzer Plan / − oben.

## Eine Suche für Leistungspositionen, deutliche × (19.11.2026)
- Messfenster: Die Leistungsposition wird nur noch im Fenster „Leistungsposition wählen“ gesucht (Antippen des Feldes). Die zweite Suchleiste darunter ist entfernt.
- × (Schließen, Entfernen) überall größer und kräftiger; im Fensterkopf und bei Entfernen-Tasten mit runder, grauer Fläche. Foto-× auf Vorschaubildern 28 px.

## Schmale Messleiste (19.11.2026)
- Messart-Balken: Name und Anzahl untereinander, Summe rechts; reicht der Platz nicht, rutscht die Summe in die nächste Zeile – nichts überlappt.
- Kopf der Messleiste immer: Titel und Summe über die ganze Breite, darunter „Neue Messung“ und „Auswählen“ nebeneinander (schmaler als 400 px: beide gleich breit, ohne Symbol). Summe ohne „0,00 m²“, wenn nur Längen gemessen sind.
- Die Spalten-Tabelle braucht rund 430 px; schmaler lässt sie sich seitlich wischen statt abgeschnitten zu werden.
- Die einfache Liste (T1, eine Zeile je Messung ohne Spalten) war kurz online und ist auf Danieles Wunsch zurückgenommen: Die Spalten-Tabelle bleibt (Kopfzeile, Stift, Mülleimer, Summen unten).
- Summe Fläche (unten und im Kopf) ohne die Grundfläche von Volumen-Messungen – die zählen als m³ (vorher z. B. 104,05 statt 95,70 m²). Im Kopf steht jetzt auch m³.
