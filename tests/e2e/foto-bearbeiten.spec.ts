import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { catchDownload, FIXTURES, freshStart, OUT } from './helpers';

type Rec = Record<string, unknown> & { deletedAt: number | null; createdAt: number };
const photos = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Rec[]>((res) => {
        const r = indexedDB.open('schadstellen-aufmass');
        r.onsuccess = () => {
          const g = r.result.transaction('photos').objectStore('photos').getAll();
          g.onsuccess = () => {
            r.result.close();
            res((g.result as Rec[]).filter((p) => !p.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );

async function sitePhoto(page: Page) {
  await freshStart(page);
  await page.goto('./#/fotos');
  await page.getByTestId('photo-new-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-new').click();
  await page.getByTestId('project-name').fill('Parkring');
  await page.getByTestId('project-save').click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Parkring');
  await page.getByTestId('photo-file-input').setInputFiles(join(FIXTURES, 'foto.jpg'));
  await page.getByTestId('photo-save-dialog').getByTestId('photo-save').click();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(1);
}

test('Foto bearbeiten: Freihand, Polylinie, Rechteck, Kreis, Darstellung, Rückgängig – als Kopie gespeichert', async ({ page }) => {
  await sitePhoto(page);
  await page.getByTestId('photo-thumb').first().click();
  await page.getByTestId('lightbox-edit').click();
  const ed = page.getByTestId('photo-editor');
  await expect(ed).toBeVisible();
  const cv = ed.getByTestId('pe-canvas');
  await expect(page.locator('[data-testid="pe-canvas"] image')).toHaveCount(1);
  const img = (await page.locator('[data-testid="pe-canvas"] image').boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: img.x + img.width * fx, y: img.y + img.height * fy });
  const dragTo = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 + 10, { steps: 5 });
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  // Freihand (Standard)
  await dragTo(at(0.1, 0.1), at(0.3, 0.2));
  await expect(cv).toHaveAttribute('data-marks', '1');
  // Rechteck blau, ausgefüllt, 50 %
  await ed.getByTestId('pe-tool-rect').click();
  await ed.locator('[data-testid="pe-color"][data-color="#1c7ed6"]').click();
  await ed.getByTestId('pe-fill').selectOption('1');
  await ed.getByTestId('pe-opacity').fill('50');
  await ed.getByTestId('pe-dash').selectOption('dashed');
  await dragTo(at(0.4, 0.4), at(0.6, 0.6));
  await expect(cv).toHaveAttribute('data-marks', '2');
  // Kreis
  await ed.getByTestId('pe-tool-ellipse').click();
  await dragTo(at(0.7, 0.1), at(0.9, 0.3));
  await expect(cv).toHaveAttribute('data-marks', '3');
  // Polylinie: drei Punkte, schließen; danach wieder öffnen
  await ed.getByTestId('pe-tool-poly').click();
  for (const p of [at(0.1, 0.7), at(0.3, 0.9), at(0.2, 0.6)]) await page.mouse.click(p.x, p.y);
  await expect(ed.getByTestId('pe-polybar')).toContainText('3 Punkte');
  await ed.getByTestId('pe-poly-close').click();
  await expect(cv).toHaveAttribute('data-marks', '4');
  await expect(ed.getByTestId('pe-toggle-closed')).toContainText('Geschlossen');
  await ed.getByTestId('pe-toggle-closed').click();
  await expect(ed.getByTestId('pe-toggle-closed')).toContainText('Offen');
  // Rückgängig / Wiederholen
  await ed.getByTestId('pe-undo').click(); // wieder geschlossen
  await ed.getByTestId('pe-undo').click(); // Polylinie weg
  await expect(cv).toHaveAttribute('data-marks', '3');
  await ed.getByTestId('pe-redo').click();
  await expect(cv).toHaveAttribute('data-marks', '4');
  // Auswahl: Kreis antippen und löschen
  await ed.getByTestId('pe-tool-select').click();
  const c = at(0.9, 0.2);
  await page.mouse.click(c.x, c.y);
  await expect(ed.getByTestId('pe-delete')).toBeVisible();
  await ed.getByTestId('pe-delete').click();
  await expect(cv).toHaveAttribute('data-marks', '3');
  await page.screenshot({ path: join(OUT, 'foto-bearbeiten.png') });
  // als Kopie speichern: Original bleibt, Kopie mit „_bearbeitet“
  const before = await photos(page);
  await ed.getByTestId('pe-save').click();
  await expect(ed).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'als Kopie gespeichert' })).toHaveCount(1);
  const after = await photos(page);
  expect(after).toHaveLength(2);
  expect(after[0].hash).toBe(before[0].hash);
  expect(after[1].hash).not.toBe(before[0].hash);
  expect(after[1].fileName).toMatch(/^Parkring_\d{4}-\d{2}-\d{2}_\d{4}_bearbeitet\.jpg$/);
  expect(after[1].day).toBe(after[0].day);
  // Großansicht zeigt die Kopie; Herunterladen mit Baustelle, Datum und „_bearbeitet“
  await expect(page.getByTestId('lightbox')).toBeVisible();
  const dl = await catchDownload(page, () => page.getByTestId('lightbox-download').click());
  expect(dl.suggestedFilename()).toMatch(/^Parkring_\d{4}-\d{2}-\d{2}_\d{4}_bearbeitet\.jpg$/);
  // Farbe wird gemerkt
  await page.getByTestId('lightbox-edit').click();
  await expect(page.locator('[data-testid="pe-color"][data-color="#1c7ed6"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('pe-fill')).toHaveValue('1');
  await page.getByTestId('pe-cancel').click();
  await expect(page.getByTestId('photo-editor')).toHaveCount(0);
});
