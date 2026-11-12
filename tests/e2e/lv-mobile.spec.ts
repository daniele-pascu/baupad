import { expect, test } from './fixtures';
import { createProject, freshStart } from './helpers';
import { tastenBefunde } from './tasten-check';

/**
 * LV am Handy und Tablet: jede Position sauber ausgerichtet – lange Positionsnummern (z. B. „S1.12.25.24.03A.“)
 * ragen nicht in den Kurztext, Werte stehen in ihren Spalten und nichts läuft über den Rand.
 */
test('LV-Positionen: Nummer, Kurztext und Werte überlappen nicht und bleiben in der Karte', async ({ page }, info) => {
  await freshStart(page);
  await createProject(page, 'LV Handy', {}, ['UG']);
  await page.getByTestId('lv-new').click();
  const dlg = page.getByTestId('lv-doc-dialog');
  await dlg.getByTestId('lv-doc-name').fill('Betoninstandsetzung');
  const positions = [
    ['03.14.80.90A.', 'Sandstrahlen', 'm²', '37,75'],
    ['03.14.80.90D.', 'Schutz der Betonstützen nach der Sanierung', 'm²', '10,84'],
    ['S1.12.25.24.03A.', 'Vorbereiten der Betonunterlage für 2K-Fl.Kunstst.-Abdichtung', 'm²', '7,85'],
    ['S1.12.25.24.03B.', 'Kernbohrung', 'Stk', '1.234,50'],
  ];
  await dlg.getByTestId('lv-doc-name').press('Enter');
  const rows = dlg.getByTestId('lv-grid-row');
  for (const [i, [no, text, unit, price]] of positions.entries()) {
    await expect(rows).toHaveCount(i + 1);
    await rows.nth(i).getByTestId('grid-number').fill(no);
    await rows.nth(i).getByTestId('grid-shortText').fill(text);
    await rows.nth(i).getByTestId('grid-unit').fill(unit);
    await rows.nth(i).getByTestId('grid-unitPrice').fill(price);
    await rows.nth(i).getByTestId('grid-unitPrice').press('Enter');
  }
  await dlg.getByTestId('lv-doc-save').click();
  await expect(dlg).toBeHidden();
  if (!(await page.getByTestId('lv-table').isVisible())) await page.getByTestId('lv-doc-tab').first().click();
  await expect(page.getByTestId('lv-row')).toHaveCount(4);
  await page.getByTestId('lv-row').first().scrollIntoViewIfNeeded();

  // je Position: keine zwei Zellen überlappen, alle liegen innerhalb der Zeile
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    for (const row of document.querySelectorAll<HTMLElement>('[data-testid="lv-row"]')) {
      const rr = row.getBoundingClientRect();
      const cells = [...row.querySelectorAll<HTMLElement>('td')].filter((c) => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0);
      // tatsächliche Ausdehnung des Inhalts (Text kann über die Zelle hinausragen)
      const boxes = cells.map((c) => {
        const range = document.createRange();
        range.selectNodeContents(c);
        const r = range.getBoundingClientRect();
        return { name: c.className, l: r.left, r: r.right, t: r.top, b: r.bottom, empty: r.width === 0 };
      });
      for (const [i, a] of boxes.entries()) {
        if (a.empty) continue;
        if (a.l < rr.left - 1 || a.r > rr.right + 1) out.push(`${row.dataset.number}: „${a.name}“ ragt aus der Zeile`);
        for (const b of boxes.slice(i + 1)) {
          if (b.empty) continue;
          if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.push(`${row.dataset.number}: „${a.name}“ überlappt „${b.name}“`);
        }
      }
    }
    // nichts läuft waagrecht über die Seite
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`Seite ist breiter als der Bildschirm (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    return out;
  });
  expect(problems, problems.join('\n')).toEqual([]);
  expect(await tastenBefunde(page)).toEqual([]);
  await page.screenshot({ path: `tests/output/lv-${info.project.name}.png` });
  // aufgeklappte Position (Langtext, Bearbeiten)
  await page.getByTestId('lv-row').nth(2).click();
  await expect(page.getByTestId('lv-longtext')).toBeVisible();
  expect(await tastenBefunde(page)).toEqual([]);
  await page.screenshot({ path: `tests/output/lv-${info.project.name}-offen.png` });
});
