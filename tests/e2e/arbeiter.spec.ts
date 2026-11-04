import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, freshStart, newWeekProject, OUT, pickWeekProject, saveDownload } from './helpers';

/**
 * Arbeitereinteilung: Arbeiter einmal anlegen, Arbeitszeit der Firma einmal eingeben, Baustellen aus
 * Aufmaß & Abrechnung bzw. manuell, Einteilung je Tag, Urlaub, Konflikt, Verschieben, nächste Woche
 * läuft weiter (fertiggestellte Baustelle fällt weg), ältere Woche bleibt unverändert.
 */

const site = (page: Page, name: string) => page.locator(`[data-testid="site-card"][data-site="${name}"]`);
const chips = (page: Page, name: string, day: number) => site(page, name).locator(`[data-testid="day-row"][data-day="${day}"] [data-testid="crew-chip"]`);

/** Namen antippen → „ab diesem Tag auf anderes Projekt“ (Ziehen gibt es nicht mehr) */
async function moveTo(page: Page, from: ReturnType<Page['locator']>, toSite: string) {
  await from.click();
  if ((await page.getByTestId('open-dialog').count()) > 0) {
    await page.getByTestId('open-dialog').locator(`[data-testid="open-site"][data-site="${toSite}"]`).click();
    return;
  }
  const cd = page.getByTestId('chip-dialog');
  await cd.getByTestId('chip-move-to').selectOption({ label: toSite });
  await cd.getByTestId('chip-move').click();
  await expect(cd).toHaveCount(0);
}

/** Projekte sind beim Öffnen der Einteilung zugeklappt – alle aufklappen */
async function expandAll(page: Page) {
  await expect(page.getByTestId('site-card').first()).toBeVisible();
  const t = page.locator('[data-testid="site-toggle"][aria-expanded="false"]');
  while ((await t.count()) > 0) await t.first().click();
}

/** „+“ am Montag einer Baustelle → Arbeiter für die ganze Woche */
async function addFromMonday(page: Page, name: string, names: string[]) {
  await site(page, name).locator('[data-day="0"] [data-testid="day-add"]').click();
  await assignDialog(page, names);
}

/** „Noch nicht eingeteilt“ ist klein – zum Prüfen der Namen aufklappen */
async function showOpen(page: Page) {
  const t = page.getByTestId('crew-open-toggle');
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
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
    await wd.getByTestId('staff-new').click();
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
  await pickWeekProject(page, 'Neubau Musterstraße');
  await expect(site(page, 'Neubau Musterstraße')).toContainText('Musterstraße 1');
  // Baustelle erscheint sofort, ohne Einteilungsfenster
  await expect(page.getByTestId('assign-dialog')).toHaveCount(0);
  await expect(site(page, 'Neubau Musterstraße')).toBeVisible();
  await addFromMonday(page, 'Neubau Musterstraße', ['Max Muster', 'Peter Bau']);
  for (const d of [0, 1, 2, 3, 4]) await expect(chips(page, 'Neubau Musterstraße', d)).toHaveText(['Max Muster', 'Peter Bau']);
  await expect(site(page, 'Neubau Musterstraße').locator('[data-day="4"]')).not.toContainText('07:00'); // keine Uhrzeit mehr in der Einteilung
  // immer alle 7 Tage; „ganze Woche“ schlägt Mo–Fr vor, Sa/So bleibt leer, ist aber einteilbar
  await expect(site(page, 'Neubau Musterstraße').getByTestId('day-row')).toHaveCount(7);
  await expect(site(page, 'Neubau Musterstraße').locator('[data-day="6"]')).toContainText('So 01.11.');
  await expect(chips(page, 'Neubau Musterstraße', 5)).toHaveCount(0);
  await expect(page.getByTestId('crew-week')).toContainText('26.10. – 01.11.2026');

  // Baustelle B manuell
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Sanierung Hauptplatz');
  await addFromMonday(page, 'Sanierung Hauptplatz', ['Thomas Stein']);
  await expect(chips(page, 'Sanierung Hauptplatz', 0)).toHaveText(['Thomas Stein']);

  // Diese Woche nicht eingeteilt (nur wer die ganze Woche nirgends ist): Stefan → Urlaub für die ganze Woche
  const open = page.getByTestId('crew-open');
  await expect(open.getByTestId('crew-open-toggle')).toContainText('Diese Woche nicht eingeteilt: 1');
  await showOpen(page);
  await expect(open.getByTestId('open-chip')).toHaveText(['Stefan Holz']);
  await open.getByTestId('open-chip').click(); // erster Arbeitstag: Di (Mo 26.10. Nationalfeiertag)
  await page.getByTestId('open-dialog').getByTestId('open-absence').click();
  const abs = page.getByTestId('absence-dialog');
  await expect(abs.getByTestId('absence-worker')).toHaveValue(/.+/);
  await expect(abs.getByTestId('absence-from')).toHaveValue('2026-10-27');
  await abs.getByTestId('absence-from').fill('2026-10-26'); // ganze Woche (Mo ist Feiertag)
  await expect(abs.getByTestId('absence-to')).toHaveValue('2026-10-30');
  await abs.getByTestId('absence-save').click();
  await expect(abs.getByTestId('absence-row')).toContainText(['Stefan Holz 26.10. – 30.10.']);
  await abs.getByRole('button', { name: 'Schließen' }).first().click();
  await expect(page.getByTestId('crew-open')).toHaveCount(0);
  await expect(page.getByTestId('crew-all-set')).toContainText('Alle Arbeiter sind eingeteilt');
  await expect(page.getByTestId('vacation-chip')).toHaveText(['Stefan Holz · Mo–Fr']);

  // Hinzufügen auf A nur am Montag: Thomas bleibt auf B und steht zusätzlich auf A (gekennzeichnet)
  await site(page, 'Neubau Musterstraße').locator('[data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  await expect(ad.getByTestId('assign-keep')).toHaveCount(0); // kein Kästchen mehr
  await expect(ad.locator('[data-worker="Thomas Stein"]')).toContainText('auch auf Sanierung Hauptplatz (doppelt)');
  for (const d of [1, 2, 3, 4]) await ad.getByTestId(`assign-day-${d}`).click(); // „+“ schlägt ab Montag die ganze Woche vor – hier nur Montag
  await assignDialog(page, ['Thomas Stein']);
  await expect(page.locator('.toast', { hasText: 'Doppelt eingeteilt auf Neubau Musterstraße: Thomas Stein' })).toHaveCount(1);
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveText(['Max Muster', 'Peter Bau', /Thomas Stein/]);
  await expect(chips(page, 'Neubau Musterstraße', 0).nth(2).getByTestId('chip-also')).toHaveText('+ Sanierung Hauptplatz');
  await expect(chips(page, 'Sanierung Hauptplatz', 0)).toHaveText([/Thomas Stein/]);
  await expect(chips(page, 'Sanierung Hauptplatz', 1)).toHaveText(['Thomas Stein']);
  // antippen → ab Montag zurück auf B
  await moveTo(page, chips(page, 'Neubau Musterstraße', 0).nth(2), 'Sanierung Hauptplatz');
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
  // beim Öffnen sind alle Projekte zugeklappt
  await expect(page.locator('[data-testid="site-toggle"][aria-expanded="true"]')).toHaveCount(0);
  await expandAll(page);
  await expect(chips(page, 'Sanierung Hauptplatz', 3)).toHaveText(['Thomas Stein', 'Peter Bau']);

  // nächste Woche läuft weiter: nur Baustelle A, gleiche Arbeiter je Wochentag, kein Urlaub übernommen
  await page.getByTestId('week-next').click();
  await expect(page.getByTestId('week-label')).toHaveText('KW 45');
  await expect(page.getByTestId('draft-banner')).toContainText('KW 44');
  await expect(page.getByTestId('site-card')).toHaveCount(1);
  await expect(chips(page, 'Neubau Musterstraße', 0)).toHaveText(['Max Muster', 'Peter Bau']);
  await expect(chips(page, 'Neubau Musterstraße', 3)).toHaveText(['Max Muster']);
  // Thomas ist die ganze Woche frei, Stefan wieder da → „Diese Woche nicht eingeteilt“ (Peter ist Mo/Di eingeteilt)
  await showOpen(page);
  await expect(page.getByTestId('crew-open').getByTestId('open-chip')).toHaveText(['Stefan Holz', 'Thomas Stein']);
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
  await wd.getByTestId('staff-new').click();
  await wd.getByTestId('worker-firstName').fill('Andreas');
  await wd.getByTestId('worker-save').click();
  await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Umbau Gewerbepark');
  await addFromMonday(page, 'Umbau Gewerbepark', ['Andreas']);
  await page.getByTestId('crew-workers').click();
  await wd.getByTestId('worker-row').first().getByTestId('worker-open').click();
  await wd.getByTestId('worker-active').click();
  await expect(wd.getByTestId('worker-row')).toHaveClass(/inactive/);
  await page.keyboard.press('Escape');
  // weiterhin sichtbar (als inaktiv markiert), aber nicht mehr in der Auswahl und nicht „offen“
  await expandAll(page);
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
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(f);
    await wd.getByTestId('worker-lastName').fill(l);
    await wd.getByTestId('worker-role').fill(role);
    await wd.getByTestId('worker-phone').fill(tel);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: f })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  for (const [name, who] of [
    ['Neubau Musterstraße', 'Max Muster'],
    ['Sanierung Hauptplatz', 'Thomas Stein'],
  ]) {
    await page.getByTestId('add-site').click();
    await newWeekProject(page, name);
    await addFromMonday(page, name, [who]);
  }

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
  for (const s of ['Arbeitereinteilung KW 44', 'Muster Bau GmbH', 'Neubau Musterstraße', 'Sanierung Hauptplatz', 'Max Muster']) expect(txt).toContain(s);

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
  await page.getByTestId('crew-carry').click(); // sichtbar in der Wochenleiste
  await expect(page.getByTestId('confirm-dialog')).toContainText('wird durch die Projekte und Arbeiter aus KW 44 ersetzt');
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
  await expandAll(page);
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
  await expect(page.getByTestId('project-picker').getByTestId('picker-item')).toHaveCount(1);
  await pickWeekProject(page, 'Neubau Musterstraße');
  await menu('Neubau Musterstraße');
  await expect(page.getByTestId('site-to-project')).toHaveCount(0);
  await page.getByTestId('site-open-project').click();
  await expect(page.getByTestId('project-title')).toHaveText('Neubau Musterstraße');

  // 2) neues Projekt aus der Einteilung – landet im Projektregister (auch in Aufmaß & Abrechnung)
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Sanierung Hauptplatz', { 'photo-site-address': 'Hauptplatz 3' });
  await expect(site(page, 'Sanierung Hauptplatz')).toBeVisible();
  await menu('Sanierung Hauptplatz');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // 3) weitere neue Projekte aus der Einteilung – jedes landet sofort im Register (kein „als Projekt anlegen“ mehr nötig)
  for (const n of ['Umbau Gewerbepark', 'Halle Nord']) {
    await page.getByTestId('add-site').click();
    await newWeekProject(page, n);
    await expect(site(page, n)).toBeVisible();
  }
  await menu('Umbau Gewerbepark');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
  await expect(page.getByTestId('site-to-project')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // 4) Aufmaß & Abrechnung zeigt nur dort benutzte Projekte; die aus der Einteilung stehen im Fenster „Projekt“ zum Übernehmen
  await page.goto('./#/projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await page.getByTestId('new-project').click();
  const pk = page.getByTestId('project-picker');
  await expect(pk.getByTestId('picker-item').locator('.proj-title')).toHaveText(['Halle Nord', 'Sanierung Hauptplatz', 'Umbau Gewerbepark']);
  await expect(pk.getByTestId('picker-item').first()).toContainText('Arbeitereinteilung'); // Marke: wo das Projekt schon benutzt wird
  await pk.getByTestId('picker-item').filter({ hasText: 'Halle Nord' }).click();
  await expect(page.getByTestId('project-title')).toHaveText('Halle Nord');
  await page.goto('./#/projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(2);
  // Baustelle ist jetzt mit dem Projekt verknüpft
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await menu('Halle Nord');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
});

test('Antippen: offenen Arbeiter einteilen, umsetzen ab Tag; bereits geplante Folgewoche wird mit umgesetzt', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max', 'Peter']) {
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  for (const n of ['Baustelle A', 'Baustelle B']) {
    await page.getByTestId('add-site').click();
    await newWeekProject(page, n);
  }
  // kein Ziehen mehr
  await expect(page.getByTestId('crew-drag-hint')).toHaveCount(0);
  // offenen Namen antippen → auf Baustelle A (restliche Woche)
  await showOpen(page);
  await moveTo(page, page.getByTestId('crew-open').getByTestId('open-chip').filter({ hasText: 'Max' }), 'Baustelle A');
  // Montag 26.10. ist Feiertag → ab Dienstag
  for (const d of [1, 4]) await expect(chips(page, 'Baustelle A', d)).toHaveText(['Max']);
  await expect(chips(page, 'Baustelle A', 0)).toHaveCount(0);
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
  // Max am Donnerstag antippen → ab Donnerstag auf B, von A automatisch entfernt; Folgewoche automatisch mit
  await moveTo(page, chips(page, 'Baustelle A', 3), 'Baustelle B');
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
    await wd.getByTestId('staff-new').click();
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
    await newWeekProject(page, n);
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
  await showOpen(page);
  await expect(page.getByTestId('crew-open').getByTestId('open-chip')).toHaveText(['Peter']);
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
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Baustelle A');
  await addFromMonday(page, 'Baustelle A', ['Max', 'Peter']);

  // Max am Mittwoch antippen → Urlaub vom 28.10. bis 04.11. (über das Wochenende in die nächste Woche)
  await chips(page, 'Baustelle A', 2).filter({ hasText: 'Max' }).click();
  await page.getByTestId('chip-dialog').getByTestId('chip-urlaub').click();
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
  // gleiche Tage nochmal eintragen → keine Doppelung (je Arbeiter und Tag nur ein Eintrag)
  await abs.getByTestId('absence-from').fill('2026-10-29');
  await abs.getByTestId('absence-to').fill('2026-10-30');
  await abs.getByTestId('absence-save').click();
  await expect(abs.getByTestId('absence-row')).toHaveCount(1);
  await abs.getByRole('button', { name: 'Schließen' }).first().click();

  // bleibt eingeteilt, an den Tagen markiert; nichts „offen“
  for (const d of [0, 1, 2, 3, 4]) await expect(chips(page, 'Baustelle A', d)).toHaveText(['Max', 'Peter']);
  await expect(chips(page, 'Baustelle A', 1).filter({ hasText: 'Max' })).not.toHaveClass(/away/);
  await expect(chips(page, 'Baustelle A', 2).filter({ hasText: 'Max' })).toHaveClass(/away/);
  await expect(chips(page, 'Baustelle A', 3).filter({ hasText: 'Peter' })).toHaveClass(/sick/);
  await expect(page.getByTestId('vacation-chip')).toHaveText(['Max · Mi–So']); // Urlaub geht übers Wochenende
  await expect(page.getByTestId('sick-chip')).toHaveText(['Peter · Do, Fr']);
  await expect(page.getByTestId('crew-all-set')).toBeVisible();
  // Urlaub/Krank oben fixiert (in der haftenden Kopfleiste mit der Woche)
  await expect(page.getByTestId('crew-sticky').getByTestId('crew-vacations')).toBeVisible();
  await expect(page.getByTestId('crew-sticky').getByTestId('crew-sick')).toBeVisible();
  await page.mouse.wheel(0, 2000);
  await expect(page.getByTestId('crew-sick')).toBeInViewport();
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
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  for (const n of ['Baustelle A', 'Baustelle B']) {
    await page.getByTestId('add-site').click();
    await newWeekProject(page, n);
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
  // Max ab Mittwoch auf B umsetzen → Mi–So auf B (Sa/So mit umgesetzt), Mo/Di bleibt A
  await moveTo(page, chips(page, 'Baustelle A', 2), 'Baustelle B');
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
    await sp.getByTestId('staff-new').click();
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
  // antippen klappt auf: Funktion ändern, Bearbeiten, Urlaub, Krank, Löschen
  const anna = sp.getByTestId('worker-row').filter({ hasText: 'Anna Berg' });
  await anna.getByTestId('worker-open').click();
  await expect(anna.getByTestId('worker-options')).toBeVisible();
  await anna.getByTestId('worker-grade-inline').selectOption('vorarbeiter');
  await expect(sp.getByTestId('staff-group')).toHaveText(['Projektleiter', 'Polier', 'Vorarbeiter', 'Hilfsarbeiter']);
  await anna.getByTestId('worker-edit').click();
  const wdlg = page.getByTestId('worker-dialog');
  await expect(wdlg.getByTestId('worker-firstName')).toHaveValue('Anna');
  await wdlg.getByTestId('worker-phone').fill('0660 1');
  await wdlg.getByTestId('worker-save').click();
  await expect(wdlg).toHaveCount(0);
  await expect(anna).toContainText('0660 1');
  // Urlaub direkt aus der Liste
  await anna.getByTestId('worker-urlaub').click();
  const abs = page.getByTestId('absence-dialog');
  await expect(abs.getByTestId('absence-worker')).toHaveValue(/.+/);
  await abs.getByTestId('absence-from').fill('2026-11-02');
  await abs.getByTestId('absence-to').fill('2026-11-06');
  await abs.getByTestId('absence-save').click();
  await expect(abs).toHaveCount(0);
  await expect(anna).toContainText('Urlaub');
  // löschen (mit Rückfrage): weg aus der Liste
  await sp.getByTestId('staff-new').click();
  await page.getByTestId('worker-dialog').getByTestId('worker-firstName').fill('Tim');
  await page.getByTestId('worker-dialog').getByTestId('worker-save').click();
  await expect(sp.getByTestId('worker-row')).toHaveCount(5);
  const tim = sp.getByTestId('worker-row').filter({ hasText: 'Tim' });
  await tim.getByTestId('worker-open').click();
  await tim.getByTestId('worker-delete').click();
  await page.getByRole('button', { name: 'Löschen' }).last().click();
  await expect(sp.getByTestId('worker-row')).toHaveCount(4);
  // Sortierung bleibt gespeichert; Escape führt zurück zur Einteilung
  await page.reload();
  await expect(sp.getByTestId('staff-sort-grade')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workers-title')).toHaveText('Arbeitereinteilung');
  await expect(page.getByTestId('crew-workers')).toContainText('Personal (4)');

  // Einteilung: offene Arbeiter und Auswahl nach Funktion geordnet
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Halle Nord');
  await site(page, 'Halle Nord').locator('[data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  // Projektleiter (Pia) ist nicht einteilbar
  await expect(ad.getByTestId('assign-worker')).toHaveText([/Max Muster · Polier/, /Anna Berg · Vorarbeiter/, /Zoe Adler · Hilfsarbeiter/]);
  await page.keyboard.press('Escape');
});

test('Doppelt einteilen: Arbeiter bleibt auf der ersten Baustelle und steht zusätzlich auf der zweiten, mit Kennzeichnung wo', async ({ page }) => {
  await freshStart(page);
  await page.goto('./arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const sp = page.getByTestId('staff-page');
  for (const n of ['Max', 'Peter']) {
    await sp.getByTestId('staff-new').click();
    await sp.getByTestId('worker-firstName').fill(n);
    await sp.getByTestId('worker-save').click();
    await expect(page.getByTestId('worker-dialog')).toHaveCount(0); // erst wenn das Fenster zu ist, führt Esc zurück
  }
  await page.keyboard.press('Escape');
  for (const n of ['Baustelle A', 'Baustelle B']) {
    await page.getByTestId('add-site').click();
    await newWeekProject(page, n);
  }
  await addFromMonday(page, 'Baustelle A', ['Max']);
  // immer doppelt (ohne Kästchen): Max bleibt auf A und kommt zusätzlich auf B
  await site(page, 'Baustelle B').locator('[data-day="0"] [data-testid="day-add"]').click();
  const dlg = page.getByTestId('assign-dialog');
  await expect(dlg.locator('[data-testid="assign-worker"][data-worker="Max"]')).toContainText('auch auf Baustelle A (doppelt)');
  await dlg.locator('[data-testid="assign-worker"][data-worker="Max"] input').check();
  await dlg.getByTestId('assign-save').click();
  await expect(page.locator('.toast', { hasText: 'Doppelt eingeteilt' })).toHaveCount(1);
  for (const d of [0, 4]) {
    await expect(chips(page, 'Baustelle A', d)).toHaveText([/Max/]);
    await expect(chips(page, 'Baustelle B', d)).toHaveText([/Max/]);
  }
  // Kennzeichnung: rot und „+ andere Baustelle“ auf beiden Seiten
  await expect(chips(page, 'Baustelle A', 0)).toHaveClass(/conflict/);
  await expect(chips(page, 'Baustelle A', 0).getByTestId('chip-also')).toHaveText('+ Baustelle B');
  await expect(chips(page, 'Baustelle B', 0).getByTestId('chip-also')).toHaveText('+ Baustelle A');
  // Hinweis im Namensdialog; nur hier entfernen lässt A unberührt
  await chips(page, 'Baustelle B', 0).click();
  await expect(page.getByTestId('chip-dialog').getByTestId('chip-also-hint')).toContainText('auch auf Baustelle A');
  await page.getByTestId('chip-dialog').getByTestId('chip-remove').click();
  await expect(chips(page, 'Baustelle B', 0)).toHaveCount(0);
  await expect(chips(page, 'Baustelle A', 0)).toHaveText(['Max']);
  await expect(chips(page, 'Baustelle A', 0).getByTestId('chip-also')).toHaveCount(0);
  // Peter ist die ganze Woche frei → kleine Meldung, antippen zeigt ihn
  const toggle = page.getByTestId('crew-open-toggle');
  await expect(toggle).toContainText('Diese Woche nicht eingeteilt: 1');
  await expect(page.getByTestId('open-chip')).toHaveCount(0);
  await toggle.click();
  await expect(page.getByTestId('crew-open').getByTestId('open-chip')).toHaveText(['Peter']);
});

test('Einteilen: Arbeiter suchen; Vorwoche übernehmen als sichtbarer Knopf', async ({ page }) => {
  await freshStart(page);
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Andrea Pascu', 'Patrik Vojtek', 'Günter Wagner']) {
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await page.getByTestId('project-picker').getByTestId('picker-new').click();
  await page.getByTestId('project-name').fill('91300');
  await page.getByTestId('project-save').click();
  await page.locator('[data-site="91300"] [data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  await expect(ad.getByTestId('assign-worker')).toHaveCount(3);
  await ad.getByTestId('assign-worker').filter({ hasText: 'Andrea' }).locator('input').check();
  await ad.getByTestId('assign-search').fill('wag');
  await expect(ad.getByTestId('assign-worker')).toHaveText([/Günter Wagner/]);
  await ad.getByTestId('assign-worker').locator('input').check();
  await ad.getByTestId('assign-search').fill('');
  await expect(ad.getByTestId('assign-worker')).toHaveCount(3);
  await expect(ad.getByTestId('assign-save')).toHaveText('2 einteilen'); // Auswahl bleibt beim Suchen erhalten
  await ad.getByTestId('assign-save').click();
  await expect(page.getByTestId('crew-carry')).toHaveText(/Vorwoche übernehmen/);
});

test('Mitarbeiter schon hinterlegt: Meldung beim Anlegen, nur nach Rückfrage doppelt', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  await wd.getByTestId('staff-new').click();
  await wd.getByTestId('worker-firstName').fill('Max');
  await wd.getByTestId('worker-lastName').fill('Muster');
  await wd.getByTestId('worker-staffNo').fill('17');
  await wd.getByTestId('worker-save').click();
  await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
  // gleicher Name (andere Schreibweise): Hinweis schon beim Tippen
  await wd.getByTestId('staff-new').click();
  await wd.getByTestId('worker-firstName').fill('max ');
  await wd.getByTestId('worker-lastName').fill('MUSTER');
  await expect(page.getByTestId('worker-duplicate')).toContainText('Max Muster (Personalnr. 17) ist schon hinterlegt');
  await wd.getByTestId('worker-save').click();
  const cf = page.getByTestId('confirm-dialog');
  await expect(cf).toContainText('Mitarbeiter schon hinterlegt');
  await cf.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('worker-dialog')).toBeVisible();
  // gleiche Personalnummer bei anderem Namen
  await wd.getByTestId('worker-firstName').fill('Peter');
  await wd.getByTestId('worker-lastName').fill('Beispiel');
  await wd.getByTestId('worker-staffNo').fill('17');
  await expect(page.getByTestId('worker-duplicate')).toContainText('hat dieselbe Personalnummer');
  await wd.getByTestId('worker-staffNo').fill('18');
  await expect(page.getByTestId('worker-duplicate')).toHaveCount(0);
  await wd.getByTestId('worker-save').click();
  await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
  await expect(wd.getByTestId('worker-row')).toHaveCount(2);
  // bewusst doppelt anlegen geht nach Bestätigung
  await wd.getByTestId('staff-new').click();
  await wd.getByTestId('worker-firstName').fill('Max');
  await wd.getByTestId('worker-lastName').fill('Muster');
  await wd.getByTestId('worker-save').click();
  await cf.getByRole('button', { name: 'Trotzdem anlegen' }).click();
  await expect(wd.getByTestId('worker-row')).toHaveCount(3);
});

test('Baustellen: Anzahl der Woche, sortieren nach Projektnummer/Anlegedatum mit Pfeil auf/ab', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  for (const [name, no] of [
    ['Alpha', '300'],
    ['Beta', '100'],
    ['Gamma', '200'],
  ]) {
    await page.getByTestId('add-site').click();
    await newWeekProject(page, name, { 'project-number': no });
    await page.waitForTimeout(20); // unterschiedliche Anlegezeit
  }
  await expect(page.getByTestId('crew-sites-count')).toHaveText('3 Projekte');
  const names = () => page.getByTestId('site-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-site')));
  await expect.poll(names).toEqual(['Alpha', 'Beta', 'Gamma']);
  const order = page.getByTestId('crew-order');
  const dir = page.getByTestId('crew-order-dir');
  await order.selectOption('number');
  await expect(dir).toHaveAttribute('data-dir', 'asc');
  await expect.poll(names).toEqual(['Beta', 'Gamma', 'Alpha']);
  await dir.click();
  await expect(dir).toHaveAttribute('data-dir', 'desc');
  await expect.poll(names).toEqual(['Alpha', 'Gamma', 'Beta']);
  await order.selectOption('created'); // absteigend = neueste zuerst
  await expect.poll(names).toEqual(['Gamma', 'Beta', 'Alpha']);
  await dir.click();
  await expect.poll(names).toEqual(['Alpha', 'Beta', 'Gamma']);
  // gemerkt
  await order.selectOption('number');
  await page.reload();
  await expect(page.getByTestId('crew-order')).toHaveValue('number');
  await expect(page.getByTestId('crew-order-dir')).toHaveAttribute('data-dir', 'asc');
  await expect.poll(names).toEqual(['Beta', 'Gamma', 'Alpha']);
});

test('Projektleiter in der Einteilung: aus dem Personal wählen, Anzeige bei der Baustelle und im PDF, Vertretung nur diese Woche', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  // Personal: Projektleiter mit Handynummer
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  await wd.getByTestId('staff-new').click();
  await wd.getByTestId('worker-firstName').fill('Paul');
  await wd.getByTestId('worker-lastName').fill('Leiter');
  // nur noch diese Funktionen zur Auswahl
  await expect(wd.getByTestId('worker-grade').locator('option')).toHaveText(['– bitte wählen –', 'Projektleiter', 'Polier', 'Vorarbeiter', 'Facharbeiter', 'Hilfsarbeiter']);
  await wd.getByTestId('worker-grade').selectOption('projektleiter');
  await wd.getByTestId('worker-phone').fill('0664 123');
  await wd.getByTestId('worker-save').click();
  await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Projekt anlegen, Projektleiter in der Einteilung eintragen (⋮ → Projekt bearbeiten)
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Parkring');
  const card = page.locator('[data-testid="site-card"][data-site="Parkring"]');
  await expect(card.getByTestId('site-manager-line')).toHaveCount(0);
  // Projektleiter ist nicht in der Woche einteilbar: keine „nicht eingeteilt“-Warnung, nicht im Zuweisen-Dialog
  await expect(page.getByTestId('crew-open')).toHaveCount(0);
  await card.getByTestId('day-add').first().click();
  await expect(page.getByTestId('assign-dialog')).toBeVisible();
  await expect(page.getByTestId('assign-dialog')).not.toContainText('Paul Leiter');
  await page.keyboard.press('Escape');
  await card.getByTestId('site-actions').click();
  await page.getByTestId('site-edit').click();
  const sd = page.getByTestId('site-dialog');
  // zur Auswahl stehen nur Personen mit der Funktion Projektleiter
  await expect(sd.getByTestId('site-manager-select').locator('option')).toHaveText(['– keiner –', 'Paul Leiter']);
  await sd.getByTestId('site-manager-select').selectOption({ label: 'Paul Leiter' });
  await expect(sd.getByTestId('site-manager-phone')).toHaveValue('0664 123');
  await sd.getByTestId('site-save').click();
  await expect(card.getByTestId('site-manager-line')).toHaveText('PL: Paul Leiter · 0664 123');
  // Wochen-PDF mit Projektleiter
  const dl = await catchDownload(page, () => page.getByTestId('crew-pdf').click());
  const txt = execFileSync('pdftotext', ['-layout', await saveDownload(dl, 'projektleiter.pdf'), '-'], { encoding: 'utf8' });
  expect(txt).toContain('PL: Paul Leiter · 0664 123');
  await page.keyboard.press('Escape');
  // Vertretung nur diese Woche
  await card.getByTestId('site-actions').click();
  await page.getByTestId('site-edit').click();
  await expect(sd.getByTestId('site-manager-select')).toHaveValue(/.+/);
  await sd.getByTestId('site-deputy-on').check();
  await sd.getByTestId('site-deputy-name').fill('Vera Vertretung');
  await sd.getByTestId('site-deputy-phone').fill('0676 9');
  await sd.getByTestId('site-save').click();
  await expect(card.getByTestId('site-manager-line')).toContainText('PL: Vera Vertretung · 0676 9');
  await expect(card.getByTestId('site-manager-line')).toContainText('Vertretung diese Woche');
  // nächste Woche (weitergeführt): wieder die Bauleitung des Projekts
  await page.getByTestId('week-next').click();
  await expect(page.locator('[data-testid="site-card"][data-site="Parkring"]').getByTestId('site-manager-line')).toHaveText('PL: Paul Leiter · 0664 123');
});

test('Feiertage in Österreich automatisch gekennzeichnet (jedes Jahr); Warnung nur, wer die ganze Woche frei ist', async ({ page }) => {
  await freshStart(page);
  await page.goto('./arbeitereinteilung');
  await page.getByTestId('crew-workers').click();
  const sp = page.getByTestId('staff-page');
  await sp.getByTestId('staff-new').click();
  await sp.getByTestId('worker-firstName').fill('Max');
  await sp.getByTestId('worker-save').click();
  await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // KW 44/2026: Montag 26.10. Nationalfeiertag
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Parkring');
  const card = site(page, 'Parkring');
  await expect(card.locator('[data-testid="day-row"][data-day="0"]').getByTestId('day-holiday')).toHaveText('Nationalfeiertag');
  await expect(card.locator('[data-testid="day-row"][data-day="0"]')).toHaveClass(/holiday/);
  await expect(page.getByTestId('crew-open')).toContainText('Diese Woche nicht eingeteilt: 1');
  // anderes Jahr, bewegliche Feiertage: Ostermontag 2027 = 29.03.2027, Christi Himmelfahrt 06.05.2027
  for (const [date, day, name] of [
    ['2027-03-29', '0', 'Ostermontag'],
    ['2027-05-06', '3', 'Christi Himmelfahrt'],
  ]) {
    await page.getByTestId('week-date').fill(date);
    if (!(await site(page, 'Parkring').count())) {
      await page.getByTestId('add-site').click();
      await pickWeekProject(page, 'Parkring');
    }
    await expect(site(page, 'Parkring').locator(`[data-testid="day-row"][data-day="${day}"]`).getByTestId('day-holiday')).toHaveText(name);
  }
});

test('Arbeiter antippen: Tage der Woche markiert und umschaltbar, Urlaub/Krank-Knöpfe; Einteilen hebt Krank auf, Löschen bietet Einteilen an', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-11-02');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  for (const n of ['Max', 'Peter']) {
    await wd.getByTestId('staff-new').click();
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await newWeekProject(page, 'Baustelle A');
  await addFromMonday(page, 'Baustelle A', ['Max']);

  // Max antippen: Mo–Fr markiert, Sa/So nicht; seine Namen im Projekt hervorgehoben
  await chips(page, 'Baustelle A', 2).click();
  const cd = page.getByTestId('chip-dialog');
  for (const d of [0, 1, 2, 3, 4]) await expect(cd.locator(`[data-testid="chip-day"][data-day="${d}"]`)).toHaveAttribute('aria-pressed', 'true');
  for (const d of [5, 6]) await expect(cd.locator(`[data-testid="chip-day"][data-day="${d}"]`)).toHaveAttribute('aria-pressed', 'false');
  await expect(chips(page, 'Baustelle A', 0)).toHaveClass(/picked/);
  // Freitag austragen, Samstag eintragen – direkt im Menü
  await cd.locator('[data-testid="chip-day"][data-day="4"]').click();
  await cd.locator('[data-testid="chip-day"][data-day="5"]').click();
  await expect(cd.locator('[data-testid="chip-day"][data-day="4"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(cd.locator('[data-testid="chip-day"][data-day="5"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(chips(page, 'Baustelle A', 4)).toHaveCount(0);
  await expect(chips(page, 'Baustelle A', 5)).toHaveText(['Max']);
  // Urlaub-/Krank-Knöpfe direkt im Menü
  await expect(cd.getByTestId('chip-krank')).toBeVisible();
  await cd.getByTestId('chip-urlaub').click();
  await expect(page.getByTestId('absence-dialog')).toBeVisible();
  await page.getByTestId('absence-dialog').getByRole('button', { name: 'Schließen' }).first().click();
  // kein Ziehen mehr
  await expect(page.getByTestId('crew-drag-hint')).toHaveCount(0);

  // Peter (offen) krank Mo–Fr über das Menü „Nicht eingeteilt“
  await showOpen(page);
  await page.getByTestId('open-chip').filter({ hasText: 'Peter' }).click();
  await page.getByTestId('open-dialog').getByTestId('open-krank').click();
  const abs = page.getByTestId('absence-dialog');
  await abs.getByTestId('absence-from').fill('2026-11-02');
  await abs.getByTestId('absence-to').fill('2026-11-06');
  await abs.getByTestId('absence-save').click();
  await abs.getByRole('button', { name: 'Schließen' }).first().click();
  await expect(page.getByTestId('sick-chip')).toHaveText(['Peter · Mo–Fr']);
  // Peter ab Mittwoch einteilen → Krank Mi–Fr automatisch aufgehoben
  await site(page, 'Baustelle A').locator('[data-day="2"] [data-testid="day-add"]').click();
  await assignDialog(page, ['Peter']);
  await expect(page.locator('.toast', { hasText: 'Urlaub/Krank aufgehoben: Peter (Mi, Do, Fr)' })).toHaveCount(1);
  await expect(page.getByTestId('sick-chip')).toHaveText(['Peter · Mo, Di']);
  await expect(chips(page, 'Baustelle A', 2).filter({ hasText: 'Peter' })).not.toHaveClass(/sick/);
  // Krank (Mo/Di) löschen → gleich auf ein Projekt einteilen
  await page.getByTestId('sick-chip').click();
  await abs.getByTestId('absence-delete').click();
  const od = page.getByTestId('open-dialog');
  await expect(od).toBeVisible();
  await od.locator('[data-testid="open-site"][data-site="Baustelle A"]').click();
  await expect(chips(page, 'Baustelle A', 0).filter({ hasText: 'Peter' })).toHaveCount(1);
  await expect(page.getByTestId('crew-sick')).toHaveCount(0);
});

test('Einstellungen der Einteilung: Bezeichnung der Projekte, Reihenfolge, Funktion im PDF; PDF mit BauPad-Viereck und Fußzeile', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-11-02');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('staff-page');
  await wd.getByTestId('staff-new').click();
  await wd.getByTestId('worker-firstName').fill('Max');
  await wd.getByTestId('worker-lastName').fill('Muster');
  await wd.getByTestId('worker-grade').selectOption('polier');
  await wd.getByTestId('worker-save').click();
  await expect(page.getByTestId('worker-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const [name, no] of [
    ['Alpha', '300'],
    ['Beta', '100'],
  ]) {
    await page.getByTestId('add-site').click();
    await newWeekProject(page, name, { 'project-number': no });
  }
  await addFromMonday(page, 'Alpha', ['Max Muster']);
  const names = () => page.getByTestId('site-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-site')));
  await expect.poll(names).toEqual(['Alpha', 'Beta']);
  // Einstellungen: Name · Projektnummer, nach Projektnummer, Funktion im PDF
  await page.getByTestId('crew-times').click();
  const sd = page.getByTestId('times-dialog');
  await expect(sd).toContainText('Einstellungen Arbeitereinteilung');
  await sd.getByTestId('set-site-label').selectOption('name-number');
  await sd.getByTestId('set-site-order').selectOption('number');
  await sd.getByTestId('set-pdf-grades').check();
  await sd.getByTestId('times-save').click();
  await expect(sd).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Einstellungen gespeichert' })).toHaveCount(1);
  await expect.poll(names).toEqual(['Beta', 'Alpha']);
  await expect(site(page, 'Alpha').getByTestId('site-name')).toHaveText('Alpha · 300');
  // Projektnummer später im Register geändert → PDF nimmt die aktuelle Nummer (wie die App)
  await page.goto('./baupad/projektregister');
  await page.getByTestId('register-row').filter({ hasText: 'Beta' }).getByTestId('register-edit').click();
  await page.getByTestId('photo-site-number').fill('101');
  await page.getByTestId('photo-site-save').click();
  await expect(page.locator('.toast').first()).toBeVisible();
  await page.goto('./baupad/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-11-02');
  await expect(page.getByTestId('site-card')).toHaveCount(2);
  await expect(site(page, 'Beta').getByTestId('site-name')).toHaveText('Beta · 101'); // Einstellungen und Register geladen (Nummer aus dem Register)
  const dl = await catchDownload(page, () => page.getByTestId('crew-pdf').click());
  const txt = execFileSync('pdftotext', ['-layout', await saveDownload(dl, 'einstellungen.pdf'), '-'], { encoding: 'utf8' });
  expect(txt).toContain('Alpha · 300');
  expect(txt).toContain('Beta · 101');
  expect(txt).toContain('Max Muster · PO');
  expect(txt).toContain('Erstellt mit BauPad · pad-software.at');
  await page.keyboard.press('Escape');
  // gemerkt
  await page.reload();
  await page.getByTestId('crew-times').click();
  await expect(page.getByTestId('set-site-label')).toHaveValue('name-number');
  await expect(page.getByTestId('set-pdf-grades')).toBeChecked();
});
