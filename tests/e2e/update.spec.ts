import { expect, test } from './fixtures';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Automatische Aktualisierung: Eine installierte (offline gespeicherte) Version holt sich
 * eine neu veröffentlichte Version selbst – ohne dass der Benutzer etwas antippen muss.
 * Ein offenes Eingabefenster wird dabei nicht unterbrochen.
 */
const OUTDIR = join('tests', 'output');
const live = join(OUTDIR, 'dist-live');
let server: ChildProcess;

function build(version: string, dir: string) {
  execFileSync('npx', ['vite', 'build', '--outDir', join(OUTDIR, dir), '--emptyOutDir', '--logLevel', 'error'], {
    env: { ...process.env, APP_VERSION: version },
    stdio: 'pipe',
  });
}
function publish(dir: string) {
  rmSync(live, { force: true });
  symlinkSync(dir, live);
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  build('alt', 'dist-a');
  build('neu', 'dist-b');
  publish('dist-a');
  server = spawn('node', ['scripts/serve-pages.mjs', '4175', '/baupad/', live], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
});
test.afterAll(() => {
  server?.kill();
});

test('Neue Version wird automatisch übernommen, offene Eingaben werden nicht unterbrochen', async ({ page }) => {
  await page.goto('http://localhost:4175/baupad/#/projekte');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByTestId('app-version')).toHaveText('BauPad Version alt');

  // Während ein Eingabefenster offen ist, wird nicht neu geladen
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-form').locator('input[name="name"]').fill('Nicht verlieren');
  publish('dist-b'); // neue Version veröffentlicht
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // App wieder im Vordergrund
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('project-form').locator('input[name="name"]')).toHaveValue('Nicht verlieren');

  // Nach dem Schließen des Fensters übernimmt BauPad die neue Version selbst
  await page.getByTestId('project-form').getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('app-version')).toHaveText('BauPad Version neu', { timeout: 20_000 });
  await expect(page.locator('.toast')).toContainText('aktualisiert');
});
