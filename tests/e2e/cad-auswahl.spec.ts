import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** CAD Phase 1: Mehrfachauswahl (Fenster/Kreuzen), Befehlsleiste mit Eingabe, Anzeige am Cursor, Verschieben/Kopieren mehrerer Objekte. */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; color: string; style?: unknown; shape: { x: number; y: number; w: number; h: number } };
async function elements(): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null; createdAt: number })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
const sheet = () => page.getByTestId('drawing-sheet');
async function drag(x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
}
const near = (a: number, b: number, tol = 0.011) => expect(Math.abs(a - b)).toBeLessThan(tol);
async function escape() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}

test('Fenster und Kreuzen wählen mehrere Objekte; Mehrfachkopie mit ΔX;ΔY', async () => {
  await freshStart(page);
  await createProject(page, 'CAD Auswahl', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('C-1');
  await page.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  const sb = (await sheet().boundingBox())!;
  // drei Rechtecke nebeneinander
  for (const x of [100, 260, 420]) {
    await escape();
    await pickTool(page, 'draw-rect');
    await drag(sb.x + x, sb.y + 120, sb.x + x + 100, sb.y + 180);
  }
  await waitSaved(page);
  await escape();
  expect(await elements()).toHaveLength(3);

  // Fenster nach rechts: nur die ersten beiden ganz enthalten
  await pickTool(page, 'draw-selwin');
  await drag(sb.x + 80, sb.y + 100, sb.x + 380, sb.y + 200);
  await expect(page.getByTestId('multi-bar')).toContainText('2 Objekte ausgewählt');
  await expect(page.locator('[data-testid="multi-sel"] path')).toHaveCount(2);
  // Kreuzen nach links: berührt das dritte Rechteck → mit Umschalt dazu
  await page.keyboard.down('Shift');
  await drag(sb.x + 450, sb.y + 210, sb.x + 440, sb.y + 150);
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('multi-bar')).toContainText('3 Objekte ausgewählt');

  // Kopieren: Verschiebung eintippen (ohne vorher ins Feld zu klicken), zweimal hintereinander
  await page.getByTestId('multi-copy').click();
  await expect(page.getByTestId('command-bar')).toContainText('Basispunkt');
  await page.locator('.side-head h2').click();
  await page.keyboard.type('0;-3');
  await expect(page.getByTestId('command-input')).toHaveValue('0;-3');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  let els = await elements();
  expect(els).toHaveLength(6);
  await expect(page.getByTestId('command-prompt')).toContainText('1 Kopie erstellt');
  await page.getByTestId('command-input').fill('0;-6');
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  els = await elements();
  expect(els).toHaveLength(9);
  // Kopien: gleiche Größe und Eigenschaften, 3 m bzw. 6 m tiefer (ΔY negativ = nach unten)
  const orig = els.slice(0, 3);
  for (const o of orig)
    for (const dy of [3, 6]) {
      const c = els.find((e) => e.id !== o.id && Math.abs(e.shape.x - o.shape.x) < 0.011 && Math.abs(e.shape.y - (o.shape.y + dy)) < 0.011);
      expect(c, `Kopie ${dy} m unter ${o.id}`).toBeTruthy();
      near(c!.shape.w, o.shape.w);
      near(c!.shape.h, o.shape.h);
      expect(c!.style).toEqual(o.style);
      expect(c!.color).toBe(o.color);
    }
  await page.getByTestId('command-done').click();
  await expect(page.getByTestId('command-bar')).toHaveCount(0);
});

test('Verschieben per Klick: Basispunkt, Anzeige am Cursor, Abstand in Mausrichtung', async () => {
  await escape();
  const sb = (await sheet().boundingBox())!;
  const before = (await elements())[0];
  // erstes Rechteck antippen → Verschieben
  await pickTool(page, 'draw-select');
  await page.mouse.click(sb.x + 100, sb.y + 150);
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await pickTool(page, 'draw-move');
  await expect(page.getByTestId('command-prompt')).toContainText('Basispunkt');
  await page.mouse.click(sb.x + 100, sb.y + 120); // Ecke
  await expect(page.getByTestId('command-prompt')).toContainText('Zielpunkt');
  await page.mouse.move(sb.x + 160, sb.y + 120, { steps: 3 });
  await page.mouse.move(sb.x + 200, sb.y + 120, { steps: 3 });
  await expect(page.getByTestId('cursor-tip')).toContainText(/m · ΔX [\d,]+ · ΔY 0,00 · 0°/);
  await expect(page.getByTestId('cad-ghost')).toBeVisible();
  await page.keyboard.type('1,5');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  const after = (await elements()).find((e) => e.id === before.id)!;
  near(after.shape.x, before.shape.x + 1.5);
  near(after.shape.y, before.shape.y);
  await expect(page.getByTestId('command-bar')).toHaveCount(0);
});

test('Verschieben ohne Auswahl fragt nach den Objekten; Strg+A, Löschen und Rückgängig', async () => {
  await escape();
  const sb = (await sheet().boundingBox())!;
  const before = (await elements())[1];
  await pickTool(page, 'draw-move');
  await expect(page.getByTestId('command-prompt')).toContainText('Objekte wählen');
  await expect(page.getByTestId('command-next')).toBeDisabled();
  await page.mouse.click(sb.x + 310, sb.y + 180); // Unterkante des zweiten Rechtecks
  await expect(page.getByTestId('command-prompt')).toContainText('Ausgewählt: 1');
  await page.getByTestId('command-next').click();
  await page.getByTestId('command-input').fill('2<90');
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  const after = (await elements()).find((e) => e.id === before.id)!;
  near(after.shape.y, before.shape.y - 2); // 2 m nach oben
  near(after.shape.x, before.shape.x);

  // alles auswählen und löschen – ein Rückgängig-Schritt holt alles zurück
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Control+a');
  await expect(page.getByTestId('multi-bar')).toContainText('9 Objekte ausgewählt');
  await page.keyboard.press('Delete');
  await waitSaved(page);
  expect(await elements()).toHaveLength(0);
  await page.getByTestId('undo').click();
  await waitSaved(page);
  expect(await elements()).toHaveLength(9);
});

test('Linie: Klick, dann Länge eintippen – exakt in Mausrichtung', async () => {
  await escape();
  const sb = (await sheet().boundingBox())!;
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 120, sb.y + 420);
  await page.mouse.move(sb.x + 200, sb.y + 420, { steps: 3 });
  await page.mouse.move(sb.x + 260, sb.y + 420, { steps: 3 });
  await expect(page.getByTestId('command-bar')).toContainText('Endpunkt');
  await expect(page.getByTestId('cursor-tip')).toBeVisible();
  await page.keyboard.type('3,25');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  const line = (await elements()).at(-1)!;
  expect(line.type).toBe('line');
  near(line.shape.w, 3.25);
  near(line.shape.h, 0);
  // falsche Eingabe: verständliche Meldung
  await pickTool(page, 'draw-move');
  await page.getByTestId('command-bar').getByTestId('command-done').click();
});
