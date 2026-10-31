import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/** Aufmaß & Abrechnung: Suche, Sortierung (auf-/absteigend), kompakte Karten. */
test('Projekte suchen und sortieren', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Bahnhof Nord', { number: 'P-2', client: 'Stadtwerke' }, [{ number: '4711', name: 'Tiefgarage' }]);
  await page.goto('./#/projekte');
  await createProject(page, 'Arena Süd', { number: 'P-10', address: 'Musterstraße 5' }, [{ number: '1200', name: 'Dach' }]);
  await page.goto('./#/projekte');
  await createProject(page, 'Carport West', {}, [{ number: '9000', name: 'Hof' }]);
  await expect(page.getByTestId('project-number')).toHaveCount(0); // ohne Projektnummer
  await page.goto('./#/projekte');

  const names = () => page.getByTestId('project-card').locator('.proj-title').evaluateAll((els) => els.map((e) => e.lastChild?.textContent?.trim()));
  await expect(page.getByTestId('project-card')).toHaveCount(3);
  await expect(page.getByTestId('project-card').filter({ hasText: 'Bahnhof Nord' })).toContainText('4711');

  // Suche: Kostenstellennummer, Projektnummer, Auftraggeber, Adresse/Baustelle, Name
  for (const [q, hit] of [
    ['4711', 'Bahnhof Nord'],
    ['p-10', 'Arena Süd'],
    ['stadtwerke', 'Bahnhof Nord'],
    ['musterstr', 'Arena Süd'],
    ['carport', 'Carport West'],
  ]) {
    await page.getByTestId('project-search').fill(q);
    await expect.poll(names).toEqual([hit]);
  }
  await page.getByTestId('project-search').fill('gibt es nicht');
  await expect(page.getByText('Kein Projekt gefunden.')).toBeVisible();
  await page.getByTestId('project-search').fill('');

  // Sortieren
  await page.getByTestId('project-sort').selectOption('name');
  await expect.poll(names).toEqual(['Arena Süd', 'Bahnhof Nord', 'Carport West']);
  await page.getByTestId('project-sort-dir').click(); // absteigend
  await expect.poll(names).toEqual(['Carport West', 'Bahnhof Nord', 'Arena Süd']);
  await page.getByTestId('project-sort').selectOption('number'); // aufsteigend
  // Projektnummern natürlich sortiert (P-2 vor P-10); ohne Nummer immer am Ende
  await expect.poll(names).toEqual(['Bahnhof Nord', 'Arena Süd', 'Carport West']);
  await page.getByTestId('project-sort-dir').click(); // absteigend
  await expect.poll(names).toEqual(['Arena Süd', 'Bahnhof Nord', 'Carport West']);
  await page.getByTestId('project-sort').selectOption('costCenter');
  await expect.poll(names).toEqual(['Arena Süd', 'Bahnhof Nord', 'Carport West']); // 1200, 4711, 9000
  await page.getByTestId('project-sort').selectOption('created'); // neueste zuerst
  await expect.poll(names).toEqual(['Carport West', 'Arena Süd', 'Bahnhof Nord']);
  // Sortierung bleibt nach dem Neuladen erhalten
  await page.reload();
  await expect.poll(names).toEqual(['Carport West', 'Arena Süd', 'Bahnhof Nord']);

  // Kompakte Karten: niedrige Höhe am PC
  const h = (await page.getByTestId('project-card').first().boundingBox())!.height;
  expect(h).toBeLessThan(80);
  await page.screenshot({ path: 'tests/output/projektliste.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'tests/output/projektliste-schmal.png' });
});
