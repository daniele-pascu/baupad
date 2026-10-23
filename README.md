# Schadstellen-Aufmaß

Web-App zur digitalen Erfassung, Vermessung, Nummerierung und Dokumentation von Schadstellen bei der
Betoninstandsetzung. Läuft im Browser auf iPhone, iPad, PC und Laptop – auch ohne Internetverbindung.

## Funktionsumfang (Version 1)

| Bereich | Umgesetzt |
|---|---|
| Projekte | Anlegen (Projektname, Baustelle, Adresse, Auftraggeber, Bearbeiter, Datum, Bemerkungen), öffnen, umbenennen, bearbeiten, löschen mit Sicherheitsabfrage, Datum der letzten Bearbeitung |
| Kostenstellen | Anlegen, umbenennen, öffnen, löschen; je Kostenstelle beliebig viele Pläne |
| Planimport | PDF, JPG, PNG; auf iPhone/iPad aus „Dateien“ oder der Fotomediathek; EXIF-Ausrichtung von Fotos wird berücksichtigt |
| Mehrseitige PDFs | Seitenvorschau, Auswahl einzelner Seiten; jede Seite wird ein eigener Plan mit Verweis auf Originaldatei und Originalseite |
| Layoutbereiche | Automatische Erkennung mehrerer Planfelder auf einer Seite als **Vorschlag**, der bestätigt, angepasst oder verworfen werden muss; manuelles Aufziehen; ganze Seite bleibt immer verwendbar; Ausschnitt nachträglich änderbar |
| Planbeschreibung | Plannummer (Pflicht, im Projekt eindeutig), Planname, Geschoss, Planbereich, Beschreibung – jederzeit änderbar |
| Planansicht | Zoom über +/−, Mausrad und zwei Finger; Verschieben; Doppeltipp-Zoom; „Gesamten Plan anzeigen“; „Vorherige Ansicht“; Wechsel zwischen Plänen; scharfe Darstellung auch bei starkem Zoom (Detail-Nachrendern) |
| Markierungen | Kreis, Rechteck, Freihand; 6 Farben; verschieben, Größe ändern (Anfasser), Form/Farbe ändern, löschen; Antippen erzeugt Markierung in Standardgröße |
| Nummerierung | Automatisch je Plan ab 0 (Startnummer je Plan einstellbar); Nummer änderbar; doppelte Nummern werden verhindert – Auswahl „Nummern tauschen“ oder „ab Nr. X alle um 1 erhöhen“; Löschen nummeriert nichts unbemerkt um; optional „Lückenlos neu nummerieren“ mit Rückfrage |
| Beschriftung | Nummer neben der Markierung, ca. 11 px, passt sich leicht dem Zoom an, weicht Überlappungen aus, separat verschiebbar (mit Verbindungslinie) |
| Maßeingabe | Öffnet automatisch nach dem Einzeichnen; Zahlentastatur (`inputmode="decimal"`); Komma oder Punkt; Enter/Weiter springt zum nächsten Feld; Prüfung auf positive Zahlen; Abbrechen verwirft die neue Markierung |
| Fläche | `Fläche (m²) = Länge × Breite`, sofort aktualisiert; Tiefe wird dokumentiert, aber nicht eingerechnet; intern ungerundet gespeichert, Anzeige mit 2 Nachkommastellen |
| Aufmaß-Tabelle | Je Plan und je Kostenstelle; sortiert nach Plannummer und Schadstellennummer; Zeile antippen → Schadstelle wird im Plan gezeigt; Bearbeiten/Löschen aus der Tabelle; Summenzeile |
| Excel-Export | XLSX je Plan, Kostenstelle oder Gesamtprojekt (ein Blatt je Kostenstelle); Spalten A–F exakt wie gefordert; echte Zahlen mit Zahlenformat; Summenformel; Blatt „Projektdaten“ mit Zuordnung Kostenstelle ↔ Plan ↔ Originalseite |
| PDF-Export | Einzelner Plan oder Auswahl mehrerer Pläne; Originalinhalt bleibt vektoriell erhalten; Markierungen, Nummern, Farben, Plannummer und Planbezeichnung (Kopfstreifen, verdeckt keinen Planinhalt); gedrehte PDF-Seiten und Planausschnitte werden korrekt behandelt; Originaldatei bleibt unverändert |
| Speichern | Automatisch nach jeder Änderung, sichtbarer Status („Änderungen werden gespeichert …“, „Gespeichert“, „Speichern fehlgeschlagen“), Warnung beim Schließen mit ungespeicherten Änderungen, zuletzt verwendete Planansicht wird gemerkt |
| Sicherung | Gesamtes Projekt inkl. Originaldateien als ZIP exportieren und auf demselben oder einem anderen Gerät importieren; bei bereits vorhandenem Projekt Wahl zwischen „Ersetzen“ und „Als Kopie importieren“ |
| Offline | Service Worker hält die gesamte App inkl. PDF-Engine, Schriften und Decoder vor; alle Daten liegen lokal in IndexedDB |
| Konflikte | Jeder Datensatz hat eine Revision; Änderungen aus einem anderen Tab/Fenster werden erkannt und **nicht** überschrieben (Hinweis + „Neu laden“) |

Bewusst noch **nicht** enthalten (Phase 5 / spätere Erweiterungen): Synchronisierung zwischen Geräten,
Benutzerkonten/Cloud-Speicher, Polygon-Werkzeug, Volumenberechnung (m³), Legende/Tabelle als
zusätzliche PDF-Seite.

## Starten und bauen

Voraussetzung: Node.js ≥ 20.

```bash
npm install
npm run dev        # Entwicklungsserver (ohne Service Worker)
npm run build      # Produktionsversion nach dist/
npm run preview    # Produktionsversion lokal unter http://localhost:4173 testen
```

## Veröffentlichen (Hosting)

`dist/` enthält eine rein statische Website. Sie kann auf jedem Webspace mit **HTTPS** liegen
(z. B. GitHub Pages, Netlify, Cloudflare Pages oder dem eigenen Firmen-Webserver), auch in einem
Unterordner. HTTPS ist Pflicht, damit Offline-Betrieb und Speicherung funktionieren. Ein Server-Backend
ist nicht nötig – Pläne und Aufmaßdaten verlassen das Gerät nicht.

**iPhone/iPad:** Seite in Safari öffnen → „Teilen“ → „Zum Home-Bildschirm“. Danach startet die App
wie eine normale App und funktioniert offline. Ohne diesen Schritt kann Safari die Daten von Websites,
die mehrere Wochen nicht genutzt wurden, löschen. Projekte daher zusätzlich regelmäßig über
„Sichern“ als Datei ablegen.

## Bedienung in Kürze

1. **Neues Projekt** anlegen → **Neue Kostenstelle** (z. B. „Tiefgarage“).
2. In der Kostenstelle **Plan importieren** → bei mehrseitigen PDFs Seiten wählen → optional
   **Bereiche …** (automatische Erkennung oder selbst aufziehen) → Plannummer und Angaben eintragen.
3. Plan öffnen, Werkzeug (Kreis, Rechteck, Freihand) und Farbe wählen, Schadstelle aufziehen oder
   antippen → Länge, Breite, Tiefe eingeben → Speichern. Die Fläche wird automatisch berechnet.
4. **Auswahl**-Werkzeug: Markierung antippen zum Auswählen, ausgewählte Markierung ziehen zum
   Verschieben, Anfasser ziehen zum Ändern der Größe, Nummer ziehen zum Verschieben der Beschriftung.
5. Export über **Excel** / **PDF** im Plan, in der Kostenstelle oder im Projekt.

Tastenkürzel am PC: `V` Auswahl, `K` Kreis, `R` Rechteck, `F` Freihand, `+`/`−` Zoom, `0` ganzer
Plan, `Enter` ausgewählte Schadstelle bearbeiten, `Entf` löschen, `Esc` Auswahl aufheben.

## Tests

```bash
npm test                          # Unit-Tests (Zahleneingabe, Fläche, Nummerierung, Geometrie, Export-Hilfen)
npm run build && npm run test:e2e # Ende-zu-Ende-Tests im Browser
```

Die Ende-zu-Ende-Tests (Playwright) decken die geforderten Abläufe ab:

| Nr. | Ablauf | Test |
|---|---|---|
| 1 | Projekt erstellen und wieder öffnen | `main.spec.ts` |
| 2 | Kostenstelle erstellen | `main.spec.ts` |
| 3/4 | Mehrseitiges PDF importieren, Seiten und Layoutbereiche auswählen | `main.spec.ts` |
| 5–7 | Einzeichnen, automatische Nummerierung, Maße, Flächenberechnung, ungültige Eingaben | `main.spec.ts` |
| 8/9 | Bearbeiten, Nummer tauschen/verschieben, Löschen, Tabelle ↔ Plan synchron, Positionstreue bei Zoom | `main.spec.ts` |
| 10 | Excel-Export (Werte, Datentyp, Zahlenformat, Summenformel; Öffnen mit LibreOffice) | `main.spec.ts` |
| 11 | PDF-Export (inkl. gedrehter Seite und Planausschnitt) | `main.spec.ts` |
| 12 | Neu laden, Sichern, Löschen, Wiederherstellen, erneuter Import (Konflikt) | `main.spec.ts` |
| 13 | iPhone- und iPad-Bedienung (Touch, Pinch-Zoom, Bottom-Sheet, Querformat) | `mobile.spec.ts` |
| 14 | Offline: Laden, PDF-Import, Einzeichnen, Excel- und PDF-Export ohne Netz; Fehlerfälle | `offline.spec.ts`, `main.spec.ts` |

Hinweis: iPhone und iPad werden in Chromium mit Touch-Emulation getestet. Ein abschließender Test auf
echten Geräten (Safari/WebKit) ist vor dem produktiven Einsatz empfehlenswert.

Testdateien werden mit `node tests/fixtures/make-fixtures.mjs` erzeugt.

## Technik

- React + TypeScript, gebaut mit Vite; PWA mit Service Worker (`vite-plugin-pwa`)
- PDF-Darstellung: pdf.js (Legacy-Build für ältere iPads/iPhones); Worker, Schriften, CMaps und
  WASM-Decoder werden mitgeliefert (`scripts/copy-pdfjs-assets.mjs`)
- PDF-Export: pdf-lib; Excel-Export: eigener, abhängigkeitsfreier XLSX-Schreiber (`src/lib/xlsx.ts`)
- Speicherung: IndexedDB (`src/lib/db.ts`), zentrale Zustandsverwaltung mit Autospeichern (`src/lib/store.ts`)

### Koordinaten

Markierungen werden in **Seitenkoordinaten** gespeichert, nie in Bildschirmpixeln: bei PDFs in
PDF-Punkten der angezeigten (ggf. gedrehten) Seite, bei Bildern in Bildpixeln. Ein Planausschnitt
(Layoutbereich) verändert die Koordinaten nicht – Markierungen bleiben auch bei geändertem Ausschnitt
an ihrer Stelle.

### Datenmodell und Vorbereitung der Synchronisierung

`Project` → `CostCenter` → `Plan` (verweist auf `SourceFile` + Seitenindex + optionaler Ausschnitt)
→ `Damage`. Jeder Datensatz trägt `id` (UUID), `createdAt`, `updatedAt`, `rev` (Revision),
`deviceId` (Gerät der letzten Änderung) und `deletedAt` (Grabstein statt hartem Löschen). Damit lässt
sich ein späterer Server-Abgleich ergänzen: Änderungen sind je Datensatz und Gerät nachvollziehbar,
Löschungen werden übertragen, und gleichzeitige Änderungen desselben Datensatzes werden über die
Revision als Konflikt erkannt statt still überschrieben. Originaldateien liegen getrennt
(`blobs`) und müssen nur einmal übertragen werden.

Bei einer späteren Cloud-Lösung sind wegen vertraulicher Baupläne verschlüsselte Übertragung,
Zugriffsschutz je Projekt und ein Speicherort gemäß DSGVO vorzusehen.
