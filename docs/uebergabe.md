# Übergabe für die nächste Sitzung (Stand 19.11.2026)

Kurz und knapp, damit eine neue Claude-Sitzung ohne den alten Gesprächsverlauf weitermachen kann.
Grundregeln stehen in `CLAUDE.md`, Grundsätze in `docs/entscheidungen.md`.

## Arbeitsweise mit Daniele
- **Alles direkt online stellen:** nach den Tests einen Pull Request auf `main` und squash-mergen. Reine Design-Entwürfe nur als
  Vorschau (Artifact), nicht online.
- **Tests vor dem Online-Stellen:** Website-Änderung → Website-Tests und Website-Teil des Tasten-Tests (4 Geräte);
  App-Änderung → kompletter Tasten-Test und die betroffenen Tests. `CHROMIUM_PATH=/opt/pw-browsers/chromium`, vorher `npx vite build`.
- Neue Fenster/Seiten in `tests/e2e/tasten-shared.ts` ergänzen.
- **Antworten kurz und stichpunktartig**, nicht zu viel Text. Texte auf der Website ebenfalls kurz und knapp.
- **Nur behaupten, was die App wirklich kann** (Texte vorher im Code prüfen).
- Überall **„Tool“**, nicht „Werkzeug“.
- Perfektionist: auf Abstände, Kanten, Farben achten; Screenshots auf PC, iPhone, iPad prüfen und zeigen.
- **Als strategischer Berater arbeiten** (Danieles Wunsch): Ideen kritisch prüfen statt zustimmen – Schwachstellen,
  Annahmen, Alternativen nennen. Bei großen oder unklaren Vorhaben zuerst die 3 wichtigsten Fragen stellen, vom Ziel
  rückwärts planen. Fakten, Annahmen und Empfehlungen trennen; nichts erfinden. Bestehende Architektur nutzen,
  keine unnötige Komplexität oder Kosten. Bei PAD Software Marke und Erweiterbarkeit mitdenken.
- **Funktion `storage` veröffentlicht Daniele von Hand** (Supabase → Edge Functions); nach jeder Änderung daran im
  Abschluss deutlich sagen und in `docs/ablage-einrichten.md` eintragen.

## Marke und Design (Stand)
- **PAD Software ist nicht Bau** – Bau nur bei BauPad. PAD = Initialen Pascu Andrea Daniele; „Problem. Analysis. Development.“ ist nur das Motto.
- **Logo:** Variante 1 (untere Rundung tiefer), überall eingebaut; `docs/logo/README.md`.
- **Website:** Startseite oben schwarzer Kopf (Licht Violett #6c5cff + Petrol #1fd1b5, Glas-PAD-Zeichen mit Animation),
  darunter hell (#f4f4f6). Alle Unterseiten hell. Leiste: über Schwarz weißes Glas, über Hell sattes Schwarz, blass beim Scrollen.
- Tasten: weiß → beim Antippen schwarz mit weißem Rand; schwarz → beim Antippen weiß mit schwarzem Rand.
- **BauPad-Seite:** groß Logo und Name, sieben Tools als farbige Fenster; Tipp öffnet ein Fenster mit Stichpunkten
  (Texte in `src/site/i18n/de.ts` → `baupad.details`), Projektregister, „Immer gesichert.“, vier Rollen. Bilder kommen später dazu.
- **App:** Leiste oben nur „Tools“ und Konto; größere Tool-Kacheln; Aufmaß-Plan mit Glas-Leisten (Einstellung
  „Transparenz reduzieren“ unter Konto → Darstellung), Ansichtsleiste zuklappbar (Regler-Symbol), Papierkorb (30 Tage),
  eigene Taste „Fotos exportieren“, Planbibliothek mit „Plan ansehen“.

## Erledigt am 19.11.2026 (Antworten von Daniele, Details in `docs/entscheidungen.md`)
- Arbeiter tragen eigene Stunden ein; SV-Nummer (nur Admin/Büro); Messart „Betoninstandsetzung“; Excel „Freie Messungen“
  ohne Überschrift; Papierkorb 15 Tage. Material-Meldung an den Projektleiter: vorerst nicht.

- Speicher-Taste oben in der Leiste (Gespeichert / Lokal gesichert / Speichert …), `src/components/SaveButton.tsx`.
- Papierkorb (15 Tage, danach wirklich gelöscht) für Projekte, Aufmaß und Fotos; Taste oben im Seitenkopf
  (`src/components/TrashButton.tsx`, Modell `src/lib/trash-items.ts`, Aufräumen `src/lib/trash-purge.ts`).

## Offen / wartet auf Daniele
- **Marke BauPad anmelden** (Empfehlung an Daniele, seine Sache). Website-Texte sind umgestellt: nur Nutzen, kein „Wie“.
- **Tasten-Design:** Vorschau M1 (hell Rauchglas 42 %) / M2 (dunkel weiße Tasten) – Daniele will noch warten, nicht einbauen.
- Rote Tests behoben (19.11.2026): Fläche aus dem Plan rundet trotz PDF-Rauschen richtig (116,66 m²), messungen „Rückgängig … Verschieben“ und Datenbank-Version.

## Danieles Schritt
- Funktion `storage` in Supabase neu veröffentlichen (siehe `docs/ablage-einrichten.md`).
- Später (Daniele, 19.11.2026): Betreiber-Papierkorb 30 Tage – Server hält Gelöschtes (Daten und Dateien) 30 Tage, der Betreiber stellt es **nur auf Anfrage des Kunden** wieder her (kostenpflichtig, **Pauschale** je Wiederherstellung – Höhe legt Daniele später fest). Vorher Datenschutzerklärung und AVV ergänzen (Betreiber-Zugriff, 30 Tage Aufbewahrung).

## Vorgemerkt (später)
- App nur mit BauPad-Anmeldung (`docs/entscheidungen.md`).
- Visitenkarte auf die Kontaktseite.
- Über uns und Kontakt: im Stil der Startseite (schwarzer Kopf, Fenster aus hellem Glas) – Feinschliff macht Daniele selbst.
