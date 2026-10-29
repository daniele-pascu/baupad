import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, OUT, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

/**
 * Punktfang auf den Linien des PDF-Plans (Vektor-PDF): Rechteck von Ecke zu Ecke des
 * Grundrisses – trifft die Ecken exakt, die Fläche stimmt mit dem Plan überein. Ohne Fang (Umschalt+X)
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

  // Fang aus (Umschalt+X): kein Fangpunkt
  // (an einer anderen Ecke, die noch nicht markiert ist: Linie der Maßkette oben)
  await pickTool(page, 'tool-rect');
  const c = scr(ROOM.x1 + 4 / s, ROOM.y1 - 30 - 4 / s);
  await page.mouse.move(c.x, c.y);
  await expect(page.getByTestId('snap-marker')).toBeVisible();
  await page.keyboard.press('Shift+X');
  await page.mouse.move(c.x - 1, c.y);
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await page.keyboard.press('Shift+X');
  await page.mouse.move(c.x + 1, c.y);
  await expect(page.getByTestId('snap-marker')).toBeVisible(); // Anfang der Maßlinie
});

test('X gedrückt halten: vergrößert an der Maus, Fangpunkt blau markiert, Klick setzt grünen Punkt, loslassen zoomt zurück; Enter fertig, Rücktaste löscht', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Halten', {}, ['Keller']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  const viewer = page.getByTestId('plan-viewer');
  await pickTool(page, 'tool-polygon');
  // etwas verkleinern, damit die Ecken nicht unter den Leisten am Rand liegen
  await viewer.hover({ position: { x: 300, y: 200 } });
  await page.keyboard.press('-');
  await page.waitForTimeout(300);
  const scale0 = Number(await viewer.getAttribute('data-scale'));
  const box = await planBox(page);
  const s = box.width / 1191;
  const scr = (x: number, y: number) => ({ x: box.x + x * s, y: box.y + y * s });

  const corners = [
    [ROOM.x1, ROOM.y2],
    [ROOM.x2, ROOM.y2],
    [ROOM.x2, ROOM.y1],
    [ROOM.x1, ROOM.y1],
  ];
  for (const [i, [x, y]] of corners.entries()) {
    const corner = scr(x, y);
    const near = { x: corner.x + (x < 500 ? 6 : -6), y: corner.y + (y > 400 ? -5 : 5) }; // grob daneben
    await page.mouse.move(near.x, near.y);
    await page.keyboard.down('x');
    await expect(page.getByTestId('lupe-hint')).toBeVisible();
    const k = Number(await viewer.getAttribute('data-scale')) / scale0;
    expect(k).toBeGreaterThan(4); // hineingezoomt, der Punkt unter der Maus bleibt stehen
    // Ecke in der vergrößerten Ansicht anfahren → roter Fangpunkt
    await page.mouse.move(near.x + (corner.x - near.x) * k, near.y + (corner.y - near.y) * k);
    await expect(page.getByTestId('snap-hover')).toBeVisible();
    if (i === 2) await page.screenshot({ path: join(OUT, 'fang-x-halten.png') });
    await page.mouse.down();
    await page.mouse.up();
    // Punkt gesetzt (grün), Ansicht bleibt vergrößert, solange X gehalten wird
    await expect(page.getByTestId('polygon-bar')).toContainText(`${i + 1} Punkt`);
    expect(Number(await viewer.getAttribute('data-scale')) / scale0).toBeCloseTo(k, 6);
    await page.keyboard.up('x');
    await expect(page.getByTestId('lupe-hint')).toHaveCount(0);
    expect(Number(await viewer.getAttribute('data-scale'))).toBeCloseTo(scale0, 6); // zurück
    await expect(page.locator('.poly-preview circle')).toHaveCount(i + 1);
  }
  // Zusatzpunkt, dann Rücktaste bzw. Entf löscht den letzten Punkt
  const extra = scr(500, 450);
  await page.mouse.move(extra.x, extra.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('polygon-bar')).toContainText('5 Punkte');
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('polygon-bar')).toContainText('4 Punkte');
  const extra2 = scr(600, 420); // andere Stelle (sonst Doppelklick = fertig)
  await page.mouse.click(extra2.x, extra2.y);
  await expect(page.getByTestId('polygon-bar')).toContainText('5 Punkte');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('polygon-bar')).toContainText('4 Punkte');

  // Enter: fertig – Fläche exakt aus den Raumecken
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg.getByTestId('use-geometry')).toContainText('116,66 m²');
  await dlg.getByTestId('damage-cancel').click();

  // schon nah genug vergrößert: X zoomt nicht weiter, loslassen ändert nichts
  for (let n = 0; n < 6; n++) await page.keyboard.press('+');
  await page.waitForTimeout(200);
  const near = Number(await viewer.getAttribute('data-scale'));
  await page.keyboard.down('x');
  await expect(page.getByTestId('lupe-hint')).toBeVisible();
  expect(Number(await viewer.getAttribute('data-scale'))).toBeCloseTo(near, 6);
  await page.keyboard.up('x');
  await expect(page.getByTestId('lupe-hint')).toHaveCount(0);
  expect(Number(await viewer.getAttribute('data-scale'))).toBeCloseTo(near, 6);
});

test('Kalibrieren und Linie per Klick, Klick: Punkt A, X halten, Punkt B – exakt an den Ecken', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Klick', {}, ['Keller']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  const viewer = page.getByTestId('plan-viewer');
  await viewer.hover({ position: { x: 300, y: 200 } });
  await page.keyboard.press('-');
  await page.waitForTimeout(300);
  const scale0 = Number(await viewer.getAttribute('data-scale'));

  /** Ecke mit gehaltener X-Taste anklicken (Lage des Plans jedes Mal neu messen – Hinweisleisten verschieben ihn) */
  const pickCorner = async (x: number, y: number) => {
    const box = await planBox(page);
    const s = box.width / 1191;
    const corner = { x: box.x + x * s, y: box.y + y * s };
    const near = { x: corner.x + (x < 500 ? 6 : -6), y: corner.y + 5 };
    await page.mouse.move(near.x, near.y);
    await page.keyboard.down('x');
    const k = Number(await viewer.getAttribute('data-scale')) / scale0;
    await page.mouse.move(near.x + (corner.x - near.x) * k, near.y + (corner.y - near.y) * k);
    await expect(page.getByTestId('snap-hover')).toBeVisible();
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('x');
  };

  // Kalibrieren: obere Wand von Ecke zu Ecke (15,15 m)
  await pickTool(page, 'tool-calibrate');
  await pickCorner(ROOM.x1, ROOM.y1);
  await expect(page.getByTestId('click-line-preview')).toBeVisible(); // Punkt A gesetzt, Vorschau zur Maus
  await pickCorner(ROOM.x2, ROOM.y1);
  const dlg = page.getByTestId('prompt-dialog');
  await dlg.locator('input').fill('15,15');
  await dlg.getByRole('button', { name: 'Kalibrieren' }).click();
  await waitSaved(page);
  const cal = await page.evaluate(
    () =>
      new Promise<{ a: { x: number; y: number }; b: { x: number; y: number }; meters: number }>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('plans').objectStore('plans').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve(all.result[0].calibration);
          };
        };
      }),
  );
  expect(cal.a.x).toBeCloseTo(ROOM.x1, 1);
  expect(cal.b.x).toBeCloseTo(ROOM.x2, 1);
  expect(Math.hypot(cal.b.x - cal.a.x, cal.b.y - cal.a.y) / cal.meters).toBeCloseTo(K, 2); // genau 1:50

  // Linie per Klick, Klick: linke Wand (7,70 m) – Länge aus dem Plan
  await pickTool(page, 'tool-line');
  await pickCorner(ROOM.x1, ROOM.y1);
  await page.keyboard.press('Escape'); // Esc verwirft Punkt A und schaltet auf „Auswahl“
  await expect(page.getByTestId('click-line-preview')).toHaveCount(0);
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  await pickTool(page, 'tool-line');
  await pickCorner(ROOM.x1, ROOM.y1);
  await pickCorner(ROOM.x1, ROOM.y2);
  const dd = page.getByTestId('damage-dialog');
  await expect(dd.getByTestId('geometry-length')).toHaveValue('7,70'); // Länge aus dem Plan (vorgewählt)
  await dd.getByTestId('damage-cancel').click();
});
