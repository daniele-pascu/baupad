import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { createProject, FIXTURES, freshStart } from './helpers';

/**
 * Bildschirmtastatur am Handy/Tablet: Fenster (Plan umbenennen, Plandetails) rücken darüber – das Eingabefeld
 * liegt nie hinter der Tastatur.
 */

const KB = 336;
async function keyboard(page: Page, h: number) {
  await page.evaluate((kb) => {
    (window as unknown as { __kb: number }).__kb = kb;
    window.visualViewport!.dispatchEvent(new Event('resize'));
  }, h);
}
async function aboveKeyboard(page: Page, sel: ReturnType<Page['locator']>) {
  const vh = page.viewportSize()!.height;
  await expect.poll(async () => { const b = (await sel.boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(vh - KB);
  const b = (await sel.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(0);
}

test('Plan umbenennen und Plandetails: Eingabefeld über der Bildschirmtastatur', async ({ page }) => {
  // nachgestellte Tastatur: der Browser im Test hat keine – visualViewport liefert die Höhe aus window.__kb
  await page.addInitScript(() => {
    const vv = new EventTarget();
    const w = window as unknown as { __kb: number };
    w.__kb = 0;
    Object.defineProperty(vv, 'height', { get: () => window.innerHeight - w.__kb });
    Object.defineProperty(vv, 'offsetTop', { get: () => 0 });
    Object.defineProperty(window, 'visualViewport', { get: () => vv });
  });
  await freshStart(page);
  await createProject(page, 'Tastatur', {}, ['EG']);

  // Planbibliothek: Plan umbenennen
  await page.getByTestId('open-plan-library').click();
  await page.getByTestId('library-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await page.getByTestId('library-pending-ok').click();
  await expect(page.getByTestId('library-file')).toHaveCount(1);
  await page.getByTestId('library-rename').click();
  const prompt = page.getByTestId('prompt-dialog');
  const input = prompt.locator('input');
  await input.focus();
  await keyboard(page, KB);
  await aboveKeyboard(page, input);
  await aboveKeyboard(page, prompt.getByRole('button', { name: 'Speichern' }));
  await input.fill('Parkdeck neu');
  await prompt.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('[data-testid="library-file"][data-file="Parkdeck neu.png"]')).toHaveCount(1);
  await keyboard(page, 0);
  await page.keyboard.press('Escape');

  // Plan anlegen, dann Plandetails (Plannummer ändern)
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('01');
  await page.getByTestId('new-drawing-save').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await page.getByTestId('plan-row').first().getByTestId('plan-actions').click();
  await page.getByTestId('action-edit').click();
  const det = page.getByTestId('plan-details');
  const nr = det.locator('[data-field="planNumber"]');
  await nr.focus();
  await keyboard(page, KB);
  await aboveKeyboard(page, nr);
  await keyboard(page, 0);
});
