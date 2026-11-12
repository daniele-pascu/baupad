import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/**
 * Sortierung in allen Werkzeugen gleich: links die Art, daneben ein eigener Pfeil ↑/↓; je angemeldeter Person gemerkt.
 */
test('Sortierung: Art + Pfeil, je Person gemerkt (Materialverwaltung, Aufmaß & Abrechnung)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await createProject(page, 'Bahnhof', { number: '2026-10' }, [{ number: '91090', name: 'Halle' }]);
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Arena', { number: '2026-2' }, [{ number: '9200', name: 'Dach' }]);

  // Materialverwaltung → Baustellen: nach Name, Pfeil dreht die Richtung
  await page.goto('./baupad/materialverwaltung?t=material');
  await page.getByTestId('mat-tab-sites').click();
  const names = () => page.getByTestId('material-site').evaluateAll((els) => els.map((e) => e.getAttribute('data-name')));
  await page.getByTestId('material-site-sort').selectOption('name');
  await expect(page.getByTestId('material-site-sort-dir')).toHaveAttribute('data-dir', 'asc');
  await expect.poll(names).toEqual(['Arena', 'Bahnhof']);
  await page.getByTestId('material-site-sort-dir').click();
  await expect(page.getByTestId('material-site-sort-dir')).toHaveAttribute('data-dir', 'desc');
  await expect.poll(names).toEqual(['Bahnhof', 'Arena']);
  // Kostenstelle / Projektnummer natürlich sortiert (9200 vor 91090)
  await page.getByTestId('material-site-sort').selectOption('number');
  await expect.poll(names).toEqual(['Arena', 'Bahnhof']);
  await page.getByTestId('material-site-sort-dir').click();
  await expect.poll(names).toEqual(['Bahnhof', 'Arena']);

  // gemerkt unter der angemeldeten Person (nicht gerätweit)
  const keys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sort:') && !k.startsWith('sort:local:')));
  await expect.poll(keys).toContain('sort:test-user:materials-sites');
  await page.reload();
  await page.getByTestId('mat-tab-sites').click();
  await expect(page.getByTestId('material-site-sort')).toHaveValue('number');
  await expect(page.getByTestId('material-site-sort-dir')).toHaveAttribute('data-dir', 'desc');
  await expect.poll(names).toEqual(['Bahnhof', 'Arena']);

  // jedes Werkzeug hat seine eigene Sortierung: Aufmaß & Abrechnung unverändert
  await page.goto('./baupad/aufmass-und-abrechnung');
  await expect(page.getByTestId('project-sort')).toHaveValue('changed');
  await expect(page.getByTestId('project-sort-dir')).toHaveAttribute('data-dir', 'desc');
});
