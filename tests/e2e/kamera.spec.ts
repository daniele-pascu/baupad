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
  // Format: 16:9 (am PC quer) – Ausrichtung gibt es nicht mehr, sie richtet sich nach dem Gerät
  await page.getByTestId('cam-format').click();
  await expect(page.locator('[data-testid^="cam-orient-"]')).toHaveCount(0);
  await page.getByTestId('cam-ratio-16:9').click();
  await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByTestId('cam-mask')).toHaveAttribute('data-rot', '0');
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('2');
  await page.getByTestId('cam-format').click();
  await page.getByTestId('cam-ratio-1:1').click();
  await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByTestId('cam-mask')).toHaveAttribute('data-rot', '0');
  // Vorschau füllt den Bereich: der quadratische Ausschnitt nutzt die volle Höhe (bzw. Breite) der Ansicht
  const vb = (await page.locator('.cam-view').boundingBox())!;
  const fr = (await page.locator('.cam-mask-frame').boundingBox())!;
  expect(Math.max(fr.height / vb.height, fr.width / vb.width)).toBeGreaterThan(0.98);
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('3');
  await expect(page.getByTestId('cam-last').locator('img')).toBeVisible();
  // oben links X (schließen), oben rechts die Übertragung (ohne Firma: nur ein leerer Platz); kein Menü mehr
  await expect(page.getByTestId('cam-menu')).toHaveCount(0);
  await expect(page.getByTestId('cam-upload')).toHaveCount(0);
  const closeBox = (await page.getByTestId('cam-close').boundingBox())!;
  const siteBox = (await page.getByTestId('cam-site').boundingBox())!;
  expect(closeBox.x).toBeLessThan(siteBox.x);
  // X → Fotos der Baustelle
  await page.getByTestId('cam-close').click();
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
  expect(await ratio()).toBeCloseTo(1, 2); // 1:1
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

test('Installierte App: Kamera → X öffnet die Fotos des gewählten Projekts (nicht die Tools); Neuladen bleibt dort', async ({ page }) => {
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
  await page.getByTestId('cam-close').click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Wohnanlage Süd');
  await expect(page.getByTestId('photo-thumb')).toHaveCount(1);
  await expect(page.getByTestId('tools-title')).toHaveCount(0);
  // Neuladen während die App läuft: bleibt auf der Seite (nur ein echter App-Start beginnt in den Tools)
  await page.reload();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Wohnanlage Süd');
});

test.describe('Kamera-Zoom', () => {
  const openCamera = async (page: import('./fixtures').Page) => {
    await freshStart(page);
    await page.goto('./#/fotos/kamera');
    await page.getByTestId('cam-site').click();
    await page.getByTestId('cam-site-new').click();
    await page.getByTestId('photo-site-name').fill('Zoom Halle');
    await page.getByTestId('photo-site-save').click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
    await expect.poll(() => page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  };
  const lastPhotoSize = async (page: import('./fixtures').Page) => {
    await page.getByTestId('cam-last').click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    const m = /(\d+) × (\d+)/.exec(await page.getByTestId('lightbox').innerText());
    return m ? [Number(m[1]), Number(m[2])] : null;
  };

  test('ohne Zoom der Kamera: digital 1× · 2× · 4×, Foto = Ausschnitt in echter Auflösung', async ({ page }) => {
    await openCamera(page);
    await expect(page.locator('.cam-view')).toHaveAttribute('data-zoom-mode', 'digital');
    await expect(page.getByTestId('cam-zoom').getByRole('button')).toHaveText(['1×', '2×', '4×']);
    await expect(page.getByTestId('cam-zoom-1')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cam-zoom-2').click();
    await expect(page.getByTestId('cam-zoom-2')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('cam-video')).toHaveAttribute('style', /scale\(2\)/);
    const [vw, vh] = await page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]);
    await page.getByTestId('cam-shutter').click();
    await expect(page.getByTestId('cam-counter')).toHaveText('1');
    // Testkamera 4:3 → mit 2× die Mitte in halber Breite und Höhe (nicht hochgerechnet)
    const cw = Math.min(vw, (vh * 4) / 3); // 4:3-Ausschnitt des (queren) Testbilds
    expect(await lastPhotoSize(page)).toEqual([Math.round(cw / 2), Math.round((cw * 3) / 4 / 2)]);
  });

  test('Auflösung Klein · Mittel · Hoch: längste Kante 1280 / 2560 / volle Auflösung (nie vergrößert)', async ({ page }) => {
    await openCamera(page);
    const [vw, vh] = await page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]);
    const full = Math.min(vw, (vh * 4) / 3); // 4:3-Ausschnitt des Testbilds
    const shotWith = async (q: string) => {
      await page.getByTestId('cam-format').click();
      await page.getByTestId(`cam-quality-${q}`).click();
      await expect(page.getByTestId(`cam-quality-${q}`)).toHaveAttribute('aria-checked', 'true');
      await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
      // (nach dem Zurückkommen zählt die Kamera neu)
      await page.getByTestId('cam-shutter').click();
      await expect(page.getByTestId('cam-counter')).toHaveText('1');
      const size = await lastPhotoSize(page);
      await page.keyboard.press('Escape');
      await page.goBack();
      await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
      return size;
    };
    expect(await shotWith('klein')).toEqual([1280, 960]);
    // Einstellung bleibt gemerkt
    await page.getByTestId('cam-format').click();
    await expect(page.getByTestId('cam-quality-klein')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('cam-quality-hint')).toContainText('1280 px');
    await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
    expect(await shotWith('hoch')).toEqual([Math.round(Math.min(full, 4096)), Math.round((Math.min(full, 4096) * 3) / 4)]);
  });

  test('Antippen im Bild: Schärfe und Licht an dieser Stelle, Helligkeit nachstellen', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __c: Record<string, unknown>[] };
      w.__c = [];
      const md = navigator.mediaDevices;
      const sup = md.getSupportedConstraints.bind(md);
      md.getSupportedConstraints = () => ({ ...sup(), pointsOfInterest: true }) as MediaTrackSupportedConstraints;
      const P = MediaStreamTrack.prototype;
      const caps = P.getCapabilities;
      P.getCapabilities = function (this: MediaStreamTrack) {
        const c = caps ? caps.call(this) : {};
        return this.kind === 'video' ? ({ ...c, focusMode: ['continuous', 'single-shot'], exposureMode: ['continuous'], exposureCompensation: { min: -2, max: 2, step: 0.5 } } as MediaTrackCapabilities) : c;
      };
      P.applyConstraints = async function (c?: MediaTrackConstraints) {
        if (c?.advanced?.[0]) w.__c.push(c.advanced[0] as Record<string, unknown>);
      };
    });
    await openCamera(page);
    await expect(page.locator('.cam-view')).toHaveAttribute('data-focus', 'yes');
    const box = (await page.locator('.cam-view').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('cam-focus')).toBeVisible();
    const sent = () => page.evaluate(() => (window as unknown as { __c: Record<string, unknown>[] }).__c);
    await expect.poll(async () => (await sent()).find((c) => c.pointsOfInterest)).toMatchObject({ focusMode: 'single-shot', exposureMode: 'continuous' });
    const poi = ((await sent()).find((c) => c.pointsOfInterest)!.pointsOfInterest as { x: number; y: number }[])[0];
    expect(poi.x).toBeCloseTo(0.5, 1);
    expect(poi.y).toBeCloseTo(0.5, 1);
    // Helligkeit
    await page.getByTestId('cam-ev').fill('1');
    await expect.poll(async () => (await sent()).at(-1)).toEqual({ exposureCompensation: 1 });
    // Tasten im Bild lösen kein Scharfstellen aus
    const n = (await sent()).length;
    await page.getByTestId('cam-zoom-2').click();
    expect((await sent()).filter((c) => c.pointsOfInterest).length).toBe(1);
    expect((await sent()).length).toBe(n);
  });

  test('ohne Unterstützung (z. B. iPhone-Browser): Antippen zeigt nichts an', async ({ page }) => {
    await page.addInitScript(() => {
      const md = navigator.mediaDevices;
      const sup = md.getSupportedConstraints.bind(md);
      md.getSupportedConstraints = () => ({ ...sup(), pointsOfInterest: false }) as MediaTrackSupportedConstraints;
    });
    await openCamera(page);
    await expect(page.locator('.cam-view')).toHaveAttribute('data-focus', 'no');
    const box = (await page.locator('.cam-view').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('cam-focus')).toHaveCount(0);
  });

  test('Kamera meldet einen Zoombereich (Android): Tasten 0,5 · 1× · 2× · 5× · 10×, die Kamera zoomt selbst', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __zooms: number[]; __zoom: number };
      w.__zooms = [];
      w.__zoom = 1;
      const P = MediaStreamTrack.prototype;
      const caps = P.getCapabilities;
      const settings = P.getSettings;
      P.getCapabilities = function (this: MediaStreamTrack) {
        const c = caps ? caps.call(this) : {};
        return this.kind === 'video' ? ({ ...c, zoom: { min: 0.5, max: 10, step: 0.1 } } as MediaTrackCapabilities) : c;
      };
      P.getSettings = function (this: MediaStreamTrack) {
        return { ...settings.call(this), zoom: w.__zoom } as MediaTrackSettings;
      };
      P.applyConstraints = async function (c?: MediaTrackConstraints) {
        const z = (c?.advanced?.[0] as { zoom?: number } | undefined)?.zoom;
        if (z) {
          w.__zooms.push(z);
          w.__zoom = z;
        }
      };
    });
    await openCamera(page);
    await expect(page.locator('.cam-view')).toHaveAttribute('data-zoom-mode', 'camera');
    await expect(page.getByTestId('cam-zoom').getByRole('button')).toHaveText(['0,5', '1×', '2×', '5×', '10×']);
    await page.getByTestId('cam-zoom-5').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __zooms: number[] }).__zooms.at(-1))).toBe(5);
    await expect(page.getByTestId('cam-zoom-5')).toHaveAttribute('aria-pressed', 'true');
    // die Kamera vergrößert selbst: kein digitaler Ausschnitt, volle Auflösung
    await expect(page.getByTestId('cam-video')).not.toHaveAttribute('style', /scale/);
    await page.getByTestId('cam-zoom-0.5').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __zooms: number[] }).__zooms.at(-1))).toBe(0.5);
    const vw = await page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => v.videoWidth);
    await page.getByTestId('cam-shutter').click();
    await expect(page.getByTestId('cam-counter')).toHaveText('1');
    expect((await lastPhotoSize(page))![0]).toBeGreaterThan(vw / 2); // kein Ausschnitt
  });

  test('iPhone meldet die Objektive: Tasten 0,5 · 1× · Tele wechseln das Objektiv (optischer Zoom)', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __asked: string[] };
      w.__asked = [];
      const md = navigator.mediaDevices;
      const gum = md.getUserMedia.bind(md);
      md.enumerateDevices = async () =>
        [
          { kind: 'videoinput', deviceId: 'cam-front', label: 'Frontkamera', groupId: 'g' },
          { kind: 'videoinput', deviceId: 'cam-wide', label: 'Rückkamera', groupId: 'g' },
          { kind: 'videoinput', deviceId: 'cam-ultra', label: 'Rückseitige Ultraweitwinkelkamera', groupId: 'g' },
          { kind: 'videoinput', deviceId: 'cam-tele', label: 'Rückseitige Telekamera', groupId: 'g' },
        ] as unknown as MediaDeviceInfo[];
      md.getUserMedia = async (c?: MediaStreamConstraints) => {
        const v = (c?.video ?? {}) as MediaTrackConstraints & { deviceId?: { exact?: string } };
        w.__asked.push(v.deviceId?.exact ?? 'standard');
        return gum({ video: { width: v.width, height: v.height }, audio: false });
      };
    });
    await openCamera(page);
    await expect(page.locator('.cam-view')).toHaveAttribute('data-zoom-mode', 'lens');
    await expect(page.getByTestId('cam-zoom').getByRole('button')).toHaveText(['0,5', '1×', 'Tele']);
    await expect(page.getByTestId('cam-lens-wide')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cam-lens-tele').click();
    await expect(page.getByTestId('cam-lens-tele')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __asked: string[] }).__asked.at(-1))).toBe('cam-tele');
    await page.getByTestId('cam-lens-ultra').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __asked: string[] }).__asked.at(-1))).toBe('cam-ultra');
    await expect(page.getByTestId('cam-lens-ultra')).toHaveAttribute('aria-pressed', 'true');
  });
});
