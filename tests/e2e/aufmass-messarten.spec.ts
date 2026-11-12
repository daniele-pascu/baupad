import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/**
 * Aufmaß: zuerst die Messart wählen (Fläche, Wand, Länge, Volumen, Stück, Schadstelle, Frei), danach misst jedes
 * Werkzeug in dieser Art. Dialog mit Feldern je Messart, Tabelle und Rechenweg.
 */

test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type Dmg = { id: string; measureType?: string; kind?: string; count?: number; length: number; width: number | null; depth: number | null; area: number | null; qty?: number | null; unit?: string | null; workArea?: string | null; damageType?: string | null; createdAt: number };
const damages = () =>
  page.evaluate(
    () =>
      new Promise<Dmg[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('damages').objectStore('damages').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (Dmg & { deletedAt: number | null })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
/** zuletzt gespeicherte Messung (nach dem Speichern) */
async function lastDmg() {
  await waitSaved(page);
  return (await damages()).at(-1)!;
}
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const scale = async () => Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
const dlg = () => page.getByTestId('damage-dialog');

async function chooseType(id: string) {
  await pickTool(page, 'tool-mtype');
  await expect(page.getByTestId('mtype-menu')).toBeVisible();
  await page.getByTestId(`mtype-${id}`).click();
  await expect(page.getByTestId('tool-mtype')).toHaveAttribute('data-value', id);
}
/** Rechteck w × h Pixel ab (x, y) ziehen */
async function rect(x: number, y: number, w: number, h: number) {
  await pickTool(page, 'tool-rect');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + w / 2, y + h / 2, { steps: 4 });
  await page.mouse.move(x + w, y + h, { steps: 4 });
  await page.mouse.up();
  await expect(dlg()).toBeVisible();
}

test('Messart wählen, dann mit beliebigem Werkzeug messen: Wand, Stück, Frei, Volumen, Anzahl', async () => {
  await freshStart(page);
  await createProject(page, 'Messarten', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('M-1');
  await nd.getByTestId('sheet-scale').selectOption('50');
  await nd.getByTestId('new-drawing-save').click();
  await page.getByTestId('mode-measure').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  const s = await scale();
  const px = (m: number) => m * 100 * s;
  const x = sb.x + 120;
  const y = sb.y + 120;

  // kein „Automatisch“ mehr: zuerst die Messart wählen, vorher keine Zeichenwerkzeuge
  await expect(page.getByTestId('tool-mtype')).toContainText('Messart wählen');
  await expect(page.getByTestId('tool-rect')).toHaveCount(0);
  await pickTool(page, 'tool-mtype');
  await expect(page.getByTestId('mtype-menu')).toBeVisible();
  await expect(page.getByTestId('mtype-auto')).toHaveCount(0);
  await page.getByTestId('tool-mtype').click(); // Menü wieder zu

  // 1) Wand (nur Werkzeug Wand): Verlauf rundum 4 × 3 m, Enter beendet → Länge aus dem Plan × Höhe
  await chooseType('wand');
  await expect(page.getByTestId('tool-wall')).toHaveAttribute('aria-pressed', 'true');
  for (const [dx, dy] of [[0, 0], [4, 0], [4, 3], [0, 3], [0, 0.0001]]) await page.mouse.click(x + px(dx), y + px(dy));
  await page.keyboard.press('Enter');
  await expect(dlg()).toContainText('Neue Messung: Wand');
  await expect(dlg().getByTestId('measure-type-select')).toHaveValue('wand');
  const len = num(await dlg().getByTestId('geometry-length').inputValue());
  expect(Math.abs(len - 14)).toBeLessThan(0.1); // Umfang 2 × (4 + 3)
  await dlg().getByTestId('input-width').fill('2,5');
  const wallArea = num((await dlg().getByTestId('wall-area').textContent())!.replace(/\s*m²/, ''));
  expect(Math.abs(wallArea - len * 2.5)).toBeLessThan(0.02);
  await dlg().getByTestId('input-work-area').fill('Mauerwerk');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  let d = await lastDmg();
  expect(d.measureType).toBe('wand');
  expect(d.workArea).toBe('Mauerwerk');
  expect(Math.abs(d.area! - len * 2.5)).toBeLessThan(0.02);
  await expect(page.locator('[data-testid="aufmass-row"]').last().getByTestId('row-kind')).toHaveAttribute('title', 'Wand');

  // 2) Stück (nur Punkte): einen Punkt setzen, „Fertig“ – Anzahl im Dialog änderbar
  await chooseType('stueck');
  await page.mouse.click(x + px(6), y);
  await page.getByTestId('points-done').click();
  await expect(dlg()).toContainText('Neue Messung: Stück');
  await expect(dlg().getByTestId('input-length')).toHaveCount(0);
  await dlg().getByTestId('input-count').fill('4');
  await expect(dlg().getByTestId('count-result')).toHaveText('4 Stk');
  await dlg().getByTestId('damage-save').click();
  d = await lastDmg();
  expect(d.measureType).toBe('stueck');
  expect(d.count).toBe(4);
  expect(d.length).toBe(0);
  await expect(page.locator('[data-testid="aufmass-row"]').last().getByTestId('row-qty')).toHaveText('4 Stk');

  // 3) Frei: eigene Rechnung und Einheit
  await chooseType('frei');
  await rect(x + px(8), y, px(1), px(1));
  await dlg().getByTestId('input-formula').fill('2*3,5+1,2');
  await dlg().getByTestId('input-unit').fill('kg');
  await expect(dlg().getByTestId('free-result')).toHaveText('8,20 kg');
  await dlg().getByTestId('damage-save').click();
  d = await lastDmg();
  expect(d.measureType).toBe('frei');
  expect(d.qty).toBe(8.2);
  expect(d.unit).toBe('kg');
  await expect(page.locator('[data-testid="aufmass-row"]').last().getByTestId('row-qty')).toContainText('8,20 kg');

  // 4) Volumen: Höhe/Tiefe ist Pflicht
  await chooseType('volumen');
  await rect(x, y + px(5), px(2), px(1));
  await dlg().getByTestId('input-length').fill('2');
  await dlg().getByTestId('input-width').fill('1,5');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toContainText('Für das Volumen die Höhe bzw. Tiefe eingeben.');
  await dlg().getByTestId('input-depth').fill('0,2');
  await expect(dlg().getByTestId('volume-result')).toContainText('0,60 m³');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  d = await lastDmg();
  expect(d.measureType).toBe('volumen');
  expect(d.area).toBe(3);
  expect(d.depth).toBe(0.2);

  // 5) Fläche mit Anzahl: 3 × (2 × 1,5)
  await chooseType('flaeche');
  await rect(x + px(4), y + px(5), px(2), px(1));
  await dlg().getByTestId('input-length').fill('2');
  await dlg().getByTestId('input-width').fill('1,5');
  await dlg().getByTestId('input-count').fill('3');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  d = await lastDmg();
  expect(d.measureType).toBe('flaeche');
  expect(d.count).toBe(3);
  expect(d.area).toBe(9);

  // 6) Länge (Linie, Freie Form, Freihand): geschlossene Freie Form 2 × 1 m → Umfang
  await chooseType('laenge');
  await expect(page.getByTestId('tool-rect')).toHaveCount(0);
  await pickTool(page, 'tool-polyline');
  for (const [dx, dy] of [[8, 5], [10, 5], [10, 6], [8, 6], [8, 5]]) await page.mouse.click(x + px(dx), y + px(dy));
  await expect(dlg()).toContainText('Neue Messung: Länge');
  const l2 = num(await dlg().getByTestId('geometry-length').inputValue());
  expect(Math.abs(l2 - 6)).toBeLessThan(0.1);
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  d = await lastDmg();
  expect(d.measureType).toBe('laenge');
  expect(d.kind).toBe('line');

  // 7) Messart im Dialog umstellen: Schadstelle mit Schadensart
  await rect(x + px(11), y, px(1), px(1));
  await dlg().getByTestId('measure-type-select').selectOption('schadstelle');
  await expect(dlg()).toContainText('Neue Messung: Schadstelle');
  await dlg().getByTestId('input-length').fill('1');
  await dlg().getByTestId('input-width').fill('1');
  await dlg().getByTestId('input-damage-type').fill('Abplatzung');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  d = await lastDmg();
  expect(d.measureType).toBe('schadstelle');
  expect(d.kind).toBe('damage');
  expect(d.damageType).toBe('Abplatzung');
  await waitSaved(page);

  // Messart bleibt gemerkt (nach Neuladen)
  await page.reload();
  await expect(page.getByTestId('tool-mtype')).toHaveAttribute('data-value', 'flaeche'); // zuletzt für das Rechteck gewählt
});

test('Werkzeuge je Messart: Wand nur bei Wand, Punkte bei Stück – Punkte antippen zählt die Stück', async () => {
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  // Werkzeuge je Messart (immer dazu: Auswahl/Text/Messung/Kalibrieren)
  const ALL = ['line', 'rect', 'ellipse', 'polygon', 'polyline', 'freehand', 'wall', 'points'];
  const EXPECT: Record<string, string[]> = {
    flaeche: ['rect', 'ellipse', 'polygon', 'polyline', 'freehand'], // alles außer Linien
    wand: ['wall'], // nur Wand
    laenge: ['line', 'polyline', 'freehand'], // Linie, Freie Form, Freihand
    volumen: ['rect', 'ellipse', 'polygon', 'polyline'], // Fläche, Kreis, Rechteck, beliebige Form
    stueck: ['points'], // nur Punkte
    schadstelle: ['line', 'rect', 'ellipse', 'polyline', 'freehand'], // alles außer Wand und Fläche
    frei: ALL, // alle Werkzeuge
  };
  for (const [t, tools] of Object.entries(EXPECT)) {
    await chooseType(t);
    for (const id of ALL) await expect(page.getByTestId(`tool-${id}`), `${t}: ${id}`).toHaveCount(tools.includes(id) ? 1 : 0);
  }
  for (const t of ['flaeche', 'schadstelle', 'laenge']) {
    await chooseType(t);
    await expect(page.getByTestId('tool-wall')).toHaveCount(0);
    await expect(page.getByTestId('tool-points')).toHaveCount(0);
  }
  // Wand: Wand-Werkzeug da und gleich gewählt
  await chooseType('wand');
  await expect(page.getByTestId('tool-wall')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tool-points')).toHaveCount(0);
  // Stück: Punkte statt Wand, gleich gewählt
  await chooseType('stueck');
  await expect(page.getByTestId('tool-wall')).toHaveCount(0);
  await expect(page.getByTestId('tool-points')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('points-bar')).toBeVisible();
  for (const [dx, dy] of [
    [300, 520],
    [360, 540],
    [420, 520],
  ])
    await page.mouse.click(sb.x + dx, sb.y + dy);
  await expect(page.getByTestId('point-mark')).toHaveCount(3);
  await expect(page.getByTestId('points-count')).toHaveText('3 Stk');
  // letzten Punkt zurück, neu setzen
  await page.getByTestId('points-undo').click();
  await expect(page.getByTestId('points-count')).toHaveText('2 Stk');
  await page.mouse.click(sb.x + 480, sb.y + 540);
  await page.getByTestId('points-done').click();
  await expect(dlg()).toContainText('Neue Messung: Stück');
  await expect(dlg().getByTestId('input-count')).toHaveValue('3');
  await expect(dlg().getByTestId('count-result')).toHaveText('3 Stk');
  await dlg().getByTestId('damage-save').click();
  await expect(dlg()).toBeHidden();
  const d = await lastDmg();
  expect(d.measureType).toBe('stueck');
  expect(d.count).toBe(3);
  // im Plan nur die Punkte (keine Linie dazwischen)
  await expect(page.locator(`[data-damage="${d.id}"][data-points="3"]`)).toHaveCount(1);
  await expect(page.locator('[data-testid="aufmass-row"][data-type="stueck"]').last().getByTestId('row-qty')).toHaveText('3 Stk');
});

test('Je Messart eine eigene Tabelle mit passenden Spalten und eigener Summe, darunter die Gesamtsummen', async () => {
  // aus den Tests davor: Wand, Stück (4 + 3), Frei (kg), Volumen, Fläche, Länge, Schadstelle
  const tables = page.getByTestId('aufmass-type');
  const types = await tables.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.type));
  // feste Reihenfolge der Messarten, nur die vorkommenden
  expect(types).toEqual(['flaeche', 'wand', 'laenge', 'volumen', 'stueck', 'schadstelle', 'frei']);
  const table = (t: string) => page.locator(`[data-testid="aufmass-type"][data-type="${t}"]`);
  const heads = (t: string) => table(t).locator('thead th').evaluateAll((ths) => ths.map((th) => (th.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  // jede Zeile steht in der Tabelle ihrer Messart
  for (const t of types) {
    const rows = table(t!).locator('[data-testid="aufmass-row"]');
    expect(await rows.count()).toBeGreaterThan(0);
    expect(await rows.evaluateAll((rs, type) => rs.every((r) => (r as HTMLElement).dataset.type === type), t)).toBe(true);
  }
  // Spalten je Messart
  expect(await heads('flaeche')).toEqual(['Nr.', 'Länge (m)', 'Breite (m)', 'Fläche (m²)', 'Art', 'Aktionen']);
  expect(await heads('wand')).toEqual(['Nr.', 'Länge (m)', 'Höhe (m)', 'Fläche (m²)', 'Art', 'Aktionen']);
  expect(await heads('laenge')).toEqual(['Nr.', 'Länge (m)', 'Gesamt (m)', 'Art', 'Aktionen']);
  expect(await heads('volumen')).toEqual(['Nr.', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Volumen (m³)', 'Art', 'Aktionen']);
  expect(await heads('stueck')).toEqual(['Nr.', 'Anzahl', 'Art', 'Aktionen']);
  expect(await heads('schadstelle')).toEqual(['Nr.', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)', 'Art', 'Aktionen']);
  expect(await heads('frei')).toEqual(['Nr.', 'Menge', 'Art', 'Aktionen']);
  // eigene Summe je Tabelle
  await expect(table('stueck').getByTestId('type-sum-value')).toHaveText('7 Stk');
  await expect(table('frei').getByTestId('type-sum-value')).toHaveText('8,20 kg');
  await expect(table('volumen').getByTestId('type-sum-value')).toHaveText('0,60 m³');
  await expect(table('flaeche').getByTestId('type-sum-value')).toHaveText('9,00 m²');
  await expect(table('schadstelle').getByTestId('type-sum-value')).toHaveText('1,00 m²');
  await expect(table('laenge').getByTestId('type-sum-value')).toContainText(' m');
  await expect(table('volumen').getByTestId('row-volume')).toHaveText('0,60');
  // Überschrift mit Anzahl
  await expect(table('stueck').locator('.aufmass-type-head')).toContainText('Stück');
  await expect(table('stueck').locator('.aufmass-type-head')).toContainText('2 Messungen');
  // Gesamtsummen unter allen Tabellen
  const total = page.getByTestId('aufmass-total');
  await expect(total.getByTestId('sum-count')).toHaveText('7 Stk');
  await expect(total.getByTestId('sum-free')).toHaveText('8,20 kg');
  await expect(total.getByTestId('sum-volume')).toHaveText('0,60 m³');
  await expect(total.getByTestId('sum-area')).toBeVisible();
  await expect(total.getByTestId('sum-length')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1500 }); // alle Tabellen auf einem Bild
  await page.getByTestId('editor-side').screenshot({ path: 'tests/output/messarten-tabellen.png' });
});
