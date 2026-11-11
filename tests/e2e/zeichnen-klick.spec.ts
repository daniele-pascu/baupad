import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** Plan zeichnen am PC: Linie Klick–Klick, Klick daneben → Auswahl, Fenster ohne Diagonale */

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



test('Linie am PC: Klick – Klick (Ziehen zeichnet keine Linie); danach Klick daneben → Auswahl, Ziehen verschiebt den Plan', async () => {
  await freshStart(page);
  await createProject(page, 'Klick Klick', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('K');
  await page.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  await escape();
  await pickTool(page, 'draw-line');
  // Ziehen: setzt nur Punkt A (keine Linie)
  const a = await screenOf({ x: 4, y: 10 });
  const b = await screenOf({ x: 9, y: 10 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  expect(await elements()).toHaveLength(0);
  // zweiter Klick: Linie von A nach B
  await page.mouse.click(b.x, b.y);
  await waitSaved(page);
  const [l] = await elements();
  const [p, q] = ends(l);
  near(Math.hypot(q.x - p.x, q.y - p.y), 5, 0.05);
  // Klick ins Leere: Werkzeug fertig → Auswahl
  const empty = await screenOf({ x: 15, y: 16 });
  await page.mouse.click(empty.x, empty.y);
  await expect(page.getByTestId('draw-select')).toHaveAttribute('aria-pressed', 'true');
  expect(await elements()).toHaveLength(1);
  // Ziehen im Leeren verschiebt jetzt den Plan (keine neue Linie)
  const sb0 = (await sheet().boundingBox())!;
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 60, empty.y + 40, { steps: 6 });
  await page.mouse.up();
  const sb1 = (await sheet().boundingBox())!;
  near(sb1.x - sb0.x, 60, 2);
  expect(await elements()).toHaveLength(1);
});

test('Fenster-Auswahl: nur Rechteck, keine Diagonale', async () => {
  await escape();
  await pickTool(page, 'draw-selwin');
  const a = await screenOf({ x: 2, y: 8 });
  const b = await screenOf({ x: 12, y: 12 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await expect(page.getByTestId('sel-window')).toBeVisible();
  // keine gestrichelte Vorschau-Linie (früher: schwarze Diagonale)
  await expect(page.getByTestId('draw-preview')).toHaveCount(0);
  await page.mouse.up();
});
