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
