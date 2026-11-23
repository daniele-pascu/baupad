import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, FIXTURES, freshStart, pickTool, planBox, saveDownload, waitForPlan, waitSaved } from './helpers';

/**
 * Textfeld wie in der Textverarbeitung: Absätze, Schriftgröße in pt, im Plan ziehen – Seite = Breite (Text bricht um),
 * Ecke = größer/kleiner. Im Zeichenmodus und im Aufmaß, im PDF.
 */

type El = { id: string; type: string; text?: string; wrap?: number; shape: { x: number; y: number; w: number; h: number } };
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
const LINE = 1.35;
/** Schrifthöhe aus Gesamthöhe und Zeilenzahl */
const fsOf = (h: number, lines: number) => h / (1 + (lines - 1) * LINE);
const mid = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('Plan zeichnen: Absätze, Schriftgröße in pt, Seite ziehen bricht um, Ecke ziehen skaliert; im PDF', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Textfeld', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('TA-1');
  await nd.getByTestId('new-drawing-save').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  await pickTool(page, 'draw-text');
  await page.mouse.click(sb.x + sb.width * 0.3, sb.y + sb.height * 0.3);
  const td = page.getByTestId('text-dialog');
  await td.getByTestId('text-input').fill('Riss prüfen\nund melden bis Freitag');
  await td.getByTestId('text-size').fill('24');
  // Formatleiste wie in der Textverarbeitung: unterstrichen, zentriert
  await td.getByTestId('font-underline').click();
  await td.getByTestId('text-align-center').click();
  await expect(td.getByTestId('text-align-center')).toHaveAttribute('aria-pressed', 'true');
  await expect(td.getByTestId('text-preview')).toHaveCSS('text-align', 'center');
  await td.getByRole('button', { name: 'Einfügen' }).click();
  const t = page.locator('[data-element="text"] text');
  await expect(t).toHaveAttribute('data-lines', '2');
  await expect(t).toHaveAttribute('data-underline', '1');
  await expect(t).toHaveAttribute('data-align', 'center');
  await expect(t).toHaveAttribute('text-anchor', 'middle');
  await expect(t.locator('tspan')).toHaveText(['Riss prüfen', 'und melden bis Freitag']);
  await waitSaved(page);
  let [el] = await texts(page);
  expect(el.text).toBe('Riss prüfen\nund melden bis Freitag');
  expect(el.wrap).toBeUndefined();
  const fs0 = fsOf(el.shape.h, 2);
  // 24 pt auf dem Papier beim Planmaßstab (A3, 1:100): 24 × 0,3528 mm × 100
  expect(fs0).toBeCloseTo((24 * 0.352778 * 100) / 1000, 2);

  // Seite (rechts) nach links ziehen: feste Breite, der Text bricht um, die Schrift bleibt gleich groß
  const e0 = await mid(page, 'rect.handle[data-handle="e"]');
  const w0 = (await mid(page, 'rect.handle[data-handle="w"]')).x;
  await drag(page, e0, { x: w0 + (e0.x - w0) * 0.45, y: e0.y });
  await expect.poll(async () => Number(await t.getAttribute('data-lines'))).toBeGreaterThan(2);
  await waitSaved(page);
  [el] = await texts(page);
  expect(el.wrap).toBeGreaterThan(2);
  const lines1 = Number(await t.getAttribute('data-lines'));
  expect(fsOf(el.shape.h, lines1)).toBeCloseTo(fs0, 3);
  expect(el.shape.w).toBeCloseTo(el.wrap! * fs0, 2);

  // Ecke nach außen ziehen: alles gleichmäßig größer, der Umbruch bleibt
  const se = await mid(page, 'rect.handle[data-handle="se"]');
  await drag(page, se, { x: se.x + 60, y: se.y + 60 });
  await waitSaved(page);
  const [big] = await texts(page);
  expect(Number(await t.getAttribute('data-lines'))).toBe(lines1);
  expect(fsOf(big.shape.h, lines1)).toBeGreaterThan(fs0 * 1.1);
  expect(big.wrap).toBeCloseTo(el.wrap!, 3);

  // Leiste: Text mit Absätzen wird im Text-Fenster bearbeitet – Schriftgröße 12 pt
  const bar = page.getByTestId('element-bar');
  await expect(bar.getByTestId('element-text')).toHaveValue('Riss prüfen ⏎ und melden bis Freitag');
  await bar.getByTestId('element-text-edit').click();
  await expect(td.getByTestId('text-input')).toHaveValue('Riss prüfen\nund melden bis Freitag');
  await td.getByTestId('text-size').fill('12');
  await td.getByTestId('text-save').click();
  await waitSaved(page);
  const [small] = await texts(page);
  expect(fsOf(small.shape.h, Number(await t.getAttribute('data-lines')))).toBeCloseTo((12 * 0.352778 * 100) / 1000, 2);

  // Leiste des markierten Textes: dieselbe Formatleiste wie im Text-Fenster – Schriftgrad in pt, vergrößern/verkleinern
  await expect(bar.getByTestId('text-format-bar')).toBeVisible();
  await expect(bar.getByTestId('element-textHeight')).toHaveCount(0);
  await expect(bar.getByTestId('text-size')).toHaveValue('12');
  // vergrößern: von 10 bis 16 in ganzen Punkten, bis 24 in 2er-, darüber in 4er-Schritten; ohne Kommastellen
  await bar.getByTestId('text-bigger').click();
  await expect(bar.getByTestId('text-size')).toHaveValue('13');
  await waitSaved(page);
  const [p13] = await texts(page);
  expect(fsOf(p13.shape.h, Number(await t.getAttribute('data-lines')))).toBeCloseTo((13 * 0.352778 * 100) / 1000, 2);
  for (const want of ['14', '15', '16', '18', '20', '22', '24', '28', '32']) {
    await bar.getByTestId('text-bigger').click();
    await expect(bar.getByTestId('text-size')).toHaveValue(want);
  }
  await bar.getByTestId('text-smaller').click();
  await expect(bar.getByTestId('text-size')).toHaveValue('28');
  // selbst eintippen: Feld anklicken (alles markiert), Zahl tippen, Enter – ab 10 pt ohne Kommastellen
  await bar.getByTestId('text-size').click();
  await page.keyboard.type('17,6');
  await page.keyboard.press('Enter');
  await expect(bar.getByTestId('text-size')).toHaveValue('18');
  await bar.getByTestId('text-size').click();
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await expect(bar.getByTestId('text-size')).toHaveValue('9');
  // unter 10 pt in halben Punkten
  await bar.getByTestId('text-smaller').click();
  await expect(bar.getByTestId('text-size')).toHaveValue('8,5');
  await bar.getByTestId('text-bigger').click();
  await expect(bar.getByTestId('text-size')).toHaveValue('9');
  await waitSaved(page);
  const [p9] = await texts(page);
  expect(fsOf(p9.shape.h, Number(await t.getAttribute('data-lines')))).toBeCloseTo((9 * 0.352778 * 100) / 1000, 2);
  await bar.getByTestId('font-underline').click(); // unterstrichen aus
  await expect(t).not.toHaveAttribute('data-underline', '1');

  // PDF: alle Zeilen
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'textfeld-absatz.pdf');
  const out = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  expect(out).toContain('Riss');
  expect(out).toContain('Freitag');
  execFileSync('pdftoppm', ['-png', '-r', '80', '-singlefile', pdf, join('tests', 'output', 'textfeld-absatz')]);
});

test('Aufmaß auf importiertem Plan: Text mit Absatz; Anfasser – Ecke skaliert, Seite bricht um', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Textfeld Aufmaß', {}, ['EG']);
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
  await td.getByTestId('text-input').fill('Achse A\nNordseite');
  // Schriftgröße bezieht sich auf das Blatt: Vorgabe 10 pt
  await expect(td.getByTestId('text-size')).toHaveValue('10');
  await td.getByRole('button', { name: 'Einfügen' }).click();
  const t = page.locator('[data-element="text"] text');
  await expect(t).toHaveAttribute('data-lines', '2');
  await waitSaved(page);
  const [a] = await texts(page);
  // 10 pt auf dem Blatt (A3, der Plan füllt es): Schrifthöhe ≈ 3,5 mm von 297 mm Blatthöhe – also klein gegenüber dem Plan
  const tbox = (await t.boundingBox())!;
  expect(tbox.height / box.height).toBeLessThan(0.06);
  expect(tbox.height / box.height).toBeGreaterThan(0.012);
  // antippen öffnet das Text-Fenster; danach zeigt der Text Rahmen und Anfasser
  await expect(page.getByTestId('note-handles')).toHaveCount(0);
  const tb = (await t.boundingBox())!;
  await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await expect(td).toBeVisible();
  await td.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('note-handles')).toBeVisible();
  // Ecke nach außen: größer
  const se = await mid(page, '[data-testid="note-handle-se"]');
  await drag(page, se, { x: se.x + 50, y: se.y + 50 });
  await waitSaved(page);
  const [b] = await texts(page);
  expect(b.shape.h).toBeGreaterThan(a.shape.h * 1.1);
  expect(b.wrap).toBeUndefined();
  await expect(t).toHaveAttribute('data-lines', '2');
  await expect(page.getByTestId('text-dialog')).toHaveCount(0);
  // Seite nach links: schmäler, der Text bricht um, Schrift bleibt
  const e1 = await mid(page, '[data-testid="note-handle-e"]');
  const w1 = (await mid(page, '[data-testid="note-handle-w"]')).x;
  await drag(page, e1, { x: w1 + (e1.x - w1) * 0.5, y: e1.y });
  await expect.poll(async () => Number(await t.getAttribute('data-lines'))).toBeGreaterThan(2);
  await waitSaved(page);
  const [c] = await texts(page);
  expect(c.wrap).toBeGreaterThan(1.9);
  expect(fsOf(c.shape.h, Number(await t.getAttribute('data-lines')))).toBeCloseTo(fsOf(b.shape.h, 2), 3);
  // woanders tippen: Anfasser weg
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expect(page.getByTestId('note-handles')).toHaveCount(0);

  // Linie zum Plan im Text-Fenster einschalten (Punkt): Ende im Plan ziehen; Text verschieben – das Ende bleibt
  const tb3 = (await t.boundingBox())!;
  await page.mouse.click(tb3.x + tb3.width / 2, tb3.y + tb3.height / 2);
  await td.getByTestId('text-leader-dot').click();
  await td.getByTestId('text-save').click();
  await expect(page.getByTestId('callout-dot')).toHaveCount(1);
  const tip0 = await mid(page, '[data-testid="note-tip"]');
  await drag(page, tip0, { x: tip0.x + 30, y: tip0.y + 60 });
  await expect.poll(async () => (await mid(page, '[data-testid="note-tip"]')).y).toBeGreaterThan(tip0.y + 40);
  await waitSaved(page);
  const tip1 = await mid(page, '[data-testid="note-tip"]');
  const tb4 = (await t.boundingBox())!;
  await drag(page, { x: tb4.x + tb4.width / 2, y: tb4.y + tb4.height / 2 }, { x: tb4.x + tb4.width / 2 + 90, y: tb4.y + tb4.height / 2 - 30 });
  await expect.poll(async () => (await t.boundingBox())!.x).toBeGreaterThan(tb4.x + 60);
  await waitSaved(page);
  const tip2 = await mid(page, '[data-testid="note-tip"]');
  expect(Math.hypot(tip2.x - tip1.x, tip2.y - tip1.y)).toBeLessThan(2);
  await expect(page.getByTestId('text-dialog')).toHaveCount(0);
});
