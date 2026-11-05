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
- Ein Tool „Materialverwaltung“ (Kachel mit Wagen-Symbol), in Etappen: 1. Materialstamm (Bezeichnung, Artikelnummer, Einheit, Preis netto, Lieferant, Kategorie, Notiz) und Lieferanten – **umgesetzt**; 2. Materiallisten je Baustelle mit Bestellmenge, Liefertermin, Status und Verlauf; 3. Angebote/Lieferscheine als PDF, PDF-Export.
- Doppelte Einträge: Hinweis schon beim Tippen und Rückfrage beim Speichern (gleiche Artikelnummer beim selben Lieferanten bzw. gleicher Name mit gleicher Einheit; Schreibweise, Umlaute, „m2“/„m²“, „Stück“/„Stk“ egal). Lieferanten: gleicher Name, Rechtsform egal.
- Abgleich wie alle Tools (Datenarten `materials`, `suppliers`). Solange die Funktion `storage` nicht neu veröffentlicht ist, bleiben nur diese Datensätze in der Warteschlange – alles andere wird normal übertragen.
- Standardfreigabe: Admin, Büro und Polier; bestehende Benutzer bekommen das Tool vom Admin unter Benutzer & Rollen.
