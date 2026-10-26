import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, fillMeasures, freshStart, openPlan, OUT, pickTool, planBox, selectCostCenter, tableRows, waitForPlan, waitSaved } from './helpers';

/**
 * Planbibliothek: ein importierter Plan wird für ein neues, leeres Aufmaß wiederverwendet –
 * ohne erneutes Hochladen, ohne Messungen des bisherigen Aufmaßes; die Originaldatei bleibt
 * einmal gespeichert und wird beim Löschen eines Aufmaßes nicht entfernt.
 */

type Rec = { id: string; planNumber?: string; fileId?: string; calibration?: { meters: number; auto?: unknown }; deletedAt: number | null };
async function records(page: Page, store: 'plans' | 'files' | 'blobs'): Promise<Rec[]> {
  return page.evaluate(
    (name) =>
      new Promise((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve(all.result);
          };
        };
      }),
    store,
  );
}
const live = (r: Rec[]) => r.filter((x) => !x.deletedAt);

async function backToList(page: Page) {
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await expect(page.getByTestId('plan-list')).toBeVisible();
}

test('Plan erneut verwenden: neues leeres Aufmaß, Original bleibt, Datei nur einmal gespeichert', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Bibliothek', {}, ['Keller', 'Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.locator('[data-field="planName"]').fill('Grundriss Keller');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await expect(page.getByTestId('scale-detected')).toContainText('1:50');

  // eine Messung im ersten Aufmaß
  const b = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, b.x + b.width * 0.2, b.y + b.height * 0.2, b.x + b.width * 0.35, b.y + b.height * 0.35);
  await fillMeasures(page, '2', '1', '', false);
  await waitSaved(page);
  await backToList(page);

  // Bibliothek: Datei, Verwendung, Suche
  await page.getByTestId('open-plan-library').click();
  const lib = page.getByTestId('plan-library');
  await expect(lib.getByTestId('library-file')).toHaveCount(1);
  await expect(lib.getByTestId('library-file')).toContainText('massketten.pdf');
  await expect(lib.getByTestId('library-usage')).toHaveText('verwendet in 1 Aufmaß');
  await expect(lib.getByTestId('library-view')).toContainText('K-1');
  await expect(lib.getByTestId('library-view')).toContainText('1 Messungen');
  await expect(lib.getByTestId('library-view')).toContainText('kalibriert (automatisch)');
  await lib.getByTestId('library-search').fill('gibtsnicht');
  await expect(lib).toContainText('Kein Plan gefunden');
  await lib.getByTestId('library-search').fill('keller'); // Planbezeichnung
  await expect(lib.getByTestId('library-file')).toHaveCount(1);
  await lib.getByTestId('library-search').fill('massketten'); // Dateiname
  await expect(lib.getByTestId('library-file')).toHaveCount(1);

  // Neues Aufmaß mit diesem Plan
  await lib.getByTestId('library-reuse').click();
  const dlg = page.getByTestId('reuse-plan');
  await expect(dlg.locator('[data-field="planNumber"]')).toHaveValue('K-1-2'); // freie Nummer als Vorschlag
  await expect(dlg.locator('[data-field="planName"]')).toHaveValue('Grundriss Keller');
  await expect(dlg).toContainText('Übernommen: Planunterlage, Kalibrierung');
  await expect(dlg).toContainText('Nicht übernommen: Messungen');
  await dlg.locator('[data-field="planNumber"]').fill('K-1');
  await dlg.getByTestId('reuse-save').click();
  await expect(dlg).toContainText('bereits vergeben'); // eigene Plannummer nötig
  await dlg.locator('[data-field="planNumber"]').fill('K-2');
  await dlg.locator('[data-field="planName"]').fill('Keller Abdichtung');
  await dlg.getByTestId('reuse-cost-center').selectOption({ label: 'Hof' });
  await dlg.getByTestId('reuse-save').click();

  // neues Aufmaß öffnet sich: Plan da, keine Messungen, Kalibrierung übernommen
  await waitForPlan(page);
  await expect(page.locator('.editor-topbar')).toContainText('K-2');
  expect(await tableRows(page)).toEqual([]);
  await waitSaved(page);
  const plans = live(await records(page, 'plans'));
  const k1 = plans.find((p) => p.planNumber === 'K-1')!;
  const k2 = plans.find((p) => p.planNumber === 'K-2')!;
  expect(k2.fileId).toBe(k1.fileId); // gleiche Planquelle
  expect(k2.calibration).toEqual(k1.calibration);
  expect(live(await records(page, 'files'))).toHaveLength(1);
  expect(await records(page, 'blobs')).toHaveLength(1); // Datei nicht doppelt gespeichert

  // Original unverändert mit seiner Messung
  await backToList(page);
  await expect(page.getByTestId('cost-center-title')).toHaveText('Hof'); // neues Aufmaß in der gewählten Kostenstelle
  await selectCostCenter(page, 'Keller');
  await openPlan(page, 'K-1');
  await waitForPlan(page);
  expect((await tableRows(page)).length).toBe(1);
  await backToList(page);

  // auch über das Aktionsmenü des Plans
  await page.getByTestId('plan-row').filter({ hasText: 'K-1' }).getByTestId('plan-actions').click();
  await page.getByTestId('action-reuse').click();
  await expect(page.getByTestId('reuse-plan').locator('[data-field="planNumber"]')).toHaveValue('K-1-2');
  await page.getByTestId('reuse-plan').getByRole('button', { name: 'Abbrechen' }).click();

  // K-1 löschen: Datei bleibt (wird von K-2 verwendet)
  await page.getByTestId('plan-row').filter({ hasText: 'K-1' }).getByTestId('plan-actions').click();
  await page.getByTestId('action-delete').click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('bleibt erhalten');
  await confirm.getByRole('button', { name: 'Plan löschen' }).click();
  await waitSaved(page);
  expect(live(await records(page, 'files'))).toHaveLength(1);
});

test('Letztes Aufmaß gelöscht: Plan bleibt in der Bibliothek, neues Aufmaß ohne Upload, gezielt entfernen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Bibliothek 2', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'farbplan.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('F-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  await backToList(page);

  const remove = async (no: string, text: string) => {
    await page.getByTestId('plan-row').filter({ hasText: no }).getByTestId('plan-actions').click();
    await page.getByTestId('action-delete').click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(text);
    await confirm.getByRole('button', { name: 'Plan löschen' }).click();
    await waitSaved(page);
  };
  await remove('F-1', 'bleibt in der Planbibliothek');
  await expect(page.getByTestId('plan-row')).toHaveCount(0);
  expect(live(await records(page, 'files'))).toHaveLength(1);

  await page.getByTestId('open-plan-library').click();
  const lib = page.getByTestId('plan-library');
  await expect(lib.getByTestId('library-usage')).toHaveText('nicht verwendet');
  await expect(lib.locator('.lib-thumb img')).toBeVisible();
  await page.screenshot({ path: join(OUT, 'plan-bibliothek.png') });
  await lib.getByTestId('library-reuse-page').click();
  const dlg = page.getByTestId('reuse-plan');
  await expect(dlg.locator('[data-field="planNumber"]')).toHaveValue('');
  await dlg.locator('[data-field="planNumber"]').fill('F-2');
  await dlg.getByTestId('reuse-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  const f2 = live(await records(page, 'plans')).find((p) => p.planNumber === 'F-2')!;
  expect(f2.fileId).toBe(live(await records(page, 'files'))[0].id);
  expect(await records(page, 'blobs')).toHaveLength(1);
  await backToList(page);

  // erst wenn kein Aufmaß mehr verweist, lässt sich der Plan aus der Bibliothek entfernen
  await page.getByTestId('open-plan-library').click();
  await expect(lib.getByTestId('library-remove')).toHaveCount(0);
  await lib.getByRole('button', { name: 'Schließen' }).first().click();
  await remove('F-2', 'bleibt in der Planbibliothek');
  await page.getByTestId('open-plan-library').click();
  await lib.getByTestId('library-remove').click();
  await page.getByRole('dialog').filter({ hasText: 'Originalplan entfernen?' }).getByRole('button', { name: 'Entfernen' }).click();
  await waitSaved(page);
  expect(live(await records(page, 'files'))).toHaveLength(0);
  await expect(page.getByTestId('open-plan-library')).toHaveCount(0);
});
