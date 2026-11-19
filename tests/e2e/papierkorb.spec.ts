import { expect, test, type Page } from './fixtures';
import { createProject, freshStart } from './helpers';

/**
 * Papierkorb: Gelöschtes bleibt 15 Tage und wird danach endgültig gelöscht – auf dem Gerät und (über die
 * Warteschlange) in der Ablage. Ohne Online-Ablage räumt die App beim Start auf.
 */

const DAY = 24 * 60 * 60 * 1000;

const idb = <T,>(page: Page, fn: string, arg?: unknown) =>
  page.evaluate(
    ([f, a]) =>
      new Promise<T>((resolve) => {
        const r = indexedDB.open('schadstellen-aufmass');
        r.onsuccess = () => {
          const db = r.result;
          // eslint-disable-next-line no-new-func
          void (new Function('db', 'a', `return (${f})(db, a)`) as (db: IDBDatabase, a: unknown) => Promise<T>)(db, a).then((v) => {
            db.close();
            resolve(v);
          });
        };
      }),
    [fn, arg] as const,
  );
const getAll = (store: string) => `(db) => new Promise((res) => { const q = db.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result); })`;
const putAll = (store: string) => `(db, list) => new Promise((res) => { const t = db.transaction('${store}', 'readwrite'); for (const x of list) t.objectStore('${store}').put(x); t.oncomplete = () => res(1); })`;

test('Nach 15 Tagen endgültig gelöscht (auch für die Ablage), jüngere bleiben wiederherstellbar; Hinweis im Papierkorb', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Altlast');
  const [cc] = await idb<{ id: string; name: string }[]>(page, getAll('costCenters'));
  const now = Date.now();
  await idb(page, putAll('costCenters'), [
    { ...cc, id: 'cc-alt', name: 'Abgelaufen', deletedAt: now - 16 * DAY },
    { ...cc, id: 'cc-neu', name: 'Gestern', deletedAt: now - DAY },
  ]);
  // Neustart der App: ohne Online-Ablage wird gleich aufgeräumt
  await page.reload();
  await expect.poll(async () => (await idb<{ id: string }[]>(page, getAll('costCenters'))).map((c) => c.id).sort()).toEqual([cc.id, 'cc-neu'].sort());
  // Tombstone in der Warteschlange: die Ablage (und damit jedes Gerät) löscht ihn ebenfalls
  const out = await idb<{ id: string; deleted?: boolean }[]>(page, getAll('outbox'));
  expect(out.find((e) => e.id === 'costCenters:cc-alt')?.deleted).toBe(true);
  expect(out.find((e) => e.id === 'costCenters:cc-neu')?.deleted).toBeUndefined();

  await page.getByTestId('open-trash').click();
  const trash = page.getByTestId('trash-dialog');
  await expect(trash.getByTestId('trash-info')).toHaveText('Gelöschtes bleibt 15 Tage im Papierkorb und wird danach endgültig gelöscht.');
  await expect(trash.getByTestId('trash-entry')).toHaveCount(1);
  await expect(trash.getByTestId('trash-entry')).toContainText('Gestern');
  await expect(trash.getByTestId('trash-entry')).toContainText('noch 14 Tage');
});

test('Projekt im Papierkorb: in allen Tools ausgeblendet, nach 15 Tagen überall endgültig gelöscht', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Abriss');
  const [p] = await idb<{ id: string; rev: number }[]>(page, getAll('projects'));
  // vor 16 Tagen in den Papierkorb gelegt
  await idb(page, putAll('projects'), [{ ...p, deletedAt: Date.now() - 16 * DAY, rev: p.rev + 1 }]);
  await page.goto('./baupad/projektregister');
  await expect.poll(async () => (await idb<{ id: string }[]>(page, getAll('projects'))).length).toBe(0);
  const meta = await idb<{ key: string; value: unknown }[]>(page, getAll('meta'));
  expect(meta.find((m) => m.key === 'deletedProjects')?.value).toEqual([p.id]);
  const out = await idb<{ id: string; deleted?: boolean }[]>(page, getAll('outbox'));
  expect(out.find((e) => e.id === `projects:${p.id}`)?.deleted).toBe(true);
  await expect(page.getByTestId('trash-open')).toHaveAttribute('data-count', '0');
});

test('Papierkorb „Auswählen“: alle wiederherstellen bzw. ausgewählte endgültig löschen (mit Rückfrage)', async ({ page }) => {
  await freshStart(page);
  for (const n of ['Alt 1', 'Alt 2', 'Alt 3']) {
    await page.goto('./baupad/projektregister');
    await page.getByTestId('register-new').click();
    await page.getByTestId('project-name').fill(n);
    await page.getByTestId('project-save').click();
    await expect(page.locator(`[data-testid="register-row"][data-name="${n}"]`)).toHaveCount(1);
    await page.locator(`[data-testid="register-row"][data-name="${n}"]`).getByTestId('register-delete').click();
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(page.locator(`[data-testid="register-row"][data-name="${n}"]`)).toHaveCount(0);
  }
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('trash-open')).toHaveAttribute('data-count', '3');
  await page.getByTestId('trash-open').click();
  const trash = page.getByTestId('trash-dialog');
  // einen auswählen → endgültig löschen (Rückfrage)
  await trash.getByTestId('trash-select').click();
  await trash.getByTestId('trash-entry').filter({ hasText: 'Alt 1' }).getByTestId('trash-pick').check();
  await expect(trash.getByTestId('select-count')).toHaveText('1 Eintrag');
  await trash.getByTestId('trash-purge-selected').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('nicht rückgängig');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(trash.getByTestId('trash-entry')).toHaveCount(2);
  expect((await idb<{ name: string }[]>(page, getAll('projects'))).map((p) => p.name).sort()).toEqual(['Alt 2', 'Alt 3']);
  // alle auswählen → wiederherstellen
  await trash.getByTestId('trash-select').click();
  await trash.getByTestId('select-all').click();
  await expect(trash.getByTestId('select-count')).toHaveText('2 Einträge');
  await trash.getByTestId('trash-restore-selected').click();
  await expect(trash.getByTestId('trash-empty')).toBeVisible();
  await page.goto('./baupad/projektregister');
  await expect(page.getByTestId('register-row')).toHaveCount(2);
});

test('Berichte, Formulare, Mängelpläne und Material: löschen = Papierkorb des Tools, wiederherstellen, nach 15 Tagen endgültig', async ({ page }) => {
  await freshStart(page);
  // Material über die Oberfläche anlegen und löschen
  await page.goto('./baupad/materialverwaltung?t=material');
  await page.getByTestId('material-new').click();
  const d = page.getByTestId('material-dialog');
  await d.getByTestId('material-name').fill('Epoxidharz');
  await d.getByTestId('material-unit').selectOption('kg');
  await d.getByTestId('material-save').click();
  await expect(d).toHaveCount(0);
  await page.locator('[data-testid="material-row"][data-name="Epoxidharz"]').getByTestId('material-open').click();
  await d.getByTestId('material-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Papierkorb');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(page.locator('[data-testid="material-row"][data-name="Epoxidharz"]')).toHaveCount(0);
  await expect(page.getByTestId('trash-open')).toHaveAttribute('data-count', '1');
  await page.getByTestId('trash-open').click();
  const trash = page.getByTestId('trash-dialog');
  await expect(trash.getByTestId('trash-entry')).toContainText('Material „Epoxidharz“');
  await trash.getByTestId('trash-restore').click();
  await expect(trash.getByTestId('trash-empty')).toBeVisible();
  await trash.getByRole('button', { name: 'Schließen' }).last().click();
  await expect(page.locator('[data-testid="material-row"][data-name="Epoxidharz"]')).toHaveCount(1);

  // Bericht und Mängelplan im Papierkorb (vor 2 bzw. 16 Tagen): der jüngere steht im Papierkorb, der ältere ist weg
  const now = Date.now();
  await idb(page, putAll('reports'), [
    { id: 'rep-neu', projectId: null, type: 'regie', no: '1', date: '2026-11-17', status: 'draft', head: { site: 'Halle 3', project: 'Halle 3' }, createdAt: 1, updatedAt: 1, trashedAt: now - 2 * DAY },
    { id: 'rep-alt', projectId: null, type: 'regie', no: '2', date: '2026-11-01', status: 'draft', head: { site: 'Halle 3', project: 'Halle 3' }, createdAt: 1, updatedAt: 1, trashedAt: now - 16 * DAY },
  ]);
  await idb(page, putAll('defectPlans'), [{ id: 'dp-neu', companyId: null, projectId: null, siteName: 'Halle 3', siteNumber: '', siteAddress: '', title: 'EG', createdAt: 1, updatedAt: 1, trashedAt: now - DAY }]);
  await page.goto('./baupad/berichte-und-formulare');
  await expect.poll(async () => (await idb<{ id: string }[]>(page, getAll('reports'))).map((r) => r.id)).toEqual(['rep-neu']);
  await expect(page.getByTestId('trash-open')).toHaveAttribute('data-count', '1');
  await page.getByTestId('trash-open').click();
  await expect(trash.getByTestId('trash-entry')).toContainText('Nr. 1');
  await expect(trash.getByTestId('trash-entry')).toContainText('noch 13 Tage');
  await trash.getByRole('button', { name: 'Schließen' }).last().click();
  await page.goto('./baupad/maengelplan');
  await expect(page.getByTestId('trash-open')).toHaveAttribute('data-count', '1');
  await page.getByTestId('trash-open').click();
  await expect(trash.getByTestId('trash-entry')).toContainText('Mängelplan „EG“');
});
