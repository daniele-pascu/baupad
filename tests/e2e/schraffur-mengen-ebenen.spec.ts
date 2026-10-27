import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, saveDownload, waitForPlan, waitSaved } from './helpers';

/**
 * Phase 3: Schraffuren (Linien, Kreuz, Punkte; Winkel und Abstand) in Ansicht und PDF, Mengen
 * aus der Geometrie (Fläche und Umfang aus der kalibrierten bzw. gezeichneten Form, bei
 * Formänderung nachgeführt, Volumensumme) und Ebenen ein-/ausblenden.
 */

type Rec = Record<string, unknown> & { deletedAt: number | null; createdAt: number; style?: Record<string, unknown>; shape: Record<string, number> };
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

/** Alle Inhaltsströme des PDFs entpackt */
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
print('\\n'.join(out))`,
      pdf,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

async function newDrawing(page: Page, name: string, number: string) {
  await freshStart(page);
  await createProject(page, name, {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill(number);
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  return (await sheet.boundingBox())!;
}

async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
}

async function exportPdf(page: Page, name: string) {
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  return saveDownload(dl, name);
}

test('Schraffur: Muster, Winkel und Abstand je Fläche, gespeichert und als Vektor im PDF', async ({ page }) => {
  const sb = await newDrawing(page, 'Schraffur', 'SR-1');
  await pickTool(page, 'draw-rect');
  await drag(page, sb.x + 80, sb.y + 120, sb.x + 320, sb.y + 300);
  const bar = page.getByTestId('element-bar');
  await bar.getByTestId('style-toggle').click();
  const panel = bar.getByTestId('style-panel');
  await panel.getByTestId('style-fill-type').selectOption('hatch');
  const hatch = page.locator('[data-element="rect"] path[data-fill="hatch"]');
  await expect(hatch).toHaveCount(1);
  await expect(page.locator('[data-element="rect"] path[data-fill="solid"]')).toHaveCount(0);
  const d1 = (await hatch.getAttribute('d'))!;
  // Kreuzschraffur 30°: mehr Linien als die einfache Schraffur
  await panel.getByTestId('style-hatch-pattern').selectOption('cross');
  await panel.getByTestId('style-hatch-angle').selectOption('30');
  await expect.poll(async () => ((await hatch.getAttribute('d')) ?? '').split('M').length).toBeGreaterThan(d1.split('M').length * 1.5);
  // Abstand größer → weniger Linien
  const before = ((await hatch.getAttribute('d')) ?? '').split('M').length;
  const sp = panel.getByTestId('style-hatch-spacing');
  await sp.fill('16');
  await sp.blur();
  await expect.poll(async () => ((await hatch.getAttribute('d')) ?? '').split('M').length).toBeLessThan(before);
  await waitSaved(page);
  const el = (await stored(page, 'elements'))[0];
  expect(el.style).toMatchObject({ fillType: 'hatch', hatch: { pattern: 'cross', angle: 30, spacing: 16 } });
  expect(el.shape.type).toBe('rect'); // Geometrie unverändert

  // Punkte
  await panel.getByTestId('style-hatch-pattern').selectOption('dots');
  await expect(hatch).toHaveCount(1);
  // Zurück auf Vollton: Fläche wieder flächig gefüllt
  await panel.getByTestId('style-fill-type').selectOption('solid');
  await expect(page.locator('[data-element="rect"] path[data-fill="solid"]')).toHaveCount(1);
  await panel.getByTestId('style-fill-type').selectOption('hatch');
  await panel.getByTestId('style-hatch-pattern').selectOption('lines');
  await waitSaved(page);

  // Nach dem Neuladen erhalten
  await page.reload();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await expect(page.locator('[data-element="rect"] path[data-fill="hatch"]')).toHaveCount(1);

  // PDF: Schraffur als Linien (runde Enden, kein flächiges Füllen der Form)
  const pdf = await exportPdf(page, 'schraffur.pdf');
  const ops = pdfOps(pdf);
  expect(ops).toMatch(/1 J/);
  expect((ops.match(/\bl\b/g) ?? []).length).toBeGreaterThan(10);
  execFileSync('pdftoppm', ['-png', '-r', '60', '-singlefile', pdf, join('tests', 'output', 'schraffur')]);
});

test('Importierter Plan: Schraffur einer Messung in Ansicht und PDF', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Schraffur Import', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('SI-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.2, box.x + box.width * 0.45, box.y + box.height * 0.45);
  const dlg = page.getByTestId('damage-dialog');
  await dlg.getByTestId('input-length').fill('3');
  await dlg.getByTestId('input-width').fill('2');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  await page.getByTestId('style-toggle').click();
  const panel = page.getByTestId('style-panel');
  await panel.getByTestId('style-fill-type').selectOption('hatch');
  const d = (await stored(page, 'damages'))[0];
  await expect(page.locator(`g:has(> path[data-damage="${d.id}"]) > path[data-fill="hatch"]`)).toHaveCount(1);
  await waitSaved(page);
  const after = (await stored(page, 'damages'))[0];
  expect(after.style).toMatchObject({ fillType: 'hatch' });
  expect([after.length, after.width, after.area]).toEqual([3, 2, 6]); // Messwerte unverändert
  const ops = pdfOps(await exportPdf(page, 'schraffur-import.pdf'));
  expect(ops).toMatch(/1 J/);
});

test('Mengen aus der Geometrie: Fläche und Umfang aus dem Plan, nachgeführt bei Formänderung, Volumensumme', async ({ page }) => {
  const sb = await newDrawing(page, 'Mengen', 'M-1');
  await page.getByTestId('mode-measure').click();
  const dlg = page.getByTestId('damage-dialog');

  // Rechteck: Fläche aus Plan übernehmen
  await pickTool(page, 'tool-rect');
  await drag(page, sb.x + 100, sb.y + 120, sb.x + 260, sb.y + 220);
  await expect(dlg).toBeVisible();
  const geo = dlg.getByTestId('use-geometry');
  await expect(geo).toContainText('Fläche aus Plan übernehmen');
  await geo.click();
  await expect(dlg.getByTestId('input-width')).toHaveCount(0);
  await expect(dlg.getByTestId('input-length')).toHaveCount(0);
  await expect(dlg.getByTestId('area-result')).toContainText('Länge × Breite');
  await dlg.getByTestId('input-depth').fill('0,1');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  let [r] = await stored(page, 'damages');
  const areaOf = (s: Record<string, number>) => Math.round((s.w / 100) * (s.h / 100) * 10000) / 10000;
  const perimOf = (s: Record<string, number>) => Math.round(((2 * (s.w + s.h)) / 100) * 10000) / 10000;
  expect(r.areaFromShape).toBe(true);
  expect(r.width).toBeNull();
  expect(r.area).toBeCloseTo(areaOf(r.shape), 4);
  expect(r.length).toBeCloseTo(perimOf(r.shape), 4);
  expect(r.depth).toBe(0.1);
  const a0 = r.area as number;
  await expect(page.getByTestId('measure-check')).toContainText('aus der Form');

  // Ecke ziehen → Fläche und Umfang werden nachgeführt (ein Rückgängig-Schritt)
  const handles = page.locator('.handles rect.handle');
  const boxes = await Promise.all((await handles.all()).map((h) => h.boundingBox()));
  const br = boxes.filter(Boolean).sort((a, b) => b!.x + b!.y - (a!.x + a!.y))[0]!;
  await drag(page, br.x + br.width / 2, br.y + br.height / 2, br.x + br.width / 2 + 80, br.y + br.height / 2 + 60);
  await waitSaved(page);
  [r] = await stored(page, 'damages');
  expect(r.area).toBeGreaterThan(a0 * 1.5);
  expect(r.area).toBeCloseTo(areaOf(r.shape), 4);
  expect(r.length).toBeCloseTo(perimOf(r.shape), 4);
  await page.getByTestId('undo').click();
  await waitSaved(page);
  expect((await stored(page, 'damages'))[0].area).toBeCloseTo(a0, 4);
  await page.getByTestId('redo').click();
  await waitSaved(page);
  [r] = await stored(page, 'damages');

  // Kreis: π · r², Umfang 2πr
  await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
  await pickTool(page, 'tool-ellipse');
  await drag(page, sb.x + 320, sb.y + 120, sb.x + 420, sb.y + 220);
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('use-geometry').click();
  await expect(dlg.getByTestId('area-result')).toContainText(/π · (r²|a · b)/);
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const c = (await stored(page, 'damages'))[1];
  expect(c.areaFromShape).toBe(true);
  expect(c.area).toBeCloseTo((Math.PI * (c.shape.w / 200) * (c.shape.h / 200)), 3);

  // Tabelle: Umfang gekennzeichnet, Summen und Volumen
  await expect(page.getByTestId('sum-volume')).toContainText((Math.round((r.area as number) * 0.1 * 100) / 100).toFixed(2).replace('.', ','));
  await expect(page.getByTestId('aufmass-table')).toContainText('U ');

  // Zurück zur Handeingabe: Breite wieder eingeben
  await page.getByRole('button', { name: /^\S+ 1 bearbeiten$/ }).click();
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('use-geometry').click();
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('input-width').fill('3');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const m = (await stored(page, 'damages'))[0];
  expect([m.length, m.width, m.area, m.areaFromShape]).toEqual([2, 3, 6, undefined]);
});

test('Importierter Plan: Fläche aus Plan erst nach dem Kalibrieren', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Mengen Import', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('MI-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + 60, box.y + 60, box.x + 160, box.y + 110);
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('use-geometry')).toHaveCount(0);
  await dlg.getByTestId('damage-cancel').click();
  // 200 px = 10 m → 100 × 50 px = 5 × 2,5 m
  await pickTool(page, 'tool-calibrate');
  await drawRect(page, box.x + 40, box.y + 200, box.x + 240, box.y + 200);
  const pd = page.getByTestId('prompt-dialog');
  await pd.locator('input').fill('10');
  await pd.getByRole('button', { name: 'Kalibrieren' }).click();
  await waitSaved(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + 60, box.y + 60, box.x + 160, box.y + 110);
  await expect(dlg.getByTestId('use-geometry')).toContainText('12,50 m²');
  await dlg.getByTestId('use-geometry').click();
  await expect(dlg.getByTestId('geometry-perimeter')).toHaveValue('15,00');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const d = (await stored(page, 'damages'))[0];
  expect(d.area).toBeCloseTo(12.5, 2);
  expect(d.length).toBeCloseTo(15, 2);
  // Linienmessung: keine Flächenübernahme, nur die Länge aus dem Plan
  await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
  await pickTool(page, 'tool-line');
  await drawRect(page, box.x + 60, box.y + 160, box.x + 160, box.y + 160);
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('use-geometry')).toHaveText('Länge wieder von Hand eingeben');
  await expect(dlg.getByTestId('geometry-perimeter')).toHaveCount(0);
  await expect(dlg.getByTestId('area-result')).toContainText('Länge aus Plan');
});

test('Ebenen: Zeichnung, Bemaßung, Text und Messungen ein-/ausblenden – Ansicht, Fang und PDF', async ({ page }) => {
  const sb = await newDrawing(page, 'Ebenen', 'E-1');
  await pickTool(page, 'draw-line');
  await drag(page, sb.x + 60, sb.y + 80, sb.x + 360, sb.y + 80);
  await pickTool(page, 'draw-rect');
  await drag(page, sb.x + 80, sb.y + 160, sb.x + 300, sb.y + 300);
  await page.keyboard.press('Escape');
  await waitSaved(page);
  await expect(page.locator('[data-element]')).toHaveCount(2);
  await expect(page.locator('.dims .dim').first()).toBeVisible();

  // Bemaßung aus: Maßangaben weg, Objekte bleiben
  await page.getByTestId('layers-toggle').click();
  await page.getByTestId('layer-dims').uncheck();
  await expect(page.locator('.dims .dim')).toHaveCount(0);
  await expect(page.locator('[data-element]')).toHaveCount(2);
  // Zeichnung aus: Objekte weder sichtbar noch auswählbar
  await page.getByTestId('layer-drawing').uncheck();
  await expect(page.locator('[data-element]')).toHaveCount(0);
  await waitSaved(page);
  expect((await stored(page, 'plans'))[0].hiddenLayers).toEqual(['dims', 'drawing']);
  await page.locator('.side-head h2').click(); // Menü schließen
  await expect(page.getByTestId('layers-pop')).toHaveCount(0);
  await pickTool(page, 'draw-select');
  await page.mouse.click(sb.x + 200, sb.y + 80);
  await expect(page.getByTestId('element-bar')).toHaveCount(0);
  // Daten unverändert
  expect(await stored(page, 'elements')).toHaveLength(2);

  // Wieder einblenden; Messung anlegen und Ebene „Messungen“ ausblenden
  await page.getByTestId('layers-toggle').click();
  await page.getByTestId('layer-drawing').check();
  await page.getByTestId('layer-dims').check();
  await expect(page.locator('[data-element]')).toHaveCount(2);
  await waitSaved(page);
  expect((await stored(page, 'plans'))[0].hiddenLayers).toBeUndefined();
  await page.getByTestId('mode-measure').click();
  await pickTool(page, 'tool-rect');
  await drag(page, sb.x + 120, sb.y + 190, sb.x + 220, sb.y + 260);
  const dlg = page.getByTestId('damage-dialog');
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  await expect(page.locator('path[data-damage]')).toHaveCount(1);
  await page.getByTestId('layers-toggle').click();
  await page.getByTestId('layer-measures').uncheck();
  await expect(page.locator('path[data-damage]')).toHaveCount(0);
  await expect(page.getByTestId('aufmass-row')).toHaveCount(1); // Tabelle vollständig
  await page.getByTestId('layer-drawing').uncheck();
  await waitSaved(page);

  // PDF: Hinweis im Dialog, ausgeblendete Ebenen nicht gedruckt
  await page.getByTestId('export-pdf-plan').click();
  await expect(page.getByTestId('pdf-hidden-layers')).toContainText('Zeichnung, Messungen');
  const dl = await catchDownload(page, () => page.getByTestId('pdf-export-run').click());
  const pdf = await saveDownload(dl, 'ebenen.pdf');
  execFileSync('pdftoppm', ['-png', '-r', '50', '-singlefile', pdf, join('tests', 'output', 'ebenen')]);
  const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  expect(text).toContain('E-1');
  // Ohne Zeichnung und Messungen: nur der Kopf, keine Maßzahlen und keine Messnummer
  expect(text).not.toMatch(/\d,\d\d m/);

  // Nach dem Neuladen erhalten
  await page.reload();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await expect(page.locator('path[data-damage]')).toHaveCount(0);
  await expect(page.getByTestId('layers-toggle')).toHaveClass(/active-toggle/);
});
