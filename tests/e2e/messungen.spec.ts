import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  catchDownload,
  createProject,
  drawRect,
  FIXTURES,
  freshStart,
  markerRelPos,
  OUT,
  planBox,
  readXlsx,
  saveDownload,
  waitForPlan,
  waitSaved,
} from './helpers';

/** Phase 3a: Messarten, neue Formen, Farben, Bauteile, Rückgängig/Wiederholen, Messleiste. */

test.describe.configure({ mode: 'serial' });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

const row = (n: number) => page.locator(`[data-testid="aufmass-row"][data-number="${n}"]`);
const rowCount = () => page.locator('[data-testid="aufmass-row"]').count();

/** Gespeicherte Messungen direkt aus der lokalen Datenbank */
async function storedDamages(p: Page) {
  return p.evaluate(
    () =>
      new Promise<{ number: number; shape: unknown; kind?: string; depth: number | null; componentId?: string | null; deletedAt: number | null }[]>(
        (resolve, reject) => {
          const req = indexedDB.open('schadstellen-aufmass');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const all = req.result.transaction('damages').objectStore('damages').getAll();
            all.onsuccess = () => {
              req.result.close();
              resolve(all.result.filter((d) => !d.deletedAt).sort((a, b) => a.number - b.number));
            };
          };
        },
      ),
  );
}

test('Messarten Linie, Schadstelle, Fläche: Linien zählen nicht zur Fläche, leere Tiefe bleibt leer', async () => {
  await freshStart(page);
  await createProject(page, 'Messarten', {}, ['Decke']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('M-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');

  // Neue Werkzeuge und Farben sind vorhanden
  for (const t of ['select', 'line', 'rect', 'ellipse', 'triangle', 'polyline']) await expect(page.getByTestId(`tool-${t}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Farbe Schwarz' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Farbe Weiß' })).toBeVisible();

  // 1) Linie: nur Länge
  await page.getByTestId('tool-line').click();
  await drawRect(page, box.x + box.width * 0.1, box.y + box.height * 0.2, box.x + box.width * 0.35, box.y + box.height * 0.3);
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('kind-line')).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByTestId('input-width')).toHaveCount(0);
  await expect(dlg.getByTestId('input-depth')).toHaveCount(0);
  await expect(dlg.getByTestId('area-result')).toContainText('keine Fläche');
  await dlg.getByTestId('input-length').fill('3,5');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await expect(row(1)).toHaveAttribute('data-kind', 'line');
  await expect(row(1).getByTestId('row-area')).toHaveText('–');
  await expect(page.getByTestId('sum-area')).toHaveText('0,00');
  await expect(page.getByTestId('sum-length')).toHaveText('3,50 m');

  // 2) Dreieck in Schwarz als Schadstelle ohne Tiefe
  await page.getByRole('button', { name: 'Farbe Schwarz' }).click();
  await page.getByTestId('tool-triangle').click();
  await drawRect(page, box.x + box.width * 0.45, box.y + box.height * 0.2, box.x + box.width * 0.6, box.y + box.height * 0.4);
  await expect(dlg.getByTestId('kind-damage')).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByTestId('input-number')).toHaveValue('2');
  await expect(dlg.getByTestId('input-depth')).toHaveAttribute('placeholder', 'optional');
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('input-width').fill('1');
  await dlg.getByTestId('damage-save').click(); // Tiefe bleibt leer → trotzdem speicherbar
  await expect(dlg).toBeHidden();
  await expect(row(2).locator('td').nth(3)).toHaveText('–');
  await expect(row(2).getByTestId('row-area')).toHaveText('2,00');

  // 3) Rechteck in Weiß als Fläche mit Tiefe (Auswahl vorher aufheben – sonst würde Nr. 2 umgefärbt)
  await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
  await page.getByRole('button', { name: 'Farbe Weiß' }).click();
  await page.getByTestId('tool-rect').click();
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.55, box.x + box.width * 0.4, box.y + box.height * 0.7);
  await dlg.getByTestId('kind-area').click();
  await expect(dlg).toContainText('Neue Fläche');
  await dlg.getByTestId('input-length').fill('1');
  await dlg.getByTestId('input-width').fill('0,5');
  await dlg.getByTestId('input-depth').fill('0,1');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await expect(row(3).getByTestId('row-kind')).toHaveText('Fläche');
  await expect(page.getByTestId('sum-area')).toHaveText('2,50'); // 2,00 + 0,50 – Linie zählt nicht
  await expect(page.getByTestId('side-summary')).toContainText('Linien 3,50 m');

  // Schwarz und Weiß haben eine kontrastierende Kontur
  const strokes = await page.evaluate(() =>
    [...document.querySelectorAll('.viewer-overlay path[data-damage]')].map((p) => ({
      stroke: p.getAttribute('stroke'),
      halo: p.previousElementSibling?.getAttribute('stroke'),
      fill: p.getAttribute('fill'),
    })),
  );
  expect(strokes[0].fill).toBe('none'); // Linie ohne Fläche
  expect(strokes[1].stroke).toBe('#1c1c1e');
  expect(strokes[2].stroke).toBe('#ffffff');
  for (const s of strokes) expect(s.halo).not.toBe(s.stroke);

  // Gespeicherte Werte: leere Tiefe ist null (nicht 0), Linie ohne Breite/Fläche
  await waitSaved(page);
  const stored = await storedDamages(page);
  expect(stored.map((d) => [d.number, d.kind, d.depth])).toEqual([
    [1, 'line', null],
    [2, 'damage', null],
    [3, 'area', 0.1],
  ]);

  // Excel: leere Zellen statt 0; Summe nur Flächen
  const dl = await catchDownload(page, () => page.getByTestId('export-xlsx-plan').click());
  const file = await saveDownload(dl, 'messarten.xlsx');
  const ws = readXlsx(file)['M-1'];
  expect(ws[1].map((c) => c?.v)).toEqual(['Nr.', 'Länge (m)', 'Breite (m)', 'Tiefe (m)', 'Fläche (m²)', 'Messart']);
  expect(ws.slice(2, 5).map((r) => r.map((c) => c?.v ?? null))).toEqual([
    [1, 3.5, null, null, null, 'Linie'],
    [2, 2, 1, null, 2, 'Schadstelle'],
    [3, 1, 0.5, 0.1, 0.5, 'Fläche'],
  ]);
  execFileSync('soffice', ['--headless', '--convert-to', 'csv:Text - txt - csv (StarCalc):59,34,76,1,,1031', '--outdir', OUT, file], { timeout: 90_000 });
  const csv = readFileSync(file.replace(/\.xlsx$/, '.csv'), 'utf8');
  expect(csv).toMatch(/^1;3[.,]50;;;;Linie$/m); // Linie: Breite, Tiefe, Fläche leer
  expect(csv).toMatch(/^2;2[.,]00;1[.,]00;;2[.,]00;Schadstelle$/m); // Tiefe leer, nicht 0
  expect(csv).toMatch(/Summe Fläche \(m²\);;;;2[.,]5/); // Linie zählt nicht zur Fläche
  expect(csv).toMatch(/Summe Länge Linien \(m\);3[.,]5/); // Linien getrennt summiert
});

test('Rückgängig und Wiederholen: Anlegen, Verschieben, per Schaltfläche und Tastatur', async () => {
  await expect(page.getByTestId('undo')).toBeEnabled();
  await expect(page.getByTestId('redo')).toBeDisabled();
  // Letzte Messung (Fläche 3) zurücknehmen und wiederherstellen
  await page.getByTestId('undo').click();
  await expect.poll(rowCount).toBe(2);
  await expect(page.getByTestId('sum-area')).toHaveText('2,00');
  await page.getByTestId('redo').click();
  await expect.poll(rowCount).toBe(3);
  await expect(page.getByTestId('sum-area')).toHaveText('2,50');

  // Tastatur: Strg+Z / Strg+Umschalt+Z
  await page.locator('.side-head h2').click();
  await page.keyboard.press('Control+z');
  await expect.poll(rowCount).toBe(2);
  await page.keyboard.press('Control+Shift+Z');
  await expect.poll(rowCount).toBe(3);

  // Verschieben zurücknehmen
  await page.getByTestId('tool-select').click();
  await row(3).click();
  const before = await markerRelPos(page, 3);
  const box = await planBox(page);
  const cx = box.x + box.width * ((before.x + before.w / 2) * 1);
  const cy = box.y + box.height * (before.y + before.h / 2);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 30, { steps: 6 });
  await page.mouse.up();
  const moved = await markerRelPos(page, 3);
  expect(moved.x - before.x).toBeGreaterThan(0.03);
  await page.getByTestId('undo').click();
  await expect.poll(async () => Math.abs((await markerRelPos(page, 3)).x - before.x)).toBeLessThan(0.002);
  await page.getByTestId('redo').click();
  await expect.poll(async () => Math.abs((await markerRelPos(page, 3)).x - moved.x)).toBeLessThan(0.002);
  await waitSaved(page);
});

test('Bauteile sind ausgeblendet; vorhandene Bauteil-Daten bleiben erhalten', async () => {
  await expect(page.getByTestId('tool-component')).toHaveCount(0);
  await page.keyboard.press('b'); // früheres Tastenkürzel ohne Wirkung
  await expect(page.getByTestId('component-dialog')).toHaveCount(0);
  // Bestehende Zuordnung (Daten aus älteren Versionen) bleibt beim Bearbeiten unverändert erhalten
  const projectId = page.url().split('#/p/')[1].split('/')[0];
  await page.evaluate(async (pid) => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('schadstellen-aufmass');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['components', 'damages'], 'readwrite');
        const all = tx.objectStore('damages').getAll();
        all.onsuccess = () => {
          const d = (all.result as { number: number; deletedAt: number | null; planId: string; componentId?: string; rev: number }[]).find((x) => x.number === 2 && !x.deletedAt)!;
          const meta = { createdAt: 1, updatedAt: 1, rev: 1, deviceId: 'alt', deletedAt: null };
          tx.objectStore('components').put({ id: 'comp-alt', projectId: pid, planId: d.planId, letter: 'A', name: 'Wand', color: '#e03131', x: 10, y: 10, ...meta });
          tx.objectStore('damages').put({ ...d, componentId: 'comp-alt', rev: d.rev + 1 });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  }, projectId);
  await page.reload();
  await waitForPlan(page);
  await expect(page.locator('[data-component]')).toHaveCount(0); // nicht mehr im Plan angezeigt
  await row(2).getByRole('button', { name: 'Schadstelle 2 bearbeiten' }).click();
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg.getByTestId('input-component')).toHaveCount(0);
  await dlg.getByTestId('input-length').fill('2,5');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const d2 = (await storedDamages(page)).find((d) => d.number === 2)!;
  expect(d2.componentId).toBe('comp-alt');
  await page.reload(); // Rückgängig-Verlauf für den nächsten Test leeren
  await waitForPlan(page);
});

test('Messleiste verstellbar: Grenzen, gespeichert, Markierungen und Daten unverändert', async () => {
  await page.getByTestId('tool-select').click();
  const side = page.getByTestId('editor-side');
  const w0 = (await side.boundingBox())!.width;
  expect(Math.abs(w0 - 440)).toBeLessThan(2);
  const marks0 = await Promise.all([1, 2, 3].map((n) => markerRelPos(page, n)));
  const data0 = JSON.stringify(await storedDamages(page));

  const drag = async (dx: number) => {
    const r = (await page.getByTestId('side-resizer').boundingBox())!;
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 4 });
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
  };

  await drag(-200);
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(640);
  // Die Markierungen sitzen weiterhin an derselben Stelle des Plans
  const marks1 = await Promise.all([1, 2, 3].map((n) => markerRelPos(page, n)));
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(marks1[i].x - marks0[i].x)).toBeLessThan(0.002);
    expect(Math.abs(marks1[i].y - marks0[i].y)).toBeLessThan(0.002);
    expect(Math.abs(marks1[i].w - marks0[i].w)).toBeLessThan(0.002);
  }
  // Grenzen
  await drag(-1000);
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(720);
  await drag(1200);
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(280);
  // Tastatur
  await page.getByTestId('side-resizer').focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(304);
  // Kein Datensatz wurde verändert
  expect(JSON.stringify(await storedDamages(page))).toBe(data0);
  await expect(page.getByTestId('undo')).toBeDisabled(); // reine Anzeigeänderung, kein Bearbeitungsschritt

  // Breite bleibt nach dem Neuladen erhalten
  await page.reload();
  await waitForPlan(page);
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(304);
  // Doppelklick = Standardbreite
  await page.getByTestId('side-resizer').dblclick();
  await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(440);
  // In der Standardbreite passt die Tabelle ohne seitliches Scrollen
  const fits = await side.locator('.table-wrap').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  await page.screenshot({ path: join(OUT, 'messleiste.png') });
});

test('Datenbank-Umstellung von Version 1: vorhandene Projekte bleiben vollständig erhalten', async () => {
  await page.goto('./');
  await page.evaluate(async () => {
    for (const d of (await indexedDB.databases?.()) ?? []) if (d.name) indexedDB.deleteDatabase(d.name);
    localStorage.clear();
  });
  // Seite ohne App-Code auf demselben Ursprung, damit die App die Datenbank nicht vorher öffnet
  await page.goto('./manifest.webmanifest');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('schadstellen-aufmass', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('projects', { keyPath: 'id' });
          for (const name of ['costCenters', 'files', 'blobs', 'plans', 'damages', 'thumbs', 'views']) {
            db.createObjectStore(name, { keyPath: 'id' }).createIndex('projectId', 'projectId');
          }
          db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['projects', 'costCenters', 'damages'], 'readwrite');
          const meta = { createdAt: 1, updatedAt: 1, rev: 3, deviceId: 'alt', deletedAt: null };
          tx.objectStore('projects').put({ id: 'p-alt', name: 'Altprojekt', site: 'Bestand', address: '', client: '', editor: '', date: '2026-01-15', notes: '', ...meta });
          tx.objectStore('costCenters').put({ id: 'cc-alt', projectId: 'p-alt', name: 'Altbau', sortIndex: 0, ...meta });
          tx.objectStore('damages').put({ id: 'd-alt', projectId: 'p-alt', planId: 'x', number: 1, shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1 }, color: '#e03131', labelOffset: null, length: 1, width: 2, depth: 0.05, area: 2, ...meta });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.goto('./#/projekte');
  await expect(page.getByText('Altprojekt')).toBeVisible();
  await page.getByText('Altprojekt').click();
  await expect(page.getByTestId('project-info')).toContainText('Bestand');
  await expect(page.getByTestId('project-cost-centers')).toContainText('Altbau');

  const info = await page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; project: unknown; damage: unknown; upgradedFrom: unknown }>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['projects', 'damages', 'meta']);
          const p = tx.objectStore('projects').get('p-alt');
          const d = tx.objectStore('damages').get('d-alt');
          const m = tx.objectStore('meta').get('upgradedFrom');
          tx.oncomplete = () => {
            resolve({ version: db.version, stores: [...db.objectStoreNames], project: p.result, damage: d.result, upgradedFrom: m.result?.value });
            db.close();
          };
        };
      }),
  );
  expect(info.version).toBe(4);
  expect(info.stores).toEqual(expect.arrayContaining(['components', 'outbox', 'elements', 'lvDocs', 'projects', 'damages']));
  expect(info.upgradedFrom).toBe(1);
  // Datensätze unverändert (keine neue Revision, keine Felder verändert)
  expect(info.project).toMatchObject({ id: 'p-alt', name: 'Altprojekt', rev: 3 });
  expect(info.damage).toMatchObject({ id: 'd-alt', depth: 0.05, area: 2, rev: 3 });
  expect(info.damage).not.toHaveProperty('kind');
});
