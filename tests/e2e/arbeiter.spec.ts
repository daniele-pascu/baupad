import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, freshStart, OUT, saveDownload } from './helpers';

/**
 * Arbeitereinteilung: Arbeiter einmal anlegen, Arbeitszeit der Firma einmal eingeben, Baustellen aus
 * Aufmaß & Abrechnung bzw. manuell, Einteilung je Tag, Urlaub, Konflikt, Verschieben, nächste Woche
 * läuft weiter (fertiggestellte Baustelle fällt weg), ältere Woche bleibt unverändert.
 */

const site = (page: Page, name: string) => page.locator(`[data-testid="site-card"][data-site="${name}"]`);
const chips = (page: Page, name: string, day: number) => site(page, name).locator(`[data-testid="day-row"][data-day="${day}"] [data-testid="crew-chip"]`);

/** Namen mit der Maus auf eine Tageszeile ziehen */
async function dragTo(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  // wie ein Mensch: Start in die Bildmitte holen (nicht unter der festen Navigationsleiste)
  await from.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await expect(page.getByTestId('crew-ghost')).toBeVisible();
  // der gezogene Kasten liegt direkt unter dem Mauszeiger (dort, wo er angefasst wurde)
  const g = (await page.getByTestId('crew-ghost').boundingBox())!;
  expect(Math.abs(g.x - (a.x + 10))).toBeLessThan(3);
  expect(Math.abs(g.y - (a.y + 10))).toBeLessThan(3);
  // Ziel während des Ziehens in die Bildmitte scrollen (am Bildschirmrand scrollt die App selbst mit)
  await to.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('crew-ghost')).toHaveCount(0);
}

/** „+“ am Montag einer Baustelle → Arbeiter für die ganze Woche */
async function addFromMonday(page: Page, name: string, names: string[]) {
  await site(page, name).locator('[data-day="0"] [data-testid="day-add"]').click();
  await assignDialog(page, names);
}

async function assignDialog(page: Page, names: string[]) {
  const dlg = page.getByTestId('assign-dialog');
  for (const n of names) await dlg.locator(`[data-testid="assign-worker"][data-worker="${n}"] input`).check();
  await dlg.getByTestId('assign-save').click();
}

test('Arbeitereinteilung: Woche nach Baustellen planen und in die nächste Woche weiterführen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04', address: 'Musterstraße 1' });
  await page.goto('./#/tools');
  await page.getByTestId('tool-workers').click();
  await expect(page.getByTestId('workers-title')).toHaveText('Arbeitereinteilung');
  await expect(page.getByTestId('crew-setup-workers')).toBeVisible();
  await page.getByTestId('week-date').fill('2026-10-28'); // Mittwoch → KW 44
  await expect(page.getByTestId('week-label')).toHaveText('KW 44');

  // Arbeitszeit der Firma (einmal): Freitag kürzer
  await page.getByTestId('crew-times').click();
  const t = page.getByTestId('times-dialog');
  await t.getByTestId('time-to-4').fill('12:00');
  await t.getByTestId('times-save').click();

  // Arbeiter einmal anlegen
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const [first, last, role] of [
    ['Max', 'Muster', 'Polier'],
    ['Peter', 'Bau', ''],
    ['Thomas', 'Stein', ''],
    ['Stefan', 'Holz', ''],
  ]) {
    await wd.getByTestId('worker-firstName').fill(first);
    await wd.getByTestId('worker-lastName').fill(last);
    await wd.getByTestId('worker-role').fill(role);
    await wd.getByTestId('worker-save').click();
  }
  await expect(wd.getByTestId('worker-row')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('crew-workers')).toContainText('Personal (4)');

  // Baustelle A aus Aufmaß & Abrechnung → gleich Arbeiter für die ganze Woche einteilen
  await page.getByTestId('add-site').click();
  const sd = page.getByTestId('site-dialog');
  await sd.getByTestId('site-project').selectOption({ label: '2026-04 · Neubau Musterstraße' });
  await expect(sd.getByTestId('site-name-input')).toHaveValue('Neubau Musterstraße');
  await expect(sd.getByTestId('site-address')).toHaveValue('Musterstraße 1');
  await sd.getByTestId('site-save').click();
  // Baustelle erscheint sofort, ohne Einteilungsfenster
  await expect(page.getByTestId('assign-dialog')).toHaveCount(0);
  await expect(site(page, 'Neubau Musterstraße')).toBeVisible();
  await addFromMonday(page, 'Neubau Musterstraße', ['Max Muster', 'Peter Bau']);
  for (const d of [0, 1, 2, 3, 4]) await expect(chips(page, 'Neubau Musterstraße', d)).toHaveText(['Max Muster', 'Peter Bau']);
  await expect(site(page, 'Neubau Musterstraße').locator('[data-day="4"]')).toContainText('07:00–12:00');
  // immer alle 7 Tage; „ganze Woche“ schlägt Mo–Fr vor, Sa/So bleibt leer, ist aber einteilbar
  await expect(site(page, 'Neubau Musterstraße').getByTestId('day-row')).toHaveCount(7);
  await expect(site(page, 'Neubau Musterstraße').locator('[data-day="6"]')).toContainText('So 01.11.');
  await expect(chips(page, 'Neubau Musterstraße', 5)).toHaveCount(0);
  await expect(page.getByTestId('crew-week')).toContainText('26.10. – 01.11.2026');

  // Baustelle B manuell
  await page.getByTestId('add-site').click();
  await page.getByTestId('site-dialog').getByTestId('site-source-new').click();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Sanierung Hauptplatz');
  await page.getByTestId('site-dialog').getByTestId('site-save').click();
  await addFromMonday(page, 'Sanierung Hauptplatz', ['Thomas Stein']);
  await expect(chips(page, 'Sanierung Hauptplatz', 0)).toHaveText(['Thomas Stein']);

  // Noch nicht eingeteilt: Stefan an jedem Tag → Urlaub für die ganze Woche
  const open = page.getByTestId('crew-open');
  await expect(open.getByTestId('open-chip')).toHaveCount(5);
  await open.locator('[data-day="0"] [data-testid="open-chip"]').click();
  await page.getByTestId('open-dialog').getByTestId('open-absence').click();
  const abs = page.getByTestId('absence-dialog');
  await expect(abs.getByTestId('absence-worker')).toHaveValue(/.+/);
  await expect(abs.getByTestId('absence-from')).toHaveValue('2026-10-26');
  await expect(abs.getByTestId('absence-to')).toHaveValue('2026-10-30');
  await abs.getByTestId('absence-save').click();
  await expect(abs.getByTestId('absence-row')).toContainText(['Stefan Holz 26.10. – 30.10.']);
  await abs.getByRole('button', { name: 'Schließen' }).first().click();
  await expect(page.getByTestId('crew-open')).toHaveCount(0);
  await expect(page.getByTestId('crew-all-set')).toContainText('Alle Arbeiter sind eingeteilt');
  await expect(page.getByTestId('vacation-chip')).toHaveText(['Stefan Holz · Mo–Fr']);

  // Hinzufügen auf A nur am Montag: Thomas wird dafür automatisch von B entfernt (nur Montag)
  await site(page, 'Neubau Musterstraße').locator('[data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  await expect(ad.locator('[data-worker="Thomas Stein"]')).toContainText('auf Sanierung Hauptplatz → wird umgesetzt');
  for (const d of [1, 2, 3, 4]) await ad.getByTestId(`assign-day-${d}`).click(); // „+“ schlägt ab Montag die ganze Woche vor – hier nur Montag
  await assignDialog(page, ['Thomas Stein']);
  await expect(page.locator('.toast', { hasText: 'Umgesetzt auf Neubau Musterstraße: Thomas Stein (von Sanierung Hauptplatz)' })).toHaveCount(1);
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveText(['Max Muster', 'Peter Bau', 'Thomas Stein']);
  await expect(chips(page, 'Sanierung Hauptplatz', 0)).toHaveCount(0);
  await expect(chips(page, 'Sanierung Hauptplatz', 1)).toHaveText(['Thomas Stein']);
  // per Ziehen zurück auf B (ab Montag)
  await dragTo(page, chips(page, 'Neubau Musterstraße', 0).nth(2), site(page, 'Sanierung Hauptplatz').locator('[data-testid="day-row"][data-day="0"]'));
  await expect(chips(page, 'Sanierung Hauptplatz', 0)).toHaveText(['Thomas Stein']);
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveText(['Max Muster', 'Peter Bau']);

  // Peter ab Mittwoch auf die andere Baustelle
  await chips(page, 'Neubau Musterstraße', 2).nth(1).click();
  const cd = page.getByTestId('chip-dialog');
  await cd.getByTestId('chip-move-to').selectOption({ label: 'Sanierung Hauptplatz' });
  await cd.getByTestId('chip-move').click();
  await expect(chips(page, 'Neubau Musterstraße', 1)).toHaveText(['Max Muster', 'Peter Bau']);
  await expect(chips(page, 'Neubau Musterstraße', 2)).toHaveText(['Max Muster']);
  await expect(chips(page, 'Sanierung Hauptplatz', 2)).toHaveText(['Thomas Stein', 'Peter Bau']);

  // Baustelle B ist diese Woche fertig
  await site(page, 'Sanierung Hauptplatz').getByTestId('site-actions').click();
  await page.getByTestId('site-finish').click();
  await expect(site(page, 'Sanierung Hauptplatz')).toContainText('abgeschlossen');
  await page.screenshot({ path: join(OUT, 'arbeiter-woche.png'), fullPage: true });

  // gespeichert: nach dem Neuladen alles da
  await page.reload();
  await page.getByTestId('week-date').fill('2026-10-28');
  await expect(chips(page, 'Sanierung Hauptplatz', 3)).toHaveText(['Thomas Stein', 'Peter Bau']);

  // nächste Woche läuft weiter: nur Baustelle A, gleiche Arbeiter je Wochentag, kein Urlaub übernommen
  await page.getByTestId('week-next').click();
  await expect(page.getByTestId('week-label')).toHaveText('KW 45');
  await expect(page.getByTestId('draft-banner')).toContainText('KW 44');
  await expect(page.getByTestId('site-card')).toHaveCount(1);
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveText(['Max Muster', 'Peter Bau']);
  await expect(chips(page, 'Neubau Musterstraße', 3)).toHaveText(['Max Muster']);
  // Peter (Mi–Fr) und Thomas sind jetzt frei, Stefan wieder da → „Noch nicht eingeteilt“
  await expect(page.getByTestId('crew-open').locator('[data-day="2"] [data-testid="open-chip"]')).toHaveText(['Peter Bau', 'Stefan Holz', 'Thomas Stein']);
  // Änderung in KW 45 …
  await chips(page, 'Neubau Musterstraße', 0).first().click();
  await page.getByTestId('chip-dialog').getByTestId('chip-remove').click();
  await expect(page.getByTestId('draft-banner')).toHaveCount(0); // jetzt gespeichert
  // … ändert KW 44 nicht
  await page.getByTestId('week-prev').click();
  await expect(page.getByTestId('site-card')).toHaveCount(2);
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveText(['Max Muster', 'Peter Bau']);
});

test('Arbeiter deaktivieren: nicht mehr zum Einteilen, in gespeicherten Wochen weiter sichtbar', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  await wd.getByTestId('worker-firstName').fill('Andreas');
  await wd.getByTestId('worker-save').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Umbau Gewerbepark');
  await page.getByTestId('site-dialog').getByTestId('site-save').click();
  await addFromMonday(page, 'Umbau Gewerbepark', ['Andreas']);
  await page.getByTestId('crew-workers').click();
  await wd.getByTestId('worker-active').click();
  await expect(wd.getByTestId('worker-row')).toHaveClass(/inactive/);
  await page.keyboard.press('Escape');
  // weiterhin sichtbar (als inaktiv markiert), aber nicht mehr in der Auswahl und nicht „offen“
  await expect(chips(page, 'Umbau Gewerbepark', 0)).toHaveText(['Andreas']);
  await expect(chips(page, 'Umbau Gewerbepark', 0)).toHaveClass(/inactive/);
  await site(page, 'Umbau Gewerbepark').locator('[data-day="1"] [data-testid="day-add"]').click();
  await expect(page.getByTestId('assign-dialog').getByTestId('assign-worker')).toHaveCount(0);
});

test('Suche, PDF (Woche + Tagesliste), Drucken, Vorwoche übernehmen, Sicherung speichern und wiederherstellen', async ({ page, context }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  // Firma und Arbeitszeit
  await page.getByTestId('crew-times').click();
  await page.getByTestId('times-dialog').getByTestId('company-name').fill('Muster Bau GmbH');
  // Uhrzeiten im PDF: standardmäßig an, abwählbar (bleibt gespeichert)
  await expect(page.getByTestId('times-dialog').getByTestId('times-pdf')).toBeChecked();
  await page.getByTestId('times-dialog').getByTestId('times-pdf').uncheck();
  await page.getByTestId('times-dialog').getByTestId('times-save').click();
  await expect(page.getByTestId('times-dialog')).toHaveCount(0);
  await page.getByTestId('crew-times').click();
  await expect(page.getByTestId('times-dialog').getByTestId('times-pdf')).not.toBeChecked();
  await page.getByTestId('times-dialog').getByTestId('times-pdf').check();
  await page.getByTestId('times-dialog').getByTestId('times-save').click();
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const [f, l, role, tel] of [
    ['Max', 'Muster', 'Polier', '0664 1234567'],
    ['Thomas', 'Stein', '', ''],
  ]) {
    await wd.getByTestId('worker-firstName').fill(f);
    await wd.getByTestId('worker-lastName').fill(l);
    await wd.getByTestId('worker-role').fill(role);
    await wd.getByTestId('worker-phone').fill(tel);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: f })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  for (const [name, who, note] of [
    ['Neubau Musterstraße', 'Max Muster', 'Kran ab Mittwoch'],
    ['Sanierung Hauptplatz', 'Thomas Stein', ''],
  ]) {
    await page.getByTestId('add-site').click();
    const sd = page.getByTestId('site-dialog');
    await sd.getByTestId('site-name-input').fill(name);
    if (note) await sd.getByTestId('site-note-input').fill(note);
    await sd.getByTestId('site-save').click();
    await addFromMonday(page, name, [who]);
  }
  await expect(site(page, 'Neubau Musterstraße').getByTestId('site-note')).toHaveText('Kran ab Mittwoch');

  // Suche nach Arbeiter bzw. Baustelle
  await page.getByTestId('crew-search').fill('stein');
  await expect(page.getByTestId('site-card')).toHaveCount(1);
  await expect(page.getByTestId('crew-search-count')).toHaveText('1 von 2');
  await expect(chips(page, 'Sanierung Hauptplatz', 0)).toHaveClass(/hit/);
  await page.getByTestId('crew-search').fill('neubau');
  await expect(page.getByTestId('site-card')).toHaveAttribute('data-site', 'Neubau Musterstraße');
  await page.getByTestId('crew-search').fill('');
  await expect(page.getByTestId('site-card')).toHaveCount(2);

  // PDF Wochenplan (A4 quer) mit Vorschau
  const dl = await catchDownload(page, () => page.getByTestId('crew-pdf').click());
  const pdf = await saveDownload(dl, 'arbeitereinteilung-kw44.pdf');
  const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
  expect(info).toMatch(/Page size:\s+841\.89 x 595\.28/);
  const txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
  for (const s of ['Arbeitereinteilung KW 44', 'Muster Bau GmbH', 'Neubau Musterstraße', 'Sanierung Hauptplatz', 'Max Muster', 'Kran ab Mittwoch']) expect(txt).toContain(s);

  // Tagesliste einer Baustelle
  await site(page, 'Neubau Musterstraße').getByTestId('site-actions').click();
  await page.getByTestId('site-daylist').click();
  const dl2 = await catchDownload(page, () => page.getByTestId('daylist-dialog').getByTestId('daylist-1').click());
  const pdf2 = await saveDownload(dl2, 'tagesliste.pdf');
  const txt2 = execFileSync('pdftotext', ['-layout', pdf2, '-'], { encoding: 'utf8' });
  for (const s of ['Tagesliste Dienstag, 27.10.2026', 'Neubau Musterstraße', 'Max Muster', '0664 1234567']) expect(txt2).toContain(s);
  expect(txt2).not.toContain('Polier'); // Funktion/Qualifikation nie auf dem Ausdruck

  // Drucken: PDF in neuem Tab
  const popup = context.waitForEvent('page');
  await page.getByTestId('crew-more').click();
  await page.getByTestId('crew-print').click();
  const tab = await popup;
  await expect.poll(() => tab.url()).toMatch(/^blob:/);
  await tab.close();

  // KW 45 ändern, dann „aus Vorwoche übernehmen“ → Hinweis vor dem Ersetzen
  await page.getByTestId('week-next').click();
  await chips(page, 'Neubau Musterstraße', 0).first().click();
  await page.getByTestId('chip-dialog').getByTestId('chip-remove').click();
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveCount(0);
  await page.getByTestId('crew-more').click();
  await page.getByTestId('crew-carry').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('wird durch die Baustellen und Arbeiter aus KW 44 ersetzt');
  await page.getByRole('button', { name: 'Ersetzen' }).click();
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveText(['Max Muster']);

  // Sicherung speichern …
  const dl3 = await catchDownload(page, async () => {
    await page.getByTestId('crew-more').click();
    await page.getByTestId('crew-backup').click();
  });
  expect(dl3.suggestedFilename()).toMatch(/^BauPad_Arbeitereinteilung_\d{4}-\d{2}-\d{2}\.json$/);
  const backupFile = await saveDownload(dl3, 'arbeitereinteilung-sicherung.json');
  // … auf „neuem Gerät“ (leere Datenbank) wiederherstellen
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await expect(page.getByTestId('crew-empty')).toBeVisible();
  await page.getByTestId('crew-restore-input').setInputFiles(backupFile);
  await expect(page.locator('.toast')).toContainText('2 Arbeiter, 2 Wochen übernommen');
  await expect(page.getByTestId('site-card')).toHaveCount(2);
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveText(['Max Muster']);
  await expect(page.getByTestId('crew-workers')).toContainText('Personal (2)');
  await page.getByTestId('crew-times').click();
  await expect(page.getByTestId('times-dialog').getByTestId('company-name')).toHaveValue('Muster Bau GmbH');
});

test('Baustelle ↔ Projekt: aus Aufmaß & Abrechnung wählen, als Projekt anlegen, Projekt aus der Arbeitereinteilung übernehmen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04', address: 'Musterstraße 1' });
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  const menu = async (name: string) => {
    await site(page, name).getByTestId('site-actions').click();
  };

  // 1) aus Aufmaß & Abrechnung wählen (Standard, wenn Projekte vorhanden)
  await page.getByTestId('add-site').click();
  let sd = page.getByTestId('site-dialog');
  await expect(sd.getByTestId('site-source-project')).toHaveAttribute('aria-checked', 'true');
  await sd.getByTestId('site-save').click();
  await expect(sd).toContainText('Bitte ein Projekt wählen.');
  await sd.getByTestId('site-project').selectOption({ label: '2026-04 · Neubau Musterstraße' });
  await sd.getByTestId('site-save').click();
  await menu('Neubau Musterstraße');
  await expect(page.getByTestId('site-to-project')).toHaveCount(0);
  await page.getByTestId('site-open-project').click();
  await expect(page.getByTestId('project-title')).toHaveText('Neubau Musterstraße');

  // 2) neues Projekt aus der Einteilung – landet im Projektregister (auch in Aufmaß & Abrechnung)
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('add-site').click();
  sd = page.getByTestId('site-dialog');
  await sd.getByTestId('site-source-new').click();
  await sd.getByTestId('site-name-input').fill('Sanierung Hauptplatz');
  await sd.getByTestId('site-address').fill('Hauptplatz 3');
  await sd.getByTestId('site-save').click();
  await expect(page.locator('.toast', { hasText: 'Projekt „Sanierung Hauptplatz“ in Aufmaß & Abrechnung angelegt' })).toHaveCount(1);
  await menu('Sanierung Hauptplatz');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // 3) weitere neue Projekte aus der Einteilung – jedes landet sofort im Register (kein „als Projekt anlegen“ mehr nötig)
  for (const n of ['Umbau Gewerbepark', 'Halle Nord']) {
    await page.getByTestId('add-site').click();
    sd = page.getByTestId('site-dialog');
    await sd.getByTestId('site-source-new').click();
    await sd.getByTestId('site-name-input').fill(n);
    await sd.getByTestId('site-save').click();
    await expect(page.locator('.toast', { hasText: `Projekt „${n}“` })).toHaveCount(1);
  }
  await menu('Umbau Gewerbepark');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
  await expect(page.getByTestId('site-to-project')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 4) Aufmaß & Abrechnung zeigt nur dort benutzte Projekte; die aus der Einteilung stehen im Formular zum Übernehmen
  await page.goto('./#/projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await page.getByTestId('new-project').click();
  const form = page.getByTestId('project-form');
  await expect(form.getByTestId('project-from-register').locator('option')).toHaveText(['– Projekt wählen –', 'Halle Nord', 'Sanierung Hauptplatz', 'Umbau Gewerbepark']);
  await form.getByTestId('project-from-register').selectOption({ label: 'Halle Nord' });
  await expect(form.locator('input[name="name"]')).toHaveValue('Halle Nord');
  await form.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page.getByTestId('project-title')).toHaveText('Halle Nord');
  await page.goto('./#/projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(2);
  // Baustelle ist jetzt mit dem Projekt verknüpft
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await menu('Halle Nord');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
});

test('Ziehen: offenen Arbeiter einteilen, umsetzen ab Tag; bereits geplante Folgewoche wird mit umgesetzt (Ziehen und Antippen)', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max', 'Peter']) {
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  for (const n of ['Baustelle A', 'Baustelle B']) {
    await page.getByTestId('add-site').click();
    await page.getByTestId('site-dialog').getByTestId('site-name-input').fill(n);
    await page.getByTestId('site-dialog').getByTestId('site-save').click();
  }
  await expect(page.getByTestId('crew-drag-hint')).toBeVisible();
  // offenen Namen (Mittwoch) auf Baustelle A ziehen → ab Mittwoch dort
  await dragTo(page, page.getByTestId('crew-open').locator('[data-day="2"] [data-testid="open-chip"]').filter({ hasText: 'Max' }), site(page, 'Baustelle A').locator('[data-testid="day-row"][data-day="2"]'));
  for (const d of [0, 1]) await expect(chips(page, 'Baustelle A', d)).toHaveCount(0);
  for (const d of [2, 3, 4]) await expect(chips(page, 'Baustelle A', d)).toHaveText(['Max']);
  // Max ab Montag auf A (über „+“, Standard ab Montag ganze Woche), Peter auf B
  await site(page, 'Baustelle A').locator('[data-day="0"] [data-testid="day-add"]').click();
  await assignDialog(page, ['Max']);
  await site(page, 'Baustelle B').locator('[data-day="0"] [data-testid="day-add"]').click();
  await assignDialog(page, ['Peter']);
  await expect(page.getByTestId('crew-all-set')).toBeVisible();
  // KW 45 einmal ändern → gespeichert (bereits geplante Folgewoche)
  await page.getByTestId('week-next').click();
  await expect(page.getByTestId('draft-banner')).toBeVisible();
  await page.getByTestId('draft-save').click();
  await expect(page.getByTestId('draft-banner')).toHaveCount(0);
  await page.getByTestId('week-prev').click();
  // Max am Donnerstag auf B ziehen → ab Donnerstag auf B, von A automatisch entfernt; Folgewoche automatisch mit
  await dragTo(page, chips(page, 'Baustelle A', 3), site(page, 'Baustelle B').locator('[data-testid="day-row"][data-day="3"]'));
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Auch übernommen in KW 45' })).toHaveCount(1);
  for (const d of [0, 1, 2]) await expect(chips(page, 'Baustelle A', d)).toHaveText(['Max']);
  for (const d of [3, 4]) {
    await expect(chips(page, 'Baustelle A', d)).toHaveCount(0);
    await expect(chips(page, 'Baustelle B', d)).toHaveText(['Peter', 'Max']);
  }
  // Peter am Freitag antippen → „Umsetzen“ auf A: ab Freitag dort, ebenfalls in KW 45
  await chips(page, 'Baustelle B', 4).filter({ hasText: 'Peter' }).click();
  const cd = page.getByTestId('chip-dialog');
  await cd.getByTestId('chip-move-to').selectOption({ label: 'Baustelle A' });
  await cd.getByTestId('chip-move').click();
  await expect(page.locator('.toast', { hasText: 'Auch übernommen in KW 45' }).first()).toBeVisible();
  await expect(chips(page, 'Baustelle B', 3)).toHaveText(['Peter', 'Max']);
  await expect(chips(page, 'Baustelle B', 4)).toHaveText(['Max']);
  await expect(chips(page, 'Baustelle A', 4)).toHaveText(['Peter']);
  await page.getByTestId('week-next').click();
  for (const d of [0, 4]) {
    await expect(chips(page, 'Baustelle A', d)).toHaveText(['Peter']);
    await expect(chips(page, 'Baustelle B', d)).toHaveText(['Max']);
  }
});

test('Baustelle pausieren (Standby): Arbeiter werden frei, läuft ohne Arbeiter weiter, Fortsetzen; Abschließen', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max', 'Peter']) {
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  for (const [n, who] of [
    ['Baustelle A', 'Max'],
    ['Baustelle B', 'Peter'],
  ]) {
    await page.getByTestId('add-site').click();
    await page.getByTestId('site-dialog').getByTestId('site-name-input').fill(n);
    await page.getByTestId('site-dialog').getByTestId('site-save').click();
    await expect(page.getByTestId('assign-dialog')).toHaveCount(0);
    await addFromMonday(page, n, [who]);
  }
  // KW 45 einmal speichern (bereits geplante Folgewoche)
  await page.getByTestId('week-next').click();
  await page.getByTestId('draft-save').click();
  await expect(page.getByTestId('draft-banner')).toHaveCount(0);
  await page.getByTestId('week-prev').click();

  // B pausieren
  await site(page, 'Baustelle B').getByTestId('site-actions').click();
  await page.getByTestId('site-pause').click();
  const cf = page.getByTestId('confirm-dialog');
  await expect(cf).toContainText('Frei werden: Peter');
  await expect(cf).toContainText('KW 45');
  await cf.getByRole('button', { name: 'Pausieren' }).click();
  const paused = page.getByTestId('crew-paused');
  await expect(paused.getByTestId('site-name')).toHaveText(['Baustelle B']);
  await expect(site(page, 'Baustelle B').getByTestId('day-row')).toHaveCount(0);
  await page.screenshot({ path: join(OUT, 'arbeiter-pausiert.png'), fullPage: true });
  await expect(page.getByTestId('crew-open').locator('[data-day="0"] [data-testid="open-chip"]')).toHaveText(['Peter']);
  // pausierte Baustelle steht nicht in der Auswahl zum Umsetzen
  await chips(page, 'Baustelle A', 0).click();
  await expect(page.getByTestId('chip-dialog').getByTestId('chip-move-to')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // gespeicherte KW 45 ebenfalls pausiert, neue KW 46 führt sie pausiert weiter
  await page.getByTestId('week-next').click();
  await expect(page.getByTestId('crew-paused').getByTestId('site-name')).toHaveText(['Baustelle B']);
  await page.getByTestId('week-next').click();
  await expect(page.getByTestId('draft-banner')).toBeVisible();
  await expect(page.getByTestId('crew-paused').getByTestId('site-name')).toHaveText(['Baustelle B']);

  // in KW 44 fortsetzen → auch KW 45 läuft wieder; Peter neu einteilen
  await page.getByTestId('week-date').fill('2026-10-26');
  await site(page, 'Baustelle B').getByTestId('site-resume').click();
  await expect(page.getByTestId('crew-paused')).toHaveCount(0);
  await expect(site(page, 'Baustelle B').getByTestId('day-row')).toHaveCount(7);
  await addFromMonday(page, 'Baustelle B', ['Peter']);
  await page.getByTestId('week-next').click();
  await expect(page.getByTestId('crew-paused')).toHaveCount(0);
  await expect(site(page, 'Baustelle B').getByTestId('day-row')).toHaveCount(7);

  // Abschließen: ab der nächsten Woche weg
  await page.getByTestId('week-prev').click();
  await site(page, 'Baustelle A').getByTestId('site-actions').click();
  await page.getByTestId('site-finish').click();
  await expect(site(page, 'Baustelle A')).toContainText('abgeschlossen');
});

test('Urlaub und Krank von–bis über mehrere Wochen: bleibt eingeteilt, wird markiert, danach wieder normal', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max', 'Peter']) {
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Baustelle A');
  await page.getByTestId('site-dialog').getByTestId('site-save').click();
  await addFromMonday(page, 'Baustelle A', ['Max', 'Peter']);

  // Max am Mittwoch antippen → Urlaub vom 28.10. bis 04.11. (über das Wochenende in die nächste Woche)
  await chips(page, 'Baustelle A', 2).filter({ hasText: 'Max' }).click();
  await page.getByTestId('chip-dialog').getByTestId('chip-absence').click();
  const abs = page.getByTestId('absence-dialog');
  await expect(abs.getByTestId('absence-from')).toHaveValue('2026-10-28');
  await abs.getByTestId('absence-to').fill('2026-10-27');
  await abs.getByTestId('absence-save').click();
  await expect(abs.getByTestId('absence-error')).toContainText('„bis“ liegt vor „von“');
  await abs.getByTestId('absence-to').fill('2026-11-04');
  await abs.getByTestId('absence-save').click();
  await expect(page.locator('.toast', { hasText: 'Urlaub eingetragen: Max, 28.10. – 04.11' })).toHaveCount(1);
  // Peter krank am Donnerstag und Freitag
  await abs.getByTestId('absence-krank').click();
  await abs.getByTestId('absence-worker').selectOption({ label: 'Peter' });
  await abs.getByTestId('absence-from').fill('2026-10-29');
  await abs.getByTestId('absence-to').fill('2026-10-30');
  await abs.getByTestId('absence-save').click();
  await expect(abs.getByTestId('absence-row')).toHaveCount(1); // Liste zeigt die Einträge des gewählten Arbeiters (Peter)
  await abs.getByRole('button', { name: 'Schließen' }).first().click();

  // bleibt eingeteilt, an den Tagen markiert; nichts „offen“
  for (const d of [0, 1, 2, 3, 4]) await expect(chips(page, 'Baustelle A', d)).toHaveText(['Max', 'Peter']);
  await expect(chips(page, 'Baustelle A', 1).filter({ hasText: 'Max' })).not.toHaveClass(/away/);
  await expect(chips(page, 'Baustelle A', 2).filter({ hasText: 'Max' })).toHaveClass(/away/);
  await expect(chips(page, 'Baustelle A', 3).filter({ hasText: 'Peter' })).toHaveClass(/sick/);
  await expect(page.getByTestId('vacation-chip')).toHaveText(['Max · Mi–So']); // Urlaub geht übers Wochenende
  await expect(page.getByTestId('sick-chip')).toHaveText(['Peter · Do, Fr']);
  await expect(page.getByTestId('crew-all-set')).toBeVisible();
  await page.screenshot({ path: join(OUT, 'arbeiter-urlaub-krank.png'), fullPage: true });

  // nächste Woche: Max Mo–Mi Urlaub, ab Donnerstag wieder normal auf seiner Baustelle
  await page.getByTestId('week-next').click();
  for (const d of [0, 4]) await expect(chips(page, 'Baustelle A', d)).toHaveText(['Max', 'Peter']);
  await expect(chips(page, 'Baustelle A', 2).filter({ hasText: 'Max' })).toHaveClass(/away/);
  await expect(chips(page, 'Baustelle A', 3).filter({ hasText: 'Max' })).not.toHaveClass(/away/);
  await expect(page.getByTestId('vacation-chip')).toHaveText(['Max · Mo–Mi']);
  await expect(page.getByTestId('crew-sick')).toHaveCount(0);

  // Urlaub löschen (über die Urlaubsanzeige) → keine Markierung mehr
  await page.getByTestId('vacation-chip').click();
  await abs.getByTestId('absence-delete').click();
  await expect(page.locator('.toast', { hasText: 'Urlaub gelöscht' })).toHaveCount(1);
  await abs.getByRole('button', { name: 'Schließen' }).first().click();
  await expect(page.getByTestId('crew-vacations')).toHaveCount(0);
  await expect(chips(page, 'Baustelle A', 2).filter({ hasText: 'Max' })).not.toHaveClass(/away/);
});

test('Sa/So wie jeder andere Tag: Wochenend-Partie einteilen, Umsetzen nimmt Sa/So mit; Arbeitszeit nur Info', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max', 'Willi']) {
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  for (const n of ['Baustelle A', 'Baustelle B']) {
    await page.getByTestId('add-site').click();
    await page.getByTestId('site-dialog').getByTestId('site-name-input').fill(n);
    await page.getByTestId('site-dialog').getByTestId('site-save').click();
  }
  // Willi nur am Wochenende: „+“ am Samstag schlägt Sa–So vor
  await site(page, 'Baustelle B').locator('[data-day="5"] [data-testid="day-add"]').click();
  for (const d of [0, 1, 2, 3, 4]) await expect(page.getByTestId(`assign-day-${d}`)).toHaveAttribute('aria-pressed', 'false');
  for (const d of [5, 6]) await expect(page.getByTestId(`assign-day-${d}`)).toHaveAttribute('aria-pressed', 'true');
  await assignDialog(page, ['Willi']);
  for (const d of [5, 6]) await expect(chips(page, 'Baustelle B', d)).toHaveText(['Willi']);
  // Max Mo–So auf A (Wochenende zusätzlich anhaken)
  await site(page, 'Baustelle A').locator('[data-day="0"] [data-testid="day-add"]').click();
  for (const d of [5, 6]) await page.getByTestId(`assign-day-${d}`).click();
  await assignDialog(page, ['Max']);
  for (const d of [0, 6]) await expect(chips(page, 'Baustelle A', d)).toHaveText(['Max']);
  // Max ab Mittwoch auf B ziehen → Mi–So auf B (Sa/So mit umgesetzt), Mo/Di bleibt A
  await dragTo(page, chips(page, 'Baustelle A', 2), site(page, 'Baustelle B').locator('[data-testid="day-row"][data-day="2"]'));
  for (const d of [0, 1]) await expect(chips(page, 'Baustelle A', d)).toHaveText(['Max']);
  for (const d of [2, 3, 4, 5, 6]) await expect(chips(page, 'Baustelle A', d)).toHaveCount(0);
  await expect(chips(page, 'Baustelle B', 6)).toHaveText(['Willi', 'Max']);
  // kein Hinweis „Arbeitszeit festlegen“ mehr – Arbeitszeit ist nur Info
  await expect(page.getByTestId('crew-setup-times')).toHaveCount(0);
});

test('Personalliste: eigene Seite, alphabetisch oder nach Funktion; Einteilung und PDF nach Funktion geordnet', async ({ page }) => {
  await freshStart(page);
  await page.goto('./arbeitereinteilung');
  await page.getByTestId('crew-workers').click();
  await expect(page).toHaveURL(/\/arbeitereinteilung\/personal$/);
  const sp = page.getByTestId('staff-page');
  await expect(sp.getByTestId('staff-title')).toHaveText('Personalliste');
  for (const [first, last, grade] of [
    ['Zoe', 'Adler', 'hilfsarbeiter'],
    ['Max', 'Muster', 'polier'],
    ['Anna', 'Berg', 'facharbeiter'],
    ['Pia', 'Leit', 'projektleiter'],
  ]) {
    await sp.getByTestId('worker-firstName').fill(first);
    await sp.getByTestId('worker-lastName').fill(last);
    await sp.getByTestId('worker-grade').selectOption(grade);
    await sp.getByTestId('worker-save').click();
  }
  // alphabetisch nach Nachname
  await expect(sp.getByTestId('worker-row').locator('strong')).toHaveText(['Zoe Adler', 'Anna Berg', 'Pia Leit', 'Max Muster']);
  // nach Funktion: Projektleiter → Polier → Facharbeiter → Hilfsarbeiter, mit Gruppenüberschriften
  await sp.getByTestId('staff-sort-grade').click();
  await expect(sp.getByTestId('worker-row').locator('strong')).toHaveText(['Pia Leit', 'Max Muster', 'Anna Berg', 'Zoe Adler']);
  await expect(sp.getByTestId('staff-group')).toHaveText(['Projektleiter', 'Polier', 'Facharbeiter', 'Hilfsarbeiter']);
  // Suche
  await sp.getByTestId('staff-search').fill('berg');
  await expect(sp.getByTestId('worker-row')).toHaveCount(1);
  await sp.getByTestId('staff-search').fill('');
  // bearbeiten: Tippen auf die Zeile füllt das Formular
  await sp.getByTestId('worker-row').filter({ hasText: 'Anna Berg' }).getByTestId('worker-open').click();
  await expect(sp.getByTestId('worker-firstName')).toHaveValue('Anna');
  await sp.getByTestId('worker-cancel').click();
  // löschen (mit Rückfrage): weg aus der Liste
  await sp.getByTestId('worker-firstName').fill('Tim');
  await sp.getByTestId('worker-save').click();
  await expect(sp.getByTestId('worker-row')).toHaveCount(5);
  await sp.getByTestId('worker-row').filter({ hasText: 'Tim' }).getByTestId('worker-open').click();
  await sp.getByTestId('worker-delete').click();
  await page.getByRole('button', { name: 'Löschen' }).last().click();
  await expect(sp.getByTestId('worker-row')).toHaveCount(4);
  await expect(sp.getByTestId('worker-firstName')).toHaveValue('');
  // Sortierung bleibt gespeichert; Escape führt zurück zur Einteilung
  await page.reload();
  await expect(sp.getByTestId('staff-sort-grade')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workers-title')).toHaveText('Arbeitereinteilung');
  await expect(page.getByTestId('crew-workers')).toContainText('Personal (4)');

  // Einteilung: offene Arbeiter und Auswahl nach Funktion geordnet
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('add-site').click();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Halle Nord');
  await page.getByTestId('site-dialog').getByTestId('site-save').click();
  await site(page, 'Halle Nord').locator('[data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  await expect(ad.getByTestId('assign-worker')).toHaveText([/Pia Leit · Projektleiter/, /Max Muster · Polier/, /Anna Berg · Facharbeiter/, /Zoe Adler · Hilfsarbeiter/]);
  await page.keyboard.press('Escape');
});
