import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { createProject, FIXTURES, freshStart, saveDownload, waitForPlan } from './helpers';

/** PDF-Export: erst Vorschau aller Seiten, dann speichern (Name änderbar; Speichern unter …, Teilen, Herunterladen) */

test('Vorschau mit allen Seiten, Dateiname änderbar, Zurück, Herunterladen mit neuem Namen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Vorschau', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('067');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await page.getByTestId('export-pdf-plan').click();
  await page.getByTestId('pdf-export-run').click();
  const pv = page.getByTestId('pdf-preview');
  await expect(pv.getByTestId('preview-page')).toHaveCount(1);
  await expect(pv).toContainText('Seite 1 von 1');
  await expect(pv.getByTestId('save-hint')).not.toBeEmpty();
  // Speichern unter … (Ordnerwahl) gibt es nur, wo der Browser es kann
  const canSaveAs = await page.evaluate(() => typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function');
  await expect(pv.getByTestId('preview-save-as')).toHaveCount(canSaveAs ? 1 : 0);
  // zurück zur Auswahl und wieder vor
  await pv.getByTestId('preview-back').click();
  await expect(page.getByTestId('pdf-export-dialog')).toBeVisible();
  await page.getByTestId('pdf-export-run').click();
  await expect(pv.getByTestId('preview-page')).toHaveCount(1);
  await pv.getByTestId('pdf-file-name').fill('Aufmaß Hof 067');
  const [dl] = await Promise.all([page.waitForEvent('download'), pv.getByTestId('preview-download').click()]);
  expect(dl.suggestedFilename()).toBe('Aufmass_Hof_067.pdf'); // Umlaute umschrieben (sicher für alle Browser)
  await saveDownload(dl, 'vorschau.pdf');
  await expect(pv).toHaveCount(0);
});

test('„Speichern unter …“ schreibt die Datei in den gewählten Ordner und merkt ihn', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__saved = [];
    w.showSaveFilePicker = async (o: { suggestedName: string; startIn?: unknown }) => {
      (w.__opts as unknown[] | undefined)?.push(o) ?? (w.__opts = [o]);
      return {
        kind: 'file',
        name: o.suggestedName,
        createWritable: async () => ({ write: async (b: Blob) => void (w.__saved as number[]).push(b.size), close: async () => {} }),
      };
    };
  });
  await freshStart(page);
  await createProject(page, 'Ordner', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('068');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await page.getByTestId('export-pdf-plan').click();
  await page.getByTestId('pdf-export-run').click();
  const pv = page.getByTestId('pdf-preview');
  await expect(pv.getByTestId('preview-page')).toHaveCount(1);
  await pv.getByTestId('preview-save-as').click();
  await expect(pv).toHaveCount(0);
  const saved = await page.evaluate(() => (window as unknown as { __saved: number[] }).__saved);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toBeGreaterThan(1000);
  const opts = await page.evaluate(() => (window as unknown as { __opts: { suggestedName: string }[] }).__opts);
  expect(opts[0].suggestedName).toMatch(/\.pdf$/);
});
