import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { catchDownload, createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, stored, waitForPlan, waitSaved } from './helpers';

/** Mehrfachauswahl: Pläne, Messungen, Aufmaße, LV (Dokumente und Positionen), Mitarbeiter */

async function importPlan(page: Page, nr: string) {
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill(nr);
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
}
const confirm = (page: Page, name: string | RegExp) => page.getByTestId('confirm-dialog').getByRole('button', { name }).click();

test('Mehrfachauswahl: Messungen im Plan, Pläne gemeinsam ändern und löschen, Aufmaße zusammenführen', async ({ page }) => {
  test.setTimeout(180_000);
  await freshStart(page);
  await createProject(page, 'Mehrfach', {}, ['EG']);

  // Plan P-1 mit drei Messungen
  await importPlan(page, 'P-1');
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  for (const [i, len] of ['2', '3', '4'].entries()) {
    await pickTool(page, 'tool-rect');
    const x = box.x + box.width * (0.15 + i * 0.22);
    await drawRect(page, x, box.y + box.height * 0.3, x + box.width * 0.12, box.y + box.height * 0.45);
    await dlg.getByTestId('input-length').fill(len);
    await dlg.getByTestId('input-width').fill('1');
    await dlg.getByTestId('damage-save').click();
    await expect(dlg).toHaveCount(0);
  }
  await waitSaved(page);
  if (await page.getByTestId('mobile-tab-table').isVisible()) await page.getByTestId('mobile-tab-table').click();
  const rows = page.getByTestId('aufmass-row');
  await expect(rows).toHaveCount(3);

  // Messungen: zwei auswählen → Farbe ändern
  await page.getByTestId('damages-select').click();
  await expect(page.getByTestId('damages-select-bar')).toBeVisible();
  await rows.nth(0).click(); // Zeile antippen wählt aus
  await rows.nth(1).getByTestId('aufmass-row-select').check();
  await expect(page.getByTestId('damages-select-bar').getByTestId('select-count')).toHaveText('2 Messungen');
  await page.getByTestId('damages-bulk-edit').click();
  const bd = page.getByTestId('bulk-damage-dialog');
  await bd.getByRole('radio', { name: 'Blau' }).click();
  await bd.getByTestId('bulk-damage-save').click();
  await expect(bd).toHaveCount(0);
  await expect(page.getByTestId('damages-select-bar')).toHaveCount(0); // Auswahl endet nach dem Ändern
  const colors = await rows.locator('.color-dot').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.background));
  expect(colors[0]).toBe('rgb(28, 126, 214)');
  expect(colors[1]).toBe(colors[0]);
  expect(colors[2]).not.toBe(colors[0]);

  // Darstellung gemeinsam ändern: zwei Messungen → Wellenlinie und Schraffur (Flächen)
  await page.getByTestId('damages-select').click();
  await rows.nth(0).getByTestId('aufmass-row-select').check();
  await rows.nth(1).getByTestId('aufmass-row-select').check();
  await page.getByTestId('damages-bulk-edit').click();
  await bd.getByTestId('bulk-damage-style').click();
  await bd.getByTestId('style-line-type').selectOption('wave');
  await bd.getByTestId('style-fill-type').selectOption('hatch');
  await bd.getByTestId('bulk-damage-save').click();
  await expect(bd).toHaveCount(0);
  await waitSaved(page);
  const styled = (await stored(page, 'damages')).filter((d) => !d.deletedAt && (d.style as { lineType?: string } | undefined)?.lineType === 'wave');
  expect(styled).toHaveLength(2);
  for (const d of styled) expect((d.style as { fillType?: string }).fillType).toBe('hatch');

  // zwei Messungen auf einmal löschen
  await page.getByTestId('damages-select').click();
  await page.getByTestId('damages-select-bar').getByTestId('select-all').click();
  await rows.nth(2).getByTestId('aufmass-row-select').uncheck();
  await page.getByTestId('damages-bulk-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('2 Messungen löschen?');
  await confirm(page, 'Löschen');
  await expect(rows).toHaveCount(1);
  await waitSaved(page);

  // zwei weitere Pläne
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  for (const nr of ['P-2', 'P-3']) {
    await importPlan(page, nr);
    await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  }
  const planRows = page.getByTestId('plan-row');
  await expect(planRows).toHaveCount(3);

  // Pläne: P-2 und P-3 gemeinsam ändern (Ebene)
  await page.getByTestId('plans-select').click();
  await page.locator('[data-testid="plan-row"][data-plan="P-2"]').click(); // Zeile wählt aus, öffnet nicht
  await page.locator('[data-testid="plan-row"][data-plan="P-3"]').getByTestId('plan-select').check();
  await expect(page.getByTestId('plans-select-bar').getByTestId('select-count')).toHaveText('2 Pläne');
  await page.getByTestId('plans-bulk-edit').click();
  const bp = page.getByTestId('bulk-plan-dialog');
  await bp.getByTestId('bulk-plan-floor').fill('UG2');
  await bp.getByTestId('bulk-plan-save').click();
  await expect(bp).toHaveCount(0);
  await expect(page.locator('[data-testid="plan-row"][data-plan="P-2"]')).toContainText('UG2');
  await expect(page.locator('[data-testid="plan-row"][data-plan="P-3"]')).toContainText('UG2');
  await expect(page.locator('[data-testid="plan-row"][data-plan="P-1"]')).not.toContainText('UG2');
  // Esc beendet die Auswahl
  await page.getByTestId('plans-select').click();
  await expect(page.getByTestId('plans-select-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('plans-select-bar')).toHaveCount(0);

  // zwei Aufmaße anlegen (aus der Auswahl) und zu einem zusammenführen
  const newSheet = async (plans: string[]) => {
    await page.getByTestId('plans-select').click();
    for (const p of plans) await page.locator(`[data-testid="plan-row"][data-plan="${p}"]`).getByTestId('plan-select').check();
    await page.getByTestId('plans-select-bar').getByTestId('select-more').click();
    await page.getByTestId('plans-bulk-aufmass').click();
    const ex = page.getByTestId('excel-export');
    await catchDownload(page, () => ex.getByTestId('blatt-export').click());
    await expect(ex).toHaveCount(0);
    if (await page.getByTestId('plans-select-bar').isVisible()) await page.getByTestId('plans-select-bar').getByTestId('select-close').click();
  };
  await newSheet(['P-1']);
  await newSheet(['P-2', 'P-3']);
  const blocks = page.getByTestId('aufmass-block');
  await expect(blocks).toHaveCount(2);
  await page.getByTestId('aufmass-select').click();
  await page.getByTestId('aufmass-select-bar').getByTestId('select-all').click();
  await page.getByTestId('aufmass-bulk-merge').click();
  await expect(blocks).toHaveCount(1);
  await expect(blocks.getByTestId('aufmass-plans')).toContainText('P-1, P-2, P-3');

  // Pläne P-2 und P-3 auf einmal löschen
  await page.getByTestId('plans-select').click();
  await page.locator('[data-testid="plan-row"][data-plan="P-2"]').getByTestId('plan-select').check();
  await page.locator('[data-testid="plan-row"][data-plan="P-3"]').getByTestId('plan-select').check();
  await page.getByTestId('plans-bulk-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('2 Pläne löschen?');
  await confirm(page, '2 Pläne löschen');
  await expect(planRows).toHaveCount(1);
  await expect(planRows).toHaveAttribute('data-plan', 'P-1');
});

test('Mehrfachauswahl im LV: Positionen gemeinsam ändern und löschen, Dokumente ohne Preise und löschen', async ({ page }) => {
  test.setTimeout(150_000);
  await freshStart(page);
  await createProject(page, 'LV mehrfach', {}, ['Garage']);
  for (const f of ['kurz-lv.pdf', 'lv-beispiel.pdf']) {
    await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, f));
    await page.getByTestId('lv-review').getByTestId('lv-review-save').click();
    await expect(page.getByTestId('lv-review')).toHaveCount(0);
  }
  await expect(page.getByTestId('lv-doc-tab')).toHaveCount(2);

  // Positionen im Kurz-LV
  await page.getByTestId('lv-doc-tab').filter({ hasText: 'Musterarbeiten' }).click();
  const rows = page.getByTestId('lv-row');
  await expect(rows).toHaveCount(8);
  await page.getByTestId('lv-pos-select').click();
  await rows.nth(0).click();
  await rows.nth(1).getByTestId('lv-pos-check').check();
  await expect(page.getByTestId('lv-pos-select-bar').getByTestId('select-count')).toHaveText('2 Positionen');
  await page.getByTestId('lv-pos-bulk-edit').click();
  const bd = page.getByTestId('lv-bulk-dialog');
  await bd.getByTestId('lv-bulk-ep').fill('12,5');
  await bd.getByTestId('lv-bulk-save').click();
  await expect(bd).toHaveCount(0);
  await expect(rows.nth(0)).toContainText('12,50 €');
  await expect(rows.nth(1)).toContainText('12,50 €');
  const third = await rows.nth(2).getAttribute('data-number');
  // zwei Positionen löschen
  await page.getByTestId('lv-pos-select').click();
  await rows.nth(0).getByTestId('lv-pos-check').check();
  await rows.nth(1).getByTestId('lv-pos-check').check();
  await page.getByTestId('lv-pos-bulk-delete').click();
  await confirm(page, 'Löschen');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toHaveAttribute('data-number', third!);

  // Dokumente: beide ohne Preise, dann eines löschen
  await page.getByTestId('lv-docs-select').click();
  await expect(page.getByTestId('lv-doc')).toHaveCount(0); // beim Auswählen zugeklappt
  await page.getByTestId('lv-docs-select-bar').getByTestId('select-all').click();
  await page.getByTestId('lv-docs-select-bar').getByTestId('select-more').click();
  await page.getByTestId('lv-docs-bulk-noprices').click();
  await confirm(page, 'Preise entfernen');
  for (const t of await page.getByTestId('lv-doc-tab').all()) await expect(t).toContainText('0,00 €'); // Summe ohne Preise
  await page.getByTestId('lv-doc-tab').filter({ hasText: 'Musterarbeiten' }).click();
  await expect(rows.first()).not.toContainText('€');
  await page.getByTestId('lv-docs-select').click();
  await page.getByTestId('lv-doc-pick').filter({ hasText: 'Musterarbeiten' }).click();
  await page.getByTestId('lv-docs-bulk-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('1 Dokument löschen?');
  await confirm(page, 'Löschen');
  await expect(page.getByTestId('lv-doc-tab')).toHaveCount(1);
  await expect(page.getByTestId('lv-doc-tab')).not.toContainText('Musterarbeiten');
});

test('Mehrfachauswahl Mitarbeiter: gemeinsam ändern (Qualifikation, Urlaub), löschen – gelöschte Bauleitung wird im Projekt ausgetragen', async ({ page }) => {
  test.setTimeout(120_000);
  await freshStart(page);
  await createProject(page, 'Baustelle Nord');
  await page.goto('./baupad/arbeitereinteilung/personal');
  const sp = page.getByTestId('staff-page');
  for (const [first, last] of [
    ['Anna', 'Berger'],
    ['Bernd', 'Huber'],
    ['Carla', 'Mayr'],
  ]) {
    await sp.getByTestId('staff-new').click();
    await page.getByTestId('worker-firstName').fill(first);
    await page.getByTestId('worker-lastName').fill(last);
    await page.getByTestId('worker-save').click();
    await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
  }
  const rows = sp.getByTestId('worker-row');
  await expect(rows).toHaveCount(3);

  // Bernd Huber ist Bauleitung des Projekts (über die Personalliste gewählt)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('schadstellen-aufmass');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = <T,>(store: string) =>
      new Promise<T[]>((res) => {
        const q = db.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => res(q.result as T[]);
      });
    const w = (await all<{ id: string; firstName: string }>('workers')).find((x) => x.firstName === 'Bernd')!;
    const p = (await all<Record<string, unknown>>('projects'))[0];
    await new Promise<void>((res) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put({ ...p, siteManager: { workerId: w.id, name: 'Bernd Huber', phone: '0664 1' }, rev: (p.rev as number) + 1 });
      tx.oncomplete = () => res();
    });
    db.close();
  });

  // Anna und Bernd: Qualifikation Polier und Urlaub
  await sp.getByTestId('staff-select').click();
  await rows.filter({ hasText: 'Berger Anna' }).getByTestId('worker-open').click(); // Zeile wählt aus
  await rows.filter({ hasText: 'Huber Bernd' }).getByTestId('worker-select').check();
  await expect(page.getByTestId('staff-select-bar').getByTestId('select-count')).toHaveText('2 Mitarbeiter');
  await page.getByTestId('staff-bulk-edit').click();
  const bd = page.getByTestId('staff-bulk-dialog');
  await bd.getByTestId('staff-bulk-grade').selectOption('polier');
  await bd.getByTestId('staff-bulk-absence').selectOption('urlaub');
  await bd.getByTestId('staff-bulk-save').click();
  await expect(bd).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Berger Anna' })).toContainText('Polier');
  await expect(rows.filter({ hasText: 'Huber Bernd' })).toContainText('Urlaub');
  await expect(rows.filter({ hasText: 'Mayr Carla' })).not.toContainText('Polier');

  // beide löschen → Bernd wird als Bauleitung ausgetragen
  await sp.getByTestId('staff-select').click();
  await rows.filter({ hasText: 'Berger Anna' }).getByTestId('worker-select').check();
  await rows.filter({ hasText: 'Huber Bernd' }).getByTestId('worker-select').check();
  await page.getByTestId('staff-bulk-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('2 Mitarbeiter löschen?');
  await confirm(page, '2 löschen');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.toast').last()).toContainText('Aus der Bauleitung von 1 Projekt ausgetragen');
  const sm = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open('schadstellen-aufmass');
      r.onsuccess = () => res(r.result);
    });
    const p = await new Promise<{ siteManager?: unknown }[]>((res) => {
      const q = db.transaction('projects').objectStore('projects').getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return p[0].siteManager ?? null;
  });
  expect(sm).toBeNull();
});
