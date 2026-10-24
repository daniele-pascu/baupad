import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { FIXTURES, OUT, catchDownload, createProject, drawRect, fillMeasures, freshStart, planBox, saveDownload, waitForPlan, waitSaved } from './helpers';

const pathOf = (page: import('@playwright/test').Page, n: number) =>
  page.evaluate((num) => {
    const labels = [...document.querySelectorAll('.damage-label')];
    const idx = labels.findIndex((l) => l.getAttribute('data-label') === String(num));
    const p = document.querySelectorAll('.viewer-overlay path[data-damage]')[idx] as SVGPathElement;
    const r = p.getBoundingClientRect();
    return { d: p.getAttribute('d')!, fill: p.getAttribute('fill'), x: r.x, y: r.y, w: r.width, h: r.height };
  }, n);

test('Offene Polylinie (Riss) bleibt offen; Schadstellen nachträglich drehen und verschieben', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Formen', {}, ['Wand']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('W-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);

  // 1) Offene Polylinie (Riss): Zickzack von links nach rechts, Enter beendet offen
  await page.getByTestId('tool-polyline').click();
  const x0 = box.x + box.width * 0.15;
  const y0 = box.y + box.height * 0.3;
  for (let i = 0; i <= 8; i++) await page.mouse.click(x0 + i * 36, y0 + (i % 2 ? 14 : 0));
  await expect(page.getByTestId('polygon-bar')).toContainText('9 Punkte');
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg.getByTestId('input-number')).toHaveValue('1');
  // Offene Linie → automatisch Linienmessung (nur Länge, keine Fläche)
  await expect(dlg.getByTestId('kind-line')).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByTestId('input-width')).toHaveCount(0);
  await dlg.getByTestId('input-length').fill('2,9');
  await dlg.getByTestId('input-length').press('Enter');
  await expect(dlg).toBeHidden();
  const crack = await pathOf(page, 1);
  expect(crack.d).not.toContain('Z'); // nicht automatisch geschlossen
  expect(crack.fill).toBe('none'); // keine Fläche
  expect((crack.d.match(/L/g) ?? []).length).toBe(8); // alle 9 Punkte erhalten, keine Schlusskante

  // 2) Rechteck zeichnen
  await page.getByTestId('tool-rect').click();
  await drawRect(page, box.x + box.width * 0.5, box.y + box.height * 0.6, box.x + box.width * 0.7, box.y + box.height * 0.65);
  await fillMeasures(page, '4', '1', '0,05');
  // Im Zeichenmodus bietet die Auswahlleiste „Verschieben / Drehen“ an
  await page.getByTestId('adjust-selected').click();
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('selection-bar')).toContainText('drehen');

  // 3) Über den Dreh-Anfasser um 90° drehen
  const before = await pathOf(page, 2);
  expect(before.w).toBeGreaterThan(before.h * 2);
  const c = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
  const hb = (await page.getByTestId('rotate-handle').boundingBox())!;
  const hp = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const r = Math.hypot(hp.x - c.x, hp.y - c.y);
  await page.mouse.move(hp.x, hp.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) {
    const a = -Math.PI / 2 + (k / 8) * (Math.PI / 2);
    await page.mouse.move(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  }
  await page.mouse.up();
  const rotated = await pathOf(page, 2);
  expect(rotated.h).toBeGreaterThan(rotated.w * 2); // jetzt hochkant
  expect(Math.abs(rotated.x + rotated.w / 2 - c.x)).toBeLessThan(2); // um die Mitte gedreht
  expect(Math.abs(rotated.y + rotated.h / 2 - c.y)).toBeLessThan(2);

  // 4) Verschieben
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x - 80, c.y - 40, { steps: 6 });
  await page.mouse.up();
  const moved = await pathOf(page, 2);
  expect(moved.x).toBeLessThan(rotated.x - 60);
  expect(Math.abs(moved.h - rotated.h)).toBeLessThan(1);
  await waitSaved(page);

  // 5) Nach dem Neuladen bleibt alles erhalten
  await page.reload();
  await waitForPlan(page);
  const reloaded = await pathOf(page, 2);
  expect(reloaded.h).toBeGreaterThan(reloaded.w * 2);
  expect((await pathOf(page, 1)).d).not.toContain('Z');

  // 6) PDF-Export
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'formen.pdf');
  expect(execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' })).toContain('Aufmaßplan W-1');
  execFileSync('pdftoppm', ['-png', '-r', '50', pdf, join(OUT, 'formen')]);
  await page.screenshot({ path: join(OUT, 'formen-ansicht.png') });
});
