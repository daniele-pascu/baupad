import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { catchDownload, createProject, freshStart, pickTool, saveDownload, waitSaved } from './helpers';

/** CAD Phase 4a (Maus): Bauteile – Türen, Fenster, Elektro (ÖNORM) einsetzen, an Linie ausrichten, Anschlag, Größe, PDF */

test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; symbol?: { id: string; flipX?: boolean; flipY?: boolean }; shape: { x: number; y: number; w: number; h: number; rotation?: number; points?: number[][] } };
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
const near = (a: number, b: number, tol = 0.011) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(tol);
async function escape() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}
async function screenOf(p: { x: number; y: number }) {
  const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  return { x: sb.x + p.x * 100 * scale, y: sb.y + p.y * 100 * scale };
}

test('Tür auf einer Wandlinie: ausgerichtet, Anschlag und Öffnung umschaltbar, Größe per Eingabe', async () => {
  await freshStart(page);
  await createProject(page, 'Bauteile', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('B-1');
  await page.getByTestId('new-drawing-save').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  // waagrechte Wandlinie 6 m
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 150, sb.y + 300);
  await page.getByTestId('command-input').fill('6;0');
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  const [wall] = await elements();
  const wy = wall.shape.y;
  // Tür wählen und auf die Linie setzen
  await escape();
  await pickTool(page, 'draw-door');
  const pk = page.getByTestId('symbol-picker');
  await expect(pk).toBeVisible();
  await pk.getByTestId('symbol-door1').click();
  await expect(page.getByTestId('command-prompt')).toContainText('Tür einflügelig 0,90 × 0,90 m');
  const p = await screenOf({ x: wall.shape.x + 2, y: wy + 0.05 });
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect(page.getByTestId('cad-ghost')).toBeVisible();
  await page.mouse.click(p.x, p.y);
  await waitSaved(page);
  let door = (await elements()).at(-1)!;
  expect(door.type).toBe('symbol');
  expect(door.symbol?.id).toBe('door1');
  near(door.shape.y + door.shape.h, wy); // Öffnungslinie auf der Wand
  near(door.shape.w, 0.9);
  await expect(page.locator('[data-element="symbol"][data-symbol="door1"]')).toHaveCount(1);
  // Größe eintippen (Breite 1,0 m) und zweite Tür setzen
  await page.getByTestId('command-input').fill('1');
  await page.getByTestId('command-input').press('Enter');
  await expect(page.getByTestId('command-prompt')).toContainText('1,00 × 1,00 m');
  const p2 = await screenOf({ x: wall.shape.x + 4.5, y: wy - 0.05 });
  await page.mouse.click(p2.x, p2.y);
  await waitSaved(page);
  near((await elements()).at(-1)!.shape.w, 1);
  await page.getByTestId('command-done').click();
  // erste Tür wählen: Anschlag und Öffnung umschalten
  await pickTool(page, 'draw-select');
  const d = await screenOf({ x: door.shape.x + 0.45, y: door.shape.y + 0.45 });
  await page.mouse.click(d.x, d.y);
  await expect(page.getByTestId('element-bar')).toContainText('Tür einflügelig');
  await page.getByTestId('symbol-flip-x').click();
  await page.getByTestId('symbol-flip-y').click();
  await waitSaved(page);
  door = (await elements()).find((e) => e.id === door.id)!;
  expect(door.symbol).toMatchObject({ flipX: true, flipY: true });
  near(door.shape.y, wy); // Öffnungslinie bleibt auf der Wand, Flügel schwenkt auf die andere Seite
});

test('Fenster mittig in senkrechter Wand, Elektro frei, Geräte im PDF', async () => {
  await escape();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  // senkrechte Wand
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 650, sb.y + 100);
  await page.getByTestId('command-input').fill('0;-4');
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  const wall = (await elements()).at(-1)!;
  await escape();
  await pickTool(page, 'draw-window');
  await page.getByTestId('symbol-picker').getByTestId('symbol-win2').click();
  const p = await screenOf({ x: wall.shape.x + 0.04, y: wall.shape.y + 2 });
  await page.mouse.click(p.x, p.y);
  await waitSaved(page);
  const win = (await elements()).at(-1)!;
  expect(win.symbol?.id).toBe('win2');
  expect([90, 270]).toContain(win.shape.rotation);
  near(win.shape.x + win.shape.w / 2, wall.shape.x); // Mitte auf der Wandlinie
  // Elektro: Steckdose und Geschirrspüler frei im Raum
  await page.getByTestId('symbol-change').click();
  const pk = page.getByTestId('symbol-picker');
  await pk.getByTestId('symbol-group-electro').click();
  await pk.getByTestId('symbol-socket').click();
  await page.mouse.click(sb.x + 400, sb.y + 450);
  await page.getByTestId('symbol-change').click();
  await pk.getByTestId('symbol-group-appliance').click();
  await pk.getByTestId('symbol-dishwasher').click();
  await page.mouse.click(sb.x + 480, sb.y + 450);
  await waitSaved(page);
  await page.getByTestId('command-done').click();
  const syms = (await elements()).filter((e) => e.type === 'symbol').map((e) => e.symbol?.id);
  expect(syms).toEqual(['door1', 'door1', 'win2', 'socket', 'dishwasher']);
  await expect(page.locator('[data-symbol="dishwasher"] text')).toHaveText('GS');
  // Spiegeln eines Bauteils schaltet die Öffnungsrichtung mit
  await page.keyboard.press('Control+a');
  await page.getByTestId('multi-clear').click();
  const dw = (await elements()).at(-1)!;
  // PDF mit Symbolen (Vektor, Kurzzeichen als Text)
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'bauteile.pdf');
  expect(execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' })).toContain('GS');
  execFileSync('pdftoppm', ['-png', '-r', '60', pdf, 'tests/output/bauteile']);
  expect(dw.symbol?.id).toBe('dishwasher');
});

test('Wand: Stärke und Höhe, Länge/Fläche, Tür und Fenster schneiden die Öffnung aus, PDF', async () => {
  await escape();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await waitSaved(page);
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  await pickTool(page, 'draw-wall');
  await expect(page.getByTestId('command-prompt')).toContainText('Wand 0,25 m stark');
  await page.getByTestId('command-input').fill('0,3;2,8');
  await page.getByTestId('command-input').press('Enter');
  await expect(page.getByTestId('command-prompt')).toContainText('Wand 0,30 m stark, 2,80 m hoch');
  // L-förmige Wand: drei Punkte, Enter
  const s = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const m = (v: number) => v * 100 * s;
  const x0 = sb.x + 150;
  const y0 = sb.y + 200;
  await page.mouse.click(x0, y0);
  await page.mouse.click(x0 + m(5), y0);
  await page.mouse.click(x0 + m(5), y0 + m(4));
  await page.keyboard.press('Enter');
  await waitSaved(page);
  let wall = (await elements()).at(-1)!;
  expect(wall.type).toBe('wall');
  await expect(page.getByTestId('element-bar')).toContainText('Wand');
  await expect(page.getByTestId('wall-thickness')).toHaveValue('0,3');
  await expect(page.getByTestId('wall-info')).toContainText(/Länge 9,0\d m · Fläche 25,\d\d m²/);
  await expect(page.locator('[data-element="wall"]')).toHaveAttribute('data-openings', '0');
  // Tür auf die Wandachse
  await escape();
  await pickTool(page, 'draw-door');
  await page.getByTestId('symbol-picker').getByTestId('symbol-door1').click();
  await page.mouse.click(x0 + m(2), y0 + 2);
  // Fenster in den senkrechten Teil
  await page.getByTestId('symbol-change').click();
  await page.getByTestId('symbol-picker').getByTestId('symbol-group-window').click();
  await page.getByTestId('symbol-picker').getByTestId('symbol-win1').click();
  await page.mouse.click(x0 + m(5) + 2, y0 + m(2));
  await page.getByTestId('command-done').click();
  await waitSaved(page);
  await expect(page.locator('[data-element="wall"]')).toHaveAttribute('data-openings', '2');
  // Stärke nachträglich ändern
  await pickTool(page, 'draw-select');
  await page.mouse.click(x0 + m(4), y0);
  await expect(page.getByTestId('wall-thickness')).toBeVisible();
  await page.getByTestId('wall-thickness').fill('0,2');
  await page.getByTestId('wall-thickness').press('Enter');
  await waitSaved(page);
  wall = (await elements()).find((e) => e.id === wall.id)!;
  expect((wall as unknown as { wall: { thickness: number; height: number } }).wall).toEqual({ thickness: 0.2, height: 2.8 });
  // PDF
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'waende.pdf');
  execFileSync('pdftoppm', ['-png', '-r', '60', pdf, 'tests/output/waende']);
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Pages:\s+1/);
});
