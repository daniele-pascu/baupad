import { expect, signInInPage, signOutInPage, test, type CDPSession, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  excelExport,
  FIXTURES,
  OUT,
  catchDownload,
  createProject,
  freshStart,
  markerRelPos,
  planBox,
  blattRows,
  readXlsx,
  saveDownload,
  tableRows,
  waitForPlan,
  waitSaved,
  pickTool,
  openTools,
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
  // gegen die Bildschirmbreite prüfen – auf Mobilgeräten wächst innerWidth mit zu breitem Inhalt mit
  const screen = page.viewportSize()!.width;
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));
  expect(width - screen).toBeLessThanOrEqual(1);
}

test('Mobile Bedienung: Bildimport, Einzeichnen per Touch, Pinch-Zoom, Tabelle, Exporte', async ({ page }, info) => {
  const isPhone = info.project.name === 'iphone';
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await freshStart(page);
  await noHorizontalScroll(page);
  await createProject(page, 'Parkhaus Nord', { address: 'Parkdeck 2' }, ['Parkdeck']);
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
  for (const id of ['tool-select', 'tool-ellipse', 'tool-rect', 'tool-polyline']) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
    expect(b!.width).toBeGreaterThanOrEqual(44);
  }
  // Schmale Bildschirme (iPhone, iPad hochkant): Plan und Tabelle über Reiter umschaltbar
  await expect(page.getByTestId('mobile-tab-table')).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  const box = await planBox(page);

  // 1) Antippen mit dem Kreis-Werkzeug erzeugt eine Markierung in Standardgröße
  await pickTool(page, 'tool-ellipse', 'tap');
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.4);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('input-number')).toHaveValue('1');
  await expect(dlg.getByTestId('input-length')).toHaveAttribute('inputmode', 'decimal');
  // Nr. erlaubt Zahlen und Buchstaben (z. B. 12a) – Texttastatur, Buchstaben groß
  await expect(dlg.getByTestId('input-number')).toHaveAttribute('inputmode', 'text');
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
  await pickTool(page, 'tool-rect', 'tap');
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
  await pickTool(page, 'tool-select', 'tap');
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
  for (const t of ['select', 'line', 'rect', 'ellipse', 'polyline', 'wall', 'probe']) {
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
  const dl = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan', 'tap'));
  const wb = readXlsx(await saveDownload(dl, `${info.project.name}-plan.xlsx`));
  expect(blattRows(wb, 'C-301').map((r) => [r.nr, r.values['Länge'], r.values['Breite'], r.values['Tiefe'], r.values['m²']])).toEqual([
    [1, 1.25, 0.4, 0.03, 0.5],
    [2, 2.4, 1.5, 0.06, 3.6],
  ]);

  // 8) PDF-Export beider Bildpläne
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).tap();
  // Projektseite mit Aufmaß-Tabelle: nicht breiter als der Bildschirm (Tabelle scrollt in sich)
  await page.getByTestId('aufmass-section').getByTestId('aufmass-toggle').first().tap(); // Aufmaß aufklappen
  await expect(page.getByTestId('aufmass-section').getByTestId('aufmass-table')).toBeVisible();
  await noHorizontalScroll(page);
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
  // Website ohne Anmeldung ansehen (angemeldet führt die Startseite direkt zu den Tools)
  await page.goto('./#/impressum');
  await signOutInPage(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leichter gemacht');
  await noHorizontalScroll(page);
  const nav = page.getByTestId('site-nav');
  const menuBtn = nav.getByRole('button', { name: 'Menü öffnen' });
  const kontakt = nav.getByRole('link', { name: 'Kontakt', exact: true });
  if (await menuBtn.isVisible()) {
    // Seiten liegen im ausklappbaren Menü (Handy und schmales Tablet)
    await expect(kontakt).toBeHidden();
    await menuBtn.tap();
    await expect(kontakt).toBeVisible();
    await kontakt.tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schreiben Sie uns.');
    await expect(kontakt).toBeHidden(); // Menü schließt sich
    await nav.getByRole('button', { name: 'Menü öffnen' }).tap();
    await expect(nav.getByRole('link', { name: 'Anmelden' })).toBeVisible();
    await nav.getByRole('button', { name: 'Menü schließen' }).tap();
  } else {
    await kontakt.tap();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schreiben Sie uns.');
    await expect(nav.getByRole('link', { name: 'Anmelden' })).toBeVisible();
  }
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `${info.project.name}-kontakt.png`) });

  // Planliste mit langer Bemerkung (wieder angemeldet)
  await signInInPage(page);
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
  // (nach dem Aufklappen gemessen – während der Animation ist das Menü kurz kleiner)
  for (const item of await menu.getByRole('menuitem').all()) await expect.poll(async () => (await item.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
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
  await pickTool(page, 'draw-rect', 'tap');
  await page.getByTestId('insert-length').fill('5');
  await page.getByTestId('insert-width').fill('3,65');
  await page.getByTestId('insert-submit').tap();
  await expect(page.locator('.dims [data-dim="5,00 m"]')).toBeVisible();
  await expect(page.locator('.dims [data-dim="3,65 m"]')).toBeVisible();
  await expect(page.getByTestId('element-bar')).toBeVisible();
  // Leisten und Werkzeuge passen auf den Bildschirm
  const vw = page.viewportSize()!.width;
  for (const id of ['element-bar', 'draw-toolbar', 'mode-bar', 'mode-measure', 'grid-toggle']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(vw + 0.5);
  }
  // Registerkarten der oberen Leiste: jede Zeile per Finger wischbar, Knöpfe mindestens 44 px
  for (const [tab, ids] of [
    ['draw', ['select', 'line', 'polyline', 'polygon', 'rect', 'ellipse', 'arc', 'text', 'delete', 'undo', 'redo']],
    ['modify', ['move', 'copy', 'rotate', 'scale', 'stretch', 'trim', 'extend']],
    ['measure', ['dimension']],
  ] as const) {
    await page.getByTestId(`ribbon-tab-${tab}`).tap();
    for (const t of ids) {
      const b = page.getByTestId(`draw-${t}`);
      await b.scrollIntoViewIfNeeded();
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.getByTestId('ribbon-tab-draw').tap();
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `${info.project.name}-zeichnen.png`) });
  // Weiter zum Aufmaß: Zeichnung bleibt, Markierungswerkzeuge erscheinen
  await page.getByTestId('mode-measure').tap();
  await expect(page.getByTestId('tool-rect')).toBeVisible();
  await expect(page.locator('[data-element="rect"]')).toHaveCount(1);
  await waitSaved(page);
  await noHorizontalScroll(page);
});

test('Darstellung einer Messung per Finger: Bedienfeld passt auf den Bildschirm', async ({ page }, info) => {
  await freshStart(page);
  await createProject(page, 'Stil mobil', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').tap();
  await wiz.locator('[data-field="planNumber"]').fill('M-1');
  await wiz.getByTestId('import-save').tap();
  await waitForPlan(page);
  const box = await planBox(page);
  await pickTool(page, 'tool-ellipse', 'tap');
  await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.3);
  const dlg = page.getByTestId('damage-dialog');
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('damage-save').tap();
  await page.getByTestId('style-toggle').tap();
  const panel = page.getByTestId('style-panel');
  await panel.getByTestId('style-line-type').selectOption('dashdot');
  await panel.getByRole('button', { name: 'Füllfarbe Gelb' }).tap();
  const vw = page.viewportSize()!.width;
  const b = (await page.getByTestId('selection-bar').boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width).toBeLessThanOrEqual(vw + 0.5);
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `${info.project.name}-darstellung.png`) });
});

test('LV/MFK manuell per Finger: Tabelle passt auf den Bildschirm, Enter legt die nächste Position an', async ({ page }, info) => {
  await freshStart(page);
  await createProject(page, 'Manuell mobil', {}, ['Hof']);
  await page.getByTestId('lv-new').tap();
  const dlg = page.getByTestId('lv-doc-dialog');
  await dlg.getByTestId('lv-doc-name').fill('Zusatz');
  const rows = dlg.getByTestId('lv-grid-row');
  await rows.nth(0).getByTestId('grid-shortText').tap();
  await page.keyboard.type('Fugen schneiden');
  await rows.nth(0).getByTestId('grid-unit').fill('m');
  await rows.nth(0).getByTestId('grid-unitPrice').fill('12,5');
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByTestId('grid-number')).toHaveValue('2');
  await page.keyboard.type('Kernbohrung');
  await noHorizontalScroll(page);
  // Speichern-Knopf erreichbar
  const save = dlg.getByTestId('lv-doc-save');
  const b = (await save.boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await page.screenshot({ path: join(OUT, `${info.project.name}-lv-manuell.png`) });
  await save.tap();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('lv-row')).toHaveCount(2);
});

test('Rechnung anlegen per Finger: vier Arten passen auf den Bildschirm', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Rechnung mobil');
  await page.getByTestId('split-invoices').tap();
  const dlg = page.getByTestId('invoice-dialog');
  await expect(dlg.getByRole('radio')).toHaveCount(4);
  await dlg.getByTestId('invoice-kind-r').tap();
  await expect(dlg.getByTestId('invoice-kind-r')).toHaveAttribute('aria-checked', 'true');
  const box = (await dlg.boundingBox())!;
  for (const r of await dlg.getByRole('radio').all()) {
    const b = (await r.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  await noHorizontalScroll(page);
  await dlg.getByTestId('invoice-save').tap();
  await expect(page.getByTestId('invoice-tab')).toContainText('R 1');
});

test('Tools per Finger: 2 Kacheln pro Reihe, nichts zu breit, Aufmaß & Abrechnung öffnet', async ({ page }, info) => {
  await page.goto('./#/tools');
  const tiles = page.locator('.tool-tile');
  await expect(tiles).toHaveCount(5); // fünf Werkzeuge seit dem Mängelplan
  const [a, b, c] = await Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox(), tiles.nth(2).boundingBox()]);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(1); // zwei nebeneinander
  expect(c!.y).toBeGreaterThan(a!.y + a!.height - 1);
  expect(a!.width).toBeGreaterThan(130); // gut antippbar
  // Ein-Wort-Titel einzeilig (keine abgebrochenen Wörter wie „Projektverwaltun-g“)
  for (const t of await tiles.locator('strong').all()) {
    if ((await t.textContent())!.includes(' ')) continue;
    const lh = await t.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3);
    expect((await t.boundingBox())!.height).toBeLessThan(lh * 1.5);
  }
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `tools-${info.project.name}.png`), fullPage: true });
  await page.getByTestId('tool-projects').tap();
  await expect(page.getByTestId('projects-title')).toBeVisible();
});

test('Arbeitereinteilung per Finger: Arbeiter, Baustelle, Einteilung – passt auf den Bildschirm', async ({ page }, info) => {
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('crew-workers').tap();
  const wd = page.getByTestId('workers-dialog');
  for (const n of ['Max', 'Peter']) {
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').tap();
  }
  await expect(wd.getByTestId('worker-row')).toHaveCount(2);
  await wd.getByRole('button', { name: 'Schließen' }).tap();
  await page.getByTestId('add-site').tap();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Neubau Musterstraße');
  await page.getByTestId('site-dialog').getByTestId('site-save').tap();
  await page.locator('[data-testid="day-row"][data-day="0"] [data-testid="day-add"]').tap();
  const ad = page.getByTestId('assign-dialog');
  await ad.locator('[data-worker="Max"] input').tap();
  await ad.getByTestId('assign-save').tap();
  await expect(page.locator('[data-testid="day-row"][data-day="0"] [data-testid="crew-chip"]')).toHaveText(['Max']);
  await expect(page.getByTestId('crew-open').getByTestId('open-chip')).toHaveCount(5); // Peter Mo–Fr
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `arbeiter-${info.project.name}.png`), fullPage: true });

  // Ziehen per Finger: kurz gedrückt halten, dann auf die andere Baustelle ziehen
  await page.getByTestId('add-site').tap();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Sanierung');
  await page.getByTestId('site-dialog').getByTestId('site-save').tap();
  const cdp = await page.context().newCDPSession(page);
  const chipA = page.locator('[data-site="Neubau Musterstraße"] [data-testid="day-row"][data-day="4"] [data-testid="crew-chip"]');
  const rowB = page.locator('[data-site="Sanierung"] [data-testid="day-row"][data-day="0"]');
  await chipA.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const center = async (l: typeof chipA) => {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // schnelles Wischen über einen Namen scrollt nur – kein Ziehen
  const s0 = await page.evaluate(() => scrollY);
  const c = await center(chipA);
  await touchDrag(cdp, c, { x: c.x, y: c.y + 150 }); // nach unten wischen → Seite scrollt nach oben
  await expect(page.getByTestId('crew-ghost')).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBeLessThan(s0);
  await chipA.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  // gedrückt halten → anheben → ziehen
  const from = await center(chipA);
  const to = await center(rowB);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  await pause(500);
  await expect(page.getByTestId('crew-ghost')).toBeVisible();
  // Kasten knapp über dem Finger (sichtbar, nicht verdeckt, nicht weit weg)
  const g = (await page.getByTestId('crew-ghost').boundingBox())!;
  expect(g.y + g.height).toBeLessThan(from.y);
  expect(from.y - (g.y + g.height)).toBeLessThan(40);
  expect(from.x).toBeGreaterThan(g.x);
  expect(from.x).toBeLessThan(g.x + g.width);
  for (let i = 1; i <= 10; i++) {
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10, id: 1 }] });
  }
  await expect(rowB).toHaveClass(/drop-over/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('crew-ghost')).toHaveCount(0);
  for (const d of [0, 4]) {
    await expect(page.locator(`[data-site="Sanierung"] [data-day="${d}"] [data-testid="crew-chip"]`)).toHaveText(['Max']);
    await expect(page.locator(`[data-site="Neubau Musterstraße"] [data-day="${d}"] [data-testid="crew-chip"]`)).toHaveCount(0);
  }
  await expect(page.getByTestId('chip-dialog')).toHaveCount(0); // kein Menü durch das Loslassen
});

test('Berichte per Finger: Regieliste, Tagesbericht und Wochenbericht passen auf den Bildschirm', async ({ page }, info) => {
  for (const type of ['regie', 'tag', 'woche'] as const) {
    await page.goto('./#/berichte'); // Übersicht (der Zurück-Pfeil führt zur Baustelle)
    await page.getByTestId('report-new').tap();
    const d = page.getByTestId('report-new-dialog');
    await d.getByTestId(`report-type-${type}`).tap();
    if ((await d.getByTestId('report-site').inputValue()) === '') {
      await d.getByTestId('report-site').selectOption('__new');
      await page.getByTestId('photo-site-name').fill('Halle 3');
      await page.getByTestId('photo-site-save').tap();
    }
    await d.getByTestId('report-create').tap();
    await expect(page.getByTestId('report-title')).toBeVisible();
    if (type !== 'woche') {
      await page.getByTestId('crew-add').selectOption('frei');
      await page.locator('.rp-name').first().fill('Hans Huber');
    }
    await noHorizontalScroll(page);
    await page.screenshot({ path: join(OUT, `bericht-${type}-${info.project.name}.png`), fullPage: true });
    await page.getByTestId('to-reports').tap();
  }
  await expect(page.getByTestId('report-item')).toHaveCount(3);
  await noHorizontalScroll(page);
});

test('Fotodokumentation per Finger: großer Aufnahme-Knopf, Speichern, Galerie und Großansicht passen auf den Bildschirm', async ({ page }, info) => {
  await page.goto('./#/fotos');
  // im Browser gibt es nur die Dateiauswahl (Kamera-Modus erst in der installierten App)
  const pick = page.getByTestId('photo-pick');
  await expect(pick).toBeVisible();
  expect((await pick.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  await expect(page.getByTestId('photo-shoot')).toHaveCount(0);
  await expect(page.getByTestId('photo-camera-input')).toHaveAttribute('capture', 'environment');
  await page.getByTestId('photo-file-input').setInputFiles(join(FIXTURES, 'foto.jpg'));
  const dlg = page.getByTestId('photo-save-dialog');
  await dlg.getByTestId('photo-site').selectOption({ index: 0 }).catch(() => {});
  await expect(dlg.getByTestId('photo-site').locator('option')).toHaveCount(2); // keine Baustelle angelegt – nur „wählen“ und „Neue Baustelle“
  await expect(dlg.getByTestId('photo-save')).toBeDisabled();
  await dlg.getByRole('button', { name: 'Abbrechen' }).tap();
  // Baustelle anlegen und erneut
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('add-site').tap();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Halle 3');
  await page.getByTestId('site-dialog').getByTestId('site-save').tap();
  await page.goto('./#/fotos');
  await page.getByTestId('photo-file-input').setInputFiles([join(FIXTURES, 'foto.jpg'), join(FIXTURES, 'parkdeck.png')]);
  await dlg.getByTestId('photo-user').fill('Max');
  await dlg.getByTestId('photo-save').tap();
  await expect(page.locator('.toast', { hasText: '2 Fotos gespeichert' })).toHaveCount(1);
  await noHorizontalScroll(page);
  await page.getByTestId('photo-site').tap();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(2);
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `fotos-${info.project.name}.png`), fullPage: true });
  await page.getByTestId('photo-thumb').first().tap();
  await expect(page.getByTestId('lightbox-image')).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `foto-gross-${info.project.name}.png`) });
  await page.getByTestId('lightbox-close').tap();
});
