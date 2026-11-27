import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/**
 * Plan zeichnen am PC wie im CAD: Fangpunkt durch kurzes Verweilen merken (ohne Klick), Spurlinie, Abstand eintippen,
 * mit Linksklick bestätigen, dann Länge eintippen und Enter. Eingabe in mm. Zwei Spurlinien → Schnittpunkt.
 */

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'nur am PC (Maus und Tastatur)');

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});
test.afterAll(async () => {
  await page.close();
});

type El = { type: string; shape: { x: number; y: number; w: number; h: number; points?: number[][] }; createdAt: number };
const lines = () =>
  page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null })[]).filter((d) => !d.deletedAt && d.type === 'line').sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
const ends = (l: El) => (l.shape.points ?? []).map(([px, py]) => ({ x: l.shape.x + px * l.shape.w, y: l.shape.y + py * l.shape.h }));
const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

test('Spurlinie durch Verweilen, 250 mm Abstand, Klick bestätigt, 3000 mm Linie mit Enter', async () => {
  await freshStart(page);
  await createProject(page, 'Spur', {}, ['Halle']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('S-1');
  await nd.getByTestId('sheet-paper').selectOption('A3');
  await nd.getByTestId('sheet-orient').selectOption('quer');
  await nd.getByTestId('sheet-scale').selectOption('100');
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  const sb = (await sheet.boundingBox())!;

  // Einstellung: Maße in mm, Verweilzeit 300 ms (Standard)
  await pickTool(page, 'view-snap-kinds');
  const dlg = page.getByTestId('snap-kinds-dialog');
  await expect(dlg.getByTestId('snap-dwell')).toHaveValue('300');
  await dlg.getByTestId('snap-unit').selectOption('mm');
  await dlg.getByTestId('snap-kinds-save').click();
  await expect(dlg).toBeHidden();

  // 1) Wandlinie: Klick, 4000 eintippen, Enter – danach läuft die Linie am Endpunkt weiter, Esc beendet
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 300, sb.y + 400);
  await page.mouse.move(sb.x + 420, sb.y + 400, { steps: 4 });
  await page.keyboard.type('4000');
  await expect(page.getByTestId('dyn-dist')).toContainText('4000 mm');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  await expect(page.getByTestId('command-prompt')).toContainText('Endpunkt'); // nächster Abschnitt beginnt am Endpunkt
  await page.mouse.move(sb.x + 430, sb.y + 380, { steps: 3 });
  await expect(page.getByTestId('dyn-input')).toBeVisible();
  await page.keyboard.press('Escape');
  let ls = await lines();
  expect(ls).toHaveLength(1);
  const [A, B] = ends(ls[0]).sort((p, q) => p.x - q.x);
  near(B.x - A.x, 4);
  near(B.y, A.y);

  // 2) Startpunkt nur kurz überfahren: noch nicht gemerkt, keine Spurlinie
  await pickTool(page, 'draw-line');
  await page.mouse.move(sb.x + 300, sb.y + 400, { steps: 3 });
  await page.waitForTimeout(80);
  await page.mouse.move(sb.x + 300, sb.y + 470, { steps: 3 });
  await expect(page.locator('[data-testid="track-line"]')).toHaveCount(0);
  // 3) kurz darauf stehen bleiben (ohne Klick) → gemerkt; darunter erscheint die senkrechte Spurlinie
  await page.mouse.move(sb.x + 300, sb.y + 400, { steps: 3 });
  await page.waitForTimeout(450);
  await page.mouse.move(sb.x + 301, sb.y + 470, { steps: 6 });
  await expect(page.locator('[data-testid="track-line"][data-axis="v"]')).toHaveCount(1);
  // 4) 250 eintippen: Vorschau genau 250 mm unter dem Punkt; die Spurlinie bleibt, auch wenn die Maus weiterwandert
  await page.keyboard.type('250');
  await expect(page.getByTestId('track-dist')).toContainText('250 mm');
  await page.mouse.move(sb.x + 330, sb.y + 520, { steps: 4 });
  await expect(page.locator('[data-testid="track-line"][data-axis="v"]')).toHaveCount(1);
  // 5) Linksklick bestätigt den Punkt (nicht die Mausposition)
  await page.mouse.click(sb.x + 330, sb.y + 520);
  await expect(page.getByTestId('track-dist')).toHaveCount(0);
  // 6) waagrecht nach rechts zeigen, 3000 eintippen, Enter
  await page.mouse.move(sb.x + 500, sb.y + 520, { steps: 6 });
  await page.keyboard.type('3000');
  await page.keyboard.press('Tab');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  await page.keyboard.press('Escape');
  ls = await lines();
  expect(ls).toHaveLength(2);
  const [P, E] = ends(ls[1]).sort((p, q) => p.x - q.x);
  near(P.x, A.x); // genau unter dem gemerkten Punkt …
  near(P.y, A.y + 0.25); // … im Abstand 250 mm
  near(E.x - P.x, 3); // Länge exakt 3000 mm
  near(E.y, P.y);
});

test('Zwei Spurlinien: Schnittpunkt aus Wandende und einem zweiten Punkt', async () => {
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  const [A, B] = ends((await lines())[0]).sort((p, q) => p.x - q.x);
  // Maßstab des Blatts aus dem bekannten Startpunkt (300 | 400 px)
  const px = 300 / A.x;
  const scr = (p: { x: number; y: number }) => ({ x: sb.x + p.x * px, y: sb.y + p.y * px });
  expect(Math.abs(A.y * px - 400)).toBeLessThan(2);
  // zweiter Bezug: senkrechte Linie weiter rechts oben (Anfangspunkt C)
  await pickTool(page, 'draw-line');
  await page.mouse.click(sb.x + 700, sb.y + 250);
  await page.mouse.move(sb.x + 700, sb.y + 180, { steps: 4 });
  await page.keyboard.type('1000');
  await page.keyboard.press('Tab');
  await page.keyboard.type('90');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  await page.keyboard.press('Escape');
  const C = ends((await lines()).pop()!).sort((p, q) => q.y - p.y)[0];
  await pickTool(page, 'draw-line');
  // Wandende B und Punkt C kurz anfahren (je verweilen, ohne Klick)
  for (const p of [B, C].map(scr)) {
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await page.waitForTimeout(450);
  }
  // in die Nähe des Schnittpunkts: waagrecht neben B, senkrecht unter C
  const X = scr({ x: C.x, y: B.y });
  await page.mouse.move(X.x + 3, X.y - 3, { steps: 6 });
  await expect(page.getByTestId('track-intersection')).toHaveCount(1);
  await expect(page.locator('[data-testid="track-line"]')).toHaveCount(2);
  await page.mouse.click(X.x + 3, X.y - 3);
  await page.mouse.move(X.x + 3, X.y + 80, { steps: 4 });
  await page.keyboard.type('500');
  await page.keyboard.press('Tab');
  await page.keyboard.type('270');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  await page.keyboard.press('Escape');
  const [S, T] = ends((await lines()).pop()!).sort((p, q) => p.y - q.y);
  near(S.x, C.x); // genau im Schnittpunkt der beiden Spurlinien
  near(S.y, B.y);
  near(T.y - S.y, 0.5);
  near(T.x, S.x);
});
