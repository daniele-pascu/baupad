# BauPad – Hinweise für die Arbeit am Code

## Tasten-Regel (PC, Handy, Tablet)

Alle Tasten müssen auf jedem Gerät gut platziert sein: nichts darf sich überlappen, verdeckt oder am Rand
abgeschnitten sein – am PC (1440×900), iPhone (390×844), iPad hochkant (820×1180) und iPad quer (1180×820).

- Nach **jeder Änderung an Oberfläche oder CSS** den Tasten-Test auf allen vier Geräten laufen lassen:
  ```
  export CHROMIUM_PATH=/opt/pw-browsers/chromium
  npx vite build
  npx playwright test tests/e2e/tasten.spec.ts tests/e2e/tasten-mobile.spec.ts --reporter=line --workers=4
  ```
- **Neue Seite, neuer Dialog, neue Leiste** → in `tests/e2e/tasten-shared.ts` ergänzen (Seitenliste `APP`/`WEBSITE`,
  Dialogliste `DIALOGE` bzw. eigener Ablauf), damit sie künftig mitgeprüft werden.
- Die Prüfung selbst steht in `tests/e2e/tasten-check.ts` (überlappen, verdeckt, abgeschnitten; Inhalt, der beim
  Scrollen unter eine feste Kopf- bzw. Werkzeugleiste rutscht, zählt nicht).
- Befunde beheben, nicht wegdefinieren: lieber Tasten verschieben, kompakter machen oder umbrechen lassen.
