import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';

/** Kamera-Modus mit Chromiums Testkamera: Baustelle wählen, auslösen, Foto landet in der Baustelle */
test('Kamera-Modus: Live-Bild, Auslöser speichert sofort, Zähler, letztes Foto, Beschreibung, Menü', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/fotos');
  await page.getByTestId('photo-new-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-new').click();
  await page.getByTestId('project-name').fill('Garage Jagdschlossgasse');
  await page.getByTestId('project-save').click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Garage Jagdschlossgasse');
  // Kamera-Modus (in der installierten App über „Foto aufnehmen“; im Browser gibt es den Knopf nicht)
  await expect(page.getByTestId('photo-shoot')).toHaveCount(0);
  await page.goto('./#/fotos/kamera?s=n%3Agarage%20jagdschlossgasse');
  await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('cam-site')).toHaveAttribute('data-site', 'Garage Jagdschlossgasse');
  // Suchfenster: Baustellen mit Name, Nummer, Adresse und Anzahl Fotos; Suche; neue Baustelle direkt hier
  await page.getByTestId('cam-site').click();
  await expect(page.getByTestId('cam-site-row')).toHaveCount(1);
  await page.getByTestId('cam-site-search').fill('xyz');
  await expect(page.getByTestId('cam-site-sheet')).toContainText('Keine Baustelle gefunden');
  await page.getByTestId('cam-site-search').fill('');
  await page.getByTestId('cam-site-new').click();
  await page.getByTestId('photo-site-name').fill('Halle 3');
  await page.getByTestId('photo-site-number').fill('91575');
  await page.getByTestId('photo-site-save').click();
  await expect(page.getByTestId('cam-site')).toHaveAttribute('data-site', 'Halle 3');
  await expect(page.getByTestId('cam-site')).toContainText('91575');
  await page.getByTestId('cam-site').click();
  await page.getByTestId('cam-site-row').filter({ hasText: 'Garage Jagdschlossgasse' }).click();
  await expect(page.getByTestId('cam-site')).toHaveAttribute('data-site', 'Garage Jagdschlossgasse');
  await expect.poll(() => page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  // Blitz Aus/Auto/An: Testkamera hat keine Lampe → Hinweis auf die Gerätekamera
  await expect(page.getByTestId('cam-torch')).toBeVisible();
  await page.getByTestId('cam-torch').click();
  await expect(page.locator('.toast', { hasText: 'Gerätekamera' })).toHaveCount(1);
  await page.getByTestId('cam-desc').click();
  await page.getByTestId('cam-desc-input').fill('Rampe Einfahrt');
  await page.getByTestId('cam-desc-save').click();
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('1');
  // Format: 16:9 quer → Testkamera 640×480 wird auf 640×360 zugeschnitten; „Hoch“ dreht auf 480×640
  await page.getByTestId('cam-format').click();
  await page.getByTestId('cam-ratio-16:9').click();
  await page.getByTestId('cam-orient-landscape').click();
  await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByTestId('cam-mask')).toHaveAttribute('data-rot', '0');
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('2');
  await page.getByTestId('cam-format').click();
  await page.getByTestId('cam-ratio-4:3').click();
  await page.getByTestId('cam-orient-portrait').click();
  await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByTestId('cam-mask')).toHaveAttribute('data-rot', '90');
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('3');
  await expect(page.getByTestId('cam-last').locator('img')).toBeVisible();
  // Menü: Fotos der Baustelle
  await page.getByTestId('cam-menu').click();
  // Menü nur: Fotos der Baustelle, Baustelle wechseln, Kamera schließen
  await expect(page.getByTestId('cam-drawer').locator('a, button')).toHaveText([/Fotos der Baustelle/, /Baustelle wechseln/, /Kamera schließen/]);
  await page.getByTestId('cam-drawer').getByRole('link', { name: 'Fotos der Baustelle' }).click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Garage Jagdschlossgasse');
  await expect(page.getByTestId('photo-thumb')).toHaveCount(3);
  await expect(page.getByTestId('photo-thumb').first()).toContainText('Rampe Einfahrt');
  await page.getByTestId('photo-thumb').first().click();
  await expect(page.getByTestId('lightbox')).toContainText('beim Speichern erfasst');
  const ratio = async () => {
    const m = /(\d+) × (\d+)/.exec(await page.getByTestId('lightbox').innerText());
    return Number(m![1]) / Number(m![2]);
  };
  expect(await ratio()).toBeCloseTo(4 / 3, 2); // Sensorbild der Testkamera (quer, 4:3)
  await page.getByTestId('lightbox-next').click();
  expect(await ratio()).toBeCloseTo(16 / 9, 2); // 16:9 quer
  await page.getByTestId('lightbox-next').click();
  expect(await ratio()).toBeCloseTo(3 / 4, 2); // „Hoch“ → gedreht, 4:3 hochkant
});

test('Kamera-Modus: Projektsuche zeigt die Kostenstelle und findet Projekte über die Kostenstelle', async ({ page }) => {
  await freshStart(page);
  await page.goto('/baupad/aufmass-und-abrechnung');
  await createProject(page, 'Wohnanlage Süd', {}, [{ number: '4711', name: 'Tiefgarage' }]);
  await page.goto('./#/fotos/kamera');
  await page.getByTestId('cam-site').click();
  const row = page.getByTestId('cam-site-row').filter({ hasText: 'Wohnanlage Süd' });
  await expect(row).toContainText('KST 4711');
  await page.getByTestId('cam-site-search').fill('4711');
  await expect(page.getByTestId('cam-site-row')).toHaveCount(1);
  await page.getByTestId('cam-site-search').fill('tiefgarage');
  await expect(page.getByTestId('cam-site-row').filter({ hasText: 'Wohnanlage Süd' })).toHaveCount(1);
});

test('Kamera-Modus: Blitz-Symbol wechselt Aus (durchgestrichen) → Auto (A, hervorgehoben) → An (hervorgehoben)', async ({ page }) => {
  // Testkamera mit Lampe vortäuschen
  await page.addInitScript(() => {
    const caps = MediaStreamTrack.prototype.getCapabilities;
    MediaStreamTrack.prototype.getCapabilities = function () {
      return { ...(caps ? caps.call(this) : {}), torch: true } as MediaTrackCapabilities;
    };
    MediaStreamTrack.prototype.applyConstraints = () => Promise.resolve();
  });
  await freshStart(page);
  await page.goto('./#/fotos/kamera');
  await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
  const btn = page.getByTestId('cam-torch');
  const icon = (m: string) => btn.locator(`[data-flash-icon="${m}"]`);
  await expect(icon('off')).toHaveCount(1);
  await expect(btn).not.toHaveClass(/\bon\b/);
  await expect(btn).not.toContainText(/Aus|Auto|An/);
  await btn.click();
  await expect(icon('auto')).toHaveCount(1);
  await expect(icon('auto')).toContainText('A');
  await expect(btn).toHaveClass(/\bon\b/);
  await btn.click();
  await expect(icon('on')).toHaveCount(1);
  await expect(btn).toHaveClass(/\bon\b/);
  await btn.click();
  await expect(icon('off')).toHaveCount(1);
  await expect(btn).not.toHaveClass(/\bon\b/);
  await btn.click();
  await btn.screenshot({ path: 'tests/output/blitz-auto.png' });
});

test('Installierte App: Kamera → Menü „Fotos der Baustelle“ öffnet die Fotos des gewählten Projekts (nicht die Tools); Neuladen bleibt dort', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await freshStart(page);
  await page.goto('/baupad/aufmass-und-abrechnung');
  await createProject(page, 'Wohnanlage Süd', {});
  await page.goto('/baupad/tools');
  await page.getByTestId('tools-camera').click();
  await page.getByTestId('cam-site').click();
  await page.getByTestId('cam-site-row').filter({ hasText: 'Wohnanlage Süd' }).click();
  await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('1');
  await page.getByTestId('cam-menu').click();
  await page.getByTestId('cam-site-photos').click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Wohnanlage Süd');
  await expect(page.getByTestId('photo-thumb')).toHaveCount(1);
  await expect(page.getByTestId('tools-title')).toHaveCount(0);
  // Neuladen während die App läuft: bleibt auf der Seite (nur ein echter App-Start beginnt in den Tools)
  await page.reload();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Wohnanlage Süd');
});
