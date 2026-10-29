import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, fillMeasures, freshStart, pickTool, planBox, saveDownload, waitForPlan, waitSaved } from './helpers';

/**
 * Paket L: Darstellung je Objekt – Linientyp, Linienstärke, Linienfarbe; bei geschlossenen
 * Formen Füllfarbe, Transparenz und „Keine Füllung“. Nur Darstellung: Geometrie und
 * Messwerte bleiben unverändert; Anzeige im Arbeitsbereich und im PDF.
 */

type Rec = Record<string, unknown> & { deletedAt: number | null; createdAt: number; style?: Record<string, unknown>; shape: unknown };
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

/** Alle Inhaltsströme des PDFs entpackt (zum Prüfen von Strichmustern und Transparenz) */
function pdfOps(pdf: string): string {
  return execFileSync(
    'python3',
    [
      '-c',
      `
import re, sys, zlib
data = open(sys.argv[1], 'rb').read()
out = []
# Länge aus dem Strom-Wörterbuch (ein Suchmuster bis „endstream“ schneidet Ströme ab, die auf \\r enden)
for m in re.finditer(rb'/Length (\\d+)(?![\\d ]*R)[^>]*>>\\s*stream\\r?\\n', data):
    raw = data[m.end():m.end() + int(m.group(1))]
    try:
        out.append(zlib.decompress(raw).decode('latin-1'))
    except Exception:
        out.append(raw.decode('latin-1'))
# ExtGState-Objekte (Transparenz) stehen außerhalb der Ströme
out.append(data.decode('latin-1'))
print('\\n'.join(out))`,
      pdf,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

async function setRange(page: Page, testId: string, value: string) {
  const r = page.getByTestId(testId);
  await r.fill(value);
  await r.blur(); // beim Loslassen gespeichert
}

test('Importierter Plan: Umrandung und Füllung je Messung, gespeichert und im PDF', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Darstellung', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('D-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);

  // Fläche (Rechteck) und Linie zeichnen
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.2, box.x + box.width * 0.4, box.y + box.height * 0.4);
  await fillMeasures(page, '4', '2,5', '', false);
  await pickTool(page, 'tool-line');
  await drawRect(page, box.x + box.width * 0.5, box.y + box.height * 0.3, box.x + box.width * 0.75, box.y + box.height * 0.32);
  const dlg = page.getByTestId('damage-dialog');
  await dlg.getByTestId('input-length').fill('6');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const [rect0, line0] = await stored(page, 'damages');

  // Linie (ausgewählt): nur Linientyp, Stärke, Farbe – keine Füllung
  await page.getByTestId('style-toggle').click();
  const panel = page.getByTestId('style-panel');
  await expect(panel.getByTestId('style-no-fill')).toHaveCount(0);
  await panel.getByTestId('style-line-type').selectOption('zigzag');
  await setRange(page, 'style-line-width', '3');
  await panel.getByRole('button', { name: 'Farbe Blau' }).click();
  await expect(page.locator(`path[data-damage="${line0.id}"]`)).toHaveAttribute('data-line-type', 'zigzag');
  await waitSaved(page);
  let line = (await stored(page, 'damages'))[1];
  expect(line.style).toMatchObject({ lineType: 'zigzag', lineWidth: 3 });
  expect(line.color).toBe('#1c7ed6');
  expect(line.shape).toEqual(line0.shape); // Geometrie unverändert
  expect(line.length).toBe(6);

  // Rechteck auswählen: Umrandung gestrichelt, Füllung grün 50 %, dann „Keine Füllung“
  await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
  await pickTool(page, 'tool-select');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.getByTestId('selection-bar')).toContainText('Nr. 1');
  // Das Darstellungsfeld bleibt beim Wechsel der Auswahl geöffnet
  await expect(panel).toBeVisible();
  await panel.getByTestId('style-line-type').selectOption('dashed');
  await panel.getByRole('button', { name: 'Füllfarbe Grün' }).click();
  await setRange(page, 'style-fill-transparency', '50');
  const path = page.locator(`path[data-damage="${rect0.id}"]`);
  await expect(path).toHaveAttribute('stroke-dasharray', /\d/);
  const fill = page.locator(`g:has(> path[data-damage="${rect0.id}"]) > path[stroke="none"]`);
  await expect(fill).toHaveAttribute('fill', '#2f9e44');
  await expect(fill).toHaveAttribute('fill-opacity', '0.5');
  await waitSaved(page);
  let rect = (await stored(page, 'damages'))[0];
  expect(rect.style).toMatchObject({ lineType: 'dashed', fillColor: '#2f9e44', fillTransparency: 50 });
  expect(rect.shape).toEqual(rect0.shape);
  expect([rect.length, rect.width, rect.area]).toEqual([4, 2.5, 10]); // Messwerte unverändert
  // andere Messung nicht verändert
  expect((await stored(page, 'damages'))[1].style).toEqual(line.style);

  // PDF: Strichmuster und halbtransparente Füllung
  let dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  let ops = pdfOps(await saveDownload(dl, 'darstellung.pdf'));
  expect(ops).toMatch(/\[\s*[\d.]+\s+[\d.]+\s*\]\s+0\s+d/); // gestrichelt
  expect(ops).toMatch(/\/ca\s+0\.5\b/); // 50 % Transparenz

  // Keine Füllung → nur Umrandung
  await panel.getByTestId('style-no-fill').check();
  await expect(fill).toHaveCount(0);
  await expect(panel.getByTestId('style-fill-transparency')).toHaveCount(0);
  await waitSaved(page);
  rect = (await stored(page, 'damages'))[0];
  expect(rect.style).toMatchObject({ noFill: true, fillColor: '#2f9e44' }); // Füllfarbe bleibt für später
  // Nach dem Neuladen erhalten
  await page.reload();
  await waitForPlan(page);
  await expect(page.locator(`path[data-damage="${rect0.id}"]`)).toHaveAttribute('data-line-type', 'dashed');
  await expect(page.locator(`path[data-damage="${line0.id}"]`)).toHaveAttribute('data-line-type', 'zigzag');
  dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  ops = pdfOps(await saveDownload(dl, 'darstellung-ohne-fuellung.pdf'));
  expect(ops).not.toMatch(/\/ca\s+0\.5\b/);
  execFileSync('pdftoppm', ['-png', '-r', '50', '-singlefile', join('tests', 'output', 'darstellung-ohne-fuellung.pdf'), join('tests', 'output', 'darstellung')]);
});

test('Voreinstellung vor dem Zeichnen gilt für neue Messungen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Vorgabe', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('V-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await page.getByTestId('tool-style').click();
  const pop = page.getByTestId('default-style');
  await pop.getByTestId('style-line-type').selectOption('dotted');
  await pop.getByTestId('style-no-fill').check();
  await page.getByTestId('tool-style').click();
  const box = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.2, box.x + box.width * 0.4, box.y + box.height * 0.4);
  await fillMeasures(page, '1', '1', '', false);
  await waitSaved(page);
  expect((await stored(page, 'damages'))[0].style).toMatchObject({ lineType: 'dotted', noFill: true });
});

test('Gezeichneter Plan: Linie und Fläche mit eigenem Stil, PDF', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Zeichnung Stil', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('S-1');
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  const sb = (await sheet.boundingBox())!;
  // Wand (Linie)
  await pickTool(page, 'draw-line');
  await page.mouse.move(sb.x + 60, sb.y + 80);
  await page.mouse.down();
  await page.mouse.move(sb.x + 360, sb.y + 80, { steps: 6 });
  await page.mouse.up();
  const bar = page.getByTestId('element-bar');
  await bar.getByTestId('style-toggle').click();
  await expect(bar.getByTestId('style-no-fill')).toHaveCount(0);
  await bar.getByTestId('style-line-type').selectOption('dashdotdot');
  await setRange(page, 'style-line-width', '2.5');
  await waitSaved(page);
  const lineLen = await bar.getByTestId('element-length').inputValue();
  const lineShape = (await stored(page, 'elements'))[0].shape;
  // Rechteck mit Wellenlinie und Füllung 30 %
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
  await pickTool(page, 'draw-rect');
  await page.mouse.move(sb.x + 80, sb.y + 160);
  await page.mouse.down();
  await page.mouse.move(sb.x + 300, sb.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect(bar.getByTestId('style-panel')).toBeVisible(); // bleibt geöffnet
  // Neue Formen: standardmäßig „Keine Füllung“ (eigene Einstellung), Füllung nur auf Wunsch
  await expect(bar.getByTestId('style-fill-type')).toHaveValue('none');
  await expect(page.locator('[data-element="rect"] path[data-fill]')).toHaveCount(0);
  await expect(bar.getByTestId('style-fill-transparency')).toHaveCount(0);
  await bar.getByTestId('style-line-type').selectOption('wave');
  await bar.getByTestId('style-fill-type').selectOption('solid');
  await setRange(page, 'style-fill-transparency', '30');
  await expect(page.locator('[data-element="rect"] path[data-line-type="wave"]')).toHaveCount(1);
  await waitSaved(page);
  const els = await stored(page, 'elements');
  expect(els[0].style).toMatchObject({ lineType: 'dashdotdot', lineWidth: 2.5 });
  expect(els[1].style).toMatchObject({ lineType: 'wave', fillTransparency: 30, noFill: false });
  // Fläche/Länge aus der Geometrie: Rechteck bleibt Rechteck
  expect((els[1].shape as { type: string }).type).toBe('rect');
  await expect(page.getByTestId('element-info')).toContainText('Fläche');
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'zeichnung-stil.pdf');
  const ops = pdfOps(pdf);
  expect(ops).toMatch(/\[\s*[\d.]+\s+[\d.]+\s+0\s+[\d.]+\s+0\s+[\d.]+\s*\]\s+0\s+d/); // Strich-Punkt-Punkt
  expect(ops).toMatch(/\/ca\s+0\.7\b/); // 30 % Transparenz
  execFileSync('pdftoppm', ['-png', '-r', '60', '-singlefile', pdf, join('tests', 'output', 'zeichnung-stil')]);
  // Geometrie und Länge der Linie unverändert nach Stiländerung
  expect(els[0].shape).toEqual(lineShape);
  expect(lineLen).not.toBe('');
});
