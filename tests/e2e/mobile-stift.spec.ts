import { expect, test, type CDPSession } from './fixtures';
import { join } from 'node:path';
import { createProject, FIXTURES, freshStart, pickTool, waitForPlan } from './helpers';

/** Apple Pencil + Finger: Stift setzt Punkte, zwei Finger zoomen dazwischen; aufliegende Hand */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function penTap(cdp: CDPSession, x: number, y: number) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'pen' } as never);
  await pause(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'pen' } as never);
  await pause(400);
}
async function pinch(cdp: CDPSession, c: { x: number; y: number }, from: number, to: number) {
  const pts = (d: number) => [{ x: c.x - d / 2, y: c.y, id: 11 }, { x: c.x + d / 2, y: c.y, id: 12 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= 10; i++) {
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 10) });
  }
  await pause(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(300);
}

test('Stift setzt Punkte, zwei Finger zoomen dazwischen – Fläche bleibt erhalten', async ({ page }, info) => {
  test.skip(info.project.name === 'iphone');
  await freshStart(page);
  await createProject(page, 'Stift', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('P-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const cdp = await page.context().newCDPSession(page);
  const viewer = page.getByTestId('plan-viewer');
  await pickTool(page, 'tool-polyline', 'tap');
  const b = (await viewer.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy });
  const p1 = at(0.4, 0.4);
  await penTap(cdp, p1.x, p1.y);
  await penTap(cdp, at(0.55, 0.4).x, at(0.55, 0.4).y);
  const s0 = Number(await viewer.getAttribute('data-scale'));
  // zwei Finger: herauszoomen
  await pinch(cdp, at(0.5, 0.6), 260, 120);
  const s1 = Number(await viewer.getAttribute('data-scale'));
  console.log('SCALE', s0, s1);
  expect(s1).toBeLessThan(s0);
  // Position des ersten Punkts nach dem Zoom: aus dem Bildschirm neu bestimmen
  const p1now = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="polygon-preview"] .poly-first');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log('P1NOW', JSON.stringify(p1now));
  await penTap(cdp, at(0.55, 0.55).x, at(0.55, 0.55).y);
  await expect(page.getByTestId('damage-dialog')).toHaveCount(0);
  if (p1now) await penTap(cdp, p1now.x, p1now.y);
  await expect(page.getByTestId('damage-dialog')).toBeVisible();
});

test('Aufmaß: Hand liegt auf (ein Finger am Bildschirm), Stift tippt: Markierung wird trotzdem gesetzt', async ({ page }, info) => {
  test.skip(info.project.name === 'iphone');
  await freshStart(page);
  await createProject(page, 'Hand', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('P-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const cdp = await page.context().newCDPSession(page);
  const viewer = page.getByTestId('plan-viewer');
  await pickTool(page, 'tool-ellipse', 'tap');
  const b = (await viewer.boundingBox())!;
  // Handballen liegt unten rechts auf dem Plan auf (über der Werkzeugleiste)
  const tb = (await page.locator('.toolbar').boundingBox())!;
  const palmY = Math.min(b.y + b.height * 0.85, tb.y - 30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width * 0.85, y: palmY, id: 21 }] });
  await pause(100);
  await penTap(cdp, b.x + b.width * 0.4, b.y + b.height * 0.4);
  await expect(page.getByTestId('damage-dialog')).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(300);
  // Abheben der Hand schließt den Dialog nicht (kein Klick an der Stelle der Hand)
  await expect(page.getByTestId('damage-dialog')).toBeVisible();
  await page.getByTestId('damage-dialog').getByTestId('input-length').fill('1');
  await page.getByTestId('damage-dialog').getByTestId('damage-save').tap();
  await expect(page.getByTestId('damage-dialog')).toBeHidden();
  // nach dem Stift: ein Finger zieht nur den Plan, zeichnet nichts
  await pickTool(page, 'tool-rect', 'tap');
  const before = await viewer.getAttribute('data-tx');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width * 0.3, y: b.y + b.height * 0.3, id: 31 }] });
  for (let i = 1; i <= 8; i++) {
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width * (0.3 + i * 0.03), y: b.y + b.height * (0.3 + i * 0.03), id: 31 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(300);
  await expect(page.getByTestId('damage-dialog')).toHaveCount(0);
  if (before !== null) expect(await viewer.getAttribute('data-tx')).not.toBe(before);
  await expect(page.locator('.damage-label')).toHaveCount(1);
  // Stift ruht (z. B. leer): nach kurzer Zeit geht wieder alles mit dem Finger – Rechteck ziehen öffnet die Messung
  await pause(4300);
  await pickTool(page, 'tool-rect', 'tap');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width * 0.3, y: b.y + b.height * 0.3, id: 41 }] });
  for (let i = 1; i <= 8; i++) {
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width * (0.3 + i * 0.03), y: b.y + b.height * (0.3 + i * 0.02), id: 41 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('damage-dialog')).toBeVisible();
});

test('Mängelplan: Hand liegt auf, Stift setzt den Pin trotzdem', async ({ page }, info) => {
  test.skip(info.project.name === 'iphone');
  await freshStart(page);
  await page.goto('./maengel');
  await page.getByTestId('defect-new-site').tap();
  await page.getByTestId('project-picker').getByTestId('picker-new').tap();
  await page.getByTestId('project-name').fill('Stift-Baustelle');
  await page.getByTestId('project-save').tap();
  await page.getByTestId('defect-upload').tap();
  const dlg = page.getByTestId('defect-plan-dialog');
  await dlg.getByTestId('defect-plan-file').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await dlg.getByTestId('defect-plan-save').tap();
  const stage = page.locator('.dp-stage');
  await expect(stage).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  const box = (await stage.boundingBox())!;
  await page.getByTestId('dp-tool-pin').tap();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.85, y: box.y + box.height * 0.85, id: 41 }] });
  await pause(100);
  await penTap(cdp, box.x + box.width * 0.4, box.y + box.height * 0.4);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('dp-mark-dialog')).toContainText('Pin');
});

test('Finger: Rechteck zeichnen, antippen und einen Eckpunkt ziehen – Fläche passt sich an', async ({ page }, info) => {
  test.skip(info.project.name === 'iphone');
  await freshStart(page);
  await createProject(page, 'Ecken', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('E-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const cdp = await page.context().newCDPSession(page);
  const viewer = page.getByTestId('plan-viewer');
  const b = (await viewer.boundingBox())!;
  const drag = async (x0: number, y0: number, x1: number, y1: number, id: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id }] });
    for (let i = 1; i <= 10; i++) {
      await pause(16);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10, id }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(300);
  };
  await pickTool(page, 'tool-rect', 'tap');
  await drag(b.x + b.width * 0.3, b.y + b.height * 0.3, b.x + b.width * 0.5, b.y + b.height * 0.5, 51);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('damage-save').tap();
  await expect(dlg).toBeHidden();
  // Fläche antippen → runde Eckpunkte
  await page.touchscreen.tap(b.x + b.width * 0.4, b.y + b.height * 0.4);
  const v2 = page.getByTestId('vertex-2');
  await expect(v2).toBeVisible();
  const before = await page.locator('[data-shape-id], path[data-damage]').first().getAttribute('d');
  const vb = (await v2.boundingBox())!;
  // knapp neben den Punkt greifen (Finger) und ziehen
  await drag(vb.x + vb.width / 2 + 6, vb.y + vb.height / 2 + 6, vb.x + vb.width / 2 + 80, vb.y + vb.height / 2 + 40, 52);
  await expect.poll(() => page.locator('[data-shape-id], path[data-damage]').first().getAttribute('d')).not.toBe(before);
  // aus dem Rechteck ist ein Viereck mit verschobener Ecke geworden – weiterhin eine Messung
  await expect(page.locator('.damage-label')).toHaveCount(1);
});
