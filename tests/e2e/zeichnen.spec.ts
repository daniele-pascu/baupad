import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, freshStart, OUT, saveDownload, waitSaved, pickTool } from './helpers';

/** Phase 3b: Pläne selbst zeichnen – maßhaltig, mit Maßeingabe, Bemaßung, Aufmaß und Export. */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type Stored = { id: string; type: string; shape: { x: number; y: number; w: number; h: number; points?: number[][] }; text?: string; deletedAt: number | null };

/** Datensätze direkt aus der lokalen Datenbank */
async function stored<T = Stored>(p: Page, store: string): Promise<T[]> {
  return p.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (T & { deletedAt: number | null; createdAt: number })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
    store,
  );
}

const sheet = () => page.getByTestId('drawing-sheet');
/** Auswahl aufheben (Fokus aus dem Eingabefeld nehmen, dann Escape) */
async function deselect() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-bar')).toHaveCount(0);
}
const dim = (text: string) => page.locator(`.dims [data-dim="${text}"]`).first();

/** Bildschirmgröße eines Zeichnungsobjekts geteilt durch den Zoom = Größe in Seiteneinheiten (cm) */
async function pageWidthOf(selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as SVGGraphicsElement;
    const scale = Number((document.querySelector('[data-testid="plan-viewer"]') as HTMLElement).dataset.scale);
    return el.getBoundingClientRect().width / scale;
  }, selector);
}

test('Plan zeichnen: Raum 5,00 × 3,65 m über Maßeingabe, Maß ändern, Zoom ändert keine Maße', async () => {
  await freshStart(page);
  await createProject(page, 'Zeichnung', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('Z-1');
  await nd.getByTestId('new-drawing-save').click();

  // Leere Zeichenfläche, Planbearbeitung aktiv
  await expect(sheet()).toBeVisible();
  await expect(page.getByTestId('draw-toolbar')).toBeVisible();
  await expect(page.getByTestId('mode-draw')).toHaveAttribute('aria-selected', 'true');

  // Rechteck: Maße eingeben und einfügen
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill('5');
  await page.getByTestId('insert-width').fill('3,65');
  await page.getByTestId('insert-submit').click();
  await expect(page.locator('[data-element="rect"]')).toHaveCount(1);
  await expect(dim('5,00 m')).toBeVisible();
  await expect(dim('3,65 m')).toBeVisible();
  await expect(page.getByTestId('element-length')).toHaveValue('5,00');
  await expect(page.getByTestId('element-width')).toHaveValue('3,65');
  await waitSaved(page);
  let rect = (await stored(page, 'elements'))[0];
  expect(rect.type).toBe('rect');
  expect([rect.shape.w, rect.shape.h]).toEqual([5, 3.65]); // reale Maße exakt in m
  const { x, y } = rect.shape;

  // Maß nachträglich ändern → Zeichnung passt sich an, Ecke bleibt
  await page.getByTestId('element-length').fill('6,2');
  await page.getByTestId('element-length').press('Enter');
  await expect(dim('6,20 m')).toBeVisible();
  await waitSaved(page);
  rect = (await stored(page, 'elements'))[0];
  expect(rect.shape).toMatchObject({ x, y, w: 6.2, h: 3.65 });

  // Zoomen verändert keine Maße: Darstellung skaliert, gespeicherte Werte bleiben
  const w1 = await pageWidthOf('[data-element="rect"] path:last-child');
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  await expect(dim('6,20 m')).toBeVisible();
  const w2 = await pageWidthOf('[data-element="rect"] path:last-child');
  expect(Math.abs(w2 - 620)).toBeLessThan(3);
  expect(Math.abs(w1 - 620)).toBeLessThan(6);
  await page.getByRole('button', { name: 'Gesamten Plan anzeigen' }).click();
  expect((await stored(page, 'elements'))[0].shape).toMatchObject({ w: 6.2, h: 3.65 });
});

test('Linien mit Länge und Richtung schließen aneinander an; Kreis, Dreieck, Maßlinie, Text', async () => {
  await deselect();
  await pickTool(page, 'draw-line');
  await page.getByTestId('insert-length').fill('3');
  await page.getByRole('button', { name: 'Richtung nach unten' }).click();
  await page.getByTestId('insert-submit').click();
  await expect(dim('3,00 m')).toBeVisible();
  await deselect();
  await expect(page.getByTestId('insert-bar')).toContainText('schließt an die letzte Linie an');
  await page.getByTestId('insert-length').fill('2,5');
  await page.getByRole('button', { name: 'Richtung nach rechts' }).click();
  await page.getByTestId('insert-submit').click();
  await expect(dim('2,50 m')).toBeVisible();
  await waitSaved(page);
  const lines = (await stored(page, 'elements')).filter((e) => e.type === 'line');
  expect(lines).toHaveLength(2);
  // Endpunkt der ersten Linie = Startpunkt der zweiten
  const end1 = { x: lines[0].shape.x + lines[0].shape.points![1][0] * lines[0].shape.w, y: lines[0].shape.y + lines[0].shape.points![1][1] * lines[0].shape.h };
  const start2 = { x: lines[1].shape.x + lines[1].shape.points![0][0] * lines[1].shape.w, y: lines[1].shape.y + lines[1].shape.points![0][1] * lines[1].shape.h };
  expect(end1.x).toBeCloseTo(start2.x, 4);
  expect(end1.y).toBeCloseTo(start2.y, 4);
  expect(lines[0].shape.h).toBeCloseTo(3, 6);
  expect(lines[1].shape.w).toBeCloseTo(2.5, 6);

  // Kreis über Durchmesser, Dreieck über Grundseite und Höhe
  await deselect();
  await pickTool(page, 'draw-ellipse');
  await page.getByTestId('insert-diameter').fill('1,2');
  await page.getByTestId('insert-submit').click();
  await expect(dim('Ø 1,20 m')).toBeVisible();
  await deselect();
  await pickTool(page, 'draw-triangle');
  await page.getByTestId('insert-base').fill('2');
  await page.getByTestId('insert-height').fill('1,5');
  await page.getByTestId('insert-submit').click();
  await expect(dim('1,50 m')).toBeVisible();
  // Dreieck nachträglich bemaßen
  await page.getByTestId('element-base').fill('2,4');
  await page.getByTestId('element-base').press('Enter');
  await expect(dim('2,40 m')).toBeVisible();

  // Maßlinie durch Ziehen (rastet am Raster ein) – Länge wird angezeigt
  await deselect();
  await pickTool(page, 'draw-dimension');
  await page.getByTestId('grid-toggle').click(); // Raster nur auf Wunsch (Standard: aus)
  await expect(page.getByTestId('grid-toggle')).toHaveAttribute('aria-pressed', 'true');
  const sb = (await sheet().boundingBox())!;
  await page.mouse.move(sb.x + sb.width * 0.1, sb.y + sb.height * 0.85);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width * 0.3, sb.y + sb.height * 0.85, { steps: 6 });
  await page.screenshot({ path: join(OUT, 'zeichnen-live.png') });
  await expect(page.getByTestId('live-dim').first()).toBeVisible(); // Live-Maß beim Zeichnen
  await page.mouse.up();
  await expect(page.locator('[data-element="dimension"]')).toHaveCount(1);
  await waitSaved(page);
  const dimEl = (await stored(page, 'elements')).find((e) => e.type === 'dimension')!;
  expect(dimEl.shape.h).toBeLessThan(0.001); // waagerecht eingerastet
  expect(Math.abs(dimEl.shape.w * 100 - Math.round(dimEl.shape.w * 100))).toBeLessThan(1e-6); // Rasterwert
  await page.getByTestId('grid-toggle').click(); // wieder aus

  // Text
  await deselect();
  await pickTool(page, 'draw-text');
  await page.mouse.click(sb.x + sb.width * 0.6, sb.y + sb.height * 0.15);
  const pd = page.getByTestId('prompt-dialog');
  await pd.locator('input').fill('Kellerraum 1');
  await pd.getByRole('button', { name: 'Einfügen' }).click();
  await expect(page.locator('[data-element="text"]')).toContainText('Kellerraum 1');

  // Rückgängig / Wiederholen gilt auch für Zeichnungsobjekte
  await page.getByTestId('undo').click();
  await expect(page.locator('[data-element="text"]')).toHaveCount(0);
  await page.getByTestId('redo').click();
  await expect(page.locator('[data-element="text"]')).toHaveCount(1);
  await page.screenshot({ path: join(OUT, 'zeichnen-pc.png') });
});

test('Weiter zum Aufmaß: Messung auf gezeichnetem Plan, Maßvorschlag; Planänderung lässt Messung unverändert', async () => {
  await page.getByTestId('mode-measure').click();
  await expect(page.getByTestId('draw-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('tool-rect')).toBeVisible();
  await expect(page.locator('[data-element="rect"]')).toHaveCount(1); // Zeichnung bleibt sichtbar

  // Markierung exakt über den Raum ziehen: Ecken des Rechtecks am Bildschirm
  await pickTool(page, 'tool-rect');
  const r = (await page.locator('[data-element="rect"] path:last-child').boundingBox())!;
  await page.mouse.move(r.x + r.width * 0.25, r.y + r.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.5, { steps: 4 });
  await page.mouse.move(r.x + r.width * 0.75, r.y + r.height * 0.75, { steps: 4 });
  await page.mouse.up();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  // Maßstab ist bekannt → Vorschlag ca. 3,10 × 1,83 m (halbe Raummaße)
  const sug = dlg.getByTestId('use-suggestion');
  await expect(sug).toContainText('×');
  await sug.click();
  const L = Number((await dlg.getByTestId('input-length').inputValue()).replace(',', '.'));
  const B = Number((await dlg.getByTestId('input-width').inputValue()).replace(',', '.'));
  expect(Math.abs(L - 3.1)).toBeLessThan(0.1);
  expect(Math.abs(B - 1.825)).toBeLessThan(0.1);
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('[data-testid="aufmass-row"]')).toHaveCount(1);
  await waitSaved(page);
  const damageBefore = JSON.stringify((await stored(page, 'damages'))[0]);

  // Zurück zur Planbearbeitung, Raum ändern: Messung bleibt unverändert
  await page.getByTestId('mode-draw').click();
  await expect(page.getByTestId('draw-toolbar')).toBeVisible();
  await pickTool(page, 'draw-select');
  const r2 = (await page.locator('[data-element="rect"] path:last-child').boundingBox())!;
  await page.mouse.click(r2.x + 3, r2.y + r2.height / 2); // linke Kante
  await expect(page.getByTestId('element-bar')).toContainText('Rechteck');
  await expect(page.getByTestId('element-overlap')).toContainText('1 Messung');
  await page.getByTestId('element-width').fill('4');
  await page.getByTestId('element-width').press('Enter');
  await expect(dim('4,00 m')).toBeVisible();
  // Löschen fragt nach, weil eine Messung darauf liegt
  await page.getByTestId('element-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Messungen und ihre Maße bleiben erhalten');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await waitSaved(page);
  expect(JSON.stringify((await stored(page, 'damages'))[0])).toBe(damageBefore);
});

test('Nach dem Neuladen ist alles da; PDF-Export mit Maßstab; Sicherung und Wiederherstellung', async () => {
  await page.reload();
  // Plan mit Inhalt öffnet im Aufmaß
  await expect(page.getByTestId('mode-measure-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-element]')).toHaveCount(7);
  await expect(page.locator('[data-testid="aufmass-row"]')).toHaveCount(1);
  await expect(dim('6,20 m')).toBeVisible();

  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'gezeichnet.pdf');
  const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  expect(text).toContain('Plannummer Z-1 | Aufmaßplan');
  expect(text).not.toMatch(/Maßstab|A3/); // nur auf Wunsch im Plan
  expect(text).toContain('6,20 m');
  expect(text).toContain('Kellerraum 1');
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Page size:\s+1190\.55 x 841\.89/);
  execFileSync('pdftoppm', ['-png', '-r', '60', pdf, join(OUT, 'gezeichnet')]);

  // Sicherung → als Kopie importieren → gezeichneter Plan vollständig
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await expect(page.getByTestId('plan-row')).toHaveCount(1);
  await expect(page.getByTestId('plan-row')).toContainText('Z-1');
  const bdl = await catchDownload(page, () => page.getByTestId('backup-project').click());
  const backup = await saveDownload(bdl, 'zeichnung-sicherung.zip');
  await page.goto('./#/projekte');
  await page.getByTestId('import-project-input').setInputFiles(backup);
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Als Kopie importieren' }).click();
  await expect(page.getByTestId('project-title')).toHaveText('Zeichnung (Kopie)');
  await page.getByTestId('plan-open').first().click();
  await expect(page.locator('[data-element]')).toHaveCount(7);
  await expect(dim('6,20 m')).toBeVisible();
  await expect(page.locator('[data-testid="aufmass-row"]')).toHaveCount(1);
});
