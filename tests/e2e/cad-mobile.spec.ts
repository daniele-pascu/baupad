import { expect, test, type CDPSession, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** CAD Phase 1 mit Finger (iPhone, iPad) und Stift (iPad): Mehrfachauswahl, Fenster, Kopieren per Antippen, Eingabe */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await pause(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1 }] });
  }
  await pause(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x, y: to.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(200);
}
async function fingerTap(cdp: CDPSession, p: { x: number; y: number }) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
  await pause(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(350);
}
async function penTap(cdp: CDPSession, p: { x: number; y: number }) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, pointerType: 'pen' } as never);
  await pause(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, pointerType: 'pen' } as never);
  await pause(400);
}
type El = { id: string; shape: { x: number; y: number; w: number; h: number } };
async function elements(page: Page): Promise<El[]> {
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

async function setup(page: Page) {
  await freshStart(page);
  await createProject(page, 'CAD Finger', {}, ['EG']);
  await page.getByTestId('draw-plan').tap();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('F-1');
  await page.getByTestId('new-drawing-save').tap();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  // sichtbare Planfläche (unter Werkzeug- und Eingabeleiste)
  const vb = (await page.getByTestId('plan-viewer').boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: vb.x + vb.width * fx, y: vb.y + vb.height * (0.35 + fy * 0.6) });
  // zwei Rechtecke mit dem Finger ziehen
  for (const fx of [0.15, 0.55]) {
    // Auswahl aufheben (die Leiste des gewählten Rechtecks verdeckt am Handy sonst einen Teil des Plans)
    if (fx > 0.5) await fingerTap(cdp, at(0.03, -0.17));
    await pickTool(page, 'draw-rect', 'tap');
    await touchDrag(cdp, at(fx, 0.25), at(fx + 0.25, 0.4));
  }
  await waitSaved(page);
  expect(await elements(page)).toHaveLength(2);
  return { cdp, at };
}

test('Finger: Mehrfach antippen, Kopieren per Basis- und Zielpunkt, Verschieben per Eingabe, Fenster', async ({ page }) => {
  const { cdp, at } = await setup(page);
  // zuletzt gezeichnetes Rechteck ist ausgewählt: ins Leere tippen hebt die Auswahl auf
  await fingerTap(cdp, at(0.03, -0.17));
  await expect(page.getByTestId('element-bar')).toHaveCount(0);
  // Mehrfachauswahl einschalten, beide Rechtecke an der Oberkante antippen
  await pickTool(page, 'draw-multi', 'tap');
  await expect(page.getByTestId('draw-multi')).toHaveAttribute('aria-pressed', 'true');
  await fingerTap(cdp, at(0.27, 0.25));
  await fingerTap(cdp, at(0.67, 0.25));
  await expect(page.getByTestId('multi-bar')).toContainText('2 Objekte ausgewählt');

  // Kopieren: Basispunkt antippen, Zielpunkt antippen → beide kopiert, Werkzeug bleibt für weitere Kopien
  await page.getByTestId('multi-copy').tap();
  await expect(page.getByTestId('command-prompt')).toContainText('Basispunkt');
  await fingerTap(cdp, at(0.15, 0.25));
  await expect(page.getByTestId('command-prompt')).toContainText('Zielpunkt');
  await fingerTap(cdp, at(0.15, 0.0));
  await waitSaved(page);
  expect(await elements(page)).toHaveLength(4);
  await expect(page.getByTestId('command-prompt')).toContainText('1 Kopie erstellt');
  await page.getByTestId('command-done').tap();
  await expect(page.getByTestId('command-bar')).toHaveCount(0);

  // alles wählen, Verschieben mit Eingabe (Bildschirmtastatur)
  await pickTool(page, 'draw-select-all', 'tap');
  await expect(page.getByTestId('multi-bar')).toContainText('4 Objekte ausgewählt');
  const before = await elements(page);
  await page.getByTestId('multi-move').tap();
  await page.getByTestId('command-input').tap();
  await page.getByTestId('command-input').fill('1;0');
  await page.getByTestId('command-ok').tap();
  await waitSaved(page);
  const after = await elements(page);
  for (const b of before) expect(Math.abs(after.find((a) => a.id === b.id)!.shape.x - (b.shape.x + 1))).toBeLessThan(0.011);

  // Fenster mit dem Finger: nur das obere Paar ganz enthalten (Mehrfach aus → ersetzt die Auswahl)
  await pickTool(page, 'draw-multi', 'tap');
  await expect(page.getByTestId('draw-multi')).toHaveAttribute('aria-pressed', 'false');
  await pickTool(page, 'draw-selwin', 'tap');
  await touchDrag(cdp, at(0.05, 0.2), at(0.95, 0.5));
  await expect(page.getByTestId('multi-bar')).toContainText('2 Objekte ausgewählt');
});

test('Apple Pencil: Objekt antippen und mit Basis- und Zielpunkt kopieren', async ({ page }, info) => {
  test.skip(info.project.name === 'iphone');
  const { cdp, at } = await setup(page);
  await penTap(cdp, at(0.03, -0.17));
  await penTap(cdp, at(0.27, 0.25));
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await pickTool(page, 'draw-copy', 'tap');
  await penTap(cdp, at(0.15, 0.25));
  await expect(page.getByTestId('command-prompt')).toContainText('Zielpunkt');
  await penTap(cdp, at(0.15, 0.0));
  await waitSaved(page);
  expect(await elements(page)).toHaveLength(3);
  // zweite Kopie: derselbe Basispunkt, nur noch den Zielpunkt antippen
  await penTap(cdp, at(0.15, 0.85));
  await waitSaved(page);
  expect(await elements(page)).toHaveLength(4);
  const els = await elements(page);
  const [a, , c1, c2] = els;
  expect(Math.abs(c1.shape.x - a.shape.x)).toBeLessThan(0.011);
  expect(Math.abs(c2.shape.y - c1.shape.y)).toBeGreaterThan(0.1);
});

type ElS = { id: string; type: string; shape: { x: number; y: number; w: number; h: number; rotation?: number } };
test('Phase 2 mit Finger: Versetzen (Objekt, dann Seite antippen) und Spiegeln (zwei Achsenpunkte)', async ({ page }) => {
  const { cdp, at } = await setup(page);
  const [a] = (await elements(page)) as ElS[];
  await fingerTap(cdp, at(0.03, -0.17)); // Auswahl aufheben
  await pickTool(page, 'draw-offset', 'tap');
  await expect(page.getByTestId('command-prompt')).toContainText('Objekt antippen');
  await fingerTap(cdp, at(0.27, 0.25)); // Oberkante Rechteck A
  await expect(page.getByTestId('command-prompt')).toContainText('Seite antippen');
  await fingerTap(cdp, at(0.05, 0.32)); // links daneben = außen
  await waitSaved(page);
  const els = (await elements(page)) as ElS[];
  expect(els).toHaveLength(3);
  const off = els[2];
  expect(off.type).toBe('rect');
  expect(Math.abs(off.shape.w - (a.shape.w + 0.5))).toBeLessThan(0.011); // Standardabstand 0,25 m je Seite
  await page.getByTestId('command-done').tap();

  // Spiegeln: Rechteck B antippen, Achse aus zwei Punkten
  await fingerTap(cdp, at(0.67, 0.25));
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await pickTool(page, 'draw-mirror', 'tap');
  await expect(page.getByTestId('command-prompt')).toContainText('1. Punkt');
  // Achse am linken Rand (oben liegt am Tablet die Befehlsleiste, am Handy unten)
  await fingerTap(cdp, at(0.04, 0.0));
  await expect(page.getByTestId('command-prompt')).toContainText('2. Punkt');
  await fingerTap(cdp, at(0.04, 0.3));
  await waitSaved(page);
  expect(await elements(page)).toHaveLength(4);
});

test('Phase 2 mit Stift: Versetzen und Spiegeln', async ({ page }, info) => {
  test.skip(info.project.name === 'iphone');
  const { cdp, at } = await setup(page);
  await penTap(cdp, at(0.03, -0.17));
  await pickTool(page, 'draw-offset', 'tap');
  await penTap(cdp, at(0.27, 0.25));
  await expect(page.getByTestId('command-prompt')).toContainText('Seite antippen');
  await penTap(cdp, at(0.27, 0.32)); // innen
  await waitSaved(page);
  const els = (await elements(page)) as ElS[];
  expect(els).toHaveLength(3);
  expect(els[2].shape.w).toBeLessThan(els[0].shape.w);
  await page.getByTestId('command-done').tap();
  await penTap(cdp, at(0.67, 0.25));
  await pickTool(page, 'draw-mirror', 'tap');
  await penTap(cdp, at(0.04, 0.0));
  await penTap(cdp, at(0.04, 0.3));
  await waitSaved(page);
  expect(await elements(page)).toHaveLength(4);
});

test('Phase 3 mit Finger bzw. Stift: Reihe rechteckig und polar (Mittelpunkt antippen)', async ({ page }, info) => {
  const { cdp, at } = await setup(page);
  const tap = info.project.name === 'iphone' ? fingerTap : (c: CDPSession, p: { x: number; y: number }) => penTap(c, p);
  await fingerTap(cdp, at(0.03, -0.17));
  await tap(cdp, at(0.27, 0.25)); // Rechteck A
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await pickTool(page, 'draw-array', 'tap');
  const dlg = page.getByTestId('array-dialog');
  await dlg.getByTestId('array-kind-linear').tap();
  await dlg.getByTestId('array-count').fill('3');
  await dlg.getByTestId('array-dist').fill('2');
  await dlg.getByTestId('array-angle').fill('-90');
  await dlg.getByTestId('array-ok').tap();
  await waitSaved(page);
  expect(await elements(page)).toHaveLength(4);
  // polar um einen angetippten Punkt (zuerst Auswahl aufheben – die Leiste verdeckt am Handy sonst die Mitte)
  await fingerTap(cdp, at(0.03, -0.17));
  await tap(cdp, at(0.67, 0.25)); // Rechteck B
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await pickTool(page, 'draw-array', 'tap');
  await dlg.getByTestId('array-kind-polar').tap();
  await dlg.getByTestId('array-pcount').fill('3');
  await dlg.getByTestId('array-total').fill('360');
  await dlg.getByTestId('array-ok').tap();
  await expect(page.getByTestId('command-prompt')).toContainText('Mittelpunkt');
  await tap(cdp, at(0.67, 0.05));
  await waitSaved(page);
  expect(await elements(page)).toHaveLength(6);
  await expect(page.getByTestId('command-bar')).toHaveCount(0);
});
