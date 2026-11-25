import { expect, FAKE_SESSION, SESSION_KEY, test } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { FIXTURES, OUT, catchDownload, createProject, freshStart, openPlan, selectCostCenter, tableRows, waitForPlan, waitSaved } from './helpers';

/**
 * Phase 2: Website und Navigation, Projektinformationen mit Kostenstelle, kompakte Planliste.
 */

test.describe('ohne Anmeldung', () => {
  test.use({ signedIn: false });

test('Website: Startseite – Name, Motto, BauPad mit den sieben Werkzeugen, Arbeitsweise, Kontakt in Glasfenstern; Leiste und Menü', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('home-motto')).toHaveText('ProblemAnalysisDevelopment');
  await expect(page.getByTestId('cta-company')).toHaveAttribute('href', '/unternehmen');
  await expect(page.getByTestId('cta-solutions')).toHaveAttribute('href', '#loesungen');
  // im BauPad-Fenster alle sieben Werkzeuge wie in der App (farbiges Symbol und Name), jedes ein Link; kein eigenes Werkzeug-Fenster
  const tools = page.getByTestId('home-tool-list');
  await expect(tools.locator('li')).toHaveCount(7);
  await expect(tools).toContainText('Material');
  await expect(tools.locator('.ph-tool-icon')).toHaveCount(7);
  await expect(tools.locator('.ph-tool-icon').first()).toHaveCSS('background-color', 'rgb(255, 106, 19)');
  await expect(tools.getByRole('link', { name: 'Fotos' })).toHaveAttribute('href', '/baupad/funktionen/fotos');
  await expect(page.locator('#loesungen').getByTestId('home-tool-list')).toBeVisible();
  await expect(page.getByTestId('home-steps').locator('li')).toHaveText(['Problem verstehen', 'Lösung bauen', 'Laufend verfeinern']);
  await expect(page.getByTestId('cta-contact-2')).toBeVisible();
  // kein Bild (Handy-Bild entfernt, 19.11.2026), alles echter Text; Grafiken nur die sieben Werkzeug-Symbole
  await expect(page.locator('.ps-main img')).toHaveCount(0);
  await expect(page.locator('.ps-main canvas')).toHaveCount(0);
  await expect(page.locator('.ps-main svg:not(.baupad-wordmark)')).toHaveCount(7);
  // BauPad als Schriftzug in der Markenschrift: im App-Symbol und als Name
  await expect(page.locator('.ps-main svg.baupad-wordmark')).toHaveCount(2);
  await expect(page.locator('.ph-win')).toHaveCount(1); // nur BauPad (mit den Werkzeugen) im Fenster
  await expect(page.locator('#entwicklung.ph-sec, #kontakt.ph-sec')).toHaveCount(2); // Arbeitsweise und Kontakt frei, ohne Fenster
  // Farbe: Akzent Violett über den Überschriften, die Linie der Arbeitsweise läuft von Violett in Petrol
  await expect(page.locator('.ph-win .ps-eyebrow').first()).toHaveCSS('color', 'rgb(106, 85, 240)'); // auf hellem Grund dunkleres Violett
  await expect(page.locator('.ph-top .ps-eyebrow')).toHaveCSS('color', 'rgb(157, 140, 255)');
  await expect(page.getByTestId('home-steps').locator('li').last()).toBeVisible();
  // Linie: laufender Lichtpunkt (Animation läuft endlos)
  await expect.poll(() => page.locator('.ph-steps-run').evaluate((e) => e.getAnimations().length)).toBe(1);
  // keine Zertifikate oder Garantien behauptet
  await expect(page.locator('.ps-main')).not.toContainText(/zertifiziert|DSGVO-konform|garantiert/i);
  const card = page.getByTestId('home-product');
  await expect(card).toHaveAttribute('href', '/baupad');
  // „Mehr erfahren“: das Fenster vergrößert sich über den ganzen Bildschirm, dann öffnet sich die BauPad-Seite
  await card.click();
  await expect(page.getByTestId('home-expand')).toBeAttached();
  // die Leiste bleibt während des Übergangs vorne (über der wachsenden Fläche)
  expect(await page.evaluate(() => {
    const bar = document.querySelector('.ps-bar')!.getBoundingClientRect();
    const top = document.elementFromPoint(bar.left + 40, bar.top + bar.height / 2);
    return !!top?.closest('.ps-header');
  })).toBe(true);
  await expect(page.locator('.ps-bar')).toHaveCSS('opacity', '1'); // nicht blass
  await expect(page.getByTestId('product-title')).toHaveText('BauPad');
  await expect(page.locator('.bp-tagline')).toContainText('in einer App');
  // Speicher-Infos: Überschrift „Immer gesichert.“, darunter „Speichert alles online. Nichts geht verloren.“
  await expect(page.locator('#bp-saving')).toHaveText('Immer gesichert.');
  await expect(page.getByTestId('bp-safe')).toHaveText('Speichert alles online. Nichts geht verloren.');
  // Projektregister: ein Projekt einmal anlegen, in jedes Tool übernehmen
  await expect(page.getByTestId('bp-register')).toContainText('Ein Projekt für alle Tools.');
  await expect(page.getByTestId('bp-register')).toContainText('Alle Tools sind miteinander verbunden.');
  await expect(page.getByTestId('bp-register').locator('.bp-register-points li')).toHaveCount(3);
  await expect(page.getByTestId('bp-register').locator('.ph-tool-icon')).toHaveCount(7);
  // Speichern (mit/ohne Empfang) und vier Rollen je Nutzerlizenz
  await expect(page.getByTestId('bp-saving').locator(':scope > li')).toHaveCount(3);
  await expect(page.getByTestId('bp-saving')).toContainText('Ohne Empfang');
  await expect(page.getByTestId('bp-roles').locator(':scope > li')).toHaveCount(4);
  await expect(page.getByTestId('bp-roles').locator(':scope > li > strong')).toHaveText(['Admin', 'Büro', 'Polier', 'Arbeiter']);
  expect(new URL(page.url()).pathname).toBe('/baupad');
  await expect(page.getByTestId('home-expand')).toHaveCount(0); // Fläche ist wieder weg
  // Englisch
  await page.goto('./en');
  await expect(page.getByTestId('home-product')).toHaveAttribute('href', '/en/baupad');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PAD Software');
  await expect(page.getByTestId('home-motto')).toHaveText('ProblemAnalysisDevelopment');
  // Leiste: Logo mit „PAD Software“ links, Home · Produkte · Über uns · Kontakt in der Mitte, Anmelden rechts
  await page.goto('./');
  const nav = page.getByTestId('site-nav');
  for (const n of ['Home', 'Über uns', 'Kontakt']) await expect(nav.getByRole('link', { name: n, exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Produkte', exact: true })).toBeVisible();
  await expect(page.getByTestId('pad-mark')).toHaveText('PAD Software');
  await expect(page.getByTestId('nav-login')).toHaveText('Anmelden');
  // schwebt mit Abstand zum Rand und bleibt beim Scrollen stehen; zartes weißes Glas auf dunklem Grund
  const bar = nav.locator('.ps-bar');
  expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual(8);
  await expect(bar).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.1)');
  // Startseite: oben schwarzer Kopf mit der Firma, darunter heller Grund
  await expect(page.locator('.ph-top')).toHaveCSS('background-color', 'rgb(10, 10, 11)');
  await expect(page.locator('.ph-top').getByTestId('pad-mark-glass')).toBeVisible(); // PAD-Zeichen aus weißem Glas im Kopf
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(244, 244, 246)');
  // Anmelden über dem schwarzen Kopf: helle Glas-Pille, Maus darüber → schwarz mit weißer Schrift
  const login = page.getByTestId('nav-login');
  await expect(login).toHaveCSS('color', 'rgb(17, 17, 17)');
  await login.hover();
  await expect(login).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(login).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(login).toHaveCSS('border-top-color', 'rgb(255, 255, 255)'); // schwarz, rundherum weiß
  // weiße Tasten auf hellem Grund: Maus darauf → schwarz mit weißem Rand
  const open = page.getByTestId('home-open');
  await open.hover();
  await expect(open).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(open).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(open).toHaveCSS('border-top-color', 'rgb(255, 255, 255)');
  // schwarze Taste („Mehr erfahren“): Maus darauf → weiß mit schwarzem Rand
  const more = page.getByTestId('home-product');
  await more.hover();
  await expect(more).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(more).toHaveCSS('color', 'rgb(17, 17, 17)');
  await expect(more).toHaveCSS('border-top-color', 'rgb(17, 17, 17)');
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(700, 600);
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual(8); // bleibt stehen
  // über hellem Grund: Leiste schwarzes Glas, Logo und Schrift bleiben weiß; nicht ganz oben → verblasst, Maus darauf → wieder voll
  await expect(nav).toHaveClass(/on-light/);
  await expect(bar).toHaveCSS('background-color', 'rgba(10, 10, 12, 0.96)');
  await expect(nav.getByRole('link', { name: 'Kontakt', exact: true })).toHaveCSS('color', 'rgba(255, 255, 255, 0.86)');
  await expect(login).toHaveCSS('color', 'rgb(17, 17, 17)');
  await expect(bar).toHaveCSS('opacity', '0.45');
  await bar.hover();
  await expect(bar).toHaveCSS('opacity', '1');
  await page.evaluate(() => scrollTo(0, 0));
  await expect(nav).not.toHaveClass(/on-light/);
  // Produkte: Fenster klappt auf (so breit wie die Links) – BauPad-Symbol, Name, Infos; Klick öffnet die BauPad-Seite
  await page.getByTestId('nav-products').click();
  const panel = page.getByTestId('products-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Die Baustelle in einer App.');
  const nb = (await nav.locator('.ps-nav').boundingBox())!;
  const pb = (await panel.boundingBox())!;
  expect(Math.abs(pb.x - nb.x)).toBeLessThan(1);
  expect(Math.abs(pb.width - nb.width)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.getByTestId('nav-products').click();
  await page.getByTestId('products-panel-baupad').click();
  expect(new URL(page.url()).pathname).toBe('/baupad');
  await expect(panel).toBeHidden();
});

test('Website: Startseite, Produkte, BauPad, Unternehmen, Kontaktformular, Sprache, Rechtliches', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('PAD Software – Software, die aus der Praxis entsteht');
  const nav = page.getByTestId('site-nav');
  await expect(nav).toBeVisible();
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText('PAD Software');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  // direkt nach dem ersten Bildschirm: BauPad
  await expect(page.getByTestId('home-product')).toHaveAttribute('href', '/baupad');
  await expect(page.locator('.ps-main img')).toHaveCount(0); // kein Handy-Bild mehr

  // Produkte
  await page.getByTestId('site-footer').getByRole('link', { name: 'Produkte', exact: true }).click();
  await expect(h1).toContainText('Produkte von PAD Software');
  await expect(page).toHaveTitle('Produkte – PAD Software');
  await expect(page.getByTestId('product-status')).toContainText('Testphase'); // BauPad in der Testphase
  await expect(page.getByTestId('product-open-baupad')).toContainText('BauPad'); // Name als Link zur Produktseite
  await page.getByTestId('product-open-baupad').click();

  // BauPad (hell): groß Symbol und Name, darunter jedes Werkzeug als Fenster in seiner Farbe mit kurzer Aufzählung
  await expect(page.getByTestId('product-title')).toHaveText('BauPad');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(244, 244, 246)');
  await expect(page.getByTestId('home-expand')).toHaveCount(0); // über Produkte ohne Übergang
  await expect(page.getByTestId('product-card')).toHaveCount(7);
  await expect(page.getByTestId('product-grid').locator('a')).toHaveCount(7); // alle sieben, jedes anklickbar
  await expect(page.getByTestId('product-card').nth(3)).toContainText('Fotos');
  await expect(page.getByTestId('product-card').nth(4)).toContainText('Mängel');
  await expect(page.getByTestId('product-card').nth(5)).toContainText('Zeiten');
  await expect(page.getByTestId('product-card').nth(6)).toContainText('Material');
  await expect(page.locator('.bp-tool-icon')).toHaveCount(7);
  await expect(page.getByTestId('product-card').first().locator('.bp-points > span')).toHaveCount(3); // nur Aufzählung
  await expect(page.getByTestId('product-card').first()).toHaveCSS('background-image', /rgb\(255, 106, 19\)/); // Farbe des Werkzeugs
  // jede Karte zeigt „Mehr erfahren →“; Antippen: die Karte wächst in der Tool-Farbe zur eigenen Seite des Tools
  await expect(page.getByTestId('product-card-more')).toHaveCount(7);
  await expect(page.getByTestId('product-card-more').first()).toHaveText('Mehr erfahren');
  await expect(page.getByTestId('tool-dialog')).toHaveCount(0);
  await page.getByTestId('product-card').nth(3).click();
  await expect(page.getByTestId('tool-expand')).toHaveCount(1); // Übergang läuft
  await expect(page.getByTestId('product-title')).toHaveText('Fotos');
  expect(page.url()).toContain('/baupad/funktionen/fotos');
  await expect(page.getByTestId('tool-expand')).toHaveCount(0);
  await expect(page.locator('.tp-hero')).toHaveCSS('background-image', /linear-gradient/); // Kopf in der Tool-Farbe
  await expect(page.locator('.tp-group h3')).toHaveText(['Aufnehmen', 'Ordnen', 'Ausgeben']);
  await page.getByTestId('product-open').click();
  await expect(h1).toHaveText('Anmelden'); // Werkzeug nur mit Anmeldung
  await page.goto('./');

  // Unternehmen
  await nav.getByRole('link', { name: 'Über uns', exact: true }).click();
  await expect(h1).toContainText('für die Praxis');
  // Über uns im Stil der Startseite: schwarzer Kopf (Leiste darüber weißes Glas), darunter heller Grund (Leiste schwarzes Glas)
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(244, 244, 246)');
  await expect(page.locator('[data-dark-top]')).toBeVisible();
  await expect(nav).not.toHaveClass(/on-light/);
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(nav).toHaveClass(/on-light/);
  await page.evaluate(() => window.scrollTo(0, 0));
  // „Wofür wir stehen“ (fünf Grundsätze) und „Technik, die mitwächst“ (sechs Punkte) stehen hier – ohne Zertifikats-Werbung
  await expect(page.getByTestId('values').locator(':scope > li')).toHaveCount(5);
  await expect(page.getByTestId('tech').locator(':scope > li')).toHaveCount(6);
  await expect(page.locator('.ps-main')).not.toContainText(/zertifiziert|DSGVO-konform|garantiert/i);
  await expect(page).toHaveTitle('Unternehmen – PAD Software');
  await expect(nav.getByRole('link', { name: 'Zukunft', exact: true })).toHaveCount(0); // Seite abgeschaltet

  // Kontakt: Angaben (fehlende als Platzhalter), Formular mit Prüfung
  await nav.getByRole('link', { name: 'Kontakt', exact: true }).click();
  await expect(h1).toHaveText('Schreiben Sie uns.');
  await expect(page.getByTestId('contact-list').locator('.placeholder')).toHaveCount(0); // leere Angaben (Telefon, Anschrift) werden nicht gezeigt
  await expect(page.getByTestId('contact-list')).toContainText('office@pad-software.at');
  await page.getByTestId('contact-submit').click();
  await expect(page.locator('.ps-error')).toHaveCount(5); // Name, E-Mail, Betreff, Nachricht, Einwilligung
  await page.getByTestId('contact-name').fill('Max Muster');
  await page.getByTestId('contact-email').fill('max@example.com');
  await page.getByTestId('contact-subject').fill('Vorführung');
  await page.getByTestId('contact-message').fill('Bitte um einen Termin für eine Vorführung.');
  await page.getByTestId('contact-consent').check();
  // Versand noch nicht eingerichtet → ehrlicher Hinweis, keine Danke-Seite
  await page.route('**/functions/v1/contact', (r) => r.fulfill({ status: 501, contentType: 'application/json', body: '{"error":"not-configured"}' }));
  await page.getByTestId('contact-submit').click();
  await expect(page.getByTestId('contact-failure')).toContainText('noch nicht eingerichtet');
  expect(page.url()).not.toContain('danke');
  // Versand erfolgreich → Danke-Seite
  await page.unroute('**/functions/v1/contact');
  await page.route('**/functions/v1/contact', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.getByTestId('contact-submit').click();
  await expect(h1).toHaveText('Danke für Ihre Nachricht.');
  expect(page.url()).toContain('/kontakt/danke');
  // Danke-Seite direkt aufgerufen → zurück zum Formular
  await page.goto('./kontakt/danke');
  await expect(h1).toHaveText('Schreiben Sie uns.');

  // Sprache: Englisch auf derselben Seite, zurück zu Deutsch
  await page.locator('[data-testid="lang-en"]:visible').first().click();
  expect(page.url()).toContain('/en/contact');
  await expect(h1).toHaveText('Write to us.');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(nav.getByRole('button', { name: 'Products', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Contact – PAD Software');
  await page.locator('[data-testid="lang-de"]:visible').first().click();
  expect(page.url()).toContain('/kontakt');
  await expect(h1).toHaveText('Schreiben Sie uns.');

  // Impressum und Datenschutz über die Fußzeile (Firmendaten noch Platzhalter)
  const footer = page.getByTestId('site-footer');
  await footer.getByRole('link', { name: 'Impressum' }).click();
  await expect(h1).toHaveText('Impressum');
  await expect(page.getByTestId('imprint-list').locator('.placeholder')).toHaveCount(4); // Unternehmen, Inhaber und E-Mail sind eingetragen
  await footer.getByRole('link', { name: 'Datenschutz' }).click();
  await expect(h1).toHaveText('Datenschutz');
  await expect(page.locator('.ps-text')).toContainText('GitHub Pages');
  await expect(page.locator('.ps-text')).toContainText('Kontaktformular');

  // Wortmarke führt immer zur Startseite
  await nav.getByRole('link', { name: 'PAD Software' }).first().click();
  await expect(h1).toHaveText('PAD Software');

  // „Anmelden“: Anmeldeseite mit Supabase – der Dienst ist aus der Testumgebung nicht erreichbar,
  // deshalb werden seine Antworten hier nachgestellt (Anbieter-Weiterleitung, falsches Passwort, Registrierung)
  await page.route('**/auth/v1/authorize**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Anbieter</h1>' }));
  await page.route('**/auth/v1/token**', (r) =>
    r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) }),
  );
  await page.route('**/auth/v1/signup**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u-neu', aud: 'authenticated', email: 'neu@example.com', identities: [{ id: 'i1' }], user_metadata: {} }) }),
  );
  await nav.getByRole('link', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anmelden');
  await expect(page).toHaveTitle('Anmelden – BauPad');
  await expect(page.getByTestId('login-provider')).toHaveCount(3);
  await expect(page.getByTestId('login-provider').nth(0)).toContainText('Mit Google anmelden');
  await expect(page.getByTestId('login-provider').nth(2)).toContainText('Mit Microsoft (Outlook) anmelden');
  await page.getByTestId('login-provider').nth(0).click(); // Google: Weiterleitung zum Anbieter über Supabase
  await expect(page).toHaveURL(/auth\/v1\/authorize\?provider=google/);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anmelden');
  await page.getByTestId('login-email').fill('test@example.com');
  await page.getByTestId('login-password').fill('geheim');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('auth-error')).toContainText('E-Mail-Adresse oder Passwort ist falsch.');
  expect(page.url()).toContain('/anmelden'); // keine Weiterleitung, kein „angemeldet“
  // Registrieren: Pflichtfelder und Passwortregeln werden geprüft, bevor etwas gesendet wird
  await page.getByTestId('auth-tab-register').click();
  expect(page.url()).toContain('/registrieren');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Registrieren');
  await page.getByTestId('login-email').fill('neu@example.com');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('auth-error')).toContainText('Namen');
  await page.getByTestId('register-name').fill('Daniele');
  await page.getByTestId('login-password').fill('kurz');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('auth-error')).toContainText('mindestens 8 Zeichen');
  await page.getByTestId('login-password').fill('langes-passwort');
  await page.getByTestId('register-password2').fill('anders');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('auth-error')).toContainText('nicht überein');
  await page.getByTestId('register-password2').fill('langes-passwort');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('auth-info')).toContainText('E-Mail an neu@example.com'); // Bestätigung ausstehend
  // Bestätigungslink abgelaufen: neuen anfordern
  let resent: unknown = null;
  await page.route('**/auth/v1/resend**', (r) => {
    resent = r.request().postDataJSON();
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.getByTestId('login-resend').click();
  await expect(page.getByTestId('auth-info')).toContainText('Neuer Bestätigungslink an neu@example.com');
  expect(resent).toMatchObject({ type: 'signup', email: 'neu@example.com' });
  await page.getByTestId('auth-tab-login').click();
  await page.screenshot({ path: join(OUT, 'anmelden.png'), fullPage: true });
  // Ohne Anmeldung keine Werkzeuge: jede Werkzeug-Adresse führt zur Anmeldeseite
  for (const h of ['#/tools', '#/projekte', '#/fotos', '#/fotos/kamera', '#/berichte', '#/arbeitereinteilung', '#/konto']) {
    await page.goto(`./${h}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anmelden');
    expect(page.url()).toContain('/anmelden');
  }
  await page.goto('./baupad');
  await page.getByTestId('cta-tools').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anmelden');
  // Pflichtseite der Stores: Konto löschen, öffentlich, mit Schritten
  await page.goto('./#/konto-loeschen');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Konto löschen');
  await expect(page.getByTestId('delete-steps').locator('li')).toHaveCount(4);
});

test('Installierte App ohne Anmeldung startet auf der Anmeldeseite', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anmelden');
});
});

test('Angemeldet: Tools, Einstellungen und Benutzerliste', async ({ page }) => {
  await page.goto('./#/tools');
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');
  // kein Zahnrad mehr – weder in Aufmaß & Abrechnung noch auf der Tools-Seite; Einstellungen über den Namen oben rechts
  await page.getByTestId('tool-projects').click();
  await expect(page.getByTestId('projects-title')).toHaveText('Aufmaß');
  await expect(page.getByTestId('account-link')).toHaveCount(0);
  await page.getByTestId('to-tools').click();
  await expect(page.getByTestId('account-link')).toHaveCount(0);

  // Einstellungen: angemeldete Person, geplante Bereiche inaktiv
  await page.getByTestId('nav-account').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Konto und Einstellungen');
  await expect(page.getByTestId('account-session')).toContainText('Angemeldet als Test Nutzer');
  await expect(page.getByTestId('nav-account')).toHaveText('T. Nutzer'); // erster Vorname abgekürzt + Nachname
  await expect(page.getByTestId('account-section')).toHaveText([
    /Benutzer & Rollen/,
    /Persönliche Daten/,
    /E-Mail und Konto/,
    /Passwort und Anmeldemethoden/,
    /Abonnement und Zahlung/,
    /Firmeninformationen/,
    /Firmenformulare/,
    /Darstellung/,
    /App und Speicher/,
    /Sicherheit/,
    /Weitere Einstellungen/,
  ]);
  await expect(page.getByTestId('account-logout')).toBeVisible();
  // Benutzer & Rollen: Kasten antippen → eigene Seite; Admin trägt Benutzer mit Funktion, Werkzeugen und Paket ein (bleibt nach dem Neuladen)
  const tile = (id: string) => page.locator(`[data-testid="account-section"][data-tile="${id}"]`);
  await tile('benutzer').click();
  await expect(page).toHaveURL(/\/konto\/benutzer$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Benutzer & Rollen');
  await page.getByTestId('user-add').click();
  const ud = page.getByTestId('user-dialog');
  await ud.getByTestId('user-email').fill('polier@musterbau.at');
  await ud.getByTestId('user-name').fill('Max Muster');
  await ud.locator('.role-option', { hasText: 'Polier' }).click();
  await expect(ud.getByTestId('user-role-polier')).toBeChecked();
  await expect(ud.getByTestId('user-tool-photos')).toBeChecked();
  await expect(ud.getByTestId('user-tool-reports')).toBeChecked();
  await expect(ud.getByTestId('user-tool-projects')).not.toBeChecked();
  await ud.getByTestId('user-tool-workers').check();
  await expect(ud.getByTestId('user-sites-all-photos')).toHaveAttribute('aria-checked', 'true'); // Standard: alle Projekte je Werkzeug
  // Kasten „Preise und Summen“: Admin/Büro immer, Polier nur mit Haken
  const prices = ud.getByTestId('user-perm-prices');
  await expect(prices).not.toBeChecked();
  await expect(prices).toBeEnabled();
  await ud.locator('.role-option', { hasText: 'Büro' }).click();
  await expect(prices).toBeChecked();
  await expect(prices).toBeDisabled();
  await ud.locator('.role-option', { hasText: 'Polier' }).click();
  await ud.getByTestId('user-tool-workers').check();
  await expect(prices).not.toBeChecked();
  await prices.check();
  await ud.getByTestId('user-save').click();
  await expect(page.getByTestId('user-row')).toHaveCount(1);
  await page.getByTestId('user-open').click();
  await expect(ud.getByTestId('user-perm-prices')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(ud).toHaveCount(0);
  await expect(page.getByTestId('user-row')).toContainText('Polier');
  await expect(page.getByTestId('user-row')).toContainText('Team');
  await page.getByTestId('user-add').click();
  await ud.getByTestId('user-email').fill('polier@musterbau.at');
  await ud.getByTestId('user-name').fill('Doppelt');
  await ud.getByTestId('user-save').click();
  await expect(page.locator('.toast', { hasText: 'schon eingetragen' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(ud).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('user-row')).toHaveCount(1);
  await page.screenshot({ path: join(OUT, 'konto.png'), fullPage: true });
  await page.getByTestId('account-back').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Konto und Einstellungen');
  await page.getByRole('link', { name: 'Zu den Tools' }).click();
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');

  // Startseite: angemeldet geht es direkt zu den Tools, Website-Links verschwinden aus der Leiste
  await page.goto('./');
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');
  await expect(page.getByTestId('site-nav').getByRole('link', { name: 'Über uns' })).toHaveCount(0);
  await page.goto('./#/ueber');
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');
  // Kontakt und Rechtliches stehen unter Konto und Einstellungen
  await page.goto('./#/konto');
  await tile('weitere').click();
  await expect(page.getByTestId('settings-contact')).toBeVisible();
  // Persönliche Daten bearbeitbar – Bereiche sind direkt per Adresse erreichbar
  await page.goto('./konto/profil');
  await expect(page.getByTestId('profile-name')).toHaveValue('Test Nutzer');
  await page.goto('./konto/passwort');
  await expect(page.getByTestId('provider-list')).toContainText('verbunden');
  // unbekannter Bereich → zurück zur Übersicht
  await page.goto('./konto/gibtsnicht');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Konto und Einstellungen');
});

test('Installierte App mit gespeicherter Anmeldung startet direkt in den Tools (auch ältere Home-Bildschirm-Symbole)', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const page = await context.newPage();
  await page.goto('./'); // alte Startadresse
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');
  await context.close();
});

test('Tools: sieben gleich große Kacheln, vier pro Reihe; Projektregister als Taste darüber; alle Werkzeuge antippbar', async ({ page }) => {
  await page.goto('./#/tools');
  const tiles = page.locator('.tool-tile');
  await expect(tiles).toHaveCount(7);
  await expect(tiles.locator('strong')).toHaveText(['Aufmaß', 'Team', 'Fotos', 'Berichte', 'Mängel', 'Zeiten', 'Material']);
  const boxes = await Promise.all((await tiles.all()).map((t) => t.boundingBox()));
  // 4 + 3, alle gleich groß
  for (const i of [1, 2, 3]) expect(Math.abs(boxes[0]!.y - boxes[i]!.y)).toBeLessThan(1);
  for (const i of [5, 6]) expect(Math.abs(boxes[4]!.y - boxes[i]!.y)).toBeLessThan(1);
  expect(boxes[4]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
  // Projektregister ist kein Werkzeug: Taste über den Kacheln
  const reg = (await page.getByTestId('tools-register').boundingBox())!;
  expect(reg.y + reg.height).toBeLessThanOrEqual(boxes[0]!.y);
  expect(reg.height).toBeLessThan(60);
  for (const b of boxes) {
    expect(Math.abs(b!.width - boxes[0]!.width)).toBeLessThan(1);
    expect(Math.abs(b!.height - boxes[0]!.height)).toBeLessThan(1);
  }
  // alle Werkzeuge sind antippbar
  await expect(page.getByTestId('tool-soon')).toHaveCount(0);
  await page.screenshot({ path: join(OUT, 'tools.png'), fullPage: true });
  // Arbeitereinteilung und zurück
  await page.getByTestId('tool-workers').click();
  await expect(page.getByTestId('workers-title')).toHaveText('Team');
  await expect(page.getByTestId('crew-week')).toBeVisible();
  await page.getByTestId('to-tools').click();
  await expect(page.getByTestId('tools-title')).toBeVisible();
  // Aufmaß & Abrechnung → zurück zu den Tools
  await page.getByTestId('tool-projects').click();
  await expect(page.getByTestId('projects-title')).toHaveText('Aufmaß');
  await page.getByTestId('to-tools').click();
  await expect(page.getByTestId('tools-title')).toBeVisible();
});

/** Erstellt eine Projektsicherung im bisherigen Datenformat (Kostenstellen ohne Nummer). */
function legacyBackup(): string {
  const now = Date.now();
  const meta = (id: string) => ({ id, createdAt: now, updatedAt: now, rev: 1, deviceId: 'altgeraet', deletedAt: null });
  const png = readFileSync(join(FIXTURES, 'parkdeck.png'));
  const plan = (id: string, cc: string, no: string, name: string, floor: string, note: string) => ({
    ...meta(id),
    projectId: 'p-alt',
    costCenterId: cc,
    fileId: 'f-1',
    pageIndex: 0,
    pageWidth: 1400,
    pageHeight: 1000,
    crop: null,
    planNumber: no,
    planName: name,
    floor,
    area: '',
    description: note,
    numberStart: 0,
    sortIndex: 0,
  });
  const dmg = (id: string, planId: string, n: number, l: number, w: number) => ({
    ...meta(id),
    projectId: 'p-alt',
    planId,
    number: n,
    shape: { type: 'rect', x: 100 + n * 120, y: 200, w: 80, h: 60 },
    color: '#e03131',
    labelOffset: null,
    length: l,
    width: w,
    depth: 0.05,
    area: Math.round(l * w * 1e9) / 1e9,
  });
  const content = {
    project: { ...meta('p-alt'), name: 'Altprojekt', site: 'Garage West', address: '', client: '', editor: '', date: '2026-09-01', notes: '' },
    costCenters: [
      { ...meta('cc-1'), projectId: 'p-alt', name: 'Tiefgarage', sortIndex: 0 },
      { ...meta('cc-2'), projectId: 'p-alt', name: 'Stiege 1', sortIndex: 1 },
    ],
    files: [{ ...meta('f-1'), projectId: 'p-alt', name: 'parkdeck.png', mimeType: 'image/png', size: png.length, kind: 'image', pageCount: 1 }],
    plans: [plan('pl-1', 'cc-1', '067', 'Untergeschoss', 'UG2', 'Bereich Tiefgarage Nord'), plan('pl-2', 'cc-2', '012', 'Stiegenhaus', 'EG', '')],
    damages: [dmg('d-1', 'pl-1', 0, 1.5, 0.8), dmg('d-2', 'pl-1', 1, 2, 1.25), dmg('d-3', 'pl-2', 0, 1, 1)],
  };
  const zip = zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'schadstellen-aufmass-projekt', version: 1, exportedAt: now, deviceId: 'altgeraet', app: 'Schadstellen-Aufmaß' })),
    'projekt.json': strToU8(JSON.stringify(content)),
    'dateien/f-1': new Uint8Array(png),
  });
  const path = join(OUT, 'altprojekt-sicherung.zip');
  writeFileSync(path, zip);
  return path;
}

test('Bestehendes Projekt mit mehreren Kostenstellen: nichts geht verloren, Planliste und Aktionen', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('import-project-input').setInputFiles(legacyBackup());
  await expect(page.getByTestId('project-title')).toHaveText('Altprojekt');

  // Beide Kostenstellen sind vorhanden; die Auswahl erscheint, weil es mehrere sind
  await expect(page.getByTestId('project-cost-centers')).toHaveText('Tiefgarage, Stiege 1');
  await expect(page.getByTestId('cost-center-select').locator('option')).toHaveText(['Tiefgarage (1)', 'Stiege 1 (1)']);

  // Planliste: Plannummer, Bezeichnung, Ebene, Bemerkung, Leistungen, Fläche – keine Anzahl der Messungen
  const row = page.getByTestId('plan-row').filter({ hasText: '067' });
  await expect(row).toContainText('Untergeschoss');
  await expect(row).toContainText('UG2');
  await expect(row.getByTestId('plan-note')).toHaveText('Bereich Tiefgarage Nord');
  await expect(row).toContainText('Keine Leistungszuordnung');
  await expect(row.getByTestId('plan-count')).toHaveCount(0);
  await expect(row).not.toContainText('Messung');
  await expect(page.getByTestId('plan-list').getByRole('columnheader', { name: 'Messungen' })).toHaveCount(0);
  await expect(row.getByTestId('plan-area')).toHaveText('3,70 m²');

  await selectCostCenter(page, 'Stiege 1');
  await expect(page.getByTestId('plan-row')).toHaveCount(1);
  await expect(page.getByTestId('plan-row')).toContainText('012');
  await selectCostCenter(page, 'Tiefgarage');

  // Kostenstellennummer nachträglich gemeinsam mit den Projektangaben ergänzen
  await page.getByTestId('edit-project').click();
  const form = page.getByTestId('project-form');
  await expect(form.getByTestId('cost-center-input')).toHaveCount(2);
  await form.getByTestId('cost-center-number').first().fill('4711');
  await form.locator('input[name="client"]').fill('Hausverwaltung Y');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('project-cost-centers')).toHaveText('4711 – Tiefgarage, Stiege 1');
  await expect(page.getByTestId('project-info')).toContainText('Hausverwaltung Y');
  await expect(page.getByTestId('cost-center-title')).toHaveText('4711 – Tiefgarage');
  // Die Zuordnung der Pläne bleibt erhalten
  await expect(page.getByTestId('plan-row')).toHaveCount(1);
  await expect(page.getByTestId('plan-row')).toContainText('067');

  // Angaben bearbeiten: Bemerkung ändern
  await row.getByTestId('plan-actions').click();
  await page.getByTestId('action-edit').click();
  const det = page.getByTestId('plan-details');
  await det.locator('[data-field="description"]').fill('Bereich Tiefgarage Nord, Rampe');
  await det.getByRole('button', { name: 'Speichern' }).click();
  await expect(row.getByTestId('plan-note')).toHaveText('Bereich Tiefgarage Nord, Rampe');

  // Umbenennen ändert nur die Bezeichnung – Messwerte, Farben und Bemerkung bleiben
  await openPlan(page, '067');
  await waitForPlan(page);
  const before = await tableRows(page);
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await row.getByTestId('plan-actions').click();
  await page.getByTestId('action-rename').click();
  await page.getByTestId('prompt-dialog').locator('input').fill('UG Nord');
  await page.getByTestId('prompt-dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(row).toContainText('UG Nord');
  await expect(row.getByTestId('plan-note')).toHaveText('Bereich Tiefgarage Nord, Rampe');
  await expect(row.getByTestId('plan-area')).toHaveText('3,70 m²');
  await openPlan(page, '067');
  await waitForPlan(page);
  expect(await tableRows(page)).toEqual(before);
  await expect(page.locator('.viewer-overlay path[data-damage]').first()).toHaveAttribute('stroke', '#e03131');
  // Ausschnitt auch direkt im Plan (Leiste oben rechts), ohne zurück zur Planliste
  await page.getByTestId('editor-crop').click();
  await expect(page.getByTestId('area-editor')).toBeVisible();
  await page.getByTestId('area-editor').getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('area-editor')).toHaveCount(0);
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();

  // Ausschnitt-Aktion öffnet den bestehenden Ausschnitt-Editor
  await row.getByTestId('plan-actions').click();
  await page.getByTestId('action-crop').click();
  await expect(page.getByTestId('area-editor')).toBeVisible();
  await page.getByTestId('area-editor').getByRole('button', { name: 'Abbrechen' }).click();

  // Löschen zeigt, welche Daten betroffen sind – Abbrechen löscht nichts
  await row.getByTestId('plan-actions').click();
  await page.getByTestId('action-delete').click();
  const confirm = page.getByTestId('confirm-dialog');
  await expect(confirm.getByTestId('delete-summary')).toContainText('2 Messung(en)');
  await expect(confirm.getByTestId('delete-summary')).toContainText('Die Bemerkung zum Plan');
  await expect(confirm).toContainText('bleibt erhalten'); // Originaldatei wird noch vom Plan 012 verwendet
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('plan-row')).toHaveCount(1);
  await waitSaved(page);

  // Nach dem Neuladen ist alles noch da
  await page.reload();
  await expect(page.getByTestId('project-cost-centers')).toHaveText('4711 – Tiefgarage, Stiege 1');
  await expect(page.getByTestId('plan-row').filter({ hasText: '067' })).toContainText('UG Nord');
});

test('Planliste am PC: Spalten nebeneinander', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Spalten', {}, [{ number: '100', name: 'Halle' }]);
  await expect(page.getByTestId('project-cost-centers')).toHaveText('100 – Halle');
  await expect(page.getByTestId('cost-center-switch')).toHaveCount(0);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('067');
  await wiz.locator('[data-field="planName"]').fill('Untergeschoss');
  await wiz.locator('[data-field="floor"]').fill('UG2');
  await wiz.locator('[data-field="description"]').fill('Bereich Tiefgarage Nord');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  const row = page.getByTestId('plan-row').first();
  const cells = row.locator('[role="cell"]');
  const boxes = await cells.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  // alle Spalten in einer Zeile
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(12);
  await page.screenshot({ path: join(OUT, 'planliste-pc.png') });
});

test('Zurück-Links führen wirklich zurück: die Zurück-Taste springt danach nicht hin und her', async ({ page }) => {
  await freshStart(page); // /projekte
  await page.getByTestId('to-tools').click();
  await expect(page).toHaveURL(/\/baupad\/tools$/);
  await page.getByTestId('nav-account').click();
  await expect(page).toHaveURL(/\/baupad\/konto$/);
  await page.locator('[data-testid="account-section"][data-tile="profil"]').click();
  await expect(page).toHaveURL(/\/baupad\/konto\/profil$/);
  // „Zurück“ in der Seite = Zurück-Taste
  await page.getByTestId('account-back').click();
  await expect(page).toHaveURL(/\/baupad\/konto$/);
  await page.getByRole('link', { name: 'Zu den Tools' }).click();
  await expect(page).toHaveURL(/\/baupad\/tools$/);
  // Zurück-Taste: nicht wieder Konto, sondern die Seite davor
  await page.goBack();
  await expect(page).toHaveURL(/\/baupad\/aufmass-und-abrechnung$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/baupad\/tools$/);
  // Neuladen behält den Verlauf
  await page.getByTestId('nav-account').click();
  await page.reload();
  await page.getByRole('link', { name: 'Zu den Tools' }).click();
  await expect(page).toHaveURL(/\/baupad\/tools$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/baupad\/aufmass-und-abrechnung$/);
});

test('Aufmaß-Tabelle am PC nach rechts einklappen und wieder ausklappen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Klappen', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const side = page.getByTestId('editor-side');
  await expect(side).toBeVisible();
  await page.getByTestId('side-toggle').click();
  await expect(side).toBeHidden();
  await expect(page.getByTestId('side-resizer')).toBeHidden();
  await page.getByTestId('side-toggle').click();
  await expect(side).toBeVisible();
});

test.describe('Website Materialverwaltung ohne Anmeldung', () => {
  test.use({ signedIn: false });
test('Website: Werkzeugseite Materialverwaltung (DE/EN), öffnet das Werkzeug', async ({ page }) => {
  await page.goto('./baupad/funktionen/materialverwaltung');
  await expect(page.getByTestId('product-title')).toHaveText('Material');
  await expect(page.locator('body')).toContainText('was offen, bestellt oder geliefert ist');
  // Website zeigt, was das Tool kann – keine Bedienungsdetails
  await expect(page.locator('body')).not.toContainText('Schreibweise');
  await expect(page).toHaveTitle(/Material/);
  await page.goto('./en/baupad/features/materialverwaltung');
  await expect(page.getByTestId('product-title')).toHaveText('Material');
  // BauPad-Seite nennt sieben Werkzeuge
  await page.goto('./baupad');
  await expect(page.getByTestId('product-card')).toHaveCount(7);
  await expect(page.locator('body')).not.toContainText(/sechs Werkzeuge/i);
});
});

test.describe('Tab-Symbol', () => {
  test.use({ signedIn: false });
  test('Website zeigt das PAD-Software-Logo im Tab, die geöffnete App das BauPad-Logo', async ({ page }) => {
    const icon = () => page.locator('link[rel="icon"]').getAttribute('href');
    const touch = () => page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    for (const p of ['./', './unternehmen', './baupad/funktionen/materialverwaltung', './en']) {
      await page.goto(p);
      await expect.poll(icon).toBe('/icons/pad-favicon-64.png?v=2');
      await expect.poll(touch).toBe('/icons/pad-icon-180.png?v=2');
    }
    // App (Anmelden gehört zur App)
    await page.goto('./baupad/anmelden');
    await expect.poll(icon).toBe('/icons/favicon-64.png');
    await expect.poll(touch).toBe('/icons/icon-180.png');
    // zurück zur Website: wieder PAD
    await page.goto('./kontakt');
    await expect.poll(icon).toBe('/icons/pad-favicon-64.png?v=2');
    // die Symbole sind erreichbar
    for (const f of ['pad-favicon-64.png', 'pad-icon-180.png', 'pad-icon-512.png', 'favicon-64.png']) expect((await page.request.get(`./icons/${f}`)).status()).toBe(200);
  });
});

test('Planliste: Pläne direkt als PDF herunterladen – je Plan im Menü und alle unter der Liste', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'PDF Liste', {}, ['Keller']);
  for (const nr of ['L-1', 'L-2']) {
    await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
    const wiz = page.getByTestId('import-wizard');
    await wiz.getByTestId('areas-next').click();
    await wiz.locator('[data-field="planNumber"]').fill(nr);
    await wiz.getByTestId('import-save').click();
    await waitForPlan(page);
    await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  }
  await expect(page.getByTestId('plan-row')).toHaveCount(2);
  const checked = () => page.locator('.modal input[type="checkbox"]:checked').count();
  // je Plan: Menü → „Als PDF herunterladen“ – nur dieser Plan ist gewählt
  await page.locator('[data-testid="plan-row"][data-plan="L-2"]').getByTestId('plan-actions').click();
  await page.getByTestId('action-pdf').click();
  await expect(page.getByTestId('pdf-export-run')).toBeVisible();
  const one = await page.locator('.modal').innerText();
  expect(one).toContain('L-2');
  const dl = await catchDownload(page, () => page.getByTestId('pdf-export-run').click());
  expect(dl.suggestedFilename()).toMatch(/L-2.*\.pdf$|\.pdf$/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pdf-export-run')).toHaveCount(0);
  // alle: Taste direkt unter der Liste
  await page.getByTestId('plans-pdf').click();
  await expect(page.getByTestId('pdf-export-run')).toBeVisible();
  expect(await checked()).toBeGreaterThanOrEqual(2);
});

test.describe('App-Leiste ohne bestätigte Anmeldung', () => {
  test.use({ signedIn: false });
  test('abgelaufene, gespeicherte Anmeldung ohne Verbindung: App-Seiten zeigen die App-Leiste, nicht die der Website', async ({ page }) => {
    // wie auf dem Handy ohne Empfang: Sitzung abgelaufen, der Dienst kann sie nicht erneuern
    const expired = { ...FAKE_SESSION, expires_at: 1700000100, expires_in: 0 };
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: SESSION_KEY, value: JSON.stringify(expired) });
    await page.goto('./baupad/tools');
    await expect(page.getByTestId('tools-title')).toBeVisible();
    await expect(page.getByTestId('site-nav')).toBeVisible();
    await expect(page.locator('.ps-chrome')).toHaveCount(0);
    await expect(page.getByTestId('nav-tools')).toBeVisible();
    await expect(page.getByTestId('nav-login')).toHaveCount(0); // gespeicherte Anmeldung: kein „Anmelden“
  });
});
