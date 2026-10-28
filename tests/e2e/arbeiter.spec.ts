import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, freshStart, OUT, saveDownload } from './helpers';

/**
 * Arbeitereinteilung: Arbeiter einmal anlegen, Arbeitszeit der Firma einmal eingeben, Baustellen aus
 * der Projektverwaltung bzw. manuell, Einteilung je Tag, Urlaub, Konflikt, Verschieben, nächste Woche
 * läuft weiter (fertiggestellte Baustelle fällt weg), ältere Woche bleibt unverändert.
 */

const site = (page: Page, name: string) => page.locator(`[data-testid="site-card"][data-site="${name}"]`);
const chips = (page: Page, name: string, day: number) => site(page, name).locator(`[data-testid="day-row"][data-day="${day}"] [data-testid="crew-chip"]`);

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
  await expect(page.getByTestId('crew-setup-times')).toBeVisible();
  await expect(page.getByTestId('crew-setup-workers')).toBeVisible();
  await page.getByTestId('week-date').fill('2026-10-28'); // Mittwoch → KW 44
  await expect(page.getByTestId('week-label')).toHaveText('KW 44');

  // Arbeitszeit der Firma (einmal): Freitag kürzer
  await page.getByTestId('crew-times').click();
  const t = page.getByTestId('times-dialog');
  await t.getByTestId('time-to-4').fill('12:00');
  await t.getByTestId('times-save').click();
  await expect(page.getByTestId('crew-setup-times')).toHaveCount(0);

  // Arbeiter einmal anlegen
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('workers-dialog');
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
  await expect(page.getByTestId('crew-workers')).toContainText('Arbeiter (4)');

  // Baustelle A aus der Projektverwaltung → gleich Arbeiter für die ganze Woche einteilen
  await page.getByTestId('add-site').click();
  const sd = page.getByTestId('site-dialog');
  await sd.getByTestId('site-project').selectOption({ label: '2026-04 · Neubau Musterstraße' });
  await expect(sd.getByTestId('site-name-input')).toHaveValue('Neubau Musterstraße');
  await expect(sd.getByTestId('site-address')).toHaveValue('Musterstraße 1');
  await sd.getByTestId('site-save').click();
  await assignDialog(page, ['Max Muster', 'Peter Bau']);
  for (const d of [0, 1, 2, 3, 4]) await expect(chips(page, 'Neubau Musterstraße', d)).toHaveText(['Max Muster', 'Peter Bau']);
  await expect(site(page, 'Neubau Musterstraße').locator('[data-day="4"]')).toContainText('07:00–12:00');

  // Baustelle B manuell
  await page.getByTestId('add-site').click();
  await page.getByTestId('site-dialog').getByTestId('site-source-new').click();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Sanierung Hauptplatz');
  await page.getByTestId('site-dialog').getByTestId('site-save').click();
  await assignDialog(page, ['Thomas Stein']);
  await expect(chips(page, 'Sanierung Hauptplatz', 0)).toHaveText(['Thomas Stein']);

  // Noch nicht eingeteilt: Stefan an jedem Tag → Urlaub für die ganze Woche
  const open = page.getByTestId('crew-open');
  await expect(open.getByTestId('open-chip')).toHaveCount(5);
  await open.locator('[data-day="0"] [data-testid="open-chip"]').click();
  await page.getByTestId('open-dialog').getByTestId('open-vacation').click();
  await expect(page.getByTestId('crew-open')).toHaveCount(0);
  await expect(page.getByTestId('crew-all-set')).toContainText('Alle Arbeiter sind eingeteilt');
  await expect(page.getByTestId('vacation-chip')).toHaveText(['Stefan Holz · Mo–Fr']);

  // Konflikt: Max zusätzlich am Montag auf B → Warnung, nach Bestätigung möglich
  await site(page, 'Sanierung Hauptplatz').locator('[data-day="0"] [data-testid="day-add"]').click();
  await expect(page.getByTestId('assign-dialog').locator('[data-worker="Max Muster"]')).toContainText('auf Neubau Musterstraße');
  await assignDialog(page, ['Max Muster']);
  await expect(page.getByTestId('conflict-list')).toContainText('Max Muster: Montag auf Neubau Musterstraße');
  await page.getByRole('button', { name: 'Trotzdem einteilen' }).click();
  await expect(chips(page, 'Sanierung Hauptplatz', 0)).toHaveText(['Thomas Stein', 'Max Muster']);
  await expect(chips(page, 'Sanierung Hauptplatz', 0).nth(1)).toHaveClass(/conflict/);
  // wieder nur an diesem Tag entfernen – andere Baustelle bleibt unverändert
  await chips(page, 'Sanierung Hauptplatz', 0).nth(1).click();
  await page.getByTestId('chip-dialog').getByTestId('chip-remove').click();
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
  await expect(site(page, 'Sanierung Hauptplatz')).toContainText('fertiggestellt');
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
  const wd = page.getByTestId('workers-dialog');
  await wd.getByTestId('worker-firstName').fill('Andreas');
  await wd.getByTestId('worker-save').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Umbau Gewerbepark');
  await page.getByTestId('site-dialog').getByTestId('site-save').click();
  await assignDialog(page, ['Andreas']);
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
  await page.getByTestId('times-dialog').getByTestId('times-save').click();
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('workers-dialog');
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
    await assignDialog(page, [who]);
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
  for (const s of ['Tagesliste Dienstag, 27.10.2026', 'Neubau Musterstraße', 'Max Muster', 'Polier', '0664 1234567']) expect(txt2).toContain(s);

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
  await expect(page.getByTestId('crew-workers')).toContainText('Arbeiter (2)');
  await page.getByTestId('crew-times').click();
  await expect(page.getByTestId('times-dialog').getByTestId('company-name')).toHaveValue('Muster Bau GmbH');
});

test('Baustelle ↔ Projekt: aus der Projektverwaltung wählen, als Projekt anlegen, Projekt aus der Arbeitereinteilung übernehmen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04', address: 'Musterstraße 1' });
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  const menu = async (name: string) => {
    await site(page, name).getByTestId('site-actions').click();
  };

  // 1) aus der Projektverwaltung wählen (Standard, wenn Projekte vorhanden)
  await page.getByTestId('add-site').click();
  let sd = page.getByTestId('site-dialog');
  await expect(sd.getByTestId('site-source-project')).toHaveAttribute('aria-checked', 'true');
  await sd.getByTestId('site-save').click();
  await expect(sd).toContainText('Bitte ein Projekt wählen.');
  await sd.getByTestId('site-project').selectOption({ label: '2026-04 · Neubau Musterstraße' });
  await sd.getByTestId('site-save').click();
  await page.getByTestId('assign-dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await menu('Neubau Musterstraße');
  await expect(page.getByTestId('site-to-project')).toHaveCount(0);
  await page.getByTestId('site-open-project').click();
  await expect(page.getByTestId('project-title')).toHaveText('Neubau Musterstraße');

  // 2) neue Baustelle, gleich auch als Projekt anlegen
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('add-site').click();
  sd = page.getByTestId('site-dialog');
  await sd.getByTestId('site-source-new').click();
  await sd.getByTestId('site-name-input').fill('Sanierung Hauptplatz');
  await sd.getByTestId('site-address').fill('Hauptplatz 3');
  await sd.getByTestId('site-also-project').locator('input').check();
  await sd.getByTestId('site-save').click();
  await expect(page.locator('.toast', { hasText: 'Projekt „Sanierung Hauptplatz“ in der Projektverwaltung angelegt' })).toHaveCount(1);
  await page.getByTestId('assign-dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await menu('Sanierung Hauptplatz');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // 3) neue Baustelle ohne Projekt – später über ⋮ als Projekt anlegen
  for (const n of ['Umbau Gewerbepark', 'Halle Nord']) {
    await page.getByTestId('add-site').click();
    sd = page.getByTestId('site-dialog');
    await sd.getByTestId('site-source-new').click();
    await sd.getByTestId('site-name-input').fill(n);
    await sd.getByTestId('site-save').click();
    await page.getByTestId('assign-dialog').getByRole('button', { name: 'Abbrechen' }).click();
  }
  await menu('Umbau Gewerbepark');
  await page.getByTestId('site-to-project').click();
  await expect(page.locator('.toast', { hasText: 'Projekt „Umbau Gewerbepark“' })).toHaveCount(1);
  await menu('Umbau Gewerbepark');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // 4) umgekehrt: in der Projektverwaltung ein Projekt aus der Arbeitereinteilung übernehmen
  await page.goto('./#/projekte');
  await page.getByTestId('new-project').click();
  const form = page.getByTestId('project-form');
  await expect(form.getByTestId('project-from-crew').locator('option')).toHaveText(['– Baustelle wählen –', 'Halle Nord']); // nur Baustellen ohne Projekt
  await form.getByTestId('project-from-crew').selectOption({ label: 'Halle Nord' });
  await expect(form.locator('input[name="name"]')).toHaveValue('Halle Nord');
  await form.getByRole('button', { name: 'Projekt anlegen' }).click();
  await expect(page.getByTestId('project-title')).toHaveText('Halle Nord');
  await page.goto('./#/projekte');
  await expect(page.getByTestId('project-card')).toHaveCount(4);
  // Baustelle ist jetzt mit dem Projekt verknüpft
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await menu('Halle Nord');
  await expect(page.getByTestId('site-open-project')).toHaveCount(1);
});
