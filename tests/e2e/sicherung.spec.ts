import { expect, test } from './fixtures';
import { catchDownload, createProject, freshStart, saveDownload } from './helpers';

/** Phase 6: Erinnerung an die Projektsicherung (Browser-Speicher ist keine Datensicherung). */
test('Sicherungs-Erinnerung erscheint bei alter Sicherung und verschwindet nach dem Sichern', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Erinnerung', {}, ['Keller']);
  // Frisches Projekt: keine Erinnerung
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
  const projectId = page.url().split('/p/')[1].split('/')[0];

  // Letzte Sicherung vor 5 Tagen, danach geändert
  await page.evaluate(async (id) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('schadstellen-aufmass');
      req.onsuccess = () => {
        const tx = req.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key: `lastBackup:${id}`, value: Date.now() - 5 * 86_400_000 });
        tx.objectStore('meta').put({ key: `lastEdit:${id}`, value: Date.now() });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, projectId);
  await page.reload();
  const banner = page.getByTestId('backup-reminder');
  await expect(banner).toContainText('Sicherung empfohlen');

  // In Aufmaß & Abrechnung ebenfalls sichtbar
  await page.getByRole('link', { name: 'Zu Aufmaß & Abrechnung' }).click();
  await expect(page.getByTestId('backup-info')).toContainText('Sicherung empfohlen');
  await page.getByTestId('project-card').click();

  // Jetzt sichern → Datei, Erinnerung verschwindet, Datum wird angezeigt
  const dl = await catchDownload(page, () => page.getByTestId('backup-now').click());
  expect(dl.suggestedFilename()).toMatch(/^Erinnerung_Sicherung_\d{4}-\d{2}-\d{2}\.zip$/);
  await saveDownload(dl, 'erinnerung.zip');
  await expect(banner).toHaveCount(0);
  await page.getByRole('link', { name: 'Zu Aufmaß & Abrechnung' }).click();
  // heutiges Datum in der Zeitzone des Browsers (nicht des Testrechners)
  const today = await page.evaluate(() => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  await expect(page.getByTestId('backup-info')).toContainText(`Letzte Sicherung (.zip): ${today}`);
  await expect(page.getByTestId('backup-info')).not.toContainText('empfohlen');
});
