import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, waitSaved, pickTool } from './helpers';

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

test('Obere Werkzeugleiste: Registerkarten Zeichnen, Ändern, Darstellung, Messen, Ansicht', async () => {
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
  // Leiste liegt oben, die Planfläche beginnt darunter
  const bb = (await bar.boundingBox())!;
  expect(bb.y + bb.height).toBeLessThanOrEqual((await sheet().boundingBox())!.y + 1);
  for (const [tab, ids] of [
    ['draw', ['draw-select', 'draw-line', 'draw-polyline', 'draw-rect', 'draw-ellipse', 'draw-arc', 'draw-polygon', 'draw-text', 'draw-delete', 'draw-undo', 'draw-redo']],
    ['modify', ['draw-move', 'draw-copy', 'draw-rotate', 'draw-scale', 'draw-stretch', 'draw-trim', 'draw-extend']],
    ['style', ['ribbon-style']],
    ['measure', ['draw-dimension', 'ribbon-measure']],
    ['view', ['view-zoom-in', 'view-zoom-out', 'view-fit', 'view-zoom-sel', 'view-grid', 'view-snap']],
  ] as const) {
    await bar.getByTestId(`ribbon-tab-${tab}`).click();
    for (const id of ids) await expect(bar.getByTestId(id)).toBeVisible();
  }
  await bar.getByTestId('ribbon-tab-modify').click();
  await expect(bar.getByTestId('draw-copy')).toBeDisabled(); // nichts ausgewählt
  await expect(bar.getByTestId('draw-rotate')).toBeDisabled();
  await bar.getByTestId('ribbon-tab-draw').click();
  await expect(bar.getByTestId('draw-freehand')).toHaveCount(0); // Freihand durch Polylinie ersetzt
  await expect(bar.getByTestId('draw-triangle')).toHaveCount(0); // Dreieck über „Freie Form“
  // Bezeichnungen: „Freie Form“ (statt Polylinie) und „Fläche“ (statt Polygon), nebeneinander
  await expect(bar.getByTestId('draw-polyline')).toHaveText('Freie Form');
  await expect(bar.getByTestId('draw-polygon')).toHaveText('Fläche');
  const order = await bar.locator('[role="group"][aria-label="Zeichnen"] .tool-btn').evaluateAll((b) => b.map((x) => x.getAttribute('data-testid')));
  expect(order.indexOf('draw-polygon')).toBe(order.indexOf('draw-polyline') + 1);
  await expect(bar.getByTestId('draw-delete')).toBeDisabled(); // nichts ausgewählt
  await page.screenshot({ path: 'tests/output/werkzeugleiste.png' });
});

test('Offene Polylinie: Enter beendet, nur Länge (keine Fläche); schließen/öffnen umschaltbar', async () => {
  await pickTool(page, 'draw-polyline');
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const ox = sb.x + 80;
  const oy = sb.y + 120;
  // L-Form: 200 px nach rechts, 100 px nach unten, 80 px nach rechts
  for (const [dx, dy] of [[0, 0], [200, 0], [200, 100], [280, 100]]) await page.mouse.click(ox + dx, oy + dy);
  await expect(page.getByTestId('polygon-bar')).toContainText('Freie Form: 4 Punkte'); // im Zeichenmodus „Freie Form“
  await expect(page.getByTestId('polygon-preview')).toBeVisible();
  // Rücktaste nimmt den letzten Punkt zurück, danach an anderer Stelle neu setzen
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('polygon-bar')).toContainText('3 Punkte');
  await page.mouse.click(ox + 320, oy + 100);
  await page.keyboard.press('Enter');
  const el = page.getByTestId('element-bar');
  await expect(el).toContainText('Freie Form');
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
  await pickTool(page, 'draw-polyline');
  const sb = (await sheet().boundingBox())!;
  const ox = sb.x + 450;
  const oy = sb.y + 120;
  await page.mouse.click(ox, oy);
  await page.mouse.click(ox + 120, oy + 20);
  await page.mouse.dblclick(ox + 160, oy + 90);
  await expect(page.getByTestId('element-bar')).toContainText('Freie Form');
  await waitSaved(page);
  let e = (await elements()).at(-1)!;
  expect(e.shape.closed).toBe(false);
  expect(e.shape.points).toHaveLength(3);

  // Unregelmäßige geschlossene Fläche mit 6 Punkten
  await deselect();
  await pickTool(page, 'draw-polyline');
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
  await pickTool(page, 'draw-select');
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
  await pickTool(page, 'draw-undo');
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(6);
  await waitSaved(page);

  // Nach dem Neuladen vollständig bearbeitbar
  const id = (await elements()).at(-1)!.id;
  await page.reload();
  await expect(sheet()).toBeVisible();
  await page.getByTestId('mode-draw').click();
  await pickTool(page, 'draw-select');
  const pb = (await page.locator(`[data-element-id="${id}"]`).boundingBox())!;
  await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(6);
});

test('Linie mit eingefügtem Punkt wird zur offenen Polylinie; Mindestpunktzahl bleibt erhalten', async () => {
  await deselect();
  await pickTool(page, 'draw-line');
  const sb = (await sheet().boundingBox())!;
  const x = sb.x + 450;
  const y = sb.y + 330;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 4 });
  await page.mouse.move(x + 200, y, { steps: 4 });
  await page.mouse.up();
  await pickTool(page, 'draw-select');
  await expect(page.getByTestId('element-bar')).toContainText('Linie');
  await page.mouse.dblclick(x + 100, y);
  await expect(page.getByTestId('element-bar')).toContainText('Freie Form');
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
  await pickTool(page, 'tool-polyline');
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const x = sb.x + 600;
  const y = sb.y + 420;
  for (const [dx, dy] of [[0, 0], [150, 0], [150, 80]]) await page.mouse.click(x + dx, y + dy);
  await page.getByTestId('polyline-open').click();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toContainText('Neue Linie');
  await expect(dlg).toContainText('Höhe (optional)');
  // Länge aus dem Plan = Summe aller Abschnitte (vorgewählt, wird nachgeführt)
  await expect(dlg.getByTestId('use-geometry')).toHaveText('Länge wieder von Hand eingeben');
  const len0 = num(await dlg.getByTestId('geometry-length').inputValue());
  expect(Math.abs(len0 - 230 / s / 100)).toBeLessThan(0.03);
  await dlg.getByTestId('damage-save').click();
  await expect(page.locator('[data-testid="aufmass-row"]')).toHaveCount(1);
  const barLen = async () => num((await page.getByTestId('selection-bar').locator('.selection-info span').nth(1).textContent())!.match(/L ([\d.,]+) m/)![1]);

  // Nachträglich bearbeiten: Knick verschieben → Länge wird nachgeführt
  await pickTool(page, 'tool-select');
  await page.mouse.click(x + 75, y);
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(3);
  const v2 = (await page.getByTestId('vertex-2').boundingBox())!;
  await page.mouse.move(v2.x + v2.width / 2, v2.y + v2.height / 2);
  await expect(page.getByTestId('vertex-2')).toHaveClass(/hover/); // Griff unter der Maus hervorgehoben
  await page.mouse.down();
  await page.mouse.move(x + 150, y + 160, { steps: 6 });
  await page.mouse.up();
  await expect.poll(barLen).toBeCloseTo(310 / s / 100, 1);
  expect(Math.abs((await barLen()) - 310 / s / 100)).toBeLessThan(0.03);
  // Doppelklick auf eine Kante fügt einen Punkt ein, Länge bleibt gleich
  await page.mouse.dblclick(x + 75, y);
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(4);
  expect(Math.abs((await barLen()) - 310 / s / 100)).toBeLessThan(0.03);
  // Eckpunkt auswählen und entfernen
  const v1 = (await page.getByTestId('vertex-1').boundingBox())!;
  await page.mouse.click(v1.x + v1.width / 2, v1.y + v1.height / 2);
  await page.getByTestId('vertex-remove').click();
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(3);
  await waitSaved(page);

  await pickTool(page, 'tool-polyline');
  for (const [dx, dy] of [[-260, -40], [-160, -40], [-160, 40], [-260, 40]]) await page.mouse.click(x + dx, y + dy);
  await page.getByTestId('polygon-finish').click();
  await expect(dlg).toContainText('Neue Fläche');
  await expect(dlg).toContainText('Breite / Höhe (optional)');
  await dlg.getByTestId('damage-cancel').click();

  // Rechteck mit Fläche aus dem Plan: Ecke einzeln verschieben (→ Trapez), Fläche wird nachgeführt
  await pickTool(page, 'tool-rect');
  await page.mouse.move(x - 260, y - 240);
  await page.mouse.down();
  await page.mouse.move(x - 160, y - 180, { steps: 5 });
  await page.mouse.move(x - 60, y - 140, { steps: 5 });
  await page.mouse.up();
  await dlg.getByTestId('use-geometry').click();
  const a0 = num((await dlg.getByTestId('area-result').locator('strong').textContent())!.replace(/\s*m²/, ''));
  expect(Math.abs(a0 - (200 * 100) / (s * 100) ** 2)).toBeLessThan(0.05);
  await dlg.getByTestId('damage-save').click();
  await pickTool(page, 'tool-select');
  await page.mouse.click(x - 160, y - 239);
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(4); // vier Ecken
  await expect(page.locator('.handles rect.handle')).toHaveCount(4); // vier Seitengriffe
  const c2 = (await page.getByTestId('vertex-2').boundingBox())!;
  await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 40, y - 140, { steps: 6 }); // untere rechte Ecke 100 px nach rechts
  await page.mouse.up();
  const barArea = async () => num((await page.getByTestId('selection-bar').locator('.selection-info span').nth(1).textContent())!.match(/([\d.,]+) m² aus Plan/)![1]);
  // Trapez: (200 + 300) / 2 × 100 px
  await expect.poll(async () => Math.abs((await barArea()) - (250 * 100) / (s * 100) ** 2)).toBeLessThan(0.05);
  await waitSaved(page);
});

test('Wand: Verlauf mit Knicken, Länge aus allen Abschnitten, danach Höhe → Wandfläche; Knick verschieben aktualisiert', async () => {
  await deselect();
  await pickTool(page, 'tool-wall');
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const x = sb.x + 120;
  const y = sb.y + 80;
  // L-förmige Wand: 200 px nach rechts, 100 px nach unten, 100 px nach rechts → 400 px
  for (const [dx, dy] of [[0, 0], [200, 0], [200, 100], [300, 100]]) await page.mouse.click(x + dx, y + dy);
  await expect(page.getByTestId('polygon-bar')).toContainText('Wand: 4 Punkte');
  // Antippen des Startpunkts schließt eine Wand nicht – Enter beendet den Verlauf
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toContainText('Neue Wand');
  const len = num(await dlg.getByTestId('geometry-length').inputValue());
  expect(Math.abs(len - 400 / s / 100)).toBeLessThan(0.03);
  // gleich nach der Wandhöhe gefragt
  await expect(dlg.getByTestId('input-width')).toBeFocused();
  await expect(dlg).toContainText('Wandhöhe');
  await page.keyboard.type('2,5');
  const area = num((await dlg.getByTestId('wall-area').textContent())!.replace(/\s*m²/, ''));
  expect(Math.abs(area - len * 2.5)).toBeLessThan(0.01);
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  const row = page.locator('[data-testid="aufmass-row"]').last();
  await expect(row.getByTestId('row-kind')).toHaveAttribute('title', 'Wand');
  await expect(page.getByTestId('selection-bar')).toContainText('Wand Nr.');
  // letzten Knick verschieben (100 px weiter nach rechts) → Länge und Wandfläche werden nachgeführt, Höhe bleibt
  await pickTool(page, 'tool-select');
  await page.mouse.click(x + 100, y);
  await expect(page.locator('circle[data-testid^="vertex-"]')).toHaveCount(4);
  const v3 = (await page.getByTestId('vertex-3').boundingBox())!;
  await page.mouse.move(v3.x + v3.width / 2, v3.y + v3.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 400, y + 100, { steps: 6 });
  await page.mouse.up();
  const summary = async () => (await page.getByTestId('selection-bar').locator('.selection-info span').nth(1).textContent())!;
  await expect.poll(async () => Math.abs(num(/([\d.,]+) ×/.exec(await summary())![1]) - 500 / s / 100)).toBeLessThan(0.03);
  expect(await summary()).toContain('× 2,50 m');
  const a2 = num(/= ([\d.,]+) m²/.exec(await summary())![1]);
  expect(Math.abs(a2 - (500 / s / 100) * 2.5)).toBeLessThan(0.05);
  await waitSaved(page);
});

test('Messung: Menü mit fünf Messarten; Länge, Winkel, Radius, Abstand, Fläche – nichts wird verändert, Fläche ausdrücklich ins Aufmaß', async () => {
  await deselect();
  const rows = page.locator('[data-testid="aufmass-row"]');
  const before = await rows.count();
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const m = (px: number) => px / s / 100; // Bildschirm-Pixel → m
  // Punktfang aus, damit die Testpunkte nicht an vorhandene Objekte springen
  const snap = page.getByTestId('snap-toggle-measure');
  if ((await snap.getAttribute('aria-pressed')) === 'true') await snap.click();
  const x = sb.x + 160;
  const y = sb.y + 160; // weit genug über der Leiste der Messung
  const at = (dx: number, dy: number) => page.mouse.click(x + dx, y + dy);
  const result = () => page.getByTestId('probe-result').locator('strong');
  const val = async () => num((await result().textContent())!.replace(/^r = /, '').replace(/\s*(m²|m|°)$/, ''));

  // Menü mit Symbolen; ein anderes Werkzeug schließt es
  await page.getByTestId('tool-probe').click();
  const menu = page.getByTestId('probe-menu');
  await expect(menu.getByRole('menuitem')).toHaveText([/Länge/, /Fläche/, /Winkel/, /Radius/, /Abstand/]);
  await expect(menu.locator('.probe-menu-icon svg')).toHaveCount(5);
  await page.screenshot({ path: 'tests/output/messung-menue.png' });
  await page.getByTestId('tool-polyline').click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('tool-polyline')).toHaveAttribute('aria-pressed', 'true');
  // Tipp in den Plan schließt das Menü ebenfalls (Auswahl-Werkzeug, freie Stelle)
  await page.getByTestId('tool-select').click();
  await page.getByTestId('tool-probe').click();
  await expect(menu).toBeVisible();
  await page.mouse.click(sb.x + 30, sb.y + 30);
  await expect(menu).toHaveCount(0);
  await page.getByTestId('tool-probe').click();
  await menu.getByTestId('probe-menu-length').click();
  await expect(page.getByTestId('probe-hint')).toContainText('Punkte nacheinander');

  // Länge über zwei Abschnitte (300 + 100 px), Enter beendet
  await at(0, 0);
  await at(300, 0);
  await at(300, 100);
  await page.keyboard.press('Enter');
  expect(Math.abs((await val()) - m(400))).toBeLessThan(0.02);
  await expect(page.getByTestId('probe-result')).toContainText('2 Abschnitte');
  await expect(page.getByTestId('probe-label')).toBeVisible(); // Ergebnis im Plan
  await expect(page.locator('.probe-point')).toHaveCount(3); // bestätigte Punkte

  // Winkel: 90° am mittleren Punkt, Bogen im Plan
  await page.getByTestId('probe-kind-angle').click();
  await at(100, 0);
  await at(0, 0);
  await at(0, 100);
  await expect(result()).toHaveText('90,0°');
  await expect(page.getByTestId('probe-angle-arc')).toBeVisible();
  await page.screenshot({ path: 'tests/output/messung-winkel.png' });

  // Radius: Mittelpunkt und Punkt auf dem Kreis (60/80 px → 100 px), mit Durchmesser
  await page.getByTestId('probe-kind-radius').click();
  await at(0, 0);
  await at(60, 80);
  expect(Math.abs((await val()) - m(100))).toBeLessThan(0.02);
  await expect(page.getByTestId('probe-result')).toContainText('Ø');

  // Abstand mit waagrechtem und senkrechtem Anteil (300 px waagrecht, 200 px senkrecht)
  await page.getByTestId('probe-kind-distance').click();
  await at(0, 0);
  await at(300, 200);
  expect(Math.abs((await val()) - m(Math.hypot(300, 200)))).toBeLessThan(0.02);
  await expect(page.getByTestId('probe-result')).toContainText('waagrecht');

  // Kontrollmessungen ändern nichts
  await expect(rows).toHaveCount(before);

  // Esc beendet die Messung und schaltet auf „Auswahl“
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('probe-bar')).toHaveCount(0);
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('tool-probe').click();
  await page.getByTestId('probe-menu').getByTestId('probe-menu-area').click();

  // Fläche 200 × 100 px, Startpunkt schließt; ausdrücklich ins Aufmaß übernehmen
  for (const [dx, dy] of [[0, 0], [200, 0], [200, 100], [0, 100], [0, 0]]) await at(dx, dy);
  expect(Math.abs((await val()) - m(200) * m(100))).toBeLessThan(0.02);
  await expect(page.getByTestId('probe-result')).toContainText('Umfang');
  await expect(rows).toHaveCount(before);
  await page.getByTestId('probe-adopt').click();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toContainText('Neue Fläche');
  await expect(dlg.getByTestId('use-geometry')).toHaveAttribute('aria-pressed', 'true'); // Fläche aus dem Plan
  await dlg.getByTestId('damage-save').click();
  await expect(rows).toHaveCount(before + 1);
  await expect(page.getByTestId('probe-bar')).toHaveCount(0);
  await snap.click(); // Punktfang wieder ein
  await waitSaved(page);
});

test('Messung unter „Plan bearbeiten“: Reiter Messen, Abstand und Fläche, ins Aufmaß – Zeichnung bleibt unverändert', async () => {
  await page.getByTestId('mode-draw').click();
  const before = JSON.stringify(await elements());
  const sb = (await sheet().boundingBox())!;
  const s = await scale();
  const m = (px: number) => px / s / 100;
  const bar = page.getByTestId('draw-toolbar');
  await bar.getByTestId('ribbon-tab-measure').click();
  await bar.getByTestId('ribbon-probe').click();
  await expect(bar.getByTestId('probe-menu').getByRole('menuitem')).toHaveCount(5);
  await bar.getByTestId('probe-menu-distance').click();
  const x = sb.x + 160;
  const y = sb.y + 160;
  await page.mouse.click(x, y);
  await page.mouse.click(x + 300, y + 200);
  const val = async () => num((await page.getByTestId('probe-result').locator('strong').textContent())!.replace(/\s*(m²|m)$/, ''));
  // Punktfang kann auf Zeichnungsobjekte einrasten – daher großzügig
  expect(Math.abs((await val()) - m(Math.hypot(300, 200)))).toBeLessThan(0.15);
  await expect(page.getByTestId('probe-result')).toContainText('waagrecht');
  // Fläche über drei Punkte, „Fertig“, dann ausdrücklich ins Aufmaß → Wechsel ins Aufmaß mit neuer Fläche
  await page.getByTestId('probe-kind-area').click();
  for (const [dx, dy] of [[0, 0], [200, 0], [0, 150]]) await page.mouse.click(x + dx, y + dy);
  await page.getByTestId('probe-finish').click();
  await expect(page.getByTestId('probe-result')).toContainText('m²');
  expect(JSON.stringify(await elements())).toBe(before); // Zeichnung unverändert
  await page.getByTestId('probe-adopt').click();
  await expect(page.getByTestId('mode-measure-tab')).toHaveAttribute('aria-selected', 'true');
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toContainText('Neue Fläche');
  await dlg.getByTestId('damage-cancel').click();
});


test('Plan bearbeiten: Esc beendet Punkte, Messung und Auswahl und schaltet auf „Auswahl“', async () => {
  await page.getByTestId('mode-draw').click();
  const sb = (await sheet().boundingBox())!;
  const bar = page.getByTestId('draw-toolbar');
  const count = (await elements()).length;
  // angefangene Freie Form: Esc verwirft die Punkte, Werkzeug „Auswahl“
  await pickTool(page, 'draw-polyline');
  await page.mouse.click(sb.x + 120, sb.y + 380);
  await page.mouse.click(sb.x + 260, sb.y + 380);
  await page.keyboard.press('Escape');
  await expect(bar.getByTestId('draw-select')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(sb.x + 300, sb.y + 420);
  expect((await elements()).length).toBe(count);
  // laufende Messung: Esc schließt sie
  await bar.getByTestId('ribbon-tab-measure').click();
  await bar.getByTestId('ribbon-probe').click();
  await bar.getByTestId('probe-menu-length').click();
  await page.mouse.click(sb.x + 120, sb.y + 380);
  await expect(page.getByTestId('probe-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('probe-bar')).toHaveCount(0);
  await bar.getByTestId('ribbon-tab-draw').click();
  await expect(bar.getByTestId('draw-select')).toHaveAttribute('aria-pressed', 'true');
});
