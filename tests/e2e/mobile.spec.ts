import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  FIXTURES,
  OUT,
  catchDownload,
  createCostCenter,
  createProject,
  freshStart,
  markerRelPos,
  planBox,
  readXlsx,
  saveDownload,
  tableRows,
  waitForPlan,
  waitSaved,
} from './helpers';

/**
 * Wesentliche Abläufe auf iPhone und iPad (Touch-Bedienung, Pinch-Zoom, kleine Bildschirme).
 * Läuft in den Projekten „iphone“ und „ipad“ (Chromium mit Touch-Emulation).
 */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wischbewegung mit realistischer Geschwindigkeit; der Finger ruht kurz vor dem Loslassen. */
async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1 }],
    });
  }
  await pause(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x, y: to.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function pinch(cdp: CDPSession, c: { x: number; y: number }, fromDist: number, toDist: number, steps = 10) {
  const pts = (d: number) => [
    { x: c.x - d / 2, y: c.y, id: 1 },
    { x: c.x + d / 2, y: c.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(fromDist) });
  for (let i = 1; i <= steps; i++) {
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(fromDist + ((toDist - fromDist) * i) / steps) });
  }
  await pause(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('Mobile Bedienung: Bildimport, Einzeichnen per Touch, Pinch-Zoom, Tabelle, Exporte', async ({ page }, info) => {
  const isPhone = info.project.name === 'iphone';
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await freshStart(page);
  await noHorizontalScroll(page);
  await createProject(page, 'Parkhaus Nord', { site: 'Parkdeck 2' });
  await noHorizontalScroll(page);
  await createCostCenter(page, 'Parkdeck');
  await page.getByTestId('cost-center-card').click();

  // Foto mit EXIF-Ausrichtung (Hochformat) importieren
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'foto.jpg'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('F-01');
  await wiz.locator('[data-field="planName"]').fill('Wand Ost');
  await wiz.getByTestId('import-save').click();
  // Ein einzelner Plan wird direkt geöffnet
  await waitForPlan(page);
  await page.getByRole('link', { name: 'Zur Kostenstelle' }).click();

  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('C-301');
  await wiz.locator('[data-field="planName"]').fill('Parkdeck');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await noHorizontalScroll(page);

  // Bedienelemente groß genug für Touch
  for (const id of ['tool-select', 'tool-ellipse', 'tool-rect', 'tool-freehand']) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
    expect(b!.width).toBeGreaterThanOrEqual(44);
  }
  // Schmale Bildschirme (iPhone, iPad hochkant): Plan und Tabelle über Reiter umschaltbar
  await expect(page.getByTestId('mobile-tab-table')).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  const box = await planBox(page);

  // 1) Antippen mit dem Kreis-Werkzeug erzeugt eine Markierung in Standardgröße
  await page.getByTestId('tool-ellipse').tap();
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.4);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('input-number')).toHaveValue('0');
  await expect(dlg.getByTestId('input-length')).toHaveAttribute('inputmode', 'decimal');
  await expect(dlg.getByTestId('input-number')).toHaveAttribute('inputmode', 'numeric');
  await expect(dlg.getByTestId('input-depth')).toHaveAttribute('enterkeyhint', 'done');
  if (isPhone) {
    // Dialog erscheint als Bottom-Sheet am unteren Rand (Einhandbedienung)
    const mb = await page.locator('.modal').boundingBox();
    expect(Math.round(mb!.y + mb!.height)).toBeGreaterThanOrEqual(843);
  }
  await dlg.getByTestId('input-length').fill('1,25');
  await dlg.getByTestId('input-width').fill('0,4');
  await dlg.getByTestId('input-depth').fill('0,03');
  await expect(dlg.getByTestId('area-result')).toContainText('0,50 m²');
  await dlg.getByTestId('damage-save').tap();
  await expect(dlg).toBeHidden();

  // 2) Rechteck mit dem Finger aufziehen
  await page.getByTestId('tool-rect').tap();
  await touchDrag(cdp, { x: box.x + box.width * 0.55, y: box.y + box.height * 0.5 }, { x: box.x + box.width * 0.75, y: box.y + box.height * 0.65 });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('input-number')).toHaveValue('1');
  await dlg.getByTestId('input-length').fill('2,4');
  await dlg.getByTestId('input-width').fill('1,1');
  await dlg.getByTestId('input-depth').fill('0,06');
  await dlg.getByTestId('damage-save').tap();
  await expect(dlg).toBeHidden();
  await waitSaved(page);

  // 3) Pinch-Zoom mit zwei Fingern – Markierungen bleiben exakt an ihrer Planposition
  const before = await markerRelPos(page, 1);
  const scale0 = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const vb = (await page.getByTestId('plan-viewer').boundingBox())!;
  await pinch(cdp, { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 }, 80, 240);
  const scale1 = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  expect(scale1).toBeGreaterThan(scale0 * 2);
  const after = await markerRelPos(page, 1);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(after[k] - before[k])).toBeLessThan(0.003);
  // Zwei Finger erzeugen keine Markierung
  expect(await page.locator('.damage-label').count()).toBe(2);
  await expect(dlg).toBeHidden();

  // 4) Verschieben mit einem Finger im Auswahlmodus
  await page.getByTestId('tool-select').tap();
  await touchDrag(cdp, { x: vb.x + 60, y: vb.y + 80 }, { x: vb.x + 160, y: vb.y + 150 });
  const afterPan = await markerRelPos(page, 1);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(afterPan[k] - before[k])).toBeLessThan(0.003);
  await page.getByRole('button', { name: 'Gesamten Plan anzeigen' }).tap();

  // 5) Tabelle
  await page.getByTestId('mobile-tab-table').tap();
  expect((await tableRows(page)).map((r) => [r[0], r[4]])).toEqual([
    ['0', '0,50'],
    ['1', '2,64'],
  ]);
  await page.locator('[data-testid="aufmass-row"][data-number="1"]').tap();
  await expect(page.getByTestId('plan-viewer')).toBeVisible();
  await expect(page.getByTestId('selection-bar')).toContainText('Nr. 1');
  await noHorizontalScroll(page);

  // 6) Bearbeiten über die Auswahlleiste
  await page.getByTestId('edit-selected').tap();
  await dlg.getByTestId('input-width').fill('1,5');
  await dlg.getByTestId('damage-save').tap();
  await expect(page.getByTestId('selection-bar')).toContainText('3,60 m²');

  // 7) Excel-Export über den Dialog „Datei bereit“
  const dl = await catchDownload(page, () => page.getByTestId('export-xlsx-plan').tap());
  const wb = readXlsx(await saveDownload(dl, `${info.project.name}-plan.xlsx`));
  expect(wb['C-301'].slice(1, 3).map((r) => r.map((c) => c?.v))).toEqual([
    ['C-301', 0, 1.25, 0.4, 0.03, 0.5],
    ['C-301', 1, 2.4, 1.5, 0.06, 3.6],
  ]);

  // 8) PDF-Export beider Bildpläne
  await page.getByRole('link', { name: 'Zur Kostenstelle' }).tap();
  const dl2 = await catchDownload(page, async () => {
    await page.getByRole('button', { name: 'PDF – Pläne auswählen' }).tap();
    await page.getByTestId('pdf-export-run').tap();
  });
  const pdf = await saveDownload(dl2, `${info.project.name}-plaene.pdf`);
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Pages:\s+2/);
  execFileSync('pdftoppm', ['-png', '-r', '40', pdf, join(OUT, `${info.project.name}-export`)]);

  // Hochformat-Foto: Abmessungen mit angewendeter EXIF-Ausrichtung gespeichert
  const dims = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open('schadstellen-aufmass');
      r.onsuccess = () => res(r.result);
    });
    const all: any[] = await new Promise((res) => {
      const r = db.transaction('plans').objectStore('plans').getAll();
      r.onsuccess = () => res(r.result);
    });
    db.close();
    return Object.fromEntries(all.map((p) => [p.planNumber, [p.pageWidth, p.pageHeight]]));
  });
  expect(dims['F-01']).toEqual([1200, 1600]);
  expect(dims['C-301']).toEqual([1400, 1000]);
  await page.screenshot({ path: join(OUT, `${info.project.name}-kostenstelle.png`) });

  if (!isPhone) {
    // iPad quer: Plan und Tabelle nebeneinander
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.getByTestId('plan-card').filter({ hasText: 'C-301' }).tap();
    await waitForPlan(page);
    await expect(page.getByTestId('mobile-tab-table')).toBeHidden();
    await expect(page.getByTestId('aufmass-table')).toBeVisible();
    await expect(page.getByTestId('plan-viewer')).toBeVisible();
    await page.locator('[data-testid="aufmass-row"][data-number="0"]').tap();
    await expect(page.getByTestId('selection-bar')).toContainText('Nr. 0');
    await noHorizontalScroll(page);
    await page.screenshot({ path: join(OUT, 'ipad-quer-editor.png') });
  }
});

test('Erstnutzer: vom neuen Projekt bis zum importierten PDF', async ({ page }) => {
  await freshStart(page);
  // Startseite erklärt, wo Pläne importiert werden
  await expect(page.locator('.home-hint')).toContainText('Kostenstelle öffnen → „Plan importieren“');
  await createProjectOnly(page);
  await page.getByRole('button', { name: 'Erste Kostenstelle anlegen' }).tap();
  await page.getByTestId('prompt-dialog').locator('input').fill('Tiefgarage');
  await page.getByTestId('prompt-dialog').getByRole('button', { name: 'Anlegen' }).tap();
  // Neue Kostenstelle öffnet sich direkt
  await expect(page.getByTestId('cost-center-title')).toHaveText('Tiefgarage');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'PDF oder Foto auswählen' }).tap(),
  ]);
  expect(await chooser.element().getAttribute('accept')).toContain('application/pdf');
  await chooser.setFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('page-tile').nth(1).tap();
  await wiz.getByTestId('pages-next').tap();
  await wiz.getByTestId('areas-next').tap();
  await wiz.locator('[data-field="planNumber"]').fill('A-101');
  await wiz.getByTestId('import-save').tap();
  await waitForPlan(page);
  await expect(page.getByTestId('plan-select')).toContainText('A-101');
});

async function createProjectOnly(page: import('@playwright/test').Page) {
  await page.getByTestId('new-project').tap();
  await page.getByTestId('project-form').locator('input[name="name"]').fill('Erster Test');
  await page.getByTestId('project-form').getByRole('button', { name: 'Projekt anlegen' }).tap();
  await expect(page.getByTestId('project-title')).toHaveText('Erster Test');
}
