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

## Offene Fragen an Daniele
- **Zeiten:** Sollen Arbeiter ihre Stunden selbst eintragen können? (heute nur ansehen; Admin, Büro, Polier tragen ein)
- **Material:** Meldung an den zuständigen Projektleiter bei Nachbestellung einbauen? (gibt es noch nicht)
- **Team:** SV-Nummer beim Arbeiter ergänzen? (gibt es noch nicht)
- **Aufmaß:** Messart heißt in der App „Schadstelle“, auf der Website „Betoninstandsetzung“ – angleichen?
- **Excel:** Blatt „Freie Messungen (ohne Leistungszuordnung)“ umbenennen?
- **Papierkorb:** 30 oder 15 Tage? Ganze Projekte auch in den Papierkorb (größerer Umbau: Löschen wirkt in allen Tools und Geräten)?

## Vorgemerkt (später)
- App nur mit BauPad-Anmeldung (`docs/entscheidungen.md`).
- Visitenkarte auf die Kontaktseite.
- Über uns und Kontakt gestalten (derzeit schlicht, hell).
