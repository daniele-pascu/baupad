import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

/**
 * Phase 1: Kalibrierung importierter Pläne über eine bekannte Strecke, Punktfang (X,
 * Fangmarker, End-/Schnitt-/Mittelpunkte), Zoom auf Auswahl. Messwerte hängen nicht vom Zoom ab
 * und werden durch eine neue Kalibrierung nicht verändert.
 */

type Rec = Record<string, unknown> & { deletedAt: number | null; createdAt: number };
async function stored(page: Page, store: string): Promise<Rec[]> {
  return page.evaluate(
    (name) =>
      new Promise<Rec[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as Rec[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
    store,
  );
}
const scale = async (page: Page) => Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));

async function calibrate(page: Page, x: number, y: number, len: number, meters: string) {
  await pickTool(page, 'tool-calibrate');
  await drawRect(page, x, y, x + len, y);
  const dlg = page.getByTestId('prompt-dialog');
  await dlg.locator('input').fill(meters);
  await dlg.getByRole('button', { name: 'Kalibrieren' }).click();
  await waitSaved(page);
}

test('Importierter Plan: kalibrieren, Maße aus dem Plan, unabhängig vom Zoom; Neukalibrierung ändert keine Messwerte', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Kalibrierung', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');

  // Ohne Kalibrierung: kein Maßvorschlag
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + 60, box.y + 60, box.x + 160, box.y + 110);
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('use-suggestion')).toHaveCount(0);
  await dlg.getByTestId('damage-cancel').click();

  // Kalibrieren: 200 px Strecke = 10 m
  await calibrate(page, box.x + 40, box.y + 200, 200, '10');
  const plan = (await stored(page, 'plans'))[0] as { calibration?: { meters: number } };
  expect(plan.calibration?.meters).toBe(10);
  await pickTool(page, 'tool-calibrate');
  await expect(page.getByTestId('calibration-info')).toContainText('10,00 m');
  await expect(page.getByTestId('calibration-line')).toBeVisible();

  // 100 × 50 px → 5,00 × 2,50 m
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + 60, box.y + 60, box.x + 160, box.y + 110);
  await expect(dlg.getByTestId('use-suggestion')).toContainText('5,00 × 2,50 m');
  await dlg.getByTestId('use-suggestion').click();
  await expect(dlg.getByTestId('area-result')).toContainText('12,50 m²');
  await dlg.getByTestId('damage-save').click();
  await expect(page.getByTestId('measure-check')).toContainText('5,00 × 2,50 m');

  // Vergrößert: 100 px sind jetzt nur noch halb so viel – der Vorschlag rechnet in Planeinheiten
  const s0 = await scale(page);
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  await expect.poll(() => scale(page)).toBeGreaterThan(s0 * 1.2);
  const f = (await scale(page)) / s0;
  const b2 = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, b2.x + 400, b2.y + 300, b2.x + 500, b2.y + 350);
  const exp = (v: number) => (v / f).toFixed(2).replace('.', ',');
  await expect(dlg.getByTestId('use-suggestion')).toContainText(`${exp(5)} × ${exp(2.5)} m`);
  await dlg.getByTestId('damage-cancel').click();
  await page.getByTestId('plan-viewer').hover();
  await page.keyboard.press('0'); // ganzer Plan

  // Neu kalibrieren (20 m): gespeicherte Messung bleibt 5 × 2,5 m, wird aber als abweichend markiert
  await calibrate(page, box.x + 40, box.y + 200, 200, '20');
  const d = (await stored(page, 'damages'))[0];
  expect([d.length, d.width, d.area]).toEqual([5, 2.5, 12.5]);
  await pickTool(page, 'tool-select');
  await page.mouse.click(box.x + 110, box.y + 85);
  await expect(page.getByTestId('measure-check')).toContainText('Maße prüfen');

  // Zoom auf Auswahl
  const before = await scale(page);
  await page.getByTestId('zoom-selection').click();
  await expect.poll(() => scale(page)).toBeGreaterThan(before * 1.5);

  // Nach dem Neuladen erhalten
  await page.reload();
  await waitForPlan(page);
  await pickTool(page, 'tool-calibrate');
  await expect(page.getByTestId('calibration-info')).toContainText('20,00 m');
});

test('Punktfang: Marker an Ecke und Schnittpunkt, X schaltet aus/ein', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Fang', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('F-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  await expect(page.getByTestId('snap-toggle-measure')).toHaveAttribute('aria-pressed', 'true');

  // Rechteck und eine Linie quer darüber
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + 100, box.y + 100, box.x + 300, box.y + 200);
  await dlg.getByTestId('input-length').fill('1');
  await dlg.getByTestId('damage-save').click();
  await pickTool(page, 'tool-line');
  await drawRect(page, box.x + 200, box.y + 60, box.x + 200, box.y + 260);
  await dlg.getByTestId('input-length').fill('1');
  await dlg.getByTestId('damage-save').click();

  // Neues Rechteck: Maus nahe der Ecke → Marker „Endpunkt“, Start rastet genau auf der Ecke ein
  await pickTool(page, 'tool-rect');
  await page.mouse.move(box.x + 303, box.y + 203);
  const marker = page.getByTestId('snap-marker');
  await expect(marker).toHaveAttribute('data-kind', 'end');
  await expect(marker).toContainText('Endpunkt');
  // nahe der Kreuzung Linie/Oberkante → Schnittpunkt
  await page.mouse.move(box.x + 203, box.y + 102);
  await expect(marker).toHaveAttribute('data-kind', 'intersection');
  await drawRect(page, box.x + 303, box.y + 203, box.x + 380, box.y + 260);
  await dlg.getByTestId('input-length').fill('1');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const ds = await stored(page, 'damages');
  const r0 = ds[0].shape as { x: number; y: number; w: number; h: number };
  const r2 = ds[2].shape as { x: number; y: number };
  expect(r2.x).toBeCloseTo(r0.x + r0.w, 6); // genau auf der Ecke, unabhängig von Pixeln
  expect(r2.y).toBeCloseTo(r0.y + r0.h, 6);

  // Umschalt+X schaltet den Fang aus → kein Marker, Punkte frei
  await pickTool(page, 'tool-rect');
  await page.getByTestId('plan-viewer').hover({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+X');
  await expect(page.getByTestId('snap-toggle-measure')).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(box.x + 302, box.y + 202);
  await expect(marker).toHaveCount(0);
  await page.keyboard.press('Shift+X');
  await expect(page.getByTestId('snap-toggle-measure')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'tests/output/punktfang.png' });
});
