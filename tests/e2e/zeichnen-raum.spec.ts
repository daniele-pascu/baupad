import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from './fixtures';
import { catchDownload, createProject, freshStart, pickTool, saveDownload, waitSaved } from './helpers';

/**
 * Raumstempel (Name + m², Raum automatisch aus einzelnen Linien erkannt, Fläche passt sich an), Schraffur in einem
 * Raum aus einzelnen Linien, Pendeltür mittig auf der Wand, Fänge/Durchbrüche als eigene Taste.
 */

test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; text?: string; room?: { area: number | null; note?: string }; symbol?: { id: string }; shape: { x: number; y: number; w: number; h: number; closed?: boolean; points?: number[][] } };
const elements = () =>
  page.evaluate(
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
const near = (a: number, b: number, tol = 0.011) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(tol);
async function screenOf(p: { x: number; y: number }) {
  const scale = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  return { x: sb.x + p.x * 100 * scale, y: sb.y + p.y * 100 * scale };
}
const endOf = (e: El) => {
  const [, b] = e.shape.points!;
  return { x: e.shape.x + b[0] * e.shape.w, y: e.shape.y + b[1] * e.shape.h };
};
async function escape() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}
async function line(from: { x: number; y: number }, input: string) {
  await pickTool(page, 'draw-line');
  const p = await screenOf(from);
  await page.mouse.click(p.x, p.y);
  await page.getByTestId('command-input').fill(input);
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  await escape();
  return (await elements()).at(-1)!;
}

test('Raumstempel: Raum aus einzelnen Linien, Name + m², Fläche passt sich an, PDF', async () => {
  await freshStart(page);
  await createProject(page, 'Räume', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('R-1');
  await page.getByTestId('new-drawing-save').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  // Raum 6 × 4 m aus vier einzelnen Linien (an den Enden gefangen)
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 150, sb.y + 200);
  await page.getByTestId('command-input').fill('6;0');
  await page.getByTestId('command-input').press('Enter');
  await waitSaved(page);
  await escape();
  const l1 = (await elements()).at(-1)!;
  const o = { x: l1.shape.x, y: l1.shape.y };
  const l2 = await line(endOf(l1), '0;-4');
  expect(endOf(l2).y).toBeGreaterThan(o.y + 3.9); // nach unten
  const l3 = await line(endOf(l2), '-6;0');
  await line(endOf(l3), '0;4');
  // Trennlinie mit Überstand oben und unten (Kreuzungen statt Eckpunkte)
  const part = await line({ x: o.x + 2, y: o.y - 0.5 }, '0;-5');
  const px = part.shape.x;
  near(part.shape.h, 5);

  // Raumstempel im linken Raum
  await pickTool(page, 'draw-room');
  await expect(page.getByTestId('room-prompt')).toBeVisible();
  let p = await screenOf({ x: (o.x + px) / 2, y: o.y + 2 });
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('room-dialog')).toBeVisible();
  const leftArea = (px - o.x) * 4;
  await expect(page.getByTestId('room-dialog-area')).toContainText(`${leftArea.toFixed(2).replace('.', ',')} m²`);
  await page.getByTestId('room-name-input').fill('Küche');
  await page.getByTestId('room-note-input').fill('Fliesen');
  await page.getByTestId('room-ok').click();
  await waitSaved(page);
  const stamp = (await elements()).at(-1)!;
  expect(stamp.type).toBe('text');
  expect(stamp.text).toBe('Küche');
  near(stamp.room!.area!, leftArea, 1e-3);
  expect(stamp.room!.note).toBe('Fliesen');
  await expect(page.getByTestId('room-area').first()).toHaveText(`${leftArea.toFixed(2).replace('.', ',')} m²`);

  // Schraffur im rechten Raum (nur aus Linien begrenzt) → neue geschlossene Fläche bis zu den Linien
  await page.getByTestId('command-done').click();
  await pickTool(page, 'draw-hatch');
  await page.getByTestId('hatch-ok').click();
  p = await screenOf({ x: (px + o.x + 6) / 2, y: o.y + 1 });
  await page.mouse.click(p.x, p.y);
  await waitSaved(page);
  const fill = (await elements()).at(-1)!;
  expect(fill.type).toBe('freehand');
  near(fill.shape.w, o.x + 6 - px);
  near(fill.shape.h, 4);
  await page.getByTestId('command-done').click();
  // Schraffur wieder weg (Rückgängig), Trennlinie löschen → Stempel zeigt den ganzen Raum (24 m²)
  await page.keyboard.press('Control+z');
  await waitSaved(page);
  p = await screenOf({ x: px, y: o.y + 4.35 }); // Überstand unten (außerhalb des Raums)
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('element-bar')).toBeVisible();
  await page.keyboard.press('Delete');
  await waitSaved(page);
  await expect(page.locator('[data-room="1"]')).toHaveAttribute('data-area', '24');
  await expect(page.getByTestId('room-area').first()).toHaveText('24,00 m²');

  // Stempel auswählen: Leiste zeigt Fläche, Name änderbar
  const c = await screenOf({ x: stamp.shape.x + stamp.shape.w / 2, y: stamp.shape.y + stamp.shape.h / 2 });
  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId('room-bar-area')).toHaveText('24,00 m²');
  await page.getByTestId('element-text').fill('Wohnküche');
  await page.getByTestId('element-text').press('Enter');
  await waitSaved(page);
  await expect(page.getByTestId('room-name').first()).toHaveText('Wohnküche');

  // PDF: Name, Fläche und Zusatz als Text
  await escape();
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'raumstempel.pdf');
  const txt = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  expect(txt).toContain('Wohnküche');
  expect(txt).toContain('24,00 m²');
  expect(txt).toContain('Fliesen');
});

test('Pendeltür mittig auf der Wand, Durchbrüche über eigene Taste', async () => {
  const line1 = (await elements()).find((e) => e.type === 'line')!;
  const wy = line1.shape.y;
  await pickTool(page, 'draw-door');
  const pk = page.getByTestId('symbol-picker');
  await pk.getByTestId('symbol-door-swing').click();
  const p = await screenOf({ x: line1.shape.x + 4, y: wy + 0.04 });
  await page.mouse.click(p.x, p.y);
  await waitSaved(page);
  const sw = (await elements()).at(-1)!;
  expect(sw.symbol?.id).toBe('door-swing');
  near(sw.shape.y + sw.shape.h / 2, wy);
  await page.getByTestId('command-done').click();
  await pickTool(page, 'draw-shaft');
  await expect(pk.getByTestId('symbol-group-shaft')).toHaveAttribute('aria-selected', 'true');
  await expect(pk.getByTestId('symbol-chimney')).toBeVisible();
  await expect(pk.getByTestId('symbol-group-sanitary')).toHaveCount(0);
  await pk.getByTestId('symbol-chimney').click();
  await page.getByTestId('command-done').click();
});

test('Ziehen an Eckpunkt/Anfasser: Wand bleibt Wand, Raumstempel bleibt Raumstempel', async () => {
  await escape();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  await pickTool(page, 'draw-wall');
  const s = Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
  const m = (v: number) => v * 100 * s;
  const x0 = sb.x + 150;
  const y0 = sb.y + 520;
  await page.mouse.click(x0, y0);
  await page.mouse.click(x0 + m(4), y0);
  await page.mouse.click(x0 + m(4), y0 + m(2));
  await page.keyboard.press('Enter');
  await waitSaved(page);
  const wall = (await elements()).at(-1)!;
  expect(wall.type).toBe('wall');
  await expect(page.getByTestId('element-bar')).toContainText('Wand');
  // Wand mit der Auswahl antippen → Anfasser
  await escape();
  await page.mouse.click(x0 + m(2), y0);
  await expect(page.getByTestId('vertex-2')).toHaveCount(1);
  // Eckpunkt ziehen
  const drag = async (sel: string, dx: number, dy: number) => {
    const b = (await page.locator(sel).first().boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2 + dy / 2, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 3 });
    await page.mouse.up();
    await waitSaved(page);
  };
  await drag('[data-testid="vertex-2"]', m(1), 0);
  let w2 = (await elements()).find((e) => e.id === wall.id)!;
  expect(w2.type).toBe('wall');
  expect(JSON.stringify(w2.shape)).not.toBe(JSON.stringify(wall.shape));
  // zweiten Eckpunkt ziehen
  await drag('[data-testid="vertex-0"]', -m(1), 0);
  w2 = (await elements()).find((e) => e.id === wall.id)!;
  expect(w2.type).toBe('wall');
  await expect(page.locator(`[data-element="wall"][data-element-id="${wall.id}"]`)).toHaveCount(1);

  // Raumstempel: keine Eckpunkt-Anfasser, Ecke ziehen vergrößert gleichmäßig
  await escape();
  const stamp = (await elements()).find((e) => e.room)!;
  const c = await screenOf({ x: stamp.shape.x + stamp.shape.w / 2, y: stamp.shape.y + stamp.shape.h / 2 });
  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId('room-bar-area')).toBeVisible();
  await expect(page.getByTestId('vertex-0')).toHaveCount(0);
  await drag('[data-handle="se"]', 40, 30);
  const st2 = (await elements()).find((e) => e.id === stamp.id)!;
  expect(st2.type).toBe('text');
  expect(st2.room).toBeTruthy();
  expect(st2.shape.h).toBeGreaterThan(stamp.shape.h * 1.1);
  near(st2.shape.w / st2.shape.h, stamp.shape.w / stamp.shape.h, 0.05);
  await expect(page.locator(`[data-room="1"][data-element-id="${stamp.id}"]`)).toHaveCount(1);
});
