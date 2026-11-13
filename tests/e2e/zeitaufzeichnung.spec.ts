import { expect, test, type Page } from './fixtures';
import { createProject, freshStart, saveDownload } from './helpers';
import { readFileSync } from 'node:fs';

/**
 * Zeitaufzeichnung: Der Polier tippt für seine Arbeiter je Tag Baustelle und Stunden (Vorschlag aus der
 * Einteilung), Wegzeit optional; Monatszettel je Person mit zweiter Baustelle; Excel; Freigabe sperrt für den Polier.
 */

/** Projekt + Einteilung: Max und Peter Mo–Fr auf Parkring (KW 44/2026) */
async function setup(page: Page) {
  await freshStart(page);
  await createProject(page, 'Parkring', { number: '91300' });
  await page.goto('./baupad/aufmass-und-abrechnung');
  await createProject(page, 'Halle 3', {});
  await page.goto('./baupad/arbeitereinteilung');
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
  await page.getByTestId('project-picker').getByTestId('picker-item').filter({ hasText: 'Parkring' }).click();
  await page.locator('[data-site="Parkring"] [data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  for (const n of ['Max', 'Peter']) await ad.locator(`[data-worker="${n}"] input`).check();
  await ad.getByTestId('assign-save').click();
  await expect(page.locator('[data-site="Parkring"] [data-day="2"] [data-testid="crew-chip"]')).toHaveText(['Max', 'Peter']);
}

const row = (page: Page, name: string) => page.locator(`[data-testid="times-day-row"][data-name="${name}"]`);

test('Tag erfassen, Monatszettel mit Wegzeit und zweiter Baustelle, Excel, Freigabe', async ({ page }) => {
  test.setTimeout(150_000);
  await setup(page);

  // Kachel in den Tools
  await page.goto('./baupad/tools');
  await page.getByTestId('tool-times').click();
  await expect(page.getByTestId('times-title')).toHaveText('Zeitaufzeichnung');
  // einmalige Frage nach den Arbeitszeiten – hier später
  await page.getByTestId('worktimes-dialog').getByTestId('worktimes-later').click();

  // Tag erfassen: Vorschlag aus der Einteilung (Parkring, 07:00–16:00, Pause 0:30 = 8,5 h), Peter ändern, Rest übernehmen
  await page.getByTestId('times-date').fill('2026-10-28');
  await expect(page.getByTestId('times-day-row')).toHaveCount(2);
  await expect(row(page, 'Max')).toHaveAttribute('data-state', 'suggested');
  await expect(row(page, 'Max').getByTestId('times-from')).toHaveValue('07:00');
  await expect(row(page, 'Max').getByTestId('times-to')).toHaveValue('16:00');
  // Pause von–bis (Vorschlag Mittag), Dauer automatisch
  await expect(row(page, 'Max').getByTestId('times-pause-from')).toHaveValue('12:00');
  await expect(row(page, 'Max').getByTestId('times-pause-to')).toHaveValue('12:30');
  await expect(row(page, 'Max').getByTestId('times-pause')).toContainText('0:30');
  await expect(row(page, 'Max').getByTestId('times-hours')).toHaveText('8,5 h');
  await expect(row(page, 'Max').getByTestId('times-site')).toHaveValue(/^p:/);
  await row(page, 'Peter').getByTestId('times-to').fill('15:00');
  await expect(row(page, 'Peter')).toHaveAttribute('data-state', 'done');
  await expect(row(page, 'Peter').getByTestId('times-hours')).toHaveText('7,5 h');
  await row(page, 'Peter').getByTestId('times-pause-to').fill('13:00');
  await expect(row(page, 'Peter').getByTestId('times-pause')).toContainText('1:00');
  await expect(row(page, 'Peter').getByTestId('times-hours')).toHaveText('7 h');
  await row(page, 'Peter').getByTestId('times-travel').fill('1,5');
  await row(page, 'Peter').getByTestId('times-travel').press('Enter');
  await expect(page.getByTestId('times-confirm-all')).toHaveText(/\(1\)/);
  await page.getByTestId('times-confirm-all').click();
  await expect(row(page, 'Max')).toHaveAttribute('data-state', 'done');
  // Peters Zeiten bleiben ab jetzt als Vorschlag (nächster Tag: bis 15:00, Pause 1:00)
  await page.getByTestId('times-date').fill('2026-10-29');
  await expect(row(page, 'Peter')).toHaveAttribute('data-state', 'suggested');
  await expect(row(page, 'Peter').getByTestId('times-to')).toHaveValue('15:00');
  await expect(row(page, 'Peter').getByTestId('times-pause-from')).toHaveValue('12:00');
  await expect(row(page, 'Peter').getByTestId('times-pause-to')).toHaveValue('13:00');
  await expect(row(page, 'Peter').getByTestId('times-pause')).toContainText('1:00');
  await expect(row(page, 'Max').getByTestId('times-to')).toHaveValue('16:00');
  // Kopfzeile: Wochentag, Datum, Pfeile für Vortag/nächsten Tag
  await expect(page.getByTestId('times-weekday')).toHaveText('Donnerstag');
  await page.getByTestId('times-day-next').click();
  await expect(page.getByTestId('times-date')).toHaveValue('2026-10-30');
  await expect(page.getByTestId('times-weekday')).toHaveText('Freitag');
  await page.getByTestId('times-day-prev').click();
  await expect(page.getByTestId('times-date')).toHaveValue('2026-10-29');
  // Urlaub/Krank je Arbeiter: keine Stunden; wieder anwesend → Vorschlag
  await row(page, 'Peter').getByTestId('times-absence').selectOption('krank');
  await expect(row(page, 'Peter')).toContainText('Krank – keine Stunden');
  await expect(row(page, 'Peter').getByTestId('times-from')).toHaveCount(0);
  await row(page, 'Peter').getByTestId('times-absence').selectOption('');
  await expect(row(page, 'Peter')).toHaveAttribute('data-state', 'suggested');
  await expect(row(page, 'Peter').getByTestId('times-to')).toHaveValue('15:00');
  // Urlaub: steht nicht mehr oben in der Liste, sondern eingeklappt darunter – dort wieder auf „anwesend“ stellen
  await row(page, 'Peter').getByTestId('times-absence').selectOption('urlaub');
  await expect(page.getByTestId('times-away')).toContainText('Im Urlaub (1): Peter');
  await expect(row(page, 'Peter')).toBeHidden();
  await expect(page.locator('[data-testid="times-day-row"]:visible')).toHaveCount(1);
  await page.getByTestId('times-away').locator('summary').click();
  await expect(row(page, 'Peter')).toContainText('Urlaub – keine Stunden');
  await row(page, 'Peter').getByTestId('times-absence').selectOption('');
  await expect(page.getByTestId('times-away')).toHaveCount(0);
  await expect(row(page, 'Peter')).toHaveAttribute('data-state', 'suggested');

  // Monatsliste: Oktober, Stunden je Person
  await page.getByTestId('times-prev').click();
  await page.getByTestId('times-next').click();
  await expect(page.getByTestId('times-month-label')).toHaveText('Oktober 2026');
  await expect(page.locator('[data-testid="times-person"][data-name="Max"]').getByTestId('times-person-sum')).toContainText('8,5 h');
  await expect(page.locator('[data-testid="times-person"][data-name="Peter"]').getByTestId('times-person-sum')).toContainText('7 h');

  // Monatszettel Max: Do vorgeschlagen → übernehmen; Fr zweite Baustelle
  await page.locator('[data-testid="times-person"][data-name="Max"]').click();
  await expect(page.getByTestId('timesheet-title')).toHaveText('Max');
  await expect(page.getByTestId('timesheet-month')).toHaveText('Oktober 2026');
  const thu = page.locator('[data-testid="timesheet-day"][data-date="2026-10-29"]');
  await expect(thu.getByTestId('timesheet-suggestion')).toHaveText('Parkring 07:00–16:00, 8,5 h');
  await thu.getByTestId('timesheet-take').click();
  await expect(thu).toHaveAttribute('data-state', 'done');
  // Fr: vormittags Parkring 07:00–11:30, nachmittags Halle 3 11:30–16:00 (ohne Pause)
  const fri = page.locator('[data-testid="timesheet-day"][data-date="2026-10-30"]');
  await fri.getByTestId('timesheet-edit').click();
  await expect(fri).toHaveAttribute('data-state', 'done');
  await fri.getByTestId('timesheet-to').fill('11:30');
  await expect(fri.getByTestId('timesheet-line-hours')).toHaveText('4 h');
  await fri.getByTestId('timesheet-add-line').click();
  await expect(fri.getByTestId('timesheet-from').nth(1)).toHaveValue('11:30');
  await fri.getByTestId('timesheet-site').nth(1).selectOption({ label: 'Halle 3' });
  await expect(fri.getByTestId('timesheet-day-sum')).toHaveText('8,5 h');
  await expect(page.getByTestId('timesheet-summary')).toContainText('25,5 h');
  await expect(page.getByTestId('timesheet-summary')).toContainText('Halle 3 4,5 h');
  // Nationalfeiertag ohne Vorschlag; Samstag frei
  await expect(page.locator('[data-testid="timesheet-day"][data-date="2026-10-26"]')).toContainText('Nationalfeiertag');

  // Excel in der Firmenvorlage: Jahresdatei 2026 (Oktober-Blatt mit Zeiten und Baustellen)
  const dl = page.waitForEvent('download');
  await page.getByTestId('timesheet-excel').click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('Zeitaufzeichnung_2026_Max.xlsx');
  const file = await saveDownload(d, 'zeit.xlsx');
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(readFileSync(file)));
  const oct = strFromU8(files['xl/worksheets/sheet11.xml']);
  expect(oct).toContain('Parkring; Halle 3');
  expect(oct).toMatch(/<c r="C31"[^>]*><v>0\.2916666666666667<\/v>/); // 29.10. 07:00

  // Freigabe: Polier kann danach nichts mehr ändern
  await page.getByTestId('timesheet-approve').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Freigeben' }).click();
  await expect(page.getByTestId('timesheet-approved')).toContainText('Freigegeben am');
  // beim Freigeben gespeichert: Monatsstand als Datei
  const dl2 = page.waitForEvent('download');
  await page.getByTestId('timesheet-stored').click();
  expect((await dl2).suggestedFilename()).toBe('Zeitaufzeichnung_2026-10_Max.xlsx');
  const context = { workspace_id: '11111111-1111-4111-8111-111111111111', workspace_name: 'Testfirma', role: 'polier', pkg: 'team', tools: ['projects', 'photos', 'reports', 'workers', 'defects'], sites: [], tool_sites: {}, operator: false, name: 'Polier Paul', phone: '' };
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(context) }));
  await page.reload();
  // Monatszettel, Freigabe und Excel macht nur das Büro – der Polier sieht nur den Hinweis
  await expect(page.getByTestId('timesheet-office-only')).toBeVisible();
  await expect(page.getByTestId('timesheet-approve')).toHaveCount(0);
  await expect(fri.getByTestId('timesheet-site')).toHaveCount(0);
});

test('Arbeitszeiten des Unternehmens einmalig festlegen: Vorschlag je Tag, Abweichung nur an dem Tag', async ({ page }) => {
  await setup(page);
  await page.goto('./baupad/zeitaufzeichnung');
  const dlg = page.getByTestId('worktimes-dialog');
  await expect(dlg).toContainText('Arbeitszeiten eures Unternehmens');
  // Dienstag und Mittwoch: 06:30–16:00, Pause 12:00–12:45
  for (const d of ['1', '2']) {
    const r = dlg.locator(`[data-testid="worktimes-row"][data-day="${d}"]`);
    await expect(r.getByTestId('worktimes-from')).toHaveValue('07:00');
    await r.getByTestId('worktimes-from').fill('06:30');
    await r.getByTestId('worktimes-pause-from').fill('12:00');
    await r.getByTestId('worktimes-pause-to').fill('12:45');
    await expect(r.getByTestId('worktimes-hours')).toContainText('8,75');
  }
  await dlg.getByTestId('worktimes-save').click();
  await expect(dlg).toHaveCount(0);
  // Dienstag: Vorschlag aus den Arbeitszeiten
  await page.getByTestId('times-date').fill('2026-10-27');
  await expect(row(page, 'Max').getByTestId('times-from')).toHaveValue('06:30');
  await expect(row(page, 'Max').getByTestId('times-pause-to')).toHaveValue('12:45');
  await expect(row(page, 'Max').getByTestId('times-hours')).toHaveText('8,75 h');
  // länger gearbeitet: nur an diesem Tag ausbessern (wird sofort gespeichert) – mit der Zahlentastatur „1700“
  await expect(row(page, 'Max').getByTestId('times-to')).toHaveAttribute('inputmode', 'numeric');
  await row(page, 'Max').getByTestId('times-to').click();
  await page.keyboard.type('1700');
  await expect(row(page, 'Max').getByTestId('times-to')).toHaveValue('17:00');
  await expect(row(page, 'Max').getByTestId('times-pause-from')).toBeFocused(); // springt ins nächste Feld
  await expect(row(page, 'Max').getByTestId('times-hours')).toHaveText('9,75 h');
  await expect(row(page, 'Max')).toHaveAttribute('data-state', 'done');
  // nächster Tag: wieder die Arbeitszeit des Unternehmens
  await page.getByTestId('times-date').fill('2026-10-28');
  await expect(row(page, 'Max').getByTestId('times-to')).toHaveValue('16:00');
  await expect(row(page, 'Max').getByTestId('times-hours')).toHaveText('8,75 h');
  // nach dem Neuladen nicht mehr gefragt; über die Taste änderbar
  await page.reload();
  await expect(page.getByTestId('times-title')).toBeVisible();
  await expect(page.getByTestId('worktimes-dialog')).toHaveCount(0);
  await page.getByTestId('times-worktimes').click();
  await expect(page.getByTestId('worktimes-dialog').locator('[data-day="1"]').getByTestId('worktimes-from')).toHaveValue('06:30');
});

test('Meine Arbeiter: mit Suche auswählen oder nur mit Namen neu anlegen, „Tag erfassen“ zeigt nur diese; gemerkt; Monat ohne die ganze Personalliste', async ({ page }) => {
  await setup(page);
  await page.goto('./baupad/zeitaufzeichnung');
  await page.getByTestId('worktimes-dialog').getByTestId('worktimes-later').click();
  await page.getByTestId('times-date').fill('2026-10-28');
  await expect(page.getByTestId('times-day-row')).toHaveCount(2);
  await page.getByTestId('times-pick').click();
  const pd = page.getByTestId('times-pick-dialog');
  await pd.getByTestId('times-pick-search').fill('max');
  await expect(pd.getByTestId('times-pick-worker')).toHaveCount(1);
  await pd.locator('[data-testid="times-pick-worker"][data-worker="Max"] input').check();
  await pd.getByTestId('times-pick-search').fill('');
  await expect(pd.getByTestId('times-pick-worker')).toHaveCount(2);
  await pd.getByTestId('times-pick-save').click();
  await expect(page.getByTestId('times-mine-chip')).toHaveText(['Max']);
  await expect(page.getByTestId('times-day-row')).toHaveCount(1);
  await expect(row(page, 'Max')).toBeVisible();
  // Tag ohne Einteilung (Samstag): gewählter Arbeiter steht trotzdem da – nur ausfüllen, wenn er bei mir war
  await page.getByTestId('times-date').fill('2026-10-31');
  await expect(page.getByTestId('times-day-row')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('times-mine-chip')).toHaveText(['Max']);
  await page.getByTestId('worktimes-dialog').getByTestId('worktimes-later').click();
  // keine Auswahl → wieder alle des Tages
  await page.getByTestId('times-pick').click();
  await pd.getByTestId('times-pick-none').click();
  await pd.getByTestId('times-pick-save').click();
  await page.getByTestId('times-date').fill('2026-10-28');
  await expect(page.getByTestId('times-day-row')).toHaveCount(2);
  await expect(page.getByTestId('times-mine-chip')).toHaveCount(0);
  // Monat: noch keine Stunden → niemand, nicht die ganze Personalliste
  await expect(page.getByTestId('times-person')).toHaveCount(0);
  await expect(page.getByTestId('times-month-empty')).toBeVisible();

  // neuen Arbeiter nur mit Namen anlegen – sofort angehakt; gleicher Name nochmal wird übernommen, nicht doppelt angelegt
  await page.getByTestId('times-pick').click();
  await pd.getByTestId('times-new-first').fill('Anna');
  await pd.getByTestId('times-new-last').fill('Neu');
  await pd.getByTestId('times-new-add').click();
  await expect(pd.locator('[data-testid="times-pick-worker"][data-worker="Neu Anna"] input')).toBeChecked();
  await pd.getByTestId('times-new-first').fill('anna');
  await pd.getByTestId('times-new-last').fill('neu');
  await expect(pd.getByTestId('times-new')).toContainText('gibt es schon');
  await pd.getByTestId('times-new-add').click();
  await expect(pd.getByTestId('times-pick-worker')).toHaveCount(3);
  await pd.getByTestId('times-pick-save').click();
  // steht in der Leiste, in „Tag erfassen“ und im Monat
  await expect(page.getByTestId('times-mine-chip')).toHaveText(['Neu Anna']);
  await expect(page.getByTestId('times-day-row')).toHaveCount(1);
  await expect(row(page, 'Neu Anna')).toBeVisible();
  await expect(page.getByTestId('times-person')).toHaveCount(1);
  await expect(page.locator('[data-testid="times-person"][data-name="Neu Anna"]')).toBeVisible();
  // aus der Leiste nehmen → wieder die heute Eingeteilten; der neue Arbeiter bleibt in der Personalliste
  await page.getByTestId('times-mine-remove').click();
  await expect(page.getByTestId('times-mine-chip')).toHaveCount(0);
  await expect(page.getByTestId('times-day-row')).toHaveCount(2);
  await page.goto('./baupad/arbeitereinteilung/personal');
  await expect(page.getByTestId('worker-row').filter({ hasText: 'Anna' })).toHaveCount(1);
});

/** Kontext aus der Datenbank nachbauen (Rolle, Projekte je Werkzeug) */
const ctxOf = (role: string, toolSites: Record<string, string[]> = {}) => ({
  workspace_id: '11111111-1111-4111-8111-111111111111',
  workspace_name: 'Testfirma',
  role,
  pkg: 'team',
  tools: ['times', 'workers', 'photos'],
  sites: [],
  tool_sites: toolSites,
  operator: false,
  name: 'Test Nutzer',
  phone: '',
});
const idb = <T,>(page: Page, fn: string, arg?: unknown) =>
  page.evaluate(
    ([f, a]) =>
      new Promise<T>((resolve) => {
        const r = indexedDB.open('schadstellen-aufmass');
        r.onsuccess = () => {
          const db = r.result;
          // eslint-disable-next-line no-new-func
          void (new Function('db', 'a', `return (${f})(db, a)`) as (db: IDBDatabase, a: unknown) => Promise<T>)(db, a).then((v) => {
            db.close();
            resolve(v);
          });
        };
      }),
    [fn, arg] as const,
  );
const getAll = (store: string) => `(db) => new Promise((res) => { const q = db.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => res(q.result); })`;

test('Rechte: Polier nur Stunden seiner Projekte (andere bleiben erhalten), kein Monatszettel; Arbeiter nur eigene Stunden, nur lesen', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);
  const projects = await idb<{ id: string; name: string }[]>(page, getAll('projects'));
  const park = projects.find((p) => p.name === 'Parkring')!.id;
  const halle = projects.find((p) => p.name === 'Halle 3')!.id;
  const workers = await idb<{ id: string; firstName: string }[]>(page, getAll('workers'));
  const peter = workers.find((w) => w.firstName === 'Peter')!.id;
  // Büro hat Peter am Dienstag 4 h in Halle 3 erfasst (andere Baustelle)
  await idb(page, `(db, a) => new Promise((res) => { const t = db.transaction('timeDays', 'readwrite'); t.objectStore('timeDays').put(a); t.oncomplete = () => res(1); })`, {
    id: `${peter}|2026-10-27`, workerId: peter, date: '2026-10-27', month: '2026-10', lines: [{ projectId: halle, siteName: 'Halle 3', hours: 4, from: '07:00', to: '11:00', pause: 0 }], updatedAt: 1, updatedBy: 'Büro',
  });

  // Polier mit Freigabe nur für Parkring
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ctxOf('polier', { times: [`p:${park}`] })) }));
  await page.goto('./baupad/zeitaufzeichnung');
  await expect(page.getByTestId('times-scope-site')).toBeVisible();
  await expect(page.getByTestId('times-worktimes')).toHaveCount(0);
  await expect(page.getByTestId('times-month')).toHaveCount(0);
  await expect(page.getByTestId('times-month-office')).toBeVisible();
  await page.getByTestId('times-date').fill('2026-10-27');
  // Halle 3 ist für ihn unsichtbar: Peter erscheint nur mit dem Vorschlag für Parkring
  await expect(row(page, 'Peter')).toHaveAttribute('data-state', 'suggested');
  await expect(page.getByTestId('times-day')).not.toContainText('Halle 3');
  await row(page, 'Peter').getByTestId('times-take').click();
  await expect(row(page, 'Peter')).toHaveAttribute('data-state', 'done');
  // gespeichert: seine Parkring-Zeile dazu, die Zeile in Halle 3 bleibt erhalten
  const day = (await idb<{ id: string; lines: { siteName: string }[] }[]>(page, getAll('timeDays'))).find((d) => d.id === `${peter}|2026-10-27`)!;
  expect(day.lines.map((l) => l.siteName).sort()).toEqual(['Halle 3', 'Parkring']);
  // Monatszettel direkt aufgerufen: nur Hinweis
  await page.goto(`./baupad/zeitaufzeichnung/${peter}?m=2026-10`);
  await expect(page.getByTestId('timesheet-office-only')).toBeVisible();

  // Arbeiter: zuerst ohne Verknüpfung → Hinweis, dann Peter mit seiner Konto-E-Mail verknüpft → nur Peter, nur lesen
  await page.unroute('**/rest/v1/rpc/my_context');
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ctxOf('arbeiter')) }));
  await page.goto('./baupad/zeitaufzeichnung?d=2026-10-27');
  await expect(page.getByTestId('times-scope-own')).toContainText('noch keinem Arbeiter zugeordnet');
  await idb(page, `(db, a) => new Promise((res) => { const t = db.transaction('workers', 'readwrite'); const s = t.objectStore('workers'); const q = s.get(a); q.onsuccess = () => s.put({ ...q.result, userEmail: 'test@baupad.local' }); t.oncomplete = () => res(1); })`, peter);
  await page.reload();
  await expect(page.getByTestId('times-scope-own')).toContainText('Deine eigenen Stunden');
  await expect(page.getByTestId('times-day-row')).toHaveCount(1);
  await expect(row(page, 'Peter')).toBeVisible();
  await expect(row(page, 'Peter').locator('select, input').first()).toBeDisabled();
  await expect(page.getByTestId('times-add-worker')).toHaveCount(0);
  await expect(page.getByTestId('times-pick')).toHaveCount(0);
  await expect(page.getByTestId('times-person')).toHaveCount(1); // nur der eigene Monatszettel
  await expect(page.getByTestId('times-year-files')).toHaveCount(0);
});
