import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, waitForPlan } from './helpers';
import { tastenBefunde } from './tasten-check';

/**
 * Tasten-Test für PC, Handy und Tablet (läuft in allen Projekten: pc, iphone, ipad, ipad-quer).
 * Öffnet die Website, jedes Tool und die wichtigsten Dialoge und prüft, dass keine Tasten übereinander liegen,
 * verdeckt oder am Rand abgeschnitten sind. Neue Seiten bzw. Dialoge hier ergänzen.
 */

/** ganze Seite (und offenen Dialog) von oben nach unten durchscrollen und prüfen */
async function pruefe(page: Page, wo: string, out: string[]) {
  await page.waitForTimeout(150);
  const scrollers = async () =>
    page.evaluate(() => {
      const modal = [...document.querySelectorAll('.modal')].pop();
      const el = (modal?.querySelector('.modal-body') as HTMLElement | null) ?? (modal as HTMLElement | undefined) ?? null;
      const target = el && el.scrollHeight > el.clientHeight + 4 ? el : document.scrollingElement!;
      return { h: target.scrollHeight, v: target.clientHeight, modal: target !== document.scrollingElement };
    });
  const s = await scrollers();
  const steps = Math.min(12, Math.max(1, Math.ceil(s.h / Math.max(200, s.v * 0.8))));
  for (let i = 0; i < steps; i++) {
    await page.evaluate(
      ({ y, modal }) => {
        const m = [...document.querySelectorAll('.modal')].pop();
        const el = modal ? ((m?.querySelector('.modal-body') as HTMLElement | null) ?? (m as HTMLElement)) : document.scrollingElement!;
        el.scrollTop = y;
      },
      { y: Math.round(i * s.v * 0.8), modal: s.modal },
    );
    await page.waitForTimeout(80);
    for (const b of await tastenBefunde(page)) out.push(`${wo}: ${b}`);
  }
  await page.evaluate(() => {
    document.scrollingElement!.scrollTop = 0;
    const m = [...document.querySelectorAll('.modal')].pop();
    const b = m?.querySelector('.modal-body') as HTMLElement | null;
    if (b) b.scrollTop = 0;
  });
}

const WEBSITE = ['/', '/produkte', '/baupad', '/unternehmen', '/kontakt', '/zukunft', '/impressum', '/datenschutz', '/baupad/funktionen/aufmass', '/baupad/funktionen/materialverwaltung', '/en', '/en/baupad/features/materialverwaltung'];
const APP = [
  'tools',
  'aufmass-und-abrechnung',
  'projektregister',
  'arbeitereinteilung',
  'arbeitereinteilung/personal',
  'berichte-und-formulare',
  'berichte-und-formulare/vorlagen',
  'zeitaufzeichnung',
  'fotodokumentation',
  'maengelplan',
  'materialverwaltung',
  'materialverwaltung?t=material',
  'materialverwaltung?t=lieferanten',
  'konto',
];

export function tastenTests() {
  // Website abgemeldet prüfen (angemeldet leitet die Website direkt zu den Tools weiter)
  test.describe('Website ohne Anmeldung', () => {
    test.use({ signedIn: false });
    test('Tasten: Website – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
      const out: string[] = [];
      for (const p of WEBSITE) {
        await page.goto(`.${p}`);
        await page.waitForLoadState('networkidle');
        expect(new URL(page.url()).pathname, `Website ${p} wurde umgeleitet`).toBe(p);
        await pruefe(page, `Website ${p}`, out);
      }
      expect(out, out.join('\n')).toEqual([]);
    });
  });

  test('Tasten: alle Tools – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    for (const p of APP) {
      await page.goto(`./baupad/${p}`);
      await page.waitForLoadState('networkidle');
      await pruefe(page, `App ${p}`, out);
    }
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: „Neu“-Dialoge aller Tools – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    const DIALOGE: [string, string][] = [
      ['aufmass-und-abrechnung', 'new-project'],
      ['projektregister', 'register-new'],
      ['arbeitereinteilung', 'add-site'],
      ['arbeitereinteilung/personal', 'staff-new'],
      ['berichte-und-formulare', 'report-new-site'],
      ['fotodokumentation', 'photo-new-site'],
      ['maengelplan', 'defect-new-site'],
      ['materialverwaltung?t=material', 'material-new'],
      ['materialverwaltung?t=lieferanten', 'supplier-new'],
    ];
    for (const [p, id] of DIALOGE) {
      await page.goto(`./baupad/${p}`);
      await page.waitForLoadState('networkidle');
      const btn = page.getByTestId(id).first();
      await expect(btn, `${p}: Taste ${id}`).toBeVisible();
      await btn.click();
      await expect(page.locator('.modal').last()).toBeVisible();
      await pruefe(page, `Dialog ${p} (${id})`, out);
      await page.keyboard.press('Escape');
    }
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Aufmaß mit Plan, Messung und Dialogen – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    await createProject(page, 'Tastentest', { address: 'Teststraße 1' }, ['Tiefgarage']);
    await pruefe(page, 'Projekt', out);
    await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
    const wiz = page.getByTestId('import-wizard');
    await pruefe(page, 'Plan importieren', out);
    await wiz.getByTestId('areas-next').click();
    await wiz.locator('[data-field="planNumber"]').fill('T-1');
    await pruefe(page, 'Plan importieren (Angaben)', out);
    await wiz.getByTestId('import-save').click();
    await waitForPlan(page);
    await pruefe(page, 'Plan-Editor', out);
    const box = await planBox(page);
    await pickTool(page, 'tool-rect');
    await drawRect(page, box.x + box.width * 0.3, box.y + box.height * 0.3, box.x + box.width * 0.45, box.y + box.height * 0.45);
    const dlg = page.getByTestId('damage-dialog');
    await expect(dlg).toBeVisible();
    await dlg.getByTestId('rebar-add').click();
    await pruefe(page, 'Messdialog', out);
    await dlg.getByTestId('input-length').fill('2');
    await dlg.getByTestId('input-width').fill('1');
    await dlg.getByTestId('rebar-count').first().fill('2');
    await dlg.getByTestId('rebar-length').first().fill('1');
    await dlg.getByTestId('damage-save').click();
    await expect(dlg).toBeHidden();
    await pruefe(page, 'Plan-Editor mit Messung', out);
    if (await page.getByTestId('tools-open').isVisible()) await page.getByTestId('tools-open').click();
    await pruefe(page, 'Plan-Editor Leiste offen', out);
    await page.getByTestId('editor-legend').click();
    await pruefe(page, 'Legende', out);
    await page.getByTestId('legend-save').click();
    if (await page.getByTestId('mobile-tab-table').isVisible()) {
      await page.getByTestId('mobile-tab-table').click();
      await pruefe(page, 'Plan-Editor Tabelle', out);
    }
    expect(out, out.join('\n')).toEqual([]);
  });
}
