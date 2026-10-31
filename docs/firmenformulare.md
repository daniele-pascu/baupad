# Eigene Firmenformulare (Regieliste, Bautagesbericht)

Jede Firma kann ihre eigenen Formulare als PDF hinterlegen. BauPad erkennt die Felder, der Admin prüft die
Zuordnung einmal, danach füllt BauPad bei jedem Export das Original-PDF der Firma aus (Logo, Layout und
Linien bleiben exakt wie im Original).

## Bedienung
1. Konto → Firmeninformationen → **Eigene Formulare** → „Formular hochladen (PDF)“ (Admin/Büro).
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
  Datum/„am“, Kal.-Woche, Nr., Arbeitszeit von/bis, Personalstand je Einstufung, Leistungsbeschreibung,
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
- Bautagesbericht: Kopf, Arbeitszeit, Wetter, Personalstand (gesamt und je Einstufung BL/VA/FA/HA/Lehrling),
  Leistungen, Vorkommnisse, Bemerkungen, Material, Geräte, Schlussabnahme; Tabelle = anwesende Arbeiter.
- Regieliste als **Wochenblatt**: alle Regielisten des Projekts aus der Kalenderwoche des Berichts kommen auf
  ein Blatt – eine Zeile je Arbeiter, Stunden/50 %/100 %/Wegzeit in der Spalte des Wochentags (das Datum
  der Regieliste bestimmt den Wochentag). Nummern, Material, Kosten werden zusammengefasst.
- Regieliste als Tagesformular: eine Zeile je Arbeiter mit Zeiten und Stunden.
- Personalstand im Bautagesbericht wird beim Übernehmen der Mannschaft aus der Arbeitereinteilung nach
  Einstufung vorbelegt (Arbeiterliste → „Einstufung“; ohne Angabe wird sie aus der Tätigkeit erraten:
  Polier → Vorarbeiter, Hilfsarbeiter, Lehrling, sonst Facharbeiter) und bleibt von Hand änderbar.

## Speicherung
Vorlage (`formTemplates`) und Original-PDF (`formTemplateFiles`) in der Browser-Datenbank (Version 9), je Gerät.
Mit dem Datenabgleich wandern sie in die zentrale Ablage der Firma (nächster Schritt).

## Getestet mit
MST Muhr: Bau-Tagesbericht (A4 hoch, Schreiblinien) und Regieliste (A4 quer, Wochenblatt 10 Zeilen × 7 Tage × 4).
