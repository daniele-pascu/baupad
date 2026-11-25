import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { chooseMeasureType, createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, ribbonGroup, waitForPlan } from './helpers';
import { kontrastBefunde, tastenBefunde } from './tasten-check';

/** TASTEN_DUNKEL=1: alles im Dunkelmodus öffnen und statt der Lage die Lesbarkeit (Kontrast) prüfen */
const DUNKEL = !!process.env.TASTEN_DUNKEL;

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
    for (const b of DUNKEL ? await kontrastBefunde(page) : await tastenBefunde(page)) out.push(`${wo}${DUNKEL ? ' (dunkel)' : ''}: ${b}`);
  }
  await page.evaluate(() => {
    document.scrollingElement!.scrollTop = 0;
    const m = [...document.querySelectorAll('.modal')].pop();
    const b = m?.querySelector('.modal-body') as HTMLElement | null;
    if (b) b.scrollTop = 0;
  });
}

const WEBSITE = ['/', '/produkte', '/baupad', '/unternehmen', '/kontakt', '/zukunft', '/impressum', '/datenschutz', '/auftragsverarbeitung', '/baupad/funktionen/aufmass', '/baupad/funktionen/materialverwaltung', '/en', '/en/baupad/features/materialverwaltung', '/baupad/anmelden', '/baupad/registrieren'];
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
  'materialverwaltung?t=baustellen',
  'materialverwaltung?t=bestellungen',
  'materialverwaltung?t=geraete',
  'materialverwaltung?t=material',
  'materialverwaltung?t=lieferanten',
  'konto',
  'konto/sicherheit',
  'konto/app',
];

export function tastenTests() {
  // Dunkelmodus: vor jedem Laden der Seite einstellen (übersteht auch das Leeren des Speichers beim Start)
  if (DUNKEL) test.beforeEach(async ({ page }) => page.addInitScript(() => localStorage.setItem('uiTheme', 'dark')));
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
      // Leiste oben: Fenster „Produkte“ (am Handy im aufgeklappten Menü)
      await page.goto('./');
      await page.waitForLoadState('networkidle');
      const menu = page.getByTestId('nav-menu');
      if (await menu.isVisible()) {
        await menu.click();
        await pruefe(page, 'Website Menü offen', out);
      }
      await page.getByTestId('nav-products').click();
      await expect(page.getByTestId('products-panel')).toBeVisible();
      await page.waitForTimeout(300);
      // Fenster klebt nicht an der Taste „Produkte“ (am Handy liegt es direkt darunter im Menü)
      const tb = (await page.getByTestId('nav-products').boundingBox())!;
      const pb = (await page.getByTestId('products-panel').boundingBox())!;
      if (pb.y - (tb.y + tb.height) < 6) out.push(`Website Fenster Produkte: klebt an der Taste (${Math.round(pb.y - (tb.y + tb.height))} px Abstand)`);
      await pruefe(page, 'Website Fenster Produkte', out);
      // BauPad-Seite: Karte eines Tools (Aufmaß) wächst zur eigenen Seite des Tools
      await page.goto('./baupad');
      await page.waitForLoadState('networkidle');
      await page.getByTestId('product-card').first().click();
      await expect(page.getByTestId('product-title')).toHaveText('Aufmaß');
      await expect(page.getByTestId('tool-expand')).toHaveCount(0);
      await pruefe(page, 'Website Tool-Seite Aufmaß', out);
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
      ['materialverwaltung', 'hub-need'], // Bedarf melden: Baustelle wählen
      ['materialverwaltung?t=geraete', 'device-new'],
      ['materialverwaltung?t=material', 'material-new'],
      ['materialverwaltung?t=lieferanten', 'supplier-new'],
      // Papierkorb oben im Seitenkopf
      ['aufmass-und-abrechnung', 'trash-open'],
      ['projektregister', 'trash-open'],
      ['fotodokumentation', 'trash-open'],
      ['berichte-und-formulare', 'trash-open'],
      ['maengelplan', 'trash-open'],
      ['materialverwaltung', 'trash-open'],
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
    // Zeitaufzeichnung: „+ Arbeiter“ (zuerst die einmalige Frage nach den Arbeitszeiten schließen)
    await page.goto('./baupad/zeitaufzeichnung');
    await page.getByTestId('worktimes-later').click();
    await page.getByTestId('times-pick').click();
    await expect(page.getByTestId('times-pick-dialog')).toBeVisible();
    await pruefe(page, 'Dialog zeitaufzeichnung (times-pick)', out);
    await page.keyboard.press('Escape');
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: installierte App – Fotos mit „Foto aufnehmen“, Projekt anlegen, Projektseite – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    // wie auf dem Home-Bildschirm: Kamera-Tasten erscheinen nur in der installierten App
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    await freshStart(page);
    await page.goto('./baupad/tools');
    await expect(page.getByTestId('tools-camera')).toBeVisible();
    await pruefe(page, 'Installiert: Tools', out);
    await page.goto('./baupad/fotodokumentation');
    await expect(page.getByTestId('photos-camera')).toBeVisible();
    await pruefe(page, 'Installiert: Fotos', out);
    await page.getByTestId('photo-new-site').click();
    await expect(page.getByTestId('project-picker')).toBeVisible();
    await pruefe(page, 'Installiert: Projekt wählen', out);
    await page.getByTestId('project-picker').getByTestId('picker-new').click();
    await page.getByTestId('project-name').fill('Tastentest Fotos');
    await page.getByTestId('project-save').click();
    await expect(page.getByTestId('photo-site-title')).toHaveText('Tastentest Fotos');
    await expect(page.getByTestId('photo-shoot')).toBeVisible();
    await pruefe(page, 'Installiert: Fotos im Projekt', out);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Schnellzugriff, Projektregister (Reiter, Nadel, Suche) und Heute auf der Baustelle – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await page.clock.setFixedTime(new Date('2026-11-24T09:00:00')); // Dienstag: Arbeitstag
    await freshStart(page);
    await createProject(page, 'Tastentest Schnellzugriff mit einem recht langen Projektnamen');
    await page.goto('./baupad/aufmass-und-abrechnung');
    await createProject(page, 'Halle Nord');
    await page.goto('./baupad/aufmass-und-abrechnung');
    await createProject(page, 'Lindenstraße 8');
    // Personal: zwei eingeteilt, einer noch frei
    await page.goto('./baupad/arbeitereinteilung/personal');
    const wd = page.getByTestId('staff-page');
    for (const [first, last] of [
      ['Anna', 'Huber'],
      ['Tom', 'Maier'],
      ['Lisa', 'Berger-Hohenstein'],
    ]) {
      await wd.getByTestId('staff-new').click();
      await wd.getByTestId('worker-firstName').fill(first);
      await wd.getByTestId('worker-lastName').fill(last);
      await wd.getByTestId('worker-save').click();
    }
    await page.goto('./baupad/arbeitereinteilung');
    await page.getByTestId('add-site').click();
    await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Halle Nord' }).click();
    await page.locator('[data-testid="site-card"][data-site="Halle Nord"] [data-day="0"] [data-testid="day-add"]').click();
    const dlg = page.getByTestId('assign-dialog');
    for (const n of ['Huber Anna', 'Maier Tom']) await dlg.locator(`[data-testid="assign-worker"][data-worker="${n}"] input`).check();
    await dlg.getByTestId('assign-save').click();
    await expect(page.getByTestId('team-today')).toBeVisible();
    await pruefe(page, 'Team mit Heute auf der Baustelle', out);
    // Ansicht „Arbeiter“: Woche je Arbeiter (Kürzel je Tag), Reihenfolge A–Z
    await page.getByTestId('crew-view-workers').click();
    await expect(page.getByTestId('crew-worker-week')).toBeVisible();
    await pruefe(page, 'Team Ansicht Arbeiter', out);
    await page.getByTestId('crew-ww-order-name').click();
    await pruefe(page, 'Team Ansicht Arbeiter A–Z', out);
    await page.getByTestId('crew-view-sites').click();
    // Weiterführen: einzelne Baustellen in die nächste Woche
    await page.getByTestId('crew-forward').click();
    await expect(page.getByTestId('forward-dialog')).toBeVisible();
    await pruefe(page, 'Team In nächste Woche weiterführen', out);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('forward-dialog')).toHaveCount(0);
    // Projektregister: Nadel, Reiter, Suche
    await page.goto('./baupad/projektregister');
    await page.getByTestId('register-pin').first().click();
    await pruefe(page, 'Projektregister Alle', out);
    await page.getByTestId('register-tab-angeheftet').click();
    await pruefe(page, 'Projektregister Angeheftet', out);
    await page.getByTestId('register-search').fill('halle');
    await expect(page.getByTestId('register-search-all')).toBeVisible();
    await pruefe(page, 'Projektregister Suche', out);
    // Tools: Schnellzugriff oben, Heute auf der Baustelle unten
    await page.goto('./baupad/tools');
    await expect(page.getByTestId('quick-item').first()).toBeVisible();
    await expect(page.getByTestId('crew-today')).toBeVisible();
    await pruefe(page, 'Tools mit Schnellzugriff und Heute', out);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Kamera-Modus (X links, Übertragung rechts, Zoom, Beschreibung, letztes Foto mit Zähler) – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    await page.goto('./#/fotos/kamera');
    await expect(page.getByTestId('camera-page')).toBeVisible();
    await expect(page.getByTestId('cam-close')).toBeVisible();
    await pruefe(page, 'Kamera ohne Baustelle', out);
    // Baustelle anlegen und ein Foto machen (Zähler auf dem letzten Foto)
    await page.getByTestId('cam-site').click();
    await page.getByTestId('cam-site-new').click();
    await page.getByTestId('photo-site-name').fill('Tastentest Kamera mit einem recht langen Baustellennamen');
    await page.getByTestId('photo-site-save').click();
    await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
    await page.getByTestId('cam-shutter').click();
    await expect(page.getByTestId('cam-counter')).toHaveText('1');
    // Zoom-Tasten unten in der Mitte, Beschreibung darüber, Seitenleiste rechts
    await expect(page.getByTestId('cam-zoom')).toBeVisible();
    await page.getByTestId('cam-zoom-2').click();
    await page.getByTestId('cam-desc').click();
    await page.getByTestId('cam-desc-input').fill('Riss in der Stütze B4 neben der Einfahrt zur Tiefgarage');
    await page.getByTestId('cam-desc-save').click();
    await expect(page.getByTestId('cam-desc-chip')).toBeVisible();
    await pruefe(page, 'Kamera mit Foto, Zoom und Beschreibung', out);
    // Format und Auflösung
    await page.getByTestId('cam-format').click();
    await expect(page.getByTestId('cam-format-sheet')).toBeVisible();
    await page.getByTestId('cam-quality-hoch').click();
    await pruefe(page, 'Kamera: Format und Auflösung', out);
    await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Sicherheit (PIN-Fenster, Sperrbildschirm, PIN vergessen) – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    await page.goto('./baupad/konto/sicherheit');
    await page.getByTestId('lock-setup').click();
    await expect(page.getByTestId('pin-dialog')).toBeVisible();
    await pruefe(page, 'Dialog PIN festlegen', out);
    await page.getByTestId('pin-new').fill('2468');
    await page.getByTestId('pin-again').fill('2468');
    await page.getByTestId('pin-save').click();
    await expect(page.getByTestId('pin-dialog')).toBeHidden();
    await pruefe(page, 'Konto Sicherheit (Sperre an)', out);
    await page.getByTestId('lock-change').click();
    await pruefe(page, 'Dialog PIN ändern', out);
    await page.keyboard.press('Escape');
    await page.getByTestId('lock-now').click();
    await expect(page.getByTestId('app-lock')).toBeVisible();
    for (const b of await tastenBefunde(page)) out.push(`Sperrbildschirm: ${b}`);
    await page.getByTestId('lock-pin').fill('1111');
    await page.getByTestId('lock-unlock').click();
    await expect(page.getByTestId('lock-msg')).toContainText('Falsche PIN');
    for (const b of await tastenBefunde(page)) out.push(`Sperrbildschirm (falsche PIN): ${b}`);
    await page.getByTestId('lock-forgot').click();
    for (const b of await tastenBefunde(page)) out.push(`Sperrbildschirm (PIN vergessen): ${b}`);
    await page.getByTestId('lock-forgot-cancel').click();
    await page.getByTestId('lock-pin').fill('2468');
    await page.getByTestId('lock-unlock').click();
    await expect(page.getByTestId('app-lock')).toBeHidden();
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Material auf der Baustelle (Bestand, Verbrauch, Rechnen) – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    await createProject(page, 'Tastentest Material');
    // Material mit Gebinde, Palette und Richtwert
    await page.goto('./baupad/materialverwaltung?t=material');
    await page.getByTestId('material-new').click();
    const md = page.getByTestId('material-dialog');
    await md.getByTestId('material-name').fill('Reparaturmörtel R4 Feinspachtel');
    await md.getByTestId('material-unit').selectOption('Sack');
    await md.getByTestId('material-packSize').fill('25');
    await md.getByTestId('material-perPallet').fill('40');
    await md.getByTestId('material-usageRate').fill('8');
    await md.getByTestId('material-usage').selectOption('kg|m²');
    await pruefe(page, 'Material mit Gebinde, Palette und Verbrauch', out);
    await md.getByTestId('material-save').click();
    await expect(md).toHaveCount(0);
    // Baustelle: leer, Material hinzufügen (schon geliefert)
    await page.getByTestId('mat-tab-sites').click();
    await page.getByTestId('material-site-open').click();
    await pruefe(page, 'Material-Baustelle leer', out);
    await page.getByTestId('item-new').click();
    const d = page.getByTestId('item-dialog');
    await d.getByTestId('item-material').selectOption({ index: 1 });
    await d.getByTestId('item-qty').fill('20');
    await d.getByTestId('item-status').selectOption('geliefert');
    await pruefe(page, 'Material hinzufügen mit Status', out);
    await d.getByTestId('item-save').click();
    await expect(d).toHaveCount(0);
    // Verbrauch eintragen (mehr als vorhanden → Hinweis)
    await page.getByTestId('use-new').click();
    const ud = page.getByTestId('use-dialog');
    await ud.getByTestId('use-qty').fill('30');
    await ud.getByTestId('use-done').fill('20');
    await expect(ud.getByTestId('use-over')).toBeVisible();
    await pruefe(page, 'Verbrauch eintragen', out);
    await ud.getByTestId('use-save').click();
    await expect(ud).toHaveCount(0);
    // Rechnen mit Ergebnis, Paletten und „als Bedarf eintragen“
    await page.getByTestId('stock-open').click();
    const sd = page.getByTestId('stock-dialog');
    await sd.getByTestId('calc-total').fill('100');
    await sd.getByTestId('calc-mode').selectOption('own');
    await sd.getByTestId('calc-rate').fill('1');
    await sd.getByTestId('calc-pallets').check();
    await expect(sd.getByTestId('calc-order')).toBeVisible();
    await pruefe(page, 'Material rechnen', out);
    await sd.getByTestId('calc-save').click();
    await expect(sd).toHaveCount(0);
    await pruefe(page, 'Material-Baustelle mit Bestand und Bedarf', out);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Mehrfachauswahl (Leisten und Fenster: Pläne, Messungen, LV, Mitarbeiter) – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    test.setTimeout(180_000);
    const out: string[] = [];
    await freshStart(page);
    await createProject(page, 'Tastentest Auswahl', {}, ['EG']);
    // zwei Pläne, im ersten zwei Messungen
    for (const nr of ['A-1', 'A-2']) {
      await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
      const wiz = page.getByTestId('import-wizard');
      await wiz.getByTestId('areas-next').click();
      await wiz.locator('[data-field="planNumber"]').fill(nr);
      await wiz.getByTestId('import-save').click();
      await waitForPlan(page);
      if (nr === 'A-1') {
        const dlg = page.getByTestId('damage-dialog');
        for (const f of [0.2, 0.5]) {
          await pickTool(page, 'tool-rect');
          const b = await planBox(page);
          await drawRect(page, b.x + b.width * f, b.y + b.height * 0.3, b.x + b.width * (f + 0.15), b.y + b.height * 0.45);
          await dlg.getByTestId('input-length').fill('2');
          await dlg.getByTestId('damage-save').click();
          await expect(dlg).toHaveCount(0);
        }
        if (await page.getByTestId('mobile-tab-table').isVisible()) await page.getByTestId('mobile-tab-table').click();
        await page.getByTestId('damages-select').click();
        await page.getByTestId('aufmass-row-select').first().check();
        await expect(page.getByTestId('damages-select-bar')).toBeVisible();
        await pruefe(page, 'Messungen auswählen', out);
        await page.getByTestId('damages-bulk-edit').click();
        await expect(page.getByTestId('bulk-damage-dialog')).toBeVisible();
        await pruefe(page, 'Messungen ändern (Fenster)', out);
        await page.getByTestId('bulk-damage-dialog').getByRole('button', { name: 'Abbrechen' }).click();
        await page.getByTestId('damages-select-bar').getByTestId('select-close').click();
      }
      await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
    }
    // Planliste: Auswahl, Leiste, Menü „Mehr“, Fenster „gemeinsam ändern“
    await page.getByTestId('plans-select').click();
    await page.getByTestId('plan-select').first().check();
    await expect(page.getByTestId('plans-select-bar')).toBeVisible();
    await pruefe(page, 'Pläne auswählen', out);
    await page.getByTestId('plans-select-bar').getByTestId('select-more').click();
    await pruefe(page, 'Pläne auswählen: Menü Mehr', out);
    await page.keyboard.press('Escape');
    await page.getByTestId('plans-bulk-edit').click();
    await expect(page.getByTestId('bulk-plan-dialog')).toBeVisible();
    await pruefe(page, 'Pläne gemeinsam ändern (Fenster)', out);
    await page.getByTestId('bulk-plan-dialog').getByRole('button', { name: 'Abbrechen' }).click();
    // LV: Dokumente und Positionen – eine Taste „LV / MFK hochladen“, Prüffenster mit Art und Kästchen „Mit Preisen“
    await expect(page.getByTestId('lv-import')).toBeVisible();
    for (const f of ['kurz-lv.pdf', 'lv-beispiel.pdf']) {
      await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, f));
      if (f === 'kurz-lv.pdf') {
        await expect(page.getByTestId('lv-review').getByTestId('lv-prices')).toBeChecked();
        await pruefe(page, 'LV / MFK prüfen (Fenster)', out);
      }
      await page.getByTestId('lv-review').getByTestId('lv-review-save').click();
      await expect(page.getByTestId('lv-review')).toHaveCount(0);
    }
    await page.getByTestId('lv-docs-select').click();
    await page.getByTestId('lv-doc-select').first().check();
    await pruefe(page, 'LV-Dokumente auswählen', out);
    await page.getByTestId('lv-docs-select-bar').getByTestId('select-close').click();
    await page.getByTestId('lv-doc-tab').first().click();
    await page.getByTestId('lv-pos-select').click();
    await page.getByTestId('lv-pos-check').nth(0).check();
    await page.getByTestId('lv-pos-check').nth(1).check();
    await pruefe(page, 'LV-Positionen auswählen', out);
    await page.getByTestId('lv-pos-bulk-edit').click();
    await expect(page.getByTestId('lv-bulk-dialog')).toBeVisible();
    await pruefe(page, 'LV-Positionen ändern (Fenster)', out);
    await page.getByTestId('lv-bulk-dialog').getByRole('button', { name: 'Abbrechen' }).click();
    await page.getByTestId('lv-pos-select-bar').getByTestId('select-close').click();
    // Personalliste: Auswahl und Fenster „Mitarbeiter ändern“ mit Urlaub von–bis
    await page.goto('./baupad/arbeitereinteilung/personal');
    for (const [first, last] of [
      ['Konstantin', 'Mustermann-Beispielhuber'],
      ['Ali', 'Demir'],
    ]) {
      await page.getByTestId('staff-new').click();
      await page.getByTestId('worker-firstName').fill(first);
      await page.getByTestId('worker-lastName').fill(last);
      await page.getByTestId('worker-save').click();
      await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
    }
    await page.getByTestId('staff-select').click();
    await page.getByTestId('worker-select').first().check();
    await pruefe(page, 'Mitarbeiter auswählen', out);
    await page.getByTestId('staff-bulk-edit').click();
    await page.getByTestId('staff-bulk-absence').selectOption('urlaub');
    await pruefe(page, 'Mitarbeiter ändern (Fenster)', out);
    await page.getByTestId('staff-bulk-dialog').getByRole('button', { name: 'Abbrechen' }).click();
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
    // Ansichtsleiste: Glas, zu- und aufklappen (Regler-Symbol); Tabellen-Taste schwarz
    await expect(page.getByTestId('zoom-controls')).toHaveClass(/liquid/);
    await page.getByTestId('zoom-toggle').click();
    await expect(page.getByTestId('zoom-controls')).toHaveClass(/is-collapsed/);
    await expect(page.getByTestId('editor-legend')).toBeHidden();
    await pruefe(page, 'Ansichtsleiste zugeklappt', out);
    await page.getByTestId('zoom-toggle').click();
    await expect(page.getByTestId('editor-legend')).toBeVisible();
    if (await page.getByTestId('side-toggle').isVisible()) await expect(page.getByTestId('side-toggle')).toHaveCSS('background-color', 'rgb(17, 17, 17)');
    const box = await planBox(page);
    await pickTool(page, 'tool-rect');
    await drawRect(page, box.x + box.width * 0.3, box.y + box.height * 0.3, box.x + box.width * 0.45, box.y + box.height * 0.45);
    const dlg = page.getByTestId('damage-dialog');
    await expect(dlg).toBeVisible();
    // Bewehrung gibt es nur bei der Betoninstandsetzung
    await dlg.getByTestId('measure-type-select').selectOption('schadstelle');
    await dlg.getByTestId('rebar-add').click();
    await pruefe(page, 'Messdialog', out);
    await dlg.getByTestId('input-length').fill('2');
    await dlg.getByTestId('input-width').fill('1');
    await dlg.getByTestId('rebar-count').first().fill('2');
    await dlg.getByTestId('rebar-length').first().fill('1');
    await dlg.getByTestId('damage-save').click();
    await expect(dlg).toBeHidden();
    await pruefe(page, 'Plan-Editor mit Messung', out);
    // Plan mit Maßstab: Fläche messen – Auswahl Länge × Breite oder Fläche aus Plan
    await pickTool(page, 'tool-calibrate');
    await drawRect(page, box.x + box.width * 0.55, box.y + box.height * 0.55, box.x + box.width * 0.75, box.y + box.height * 0.55);
    const pd = page.getByTestId('prompt-dialog');
    await pd.locator('input').fill('10');
    await pd.getByRole('button', { name: 'Kalibrieren' }).click();
    await pickTool(page, 'tool-rect');
    await drawRect(page, box.x + box.width * 0.55, box.y + box.height * 0.3, box.x + box.width * 0.7, box.y + box.height * 0.45);
    await expect(dlg.getByTestId('input-length')).not.toHaveValue(''); // Rechteck: Länge × Breite aus dem Plan
    await pruefe(page, 'Messdialog Fläche (Länge × Breite aus Plan)', out);
    await dlg.getByTestId('input-length').dblclick(); // Doppeltipp: Fläche aus dem Plan
    await expect(dlg.getByTestId('geometry-area')).toBeVisible();
    await pruefe(page, 'Messdialog Fläche aus Plan', out);
    await dlg.getByTestId('damage-cancel').click();
    await expect(dlg).toBeHidden();
    // nach dem Abbrechen bleibt Messung 1 ausgewählt – Auswahl aufheben, damit der Ablauf wie vorher weitergeht
    if (await page.getByRole('button', { name: 'Auswahl aufheben' }).isVisible()) await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
    if (await page.getByTestId('tools-open').isVisible()) await page.getByTestId('tools-open').click();
    await pruefe(page, 'Plan-Editor Leiste offen', out);
    // Ebenen: eigenes Fenster (vorher Aufklappfeld, das am Handy links aus dem Bild ragte)
    if (await page.getByTestId('layers-toggle').isVisible()) {
      await page.getByTestId('layers-toggle').click();
      await expect(page.getByTestId('layers-pop')).toBeVisible();
      await pruefe(page, 'Fenster Ebenen', out);
      await page.getByTestId('layers-done').click();
      await expect(page.getByTestId('layers-pop')).toHaveCount(0);
    }
    // Plan als PDF: Planauswahl und Kennzeichnung (BauPad-Logo)
    if (await page.getByTestId('export-pdf-plan').isVisible()) {
      await page.getByTestId('export-pdf-plan').click();
      await expect(page.getByTestId('pdf-brand')).toBeVisible();
      await pruefe(page, 'Dialog Plan als PDF', out);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('pdf-export-dialog')).toHaveCount(0);
    }
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
    // Unterzug (eigene Messart): Seite 1, Unterseite, Seite 2
    await dlg.getByTestId('measure-type-select').selectOption('unterzug');
    await dlg.getByTestId('beam-a-input').fill('0,5');
    await pruefe(page, 'Messdialog Unterzug', out);
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
    // eigene Leiste für Texte (Text, mit Punkt, mit Pfeil, mit Linie)
    if (await page.getByTestId('tools-open').isVisible()) await page.getByTestId('tools-open').click();
    await expect(page.getByTestId('text-bar')).toBeVisible();
    await page.getByTestId('text-tool-dot').click();
    await pruefe(page, 'Text-Leiste (Aufmaß)', out);
    await page.getByTestId('text-bar-back').click();
    await expect(page.getByTestId('text-bar')).toHaveCount(0);
    if (await page.getByTestId('mobile-tab-table').isVisible()) {
      await page.getByTestId('mobile-tab-table').click();
      await pruefe(page, 'Plan-Editor Tabelle', out);
    }
    // eigene Taste „Fotos“ neben „PDF“: Fenster Fotos exportieren
    await page.getByTestId('export-photos-plan').click();
    await expect(page.getByTestId('photos-export-dialog')).toBeVisible();
    await pruefe(page, 'Fenster Fotos exportieren', out);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('photos-export-dialog')).toHaveCount(0);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Pläne – Tasten, Papierkorb, Plan ansehen in der Planbibliothek – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    await createProject(page, 'Papierkorb', {}, ['EG']);
    await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
    const wiz = page.getByTestId('import-wizard');
    await wiz.getByTestId('areas-next').click();
    await wiz.locator('[data-field="planNumber"]').fill('P-1');
    await wiz.getByTestId('import-save').click();
    await waitForPlan(page);
    await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
    await expect(page.getByTestId('plan-list')).toBeVisible();
    await pruefe(page, 'Planliste mit schwarzen Tasten', out);
    // Plan löschen → Papierkorb
    await page.getByTestId('plan-row').first().getByTestId('plan-actions').click();
    await page.getByTestId('action-delete').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Plan löschen' }).click();
    await page.getByTestId('open-trash').click();
    await expect(page.getByTestId('trash-dialog')).toBeVisible();
    await pruefe(page, 'Papierkorb', out);
    await page.getByTestId('trash-dialog').getByRole('button', { name: 'Schließen' }).last().click();
    // Planbibliothek: Plan nur ansehen
    await page.getByTestId('open-plan-library').click();
    await expect(page.getByTestId('plan-library').locator('.lib-thumb img').first()).toBeVisible();
    await pruefe(page, 'Planbibliothek', out);
    await page.getByTestId('library-view-open').first().click();
    await expect(page.getByTestId('library-viewer').getByTestId('plan-viewer')).toHaveAttribute('data-scale', /\d/);
    await pruefe(page, 'Plan ansehen (Planbibliothek)', out);
    await page.getByTestId('library-viewer-close').click();
    // Plan umbenennen (Planbibliothek)
    await page.getByTestId('library-rename').first().click();
    await expect(page.getByRole('dialog', { name: 'Plan umbenennen' })).toBeVisible();
    await pruefe(page, 'Plan umbenennen (Planbibliothek)', out);
    await page.getByRole('dialog', { name: 'Plan umbenennen' }).getByRole('button', { name: 'Abbrechen' }).click();
    // Pläne gewählt: Bezeichnung vor dem Hochladen
    await page.getByTestId('library-file-input').setInputFiles([join(FIXTURES, 'plaene.pdf'), join(FIXTURES, 'parkdeck.png')]);
    await expect(page.getByTestId('library-pending-name')).toHaveCount(2);
    await pruefe(page, 'Bezeichnung vor dem Hochladen (Planbibliothek)', out);
    await page.getByTestId('library-pending-cancel').click();
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Freigabe im Projekt (Taste, Fenster, Projektangaben mit Freigabe) – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const people = ['Franz Huber', 'Mario Kovac', 'Max Muster', 'Peter Beispiel', 'Ali Demir', 'Jan Novak', 'Konstantin Mustermann-Beispielhuber'];
    await freshStart(page);
    await createProject(page, 'Tiefgarage Parkdeck Nord');
    await page.route('**/rest/v1/rpc/my_context', (r) =>
      r.fulfill(json({ workspace_id: '11111111-1111-4111-8111-111111111111', workspace_name: 'Testfirma', role: 'admin', pkg: 'team', tools: [], sites: [], tool_sites: {}, operator: false, name: 'Test Nutzer', phone: '', workspace_active: true })),
    );
    await page.route('**/rest/v1/rpc/project_access', (r) => r.fulfill(json(people.map((name, i) => ({ id: `u${i}`, name, email: `u${i}@firma.test`, role: i < 2 ? 'polier' : 'arbeiter', allowed: i % 2 === 0 })))));
    await page.reload();
    await expect(page.getByTestId('project-access')).toBeVisible();
    await pruefe(page, 'Projekt mit Taste Freigabe', out);
    await page.getByTestId('project-access').click();
    await expect(page.getByTestId('project-access-user')).toHaveCount(people.length);
    await pruefe(page, 'Fenster Freigabe', out);
    await page.keyboard.press('Escape');
    await page.getByTestId('edit-project').click();
    await expect(page.getByTestId('project-form').getByTestId('project-access')).toBeVisible();
    await pruefe(page, 'Projektangaben mit Freigabe', out);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Schadstelle mit Fläche (Boden, Wand, Decke) und Fenster Schadstellen-Positionen – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    await createProject(page, 'Tastentest Fläche', {}, ['EG']);
    // LV mit Schadstellen-Positionen, eine davon „nur Boden“ → der Messdialog fragt die Fläche ab
    await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, 'schadstellen-lv.pdf'));
    await page.getByTestId('lv-review').getByTestId('lv-review-save').click();
    await page.getByTestId('lv-doc-tab').last().click();
    await page.getByTestId('lv-rules-review').click();
    await page.getByTestId('lv-rules-dialog').getByTestId('rule-surface').first().selectOption('boden');
    await pruefe(page, 'Schadstellen-Positionen', out);
    await page.getByTestId('lv-rules-save').click();
    await expect(page.getByTestId('lv-rules-dialog')).toHaveCount(0);
    await page.getByTestId('draw-plan').click();
    await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('F-1');
    await page.getByTestId('new-drawing-save').click();
    await expect(page.getByTestId('drawing-sheet')).toBeVisible();
    await page.getByTestId('mode-measure').click();
    await chooseMeasureType(page, 'schadstelle');
    await pickTool(page, 'tool-rect');
    const b = (await page.getByTestId('drawing-sheet').boundingBox())!;
    await drawRect(page, b.x + b.width * 0.3, b.y + b.height * 0.3, b.x + b.width * 0.45, b.y + b.height * 0.45);
    const dlg = page.getByTestId('damage-dialog');
    await expect(dlg.getByTestId('input-surface')).toBeVisible();
    await pruefe(page, 'Messdialog Schadstelle (Fläche fehlt)', out);
    // alle drei Tasten ganz im Fenster (am Handy war „Decke“ abgeschnitten)
    const dBox = (await dlg.boundingBox())!;
    for (const s of ['boden', 'wand', 'decke']) {
      const sBox = (await dlg.getByTestId(`surface-${s}`).boundingBox())!;
      if (sBox.x < dBox.x || sBox.x + sBox.width > dBox.x + dBox.width) out.push(`Messdialog Schadstelle: Taste ${s} ragt aus dem Fenster`);
    }
    await dlg.getByTestId('surface-wand').click();
    await pruefe(page, 'Messdialog Schadstelle mit Fläche', out);
    await dlg.getByTestId('damage-cancel').click();
    await expect(dlg).toBeHidden();
    // Länge mit Freier Form: durchgehende Linie – unten nur vier Tasten (Abbrechen, Zurück, Vor, Fertig)
    await chooseMeasureType(page, 'laenge');
    await pickTool(page, 'tool-polyline');
    // Punkte weit genug auseinander (zwei schnelle Tipps nah beieinander beenden die Linie wie ein Doppeltipp)
    for (const [fx, fy] of [[0.2, 0.6], [0.45, 0.62], [0.7, 0.6], [0.6, 0.78]]) await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await expect(page.getByTestId('draft-bar')).toBeVisible();
    await pruefe(page, 'Länge Freie Form: vier Tasten', out);
    await page.getByTestId('polygon-cancel').click();
    await expect(page.getByTestId('draft-bar')).toHaveCount(0);
    // Neue Messung: Bereich wählen (Position oder frei) – in der Messleiste bzw. am Handy im Reiter Tabelle
    if (await page.getByTestId('mobile-tab-table').isVisible()) await page.getByTestId('mobile-tab-table').click();
    await page.getByTestId('new-measure').click();
    await expect(page.getByTestId('new-measure-dialog')).toBeVisible();
    await pruefe(page, 'Neue Messung (Bereich wählen)', out);
    await page.getByTestId('new-measure-dialog').getByTestId('new-measure-pos').first().click();
    await expect(page.getByTestId('new-measure-dialog')).toHaveCount(0);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('Tasten: Plan zeichnen mit Text-Dialog und Text-Leiste – nichts überlappt, verdeckt oder abgeschnitten', async ({ page }) => {
    const out: string[] = [];
    await freshStart(page);
    await createProject(page, 'Tastentest Zeichnen', {}, ['EG']);
    await page.getByTestId('draw-plan').click();
    await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('Z-1');
    await pruefe(page, 'Neuen Plan zeichnen (Fenster)', out);
    await page.getByTestId('new-drawing-save').click();
    await expect(page.getByTestId('drawing-sheet')).toBeVisible();
    await pruefe(page, 'Plan zeichnen', out);
    // Handy: schwebende Leiste – Gruppen und Hilfen hinter der Gruppen-Taste
    if (await page.getByTestId('ribbon-groups').isVisible()) {
      await page.getByTestId('ribbon-groups').click();
      await expect(page.getByTestId('grid-toggle')).toBeVisible();
      await pruefe(page, 'Plan zeichnen: Gruppen und Hilfen', out);
      await ribbonGroup(page, 'draw');
      await pruefe(page, 'Plan zeichnen: Werkzeuge', out);
    }
    // Planangaben: Format (Größe + Ausrichtung) und Maßstab nebeneinander
    await page.getByTitle('Planangaben').click();
    await expect(page.getByTestId('plan-details')).toBeVisible();
    await page.getByTestId('sheet-paper').scrollIntoViewIfNeeded();
    await pruefe(page, 'Planangaben bearbeiten', out);
    // „Querformat“ muss im Auswahlfeld ganz Platz haben (Text + Pfeil des Auswahlfelds)
    const orient = await page.getByTestId('sheet-orient').evaluate((el: HTMLSelectElement) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return { need: ctx.measureText('Querformat').width, room: el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24 };
    });
    if (orient.need > orient.room) out.push(`Planangaben: „Querformat“ passt nicht ins Auswahlfeld (${Math.round(orient.need)} > ${Math.round(orient.room)} px)`);
    await page.getByTestId('plan-details').getByRole('button', { name: 'Abbrechen' }).click();
    await expect(page.getByTestId('plan-details')).toHaveCount(0);
    await pickTool(page, 'draw-text');
    const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
    await page.mouse.click(sb.x + sb.width * 0.4, sb.y + sb.height * 0.3);
    await expect(page.getByTestId('text-dialog')).toBeVisible();
    await page.getByTestId('text-input').fill('Stiege 1');
    await pruefe(page, 'Text-Dialog (Zeichnen)', out);
    // Schriftfarbe: Palette aufgeklappt
    await page.getByTestId('text-color-open').click();
    await expect(page.getByTestId('text-palette')).toBeVisible();
    await pruefe(page, 'Text-Dialog mit Farbpalette', out);
    await page.getByTestId('text-save').click();
    await expect(page.getByTestId('element-bar')).toBeVisible();
    await pruefe(page, 'Text-Leiste', out);
    // Mehrfachauswahl und Befehlsleiste (Kopieren mit Eingabefeld): dazu ein Rechteck einfügen
    await page.locator('body').press('Escape');
    await expect(page.getByTestId('element-bar')).toHaveCount(0);
    // Text mit Pfeil: Hinweisleiste des Werkzeugs
    await pickTool(page, 'draw-textArrow');
    await expect(page.getByTestId('insert-bar')).toContainText('Pfeilspitze');
    await pruefe(page, 'Text mit Pfeil (Hinweis)', out);
    // Bruchlinie: Hinweisleiste des Werkzeugs
    await pickTool(page, 'draw-breakline');
    await expect(page.getByTestId('insert-bar')).toContainText('Bruchlinie');
    await pruefe(page, 'Bruchlinie (Hinweis)', out);
    // Linien-Leiste: „Länge“ und „Richtung“ dürfen nicht zusammengequetscht werden – reicht der Platz nicht,
    // rutschen „Maße anzeigen“, Darstellung, Löschen und X in die nächste Zeile (Fehler am iPhone, 23.11.2026)
    await pickTool(page, 'draw-line');
    await page.getByTestId('insert-length').fill('4');
    await page.getByTestId('insert-submit').click();
    await expect(page.getByTestId('element-bar')).toBeVisible();
    for (const w of await page.locator('[data-testid="element-bar"] .draw-field').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width)))
      if (w < 80) out.push(`Linien-Leiste: Eingabefeld nur ${Math.round(w)} px breit (zusammengequetscht)`);
    await pruefe(page, 'Linien-Leiste', out);
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
    await ribbonGroup(page, 'precision');
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
    await ribbonGroup(page, 'style');
    await page.getByTestId('ribbon-style').getByTestId('style-fill-type').selectOption('hatch');
    await page.getByTestId('ribbon-style').getByTestId('style-hatch-open').click();
    await expect(page.getByTestId('hatch-picker')).toBeVisible();
    await pruefe(page, 'Dialog Schraffur', out);
    await page.getByTestId('hatch-tile-din-SN46').click();
    await page.getByTestId('hatch-ok').click();
    await pruefe(page, 'Eigenschaften Schraffur', out);
    // Werkzeug Schraffur: Auswahl, danach Befehlsleiste
    await page.locator('body').press('Escape');
    await pickTool(page, 'draw-hatch');
    await expect(page.getByTestId('hatch-picker')).toBeVisible();
    await page.getByTestId('hatch-tile-din-SN3').click();
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
    await page.getByTestId('symbol-group-opening').click();
    await pruefe(page, 'Dialog Bauteile Wandöffnungen', out);
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
      await ribbonGroup(page, t);
      await pruefe(page, `Registerkarte ${t}`, out);
    }
    // Aufmaß: Hilfslinien-Leiste (Winkel, Löschen, Fertig)
    await page.getByTestId('mode-measure').click();
    if (!(await page.getByTestId('tool-guide').isVisible())) await page.getByTestId('tools-open').click();
    await page.getByTestId('tool-guide').click();
    await expect(page.getByTestId('guide-bar')).toBeVisible();
    await pruefe(page, 'Aufmaß: Hilfslinie', out);
    await page.getByTestId('guide-done').click();
    expect(out, out.join('\n')).toEqual([]);
  });
}
