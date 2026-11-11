import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** CAD Phase 6 (Maus): Hilfslinien, Abrunden, Abstand, Fangarten (Lotpunkt, parallel) */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; offset?: number; shape: { type: string; x: number; y: number; w: number; h: number; rotation?: number; points?: number[][] } };
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


async function guides(): Promise<{ x: number; y: number; angle: number }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('plans').objectStore('plans').getAll();
          all.onsuccess = () => {
            req.result.close();
            const p = (all.result as { deletedAt: number | null; drawing?: { guides?: unknown[] } }[]).find((x) => !x.deletedAt && x.drawing);
            resolve((p?.drawing?.guides ?? []) as { x: number; y: number; angle: number }[]);
          };
        };
      }),
  );
}
const tool = async (id: string) => {
  await escape();
  await pickTool(page, id);
};

test('Hilfslinien: 0° und 90°, Fang am Schnittpunkt, ausblenden, löschen, Rückgängig', async () => {
  await freshStart(page);
  await createProject(page, 'CAD Phase 6', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('P6');
  await page.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  await tool('draw-guide');
  await expect(page.getByTestId('command-prompt')).toContainText('Hilfslinie unter 0°');
  await click({ x: 3, y: 4 });
  await waitSaved(page);
  await page.getByTestId('guide-angle').selectOption('90');
  await click({ x: 6, y: 7 });
  await waitSaved(page);
  let g = await guides();
  expect(g).toHaveLength(2);
  expect(g.map((x) => x.angle).sort()).toEqual([0, 90]);
  await expect(page.getByTestId('guide-line')).toHaveCount(2);
  const gx = g.find((x) => x.angle === 90)!.x;
  const gy = g.find((x) => x.angle === 0)!.y;
  await page.getByTestId('command-done').click();

  // Linie beginnt am Schnittpunkt der Hilfslinien (Fang), Länge per Eingabe
  await tool('draw-line');
  const sp = await screenOf({ x: gx + 0.03, y: gy + 0.03 });
  await page.mouse.move(sp.x, sp.y, { steps: 3 });
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'intersection');
  await page.mouse.click(sp.x, sp.y);
  await type('2;0');
  await waitSaved(page);
  const [ln] = await elements();
  const [a] = ends(ln);
  near(a.x, gx, 1e-6);
  near(a.y, gy, 1e-6);

  // ausblenden: nicht sichtbar, kein Fang
  await escape();
  await page.getByTestId('ribbon-tab-precision').click();
  await page.getByTestId('view-guides').click();
  await expect(page.getByTestId('guide-line')).toHaveCount(0);
  await page.getByTestId('view-guides').click();
  await expect(page.getByTestId('guide-line')).toHaveCount(2);

  // eine löschen (antippen), Rückgängig, alle löschen
  await tool('draw-guide');
  await page.getByTestId('guide-erase').click();
  await click({ x: gx, y: gy + 3 });
  await waitSaved(page);
  expect(await guides()).toHaveLength(1);
  await page.getByTestId('undo').click();
  await waitSaved(page);
  expect(await guides()).toHaveLength(2);
  // frei: zwei Punkte unter 45°
  await page.getByTestId('guide-angle').selectOption('free');
  await click({ x: 2, y: 8 });
  await click({ x: 4, y: 6 });
  await waitSaved(page);
  g = await guides();
  expect(g).toHaveLength(3);
  near(g[2].angle, 45, 0.6); // Klick auf ±1 px
  await page.getByTestId('guide-clear').click();
  await waitSaved(page);
  expect(await guides()).toHaveLength(0);
  await page.getByTestId('command-done').click();
});

test('Abrunden: zwei Linien mit Radius, Radius 0 = Ecke, Ecke eines Rechtecks', async () => {
  // waagrecht (8|10)→(12|10), senkrecht (13|9)→(13|5): Schnitt bei (13|10)
  const s1 = await screenOf({ x: 8, y: 10 });
  await line(s1.x, s1.y, '4;0');
  const s2 = await screenOf({ x: 13, y: 9 });
  await line(s2.x, s2.y, '0;4');
  let els = await elements();
  const h = els.at(-2)!;
  const v = els.at(-1)!;
  const [h0] = ends(h);
  const [v0] = ends(v);
  const X = { x: v0.x, y: h0.y };
  await tool('draw-fillet');
  await expect(page.getByTestId('command-prompt')).toContainText('Erste Linie');
  await type('0,5');
  await expect(page.getByTestId('command-prompt')).toContainText('0,50 m');
  await click({ x: h0.x + 1, y: h0.y });
  await expect(page.getByTestId('command-prompt')).toContainText('Zweite Linie');
  await click({ x: v0.x, y: v0.y - 3 });
  await waitSaved(page);
  els = await elements();
  const arc = els.find((e) => e.type === 'arc')!;
  expect(arc).toBeTruthy();
  const h1 = ends(els.find((e) => e.id === h.id)!);
  const v1 = ends(els.find((e) => e.id === v.id)!);
  near(Math.max(h1[0].x, h1[1].x), X.x - 0.5, 1e-3);
  near(Math.max(v1[0].y, v1[1].y), X.y - 0.5, 1e-3);
  // Rückgängig in einem Schritt
  await page.getByTestId('undo').click();
  await waitSaved(page);
  expect((await elements()).some((e) => e.type === 'arc')).toBe(false);

  // Radius 0: scharfe Ecke – beide Linien enden im Schnittpunkt
  await type('0');
  await click({ x: h0.x + 1, y: h0.y });
  await click({ x: v0.x, y: v0.y - 3 });
  await waitSaved(page);
  els = await elements();
  const h2 = ends(els.find((e) => e.id === h.id)!);
  const v2 = ends(els.find((e) => e.id === v.id)!);
  near(Math.max(h2[0].x, h2[1].x), X.x, 1e-6);
  near(Math.max(v2[0].y, v2[1].y), X.y, 1e-6);

  // Ecke eines Rechtecks 3 × 2 mit Radius 0,5 → Fläche wird zur Polylinie
  await page.getByTestId('command-done').click();
  await tool('draw-rect');
  await page.getByTestId('insert-length').fill('3');
  await page.getByTestId('insert-width').fill('2');
  await page.getByTestId('insert-submit').click();
  await waitSaved(page);
  const rect = (await elements()).find((e) => e.type === 'rect')!;
  await tool('draw-fillet');
  await type('0,5');
  await click({ x: rect.shape.x + 0.02, y: rect.shape.y + 0.02 });
  await waitSaved(page);
  const r2 = (await elements()).find((e) => e.id === rect.id)!;
  expect(r2.type).toBe('freehand');
  expect((r2.shape.points ?? []).length).toBeGreaterThan(10);
  await page.getByTestId('command-done').click();
});

test('Abstand: parallele Linien, rechtwinklig, als Maß einfügen', async () => {
  const s1 = await screenOf({ x: 2, y: 14 });
  await line(s1.x, s1.y, '5;0');
  const s2 = await screenOf({ x: 3, y: 16 });
  await line(s2.x, s2.y, '3;0');
  const n0 = (await elements()).length;
  await tool('draw-distance');
  await expect(page.getByTestId('command-prompt')).toContainText('Ändert nichts');
  await click({ x: 4, y: 14 });
  await click({ x: 4.5, y: 16 });
  await expect(page.getByTestId('distance-result')).toContainText('2,00 m');
  await expect(page.getByTestId('distance-result')).toContainText('parallel');
  await expect(page.getByTestId('dist-line')).toHaveCount(1); // senkrecht: Breite 0 – daher nicht toBeVisible
  expect(await elements()).toHaveLength(n0);
  await page.getByTestId('distance-dimension').click();
  await waitSaved(page);
  const dim = (await elements()).at(-1)!;
  expect(dim.type).toBe('dimension');
  near(len(dim), 2, 1e-3);
  // rechtwinklig: waagrechte Linie und eine senkrechte daneben
  const s3 = await screenOf({ x: 9, y: 13 });
  await line(s3.x, s3.y, '0;-3');
  await tool('draw-distance');
  await click({ x: 4, y: 14 });
  await click({ x: 9, y: 15 });
  await expect(page.getByTestId('distance-result')).toContainText('rechtwinklig');
  await expect(page.getByTestId('distance-result')).toContainText('2,00 m'); // Linienende (7|14) bis (9|14)
  await page.getByTestId('command-done').click();
});

test('Fangarten: Lotpunkt, Parallel; ausschalten und Vorrang (je Gerät gemerkt)', async () => {
  // Lotpunkt: Linie unterhalb der Linie (2|14)–(7|14) beginnen, zur Linie zeigen
  await tool('draw-line');
  const st = await screenOf({ x: 5.2, y: 18 });
  await page.mouse.click(st.x, st.y);
  const lot = await screenOf({ x: 5.4, y: 14.02 });
  await page.mouse.move(lot.x, lot.y, { steps: 4 });
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'perpendicular');
  await page.mouse.click(lot.x, lot.y);
  await waitSaved(page);
  const l = (await elements()).at(-1)!;
  const [p, q] = ends(l);
  near(p.x, q.x, 1e-6); // genau senkrecht auf die Linie
  near(Math.min(p.y, q.y), 14, 1e-6);

  // Parallel: Linie (2|14)–(7|14) anfahren, neue Linie schräg unten beginnen, fast waagrecht ziehen
  await tool('draw-line');
  const onEdge = await screenOf({ x: 3.37, y: 14 });
  await page.mouse.move(onEdge.x, onEdge.y, { steps: 3 }); // Kante anfahren (merkt sie sich für Parallel)
  await expect(page.getByTestId('snap-marker')).toBeVisible();
  const st2 = await screenOf({ x: 11, y: 19.3 });
  await page.mouse.move(st2.x, st2.y, { steps: 3 });
  await page.mouse.click(st2.x, st2.y);
  const e2 = await screenOf({ x: 14, y: 19.33 });
  await page.mouse.move(e2.x, e2.y, { steps: 4 });
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'parallel');
  await expect(page.getByTestId('parallel-hint')).toBeVisible();
  await page.mouse.click(e2.x, e2.y);
  await waitSaved(page);
  const pl = (await elements()).at(-1)!;
  const [pa, pb] = ends(pl);
  near(pa.y, pb.y, 1e-6);

  // Dialog: Lotpunkt aus, Mittelpunkt nach oben; bleibt gemerkt
  await escape();
  await page.getByTestId('ribbon-tab-precision').click();
  await page.getByTestId('view-snap-kinds').click();
  const d = page.getByTestId('snap-kinds-dialog');
  await expect(d).toBeVisible();
  await d.getByTestId('snap-kind-perpendicular').uncheck();
  await d.getByTestId('snap-kind-up-mid').click();
  await d.getByTestId('snap-kinds-save').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('snapKinds') ?? 'null'));
  expect(stored.enabled).not.toContain('perpendicular');
  expect(stored.order.indexOf('mid')).toBeLessThan(stored.order.indexOf('intersection'));
  // Lotpunkt jetzt aus
  await tool('draw-line');
  await page.mouse.click(st.x + 40, st.y);
  const lot2 = await screenOf({ x: 5.9, y: 14.02 });
  await page.mouse.move(lot2.x + 40, lot2.y, { steps: 4 });
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="snap-marker"][data-kind="perpendicular"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await escape();
  await page.getByTestId('ribbon-tab-precision').click();
  await page.getByTestId('view-snap-kinds').click();
  await expect(d.getByTestId('snap-kind-perpendicular')).not.toBeChecked();
  await d.getByTestId('snap-kinds-reset').click();
  await d.getByTestId('snap-kinds-save').click();
  await page.screenshot({ path: 'tests/output/cad-phase6.png' });
});
