import { expect, type Page, type Download } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
export const OUT = join(process.cwd(), 'tests', 'output');
mkdirSync(OUT, { recursive: true });

export async function freshStart(page: Page) {
  await page.goto('./');
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.();
    for (const d of dbs ?? []) if (d.name) indexedDB.deleteDatabase(d.name);
    localStorage.clear();
  });
  await page.goto('./#/');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Schadstellen-Aufmaß' })).toBeVisible();
}

export async function createProject(page: Page, name: string, extra: Record<string, string> = {}) {
  await page.getByTestId('new-project').click();
  const form = page.getByTestId('project-form');
  await form.locator('input[name="name"]').fill(name);
  for (const [k, v] of Object.entries(extra)) await form.locator(`[name="${k}"]`).fill(v);
  await form.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page.getByTestId('project-title')).toHaveText(name);
}

export async function createCostCenter(page: Page, name: string) {
  await page.getByTestId('new-cost-center').click();
  const dlg = page.getByTestId('prompt-dialog');
  await dlg.locator('input').fill(name);
  await dlg.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByTestId('cost-center-card').filter({ hasText: name })).toBeVisible();
}

/** Wartet auf eine Datei – direkt (PC) oder über den Dialog „Datei bereit“ (Touch-Geräte). */
export async function catchDownload(page: Page, trigger: () => Promise<unknown>): Promise<Download> {
  const isTouch = await page.evaluate(() => navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  if (!isTouch) {
    const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
    return dl;
  }
  await trigger();
  const dlg = page.getByTestId('file-dialog');
  await expect(dlg).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Herunterladen' }).click()]);
  return dl;
}

export async function saveDownload(dl: Download, name?: string): Promise<string> {
  const path = join(OUT, name ?? dl.suggestedFilename());
  await dl.saveAs(path);
  return path;
}

export type XlsxCell = { v: string | number; t: string; fmt: string } | null;
export function readXlsx(path: string): Record<string, XlsxCell[][]> {
  return JSON.parse(execFileSync('python3', [join(process.cwd(), 'tests', 'e2e', 'read_xlsx.py'), path], { encoding: 'utf8' }));
}

/** Wartet, bis der Plan gerendert ist und alles gespeichert wurde. */
export async function waitForPlan(page: Page) {
  await expect(page.getByTestId('plan-viewer')).toBeVisible();
  await expect(page.locator('.viewer-msg')).toHaveCount(0, { timeout: 30_000 });
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
}

/** Position einer Markierung relativ zum gerenderten Plan (0..1) – unabhängig vom Zoom. */
export async function markerRelPos(page: Page, number: number) {
  return page.evaluate((n) => {
    const canvas = document.querySelector('.viewer-canvas') as HTMLCanvasElement;
    const c = canvas.getBoundingClientRect();
    const paths = [...document.querySelectorAll('.viewer-overlay path[data-damage]')] as SVGPathElement[];
    const labels = [...document.querySelectorAll('.damage-label')] as SVGGElement[];
    const idx = labels.findIndex((l) => l.getAttribute('data-label') === String(n));
    const p = paths[idx].getBoundingClientRect();
    return {
      x: (p.left - c.left) / c.width,
      y: (p.top - c.top) / c.height,
      w: p.width / c.width,
      h: p.height / c.height,
    };
  }, number);
}

/** Bildschirmrechteck des Plans */
export async function planBox(page: Page) {
  const box = await page.locator('.viewer-canvas').first().boundingBox();
  if (!box) throw new Error('Plan nicht sichtbar');
  return box;
}

export async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
}

export async function fillMeasures(page: Page, l: string, b: string, t: string, viaEnter = true) {
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('input-length').fill(l);
  if (viaEnter) {
    await dlg.getByTestId('input-length').press('Enter');
    await expect(dlg.getByTestId('input-width')).toBeFocused();
    await page.keyboard.type(b);
    await page.keyboard.press('Enter');
    await expect(dlg.getByTestId('input-depth')).toBeFocused();
    await page.keyboard.type(t);
    await page.keyboard.press('Enter');
  } else {
    await dlg.getByTestId('input-width').fill(b);
    await dlg.getByTestId('input-depth').fill(t);
    await dlg.getByTestId('damage-save').click();
  }
  await expect(dlg).toBeHidden();
}

export async function tableRows(page: Page) {
  return page.locator('[data-testid="aufmass-row"]:visible').evaluateAll((rows) =>
    rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '')),
  );
}
