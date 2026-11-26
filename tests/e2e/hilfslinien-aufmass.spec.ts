import { expect, test } from './fixtures';
import { chooseMeasureType, createProject, freshStart, pickTool } from './helpers';

test('Hilfslinien im Aufmaß: setzen, Messung rastet am Schnittpunkt ein, löschen; im Zeichnen dieselben Linien', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Hilfslinien', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('H-1');
  await page.getByTestId('new-drawing-save').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill('20');
  await page.getByTestId('insert-width').fill('12');
  await page.getByTestId('insert-submit').click();
  await expect(page.locator('[data-element="rect"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // Aufmaß: Hilfslinie gibt es auch hier
  await page.getByTestId('mode-measure').click();
  await page.getByTestId('tool-guide').click();
  await expect(page.getByTestId('guide-bar')).toBeVisible();
  const b = (await page.locator('[data-element="rect"]').first().boundingBox())!;
  // senkrecht bei 40 % der Raumlänge, waagrecht bei 50 % der Raumbreite
  await page.getByTestId('guide-angle-select').selectOption('90');
  await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.25);
  await expect(page.getByTestId('guide-line')).toHaveCount(1);
  await page.getByTestId('guide-angle-select').selectOption('0');
  await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * 0.5);
  await expect(page.getByTestId('guide-line')).toHaveCount(2);
  await page.getByTestId('guide-done').click();
  await expect(page.getByTestId('guide-bar')).toHaveCount(0);
  // Länge von der Oberkante (an der senkrechten Hilfslinie) bis zum Schnittpunkt der beiden Hilfslinien: 12 m × 50 % = 6,00 m
  await chooseMeasureType(page, 'laenge');
  await pickTool(page, 'tool-line');
  await page.mouse.click(b.x + b.width * 0.4 + 3, b.y + 2);
  await page.mouse.click(b.x + b.width * 0.4 - 3, b.y + b.height * 0.5 + 3);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('6,00 m');
  await dlg.getByRole('button', { name: 'Abbrechen' }).click();
  // eine Hilfslinie löschen
  await page.getByTestId('tool-guide').click();
  await page.getByTestId('guide-erase').click();
  await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * 0.5);
  await expect(page.getByTestId('guide-line')).toHaveCount(1);
  await page.getByTestId('guide-done').click();
  // parallel zu zwei Punkten mit Abstand: obere Raumkante als Bezug, 2 m darunter (Abstand im eigenen Feld)
  await page.getByTestId('tool-guide').click();
  await page.getByTestId('guide-angle-select').selectOption('par');
  await expect(page.getByTestId('guide-hint')).toContainText('1. Bezugspunkt');
  await expect(page.getByTestId('guide-dist-input')).toHaveCount(0);
  await page.mouse.click(b.x + 1, b.y + 1);
  await page.mouse.click(b.x + b.width * 0.6, b.y + 1); // zweiter Punkt auf der Oberkante (rechts oben liegt eine Leiste)
  await expect(page.getByTestId('guide-hint')).toContainText('Abstand eintragen');
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.6, { steps: 3 }); // Zeiger unter der Bezugslinie = diese Seite
  await page.getByTestId('guide-dist-input').fill('2');
  await page.getByTestId('guide-dist-input').press('Enter');
  await expect(page.getByTestId('guide-line')).toHaveCount(2);
  await expect(page.getByTestId('guide-dist-input')).toHaveValue(''); // bereit für den nächsten Abstand
  // sie liegt 2 m unter der Oberkante (Raum 12 m hoch) – auf der Seite, auf der der Zeiger stand
  const gy = (await page.locator('[data-testid="guide-line"][data-angle="0"]').boundingBox())!.y;
  expect(Math.abs(gy - (b.y + (b.height * 2) / 12))).toBeLessThan(3);
  await page.getByTestId('guide-done').click();
  // im Zeichnen sind es dieselben Linien
  await page.getByTestId('mode-draw').click();
  await expect(page.getByTestId('guide-line')).toHaveCount(2);
});
