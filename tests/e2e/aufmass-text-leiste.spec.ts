import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { createProject, FIXTURES, freshStart, planBox, waitForPlan, waitSaved } from './helpers';

/**
 * Aufmaß: eigene Leiste für Texte – Text allein oder Hinweistext mit Linie zum Plan (Punkt, Pfeil, nur Linie).
 * Die Leiste gibt es auch ohne gewählte Messart; „Zurück“ führt zu den Mess-Tools.
 */

type El = { id: string; text?: string; leader?: { dx: number; dy: number; end?: string }; shape: { x: number; y: number; w: number; h: number } };
async function texts(page: Page): Promise<El[]> {
  return page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as (El & { deletedAt: number | null; createdAt: number; type: string })[]).filter((d) => !d.deletedAt && d.type === 'text').sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('Aufmaß: Text-Leiste – Text, Hinweistext mit Punkt und mit Pfeil; Zurück zu den Mess-Tools', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Text-Leiste', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('P-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // ohne Messart: „Text“ ist da und öffnet die eigene Leiste (statt der Mess-Tools)
  await expect(page.getByTestId('tool-mtype')).toHaveAttribute('data-value', 'auto');
  await page.getByTestId('tool-text').click();
  const bar = page.getByTestId('text-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('tool-mtype')).toHaveCount(0);
  await expect(bar.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['text-tool-dot', 'text-tool-arrow', 'text-tool-none']) await expect(bar.getByTestId(id)).toBeVisible();

  // Text allein
  const td = page.getByTestId('text-dialog');
  await page.mouse.click(at(0.25, 0.2).x, at(0.25, 0.2).y);
  await td.getByTestId('text-input').fill('Achse A');
  await td.getByRole('button', { name: 'Einfügen' }).click();
  await expect(page.locator('[data-element="text"]')).toHaveCount(1);
  await expect(page.getByTestId('callout-arrow')).toHaveCount(0);
  // die Leiste bleibt offen (Auswahl zum Verschieben/Ändern)
  await expect(bar).toBeVisible();
  await expect(bar.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');

  // Hinweistext mit Punkt: vom Ziel zur Stelle des Textes
  await bar.getByTestId('text-tool-dot').click();
  await expect(bar.getByTestId('text-tool-dot')).toHaveAttribute('aria-pressed', 'true');
  await drag(page, at(0.5, 0.6), at(0.7, 0.35));
  await expect(td).toBeVisible();
  await expect(td.getByTestId('text-leader-dot')).toHaveAttribute('aria-checked', 'true');
  await td.getByTestId('text-input').fill('Riss, 0,3 mm');
  await td.getByRole('button', { name: 'Einfügen' }).click();
  await expect(page.getByTestId('callout-dot')).toHaveCount(1);
  // der Punkt sitzt am Ziel
  const dot = (await page.getByTestId('callout-dot').boundingBox())!;
  expect(Math.abs(dot.x + dot.width / 2 - at(0.5, 0.6).x)).toBeLessThan(4);
  expect(Math.abs(dot.y + dot.height / 2 - at(0.5, 0.6).y)).toBeLessThan(4);

  // Hinweistext mit Pfeil; Ziel rechts vom Text – der Text steht links davon
  await bar.getByTestId('text-tool-arrow').click();
  await drag(page, at(0.6, 0.8), at(0.35, 0.7));
  await expect(td.getByTestId('text-leader-arrow')).toHaveAttribute('aria-checked', 'true');
  await td.getByTestId('text-input').fill('Fuge');
  await td.getByRole('button', { name: 'Einfügen' }).click();
  await expect(page.getByTestId('callout-head')).toHaveCount(1);
  await waitSaved(page);
  const all = await texts(page);
  expect(all.map((t) => t.text)).toEqual(['Achse A', 'Riss, 0,3 mm', 'Fuge']);
  expect(all[0].leader).toBeUndefined();
  expect(all[1].leader?.end).toBe('dot');
  expect(all[2].leader).toBeDefined();
  expect(all[2].leader?.end).toBeUndefined(); // Pfeil ist die Vorgabe
  expect(all[2].leader!.dx).toBeGreaterThan(0); // Ziel rechts vom Text

  // Zurück: wieder die Mess-Tools
  await bar.getByTestId('text-bar-back').click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId('tool-mtype')).toBeVisible();
  await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'false');
});
