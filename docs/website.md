# Website pad-software.at – Aufbau und Pflege

Die Website (PAD Software als Dachmarke, BauPad als erstes Produkt) und die App BauPad sind eine Anwendung
(React 19, TypeScript, Vite). Website-Seiten liegen unter `src/site/`, die App unter `src/pages/` und `src/lib/`.

## Starten und bauen

```
npm ci                 # Abhängigkeiten
npm run dev            # Entwicklung: http://localhost:5173
npm run build          # Produktion: tsc, vite build, danach Vorrendern der Website-Seiten (dist/)
npm run preview        # dist/ ansehen: http://localhost:4173
npm test               # Unit-Tests (vitest)
npm run test:e2e       # Browser-Tests (Playwright; vorher npm run build)
```

Veröffentlichen: Push auf `main` → GitHub Actions baut und stellt `dist/` auf GitHub Pages bereit
(Domain pad-software.at, siehe `docs/domain-einrichten.md`).

## Adressen

Saubere Adressen ohne `#`. Deutsch ohne Präfix, Englisch unter `/en/…`:

| Seite | Deutsch | Englisch |
|---|---|---|
| Home | `/` | `/en` |
| Produkte | `/produkte` | `/en/products` |
| BauPad | `/baupad` | `/en/baupad` |
| Werkzeug | `/baupad/aufmass` … | `/en/baupad/aufmass` … |
| Unternehmen | `/unternehmen` | `/en/company` |
| Zukunft | `/zukunft` | `/en/future` |
| Kontakt, Danke | `/kontakt`, `/kontakt/danke` | `/en/contact`, `/en/contact/thank-you` |
| Impressum, Datenschutz, Konto löschen | `/impressum`, `/datenschutz`, `/konto-loeschen` | `/en/imprint`, `/en/privacy`, `/en/delete-account` |

Die App bleibt deutsch (`/tools`, `/projekte`, `/fotos` …). Alte `#/…`-Adressen (Lesezeichen, installierte App,
E-Mail-Links) werden beim Laden still umgeschrieben. Auf GitHub Pages liefert `404.html` die App für jede
unbekannte Adresse; die Website-Seiten sind zusätzlich als eigene `index.html` vorgerendert (Titel, Beschreibung,
canonical, hreflang, Open Graph, JSON-LD) – siehe `scripts/prerender-site.mjs`. Dazu entstehen `sitemap.xml` und
`robots.txt`.

## Ordner

```
src/site/
  i18n/de.ts, en.ts      alle Texte beider Sprachen (gleicher Aufbau, vom Typ geprüft)
  i18n/index.ts          useLang(): Sprache aus der Adresse, Texte
  products.ts            Produktregister (BauPad mit fünf Werkzeugen; geplante Produkte ohne Namen)
  contact-data.ts        Kontakt- und Impressumsangaben (fehlende werden als „wird ergänzt“ gezeigt)
  contact-api.ts         Versand des Kontaktformulars an die Supabase-Funktion
  seo.ts                 Titel, Meta, canonical, hreflang, Open Graph, JSON-LD zur Laufzeit
  site.css               Designsystem Midnight Blue (alle Klassen mit Präfix ps-)
  components/            SiteShell (Kopf, Fuß, Sprachumschalter), Section, Reveal (Einblenden, Parallaxe),
                         Stage (Software-Panels als Platzhalter), Shapes (abstrakter Hintergrund)
  pages/                 Home, Products, BauPad, Tool, Company, Contact (+ Danke), Future, Legal (+ 404)
supabase/functions/contact/   Edge Function für das Kontaktformular (Resend) – siehe docs/kontaktformular.md
supabase/functions/storage/   Edge Function der zentralen Ablage (Hetzner Object Storage) – siehe docs/ablage-einrichten.md
```

## Inhalte ändern

- Texte: `src/site/i18n/de.ts` und `en.ts` – beide Sprachen pflegen, der Typ meldet fehlende Schlüssel.
- Kontakt, Impressum: `src/site/contact-data.ts` (Anschrift, Telefon, UID, Firmenbuch fehlen noch).
- Neues Produkt: in `src/site/products.ts` eintragen (Eintrag, Adresse, Werkzeuge), Texte in den Sprachdateien
  ergänzen, Seite unter `src/site/pages/` anlegen, Route in `src/lib/router.ts` (SITE_SLUGS) und `src/App.tsx`.
  Übersicht, Startseite, Fußzeile und Sitemap lesen aus dem Register.
- Geplante Produkte: `futurePage.items` in den Sprachdateien (ohne Namen und Termine, solange nichts feststeht).

## Bilder und Logo

- Für PAD Software liegt keine Logo-Datei vor; die Kopfzeile zeigt den bestehenden Text-Schriftzug (`Wordmark`).
  Sobald die Originaldatei da ist, wird sie in `SiteShell.tsx` unverändert eingesetzt (nie umfärben, nie verzerren).
- Software-Ansichten sind schematische Platzhalter (`components/Stage.tsx`, gekennzeichnet). Echte Bildschirmfotos
  werden über `image` am `Panel` eingesetzt, ohne Umbau. Vorhandene Bildschirmfotos liegen in `public/site/`.
- Social-Vorschaubild: `public/og-image.png` (1200 × 630, Schriftzug als Text).

## Cookies und Analyse

Es gibt kein Tracking, keine Statistik, keine Werbung – daher kein Cookie-Banner. Sprache und App-Einstellungen
liegen nur lokal im Browser. Sollte später ein Analyse-Werkzeug gewünscht sein, ist vorher eine Einwilligung
(Banner) und eine Ergänzung der Datenschutzerklärung nötig.
