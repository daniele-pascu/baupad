import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool } from './helpers';

/**
 * Plan bearbeiten am PC: Esc bzw. Klick außerhalb des Blatts schaltet alle Funktionen aus, Enter schaltet die zuletzt
 * benutzte wieder ein; Strg+C kopiert mit Basispunkt (die Kopie hängt am Mauszeiger), Strg+V, Strg+D, Strg+Z.
 */

async function newDrawing(page: Page) {
  await freshStart(page);
  await createProject(page, 'Kürzel', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('TK-1');
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  return (await sheet.boundingBox())!;
}
const pressed = (page: Page, id: string) => expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', 'true');

test('Esc und Klick außerhalb schalten alles aus, Enter schaltet die letzte Funktion wieder ein', async ({ page }) => {
  const sb = await newDrawing(page);
  await pickTool(page, 'draw-rect');
  await pressed(page, 'draw-rect');
  await page.keyboard.press('Escape');
  await pressed(page, 'draw-select');
  await page.keyboard.press('Enter');
  await pressed(page, 'draw-rect');
  // Klick außerhalb des Blatts: alle Funktionen aus
  const vb = (await page.getByTestId('plan-viewer').boundingBox())!;
  const out = { x: sb.x + sb.width / 2, y: Math.min(vb.y + vb.height - 8, sb.y + sb.height + 30) };
  expect(out.y).toBeGreaterThan(sb.y + sb.height + 4);
  await page.mouse.click(out.x, out.y);
  await pressed(page, 'draw-select');
  await expect(page.locator('[data-element="rect"]')).toHaveCount(0);
  // Linie: nach Punkt A darf Punkt B außerhalb liegen (kein Abbruch mitten in der Linie)
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height - 60);
  await page.mouse.click(out.x + 40, out.y);
  await expect(page.locator('[data-element="line"]')).toHaveCount(1);
  // nach dem Zeichnen: Enter schaltet „Linie“ wieder ein
  await page.keyboard.press('Escape');
  await pressed(page, 'draw-select');
  await page.keyboard.press('Enter');
  await pressed(page, 'draw-line');
});

test('Strg+C: Basispunkt antippen, Kopie hängt am Mauszeiger; Strg+V, Strg+D, Strg+Z', async ({ page }) => {
  const sb = await newDrawing(page);
  await pickTool(page, 'draw-rect');
  await page.mouse.move(sb.x + 200, sb.y + 200);
  await page.mouse.down();
  await page.mouse.move(sb.x + 260, sb.y + 240, { steps: 5 });
  await page.mouse.up();
  const rects = page.locator('[data-element="rect"]');
  await expect(rects).toHaveCount(1);
  await expect(page.getByTestId('element-bar')).toBeVisible();
  // Strg+C mit Auswahl: gleich der Basispunkt, danach hängt die Form am Zeiger
  await page.keyboard.press('Control+c');
  await expect(page.getByTestId('command-bar')).toBeVisible();
  await page.mouse.click(sb.x + 200, sb.y + 200);
  await page.mouse.move(sb.x + 380, sb.y + 300, { steps: 4 });
  await expect(page.getByTestId('cad-ghost')).toBeVisible();
  await page.mouse.click(sb.x + 380, sb.y + 300);
  await expect(rects).toHaveCount(2);
  // die Kopie liegt mit dem Basispunkt (Ecke oben links) an der angeklickten Stelle
  const boxes = await rects.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeGreaterThan(170);
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(190);
  await page.keyboard.press('Enter'); // Kopieren beenden
  await pressed(page, 'draw-select');
  // Strg+V ohne Auswahl: die zuletzt kopierte Form noch einmal
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('command-bar')).toBeVisible();
  await page.mouse.click(sb.x + 200, sb.y + 200);
  await page.mouse.click(sb.x + 200, sb.y + 330);
  await expect(rects).toHaveCount(3);
  await page.keyboard.press('Escape');
  // Strg+Z nimmt die letzte Kopie zurück
  await page.keyboard.press('Control+z');
  await expect(rects).toHaveCount(2);
  // Strg+D verdoppelt die Auswahl
  await page.mouse.click(sb.x + 230, sb.y + 220);
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(rects).toHaveCount(3);
});
