import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** CAD Phase 5 (Maus): Drehen und Skalieren mit Bezugspunkt, Bezug über zwei Punkte, Winkelschritte, Ausrichten */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; shape: { type: string; x: number; y: number; w: number; h: number; rotation?: number; points?: number[][] } };
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

test('Drehen: Drehpunkt antippen, Winkel eintippen bzw. mit der Maus in 45°-Schritten', async () => {
  await freshStart(page);
  await createProject(page, 'CAD Phase 5', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('P5');
  await page.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  const sb = (await sheet().boundingBox())!;
  await line(sb.x + 200, sb.y + 300, '4;0');
  let [l] = await elements();
  const [a] = ends(l);

  // 90° gegen den Uhrzeigersinn um den Anfangspunkt (Fang auf dem Endpunkt) → Linie zeigt nach oben
  await selectLine(l);
  await pickTool(page, 'draw-rotate');
  await expect(page.getByTestId('command-prompt')).toContainText('Drehpunkt');
  await click(a);
  await expect(page.getByTestId('pick-point')).toHaveCount(1);
  await type('90');
  await waitSaved(page);
  [l] = await elements();
  let [p, q] = ends(l);
  const top = p.y < q.y ? p : q;
  const bottom = p.y < q.y ? q : p;
  near(bottom.x, a.x, 1e-6);
  near(bottom.y, a.y, 1e-6);
  near(top.x, a.x, 1e-6);
  near(top.y, a.y - 4, 1e-6);
  expect(await elements()).toHaveLength(1);
  // Auswahl bleibt – Rückgängig holt die waagrechte Linie zurück
  await page.getByTestId('undo').click();
  await waitSaved(page);
  near(len((await elements())[0]), 4, 1e-6);
  await page.getByTestId('redo').click();
  await waitSaved(page);

  // mit der Maus: 45°-Schritte – Zeiger bei ca. 50° → 45°
  [l] = await elements();
  await selectLine(l);
  await pickTool(page, 'draw-rotate');
  await page.getByTestId('rotate-step').selectOption('45');
  await click(a);
  const r = 3;
  const tgt = await screenOf({ x: a.x + r * Math.cos((50 * Math.PI) / 180), y: a.y - r * Math.sin((50 * Math.PI) / 180) });
  await page.mouse.move(tgt.x, tgt.y, { steps: 4 });
  await expect(page.getByTestId('cad-ghost').locator('path')).toHaveCount(1);
  await expect(page.getByTestId('transform-label')).toHaveText('45°');
  await page.mouse.click(tgt.x, tgt.y);
  await waitSaved(page);
  [l] = await elements();
  [p, q] = ends(l);
  // war senkrecht nach oben (90°) → jetzt 135°
  const far = Math.hypot(p.x - a.x, p.y - a.y) > 1 ? p : q;
  near((Math.atan2(-(far.y - a.y), far.x - a.x) * 180) / Math.PI, 135, 0.01);
  near(len(l), 4, 1e-3); // Koordinaten auf 0,1 mm gerundet
  await pickTool(page, 'draw-rotate');
  await page.getByTestId('rotate-step').selectOption('0'); // Standard wieder frei (Gerät merkt es sich)
  await page.getByTestId('command-done').click();
});

test('Drehen mit Bezug: vorhandene Richtung auf eine neue Richtung', async () => {
  let [l] = await elements();
  const [p0, q0] = ends(l);
  const base = p0;
  const other = q0;
  await selectLine(l);
  await pickTool(page, 'draw-rotate');
  await click(base);
  await page.getByTestId('transform-ref').click();
  await expect(page.getByTestId('command-prompt')).toContainText('1. Punkt der Bezugsrichtung');
  // Bezug = die Linie selbst (zwei Endpunkte), neue Richtung 0° eintippen → waagrecht nach rechts
  await click(base);
  await click(other);
  await expect(page.getByTestId('command-prompt')).toContainText('Neue Richtung');
  await type('0');
  await waitSaved(page);
  [l] = await elements();
  const [p, q] = ends(l);
  near(p.y, q.y, 1e-3);
  near(Math.max(p.x, q.x), base.x + 4, 1e-3);
  near(Math.min(p.x, q.x), base.x, 1e-3);
});

test('Skalieren: Faktor, X;Y getrennt (Rechteck), Bezugslänge', async () => {
  let [l] = await elements();
  const [p0, q0] = ends(l);
  const a = p0.x < q0.x ? p0 : q0;
  await selectLine(l);
  await pickTool(page, 'draw-scale');
  await expect(page.getByTestId('command-prompt')).toContainText('Basispunkt');
  await click(a);
  await type('0,5');
  await waitSaved(page);
  [l] = await elements();
  near(len(l), 2, 1e-3);
  near(Math.min(...ends(l).map((e) => e.x)), a.x, 1e-3); // Basispunkt bleibt

  // Bezug: Strecke = Linie (2 m) → neue Länge 5 eintippen
  await selectLine(l);
  await pickTool(page, 'draw-scale');
  await click(a);
  await page.getByTestId('transform-ref').click();
  await click(a);
  await click({ x: a.x + 2, y: a.y });
  await expect(page.getByTestId('command-prompt')).toContainText('Neue Länge');
  await type('5');
  await waitSaved(page);
  [l] = await elements();
  near(len(l), 5, 1e-3);

  // Rechteck 2 × 1, X;Y = 2;3 vom linken oberen Eck → 4 × 3
  await escape();
  await pickTool(page, 'draw-rect');
  const r0 = { x: a.x, y: a.y + 2 };
  const s0 = await screenOf(r0);
  const s1 = await screenOf({ x: r0.x + 2, y: r0.y + 1 });
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  await page.mouse.move(s1.x, s1.y, { steps: 5 });
  await page.mouse.up();
  await waitSaved(page);
  let rect = (await elements()).find((e) => e.type === 'rect')!;
  await escape();
  await pickTool(page, 'draw-select');
  await click({ x: rect.shape.x + rect.shape.w / 2, y: rect.shape.y });
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await pickTool(page, 'draw-scale');
  await click({ x: rect.shape.x, y: rect.shape.y });
  await type('2;3');
  await waitSaved(page);
  const before = rect.shape;
  rect = (await elements()).find((e) => e.id === rect.id)!;
  expect(rect.type).toBe('rect');
  near(rect.shape.w, before.w * 2, 1e-3);
  near(rect.shape.h, before.h * 3, 1e-3);
  near(rect.shape.x, before.x, 1e-3);
  near(rect.shape.y, before.y, 1e-3);
  await page.screenshot({ path: 'tests/output/cad-phase5-skalieren.png' });
});

test('Ausrichten: Linie auf eine schräge Ziellinie legen (drehen + verschieben bzw. nur drehen)', async () => {
  await escape();
  const sb = (await sheet().boundingBox())!;
  // Ziellinie 3 m unter 30°
  await line(sb.x + 700, sb.y + 500, '3<30');
  const target = (await elements()).at(-1)!;
  const [t0, t1] = ends(target);
  const ts = t0.x < t1.x ? t0 : t1;
  const te = t0.x < t1.x ? t1 : t0;
  // Quelle: waagrechte Linie 2 m weiter oben
  const src0 = await screenOf({ x: ts.x, y: ts.y - 4 });
  await line(src0.x, src0.y, '2;0');
  let src = (await elements()).at(-1)!;
  const [s0, s1] = ends(src);
  await selectLine(src);
  await pickTool(page, 'draw-align');
  await expect(page.getByTestId('command-prompt')).toContainText('1. Punkt am Objekt');
  await expect(page.getByTestId('align-move')).toBeChecked();
  await click(s0);
  await click(s1);
  await click(ts);
  await expect(page.getByTestId('command-prompt')).toContainText('2. Zielpunkt');
  await click(te);
  await waitSaved(page);
  src = (await elements()).find((e) => e.id === src.id)!;
  const [n0, n1] = ends(src);
  const ang = (Math.atan2(-(n1.y - n0.y), n1.x - n0.x) * 180) / Math.PI;
  near(((ang % 180) + 180) % 180, 30, 0.01);
  near(len(src), 2, 1e-3);
  // Anfang liegt auf dem Anfang der Ziellinie
  const start = Math.hypot(n0.x - ts.x, n0.y - ts.y) < Math.hypot(n1.x - ts.x, n1.y - ts.y) ? n0 : n1;
  near(start.x, ts.x, 1e-3);
  near(start.y, ts.y, 1e-3);
  expect(await elements()).toHaveLength(4); // Linie, Rechteck, Ziel, Quelle

  // nur drehen: Rückgängig, Haken weg, gleiche Punkte → Anfang bleibt am alten Ort
  await page.getByTestId('undo').click();
  await waitSaved(page);
  src = (await elements()).find((e) => e.id === src.id)!;
  await selectLine(src);
  await pickTool(page, 'draw-align');
  await page.getByTestId('align-move').uncheck();
  for (const pt of [s0, s1, ts, te]) await click(pt);
  await waitSaved(page);
  src = (await elements()).find((e) => e.id === src.id)!;
  const [m0, m1] = ends(src);
  const keep = Math.hypot(m0.x - s0.x, m0.y - s0.y) < Math.hypot(m1.x - s0.x, m1.y - s0.y) ? m0 : m1;
  near(keep.x, s0.x, 1e-3);
  near(keep.y, s0.y, 1e-3);
  const ang2 = (Math.atan2(-(m1.y - m0.y), m1.x - m0.x) * 180) / Math.PI;
  near(((ang2 % 180) + 180) % 180, 30, 0.01);
  await pickTool(page, 'draw-align');
  await page.getByTestId('align-move').check(); // Standard wieder an
  await page.getByTestId('command-done').click();
});
