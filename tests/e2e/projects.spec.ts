import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { FIXTURES, OUT, createProject, freshStart, openPlan, selectCostCenter, tableRows, waitForPlan, waitSaved } from './helpers';

/**
 * Phase 2: Website und Navigation, Projektinformationen mit Kostenstelle, kompakte Planliste.
 */

test('Website: Startseite, Über uns, Kontakt, Impressum, Anmelden und Logo', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('PAD Software – BauPad');
  const nav = page.getByTestId('site-nav');
  await expect(nav).toBeVisible();
  // schwarze Navigationsleiste
  expect(await nav.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('BauPad. Die Baustelle in einer App.');
  await expect(page.locator('.hero-lead')).toContainText('Aufmaß, Arbeitereinteilung, Berichte und Fotos');
  await expect(page.getByTestId('device-stage').locator('img')).toHaveCount(3);
  await expect(page.getByTestId('faq').locator('details')).toHaveCount(5);
  await expect(page.getByTestId('product-card')).toHaveCount(4);
  await expect(page.getByTestId('product-card').nth(3)).toContainText('Fotodokumentation');
  // Produktseite: Bilder aus der App und Beispiel-Exporte
  await page.getByTestId('product-card').nth(3).click();
  await expect(page.getByTestId('product-title')).toHaveText('Fotodokumentation');
  await expect(page.getByTestId('product-shots').locator('img')).toHaveCount(4);
  await expect(page.getByTestId('product-exports').locator('img')).toHaveCount(1);
  await page.getByTestId('product-open').click();
  await expect(page.getByTestId('photos-title')).toHaveText('Fotodokumentation');
  await page.goto('./');

  await nav.getByRole('link', { name: 'Über uns' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Über uns');
  await expect(page).toHaveTitle('Über uns – BauPad');
  await expect(page.locator('.site-text')).toContainText('PAD Software');

  await nav.getByRole('link', { name: 'Kontakt' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kontakt');
  // noch keine Kontaktdaten → sichtbare Platzhalter, nichts erfunden
  await expect(page.getByTestId('contact-list').locator('.placeholder')).toHaveCount(5);

  // Impressum und Datenschutz über die Fußzeile (Firmendaten noch Platzhalter)
  await page.getByRole('link', { name: 'Impressum' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Impressum');
  await expect(page.getByTestId('imprint-list').locator('.placeholder')).toHaveCount(6); // Unternehmen hat schon „PAD Software“
  await page.getByRole('link', { name: 'Datenschutz' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Datenschutz');
  await expect(page.locator('.site-text')).toContainText('GitHub Pages');

  // Logo führt immer zur Startseite
  await nav.getByRole('link', { name: 'PAD Software – zur Startseite' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('BauPad. Die Baustelle in einer App.');

  // „Anmelden“: Anmeldeseite – Konten sind noch nicht eingerichtet, es wird nichts vorgetäuscht
  await nav.getByRole('link', { name: 'Anmelden' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Anmelden');
  await expect(page).toHaveTitle('Anmelden – BauPad');
  await expect(page.getByTestId('login-provider')).toHaveCount(3);
  await expect(page.getByTestId('login-provider').nth(0)).toContainText('Mit Google anmelden');
  await expect(page.getByTestId('login-provider').nth(2)).toContainText('Mit Microsoft (Outlook) anmelden');
  await page.getByTestId('login-provider').nth(0).click(); // Google: Dienst noch nicht angebunden → ehrlicher Hinweis
  await expect(page.getByTestId('login-unavailable')).toContainText('Die Anmeldung ist noch nicht eingerichtet.');
  await page.getByTestId('login-email').fill('test@example.com');
  await page.getByTestId('login-password').fill('geheim');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-unavailable')).toContainText('Die Anmeldung ist noch nicht eingerichtet.');
  expect(page.url()).toContain('#/anmelden'); // keine Weiterleitung, kein „angemeldet“
  // Registrieren: Pflichtfelder und Passwortregeln werden geprüft, bevor etwas gesendet würde
  await page.getByTestId('auth-tab-register').click();
  expect(page.url()).toContain('#/registrieren');
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
  await expect(page.getByTestId('login-unavailable')).toBeVisible();
  await page.getByTestId('auth-tab-login').click();
  await page.screenshot({ path: join(OUT, 'anmelden.png'), fullPage: true });
  // nach der Anmeldung zuerst die Tools, von dort in Aufmaß & Abrechnung
  await page.getByTestId('login-skip').click(); // ohne Konto direkt zu den Tools
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');
  // Einstellungen (Zahnrad) nur auf der Tools-Seite, nicht mehr in Aufmaß & Abrechnung
  await page.getByTestId('tool-projects').click();
  await expect(page.getByTestId('projects-title')).toHaveText('Aufmaß & Abrechnung');
  await expect(page.getByTestId('account-link')).toHaveCount(0);
  await page.getByTestId('to-tools').click();

  // Einstellungen: Kontobereich als Vorschau, alle Bereiche inaktiv
  await page.getByTestId('account-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Konto und Einstellungen');
  await expect(page.getByTestId('account-preview')).toContainText('nicht angemeldet');
  await expect(page.getByTestId('account-section')).toHaveText([
    /Persönliche Daten/,
    /E-Mail und Konto/,
    /Passwort und Anmeldemethoden/,
    /Abonnement und Zahlung/,
    /Firmeninformationen/,
    /Weitere Einstellungen/,
  ]);
  await expect(page.getByTestId('account-logout')).toBeDisabled();
  // Benutzer & Rollen: Admin trägt Benutzer mit Funktion, Werkzeugen und Paket ein (bleibt nach dem Neuladen)
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
  await ud.getByTestId('user-save').click();
  await expect(page.getByTestId('user-row')).toHaveCount(1);
  await expect(page.getByTestId('user-row')).toContainText('Polier');
  await expect(page.getByTestId('user-row')).toContainText('Arbeitereinteilung');
  await page.getByTestId('user-add').click();
  await ud.getByTestId('user-email').fill('polier@musterbau.at');
  await ud.getByTestId('user-name').fill('Doppelt');
  await ud.getByTestId('user-save').click();
  await expect(page.locator('.toast', { hasText: 'schon eingetragen' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByTestId('user-row')).toHaveCount(1);
  await page.screenshot({ path: join(OUT, 'konto.png'), fullPage: true });
  await page.getByRole('link', { name: 'Zu den Tools' }).click();
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');

  // Startseite (vor der Anmeldung): Knopf führt zu den Tools
  await page.goto('./');
  await expect(page.getByTestId('cta-tools')).toHaveText(/BauPad öffnen/);
  await page.getByTestId('cta-tools').click();
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');
});

test('Installierte App startet in den Tools (auch ältere Home-Bildschirm-Symbole)', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const page = await context.newPage();
  await page.goto('./'); // alte Startadresse
  await expect(page.getByTestId('tools-title')).toHaveText('Tools');
  await context.close();
});

test('Tools: vier gleich große Kacheln, zwei pro Reihe; alle vier Werkzeuge antippbar', async ({ page }) => {
  await page.goto('./#/tools');
  const tiles = page.locator('.tool-tile');
  await expect(tiles).toHaveCount(4);
  await expect(tiles.locator('strong')).toHaveText(['Aufmaß & Abrechnung', 'Arbeitereinteilung', 'Fotodokumentation', 'Berichte & Formulare']);
  const boxes = await Promise.all((await tiles.all()).map((t) => t.boundingBox()));
  // 2 × 2, alle gleich groß
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
  expect(Math.abs(boxes[2]!.y - boxes[3]!.y)).toBeLessThan(1);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
  for (const b of boxes) {
    expect(Math.abs(b!.width - boxes[0]!.width)).toBeLessThan(1);
    expect(Math.abs(b!.height - boxes[0]!.height)).toBeLessThan(1);
  }
  // alle vier Werkzeuge sind antippbar
  await expect(page.getByTestId('tool-soon')).toHaveCount(0);
  await page.screenshot({ path: join(OUT, 'tools.png'), fullPage: true });
  // Arbeitereinteilung und zurück
  await page.getByTestId('tool-workers').click();
  await expect(page.getByTestId('workers-title')).toHaveText('Arbeitereinteilung');
  await expect(page.getByTestId('crew-week')).toBeVisible();
  await page.getByTestId('to-tools').click();
  await expect(page.getByTestId('tools-title')).toBeVisible();
  // Aufmaß & Abrechnung → zurück zu den Tools
  await page.getByTestId('tool-projects').click();
  await expect(page.getByTestId('projects-title')).toHaveText('Aufmaß & Abrechnung');
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

  // Planliste: Plannummer, Bezeichnung, Ebene, Bemerkung, Leistungen, Anzahl, Fläche
  const row = page.getByTestId('plan-row').filter({ hasText: '067' });
  await expect(row).toContainText('Untergeschoss');
  await expect(row).toContainText('UG2');
  await expect(row.getByTestId('plan-note')).toHaveText('Bereich Tiefgarage Nord');
  await expect(row).toContainText('Keine Leistungszuordnung');
  await expect(row.getByTestId('plan-count')).toContainText('2');
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
