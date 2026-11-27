import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool } from './helpers';

/**
 * Plan bearbeiten: kleinere Form in einer größeren wird beim Antippen gewählt; Maße immer mit 2 Kommastellen;
 * Länge eingeben: der markierte Punkt wandert, sonst bleibt der angesetzte Punkt A liegen.
 */

async function newDrawing(page: Page) {
  await freshStart(page);
  await createProject(page, 'Antippen', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('AT-1');
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  return (await sheet.boundingBox())!;
}
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
}
const num = (s: string) => Number(s.replace(',', '.'));

test('Kleine Form in großer: Antippen wählt die kleine – auch wenn die große später gezeichnet wurde', async ({ page }) => {
  const sb = await newDrawing(page);
  const bar = page.getByTestId('element-bar');
  // klein zuerst, groß danach darüber
  const lengthNow = async () => num((await bar.getByTestId('element-length').inputValue().catch(() => '')) || '0');
  await pickTool(page, 'draw-rect');
  await drag(page, sb.x + 200, sb.y + 200, sb.x + 260, sb.y + 240);
  await expect.poll(lengthNow).toBeGreaterThan(0);
  const small = await lengthNow();
  await pickTool(page, 'draw-rect');
  await drag(page, sb.x + 100, sb.y + 120, sb.x + 420, sb.y + 360);
  await expect.poll(lengthNow).toBeGreaterThan(small * 3);
  const big = await lengthNow();
  // große ist gewählt – Tipp in die kleine wählt die kleine
  await page.mouse.click(sb.x + 230, sb.y + 220);
  await expect.poll(lengthNow).toBeCloseTo(small, 2);
  // Tipp in die große (außerhalb der kleinen) wählt die große
  await page.mouse.click(sb.x + 360, sb.y + 320);
  await expect.poll(lengthNow).toBeCloseTo(big, 2);
});

test('Linie: Maß mit 2 Kommastellen; Länge eingeben verlängert B, markierter Punkt A wandert', async ({ page }) => {
  const sb = await newDrawing(page);
  const bar = page.getByTestId('element-bar');
  const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  // schräge Linie (Länge mit vielen Nachkommastellen): A links unten, B rechts oben
  await pickTool(page, 'draw-line');
  const A = { x: sb.x + 150, y: sb.y + 330 };
  const B = { x: sb.x + 337, y: sb.y + 190 };
  await page.mouse.click(A.x, A.y);
  await page.mouse.click(B.x, B.y);
  await expect(bar).toBeVisible();
  // am PC bleibt die Linie aktiv – zum Bearbeiten der Eckpunkte auf Auswahl wechseln (die Linie bleibt markiert)
  await pickTool(page, 'draw-select');
  await expect(bar).toBeVisible();
  const len = bar.getByTestId('element-length');
  await expect(len).toHaveValue(/^\d+,\d\d$/);
  // Länge ändern: A bleibt, B wandert
  const vbox = async (i: number) => {
    const b = (await page.getByTestId(`vertex-${i}`).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const a0 = await vbox(0);
  const b0 = await vbox(1);
  const l0 = num(await len.inputValue());
  await len.fill(String(l0 * 2).replace('.', ','));
  await len.press('Enter');
  await expect.poll(async () => (await vbox(1)).x).toBeGreaterThan(b0.x + 50);
  const a1 = await vbox(0);
  expect(Math.hypot(a1.x - a0.x, a1.y - a0.y)).toBeLessThan(2);
  await expect(len).toHaveValue(/^\d+,\d\d$/);
  // Punkt A markieren, Länge zurück: A wandert, B bleibt
  const b1 = await vbox(1);
  await page.mouse.click(a1.x, a1.y);
  await expect(page.getByTestId('vertex-0')).toHaveClass(/active/);
  await len.fill(String(l0).replace('.', ','));
  await len.press('Enter');
  await expect.poll(async () => (await vbox(0)).x).toBeGreaterThan(a1.x + 50);
  const b2 = await vbox(1);
  expect(Math.hypot(b2.x - b1.x, b2.y - b1.y)).toBeLessThan(2);
  expect(scale).toBeGreaterThan(0);
});

test('Pfeiltasten verschieben das Ausgewählte: 1 cm, mit Umschalt 10 cm', async ({ page }) => {
  const sb = await newDrawing(page);
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill('2');
  await page.getByTestId('insert-width').fill('1');
  await page.getByTestId('insert-submit').click();
  const rect = page.locator('[data-element="rect"]');
  await expect(rect).toHaveCount(1);
  await expect(page.getByTestId('element-bar')).toBeVisible();
  const scale = async () => Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const box0 = (await rect.boundingBox())!;
  await page.locator('body').click({ position: { x: 1, y: 1 }, force: true }).catch(() => {});
  // Fokus aus dem Eingabefeld nehmen, Auswahl bleibt
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  if (!(await page.getByTestId('element-bar').isVisible())) await page.mouse.click(box0.x + box0.width / 2, box0.y + box0.height / 2);
  await expect(page.getByTestId('element-bar')).toBeVisible();
  const before = (await rect.boundingBox())!;
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight'); // 50 cm
  await page.keyboard.press('ArrowDown'); // 1 cm
  const s = await scale();
  const k = s; // px je Seiteneinheit; gezeichnete Pläne: 100 Einheiten je m (geprüft über das Verhältnis)
  await expect.poll(async () => (await rect.boundingBox())!.x - before.x).toBeGreaterThan(5);
  const after = (await rect.boundingBox())!;
  const dxPx = after.x - before.x;
  const dyPx = after.y - before.y;
  expect(dxPx / dyPx).toBeGreaterThan(45);
  expect(dxPx / dyPx).toBeLessThan(55);
  expect(k).toBeGreaterThan(0);
  expect(sb.width).toBeGreaterThan(0);
});
