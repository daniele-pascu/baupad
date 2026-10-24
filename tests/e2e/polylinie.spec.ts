import { expect, test, type Page } from '@playwright/test';
import { createProject, freshStart, waitSaved } from './helpers';

/**
 * Paket G: Werkzeugleiste wie in CAD-Programmen, Polylinie offen/geschlossen, Eckpunkte
 * auswählen, einfügen und entfernen – im Zeichen- und im Aufmaßmodus.
 */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; shape: { type: string; closed?: boolean; points?: number[][] }; createdAt: number };
async function elements(): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
const scale = async () => Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
const sheet = () => page.getByTestId('drawing-sheet');
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
async function infoValue(label: RegExp) {
  const t = (await page.getByTestId('element-info').textContent())!;
  return num(t.match(label)![1]);
}
async function deselect() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}

test('Werkzeugleiste: Gruppen Auswahl, Zeichnen, Beschriften, Bearbeiten', async () => {
  await freshStart(page);
  await createProject(page, 'Polylinie', {}, ['Halle']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('PL-1');
  await nd.getByTestId('sheet-paper').selectOption('A4-quer');
  await nd.getByTestId('sheet-scale').selectOption('50');
  await nd.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  const bar = page.getByTestId('draw-toolbar');
  for (const [group, ids] of [
    ['Auswahl', ['draw-select']],
    ['Zeichnen', ['draw-line', 'draw-polyline', 'draw-rect', 'draw-ellipse', 'draw-triangle', 'draw-polygon']],
    ['Beschriften', ['draw-dimension', 'draw-text']],
    ['Bearbeiten', ['draw-delete', 'draw-undo', 'draw-redo']],
  ] as const) {
    const g = bar.getByRole('group', { name: group });
    for (const id of ids) await expect(g.getByTestId(id)).toBeVisible();
  }
  await expect(bar.getByTestId('draw-freehand')).toHaveCount(0); // Freihand durch Polylinie ersetzt
  await expect(bar.getByTestId('draw-delete')).toBeDisabled(); // nichts ausgewählt
  await page.screenshot({ path: 'tests/output/werkzeugleiste.png' });
});

test('Offene Polylinie: Enter beendet, nur Länge (keine Fläche); schließen/öffnen umschaltbar', async () => {
  await page.getByTestId('draw-polyline').click();
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const ox = sb.x + 80;
  const oy = sb.y + 120;
  // L-Form: 200 px nach rechts, 100 px nach unten, 80 px nach rechts
  for (const [dx, dy] of [[0, 0], [200, 0], [200, 100], [280, 100]]) await page.mouse.click(ox + dx, oy + dy);
  await expect(page.getByTestId('polygon-bar')).toContainText('Polylinie: 4 Punkte');
  await expect(page.getByTestId('polygon-preview')).toBeVisible();
  // Rücktaste nimmt den letzten Punkt zurück, danach an anderer Stelle neu setzen
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('polygon-bar')).toContainText('3 Punkte');
  await page.mouse.click(ox + 320, oy + 100);
  await page.keyboard.press('Enter');
  const el = page.getByTestId('element-bar');
  await expect(el).toContainText('Polylinie');
  const expected = 420 / s / 100;
  expect(Math.abs((await infoValue(/Länge gesamt ([\d.,]+) m/)) - expected)).toBeLessThan(0.03);
  await expect(page.getByTestId('element-info')).toContainText('keine Fläche');
  await expect(page.getByTestId('element-info')).not.toContainText('m²');
  await waitSaved(page);
  let e = (await elements()).at(-1)!;
  expect(e).toMatchObject({ type: 'freehand', shape: { type: 'freehand', closed: false } });
  expect(e.shape.points).toHaveLength(4);

  // Schließen → Fläche und Umfang
  await el.getByTestId('element-toggle-closed').click();
  await expect(el).toContainText('Fläche');
  const area = await infoValue(/Fläche ([\d.,]+) m²/);
  expect(area).toBeGreaterThan(0);
  await expect(page.getByTestId('element-info')).toContainText('Umfang');
  await waitSaved(page);
  e = (await elements()).at(-1)!;
  expect(e.shape.closed).toBe(true);
  // und wieder öffnen
  await el.getByTestId('element-toggle-closed').click();
  await expect(page.getByTestId('element-info')).toContainText('Länge gesamt');
  await waitSaved(page);
  expect((await elements()).at(-1)!.shape.closed).toBe(false);
});

test('Polylinie: Doppelklick beendet offen, Klick auf Startpunkt schließt', async () => {
  await deselect();
  await page.getByTestId('draw-polyline').click();
  const sb = (await sheet().boundingBox())!;
  const ox = sb.x + 450;
  const oy = sb.y + 120;
  await page.mouse.click(ox, oy);
  await page.mouse.click(ox + 120, oy + 20);
  await page.mouse.dblclick(ox + 160, oy + 90);
  await expect(page.getByTestId('element-bar')).toContainText('Polylinie');
  await waitSaved(page);
  let e = (await elements()).at(-1)!;
  expect(e.shape.closed).toBe(false);
  expect(e.shape.points).toHaveLength(3);

  // Unregelmäßige geschlossene Fläche mit 6 Punkten
  await deselect();
  await page.getByTestId('draw-polyline').click();
  const px = sb.x + 120;
  const py = sb.y + 300;
  const pts = [[0, 0], [160, -20], [220, 60], [150, 140], [60, 120], [-20, 60]];
  for (const [dx, dy] of pts) await page.mouse.click(px + dx, py + dy);
  await page.mouse.click(px + 2, py + 1); // Startpunkt → geschlossen
  await expect(page.getByTestId('element-bar')).toContainText('Fläche');
  await waitSaved(page);
  e = (await elements()).at(-1)!;
  expect(e.shape.closed).toBe(true);
  expect(e.shape.points).toHaveLength(6);
  // Fläche nach Gaußscher Trapezformel aus den gesetzten Punkten
  const s = await scale();
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  const expected = Math.abs(a) / 2 / (s * 100) ** 2;
  expect(Math.abs((await infoValue(/Fläche ([\d.,]+) m²/)) - expected) / expected).toBeLessThan(0.02);
});

test('Eckpunkte: auswählen und entfernen, per Doppelklick auf eine Kante einfügen', async () => {
  // Die zuletzt gezeichnete Fläche (6 Punkte) ist ausgewählt
  await page.getByTestId('draw-select').click();
  const el = page.getByTestId('element-bar');
  const areaBefore = await infoValue(/Fläche ([\d.,]+) m²/);
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(6);
  const v = (await page.getByTestId('vertex-2').boundingBox())!;
  await page.mouse.click(v.x + v.width / 2, v.y + v.height / 2);
  await expect(el.getByTestId('vertex-remove')).toContainText('Eckpunkt 3');
  await el.getByTestId('vertex-remove').click();
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(5);
  const areaAfter = await infoValue(/Fläche ([\d.,]+) m²/);
  expect(areaAfter).toBeLessThan(areaBefore); // Fläche automatisch neu berechnet
  await waitSaved(page);
  expect((await elements()).at(-1)!.shape.points).toHaveLength(5);

  // Doppelklick auf die Mitte der ersten Kante → neuer Eckpunkt
  const a = (await page.getByTestId('vertex-0').boundingBox())!;
  const b = (await page.getByTestId('vertex-1').boundingBox())!;
  await page.mouse.dblclick((a.x + b.x) / 2 + a.width / 2, (a.y + b.y) / 2 + a.height / 2);
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(6);
  await expect(el.getByTestId('vertex-remove')).toContainText('Eckpunkt 2');
  // Neuen Punkt nach außen ziehen → Fläche wächst
  const n = (await page.getByTestId('vertex-1').boundingBox())!;
  const before = await infoValue(/Fläche ([\d.,]+) m²/);
  await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2);
  await page.mouse.down();
  await page.mouse.move(n.x + n.width / 2, n.y - 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => infoValue(/Fläche ([\d.,]+) m²/)).toBeGreaterThan(before);
  // Entf entfernt den ausgewählten Eckpunkt (nicht das Objekt)
  await page.keyboard.press('Delete');
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(5);
  await expect(el).toBeVisible();
  // Rückgängig stellt den Punkt wieder her
  await page.getByTestId('draw-undo').click();
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(6);
  await waitSaved(page);

  // Nach dem Neuladen vollständig bearbeitbar
  const id = (await elements()).at(-1)!.id;
  await page.reload();
  await expect(sheet()).toBeVisible();
  await page.getByTestId('mode-draw').click();
  await page.getByTestId('draw-select').click();
  const pb = (await page.locator(`[data-element-id="${id}"]`).boundingBox())!;
  await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(6);
});

test('Linie mit eingefügtem Punkt wird zur offenen Polylinie; Mindestpunktzahl bleibt erhalten', async () => {
  await deselect();
  await page.getByTestId('draw-line').click();
  const sb = (await sheet().boundingBox())!;
  const x = sb.x + 450;
  const y = sb.y + 330;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 4 });
  await page.mouse.move(x + 200, y, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId('draw-select').click();
  await expect(page.getByTestId('element-bar')).toContainText('Linie');
  await page.mouse.dblclick(x + 100, y);
  await expect(page.getByTestId('element-bar')).toContainText('Polylinie');
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(3);
  await waitSaved(page);
  const e = (await elements()).at(-1)!;
  expect(e).toMatchObject({ type: 'freehand', shape: { closed: false } });
  // Zwei Punkte entfernen geht nicht: offene Polylinie braucht mindestens 2 Punkte
  const v = (await page.getByTestId('vertex-1').boundingBox())!;
  await page.mouse.click(v.x + v.width / 2, v.y + v.height / 2);
  await page.getByTestId('vertex-remove').click();
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(2);
  const w = (await page.getByTestId('vertex-0').boundingBox())!;
  await page.mouse.click(w.x + w.width / 2, w.y + w.height / 2);
  await expect(page.getByTestId('vertex-remove')).toBeDisabled();
});

test('Aufmaß: offene Polylinie = Linienmessung mit Länge, geschlossene = Fläche', async () => {
  await deselect();
  await page.getByTestId('mode-measure').click();
  await page.getByTestId('tool-polyline').click();
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const x = sb.x + 600;
  const y = sb.y + 420;
  for (const [dx, dy] of [[0, 0], [150, 0], [150, 80]]) await page.mouse.click(x + dx, y + dy);
  await page.getByTestId('polyline-open').click();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg.getByTestId('kind-line')).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByTestId('input-width')).toHaveCount(0);
  // Längenvorschlag = Summe der Abschnitte
  const sug = num((await dlg.getByTestId('use-suggestion').textContent())!.match(/([\d.,]+) m/)![1]);
  expect(Math.abs(sug - 230 / s / 100)).toBeLessThan(0.03);
  await dlg.getByTestId('use-suggestion').click();
  await dlg.getByTestId('damage-save').click();
  await expect(page.locator('[data-testid="aufmass-row"]')).toHaveCount(1);

  for (const [dx, dy] of [[0, 120], [150, 120], [150, 200], [0, 200]]) await page.mouse.click(x + dx, y + dy);
  await page.getByTestId('polygon-finish').click();
  await expect(dlg.getByTestId('kind-line')).toHaveAttribute('aria-checked', 'false');
  await expect(dlg.getByTestId('input-width')).toBeVisible();
  await dlg.getByTestId('damage-cancel').click();
});
