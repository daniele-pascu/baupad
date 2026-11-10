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
  newWeekProject,
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
  await noOverlap(page);
}

/**
 * Eingabefelder, Auswahllisten und Knöpfe dürfen sich nicht überlappen (z. B. Uhrzeitfelder, die über ihre Spalte
 * hinausragen). Schwebende Bedienelemente über dem Plan (Zoom, Werkzeugleisten) und Toasts zählen nicht.
 */
async function noOverlap(page: Page) {
  const hits = await page.evaluate(() => {
    // offenes Overlay (Dialog, Großansicht): nur dessen Inhalt prüfen – der Hintergrund ist verdeckt
    const overlays = [...document.querySelectorAll('.modal-backdrop, .lightbox, .cam-sheet-backdrop')].filter((o) => o.getBoundingClientRect().width > 0);
    const root: ParentNode = overlays.length ? overlays[overlays.length - 1] : document;
    // schwebend über dem Plan bzw. dem Bild: Zoom-Knöpfe, Hinweise
    const floating = (el: Element) => !!el.closest('.toast, .zoom-controls, .dp-stage, .site-nav, [data-testid="plan-viewer"] .viewer-overlay');
    const els = [...root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea, button, a.btn')]
      .filter((el) => !floating(el))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden' && !(el as HTMLElement).hidden);
    const out: string[] = [];
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i];
        const b = els[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 3 && h > 3) {
          const name = (e: Element) => `${e.tagName.toLowerCase()}${e.getAttribute('data-testid') ? `[${e.getAttribute('data-testid')}]` : ''}${e.getAttribute('aria-label') ? `{${e.getAttribute('aria-label')}}` : ''}${typeof e.className === 'string' && e.className ? `.${e.className.split(' ')[0]}` : ''}${(e as HTMLElement).innerText ? ` „${(e as HTMLElement).innerText.trim().slice(0, 20)}“` : ''}`;
          out.push(`${name(a.el)} ⟷ ${name(b.el)} (${Math.round(w)}×${Math.round(h)})`);
        }
      }
    return out.slice(0, 8);
  });
  expect(hits, 'überlappende Bedienelemente').toEqual([]);
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

  // Bedienelemente groß genug für Touch; „Auswahl“ gibt es am Handy/Tablet nicht als Knopf (automatisch nach Gebrauch)
  await expect(page.getByTestId('tool-select')).toHaveCount(0);
  for (const id of ['tool-ellipse', 'tool-rect', 'tool-polyline']) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
    expect(b!.width).toBeGreaterThanOrEqual(44);
  }
  // Schmale Bildschirme (iPhone, iPad hochkant): Plan und Tabelle über Reiter umschaltbar; iPad quer: nebeneinander
  const sideBySide = page.viewportSize()!.width > 1024;
  if (sideBySide) {
    await expect(page.getByTestId('mobile-tab-table')).toBeHidden();
    await expect(page.getByTestId('aufmass-table')).toBeVisible();
  } else await expect(page.getByTestId('mobile-tab-table')).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  const box = await planBox(page);

  // 1) Antippen mit dem Kreis-Werkzeug erzeugt eine Markierung in Standardgröße
  await pickTool(page, 'tool-ellipse', 'tap');
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.4);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('input-number')).toHaveValue('1');
  // kein „Geisterklick“ vom Tippen auf den Plan in den eben geöffneten Dialog (z. B. auf „Abzug hinzufügen“)
  await expect(dlg.getByRole('button', { name: 'Zeile entfernen' })).toHaveCount(0);
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
  // Tablet: Leiste nach dem Speichern wieder offen; Handy: bleibt zugeklappt (Plan frei)
  if (isPhone) await expect(page.getByTestId('tools-open')).toBeVisible();
  else await expect(page.getByTestId('tool-rect')).toBeVisible();

  // 2) Rechteck mit dem Finger aufziehen
  await pickTool(page, 'tool-rect', 'tap');
  await touchDrag(cdp, { x: box.x + box.width * 0.55, y: box.y + box.height * 0.5 }, { x: box.x + box.width * 0.75, y: box.y + box.height * 0.65 });
  await expect(dlg).toBeVisible();
  // Tippen auf den Plan mit gewähltem Werkzeug hat die Leiste unten zugeklappt
  await expect(page.getByTestId('tools-open')).toBeVisible();
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

  // 4) Verschieben mit einem Finger: nach dem Speichern ist das Werkzeug von selbst wieder „Auswahl“, die Leiste wieder offen
  if (isPhone) await expect(page.getByTestId('tools-open')).toBeVisible();
  else {
    await expect(page.getByTestId('tools-open')).toHaveCount(0);
    await expect(page.getByTestId('tool-rect')).toBeVisible();
  }
  await touchDrag(cdp, { x: vb.x + 60, y: vb.y + 80 }, { x: vb.x + 160, y: vb.y + 150 });
  const afterPan = await markerRelPos(page, 2);
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(afterPan[k] - before[k])).toBeLessThan(0.003);
  await page.getByRole('button', { name: 'Gesamten Plan anzeigen' }).tap();

  // 5) Tabelle
  if (!sideBySide) await page.getByTestId('mobile-tab-table').tap();
  expect((await tableRows(page)).map((r) => [r[0], r[4]])).toEqual([
    ['1', '0,50'],
    ['2', '2,64'],
  ]);
  // Tabelle antippen → Bearbeitung der Maße (bleibt in der Tabelle)
  await page.locator('[data-testid="aufmass-row"][data-number="2"]').tap();
  await expect(page.getByTestId('damage-dialog')).toBeVisible();
  await page.getByTestId('damage-cancel').tap();
  if (!sideBySide) await page.getByRole('tab', { name: /Plan/ }).tap();
  await expect(page.getByTestId('plan-viewer')).toBeVisible();
  await expect(page.getByTestId('selection-bar')).toContainText('Nr. 2');
  await noHorizontalScroll(page);

  // 6) Bearbeiten über die Auswahlleiste
  await page.getByTestId('edit-selected').tap();
  await dlg.getByTestId('input-width').fill('1,5');
  await dlg.getByTestId('damage-save').tap();
  await expect(page.getByTestId('selection-bar')).toContainText('3,60 m²');
  // Alle Werkzeuge und Rückgängig/Wiederholen sind per Finger erreichbar, nichts ragt über den Rand (Leiste war zugeklappt)
  await openTools(page, 'tap');
  const vw = page.viewportSize()!.width;
  for (const t of ['line', 'rect', 'ellipse', 'polyline', 'wall', 'probe']) {
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
    await page.getByTestId('damage-cancel').tap();
    await expect(page.getByTestId('selection-bar')).toContainText('Nr. 1');
    await noHorizontalScroll(page);
    await page.screenshot({ path: join(OUT, 'ipad-quer-editor.png') });
  }
});

test('Erstnutzer: vom neuen Projekt bis zum importierten PDF', async ({ page }) => {
  await freshStart(page);
  // Startseite erklärt, wo Pläne importiert werden
  await expect(page.locator('.home-hint')).toHaveCount(0); // keine Hinweise mehr unter Aufmaß & Abrechnung
  // Projekt und Kostenstelle in einem Schritt
  await page.getByTestId('new-project').tap();
  await page.getByTestId('project-picker').getByTestId('picker-new').tap();
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
  await page.getByTestId('element-showdims').tap(); // neue Formen kommen ohne Maße – hier einschalten
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
    ['draw', ['line', 'polyline', 'polygon', 'rect', 'ellipse', 'arc', 'text', 'delete', 'undo', 'redo']],
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
  await expect(page.getByTestId('draw-select')).toHaveCount(0); // kein Knopf „Auswahl“ am Handy/Tablet
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
  // LV-Ansicht: nichts abgeschnitten – Nummer, Kurztext, Menge und Aufmaß liegen innerhalb der Tabelle
  const wrap = (await page.getByTestId('lv-table').locator('xpath=..').boundingBox())!;
  for (const cell of ['.lv-c-no', '.lv-c-text', '.lv-c-qty', '.lv-c-meas']) {
    const c = (await page.getByTestId('lv-row').first().locator(cell).boundingBox())!;
    expect(c.width).toBeGreaterThan(0);
    expect(c.x + c.width).toBeLessThanOrEqual(wrap.x + wrap.width + 1);
  }
  await page.getByTestId('lv-table').screenshot({ path: join(OUT, `${info.project.name}-lv-ansicht.png`) });
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
  // wie in der installierten App (dort gibt es die Foto-Taste oben)
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await page.goto('./#/tools');
  const tiles = page.locator('.tool-tile');
  await expect(tiles).toHaveCount(7); // sieben Werkzeuge seit der Materialverwaltung
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
  // Kacheln und Register von Rand zu Rand (bis zum Seitenrand wie die Kopfzeile), Foto-Taste kompakt
  const quick = (await page.getByTestId('tools-camera').boundingBox())!;
  const regEl = page.getByTestId('tools-register'); // nur für Admin/Büro
  const gear = (await page.getByTestId('account-link').boundingBox())!;
  const right = gear.x + gear.width;
  expect(Math.abs(b!.x + b!.width - right)).toBeLessThan(2);
  if (await regEl.count()) {
    const reg = (await regEl.boundingBox())!;
    expect(Math.abs(reg.x + reg.width - right)).toBeLessThan(2);
  }
  expect(Math.abs(a!.x - quick.x)).toBeLessThan(2);
  expect(quick.width).toBeLessThan(260);
  expect(page.viewportSize()!.width - right).toBeLessThan(64);
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `tools-${info.project.name}.png`), fullPage: true });
  await page.getByTestId('tool-projects').tap();
  await expect(page.getByTestId('projects-title')).toBeVisible();
});

test('Arbeitereinteilung per Finger: Arbeiter, Baustelle, Einteilung – passt auf den Bildschirm', async ({ page }, info) => {
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('crew-workers').tap();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max', 'Peter']) {
    await wd.getByTestId('staff-new').tap();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').tap();
    await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
  }
  await expect(wd.getByTestId('worker-row')).toHaveCount(2);
  await wd.getByTestId('staff-back').tap();
  await expect(page.getByTestId('workers-title')).toHaveText('Arbeitereinteilung');
  await page.getByTestId('add-site').tap();
  await newWeekProject(page, 'Neubau Musterstraße', {}, 'tap');
  await page.locator('[data-testid="day-row"][data-day="0"] [data-testid="day-add"]').tap();
  const ad = page.getByTestId('assign-dialog');
  await ad.locator('[data-worker="Max"] input').tap();
  await ad.getByTestId('assign-save').tap();
  await expect(page.locator('[data-testid="day-row"][data-day="0"] [data-testid="crew-chip"]')).toHaveText(['Max']);
  await page.getByTestId('crew-open-toggle').tap();
  await expect(page.getByTestId('crew-open').getByTestId('open-chip')).toHaveCount(1); // Peter die ganze Woche frei
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `arbeiter-${info.project.name}.png`), fullPage: true });

  // Antippen statt Ziehen: Menü mit Wochentagen, Urlaub/Krank, anderes Projekt – passt auf den Bildschirm
  await page.getByTestId('add-site').tap();
  await newWeekProject(page, 'Sanierung', {}, 'tap');
  await page.locator('[data-site="Neubau Musterstraße"] [data-testid="day-row"][data-day="0"] [data-testid="crew-chip"]').tap();
  const cd = page.getByTestId('chip-dialog');
  await expect(cd.getByTestId('chip-day')).toHaveCount(7);
  await expect(cd.getByTestId('chip-urlaub')).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `arbeiter-menue-${info.project.name}.png`) });
  await cd.getByTestId('chip-move-to').selectOption({ label: 'Sanierung' });
  await cd.getByTestId('chip-move').tap();
  for (const d of [0, 4]) {
    await expect(page.locator(`[data-site="Sanierung"] [data-day="${d}"] [data-testid="crew-chip"]`)).toHaveText(['Max']);
    await expect(page.locator(`[data-site="Neubau Musterstraße"] [data-day="${d}"] [data-testid="crew-chip"]`)).toHaveCount(0);
  }
  await expect(page.getByTestId('crew-ghost')).toHaveCount(0);
});

test('Berichte per Finger: Regieliste, Tagesbericht und Wochenbericht passen auf den Bildschirm', async ({ page }, info) => {
  for (const type of ['regie', 'tag', 'woche'] as const) {
    await page.goto('./#/berichte'); // Übersicht → Projekt (beim ersten Mal anlegen) → „Neu“
    const card = page.getByTestId('report-site').or(page.getByTestId('report-site-empty')).first();
    if (await card.count()) await card.tap();
    else {
      await page.getByTestId('report-new-site').tap();
      await page.getByTestId('project-picker').getByTestId('picker-new').tap();
      await page.getByTestId('project-name').fill('Halle 3');
      await page.getByTestId('project-save').tap();
    }
    await page.getByTestId('report-group-new').tap();
    const d = page.getByTestId('report-new-dialog');
    await d.getByTestId(`report-type-${type}`).tap();
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
  await expect(page.getByTestId('photo-pick')).toHaveCount(0); // Fotos erst im Projekt
  // Projekt anlegen (Einteilung), in der Fotodokumentation übernehmen
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('add-site').tap();
  await newWeekProject(page, 'Halle 3', {}, 'tap');
  await page.goto('./#/fotos');
  await page.getByTestId('photo-new-site').tap();
  await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Halle 3' }).tap();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Halle 3');
  // im Browser gibt es nur die Dateiauswahl (Kamera-Modus erst in der installierten App)
  const pick = page.getByTestId('photo-pick');
  await expect(pick).toBeVisible();
  expect((await pick.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  await expect(page.getByTestId('photo-shoot')).toHaveCount(0);
  await expect(page.getByTestId('photo-camera-input')).toHaveAttribute('capture', 'environment');
  await page.getByTestId('photo-file-input').setInputFiles([join(FIXTURES, 'foto.jpg'), join(FIXTURES, 'parkdeck.png'), join(FIXTURES, 'farbplan.png')]);
  const dlg = page.getByTestId('photo-save-dialog');
  await expect(dlg.getByTestId('photo-site')).toHaveValue(/\|Halle 3$/);
  await dlg.getByTestId('photo-user').fill('Max');
  await dlg.getByTestId('photo-save').tap();
  await expect(page.locator('.toast', { hasText: '3 Fotos gespeichert' })).toHaveCount(1);
  await noHorizontalScroll(page);
  await expect(page.getByTestId('photo-thumb')).toHaveCount(3);
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `fotos-${info.project.name}.png`), fullPage: true });
  // lange drücken → Auswahl; Finger liegen lassen und ziehen markiert mehrere (wie mit der Maus)
  const thumbs = page.getByTestId('photo-thumb');
  const c = async (i: number) => {
    const b = (await thumbs.nth(i).locator('.photo-thumb').boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  await thumbs.first().scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const p0 = await c(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p0.x, y: p0.y, id: 1 }] });
  await pause(700);
  await expect(page.getByTestId('photo-selection-bar')).toBeVisible(); // Auswahlmodus durch langes Drücken
  await expect(page.locator('[data-testid="photo-thumb"][data-selected="true"]')).toHaveCount(1);
  const p2 = await c(1); // Lage nach dem Einblenden der Auswahlleiste (bei langen Galerien scrollt die Seite nach)
  for (let i = 1; i <= 8; i++) {
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + ((p2.x - p0.x) * i) / 8, y: p0.y + ((p2.y - p0.y) * i) / 8, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('[data-testid="photo-thumb"][data-selected="true"]')).toHaveCount(2);
  await expect(page.getByTestId('lightbox-image')).toHaveCount(0); // kein Öffnen durch den Langdruck
  // kurzes Tippen wählt einzeln dazu bzw. ab; „Fertig“ beendet die Auswahl
  await thumbs.nth(2).locator('.photo-thumb').tap();
  await expect(page.locator('[data-testid="photo-thumb"][data-selected="true"]')).toHaveCount(3);
  await thumbs.nth(1).locator('.photo-thumb').tap();
  await expect(page.locator('[data-testid="photo-thumb"][data-selected="true"]')).toHaveCount(2);
  await page.getByTestId('photo-select').tap();
  await expect(page.locator('[data-testid="photo-thumb"][data-selected="true"]')).toHaveCount(0);
  await page.getByTestId('photo-thumb').first().tap();
  await expect(page.getByTestId('lightbox-image')).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `foto-gross-${info.project.name}.png`) });
  await page.getByTestId('lightbox-close').tap();
});

test('Mängelplan per Finger: kein Knopf „Auswahl“; Werkzeug endet nach Gebrauch mit dem nächsten Tipp, Pin sofort', async ({ page }) => {
  await freshStart(page);
  await page.goto('./maengel');
  await page.getByTestId('defect-new-site').tap();
  await page.getByTestId('project-picker').getByTestId('picker-new').tap();
  await page.getByTestId('project-name').fill('Touch-Baustelle');
  await page.getByTestId('project-save').tap();
  await expect(page.getByTestId('defect-site-title')).toHaveText('Touch-Baustelle');
  await page.getByTestId('defect-upload').tap();
  const dlg = page.getByTestId('defect-plan-dialog');
  await dlg.getByTestId('defect-plan-file').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await dlg.getByTestId('defect-plan-save').tap();
  const stage = page.locator('.dp-stage');
  await expect(stage).toBeVisible();
  await expect(page.getByTestId('dp-tool-select')).toHaveCount(0);
  const cdp = await page.context().newCDPSession(page);
  const box = (await stage.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // Rechteck ziehen → Dialog; danach bleibt das Werkzeug bis zum nächsten Tipp ins Leere
  await page.getByTestId('dp-tool-rect').tap();
  await touchDrag(cdp, at(0.2, 0.2), at(0.45, 0.45));
  const md = page.getByTestId('dp-mark-dialog');
  await expect(md).toContainText('Nr. 1 · Rechteck');
  await md.getByTestId('dp-mark-save').tap();
  await expect(md).toBeHidden();
  await expect(page.getByTestId('dp-tool-rect')).toHaveAttribute('aria-pressed', 'true');
  const empty = at(0.8, 0.85);
  await page.touchscreen.tap(empty.x, empty.y);
  await expect(page.getByTestId('dp-tool-rect')).toHaveAttribute('aria-pressed', 'false');
  await expect(md).toBeHidden(); // kein zweites Rechteck
  await expect(page.getByTestId('dp-item')).toHaveCount(1);

  // Pin: setzen → Dialog; das Werkzeug ist danach sofort wieder aus
  await page.getByTestId('dp-tool-pin').tap();
  const p = at(0.6, 0.6);
  await page.touchscreen.tap(p.x, p.y);
  await expect(md).toContainText('Nr. 2 · Pin');
  await md.getByTestId('dp-mark-save').tap();
  await expect(md).toBeHidden();
  await expect(page.getByTestId('dp-tool-pin')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('dp-item')).toHaveCount(2);
});

test('Zeitaufzeichnung per Finger: Tag erfassen und Monatszettel passen auf den Bildschirm', async ({ page }, info) => {
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('crew-workers').tap();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max Muster', 'Peter Beispiel']) {
    await wd.getByTestId('staff-new').tap();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').tap();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.goto('./baupad/zeitaufzeichnung');
  await expect(page.getByTestId('times-title')).toHaveText('Zeitaufzeichnung');
  await page.getByTestId('worktimes-dialog').getByTestId('worktimes-later').tap();
  await page.getByTestId('times-add-worker').selectOption({ label: 'Max Muster' });
  const row = page.locator('[data-testid="times-day-row"][data-name="Max Muster"]');
  await row.getByTestId('times-site').selectOption({ label: 'Andere Baustelle …' });
  await page.getByTestId('prompt-dialog').locator('input').fill('Halle 3');
  await page.getByTestId('prompt-dialog').getByRole('button', { name: 'Speichern' }).tap();
  await row.getByTestId('times-to').fill('15:30');
  await expect(row).toHaveAttribute('data-state', 'done');
  await expect(row.getByTestId('times-hours')).toHaveText('8 h');
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `zeit-${info.project.name}.png`), fullPage: true });
  await page.locator('[data-testid="times-person"][data-name="Max Muster"]').tap();
  await expect(page.getByTestId('timesheet-summary')).toContainText('8 h');
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `zettel-${info.project.name}.png`) });
});

test('Projektregister per Finger: passt auf den Bildschirm', async ({ page }, info) => {
  await page.goto('./baupad/projektregister');
  await page.getByTestId('register-new').tap();
  await page.getByTestId('project-name').fill('Parkring Garage Sanierung');
  await page.getByTestId('project-save').tap();
  await expect(page.getByTestId('register-row')).toHaveCount(1);
  await page.getByTestId('register-adopt').tap();
  await page.getByTestId('register-adopt-dialog').locator('[data-testid="register-adopt-tool"][data-tool="photos"] input').check();
  await page.getByTestId('register-adopt-dialog').locator('[data-testid="register-adopt-tool"][data-tool="defects"] input').check();
  await page.getByTestId('register-adopt-save').tap();
  await expect(page.getByTestId('register-adopt-dialog')).toHaveCount(0);
  await expect(page.getByTestId('register-row')).toHaveCount(1);
  await noHorizontalScroll(page);
  await page.screenshot({ path: join(OUT, `register-${info.project.name}.png`), fullPage: true });
});

test('Formular-Editor per Finger: PDF mit zwei Fingern vergrößern, mit einem Finger verschieben (Seitenleiste bleibt)', async ({ page }) => {
  await freshStart(page);
  await page.goto('./baupad/berichte-und-formulare/vorlagen');
  await page.getByTestId('form-template-input').setInputFiles(join(FIXTURES, 'forms', 'mst-tagesbericht.pdf'));
  await page.getByTestId('form-new-dialog').getByTestId('form-new-name').fill('Regie');
  await page.getByTestId('form-new-dialog').getByTestId('form-new-create').tap();
  await expect(page.getByTestId('form-field-box').first()).toBeVisible();
  const vpl = page.getByTestId('form-editor-viewport');
  await vpl.scrollIntoViewIfNeeded();
  const v = (await vpl.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const cx = v.x + v.width / 2;
  const cy = v.y + Math.min(v.height, 300) / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
  for (let i = 1; i <= 8; i++) {
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 40 - i * 10, y: cy, id: 1 }, { x: cx + 40 + i * 10, y: cy, id: 2 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => parseInt(await page.getByTestId('form-zoom-level').innerText(), 10)).toBeGreaterThan(150);
  expect((await vpl.boundingBox())!.width).toBeCloseTo(v.width, 0); // nur die PDF wird größer
  // ein Finger auf freier Fläche verschiebt die Ansicht
  const before = await vpl.evaluate((el) => el.scrollLeft + el.scrollTop);
  // freie Stelle (kein Feld) in der Mitte der Ansicht suchen
  const free = await vpl.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const bottom = Math.min(r.bottom, innerHeight) - 10;
    const top = Math.max(r.top, 0) + 10;
    for (let y = top + (bottom - top) * 0.3; y < bottom; y += 8)
      for (let x = r.left + r.width * 0.3; x < Math.min(r.right, innerWidth) - 10; x += 8) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !hit.closest('[data-testid="form-field-box"]') && hit.closest('[data-testid="form-editor-stage"]')) return { x, y };
      }
    return null;
  });
  expect(free).not.toBeNull();
  await touchDrag(cdp, free!, { x: free!.x - 120, y: free!.y - 120 });
  await expect.poll(() => vpl.evaluate((el) => el.scrollLeft + el.scrollTop)).toBeGreaterThan(before + 50);
  await noHorizontalScroll(page);
});

test('Arbeitereinteilung per Finger: Woche nicht fixiert, Wischen links/rechts wechselt die Woche', async ({ page }) => {
  await freshStart(page);
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-11-09');
  await expect(page.getByTestId('week-label')).toHaveText('KW 46');
  // nicht mehr fixiert (verdeckt sonst die Baustellen)
  expect(await page.getByTestId('crew-sticky').evaluate((el) => getComputedStyle(el).position)).toBe('static');
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (fromX: number, toX: number, y: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y, id: 1 }] });
    for (let i = 1; i <= 6; i++) {
      await pause(16);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + ((toX - fromX) * i) / 6, y: y + i, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const w = page.viewportSize()!.width;
  // unterhalb der Wochenleiste wischen (auf Eingabefeldern wie dem Datum ist Wischen bewusst aus)
  const sb = (await page.getByTestId('crew-sticky').boundingBox())!;
  const y = Math.min(sb.y + sb.height + 40, page.viewportSize()!.height - 40);
  // nach links → nächste Woche (Wischen ist erst aktiv, wenn die Woche geladen ist – ggf. wiederholen)
  await expect(async () => {
    if ((await page.getByTestId('week-label').textContent()) !== 'KW 47') await swipe(w * 0.8, w * 0.2, y);
    await expect(page.getByTestId('week-label')).toHaveText('KW 47', { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await swipe(w * 0.2, w * 0.8, y); // nach rechts → zurück
  await swipe(w * 0.2, w * 0.8, y);
  await expect(page.getByTestId('week-label')).toHaveText('KW 45');
  // kurze oder senkrechte Bewegung wechselt nicht
  await swipe(w * 0.5, w * 0.5 + 30, y);
  await expect(page.getByTestId('week-label')).toHaveText('KW 45');
});
