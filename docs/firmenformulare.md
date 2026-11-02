# Eigene Firmenformulare

Jede Firma kann ihre eigenen Formulare als PDF hinterlegen – unter **Berichte & Formulare → Vorlagen**.
Zwei Arten:

1. **Firmenformulare mit eigenen Feldern** (`src/lib/forms.ts`): Die Firma legt selbst fest, wie jeder Kasten
   heißt, welcher Typ hineingehört (einzeilig, mehrzeilig, Datum, Kalenderwoche, Zahl, Betrag, Mitarbeiter,
   Baustelle/Projekt, eigene Firma, Auswahl, Kontrollkästchen, laufende Nummer), was einzutragen ist (Hinweis)
   und ob das Feld Pflicht ist. Diese Vorlagen werden im Projekt digital ausgefüllt (Regielisten, Stundenzettel,
   Materiallisten, Leistungsnachweise …).
2. **Firmenformulare für BauPad-Berichte** (Abschnitt weiter unten): Regieliste/Bautagesbericht der Firma werden
   automatisch aus den BauPad-Berichten befüllt.

## Firmenformulare mit eigenen Feldern

- **Anlegen:** Vorlagen → „Neues Formular hinzufügen“ → PDF wählen → Name → „Eigene Felder einrichten“ (Admin/Büro).
  Auf Wunsch schlägt BauPad Felder aus Beschriftungen und Linien der PDF vor (`fieldsFromDetection`).
- **Editor** (`FormTemplateEditorPage`): PDF als Bild, darauf die Kästen. „Feld zeichnen“ (ziehen), verschieben,
  an der Ecke vergrößern; Seitenleiste: Name, Typ, Hinweis, Pflicht, bei mehrzeilig Zeilen und Schriftgröße
  (Standard: Zeilen aus Kastenhöhe und 9 pt), bei Auswahl die Möglichkeiten, bei Projekt die Angabe (Name,
  Nummer, Adresse, Auftraggeber, Kostenstelle). „Beispiel“ zeigt, wie gefüllte Felder aussehen. Speichern
  erhöht die **Vorlagenversion**. Eingerichtet wird die erste Seite.
- **Vorlage bearbeiten (neues PDF):** neue Datei mit neuer Datei-ID; Felder bleiben; vorhandene Formulare
  behalten die alte Datei. Umbenennen, Kopieren, Löschen (mit Rückfrage; ausgefüllte Formulare bleiben).
- **Ausfüllen** (`FormEntryPage`): im Projekt „Neu“ → Vorlage → Datum. Eingabemaske nur mit den eingerichteten
  Feldern in Leserichtung (Hinweis, Pflichtstern), rechts die Vorlage mit den Werten als Kontrolle.
  Mehrzeilig: „Zeile x von y“, Enter = neue Zeile, Warnung bei Überlauf; PDF erst, wenn Pflichtfelder gefüllt
  sind und nichts überläuft. Jede Änderung wird gespeichert.
- **Datenübernahme** (`src/lib/forms-data.ts`): Projektfelder aus dem Register, Datum → ISO-Kalenderwoche
  (Jahreswechsel korrekt), Mitarbeiter laut Arbeitereinteilung des Tages (änderbar, Vorschlag-Knopf und
  Auswahl aus der Arbeiterliste), Firmenname, laufende Nummer. Fehlt eine Angabe, bleibt das Feld leer.
- **Nummerierung:** je Vorlage und Projekt (höchste + 1, Lücken bleiben, Nummer änderbar); doppelte Nummern
  nach einem Abgleich werden in der Liste markiert.
- **Speicherung:** `formEntries` (DB v10, Abgleich über die zentrale Ablage) mit Schnappschuss der Felder,
  Vorlagenversion und Datei-ID – spätere Änderungen an der Vorlage verändern vorhandene Formulare nicht.
- **Rechte:** Vorlagen anlegen/bearbeiten/löschen: Admin und Büro; ausfüllen: alle mit Zugang zum Werkzeug.
- **PDF** (`src/lib/forms-pdf.ts`, pdf-lib): Werte an den eingerichteten Stellen ins Original-PDF; einzeilig
  mit passender Schriftgröße, mehrzeilig auf die Zeilen des Kastens, Kontrollkästchen als „X“.

# Firmenformulare für BauPad-Berichte (Regieliste, Bautagesbericht)

BauPad erkennt die Felder, der Admin prüft die Zuordnung einmal, danach füllt BauPad bei jedem Export das
Original-PDF der Firma aus (Logo, Layout und Linien bleiben exakt wie im Original).

## Bedienung
1. Berichte & Formulare → **Vorlagen** → „Neues Formular hinzufügen“ → „Für einen BauPad-Bericht“ (Admin/Büro).
   Geeignet sind PDFs aus Word/Excel mit Text; reine Scans haben keinen Text und werden abgewiesen.
2. **Prüfen:** Vorschau mit den erkannten Feldern (rot = zugeordnet, orange gestrichelt = ohne Zuordnung,
   blau = weitere Schreibzeilen, grün = Tabellenzellen). Feld antippen → „Wert aus BauPad“ ändern, verschieben,
   Breite/Höhe anpassen, entfernen; „Feld hinzufügen“ → auf die Stelle im Formular tippen. Berichtstyp und
   Bezeichnung oben rechts. Speichern.
3. **Export:** Im Bericht → ⋮ → „Firmenformular: <Name>“ → Vorschau wie beim normalen PDF (Teilen, Speichern).

## Erkennung (src/lib/form-template.ts)
- Eingabe: Textpositionen und Linien der PDF-Seite (pdf.js, `readFormPage`), als JSON testbar
  (`tests/fixtures/forms/*.json`, erzeugt mit `node --experimental-transform-types tests/fixtures/forms/make-form-fixtures.mjs`).
- Beschriftungen → Werte über Synonymliste (`LABEL_RULES`): Bauvorhaben, Auftraggeber, Auftrags-Nr., Kst.,
  Datum/„am“, Kal.-Woche, Nr., Arbeitszeit von/bis, Personalstand je Funktion, Leistungsbeschreibung,
  Besondere Vorkommnisse, Vorbemerkungen/Bemerkungen, Material, Geräte, Fahrtkosten, Nächtigung, Div. Kosten,
  Schlussabnahme. Firmenanschrift, Unterschriftszeilen und Titel werden ignoriert.
- Schreibbereich je Beschriftung: Schreiblinie rechts daneben (gepunktet/durchgezogen), sonst die Zelle
  (Linien links/rechts/oben/unten): Beschriftung oben in der Zelle → Wert darunter, sonst rechts daneben.
  Mehrzeilige Felder: weitere gleich breite Schreiblinien bis zur nächsten Beschriftung; Kästen ohne Linien
  werden in Zeilen geteilt. „am ……… 2026“: Jahr steht schon da → Datum nur Tag.Monat.
- Arbeitertabelle: Zeilenlinien unter dem Kopf („Name des Arbeiters“ + gedrehte Spaltenköpfe), Spalten aus
  senkrechten Linien; Wochenblatt, wenn Montag–Sonntag als Köpfe stehen (Spalten je Tag: Normalstunden,
  50 %, 100 %, Wegzeit); sonst Tagesformular (Name, Qualifikation, von, bis, Pause, Std., 50 %, 100 %, Wegzeit).

## Ausfüllen (src/lib/form-fill.ts, pdf-lib)
- Einzeilig: Schrift wird verkleinert, bis der Text passt (mind. 5,5 pt). Mehrzeilig: Umbruch über die
  Schreiblinien, bei Platzmangel kleinere Schrift, am Ende „…“.
- Bautagesbericht: Kopf, Arbeitszeit, Wetter, Personalstand (gesamt und je Funktion: Projektleiter, Techniker, Bautechniker, Polier, Vorarbeiter, Facharbeiter, Hilfsarbeiter; ein Feld „Bauleiter“ bekommt PL + Techniker + Bautechniker, ein Feld „Vorarbeiter“ ohne eigenes Polier-Feld auch die Poliere),
  Leistungen, Vorkommnisse, Bemerkungen, Material, Geräte, Schlussabnahme; Tabelle = anwesende Arbeiter.
- Regieliste als **Wochenblatt**: alle Regielisten des Projekts aus der Kalenderwoche des Berichts kommen auf
  ein Blatt – eine Zeile je Arbeiter, Stunden/50 %/100 %/Wegzeit in der Spalte des Wochentags (das Datum
  der Regieliste bestimmt den Wochentag). Nummern, Material, Kosten werden zusammengefasst.
- Regieliste als Tagesformular: eine Zeile je Arbeiter mit Zeiten und Stunden.
- Im Berichte-Tool: Sobald ein Firmenformular für den Berichtstyp hinterlegt ist, gibt der Knopf „PDF“ (und Drucken)
  direkt das ausgefüllte Firmenformular aus; das BauPad-Layout bleibt im Menü „⋮ → PDF im BauPad-Layout“.
  Die Übersicht zeigt die hinterlegten Formulare mit Link zu Konto → Firmeninformationen.
- Personalstand im Bautagesbericht wird beim Übernehmen der Mannschaft aus der Arbeitereinteilung nach
  Funktion vorbelegt (Arbeiterliste → „Funktion“; ohne Auswahl wird sie aus dem Zusatztext erraten:
  Polier, Vorarbeiter, Bauleiter → Projektleiter, Hilfsarbeiter/Lehrling → Hilfsarbeiter, sonst Facharbeiter)
  und bleibt von Hand änderbar.

## Speicherung
Vorlage (`formTemplates`) und Original-PDF (`formTemplateFiles`) in der Browser-Datenbank (Version 9), je Gerät.
Mit dem Datenabgleich wandern sie in die zentrale Ablage der Firma (nächster Schritt).

## Getestet mit
MST Muhr: Bau-Tagesbericht (A4 hoch, Schreiblinien) und Regieliste (A4 quer, Wochenblatt 10 Zeilen × 7 Tage × 4).
