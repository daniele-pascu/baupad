import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { catchDownload, createProject, freshStart, pickTool, saveDownload, waitSaved } from './helpers';

/** CAD Phase 3 (Maus): Linienarten, Musterlänge, Deckkraft, Baustoff-Schraffur (ÖNORM), Flächenfarbe, eigene Farben, Reihe */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; color: string; style?: Record<string, unknown> & { hatch?: { pattern: string } }; shape: { x: number; y: number; w: number; h: number; rotation?: number } };
async function elements(): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null; createdAt: number })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
const near = (a: number, b: number, tol = 0.011) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(tol);
async function escape() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}
async function rect(len: string, wid: string) {
  await escape();
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill(len);
  await page.getByTestId('insert-width').fill(wid);
  await page.getByTestId('insert-submit').click();
  await waitSaved(page);
}

test('Eigenschaften: Linienart, Musterlänge, Deckkraft, Baustoff-Schraffur, Flächenfarbe – auch für mehrere Objekte', async () => {
  await freshStart(page);
  await createProject(page, 'CAD Phase 3', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('P3');
  await page.getByTestId('new-drawing-save').click();
  await rect('2', '1');
  await rect('3', '2');
  await escape();
  await page.keyboard.press('Control+a');
  await page.getByTestId('ribbon-tab-style').click();
  const st = page.getByTestId('ribbon-style');
  await expect(page.getByTestId('ribbon-style-context')).toHaveText('Auswahl (2)');
  await st.getByTestId('style-line-type').selectOption('center');
  await st.getByTestId('style-dash-scale').selectOption('2');
  await st.getByTestId('style-line-transparency').selectOption('50');
  await waitSaved(page);
  let els = await elements();
  for (const e of els) expect(e.style).toMatchObject({ lineType: 'center', dashScale: 2, lineTransparency: 50 });
  await expect(page.locator('[data-element="rect"] path[data-line-type="center"]')).toHaveCount(2);
  // Baustoff Beton (ÖNORM-Farbe) mit weißer Fläche dahinter
  await st.getByTestId('style-fill-type').selectOption('hatch');
  await st.getByTestId('style-hatch-pattern').selectOption('mat:beton');
  await expect(st.getByTestId('style-hatch-pattern')).toHaveValue('mat:beton');
  await st.getByTestId('style-hatch-bg-on').selectOption('on');
  await waitSaved(page);
  els = await elements();
  for (const e of els) {
    expect(e.style?.hatch?.pattern).toBe('concrete');
    expect(e.style?.fillColor).toBe('#00b000');
    expect(e.style?.hatchBg).toBe('#ffffff');
  }
  await expect(page.locator('[data-fill="hatch"][data-pattern="concrete"]')).toHaveCount(2);
  await expect(page.locator('[data-fill="hatch-bg"]')).toHaveCount(2);
  // weitere Muster zeichnen ohne Fehler
  for (const m of ['mat:ziegel', 'mat:erdreich', 'mat:daemm-weich', 'mat:holz', 'mat:kies', 'mat:glas', 'grid']) {
    await st.getByTestId('style-hatch-pattern').selectOption(m);
    await expect(page.locator('[data-fill="hatch"]').first()).toHaveAttribute('d', /M/);
  }
  await page.screenshot({ path: 'tests/output/cad-schraffuren.png' });
});

test('Eigene Farbe wird je Gerät gemerkt (auch nach Neuladen)', async () => {
  const st = page.getByTestId('ribbon-style');
  await st.getByTestId('style-line-color').fill('#123456');
  await expect(st.getByRole('button', { name: 'Farbe Eigene Farbe #123456', exact: true })).toBeVisible({ timeout: 4000 });
  await waitSaved(page);
  expect((await elements())[0].color).toBe('#123456');
  await page.reload();
  await page.getByTestId('ribbon-tab-style').click();
  await expect(page.getByTestId('ribbon-style').getByRole('button', { name: 'Farbe Eigene Farbe #123456', exact: true })).toBeVisible();
});

test('Reihe: rechteckig 3 × 2 und polar 4 Stück um einen Punkt', async () => {
  await escape();
  // äußeres (größeres) Rechteck allein wählen – das innere liegt darin
  const first = (await elements())[1];
  await page.keyboard.press('Control+a');
  await page.getByTestId('multi-clear').click();
  await pickTool(page, 'draw-select');
  const vb = (await page.locator('[data-element-id="' + first.id + '"]').boundingBox())!;
  await page.mouse.click(vb.x + vb.width / 2, vb.y + 1);
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await pickTool(page, 'draw-array');
  const dlg = page.getByTestId('array-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('array-kind-rect').click();
  await dlg.getByTestId('array-cols').fill('3');
  await dlg.getByTestId('array-rows').fill('2');
  await dlg.getByTestId('array-dx').fill('3');
  await dlg.getByTestId('array-dy').fill('2');
  await dlg.getByTestId('array-ok').click();
  await waitSaved(page);
  let els = await elements();
  expect(els).toHaveLength(2 + 5);
  const copies = els.slice(2);
  expect(copies.some((c) => Math.abs(c.shape.x - (first.shape.x + 6)) < 0.011 && Math.abs(c.shape.y - (first.shape.y - 2)) < 0.011)).toBe(true);
  for (const c of copies) expect(c.style).toEqual(first.style);

  // polar: wieder das erste Rechteck, 4 Stück im Vollkreis, Mittelpunkt 2 m rechts davon
  await page.mouse.click(vb.x + vb.width / 2, vb.y + 1);
  await pickTool(page, 'draw-array');
  await dlg.getByTestId('array-kind-polar').click();
  await dlg.getByTestId('array-pcount').fill('4');
  await dlg.getByTestId('array-total').fill('360');
  await expect(dlg.getByTestId('array-rotate')).toBeChecked();
  await dlg.getByTestId('array-ok').click();
  await expect(page.getByTestId('command-prompt')).toContainText('Mittelpunkt');
  const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const cx = vb.x + vb.width / 2 + 3 * 100 * scale;
  const cy = vb.y + vb.height / 2;
  await page.getByTestId('snap-toggle').click(); // ohne Fang: genau dort
  await page.mouse.move(cx, cy, { steps: 3 });
  await expect(page.getByTestId('cad-ghost')).toBeVisible();
  await page.mouse.click(cx, cy);
  await page.getByTestId('snap-toggle').click();
  await waitSaved(page);
  els = await elements();
  expect(els).toHaveLength(7 + 3);
  const rot = els.slice(7).map((e) => e.shape.rotation ?? 0).sort((a, b) => a - b);
  expect(rot).toEqual([90, 180, 270]);
  // Gegenüber (180°): 6 m weiter rechts (Mittelpunkt 3 m rechts der Mitte)
  const opp = els.slice(7).find((e) => e.shape.rotation === 180)!;
  near(opp.shape.x + opp.shape.w / 2, first.shape.x + first.shape.w / 2 + 6, 0.05);
});

test('PDF mit neuen Linienarten und Schraffuren', async () => {
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'cad-phase3.pdf');
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Pages:\s+1/);
  execFileSync('pdftoppm', ['-png', '-r', '60', pdf, 'tests/output/cad-phase3']);
});
