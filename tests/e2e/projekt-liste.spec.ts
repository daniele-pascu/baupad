import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/** Projektliste: in Aufmaß & Abrechnung bearbeiten wie in allen Tools; Materialverwaltung zeigt Projekte gleich an */

test('Aufmaß & Abrechnung: Projekt in der Liste bearbeiten (alle Angaben, gilt überall)', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Wohnanlage Sonnenhof', { number: '2026-04' }, [{ number: '4711', name: 'Tiefgarage' }]);
  await page.goto('./projekte');
  const card = page.getByTestId('project-list').locator('li').first();
  await expect(card).toContainText('4711');
  await card.getByTestId('project-edit').click();
  const d = page.getByTestId('photo-site-dialog');
  await expect(d).toBeVisible();
  // ganzer Dialog: Name, Adresse, Nummer, Kostenstelle, Auftraggeber, Baubeginn, Bemerkung, Farbe
  for (const id of ['photo-site-name', 'photo-site-address', 'photo-site-number', 'cost-center-input', 'project-client', 'project-start', 'project-notes', 'project-color'])
    await expect(d.getByTestId(id).first()).toBeVisible();
  await d.getByTestId('photo-site-address').fill('Hauptstraße 5, 1010 Wien');
  await d.getByTestId('project-client').fill('Muster GmbH');
  await d.getByTestId('photo-site-save').click();
  await expect(d).toHaveCount(0);
  await expect(card).toContainText('Hauptstraße 5, 1010 Wien');
  await expect(card).toContainText('Muster GmbH');

  // Materialverwaltung: gleiche Anzeige – Kostenstelle vor dem Namen, darunter Adresse und Auftraggeber
  await page.goto('./baupad/materialverwaltung?t=baustellen');
  const site = page.getByTestId('material-site').first();
  await expect(site.locator('.proj-prefix')).toHaveText('4711');
  await expect(site.locator('.proj-title')).toContainText('Wohnanlage Sonnenhof');
  await expect(site.locator('.proj-sub')).toContainText('Hauptstraße 5, 1010 Wien');
  await expect(site.locator('.proj-sub')).toContainText('Muster GmbH');
  await expect(site.getByTestId('material-site-count')).toHaveText('Noch keine Materialliste');
  // Suche auch nach Kostenstelle
  await page.getByTestId('materials-search').fill('4711');
  await expect(page.getByTestId('material-site')).toHaveCount(1);
  await page.screenshot({ path: 'tests/output/material-projekte.png' });
});
