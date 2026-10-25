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
  await page.goto('./#/projekte');
  await page.reload();
  await expect(page).toHaveTitle('BauPad');
  await expect(page.getByTestId('projects-title')).toHaveText('Projektverwaltung');
  await expect(page.getByRole('img', { name: 'BauPad' })).toBeVisible();
}

export type CostCenterSpec = string | { number: string; name: string };

/**
 * Legt ein Projekt samt Kostenstelle(n) in einem Schritt an und öffnet die Projektseite
 * (Projektinfos, Kostenstelle und Planliste).
 */
export async function createProject(page: Page, name: string, extra: Record<string, string> = {}, costCenters: CostCenterSpec[] = ['Tiefgarage']) {
  await page.getByTestId('new-project').click();
  const form = page.getByTestId('project-form');
  await form.locator('input[name="name"]').fill(name);
  for (const [k, v] of Object.entries(extra)) await form.locator(`[name="${k}"]`).fill(v);
  for (let i = 0; i < costCenters.length; i++) {
    if (i > 0) await form.getByRole('button', { name: '+ Weitere Kostenstelle' }).click();
    const cc = costCenters[i];
    if (typeof cc !== 'string') await form.getByTestId('cost-center-number').nth(i).fill(cc.number);
    await form.getByTestId('cost-center-input').nth(i).fill(typeof cc === 'string' ? cc : cc.name);
  }
  await form.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page.getByTestId('project-title')).toHaveText(name);
}

/** Weitere Kostenstelle über „Projektangaben bearbeiten“ hinzufügen. */
export async function createCostCenter(page: Page, name: string, number = '') {
  await page.getByTestId('edit-project').click();
  const form = page.getByTestId('project-form');
  await form.getByRole('button', { name: '+ Weitere Kostenstelle' }).click();
  await form.getByTestId('cost-center-input').last().fill(name);
  if (number) await form.getByTestId('cost-center-number').last().fill(number);
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId('project-cost-centers')).toContainText(name);
}

/** Kostenstelle auswählen (nur sichtbar, wenn ein Projekt mehrere hat). */
export async function selectCostCenter(page: Page, label: string) {
  const select = page.getByTestId('cost-center-select');
  const value = await select.locator('option').filter({ hasText: label }).first().getAttribute('value');
  await select.selectOption(value!);
  await expect(page.getByTestId('cost-center-title')).toHaveText(label);
}

/** Plan in der Planliste öffnen. */
export async function openPlan(page: Page, planNumber: string) {
  await page.getByTestId('plan-row').filter({ hasText: planNumber }).first().getByTestId('plan-open').click();
}

/** Wartet auf eine Datei – direkt (PC) oder über den Dialog „Datei bereit“ (Touch-Geräte). */
export async function catchDownload(page: Page, trigger: () => Promise<unknown>): Promise<Download> {
  const isTouch = await page.evaluate(() => navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await trigger();
  // PDF: erst Vorschau, dort „Herunterladen“; sonst (Touch) Dialog „Datei bereit“; am PC direkt
  const preview = page.getByTestId('pdf-preview');
  const fileDlg = page.getByTestId('file-dialog');
  const which = await Promise.race([
    download.then(() => 'download' as const),
    preview.waitFor({ state: 'visible', timeout: 90_000 }).then(() => 'preview' as const),
    ...(isTouch ? [fileDlg.waitFor({ state: 'visible', timeout: 90_000 }).then(() => 'file' as const)] : []),
  ]);
  if (which === 'preview') {
    await expect(preview.getByTestId('preview-page').first()).toBeVisible({ timeout: 60_000 });
    await preview.getByTestId('preview-download').click();
  } else if (which === 'file') await fileDlg.getByRole('button', { name: 'Herunterladen' }).click();
  return download;
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

export type XlsxPrint = { orientation: string; fitToPage: boolean; fitToWidth: number; fitToHeight: number; titleRows: string | null; printArea: string | null; footer: string; header: { left: string; center: string; right: string } };
/** Druckeinstellungen je Tabellenblatt (über openpyxl gelesen) */
export function readXlsxPrint(path: string): Record<string, XlsxPrint> {
  const script = `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
out = {}
for ws in wb.worksheets:
    ps = ws.page_setup
    pr = ws.sheet_properties.pageSetUpPr
    out[ws.title] = {"orientation": ps.orientation, "fitToPage": bool(pr and pr.fitToPage), "fitToWidth": ps.fitToWidth, "fitToHeight": ps.fitToHeight,
      "titleRows": ws.print_title_rows, "printArea": ws.print_area if isinstance(ws.print_area, str) else (ws.print_area[0] if ws.print_area else None),
      "footer": ws.oddFooter.right.text or "",
      "header": {"left": ws.oddHeader.left.text or "", "center": ws.oddHeader.center.text or "", "right": ws.oddHeader.right.text or ""}}
print(json.dumps(out))`;
  return JSON.parse(execFileSync('python3', ['-c', script, path], { encoding: 'utf8' }));
}

/** Werkzeug wählen – die Werkzeugleiste klappt nach dem Zeichnen zu und wird bei Bedarf geöffnet. */
export async function pickTool(page: Page, testId: string, how: 'click' | 'tap' = 'click') {
  const btn = page.getByTestId(testId);
  const press = (l: ReturnType<Page['getByTestId']>) => (how === 'tap' ? l.tap() : l.click());
  if (!(await btn.isVisible())) {
    const open = page.getByTestId('tools-open');
    if (await open.isVisible()) await press(open);
  }
  // Zeichenmodus: Werkzeug ggf. auf einer anderen Registerkarte der oberen Leiste
  if (!(await btn.isVisible())) {
    for (const tab of await page.locator('[data-testid^="ribbon-tab-"]').all()) {
      await press(tab);
      if (await btn.isVisible()) break;
    }
  }
  await press(btn);
}

/** Zugeklappte Werkzeugleiste öffnen (z. B. für die Farbwahl). */
export async function openTools(page: Page, how: 'click' | 'tap' = 'click') {
  const open = page.getByTestId('tools-open');
  if (await open.isVisible()) await (how === 'tap' ? open.tap() : open.click());
}
