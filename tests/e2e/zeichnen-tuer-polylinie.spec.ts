import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** Plan zeichnen: Tür nur gleichmäßig skalieren; Polylinie mit eingetippter Länge je Knick, Abschnitte nachträglich ändern */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; symbol?: { id: string; flipY?: boolean }; offset?: number; shape: { type: string; x: number; y: number; w: number; h: number; rotation?: number; points?: number[][] } };
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



const verts = (e: El) => (e.shape.points ?? []).map(([u, v]) => ({ x: e.shape.x + u * e.shape.w, y: e.shape.y + v * e.shape.h }));
const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);

test('Tür: an jeder Seite ziehen skaliert gleichmäßig, die Öffnungslinie bleibt an Ort und Stelle', async () => {
  await freshStart(page);
  await createProject(page, 'Tür Polylinie', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('T1');
  await page.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  await escape();
  await pickTool(page, 'draw-door');
  await page.getByTestId('symbol-picker').getByTestId('symbol-door1').click();
  await click({ x: 6, y: 8 });
  await page.getByTestId('command-done').click();
  await waitSaved(page);
  const d0 = (await elements()).at(-1)!;
  expect(d0.symbol?.id).toBe('door1');
  // auswählen und am rechten Anfasser 0,3 m nach rechts ziehen
  await escape();
  await pickTool(page, 'draw-select');
  await click({ x: d0.shape.x + d0.shape.w * 0.2, y: d0.shape.y + d0.shape.h * 0.5 });
  await expect(page.getByTestId('element-bar')).toBeVisible();
  for (const [handle, dx, dy] of [
    ['e', 0.3, 0],
    ['n', 0, -0.3],
    ['s', 0, 0.2],
  ] as const) {
    const before = (await elements()).find((e) => e.id === d0.id)!;
    const h = page.locator(`[data-handle="${handle}"]`);
    const hb = (await h.boundingBox())!;
    const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + dx * 100 * scale, hb.y + hb.height / 2 + dy * 100 * scale, { steps: 6 });
    await page.mouse.up();
    await waitSaved(page);
    const d = (await elements()).find((e) => e.id === d0.id)!;
    near(d.shape.w, d.shape.h, 1e-3); // Tür bleibt quadratisch: Flügel = Breite
    expect(Math.abs(d.shape.w - before.shape.w)).toBeGreaterThan(0.05);
    near(d.shape.y + d.shape.h, d0.shape.y + d0.shape.h, 1e-3); // Öffnungslinie (Wandseite) bleibt
    near(d.shape.x, d0.shape.x, 1e-3); // Anschlag bleibt
  }
  // Größe über das Feld „Länge“: Breite folgt
  await page.getByTestId('element-bar').locator('input').first().fill('1,1');
  await page.getByTestId('element-bar').locator('input').first().press('Enter');
  await waitSaved(page);
  const d = (await elements()).find((e) => e.id === d0.id)!;
  near(d.shape.w, 1.1, 1e-3);
  near(d.shape.h, 1.1, 1e-3);
  near(d.shape.y + d.shape.h, d0.shape.y + d0.shape.h, 1e-3);
});

test('Polylinie: nach jedem Knick die Länge eintippen (Zeigerrichtung, ΔX;ΔY, Länge<Winkel); Abschnitt nachträglich ändern', async () => {
  await escape();
  await pickTool(page, 'draw-polyline');
  await click({ x: 3, y: 12 });
  await expect(page.getByTestId('polygon-bar')).toContainText('1 Punkt');
  // 4 m nach rechts (Zeiger zeigt nach rechts)
  const right = await screenOf({ x: 8, y: 12 });
  await page.mouse.move(right.x, right.y, { steps: 3 });
  await page.getByTestId('command-input').fill('4');
  await page.getByTestId('command-input').press('Enter');
  await expect(page.getByTestId('polygon-bar')).toContainText('2 Punkte');
  // 3 m nach oben über Länge<Winkel, dann ΔX;ΔY 2;0
  await page.getByTestId('command-input').fill('3<90');
  await page.getByTestId('command-input').press('Enter');
  await page.getByTestId('command-input').fill('2;0');
  await page.getByTestId('command-input').press('Enter');
  await expect(page.getByTestId('polygon-bar')).toContainText('4 Punkte');
  await page.getByTestId('polyline-open').click();
  await waitSaved(page);
  const pl = (await elements()).at(-1)!;
  const v = verts(pl);
  expect(v).toHaveLength(4);
  near(seg(v[0], v[1]), 4, 1e-3);
  near(seg(v[1], v[2]), 3, 1e-3);
  near(v[2].y, v[1].y - 3, 1e-3);
  near(seg(v[2], v[3]), 2, 1e-3);
  near(v[3].y, v[2].y, 1e-3);

  // Abschnitt 2 auf 5 m: Knick wandert nach oben, der letzte Abschnitt geht mit
  await escape();
  await pickTool(page, 'draw-select');
  await click({ x: v[0].x + 2, y: v[0].y });
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await page.getByTestId('segments-toggle').click();
  await expect(page.getByTestId('segment-1')).toHaveValue('3,00');
  await page.getByTestId('segment-1').fill('5');
  await page.getByTestId('segment-1').press('Enter');
  await waitSaved(page);
  const v2 = verts((await elements()).find((e) => e.id === pl.id)!);
  near(seg(v2[1], v2[2]), 5, 1e-3);
  near(seg(v2[2], v2[3]), 2, 1e-3);
  near(seg(v2[0], v2[1]), 4, 1e-3);
  await page.screenshot({ path: 'tests/output/polylinie-abschnitte.png' });
});
