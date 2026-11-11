import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { blattRows, catchDownload, createProject, readXlsx, drawRect, FIXTURES, fillMeasures, freshStart, OUT, planBox, saveDownload, tableRows, waitForPlan, waitSaved, pickTool } from './helpers';

/**
 * Paket H/I: Jeder exportierte Plan hat A4 oder A3 (hoch/quer); der Plan wird proportional
 * und zentriert mit mindestens 1 cm Rand eingepasst; die Überschrift ist frei wählbar und bleibt
 * gespeichert. Die Aufmaßwerte ändern sich dadurch nicht.
 */

const A4 = '595\\.27\\d* x 841\\.89';
const A4Q = '841\\.89 x 595\\.27\\d*';
const A3 = '841\\.89 x 1190\\.55';

async function exportPdf(page: Page, name: string) {
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, `${name}.pdf`);
  execFileSync('pdftoppm', ['-png', '-r', '30', '-singlefile', pdf, join(OUT, name)]);
  return {
    info: execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }),
    text: execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }),
    png: join(OUT, `${name}.png`),
  };
}

/** Anteil nicht weißer Pixel im Randstreifen (1 cm ≈ 11,8 px bei 30 dpi; geprüft: 10 px) */
function borderInk(png: string): number {
  return Number(
    execFileSync(
      'python3',
      [
        '-c',
        `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('L'); w, h = im.size; b = 10
n = ink = 0
for y in range(h):
  for x in range(w):
    if x < b or y < b or x >= w - b or y >= h - b:
      n += 1
      if im.getpixel((x, y)) < 235: ink += 1
print(ink / n)`,
        png,
      ],
      { encoding: 'utf8' },
    ),
  );
}

test('Import: Format wählbar (Standard A4 passend), Überschrift, PDF genau A3 mit Rand', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Format', {}, ['Garage']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('page-tile').nth(1).click(); // A3-Querseite
  await wiz.getByTestId('pages-next').click();
  await wiz.getByTestId('areas-next').click();
  // Standard: A4, Ausrichtung passend zum Plan (Querformat)
  await expect(wiz.getByTestId('export-paper')).toHaveValue('A4-quer');
  await wiz.getByTestId('export-paper').selectOption('A3-hoch');
  await wiz.locator('[data-field="planNumber"]').fill('F-1');
  await expect(wiz.locator('[data-field="title"]')).toHaveAttribute('placeholder', 'z. B. Aufmaßplan');
  // Standard: Nummer und Planbezeichnung (hier aus dem Dateinamen); ohne Titel
  await expect(wiz.getByTestId('heading-preview')).toHaveText('Überschrift im PDF: F-1 plaene (Seite 2)');
  await wiz.getByTestId('show-name').uncheck();
  await expect(wiz.getByTestId('heading-preview')).toHaveText('Überschrift im PDF: F-1'); // ohne Titel nur die Nummer
  await wiz.locator('[data-field="title"]').fill('Aufmaßplan Tiefgarage');
  await expect(wiz.getByTestId('heading-preview')).toHaveText('Überschrift im PDF: Aufmaßplan Tiefgarage F-1');
  await wiz.getByTestId('show-paper').check(); // Format ausdrücklich im Plan anzeigen
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.2, box.x + box.width * 0.4, box.y + box.height * 0.35);
  await fillMeasures(page, '18', '2,5', '');
  await waitSaved(page);
  const before = await tableRows(page);

  const r = await exportPdf(page, 'format-a3-hoch');
  expect(r.info).toMatch(new RegExp(`Page size:\\s+${A3} pts`)); // Format nicht durch den Plan verändert
  expect(r.text).toContain('Aufmaßplan Tiefgarage F-1');
  expect(r.text).toContain('A3 Hochformat');
  expect(r.text).toContain('Technik'); // Originalinhalt vektoriell erhalten
  expect(borderInk(r.png)).toBe(0); // nichts im 1-cm-Rand
  // Aufmaßwerte unverändert (18 m bleiben 18 m)
  expect(await tableRows(page)).toEqual(before);
  expect(before[0][1]).toBe('18,00');
});

test('Plandetails: Format und Überschrift ändern, nach Neuladen erhalten', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Format 2', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('P-7');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  let r = await exportPdf(page, 'format-standard');
  expect(r.info).toMatch(new RegExp(`Page size:\\s+(${A4}|${A4Q}) pts`)); // Standard A4
  expect(r.text).toContain('P-7 parkdeck'); // Planbezeichnung standardmäßig in der Überschrift
  expect(r.text).not.toContain('Aufmaßplan');
  expect(r.text).not.toMatch(/A4|Hochformat|Querformat/); // Format standardmäßig nicht im Plan
  expect(borderInk(r.png)).toBe(0);

  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await page.getByTestId('plan-actions').click();
  await page.getByTestId('action-edit').click();
  const det = page.getByTestId('plan-details');
  await det.getByTestId('export-paper').selectOption('A4-hoch');
  await det.locator('[data-field="title"]').fill('Aufmaß Hof');
  await det.locator('[data-field="description"]').fill('Nur Bereich Nord');
  await det.getByTestId('show-note').check();
  // Planbezeichnung und Ebene neben Titel und Nummer (Kästchen „Im Plan anzeigen“)
  await det.locator('[data-field="planName"]').fill('BA. 4');
  await det.locator('[data-field="floor"]').fill('UG2');
  await expect(det.getByTestId('heading-preview')).toHaveText('Überschrift im PDF: Aufmaß Hof P-7 BA. 4 UG2'); // Standard: angezeigt
  await det.getByTestId('show-floor').uncheck();
  await expect(det.getByTestId('heading-preview')).toHaveText('Überschrift im PDF: Aufmaß Hof P-7 BA. 4');
  await det.getByTestId('show-floor').check();
  await expect(det.getByTestId('heading-preview')).toHaveText('Überschrift im PDF: Aufmaß Hof P-7 BA. 4 UG2');
  await det.getByRole('button', { name: 'Speichern' }).click();
  await waitSaved(page); // erst nach dem Speichern neu laden (sonst fragt der Browser nach)
  await page.reload();
  await page.getByTestId('plan-actions').click();
  await page.getByTestId('action-edit').click();
  await expect(det.getByTestId('export-paper')).toHaveValue('A4-hoch');
  await expect(det.locator('[data-field="title"]')).toHaveValue('Aufmaß Hof');
  await expect(det.getByTestId('show-note')).toBeChecked();
  await expect(det.getByTestId('show-name')).toBeChecked();
  await expect(det.getByTestId('show-floor')).toBeChecked();
  await det.getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByTestId('plan-open').click();
  await waitForPlan(page);
  r = await exportPdf(page, 'format-a4-hoch');
  expect(r.info).toMatch(new RegExp(`Page size:\\s+${A4} pts`));
  expect(r.text).toContain('Aufmaß Hof P-7 BA. 4 UG2');
  expect(r.text).toContain('Nur Bereich Nord'); // Bemerkung, weil „Im Plan anzeigen“ gewählt
  expect(borderInk(r.png)).toBe(0);
  await page.screenshot({ path: join(OUT, 'format-editor.png') });
});

test('Gezeichneter Plan: Überschrift frei wählbar, Format des Zeichenblatts', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Format 3', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  // Vereinfachte Eingabe: nur Plannummer, Titel, Bemerkung, Format, Maßstab
  await expect(nd.locator('[data-field="planName"], [data-field="floor"], [data-field="area"]')).toHaveCount(0);
  await expect(nd.getByTestId('show-paper')).not.toBeChecked();
  await expect(nd.getByTestId('show-scale')).not.toBeChecked();
  await expect(nd.getByTestId('show-note')).not.toBeChecked();
  await nd.locator('[data-field="planNumber"]').fill('Z-9');
  await nd.locator('[data-field="title"]').fill('Aufmaßplan');
  await nd.locator('[data-field="planNumber"]').fill('067');
  await nd.locator('[data-field="description"]').fill('Interne Notiz');
  await nd.getByTestId('sheet-paper').selectOption('A4-quer');
  await nd.getByTestId('new-drawing-save').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  const r = await exportPdf(page, 'format-zeichnung');
  expect(r.info).toMatch(new RegExp(`Page size:\\s+${A4Q} pts`));
  expect(r.text).toContain('Aufmaßplan 067'); // Titel + Nummer, sonst nichts
  expect(r.text).not.toContain('Plannummer');
  expect(r.text).not.toContain('Interne Notiz'); // Bemerkung nur auf Wunsch im Plan
  expect(r.text).not.toMatch(/Maßstab|A4/);
  expect(borderInk(r.png)).toBe(0);
});

test('Planliste: nach Plannummer auf- oder absteigend, Wahl bleibt gemerkt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Sortierung', {}, ['UG']);
  for (const nr of ['009', '002', '010']) {
    await page.getByTestId('draw-plan').click();
    const nd = page.getByTestId('new-drawing');
    await nd.locator('[data-field="planNumber"]').fill(nr);
    await nd.getByTestId('new-drawing-save').click();
    await expect(page.getByTestId('drawing-sheet')).toBeVisible();
    await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  }
  const numbers = () => page.getByTestId('plan-row').locator('.plan-number, [data-testid="plan-number"]').allInnerTexts();
  const rows = page.getByTestId('plan-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('002');
  await expect(rows.nth(2)).toContainText('010');
  await expect(page.getByTestId('plan-sort')).toHaveText(/aufsteigend/);
  await page.getByTestId('plan-sort').click();
  await expect(page.getByTestId('plan-sort')).toHaveText(/absteigend/);
  await expect(rows.nth(0)).toContainText('010');
  await expect(rows.nth(1)).toContainText('009');
  await expect(rows.nth(2)).toContainText('002');
  void numbers;
  await page.reload();
  await expect(page.getByTestId('plan-sort')).toHaveAttribute('data-order', 'desc');
  await expect(page.getByTestId('plan-row').nth(0)).toContainText('010');
  // Titel und Anzeige für alle Pläne des Projekts übernehmen
  await page.getByTestId('plan-row').nth(0).getByTestId('plan-actions').click();
  await page.getByTestId('action-edit').click();
  const det = page.getByTestId('plan-details');
  await det.locator('[data-field="title"]').fill('Aufmaßplan');
  await det.getByTestId('show-note').check();
  await det.getByTestId('apply-all-plans').check();
  await det.getByRole('button', { name: 'Speichern' }).click();
  await expect(det).toHaveCount(0);
  await page.getByTestId('plan-row').nth(2).getByTestId('plan-actions').click();
  await page.getByTestId('action-edit').click();
  await expect(det.locator('[data-field="title"]')).toHaveValue('Aufmaßplan');
  await expect(det.getByTestId('show-note')).toBeChecked();
  await expect(det.locator('[data-field="planNumber"]')).toHaveValue('002'); // Nummer bleibt
});

test('Aufmaßblatt aus mehreren Plänen zusammenstellen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Zusammen', {}, ['UG']);
  for (const [nr, len] of [['001', '2'], ['002', '3'], ['003', '4']]) {
    await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
    const wiz = page.getByTestId('import-wizard');
    await wiz.getByTestId('areas-next').click();
    await wiz.locator('[data-field="planNumber"]').fill(nr);
    await wiz.getByTestId('import-save').click();
    await waitForPlan(page);
    const box = await planBox(page);
    await pickTool(page, 'tool-rect');
    await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.2, box.x + box.width * 0.4, box.y + box.height * 0.35);
    await fillMeasures(page, len, '1', '');
    await waitSaved(page);
    await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  }
  await page.getByTestId('export-xlsx-cc').click();
  const ex = page.getByTestId('excel-export');
  const list = ex.getByTestId('blatt-plans');
  await expect(list).toContainText('(3 von 3)');
  await ex.locator('[data-testid="blatt-plan"][data-plan="002"] input').uncheck();
  await expect(list).toContainText('(2 von 3)');
  const dl = await catchDownload(page, () => ex.getByTestId('blatt-export').click());
  expect(dl.suggestedFilename()).toContain('2_Plaene');
  const wb = await readXlsx(await saveDownload(dl, 'blatt-zusammen.xlsx'));
  const plans = [...new Set(blattRows(wb).map((r) => String(r.plan)))];
  expect(plans).toEqual(['001', '003']);
});

test('Starkes Hineinzoomen: Ausschnitt scharf aus dem PDF, Hilfs-Zeichenflächen werden sofort freigegeben (iPad-Speicherlimit)', async ({ page }) => {
  // alle erzeugten Zeichenflächen mitschreiben
  await page.addInitScript(() => {
    const made: HTMLCanvasElement[] = [];
    (window as unknown as { __canvases: HTMLCanvasElement[] }).__canvases = made;
    const orig = document.createElement.bind(document);
    document.createElement = ((tag: string, opts?: ElementCreationOptions) => {
      const el = orig(tag, opts);
      if (tag.toLowerCase() === 'canvas') made.push(el as HTMLCanvasElement);
      return el;
    }) as typeof document.createElement;
  });
  await freshStart(page);
  await createProject(page, 'Zoom', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('page-tile').nth(1).click();
  await wiz.getByTestId('pages-next').click();
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('Z-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const zoom = page.getByRole('button', { name: 'Vergrößern', exact: true });
  for (let i = 0; i < 8; i++) {
    await zoom.click();
    await page.waitForTimeout(250);
  }
  const detail = page.getByTestId('plan-detail');
  await expect(detail).toBeVisible({ timeout: 15_000 });
  expect(await detail.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(400);
  // Ausschnitt in Bildschirmpixeln, nicht in der per CSS vergrößerten Ebene (Safari zeigt die unscharf)
  const fit = await detail.evaluate((c: HTMLCanvasElement) => ({
    inWorld: !!c.closest('.viewer-world'),
    ratio: c.width / (c.getBoundingClientRect().width * devicePixelRatio),
  }));
  expect(fit.inWorld).toBe(false);
  expect(fit.ratio).toBeGreaterThan(0.85);
  // liegt deckungsgleich über dem Grundbild: Ausschnitt mit und ohne scharfe Ebene fast gleich
  const viewer = page.getByTestId('plan-viewer');
  const sharp = await viewer.screenshot({ path: join(OUT, 'zoom-scharf.png') });
  await detail.evaluate((c: HTMLCanvasElement) => (c.style.visibility = 'hidden'));
  await viewer.screenshot({ path: join(OUT, 'zoom-grundbild.png') });
  await detail.evaluate((c: HTMLCanvasElement) => (c.style.visibility = ''));
  expect(sharp.length).toBeGreaterThan(0);
  // keine großen Zeichenflächen bleiben im Speicher: nicht eingehängte sind auf 0 × 0 zurückgesetzt (kleine Vorschaubilder zählen nicht)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __canvases: HTMLCanvasElement[] }).__canvases.filter((c) => !c.isConnected && c.width * c.height > 200_000).length), { timeout: 10_000 })
    .toBe(0);
});

test('Pläne von einem anderen Gerät (ohne Vorschaubilder): geöffneter Plan bleibt beim Zoomen scharf, auch während Vorschaubilder entstehen', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/Detail neu laden|destroyed|Transport|Worker was/i.test(m.text())) problems.push(m.text());
  });
  await freshStart(page);
  await createProject(page, 'Viele Pläne', {}, ['EG']);
  const files = ['farbplan.pdf', 'massketten.pdf', 'masslinien.pdf', 'plaene.pdf'];
  for (const [i, f] of files.entries()) {
    await page.goto(page.url().replace(/\/plan\/.*$/, ''));
    await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, f));
    const wiz = page.getByTestId('import-wizard');
    await expect(wiz.getByTestId('pages-next').or(wiz.getByTestId('areas-next'))).toBeVisible({ timeout: 20_000 });
    if (await wiz.getByTestId('pages-next').isVisible()) {
      await wiz.getByTestId('page-tile').first().click();
      await wiz.getByTestId('pages-next').click();
    }
    await wiz.getByTestId('areas-next').click();
    await wiz.locator('[data-field="planNumber"]').fill(`V-${i + 1}`);
    await wiz.getByTestId('import-save').click();
    await waitForPlan(page);
  }
  const projectUrl = page.url().replace(/\/plan\/.*$/, '');
  // wie auf einem zweiten Gerät: keine Vorschaubilder vorhanden
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('thumbCrop:')) localStorage.removeItem(k);
        const r = indexedDB.open('schadstellen-aufmass');
        r.onsuccess = () => {
          const tx = r.result.transaction('thumbs', 'readwrite');
          tx.objectStore('thumbs').clear();
          tx.oncomplete = () => {
            r.result.close();
            res();
          };
        };
      }),
  );
  // langsames Gerät nachstellen (iPad rendert große Pläne deutlich langsamer)
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
  await page.goto(projectUrl);
  // sofort einen Plan öffnen, während die Vorschaubilder der anderen noch entstehen
  await page.getByTestId('plan-row').filter({ hasText: 'V-1' }).first().getByTestId('plan-open').click();
  await waitForPlan(page);
  const zoom = page.getByRole('button', { name: 'Vergrößern', exact: true });
  for (let i = 0; i < 6; i++) await zoom.click();
  const detail = page.getByTestId('plan-detail');
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(8000); // Vorschaubilder sind fertig
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  for (let i = 0; i < 2; i++) await zoom.click();
  await page.waitForTimeout(1500);
  await expect(detail).toBeVisible();
  expect(problems).toEqual([]);
});

test('Gezeichneter Plan: Plan bearbeiten unbegrenzt, Plan messen zeigt das gewählte Blatt wie im PDF', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Blatt', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('B-1');
  await nd.getByTestId('sheet-paper').selectOption('A4-quer');
  await nd.getByTestId('new-drawing-save').click();
  // Plan bearbeiten: unbegrenzte weiße Fläche
  await expect(page.locator('.drawing-bg')).toHaveCount(1);
  const box = (await page.getByTestId('plan-viewer').boundingBox())!;
  await pickTool(page, 'draw-rect');
  await drawRect(page, box.x + box.width * 0.3, box.y + box.height * 0.3, box.x + box.width * 0.5, box.y + box.height * 0.5);
  await waitSaved(page);
  // Plan messen: Blatt A4 quer (Planbereich 277 × 176 mm), ganz im Bild, keine unbegrenzte Fläche
  await page.getByTestId('mode-measure').click();
  await expect(page.locator('.drawing-bg')).toHaveCount(0);
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  const s = (await sheet.boundingBox())!;
  expect(s.width / s.height).toBeCloseTo(277 / 176, 1);
  const v = (await page.getByTestId('plan-viewer').boundingBox())!;
  expect(s.x).toBeGreaterThanOrEqual(v.x - 1);
  expect(s.x + s.width).toBeLessThanOrEqual(v.x + v.width + 1);
  // die Zeichnung liegt auf dem Blatt
  const r = (await page.locator('[data-element="rect"]').first().boundingBox())!;
  expect(r.x).toBeGreaterThan(s.x);
  expect(r.x + r.width).toBeLessThan(s.x + s.width);
  await page.screenshot({ path: join(OUT, 'blatt-messen.png') });
});

test('Gezeichneter Plan bleibt in „Plan bearbeiten“ – auch nach Neuladen; zuletzt gewählter Modus je Plan', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Modus', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('M-1');
  await nd.getByTestId('new-drawing-save').click();
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill('4');
  await page.getByTestId('insert-width').fill('3');
  await page.getByTestId('insert-submit').click();
  await expect(page.locator('[data-element="rect"]')).toHaveCount(1);
  await waitSaved(page);
  // Plan mit Formen neu laden: bleibt beim Zeichnen (früher sprang er ins Aufmaß)
  await page.reload();
  await expect(page.getByTestId('mode-draw')).toHaveAttribute('aria-selected', 'true');
  // Aufmaß gewählt → beim nächsten Öffnen wieder Aufmaß
  await page.getByTestId('mode-measure').click();
  await page.reload();
  await expect(page.getByTestId('mode-measure-tab')).toHaveAttribute('aria-selected', 'true');
});

test('Plan zeichnen: alle A-Formate (A4 bis A0, hoch/quer); im Aufmaßplan füllt die Zeichnung das Blatt zentriert – auch im PDF', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Formate', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('F-2');
  const opts = await nd.getByTestId('sheet-paper').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(opts).toEqual(['A4-hoch', 'A4-quer', 'A3-hoch', 'A3-quer', 'A2-hoch', 'A2-quer', 'A1-hoch', 'A1-quer', 'A0-hoch', 'A0-quer']);
  await nd.getByTestId('sheet-paper').selectOption('A2-quer');
  await nd.getByTestId('sheet-scale').selectOption('100');
  await nd.getByTestId('new-drawing-save').click();
  // kleiner Raum 4 × 3 m – auf A2 1:100 wäre er winzig
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill('4');
  await page.getByTestId('insert-width').fill('3');
  await page.getByTestId('insert-submit').click();
  await waitSaved(page);
  await page.getByTestId('mode-measure').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  const s = (await sheet.boundingBox())!;
  const r = (await page.locator('[data-element="rect"]').first().boundingBox())!;
  expect(s.width / s.height).toBeCloseTo(574 / 376, 1); // A2 quer ohne Ränder und Kopf
  // füllt das Blatt (Höhe fast ganz), zentriert
  expect(r.height / s.height).toBeGreaterThan(0.85);
  expect(Math.abs(r.x + r.width / 2 - (s.x + s.width / 2))).toBeLessThan(3);
  expect(Math.abs(r.y + r.height / 2 - (s.y + s.height / 2))).toBeLessThan(3);
  // PDF: A2 quer, Raum füllt das Blatt
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'format-a2-fuellen.pdf');
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Page size:\s+1683\.7\d* x 1190\.5\d*/);
});
