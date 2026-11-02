import { expect, test } from './fixtures';

/**
 * Adressen der App: je Produkt unter /baupad/<Werkzeug>; alte Pfade (/tools, /fotos, /p/… und #/…) und die früheren
 * Website-Infoseiten (/baupad/<slug>) werden still auf die richtige Adresse umgeschrieben.
 */
import { createProject, freshStart } from './helpers';
test('alte Adressen → /baupad/<Werkzeug>', async ({ page }) => {
  await freshStart(page);
  const cases: [string, RegExp][] = [
    ['./tools', /\/baupad\/tools$/],
    ['./#/tools', /\/baupad\/tools$/],
    ['./projekte', /\/baupad\/aufmass-und-abrechnung$/],
    ['./arbeitereinteilung/personal', /\/baupad\/arbeitereinteilung\/personal$/],
    ['./berichte', /\/baupad\/berichte-und-formulare$/],
    ['./fotos/zuletzt', /\/baupad\/fotodokumentation\/zuletzt$/],
    ['./fotos/kamera?s=p:1', /\/baupad\/fotodokumentation\/kamera\?s=p(:|%3A)1$/],
    ['./maengel', /\/baupad\/maengelplan$/],
    ['./konto/firma', /\/baupad\/konto\/firma$/],
    ['./anmelden', /\/baupad\/anmelden$/],
  ];
  for (const [from, to] of cases) {
    await page.goto(from);
    await expect(page, from).toHaveURL(to);
  }
  await page.goto('./baupad/maengelplan');
  await expect(page.getByTestId('defects-title')).toHaveText('Mängelplan');
  await page.goto('./baupad/arbeitereinteilung');
  await expect(page.getByTestId('add-site')).toBeVisible();
  // Projektseiten unter Aufmaß & Abrechnung
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Umzug', {}, ['Keller']);
  await expect(page).toHaveURL(/\/baupad\/aufmass-und-abrechnung\/p\/[^/]+$/);
  const url = page.url();
  await page.goto(url.replace('/baupad/aufmass-und-abrechnung/p/', '/p/'));
  await expect(page).toHaveURL(url);
});

test.describe('ohne Anmeldung', () => {
  test.use({ signedIn: false });
  test('Website-Infoseiten der Werkzeuge: /baupad/funktionen/<slug>, alte Adressen leiten weiter', async ({ page }) => {
    await page.goto('./baupad/fotos');
    await expect(page).toHaveURL(/\/baupad\/funktionen\/fotos$/);
    await page.goto('./en/baupad/fotos');
    await expect(page).toHaveURL(/\/en\/baupad\/features\/fotos$/);
    await page.goto('./baupad/funktionen/maengelplan');
    await expect(page.getByTestId('product-title')).toHaveText('Mängelplan');
  });
});
