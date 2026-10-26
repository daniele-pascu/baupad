import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, OUT, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

/**
 * Punktfang auf den Linien des PDF-Plans (Vektor-PDF): Rechteck von Ecke zu Ecke des
 * Grundrisses – trifft die Ecken exakt, die Fläche stimmt mit dem Plan überein. Ohne Fang (X)
 * landet der Punkt dort, wo geklickt wurde.
 */

// Grundriss in massketten.pdf (Seitenkoordinaten, Ursprung oben links): 15,15 × 7,70 m bei 1:50
const K = 72 / 0.0254 / 50;
const ROOM = { x1: 120, y1: 842 - 160 - 7.7 * K, x2: 120 + 15.15 * K, y2: 842 - 160 };

type D = { number: number; shape: { x: number; y: number; w: number; h: number }; area: number | null };
async function damages(page: Page): Promise<D[]> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('damages').objectStore('damages').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve(all.result.filter((d: { deletedAt: number | null }) => !d.deletedAt).sort((a: D, b: D) => a.number - b.number));
          };
        };
      }),
  );
}

test('Vektor-PDF: Ecken des Grundrisses werden exakt gefangen, Fläche aus dem Plan stimmt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Fang', {}, ['Keller']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  const box = await planBox(page);
  const s = box.width / 1191; // Pixel je Seiteneinheit
  const scr = (x: number, y: number) => ({ x: box.x + x * s, y: box.y + y * s });

  // knapp neben den Ecken ansetzen (ca. 4 px)
  const a = scr(ROOM.x1 + 4 / s, ROOM.y2 - 4 / s);
  const b = scr(ROOM.x2 - 4 / s, ROOM.y1 + 4 / s);
  await pickTool(page, 'tool-rect');
  await page.mouse.move(a.x, a.y);
  await expect(page.getByTestId('snap-marker')).toBeVisible(); // Fangpunkt wird angezeigt
  await drawRect(page, a.x, a.y, b.x, b.y);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg.getByTestId('use-geometry')).toContainText('116,66 m²'); // 15,15 × 7,70 = 116,655 m²
  await dlg.getByTestId('use-geometry').click();
  await expect(dlg.getByTestId('geometry-perimeter')).toHaveValue('45,70');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const [d1] = await damages(page);
  expect(d1.shape.x).toBeCloseTo(ROOM.x1, 1);
  expect(d1.shape.y).toBeCloseTo(ROOM.y1, 1);
  expect(d1.shape.x + d1.shape.w).toBeCloseTo(ROOM.x2, 1);
  expect(d1.shape.y + d1.shape.h).toBeCloseTo(ROOM.y2, 1);

  // Fang aus (X): Punkt bleibt, wo geklickt wurde
  // (an einer anderen Ecke, die noch nicht markiert ist: Linie der Maßkette oben)
  await pickTool(page, 'tool-rect');
  const c = scr(ROOM.x1 + 4 / s, ROOM.y1 - 30 - 4 / s);
  await page.mouse.move(c.x, c.y);
  await expect(page.getByTestId('snap-marker')).toBeVisible();
  await page.keyboard.press('x');
  await page.mouse.move(c.x - 1, c.y);
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await page.keyboard.press('x');
  await page.mouse.move(c.x + 1, c.y);
  await expect(page.getByTestId('snap-marker')).toBeVisible(); // Anfang der Maßlinie
});

/** Fang-Lupe: grüner (aktiver) Fangpunkt bzw. nächster roter Punkt zum Mauszeiger – Bildschirmposition */
async function nearestLupePoint(page: Page, at: { x: number; y: number }) {
  const box = (await page.getByTestId('plan-viewer').boundingBox())!;
  const pts = await page.getByTestId('lupe-points').locator('circle').evaluateAll((els) => els.map((e) => ({ x: Number(e.getAttribute('cx')), y: Number(e.getAttribute('cy')) })));
  const abs = pts.map((p) => ({ x: box.x + p.x, y: box.y + p.y }));
  return abs.reduce((m, p) => (Math.hypot(p.x - at.x, p.y - at.y) < Math.hypot(m.x - at.x, m.y - at.y) ? p : m));
}

test('Fang-Lupe (X): Fläche Ecke für Ecke – zoomt hinein, Punkt grün, Ansicht zurück, Punkte bleiben exakt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Lupe', {}, ['Keller']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  const viewer = page.getByTestId('plan-viewer');
  const scale0 = Number(await viewer.getAttribute('data-scale'));
  const box = await planBox(page);
  const s = box.width / 1191;
  const scr = (x: number, y: number) => ({ x: box.x + x * s, y: box.y + y * s });
  await pickTool(page, 'tool-polygon');

  const corners = [
    [ROOM.x1, ROOM.y2],
    [ROOM.x2, ROOM.y2],
    [ROOM.x2, ROOM.y1],
    [ROOM.x1, ROOM.y1],
  ];
  for (const [i, [x, y]] of corners.entries()) {
    const near = scr(x + 6 / s, y - 5 / s); // grob daneben
    await page.mouse.move(near.x, near.y);
    await page.keyboard.press('x');
    await expect(page.getByTestId('lupe-hint')).toBeVisible();
    expect(Number(await viewer.getAttribute('data-scale'))).toBeGreaterThan(scale0 * 4); // hineingezoomt
    expect(await page.locator('.lupe-pt').count()).toBeGreaterThan(0); // Fangpunkte angezeigt (rot bzw. grün)
    // die Umgebung des Mauszeigers liegt jetzt in der Bildmitte
    const vb = (await viewer.boundingBox())!;
    const target = await nearestLupePoint(page, { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 });
    await page.mouse.move(target.x, target.y);
    await expect(page.getByTestId('lupe-pt-active')).toHaveCount(1); // grün unter dem Mauszeiger
    if (i === 2) await page.screenshot({ path: join(OUT, 'fang-lupe.png') });
    await page.mouse.down();
    await page.mouse.up();
    // zurück zur vorherigen Ansicht, Punkt gesetzt (grün gefüllt), Zeichnen läuft weiter
    await expect(page.getByTestId('lupe-hint')).toHaveCount(0);
    expect(Number(await viewer.getAttribute('data-scale'))).toBeCloseTo(scale0, 6);
    await expect(page.getByTestId('polygon-bar')).toContainText(`${i + 1} Punkt`);
    await expect(page.locator('.poly-preview circle')).toHaveCount(i + 1);
  }
  // Esc schließt eine offene Lupe ohne Punkt
  await page.keyboard.press('x');
  await expect(page.getByTestId('lupe-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lupe-hint')).toHaveCount(0);
  await expect(page.getByTestId('polygon-bar')).toContainText('4 Punkte');

  await page.getByTestId('polygon-finish').click();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg.getByTestId('use-geometry')).toContainText('116,66 m²'); // exakt die Raumecken
  await dlg.getByTestId('damage-cancel').click();
});
