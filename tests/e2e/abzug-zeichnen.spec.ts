import { expect, test } from './fixtures';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

test('Abzug im Plan zeichnen: Maße werden aus dem Plan erkannt, nummeriert und schraffiert angezeigt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Abzüge', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('page-tile').nth(1).click();
  await wiz.getByTestId('pages-next').click();
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('AB-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  // Maßstab ist erkannt (1:100) → Flächen aus dem Plan
  const confirm = page.getByTestId('scale-confirm');
  if (await confirm.isVisible()) await confirm.click();
  const box = await planBox(page);
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  await pickTool(page, 'tool-rect');
  await drawRect(page, ...at(0.3, 0.3), ...at(0.6, 0.6));
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  // Fläche aus dem Plan übernehmen
  const geo = dlg.getByTestId('use-geometry').first();
  if ((await geo.getAttribute('aria-pressed')) !== 'true') await geo.click();
  // Abzug im Plan zeichnen: Fenster blendet sich aus, Hinweis oben
  await dlg.getByTestId('deduction-draw').click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('ded-draw-bar')).toBeVisible();
  await drawRect(page, ...at(0.4, 0.4), ...at(0.45, 0.5));
  // zurück im Fenster: Zeile „Abzug 1“ mit erkannten Maßen
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId('ded-draw-bar')).toHaveCount(0);
  const row = dlg.getByTestId('deduction-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('deduction-label')).toHaveValue('Abzug 1');
  const l = Number((await row.getByTestId('deduction-length').inputValue()).replace(',', '.'));
  const w = Number((await row.getByTestId('deduction-width').inputValue()).replace(',', '.'));
  expect(l).toBeGreaterThan(0);
  expect(w).toBeGreaterThan(l); // höher als breit gezogen
  await expect(page.getByTestId('ded-shape')).toHaveCount(1);
  // zweiter Abzug → „Abzug 2“
  await dlg.getByTestId('deduction-draw').click();
  await drawRect(page, ...at(0.5, 0.35), ...at(0.55, 0.4));
  await expect(dlg.getByTestId('deduction-row')).toHaveCount(2);
  await expect(dlg.getByTestId('deduction-row').nth(1).getByTestId('deduction-label')).toHaveValue('Abzug 2');
  await expect(dlg.getByTestId('deduction-sum')).toContainText('netto');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await waitSaved(page);
  // gespeichert: im Plan schraffiert mit Nummer der Messung
  await expect(page.getByTestId('ded-shape')).toHaveCount(2);
  await expect(page.getByTestId('ded-overlay').locator('text')).toHaveText(['1-A1', '1-A2']);
  // Nummer verschieben (wie bei allen Formen), bleibt gespeichert
  const lbl = page.getByTestId('ded-label').first();
  const lb = (await lbl.boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width / 2 + 60, lb.y + lb.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await lbl.boundingBox())!.x).toBeGreaterThan(lb.x + 40);
  // kein Zeichnen/keine neue Messung beim Ziehen der Nummer
  await expect(page.getByTestId('damage-dialog')).toHaveCount(0);
  await waitSaved(page);
  const moved = (await lbl.boundingBox())!;
  await page.reload();
  await waitForPlan(page);
  await expect(page.getByTestId('ded-shape')).toHaveCount(2);
  const after = (await page.getByTestId('ded-label').first().boundingBox())!;
  expect(Math.abs(after.x - moved.x)).toBeLessThan(4);
});

test('Fläche mit vielen Punkten: Knicke erscheinen als Anfasser und lassen sich ziehen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Knicke', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const cx = box.x + box.width * 0.45;
  const cy = box.y + box.height * 0.45;
  const R = Math.min(box.width, box.height) * 0.32;
  // Fläche mit vielen Eckpunkten (Werkzeug „Fläche“): Stern mit 6 Zacken aus 48 Punkten
  await pickTool(page, 'tool-polygon');
  const N = 48;
  const at = (i: number) => {
    const a = (i / N) * Math.PI * 2;
    const r = R * (0.6 + 0.4 * Math.abs(((i * 6) / N) % 1 - 0.5) * 2);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  for (let i = 0; i < N; i++) {
    await page.mouse.click(...at(i));
    await page.waitForTimeout(380); // kein Doppelklick (der würde die Fläche beenden)
  }
  // letzter Punkt liegt nah am ersten → Fläche schließt sich selbst; sonst „Fertig“
  if (!(await page.getByTestId('damage-dialog').isVisible())) await page.getByTestId('polygon-finish').click();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('input-width').fill('2');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  // Fläche auswählen → Knicke als Anfasser (früher bei über 40 Punkten gar keine)
  await page.mouse.click(cx, cy);
  const handles = page.locator('[data-testid^="vertex-"]');
  await expect.poll(() => handles.count()).toBeGreaterThanOrEqual(6);
  expect(await handles.count()).toBeLessThan(200);
  const before = await page.locator('path[data-damage]').first().getAttribute('d');
  const hb = (await handles.first().boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.locator('path[data-damage]').first().getAttribute('d')).not.toBe(before);
});
