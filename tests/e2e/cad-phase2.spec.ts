import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** CAD Phase 2 (Maus): Verbinden, Versetzen, Spiegeln */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; shape: { type: string; x: number; y: number; w: number; h: number; closed?: boolean; points?: number[][] } };
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
const verts = (e: El) => (e.shape.points ?? []).map(([u, v]) => ({ x: e.shape.x + u * e.shape.w, y: e.shape.y + v * e.shape.h }));
const area = (pts: { x: number; y: number }[]) => Math.abs(pts.reduce((a, p, i) => a + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2);
async function escape() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}
/** Linie: Startpunkt klicken, Verschiebung eintippen */
async function line(x: number, y: number, input: string) {
  await escape();
  await pickTool(page, 'draw-line');
  await page.mouse.click(x, y);
  await page.getByTestId('command-input').fill(input);
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
}
/** Bildschirmpunkt zu einem Plan-Punkt (Meter) */
async function screenOf(p: { x: number; y: number }) {
  const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const sb = (await sheet().boundingBox())!;
  return { x: sb.x + p.x * 100 * scale, y: sb.y + p.y * 100 * scale };
}

test('Verbinden: vier Linien werden eine geschlossene Fläche', async () => {
  await freshStart(page);
  await createProject(page, 'CAD Phase 2', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('P2');
  await page.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  const sb = (await sheet().boundingBox())!;
  // Rechteck 4 × 3 m aus vier Linien – jeder Anfang rastet auf dem Ende der vorigen ein
  await line(sb.x + 100, sb.y + 100, '4;0');
  let [l1] = await elements();
  const a = verts(l1)[0];
  const corners = [
    { x: a.x + 4, y: a.y },
    { x: a.x + 4, y: a.y + 3 },
    { x: a.x, y: a.y + 3 },
  ];
  const s1 = await screenOf(corners[0]);
  await line(s1.x, s1.y, '0;-3');
  const s2 = await screenOf(corners[1]);
  await line(s2.x, s2.y, '-4;0');
  const s3 = await screenOf(corners[2]);
  await line(s3.x, s3.y, '0;3');
  expect(await elements()).toHaveLength(4);
  await escape();
  await page.keyboard.press('Control+a');
  await expect(page.getByTestId('multi-bar')).toContainText('4 Objekte');
  await page.getByTestId('multi-join').click();
  await waitSaved(page);
  const els = await elements();
  expect(els).toHaveLength(1);
  expect(els[0].type).toBe('freehand');
  expect(els[0].shape.closed).toBe(true);
  near(area(verts(els[0])), 12, 0.001);
  // Rückgängig: ein Schritt holt die vier Linien zurück
  await page.getByTestId('undo').click();
  await waitSaved(page);
  expect(await elements()).toHaveLength(4);
  await page.getByTestId('redo').click();
  await waitSaved(page);
  [l1] = await elements();
  expect(l1.shape.closed).toBe(true);
});

test('Versetzen: Fläche um 0,5 m nach außen, Linie durch Punkt', async () => {
  await escape();
  const [room] = await elements();
  const pts = verts(room);
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  await pickTool(page, 'draw-offset');
  await expect(page.getByTestId('command-prompt')).toContainText('Objekt antippen');
  await page.getByTestId('command-input').fill('0,5');
  await page.getByTestId('command-input').press('Enter');
  await expect(page.getByTestId('command-prompt')).toContainText('0,50 m');
  // Oberkante antippen, dann außerhalb die Seite
  const edge = await screenOf({ x: minX + 2, y: minY });
  await page.mouse.click(edge.x, edge.y);
  await expect(page.getByTestId('command-prompt')).toContainText('Seite antippen');
  const out = await screenOf({ x: minX + 2, y: minY + 4 }); // außerhalb (unter der Fläche)
  await page.mouse.move(out.x, out.y, { steps: 3 });
  await expect(page.getByTestId('cad-ghost')).toBeVisible();
  await page.mouse.click(out.x, out.y);
  await waitSaved(page);
  let els = await elements();
  expect(els).toHaveLength(2);
  near(area(verts(els[1])), 5 * 4, 0.001);
  expect(els[1].shape.closed).toBe(true);
  // weiter versetzen: innen 0,5 m
  await page.mouse.click(edge.x, edge.y);
  const inside = await screenOf({ x: minX + 2, y: minY + 1.5 });
  await page.mouse.click(inside.x, inside.y);
  await waitSaved(page);
  els = await elements();
  expect(els).toHaveLength(3);
  near(area(verts(els[2])), 3 * 2, 0.001);
  await page.getByTestId('command-done').click();

  // Linie, dann „Durch Punkt“ 1,2 m darunter
  const p0 = await screenOf({ x: minX, y: minY + 6 });
  await line(p0.x, p0.y, '3;0');
  const ln = (await elements()).at(-1)!;
  await escape();
  await pickTool(page, 'draw-offset');
  await page.getByTestId('offset-through').click();
  const onLine = await screenOf({ x: minX + 1.5, y: minY + 6 });
  await page.mouse.click(onLine.x, onLine.y);
  const below = await screenOf({ x: minX + 1, y: minY + 7.2 });
  await page.mouse.click(below.x, below.y);
  await waitSaved(page);
  const par = (await elements()).at(-1)!;
  expect(par.type).toBe('line');
  near(par.shape.y - ln.shape.y, 1.2, 0.03); // ein Bildschirmpunkt Rundung
  near(par.shape.w, 3);
  await page.getByTestId('offset-through').click(); // wieder aus
  await page.getByTestId('command-done').click();
});

test('Spiegeln: an senkrechter Achse, Original behalten bzw. ersetzen', async () => {
  await escape();
  const ln = (await elements()).at(-1)!; // die versetzte Linie
  const n0 = (await elements()).length;
  const mid = await screenOf({ x: ln.shape.x + 1.5, y: ln.shape.y });
  await pickTool(page, 'draw-select');
  await page.mouse.click(mid.x, mid.y);
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await pickTool(page, 'draw-mirror');
  await expect(page.getByTestId('command-prompt')).toContainText('1. Punkt der Spiegelachse');
  await expect(page.getByTestId('mirror-keep')).toBeChecked();
  // Achse: senkrecht 1 m rechts vom Linienende, per Eingabe exakt 90°
  const ax = await screenOf({ x: ln.shape.x + ln.shape.w + 1, y: ln.shape.y + 1 });
  await page.mouse.click(ax.x, ax.y);
  await page.getByTestId('command-input').fill('1<90');
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  const els = await elements();
  expect(els).toHaveLength(n0 + 1);
  const m = els.at(-1)!;
  const axisX = ln.shape.x + ln.shape.w + 1;
  near(m.shape.x, axisX + 1, 0.03); // 1 m rechts der Achse beginnt die Spiegelung (Klick auf ±1 px)
  near(m.shape.w, ln.shape.w);
  near(m.shape.y, ln.shape.y);
  // Original ersetzen: die gespiegelte Linie zurück spiegeln → sie liegt wieder auf dem Original (doppelt)
  await pickTool(page, 'draw-mirror');
  await page.getByTestId('mirror-keep').uncheck();
  await page.mouse.click(ax.x, ax.y);
  await page.getByTestId('command-input').fill('1<90');
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  const after = await elements();
  expect(after).toHaveLength(n0 + 1);
  near(after.find((e) => e.id === m.id)!.shape.x, ln.shape.x, 0.06);
  await page.getByTestId('mirror-keep'); // Leiste weg
  await pickTool(page, 'draw-mirror');
  await page.getByTestId('mirror-keep').check(); // Standard wieder an (Gerät merkt es sich)
  await page.getByTestId('command-done').click();
});

test('Verbinden mit Lücke: Hinweis, dann mit größerer Toleranz', async () => {
  await escape();
  const sb = (await sheet().boundingBox())!;
  await line(sb.x + 600, sb.y + 120, '2;0');
  const l = (await elements()).at(-1)!;
  const end = verts(l)[1];
  // zweite Linie 8 cm daneben (ohne Fang: Raster und Fang aus)
  const start = await screenOf({ x: end.x + 0.08, y: end.y });
  await page.getByTestId('snap-toggle').click();
  await line(start.x, start.y, '0;-2');
  await page.getByTestId('snap-toggle').click();
  await escape();
  // beide wählen (Fenster), Verbinden: Lücke zu groß
  await pickTool(page, 'draw-join');
  await expect(page.getByTestId('command-prompt')).toContainText('Lücken bis 0,02 m');
  const tl = await screenOf({ x: end.x - 2.3, y: end.y - 0.3 });
  const br = await screenOf({ x: end.x + 0.4, y: end.y + 2.3 });
  await page.mouse.move(tl.x, tl.y);
  await page.mouse.down();
  await page.mouse.move(br.x, br.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('command-prompt')).toContainText('Ausgewählt: 2');
  await page.getByTestId('command-input').fill('0,05');
  await page.getByTestId('command-input').press('Enter');
  await page.getByTestId('command-next').click();
  await expect(page.locator('.toast', { hasText: 'Nichts verbunden' })).toBeVisible();
  // Leiste bleibt offen: größere Lücke eingeben und erneut verbinden
  await expect(page.getByTestId('command-prompt')).toContainText('Ausgewählt: 2');
  const before = (await elements()).length;
  await page.getByTestId('command-input').fill('0,1');
  await page.getByTestId('command-input').press('Enter');
  await expect(page.getByTestId('command-prompt')).toContainText('Lücken bis 0,10 m');
  await page.getByTestId('command-next').click();
  await waitSaved(page);
  expect(await elements()).toHaveLength(before - 1);
  const j = (await elements()).find((e) => e.id === l.id)!;
  expect(j.type).toBe('freehand');
  expect(verts(j)).toHaveLength(3);
});
