import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  FIXTURES,
  OUT,
  catchDownload,
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
  await createProject(page, 'Parkhaus Nord', { site: 'Parkdeck 2' }, ['Parkdeck']);
  await noHorizontalScroll(page);



  // Foto mit EXIF-Ausrichtung (Hochformat) importieren
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'foto.jpg'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('F-01');
  await wiz.locator('[data-field="planName"]').fill('Wand Ost');
  await wiz.getByTestId('import-save').click();
  // Ein einzelner Plan wird direkt geöffnet
  await waitForPlan(page);
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();

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
  await expect(dlg.getByTestId('input-number')).toHaveValue('1');
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
  await expect(dlg.getByTestId('input-number')).toHaveValue('2');
  await dlg.getByTestId('input-length').fill('2,4');
  await dlg.getByTestId('input-width').fill('1,1');
  await dlg.getByTestId('input-depth').fill('0,06');
  await dlg.getByTestId('damage-save').tap();
  await expect(dlg).toBeHidden();
  await waitSaved(page);

  // 3) Pinch-Zoom mit zwei Fingern – Markierungen bleiben exakt an ihrer Planposition
  const before = await markerRelPos(page, 2);
  const scale0 = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const vb = (await page.getByTestId('plan-viewer').boundingBox())!;
  await pinch(cdp, { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 }, 80, 240);
  const scale1 = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  expect(scale1).toBeGreaterThan(scale0 * 2);
  const after = await markerRelPos(page, 2);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(after[k] - before[k])).toBeLessThan(0.003);
  // Zwei Finger erzeugen keine Markierung
  expect(await page.locator('.damage-label').count()).toBe(2);
  await expect(dlg).toBeHidden();

  // 4) Verschieben mit einem Finger im Auswahlmodus
  await page.getByTestId('tool-select').tap();
  await touchDrag(cdp, { x: vb.x + 60, y: vb.y + 80 }, { x: vb.x + 160, y: vb.y + 150 });
  const afterPan = await markerRelPos(page, 2);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(afterPan[k] - before[k])).toBeLessThan(0.003);
  await page.getByRole('button', { name: 'Gesamten Plan anzeigen' }).tap();

  // 5) Tabelle
  await page.getByTestId('mobile-tab-table').tap();
  expect((await tableRows(page)).map((r) => [r[0], r[4]])).toEqual([
    ['1', '0,50'],
    ['2', '2,64'],
  ]);
  await page.locator('[data-testid="aufmass-row"][data-number="2"]').tap();
  await expect(page.getByTestId('plan-viewer')).toBeVisible();
  await expect(page.getByTestId('selection-bar')).toContainText('Nr. 2');
  await noHorizontalScroll(page);

  // 6) Bearbeiten über die Auswahlleiste
  await page.getByTestId('edit-selected').tap();
  await dlg.getByTestId('input-width').fill('1,5');
  await dlg.getByTestId('damage-save').tap();
  await expect(page.getByTestId('selection-bar')).toContainText('3,60 m²');
  // Alle Werkzeuge und Rückgängig/Wiederholen sind per Finger erreichbar, nichts ragt über den Rand
  const vw = page.viewportSize()!.width;
  for (const t of ['select', 'line', 'rect', 'ellipse', 'triangle', 'freehand', 'component']) {
    const b = (await page.getByTestId(`tool-${t}`).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(vw + 0.5);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByTestId('undo')).toBeVisible();
  // Plannummer bleibt in der Kopfzeile lesbar
  expect((await page.getByTestId('plan-select').boundingBox())!.width).toBeGreaterThanOrEqual(70);
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `${info.project.name}-editor.png`) });

  // 7) Excel-Export über den Dialog „Datei bereit“
  const dl = await catchDownload(page, () => page.getByTestId('export-xlsx-plan').tap());
  const wb = readXlsx(await saveDownload(dl, `${info.project.name}-plan.xlsx`));
  expect(wb['C-301'].slice(2, 4).map((r) => r.map((c) => c?.v))).toEqual([
    [1, 1.25, 0.4, 0.03, 0.5],
    [2, 2.4, 1.5, 0.06, 3.6],
  ]);

  // 8) PDF-Export beider Bildpläne
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).tap();
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
    await page.getByTestId('plan-row').filter({ hasText: 'C-301' }).getByTestId('plan-open').tap();
    await waitForPlan(page);
    await expect(page.getByTestId('mobile-tab-table')).toBeHidden();
    await expect(page.getByTestId('aufmass-table')).toBeVisible();
    await expect(page.getByTestId('plan-viewer')).toBeVisible();
    await page.locator('[data-testid="aufmass-row"][data-number="1"]').tap();
    await expect(page.getByTestId('selection-bar')).toContainText('Nr. 1');
    await noHorizontalScroll(page);
    await page.screenshot({ path: join(OUT, 'ipad-quer-editor.png') });
  }
});

test('Erstnutzer: vom neuen Projekt bis zum importierten PDF', async ({ page }) => {
  await freshStart(page);
  // Startseite erklärt, wo Pläne importiert werden
  await expect(page.locator('.home-hint')).toContainText('Projekt öffnen → „Plan importieren“');
  // Projekt und Kostenstelle in einem Schritt
  await page.getByTestId('new-project').tap();
  const form = page.getByTestId('project-form');
  await form.locator('input[name="name"]').fill('Erster Test');
  await form.getByTestId('cost-center-input').fill('Tiefgarage');
  await form.getByRole('button', { name: 'Projekt anlegen' }).tap();
  // Projektseite mit Kostenstelle und (leerer) Planliste öffnet sich direkt
  await expect(page.getByTestId('project-cost-centers')).toHaveText('Tiefgarage');
  await expect(page.getByTestId('cost-center-switch')).toHaveCount(0); // nur eine Kostenstelle → keine Auswahl
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

test('Website und Planliste auf Smartphone/Tablet: Menü, keine Überbreite, Aktionen per Finger', async ({ page }, info) => {
  const isPhone = info.project.name === 'iphone';
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dein Aufmaß. Direkt im Plan.');
  await noHorizontalScroll(page);
  const nav = page.getByTestId('site-nav');
  if (isPhone) {
    // „Über BauPad“ und „Kontakt“ liegen im ausklappbaren Menü
    await expect(nav.getByRole('link', { name: 'Kontakt' })).toBeHidden();
    await nav.getByRole('button', { name: 'Menü öffnen' }).tap();
    await expect(nav.getByRole('link', { name: 'Kontakt' })).toBeVisible();
    await nav.getByRole('link', { name: 'Kontakt' }).tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kontakt');
    await expect(nav.getByRole('link', { name: 'Kontakt' })).toBeHidden(); // Menü schließt sich
  } else {
    await nav.getByRole('link', { name: 'Kontakt' }).tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kontakt');
  }
  await noHorizontalScroll(page);
  await expect(nav.getByRole('link', { name: 'Anmelden' })).toBeVisible();
  await page.screenshot({ path: join(OUT, `${info.project.name}-kontakt.png`) });

  // Planliste mit langer Bemerkung
  await freshStart(page);
  await createProject(page, 'Liste', {}, [{ number: '4711', name: 'Tiefgarage' }]);
  for (const [no, note] of [
    ['067', 'Bereich Tiefgarage Nord mit sehr langer Bemerkung, die auf dem Smartphone umbrechen muss'],
    ['068', ''],
  ]) {
    await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
    const wiz = page.getByTestId('import-wizard');
    await wiz.getByTestId('areas-next').tap();
    await wiz.locator('[data-field="planNumber"]').fill(no);
    await wiz.locator('[data-field="planName"]').fill('Untergeschoss');
    await wiz.locator('[data-field="floor"]').fill('UG2');
    await wiz.locator('[data-field="description"]').fill(note);
    await wiz.getByTestId('import-save').tap();
    await waitForPlan(page);
    await page.getByRole('link', { name: 'Zurück zur Planliste' }).tap();
  }
  await expect(page.getByTestId('plan-row')).toHaveCount(2);
  await noHorizontalScroll(page);
  // Liste bleibt kompakt (keine großen Karten)
  const h = (await page.getByTestId('plan-row').first().boundingBox())!.height;
  expect(h).toBeLessThan(isPhone ? 170 : 90);
  // Aktionsmenü per Finger bedienbar und vollständig im Bild
  await page.getByTestId('plan-row').last().getByTestId('plan-actions').tap();
  const menu = page.locator('.action-menu');
  await expect(menu).toBeVisible();
  const mb = (await menu.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(mb.x).toBeGreaterThanOrEqual(0);
  expect(mb.x + mb.width).toBeLessThanOrEqual(vp.width);
  expect(mb.y + mb.height).toBeLessThanOrEqual(vp.height);
  // 44 px Mindesthöhe (Toleranz für Rundung durch die Bildschirmskalierung)
  for (const item of await menu.getByRole('menuitem').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await page.screenshot({ path: join(OUT, `${info.project.name}-planliste.png`) });
  await page.getByTestId('action-open').tap();
  await waitForPlan(page);
});

test('Plan zeichnen per Finger: Raum über Maßeingabe, Bemaßung sichtbar, Weiter zum Aufmaß', async ({ page }, info) => {
  await freshStart(page);
  await createProject(page, 'Skizze', {}, ['Keller']);
  await page.getByTestId('draw-plan').tap();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('S-1');
  await nd.getByTestId('new-drawing-save').tap();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await page.getByTestId('draw-rect').tap();
  await page.getByTestId('insert-length').fill('5');
  await page.getByTestId('insert-width').fill('3,65');
  await page.getByTestId('insert-submit').tap();
  await expect(page.locator('.dims [data-dim="5,00 m"]')).toBeVisible();
  await expect(page.locator('.dims [data-dim="3,65 m"]')).toBeVisible();
  await expect(page.getByTestId('element-bar')).toBeVisible();
  // Leisten und Werkzeuge passen auf den Bildschirm
  const vw = page.viewportSize()!.width;
  for (const id of ['element-bar', 'draw-toolbar', 'mode-bar']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(vw + 0.5);
  }
  for (const t of ['select', 'line', 'rect', 'ellipse', 'triangle', 'freehand', 'dimension', 'text']) {
    expect((await page.getByTestId(`draw-${t}`).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `${info.project.name}-zeichnen.png`) });
  // Weiter zum Aufmaß: Zeichnung bleibt, Markierungswerkzeuge erscheinen
  await page.getByTestId('mode-measure').tap();
  await expect(page.getByTestId('tool-rect')).toBeVisible();
  await expect(page.locator('[data-element="rect"]')).toHaveCount(1);
  await waitSaved(page);
  await noHorizontalScroll(page);
});
