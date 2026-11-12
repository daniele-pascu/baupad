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

const WEBSITE = ['/', '/produkte', '/baupad', '/unternehmen', '/kontakt', '/zukunft', '/impressum', '/datenschutz', '/baupad/funktionen/aufmass', '/baupad/funktionen/materialverwaltung', '/en', '/en/baupad/features/materialverwaltung', '/baupad/anmelden', '/baupad/registrieren'];
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
      ['arbeitereinteilung', 'crew-times'], // Einstellungen: Farben je Qualifikation mit Vorschlagsfarben
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
    test.setTimeout(150_000); // viele Dialoge und Leisten (Messarten) – auf dem Handy langsamer
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
    // Messart wählen: Menü und Messdialog je Messart (Stück, Frei, Volumen) – mit Wand-Werkzeug (Hinweisleiste darf nicht über dem Menü liegen)
    await pickTool(page, 'tool-wall');
    await pickTool(page, 'tool-mtype');
    await expect(page.getByTestId('polygon-bar')).toHaveCount(0);
    await expect(page.getByTestId('mtype-menu')).toBeVisible();
    await pruefe(page, 'Menü Messart', out);
    // Stück: Punkte antippen, Leiste mit Anzahl
    await page.getByTestId('mtype-stueck').click();
    {
      const b = await planBox(page);
      await page.mouse.click(b.x + b.width * 0.6, b.y + b.height * 0.4);
    }
    await expect(page.getByTestId('points-count')).toBeVisible();
    await pruefe(page, 'Leiste Stück-Punkte', out);
    await page.getByTestId('points-cancel').click();
    await pickTool(page, 'tool-mtype');
    await page.getByTestId('mtype-frei').click();
    await pickTool(page, 'tool-rect');
    {
      const b = await planBox(page);
      await drawRect(page, b.x + b.width * 0.55, b.y + b.height * 0.55, b.x + b.width * 0.65, b.y + b.height * 0.65);
    }
    await expect(dlg).toBeVisible();
    await pruefe(page, 'Messdialog Frei', out);
    await dlg.getByTestId('measure-type-select').selectOption('stueck');
    await pruefe(page, 'Messdialog Stück', out);
    await dlg.getByTestId('measure-type-select').selectOption('volumen');
    await pruefe(page, 'Messdialog Volumen', out);
    await dlg.getByTestId('measure-type-select').selectOption('schadstelle');
    await pruefe(page, 'Messdialog Schadstelle', out);
    await dlg.getByTestId('damage-cancel').click();
    await expect(dlg).toBeHidden();
    await pickTool(page, 'tool-mtype');
    await page.getByTestId('mtype-flaeche').click();
    if (await page.getByTestId('tools-open').isVisible()) await page.getByTestId('tools-open').click();
    await page.getByTestId('editor-legend').click();
    await pruefe(page, 'Legende', out);
    await page.getByTestId('legend-save').click();
    // Textfeld (Schrift, fett, kursiv, Farbe)
    await pickTool(page, 'tool-text');
    const b2 = await planBox(page);
    await page.mouse.click(b2.x + b2.width * 0.6, b2.y + b2.height * 0.2);
    await expect(page.getByTestId('text-dialog')).toBeVisible();
    await page.getByTestId('text-input').fill('Achse A');
    await pruefe(page, 'Text-Dialog', out);
    await page.getByTestId('text-save').click();
    await expect(page.getByTestId('text-dialog')).toHaveCount(0);
    if (await page.getByTestId('mobile-tab-table').isVisible()) {
      await page.getByTestId('mobile-tab-table').click();
      await pruefe(page, 'Plan-Editor Tabelle', out);
    }
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Plan zeichnen mit Text-Dialog und Text-Leiste – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    await createProject(page, 'Tastentest Zeichnen', {}, ['EG']);
    await page.getByTestId('draw-plan').click();
    await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('Z-1');
    await page.getByTestId('new-drawing-save').click();
    await expect(page.getByTestId('drawing-sheet')).toBeVisible();
    await pruefe(page, 'Plan zeichnen', out);
    await pickTool(page, 'draw-text');
    const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
    await page.mouse.click(sb.x + sb.width * 0.4, sb.y + sb.height * 0.3);
    await expect(page.getByTestId('text-dialog')).toBeVisible();
    await page.getByTestId('text-input').fill('Stiege 1');
    await pruefe(page, 'Text-Dialog (Zeichnen)', out);
    await page.getByTestId('text-save').click();
    await expect(page.getByTestId('element-bar')).toBeVisible();
    await pruefe(page, 'Text-Leiste', out);
    // Mehrfachauswahl und Befehlsleiste (Kopieren mit Eingabefeld): dazu ein Rechteck einfügen
    await page.locator('body').press('Escape');
    await expect(page.getByTestId('element-bar')).toHaveCount(0);
    await pickTool(page, 'draw-rect');
    await page.getByTestId('insert-length').fill('4');
    await page.getByTestId('insert-width').fill('3');
    await pruefe(page, 'Einfügeleiste Rechteck', out);
    await page.getByTestId('insert-submit').click();
    // Objektleiste mit Feldern, Kästchen und angehängten Schluss-Tasten (Darstellung, Löschen, Schließen)
    await expect(page.getByTestId('element-bar')).toBeVisible();
    await pruefe(page, 'Rechteck-Leiste', out);
    await page.getByTestId('style-toggle').click();
    await pruefe(page, 'Rechteck-Leiste mit Darstellung', out);
    await page.getByTestId('style-toggle').click();
    await pickTool(page, 'draw-select-all');
    await expect(page.getByTestId('multi-bar')).toBeVisible();
    await pruefe(page, 'Mehrfachauswahl', out);
    await page.getByTestId('multi-copy').click();
    await expect(page.getByTestId('command-bar')).toBeVisible();
    await pruefe(page, 'Befehlsleiste', out);
    await page.getByTestId('command-done').click();
    // Phase 2: Spiegeln (Original behalten) und Versetzen (Abstand / durch Punkt)
    await pickTool(page, 'draw-select-all');
    await page.getByTestId('multi-mirror').click();
    await expect(page.getByTestId('mirror-keep')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Spiegeln', out);
    await page.getByTestId('command-done').click();
    await pickTool(page, 'draw-offset');
    await expect(page.getByTestId('offset-through')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Versetzen', out);
    await page.getByTestId('command-done').click();
    // Phase 5: Drehen (Bezug, Winkelschritte), Skalieren, Ausrichten
    await pickTool(page, 'draw-select-all');
    await pickTool(page, 'draw-rotate');
    await expect(page.getByTestId('rotate-step')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Drehen', out);
    await page.getByTestId('transform-ref').click();
    await pruefe(page, 'Befehlsleiste Drehen Bezug', out);
    await page.getByTestId('command-done').click();
    await pickTool(page, 'draw-select-all');
    await pickTool(page, 'draw-scale');
    await expect(page.getByTestId('transform-ref')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Skalieren', out);
    await page.getByTestId('command-done').click();
    await pickTool(page, 'draw-select-all');
    await pickTool(page, 'draw-align');
    await expect(page.getByTestId('align-move')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Ausrichten', out);
    await page.getByTestId('command-done').click();
    // Phase 6: Hilfslinie, Abrunden, Abstand, Fangarten-Dialog
    await pickTool(page, 'draw-guide');
    await expect(page.getByTestId('guide-angle')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Hilfslinie', out);
    await page.getByTestId('command-done').click();
    await pickTool(page, 'draw-fillet');
    await expect(page.getByTestId('command-bar')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Abrunden', out);
    await page.getByTestId('command-done').click();
    await pickTool(page, 'draw-distance');
    await expect(page.getByTestId('command-bar')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Abstand', out);
    await page.getByTestId('command-done').click();
    await page.getByTestId('ribbon-tab-precision').click();
    await page.getByTestId('view-snap-kinds').click();
    await expect(page.getByTestId('snap-kinds-dialog')).toBeVisible();
    await pruefe(page, 'Dialog Fangarten', out);
    await page.getByTestId('snap-kinds-dialog').getByRole('button', { name: 'Abbrechen' }).click();
    // Phase 3: Reihe-Dialog und Eigenschaften mit Baustoff-Schraffur für mehrere Objekte
    await pickTool(page, 'draw-select-all');
    await page.getByTestId('multi-array').click();
    await expect(page.getByTestId('array-dialog')).toBeVisible();
    await pruefe(page, 'Dialog Reihe', out);
    await page.getByTestId('array-kind-polar').click();
    await pruefe(page, 'Dialog Reihe polar', out);
    await page.getByTestId('array-dialog').getByRole('button', { name: 'Abbrechen' }).click();
    await pickTool(page, 'draw-select-all');
    await page.getByTestId('ribbon-tab-style').click();
    await page.getByTestId('ribbon-style').getByTestId('style-fill-type').selectOption('hatch');
    await page.getByTestId('ribbon-style').getByTestId('style-hatch-open').click();
    await expect(page.getByTestId('hatch-picker')).toBeVisible();
    await pruefe(page, 'Dialog Schraffur', out);
    await page.getByTestId('hatch-tab-material').click();
    await page.getByTestId('hatch-tile-mat:beton').click();
    await page.getByTestId('hatch-ok').click();
    await pruefe(page, 'Eigenschaften Schraffur', out);
    // Werkzeug Schraffur: Auswahl, danach Befehlsleiste
    await page.locator('body').press('Escape');
    await pickTool(page, 'draw-hatch');
    await expect(page.getByTestId('hatch-picker')).toBeVisible();
    await page.getByTestId('hatch-tab-material').click();
    await page.getByTestId('hatch-tile-mat:stein').click();
    await page.getByTestId('hatch-ok').click();
    await expect(page.getByTestId('hatch-prompt')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Schraffur', out);
    await page.getByTestId('command-done').click();
    // Raumstempel: Befehlsleiste und (wenn das Rechteck frei antippbar ist) Dialog
    await pickTool(page, 'draw-room');
    await expect(page.getByTestId('room-prompt')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Raumstempel', out);
    {
      const r = await page.locator('[data-element="rect"]').first().boundingBox();
      if (r) await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
      if (await page.getByTestId('room-dialog').isVisible({ timeout: 1500 }).catch(() => false)) {
        await pruefe(page, 'Dialog Raumstempel', out);
        await page.getByTestId('room-dialog').getByRole('button', { name: 'Abbrechen' }).click();
      }
    }
    await page.getByTestId('command-done').click();
    // Phase 4: Bauteil-Auswahl, Bauteil-Leiste und Wand
    await page.locator('body').press('Escape');
    await pickTool(page, 'draw-door');
    await expect(page.getByTestId('symbol-picker')).toBeVisible();
    await pruefe(page, 'Dialog Bauteile', out);
    await page.getByTestId('symbol-group-electro').click();
    await pruefe(page, 'Dialog Bauteile Elektro', out);
    await page.getByTestId('symbol-group-shaft').click();
    await pruefe(page, 'Dialog Bauteile Fänge/Durchbrüche', out);
    await page.getByTestId('symbol-group-electro').click();
    await page.getByTestId('symbol-socket').click();
    await expect(page.getByTestId('command-bar')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Bauteil', out);
    await page.getByTestId('command-done').click();
    await pickTool(page, 'draw-wall');
    await expect(page.getByTestId('command-bar')).toBeVisible();
    await pruefe(page, 'Befehlsleiste Wand', out);
    await page.locator('body').press('Escape');
    // Polylinie: Länge je Knick eintippen, danach Abschnitte der ausgewählten Polylinie
    await pickTool(page, 'draw-polyline');
    {
      const vb = (await page.getByTestId('plan-viewer').boundingBox())!;
      const pt = { x: vb.x + vb.width * 0.3, y: vb.y + vb.height * 0.55 };
      await page.mouse.click(pt.x, pt.y);
    }
    await expect(page.getByTestId('polygon-bar').getByTestId('command-input')).toBeVisible();
    await page.getByTestId('command-input').fill('2;0');
    await page.getByTestId('command-input').press('Enter');
    await pruefe(page, 'Polylinie mit Längeneingabe', out);
    await page.getByTestId('command-input').fill('0;2');
    await page.getByTestId('command-input').press('Enter');
    await page.getByTestId('polyline-open').click();
    await expect(page.getByTestId('element-bar')).toBeVisible();
    await page.getByTestId('segments-toggle').click();
    await expect(page.getByTestId('segment-fields')).toBeVisible();
    await pruefe(page, 'Polylinie Abschnitte', out);
    await page.locator('body').press('Escape');
    // Registerkarten Ändern und Präzision
    for (const t of ['modify', 'precision']) {
      await page.getByTestId(`ribbon-tab-${t}`).click();
      await pruefe(page, `Registerkarte ${t}`, out);
    }
    expect(out, out.join('\n')).toEqual([]);
  });
}
