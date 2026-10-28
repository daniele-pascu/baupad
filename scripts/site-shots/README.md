# Screenshots für die Website

Erzeugt die Bilder unter `public/site/` (App-Ansichten und Beispiel-Exporte) mit Demodaten.

    npm run build
    CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --config playwright.site.config.ts
    node scripts/site-shots/finish.mjs   # PDFs rendern, Bilder verkleinern → public/site/

Benötigt `pdftoppm` (poppler) und `soffice` (LibreOffice) für die Excel-Ansicht.
