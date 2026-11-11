import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, FIXTURES, freshStart, pickTool, planBox, saveDownload, waitForPlan, waitSaved } from './helpers';

/** Textfeld im Plan: Farbe, Schriftart, fett, kursiv – im Zeichenmodus und im Aufmaß (auch importierte Pläne), im PDF. */

type El = { id: string; type: string; text?: string; color: string; font?: { family?: string; bold?: boolean; italic?: boolean }; shape: { x: number; y: number; w: number; h: number } };
async function texts(page: Page): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null; createdAt: number })[]).filter((d) => !d.deletedAt && d.type === 'text').sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}

test('Plan zeichnen: Text mit Schriftart, fett, kursiv und Farbe; in der Leiste änderbar', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Text', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('T-1');
  await nd.getByTestId('new-drawing-save').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  await pickTool(page, 'draw-text');
  await page.mouse.click(sb.x + sb.width * 0.4, sb.y + sb.height * 0.3);
  const td = page.getByTestId('text-dialog');
  await td.getByTestId('text-input').fill('Stiege 1');
  await td.getByTestId('font-family').selectOption('serif');
  await td.getByTestId('font-bold').click();
  await td.getByTestId('font-italic').click();
  await td.getByTestId('text-color-Rot').click();
  await expect(td.getByTestId('text-preview')).toHaveCSS('font-style', 'italic');
  await td.getByRole('button', { name: 'Einfügen' }).click();
  const t = page.locator('[data-element="text"] text');
  await expect(t).toHaveText('Stiege 1');
  await expect(t).toHaveAttribute('data-font', 'serif');
  await expect(t).toHaveAttribute('data-bold', '1');
  await expect(t).toHaveAttribute('data-italic', '1');
  await expect(t).toHaveCSS('font-weight', '700');
  await waitSaved(page);
  let [el] = await texts(page);
  expect(el.color).toBe('#e03131');
  expect(el.font).toEqual({ family: 'serif', bold: true, italic: true });
  // ausgewählter Text: Schrift in der Leiste ändern
  const bar = page.getByTestId('element-bar');
  await bar.getByTestId('font-family').selectOption('mono');
  await bar.getByTestId('font-italic').click();
  await bar.getByTestId('text-color-Blau').click();
  await waitSaved(page);
  [el] = await texts(page);
  expect(el.font).toEqual({ family: 'mono', bold: true });
  expect(el.color).toBe('#1c7ed6');
  await expect(t).toHaveAttribute('data-font', 'mono');
  // nächster Text übernimmt die zuletzt gewählte Schrift
  await page.keyboard.press('Escape');
  await pickTool(page, 'draw-text');
  await page.mouse.click(sb.x + sb.width * 0.4, sb.y + sb.height * 0.6);
  await expect(td.getByTestId('font-family')).toHaveValue('mono');
  await expect(td.getByTestId('font-bold')).toHaveAttribute('aria-pressed', 'true');
  await td.getByRole('button', { name: 'Abbrechen' }).click();
});

test('Aufmaß auf importiertem Plan: Text einfügen, verschieben, bearbeiten, im PDF mit Schrift', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Text Aufmaß', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('P-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  await pickTool(page, 'tool-text');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  const td = page.getByTestId('text-dialog');
  await td.getByTestId('text-input').fill('Achse A');
  await td.getByTestId('font-family').selectOption('serif');
  await td.getByTestId('font-bold').click();
  await td.getByTestId('font-italic').click();
  await td.getByRole('button', { name: 'Einfügen' }).click();
  await expect(td).toHaveCount(0);
  const t = page.locator('[data-element="text"] text');
  await expect(t).toHaveText('Achse A');
  // kein Messdialog, Werkzeug zurück auf Auswahl
  await expect(page.getByTestId('damage-dialog')).toHaveCount(0);
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  await waitSaved(page);
  const [a] = await texts(page);

  // ziehen = verschieben
  const tb = (await t.boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2 + 80, tb.y + tb.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await waitSaved(page);
  const [b] = await texts(page);
  expect(b.shape.x).toBeGreaterThan(a.shape.x);
  expect(b.shape.y).toBeGreaterThan(a.shape.y);
  await expect(page.getByTestId('text-dialog')).toHaveCount(0);
  await expect(page.getByTestId('damage-dialog')).toHaveCount(0);

  // antippen = bearbeiten (Text, größer)
  const tb2 = (await t.boundingBox())!;
  await page.mouse.click(tb2.x + tb2.width / 2, tb2.y + tb2.height / 2);
  await expect(td).toBeVisible();
  await expect(td.getByTestId('text-input')).toHaveValue('Achse A');
  await td.getByTestId('text-input').fill('Achse B');
  await td.getByTestId('text-bigger').click();
  await td.getByTestId('text-save').click();
  await expect(t).toHaveText('Achse B');
  await waitSaved(page);
  const [c] = await texts(page);
  expect(c.shape.h).toBeCloseTo(b.shape.h * 1.25, 3);

  // PDF: Text mit Times fett kursiv
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'textfeld.pdf');
  expect(execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' })).toContain('Achse B');
  expect(execFileSync('pdffonts', [pdf], { encoding: 'utf8' })).toContain('Times-BoldItalic');

  // löschen
  const tb3 = (await t.boundingBox())!;
  await page.mouse.click(tb3.x + tb3.width / 2, tb3.y + tb3.height / 2);
  await td.getByTestId('text-delete').click();
  await expect(t).toHaveCount(0);
  await waitSaved(page);
  expect(await texts(page)).toHaveLength(0);
});
