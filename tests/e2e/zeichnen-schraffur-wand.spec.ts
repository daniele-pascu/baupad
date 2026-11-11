import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** Plan zeichnen: Wand schließen, Werkzeug Schraffur (Fläche antippen), Schraffur am Plan fixiert */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; style?: { fillType?: string; hatch?: { pattern: string }; fillColor?: string }; offset?: number; shape: { type: string; x: number; y: number; w: number; h: number; rotation?: number; points?: number[][] } };
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
const sheet = () => page.getByTestId('drawing-sheet');
const near = (a: number, b: number, tol = 0.011) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(tol);
const ends = (e: El) => {
  const s = e.shape;
  const [[u0, v0], [u1, v1]] = s.points ?? [
    [0, 0],
    [1, 1],
  ];
  return [
    { x: s.x + u0 * s.w, y: s.y + v0 * s.h },
    { x: s.x + u1 * s.w, y: s.y + v1 * s.h },
  ];
};
const len = (e: El) => {
  const [a, b] = ends(e);
  return Math.hypot(b.x - a.x, b.y - a.y);
};
async function escape() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}
async function type(v: string) {
  await page.getByTestId('command-input').fill(v);
  await page.getByTestId('command-input').press('Enter');
}
async function line(x: number, y: number, input: string) {
  await escape();
  await pickTool(page, 'draw-line');
  await page.mouse.click(x, y);
  await type(input);
  await waitSaved(page);
}
async function screenOf(p: { x: number; y: number }) {
  const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const sb = (await sheet().boundingBox())!;
  return { x: sb.x + p.x * 100 * scale, y: sb.y + p.y * 100 * scale };
}
async function click(p: { x: number; y: number }) {
  const s = await screenOf(p);
  await page.mouse.click(s.x, s.y);
}
/** Linie auswählen (Klick auf ihre Mitte) */
async function selectLine(e: El) {
  await escape();
  const [a, b] = ends(e);
  await pickTool(page, 'draw-select');
  await click({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  await expect(page.getByTestId('element-bar')).toBeVisible();
}



test('Wand: Raum schließen (Startpunkt antippen) – Anfang und Ende ohne Überlappung', async () => {
  await freshStart(page);
  await createProject(page, 'Schraffur Wand', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('S1');
  await page.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  await escape();
  await pickTool(page, 'draw-wall');
  await click({ x: 4, y: 8 });
  for (const v of ['6;0', '0;-4', '-6;0']) {
    await page.getByTestId('command-input').fill(v);
    await page.getByTestId('command-input').press('Enter');
  }
  await expect(page.getByTestId('polygon-bar')).toContainText('4 Punkte');
  await expect(page.getByTestId('wall-close')).toBeEnabled();
  await click({ x: 4, y: 8 }); // Startpunkt antippen schließt
  await waitSaved(page);
  const w = (await elements()).find((e) => e.type === 'wall')!;
  expect(w.shape.closed).toBe(true);
  expect(w.shape.points).toHaveLength(4); // kein doppelter Endpunkt
});

test('Schraffur-Werkzeug: Muster wählen, Raum und Rechteck antippen; Schraffur bleibt beim Verschieben am Plan', async () => {
  await escape();
  // Rechteck daneben
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill('2');
  await page.getByTestId('insert-width').fill('2');
  await page.getByTestId('insert-submit').click();
  await waitSaved(page);
  const rect = (await elements()).find((e) => e.type === 'rect')!;
  await escape();
  await pickTool(page, 'draw-hatch');
  const hp = page.getByTestId('hatch-picker');
  await expect(hp).toBeVisible();
  await hp.getByTestId('hatch-tab-material').click();
  await hp.getByTestId('hatch-tile-mat:beton').click();
  await expect(hp.getByTestId('hatch-current')).toContainText('Beton');
  await hp.getByTestId('hatch-ok').click();
  await expect(page.getByTestId('hatch-prompt')).toContainText('Beton');
  // in den Raum (innerhalb der geschlossenen Wand) tippen → neue schraffierte Fläche bis zur Wandinnenseite
  const n0 = (await elements()).length;
  await click({ x: 7, y: 10 });
  await waitSaved(page);
  const els = await elements();
  expect(els).toHaveLength(n0 + 1);
  const room = els.at(-1)!;
  expect(room.type).toBe('freehand');
  expect(room.style?.hatch?.pattern).toBe('concrete');
  // Innenseite: 6 × 4 m Achse minus Wandstärke
  const wall = els.find((e) => e.type === 'wall')!;
  expect(room.shape.w).toBeLessThan(6);
  expect(room.shape.w).toBeGreaterThan(5);
  void wall;
  // Rechteck antippen → schraffiert
  await click({ x: rect.shape.x + 1, y: rect.shape.y + 1 });
  await waitSaved(page);
  expect((await elements()).find((e) => e.id === rect.id)!.style?.fillType).toBe('hatch');
  // daneben ins Leere: Hinweis
  await click({ x: 20, y: 20 });
  await expect(page.locator('.toast').last()).toContainText('keine geschlossene Fläche');
  await page.getByTestId('command-done').click();

  // fixiert: Plan verschieben – die Schraffurlinien bewegen sich genau mit der Fläche
  const hatch = page.locator(`[data-element-id="${rect.id}"] [data-fill="hatch"]`);
  const first = async () => {
    const d = (await hatch.getAttribute('d')) ?? '';
    const m = /M([\d.-]+)[ ,]([\d.-]+)/.exec(d)!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const box = async () => (await page.locator(`[data-element-id="${rect.id}"]`).boundingBox())!;
  const h0 = await first();
  const b0 = await box();
  const vb = (await page.getByTestId('plan-viewer').boundingBox())!;
  await page.mouse.move(vb.x + vb.width * 0.8, vb.y + vb.height * 0.85);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(vb.x + vb.width * 0.8 - 37, vb.y + vb.height * 0.85 - 23, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  const h1 = await first();
  const b1 = await box();
  expect(Math.abs(b1.x - b0.x)).toBeGreaterThan(10);
  expect(Math.abs(h1.x - h0.x - (b1.x - b0.x))).toBeLessThan(0.6);
  expect(Math.abs(h1.y - h0.y - (b1.y - b0.y))).toBeLessThan(0.6);
  await page.screenshot({ path: 'tests/output/schraffur-raum.png' });
});
