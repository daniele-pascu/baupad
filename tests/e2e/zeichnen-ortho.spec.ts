import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, freshStart, pickTool, saveDownload, waitSaved } from './helpers';

/**
 * Zeichnen kompakt und präzise: 90° / Orthogonal (F8, Richtung wählbar), neue Formen ohne
 * Füllung, feinere Linientypen (Bildschirm und PDF), einheitlich hohe Werkzeugleiste.
 */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { id: string; type: string; style?: Record<string, unknown>; shape: { type: string; x: number; y: number; w: number; h: number; closed?: boolean; points?: number[][] }; createdAt: number };
async function elements(): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null })[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
/** Eckpunkte in m (Objekte ohne Drehung) */
const verts = (s: El['shape']) => (s.points ?? []).map(([u, v]) => ({ x: s.x + u * s.w, y: s.y + v * s.h }));
const scale = async () => Number(await page.getByTestId('plan-viewer').getAttribute('data-scale'));
const sheet = () => page.getByTestId('drawing-sheet');
async function deselect() {
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Escape');
}
async function drag(x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}
/** Linie ziehen und gespeicherte Endpunkte zurückgeben */
async function drawLine(x1: number, y1: number, x2: number, y2: number) {
  await deselect();
  await pickTool(page, 'draw-line');
  await drag(x1, y1, x2, y2);
  await waitSaved(page);
  const els = await elements();
  return verts(els[els.length - 1].shape);
}
const isHoriz = ([a, b]: { x: number; y: number }[]) => Math.abs(a.y - b.y) < 1e-5 && Math.abs(a.x - b.x) > 0.01;
const isVert = ([a, b]: { x: number; y: number }[]) => Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) > 0.01;

test('Einheitliche Werkzeugleiste: alle Registerkarten gleich hoch, Darstellung in einer Zeile', async () => {
  await freshStart(page);
  // frühere Voreinstellung mit Füllfarbe darf neue Formen nicht ungefragt füllen
  await page.evaluate(() => localStorage.setItem('drawStyle', JSON.stringify({ fillColor: '#2f9e44', fillTransparency: 50 })));
  await createProject(page, 'Ortho', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('O-1');
  await nd.getByTestId('new-drawing-save').click();
  await expect(sheet()).toBeVisible();
  const bar = page.getByTestId('draw-toolbar');
  const heights: number[] = [];
  for (const t of ['draw', 'modify', 'style', 'measure', 'view']) {
    await bar.getByTestId(`ribbon-tab-${t}`).click();
    heights.push(Math.round((await bar.boundingBox())!.height));
  }
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  // Darstellung: alle Einstellungen vorhanden, Standard „Keine Füllung“
  await bar.getByTestId('ribbon-tab-style').click();
  const st = bar.getByTestId('ribbon-style');
  for (const id of ['style-line-type', 'style-line-width']) await expect(st.getByTestId(id)).toBeVisible();
  // Voreinstellung ohne Füllungswahl: neue Formen sind beim Zeichnen immer ungefüllt
  await expect(st.getByTestId('style-fill-type')).toHaveCount(0);
  await expect(st.getByTestId('ribbon-no-fill-hint')).toBeVisible();
  // so niedrig wie „Ändern“
  await bar.getByTestId('ribbon-tab-modify').click();
  const hModify = (await bar.boundingBox())!.height;
  await bar.getByTestId('ribbon-tab-style').click();
  expect(Math.abs((await bar.boundingBox())!.height - hModify)).toBeLessThanOrEqual(1);
  await bar.getByTestId('ribbon-tab-draw').click();
});

test('90° / Orthogonal: F8 schaltet um, Linien nur waagrecht/senkrecht, Richtung wählbar, aus = freier Winkel', async () => {
  const sb = (await sheet().boundingBox())!;
  const x = sb.x + 120;
  const y = sb.y + 120;
  // aus: freier (schräger) Winkel
  const free = await drawLine(x, y, x + 300, y + 130);
  expect(isHoriz(free) || isVert(free)).toBe(false);
  // F8: ein – deutlich hervorgehoben
  const toggle = page.getByTestId('ortho-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await deselect();
  await page.keyboard.press('F8');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveClass(/active-toggle/);
  await expect(toggle).toContainText('90° ein');
  const s = await scale();
  // schräg gezogen → waagrecht, Länge = waagrechter Anteil
  const h = await drawLine(x, y + 220, x + 300, y + 260);
  expect(isHoriz(h)).toBe(true);
  expect(Math.abs(Math.abs(h[1].x - h[0].x) - 300 / s / 100)).toBeLessThan(0.02);
  // steil gezogen → senkrecht
  expect(isVert(await drawLine(x + 420, y, x + 470, y + 260))).toBe(true);
  // Richtung fest „waagrecht“ – auch bei steiler Bewegung
  const dir = page.getByTestId('ortho-dir');
  await expect(dir).toHaveAttribute('data-dir', 'auto');
  await dir.click();
  await expect(dir).toHaveAttribute('data-dir', 'h');
  expect(isHoriz(await drawLine(x + 560, y, x + 620, y + 250))).toBe(true);
  await dir.click();
  await expect(dir).toHaveAttribute('data-dir', 'v');
  expect(isVert(await drawLine(x + 640, y + 40, x + 900, y + 90))).toBe(true);
  await dir.click();
  await expect(dir).toHaveAttribute('data-dir', 'auto');
  // auch über „Ansicht“ sichtbar
  await page.getByTestId('ribbon-tab-view').click();
  await expect(page.getByTestId('view-ortho')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('ribbon-tab-draw').click();
});

test('90°: Polylinie – jeder Abschnitt waagrecht oder senkrecht, Vorschau rechtwinklig', async () => {
  const sb = (await sheet().boundingBox())!;
  const x = sb.x + 150;
  const y = sb.y + 420;
  await deselect();
  await pickTool(page, 'draw-polyline');
  await page.mouse.click(x, y);
  await page.mouse.click(x + 200, y + 40);
  // Vorschau der nächsten Kante folgt dem 90°-Modus
  await page.mouse.move(x + 230, y + 180, { steps: 4 });
  const pv = (await page.getByTestId('polygon-preview').locator('polyline').getAttribute('points'))!.trim().split(' ').map((q) => q.split(',').map(Number));
  const [p1, p2] = pv.slice(-2);
  expect(Math.abs(p1[0] - p2[0])).toBeLessThan(0.5); // senkrecht
  await page.mouse.click(x + 230, y + 180);
  await page.mouse.click(x + 60, y + 210);
  await page.keyboard.press('Enter');
  await waitSaved(page);
  const els = await elements();
  const pl = els[els.length - 1];
  expect(pl.shape).toMatchObject({ type: 'freehand', closed: false });
  const v = verts(pl.shape);
  expect(v).toHaveLength(4);
  for (let i = 1; i < v.length; i++) expect(isHoriz([v[i - 1], v[i]]) || isVert([v[i - 1], v[i]])).toBe(true);
  expect(isHoriz([v[0], v[1]])).toBe(true);
  expect(isVert([v[1], v[2]])).toBe(true);
  expect(isHoriz([v[2], v[3]])).toBe(true);
});

test('90° unabhängig vom Zoom; F8 aus = wieder freie Winkel', async () => {
  await deselect();
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  const s = await scale();
  const box = (await page.getByTestId('plan-viewer').boundingBox())!;
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.55;
  const l = await drawLine(x, y, x + 200, y + 60);
  expect(isHoriz(l)).toBe(true);
  expect(Math.abs(Math.abs(l[1].x - l[0].x) - 200 / s / 100)).toBeLessThan(0.01);
  await deselect();
  await page.keyboard.press('F8');
  await expect(page.getByTestId('ortho-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('ortho-dir')).toHaveCount(0);
  const f = await drawLine(x, y + 80, x + 200, y + 160);
  expect(isHoriz(f) || isVert(f)).toBe(false);
  await page.getByRole('button', { name: 'Gesamten Plan anzeigen' }).click();
});

test('Neue geschlossene Formen ohne Füllung; Füllung später über Darstellung; bestehende Formen unverändert', async () => {
  const sb = (await sheet().boundingBox())!;
  await deselect();
  await pickTool(page, 'draw-rect');
  await drag(sb.x + 520, sb.y + 380, sb.x + 700, sb.y + 520);
  await waitSaved(page);
  let els = await elements();
  const r1 = els[els.length - 1];
  expect(r1.type).toBe('rect');
  expect(r1.style).toMatchObject({ noFill: true }); // eigene Einstellung, nicht 100 % Transparenz
  expect(r1.style?.fillTransparency).not.toBe(100); // frühere Voreinstellung bleibt für später erhalten
  await expect(page.locator(`[data-element-id="${r1.id}"] path[data-fill]`)).toHaveCount(0);
  await expect(page.locator(`[data-element-id="${r1.id}"] path[data-line-type]`)).toBeVisible(); // Umrandung sichtbar
  await expect(page.getByTestId('element-info')).toContainText('Fläche');
  const info = await page.getByTestId('element-info').textContent();
  // Dreieck und Polygon ebenfalls ohne Füllung
  await deselect();
  await pickTool(page, 'draw-triangle');
  await drag(sb.x + 740, sb.y + 380, sb.x + 860, sb.y + 500);
  await deselect();
  await pickTool(page, 'draw-polygon');
  for (const [dx, dy] of [[0, 0], [90, 0], [90, 70], [0, 70]]) await page.mouse.click(sb.x + 520 + dx, sb.y + 540 + dy);
  await page.keyboard.press('Enter');
  await waitSaved(page);
  els = await elements();
  for (const e of els.slice(-2)) expect(e.style).toMatchObject({ noFill: true });
  await expect(page.locator('[data-element] path[data-fill]')).toHaveCount(0);

  // Füllung später manuell: Rechteck auswählen → Darstellung → Vollton
  await deselect();
  await page.mouse.click(sb.x + 520, sb.y + 450); // linke Kante
  const bar = page.getByTestId('element-bar');
  await expect(bar).toBeVisible();
  await bar.getByTestId('style-toggle').click();
  await bar.getByTestId('style-fill-type').selectOption('solid');
  await expect(page.locator(`[data-element-id="${r1.id}"] path[data-fill="solid"]`)).toHaveCount(1);
  await waitSaved(page);
  const r1b = (await elements()).find((e) => e.id === r1.id)!;
  expect(r1b.style).toMatchObject({ noFill: false });
  expect(r1b.shape).toEqual(r1.shape); // Geometrie unverändert
  await expect(page.getByTestId('element-info')).toHaveText(info!); // Fläche/Umfang unverändert
  // andere Formen behalten ihre Darstellung
  for (const e of (await elements()).filter((x) => x.type === 'triangle' || (x.type === 'freehand' && x.shape.closed))) expect(e.style).toMatchObject({ noFill: true });
  await bar.getByTestId('style-toggle').click();
});

test('Linientypen fein: kleine Welle/Zickzack (zoomunabhängig), gleichmäßige Striche, PDF als Vektor', async () => {
  const sb = (await sheet().boundingBox())!;
  await deselect();
  await pickTool(page, 'draw-line');
  await drag(sb.x + 100, sb.y + 600, sb.x + 460, sb.y + 600);
  await waitSaved(page);
  const line = (await elements()).at(-1)!;
  const bar = page.getByTestId('element-bar');
  const len0 = await bar.getByTestId('element-length').inputValue();
  await bar.getByTestId('style-toggle').click();
  const path = page.locator(`[data-element-id="${line.id}"] path[data-line-type]`);
  /** größter Abstand des Pfads von der Geraden (px) */
  const amplitude = async () => {
    const d = (await path.getAttribute('d'))!;
    const ys = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Number(m[2]));
    return (Math.max(...ys) - Math.min(...ys)) / 2;
  };
  for (const t of ['wave', 'zigzag'] as const) {
    await bar.getByTestId('style-line-type').selectOption(t);
    await expect(path).toHaveAttribute('data-line-type', t);
    const a = await amplitude();
    expect(a).toBeGreaterThan(0.8);
    expect(a).toBeLessThan(2.6); // vorher ca. 3,7 px
    // beim Vergrößern bleibt das Muster gleich fein
    await page.getByRole('button', { name: 'Vergrößern' }).click();
    expect(Math.abs((await amplitude()) - a)).toBeLessThan(0.3);
    await page.getByRole('button', { name: 'Gesamten Plan anzeigen' }).click();
  }
  await bar.getByTestId('style-line-type').selectOption('dashed');
  const dash = (await path.getAttribute('stroke-dasharray'))!.split(' ').map(Number);
  expect(dash).toHaveLength(2);
  expect(dash[0]).toBeLessThan(12);
  await waitSaved(page);
  const after = (await elements()).find((e) => e.id === line.id)!;
  expect(after.shape).toEqual(line.shape);
  expect(after.style).toMatchObject({ lineType: 'dashed' });
  expect(await bar.getByTestId('element-length').inputValue()).toBe(len0);

  // PDF: Strichmuster als Vektor
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'ortho-linientypen.pdf');
  const ops = execFileSync('python3', ['-c', "import re,sys,zlib\nd=open(sys.argv[1],'rb').read()\nfor m in re.finditer(rb'stream\\r?\\n(.*?)\\r?\\nendstream', d, re.S):\n  try: print(zlib.decompress(m.group(1)).decode('latin-1'))\n  except Exception: pass", pdf], { encoding: 'utf8' });
  expect(ops).toMatch(/\[\s*[\d.]+\s+[\d.]+\s*\]\s+0\s+d/);
  execFileSync('pdftoppm', ['-png', '-r', '110', '-singlefile', pdf, join('tests', 'output', 'ortho-linientypen')]);
});

test('Aufmaß unverändert: Messungen werden weiterhin leicht gefüllt dargestellt', async () => {
  await deselect();
  await page.getByTestId('mode-measure').click();
  await pickTool(page, 'tool-rect');
  const sb = (await sheet().boundingBox())!;
  await drag(sb.x + 100, sb.y + 700, sb.x + 260, sb.y + 800);
  const dlg = page.getByTestId('damage-dialog');
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  await expect(page.locator('g:has(> path[data-damage]) > path[data-fill="solid"]')).toHaveCount(1);
});
