import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createProject, FIXTURES, freshStart, pickTool, planBox, stored, waitForPlan, waitSaved } from './helpers';

/**
 * Form bearbeiten (Seite bzw. Ecke ziehen): die ursprünglichen Eckpunkte sind Bezug für Spurlinien –
 * zurück in die alte Lage bzw. Kante genau senkrecht/waagrecht. Plan zeichnen und Aufmaß, am PC.
 */
test.skip(({ isMobile }) => isMobile, 'nur am PC (Maus)');

type S = { x: number; y: number; w: number; h: number; points?: number[][] };
const verts = (s: S) => (s.points ?? []).map(([u, v]) => ({ x: s.x + u * s.w, y: s.y + v * s.h }));
const center = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** ziehen; kurz vor dem Loslassen muss eine Spurlinie zu sehen sein */
async function dragWithTrack(page: Page, from: { x: number; y: number }, via: { x: number; y: number }, to: { x: number; y: number }, axis: 'h' | 'v') {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(via.x, via.y, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(page.locator(`[data-testid="track-line"][data-axis="${axis}"]`).first()).toBeAttached();
  await page.mouse.up();
  await expect(page.locator('[data-testid="track-line"]')).toHaveCount(0); // nach dem Loslassen weg
}

test('Plan zeichnen: Rechteck-Seite zurück auf die alte Lage, Dreieck-Ecke senkrecht über der anderen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Bearbeiten', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('B-1');
  await nd.getByTestId('new-drawing-save').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  const els = async () => (await stored(page, 'elements')).filter((e) => !e.deletedAt) as unknown as { type: string; shape: S }[];

  // Rechteck 4 × 2 m, rechte Seite ziehen: weit raus, dann knapp neben die alte Lage → rastet genau dort ein
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill('4');
  await page.getByTestId('insert-width').fill('2');
  await page.getByTestId('insert-submit').click();
  await waitSaved(page);
  await pickTool(page, 'draw-select');
  const e = await center(page, '[data-handle="e"]');
  const rb = (await page.locator('[data-element="rect"]').boundingBox())!;
  const edge = rb.x + rb.width; // rechte Kante (der Anfasser sitzt etwas außerhalb)
  await dragWithTrack(page, e, { x: e.x + 80, y: e.y }, { x: edge + 3, y: e.y + 1 }, 'v');
  await waitSaved(page);
  const r = (await els()).find((x) => x.type === 'rect')!;
  expect(Math.abs(r.shape.w - 4)).toBeLessThan(1e-9);
  await page.keyboard.press('Escape');

  // Dreieck (Fläche aus drei Punkten), obere Ecke knapp neben die Senkrechte über der rechten Ecke
  await pickTool(page, 'draw-polygon');
  const P = [
    { x: sb.x + 200, y: sb.y + 420 },
    { x: sb.x + 360, y: sb.y + 420 },
    { x: sb.x + 280, y: sb.y + 320 },
  ];
  for (const p of [...P, P[0]]) await page.mouse.click(p.x, p.y);
  await waitSaved(page);
  await pickTool(page, 'draw-select');
  await page.mouse.click(sb.x + 280, sb.y + 400); // Dreieck wählen
  const tri0 = (await els()).find((x) => x.type !== 'rect')!;
  const [, B0, C0] = verts(tri0.shape);
  const top = await center(page, '[data-testid="vertex-2"]');
  await dragWithTrack(page, top, { x: top.x + 40, y: top.y - 30 }, { x: sb.x + 362, y: top.y - 20 }, 'v');
  await waitSaved(page);
  const tri = (await els()).find((x) => x.type !== 'rect')!;
  const [, B, C] = verts(tri.shape);
  expect(Math.abs(C.x - B.x)).toBeLessThan(1e-6); // Kante B–C genau senkrecht
  expect(Math.abs(B.x - B0.x)).toBeLessThan(1e-6); // die anderen Ecken bleiben
  expect(C.y).toBeLessThan(C0.y); // nach oben gezogen
});

test('Aufmaß: Seite einer Rechteck-Messung zurück auf die alte Lage', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Bearbeiten Aufmaß', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('BA-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  await pickTool(page, 'tool-rect');
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await dlg.getByTestId('input-length').fill('3');
  await dlg.getByTestId('input-width').fill('2');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const w0 = ((await stored(page, 'damages'))[0].shape as S).w;
  await pickTool(page, 'tool-select');
  await page.mouse.click(box.x + 190, box.y + 160); // Messung wählen
  const e = await center(page, '[data-handle="e"]');
  const rb = (await page.locator(`[data-damage]`).first().boundingBox())!;
  await dragWithTrack(page, e, { x: e.x + 70, y: e.y }, { x: rb.x + rb.width - 3, y: e.y }, 'v');
  await waitSaved(page);
  const w = ((await stored(page, 'damages'))[0].shape as S).w;
  expect(Math.abs(w - w0)).toBeLessThan(1e-6);
});
