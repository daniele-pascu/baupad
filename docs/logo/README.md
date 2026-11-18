# PAD-Logo: Vektor und Animation (vorgemerkt für die Website)

Stand: 18.11.2026 · mit Daniele abgestimmt. Eingebaut auf der Startseite (Glas-Zeichen, `src/site/components/PadMarkGlass.tsx`).

**Variante 1 (18.11.2026):** Die untere Hälfte der Rundung ist um 45 Einheiten nach unten gerutscht (rechts ein gerades Stück
dazwischen, Rundungen unverändert); dadurch ist die untere Linie länger (schräge Kante parallel weiter) und das Dreieck
wächst entlang seiner Linien mit. Schrägbalken, obere Linie und Gesamthöhe unverändert. Gilt überall: `pad-mark.svg`,
Tab- und App-Symbole (`pad-favicon-64.png`, `pad-icon-180.png`, `pad-icon-512.png`), `pad-mark.png`, `pad-mark-gross.png`,
Hintergrund-Zeichen `public/site/pad-mark-bg.svg`, Glas-Zeichen und Animation.

- `public/icons/pad-mark.svg` – das PAD-Zeichen als Vektorgrafik (ursprünglich nach dem Original-Bild vermessen, gerade Kanten,
  glatte Rundungen, Verlauf im Dreieck als echter Farbverlauf). Weiß auf transparent – für dunklen Hintergrund.
- `docs/logo/pad-logo-animation.html` – Intro-Animation (im Browser öffnen):
  - Schwarz → das Zeichen wächst gleichzeitig von seinen zwei Anfangskanten: oben ab der schrägen linken Kante nach
    rechts, um die Rundung und unten zurück; der Schrägbalken und das Dreieck ab der oberen Kante nach unten.
  - Alle Teile beginnen und enden gleichzeitig, 0,75 s. Oben gleichmäßiges Tempo (auch in der Rundung), nur ganz kurz
    weich an- und auslaufend. Scharfe Kanten, keine Punkte, kein Weichzeichnen.
  - Technik: Linien (stroke-dashoffset) innerhalb von clip-path der Logoform, eine requestAnimationFrame-Zeitleiste;
    „Bewegung reduzieren“ → sofort fertig.

Beim Einbau: Pfade aus `pad-mark.svg` verwenden, Zeitleiste und Linien aus der Animation übernehmen.
