import { expect, test } from './fixtures';
import { join } from 'node:path';
import { FIXTURES, freshStart } from './helpers';

/**
 * Mängelplan: Baustelle und Plan anlegen (Bild, ohne Maßstab), Pin, Rechteck und Freihand markieren,
 * Angaben bearbeiten, Nummern, Liste, Löschen mit Nachrücken, PDF.
 */
test('Mängelplan: Plan hochladen, Markierungen setzen und bearbeiten, PDF', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/maengel');
  await expect(page.getByTestId('defects-title')).toHaveText('Mängelplan');
  await expect(page.getByTestId('defects-empty')).toBeVisible();

  // Plan hochladen mit neuer Baustelle
  await page.getByTestId('defect-upload').click();
  const dlg = page.getByTestId('defect-plan-dialog');
  await dlg.getByTestId('photo-site').selectOption('__new');
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('Tiefgarage Parkdeck Nord');
  await sd.getByTestId('photo-site-save').click();
  await dlg.getByTestId('defect-plan-file').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await expect(dlg.getByTestId('defect-plan-title')).toHaveValue('parkdeck'); // Dateiname als Vorschlag
  await dlg.getByTestId('defect-plan-title').fill('Plan EG');
  await dlg.getByTestId('defect-plan-save').click();
  await expect(page.getByTestId('dp-title')).toHaveText('Plan EG');
  await expect(page.locator('[data-testid="dp-canvas"] img')).toBeVisible();
  await expect(page.getByTestId('dp-pdf')).toBeDisabled(); // ohne Markierung kein PDF

  const stage = page.locator('.dp-stage');
  const box = (await stage.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // Pin: antippen → Dialog → Angaben
  await page.getByTestId('dp-tool-pin').click();
  await expect(page.getByTestId('dp-hint')).toContainText('antippen');
  const p1 = at(0.6, 0.5);
  await page.mouse.click(p1.x, p1.y);
  const md = page.getByTestId('dp-mark-dialog');
  await expect(md).toContainText('Nr. 1 · Pin');
  await md.getByTestId('dp-mark-title').fill('Abplatzung Decke');
  await md.getByTestId('dp-mark-desc').fill('ca. 2 m²');
  await md.getByTestId('dp-mark-save').click();
  await expect(page.getByTestId('dp-item')).toHaveCount(1);
  await expect(page.getByTestId('dp-item').first()).toContainText('Abplatzung Decke');
  await expect(page.getByTestId('dp-num')).toHaveCount(1);

  // Rechteck mit Art „Ausbesserung“ (Farbe folgt der Art)
  await page.getByTestId('dp-tool-rect').click();
  await page.getByTestId('dp-kind').selectOption('ausbesserung');
  const a = at(0.15, 0.2);
  const b = at(0.3, 0.4);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await expect(md).toContainText('Nr. 2 · Rechteck');
  await expect(md.getByTestId('dp-kind-ausbesserung')).toHaveAttribute('aria-checked', 'true');
  await md.getByTestId('dp-mark-title').fill('Riss sanieren');
  await md.getByTestId('dp-mark-save').click();
  await expect(page.getByTestId('dp-item')).toHaveCount(2);
  await expect(page.getByTestId('dp-item').nth(1)).toContainText('Ausbesserung');

  // Freihand
  await page.getByTestId('dp-tool-freehand').click();
  const f0 = at(0.5, 0.7);
  await page.mouse.move(f0.x, f0.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    const q = at(0.5 + i * 0.03, 0.7 + (i % 2 ? 0.03 : -0.03));
    await page.mouse.move(q.x, q.y);
  }
  await page.mouse.up();
  await expect(md).toContainText('Nr. 3 · Freihand');
  await md.getByTestId('dp-mark-save').click();
  await expect(page.getByTestId('dp-num')).toHaveCount(3);

  // Auswählen: Nummer antippen → markiert; nochmal → Dialog; Filter
  await page.getByTestId('dp-tool-select').click();
  await page.locator('[data-testid="dp-num"][data-no="1"]').click();
  await expect(page.locator('[data-testid="dp-item"][data-no="1"]')).toHaveClass(/selected/);
  await page.locator('[data-testid="dp-num"][data-no="1"]').click();
  await expect(md).toContainText('Nr. 1 · Pin');
  await expect(md.getByTestId('dp-mark-title')).toHaveValue('Abplatzung Decke');
  await page.keyboard.press('Escape');
  await page.getByTestId('dp-filter').selectOption('mangel'); // nur der Pin; Rechteck und Freihand sind „Ausbesserung“
  await expect(page.getByTestId('dp-item')).toHaveCount(1);
  await page.getByTestId('dp-filter').selectOption('all');

  // Löschen → Nummern rücken nach
  await page.locator('[data-testid="dp-item"][data-no="2"] [data-testid="dp-item-edit"]').click();
  await md.getByTestId('dp-mark-delete').click();
  await page.getByRole('button', { name: 'Löschen' }).last().click();
  await expect(page.getByTestId('dp-item')).toHaveCount(2);
  await expect(page.locator('[data-testid="dp-num"][data-no="2"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="dp-num"][data-no="3"]')).toHaveCount(0);

  // Zoom und Verschieben wie in der Planansicht: Knöpfe, Mausrad, Ziehen auf leerer Fläche
  await expect(page.getByTestId('dp-canvas')).toHaveAttribute('data-zoom', '1.00');
  await expect(page.getByTestId('dp-zoom-out')).toBeDisabled();
  await page.getByTestId('dp-zoom-in').click();
  await expect(page.getByTestId('dp-canvas')).toHaveAttribute('data-zoom', '1.40');
  await expect(page.getByTestId('dp-zoom-value')).toHaveText('140 %');
  const canvas = (await page.getByTestId('dp-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => parseFloat((await page.getByTestId('dp-canvas').getAttribute('data-zoom')) ?? '0')).toBeGreaterThan(1.4);
  const before = (await stage.boundingBox())!;
  await page.getByTestId('dp-tool-select').click();
  await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.3); // leere Fläche im Plan
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.2, canvas.y + canvas.height * 0.3, { steps: 5 });
  await page.mouse.up();
  const after = (await stage.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 20); // Plan wurde nach links verschoben
  await expect(page.getByTestId('dp-item')).toHaveCount(2); // Ziehen auf leerer Fläche legt nichts an
  await page.getByTestId('dp-zoom-fit').click();
  await expect(page.getByTestId('dp-canvas')).toHaveAttribute('data-zoom', '1.00');

  // bleibt nach dem Neuladen
  await page.reload();
  await expect(page.getByTestId('dp-item')).toHaveCount(2);

  // PDF
  await page.getByTestId('dp-pdf').click();
  await expect(page.getByText('PDF-Vorschau')).toBeVisible();
  await page.keyboard.press('Escape');

  // Übersicht und Baustellenseite
  await page.goto('./#/maengel');
  await expect(page.getByTestId('defect-site')).toHaveCount(1);
  await expect(page.getByTestId('defect-site')).toContainText('1 Plan · 2 Markierungen');
  await page.getByTestId('defect-site').click();
  await expect(page.getByTestId('defect-site-title')).toHaveText('Tiefgarage Parkdeck Nord');
  await expect(page.getByTestId('defect-plan')).toHaveCount(1);
  await expect(page.getByTestId('defect-plan')).toContainText('2 Markierungen');

  // Baustelle hier bearbeiten → gilt in allen Werkzeugen (Fotos, Berichte, Mängelplan)
  await page.getByTestId('defect-site-edit').click();
  const sd2 = page.getByTestId('photo-site-dialog');
  await sd2.getByTestId('photo-site-name').fill('Tiefgarage Nord');
  await sd2.getByTestId('photo-site-number').fill('91574');
  await sd2.getByTestId('photo-site-save').click();
  await expect(page.getByTestId('defect-site-title')).toHaveText('Tiefgarage Nord');
  await expect(page.locator('.page-sub')).toContainText('91574');
  await page.goto('./#/maengel');
  await expect(page.getByTestId('defect-site')).toContainText('Tiefgarage Nord');
  // in der Fotodokumentation steht das Projekt (umbenannt) zum Übernehmen in der Auswahl, nicht in der Übersicht
  await page.goto('./#/fotos');
  await page.getByTestId('photo-file-input').setInputFiles([{ name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }]);
  await expect(page.getByTestId('photo-save-dialog').getByTestId('photo-site').locator('option')).toContainText([/Tiefgarage Nord/]);
});

test('Plan aus PDF: beim starken Hineinzoomen wird der Ausschnitt scharf aus dem PDF nachgerendert', async ({ page }) => {
  await freshStart(page);
  await page.goto('./maengel');
  await page.getByTestId('defect-upload').click();
  const dlg = page.getByTestId('defect-plan-dialog');
  await dlg.getByTestId('photo-site').selectOption('__new');
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('PDF-Baustelle');
  await sd.getByTestId('photo-site-save').click();
  await dlg.getByTestId('defect-plan-file').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  await dlg.getByTestId('defect-plan-save').click();
  await expect(page.locator('[data-testid="dp-canvas"] img')).toBeVisible();
  const detail = page.getByTestId('dp-detail');
  await expect(detail).toBeHidden(); // Übersicht: Grundbild reicht
  for (let i = 0; i < 6; i++) await page.getByTestId('dp-zoom-in').click();
  await expect(page.getByTestId('dp-canvas')).toHaveAttribute('data-zoom', '7.53');
  await expect(detail).toBeVisible({ timeout: 15_000 });
  const w = await detail.evaluate((c: HTMLCanvasElement) => c.width);
  expect(w).toBeGreaterThan(400);
});

test('Foto am Mangel: Farbkästen groß, Foto antippen öffnet die Großansicht mit Zoom', async ({ page }) => {
  await freshStart(page);
  await page.goto('./maengel');
  await page.getByTestId('defect-upload').click();
  const dlg = page.getByTestId('defect-plan-dialog');
  await dlg.getByTestId('photo-site').selectOption('__new');
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('Foto-Baustelle');
  await sd.getByTestId('photo-site-save').click();
  await dlg.getByTestId('defect-plan-file').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await dlg.getByTestId('defect-plan-save').click();
  await expect(page.locator('[data-testid="dp-canvas"] img')).toBeVisible();
  // Pin setzen → Dialog
  await page.getByTestId('dp-tool-pin').click();
  const stage = (await page.locator('.dp-stage').boundingBox())!;
  await page.mouse.click(stage.x + stage.width * 0.4, stage.y + stage.height * 0.4);
  const md = page.getByTestId('dp-mark-dialog');
  await expect(md).toContainText('Nr. 1 · Pin');
  const color = md.getByTestId('dp-mark-color').first();
  const box = (await color.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // Foto aus der Galerie anhängen
  await md.getByTestId('photo-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const ps = page.getByTestId('photo-save-dialog');
  await ps.getByTestId('photo-save').click();
  await expect(ps).toHaveCount(0);
  await expect(md.getByTestId('dp-mark-photo')).toHaveCount(1, { timeout: 15_000 });
  await md.getByTestId('dp-mark-photo').click();
  const viewer = page.getByTestId('photo-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId('viewer-image')).toBeVisible();
  await viewer.getByTestId('viewer-zoom-in').click();
  await expect(viewer.getByTestId('viewer-zoom')).toHaveText('150 %');
  await page.keyboard.press('Escape'); // schließt nur die Großansicht
  await expect(viewer).toHaveCount(0);
  await expect(md).toBeVisible();
});

test('Auswahlwerkzeug wie im Aufmaß: Griffe am Rechteck, Größe ziehen, Auswahlleiste mit Bearbeiten und Löschen', async ({ page }) => {
  await freshStart(page);
  await page.goto('./maengel');
  await page.getByTestId('defect-upload').click();
  const dlg = page.getByTestId('defect-plan-dialog');
  await dlg.getByTestId('photo-site').selectOption('__new');
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('Griff-Baustelle');
  await sd.getByTestId('photo-site-save').click();
  await dlg.getByTestId('defect-plan-file').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await dlg.getByTestId('defect-plan-save').click();
  await expect(page.locator('[data-testid="dp-canvas"] img')).toBeVisible();
  await expect(page.getByTestId('dp-tool-select')).toContainText('Auswahl');
  const stage = page.locator('.dp-stage');
  const box = (await stage.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  // Rechteck aufziehen → Dialog speichern
  await page.getByTestId('dp-tool-rect').click();
  const a = at(0.3, 0.3);
  const b = at(0.5, 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  const md = page.getByTestId('dp-mark-dialog');
  await md.getByTestId('dp-mark-title').fill('Riss Wand');
  await md.getByTestId('dp-mark-save').click();
  // nach dem Speichern bleibt die Markierung ausgewählt; Esc hebt die Auswahl auf, antippen wählt wieder → Griffe und Auswahlleiste
  await page.getByTestId('dp-tool-select').click();
  await expect(page.getByTestId('dp-selection-bar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dp-selection-bar')).toHaveCount(0);
  await page.locator('[data-testid="dp-num"][data-no="1"]').click();
  await expect(page.getByTestId('dp-handles')).toBeVisible();
  await expect(page.locator('[data-testid^="dp-handle-"]')).toHaveCount(8);
  const bar = page.getByTestId('dp-selection-bar');
  await expect(bar).toContainText('Nr. 1 · Rechteck');
  await expect(bar).toContainText('Riss Wand');
  await expect(bar).toContainText('Eckpunkte (○) und Seitengriffe (□)');
  // Ecke unten rechts ziehen → Rechteck wird größer (Nummer wandert mit der oberen Mitte)
  const se = (await page.getByTestId('dp-handle-se').boundingBox())!;
  const target = at(0.7, 0.7);
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  const se2 = (await page.getByTestId('dp-handle-se').boundingBox())!;
  expect(se2.x).toBeGreaterThan(se.x + 50);
  expect(se2.y).toBeGreaterThan(se.y + 50);
  // Bearbeiten aus der Leiste, Löschen mit Entf
  await bar.getByTestId('dp-edit-selected').click();
  await expect(md).toContainText('Nr. 1 · Rechteck');
  await md.getByRole('button', { name: 'Abbrechen' }).click();
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Löschen' }).last().click();
  await expect(page.getByTestId('dp-item')).toHaveCount(0);
  await expect(bar).toHaveCount(0);
});

test('Esc im Mängelplan wie im Aufmaß: angefangene Zeichnung verwerfen, Auswahl aufheben, zurück auf „Auswahl“', async ({ page }) => {
  await freshStart(page);
  await page.goto('./maengel');
  await page.getByTestId('defect-upload').click();
  const dlg = page.getByTestId('defect-plan-dialog');
  await dlg.getByTestId('photo-site').selectOption('__new');
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('Esc-Baustelle');
  await sd.getByTestId('photo-site-save').click();
  await dlg.getByTestId('defect-plan-file').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await dlg.getByTestId('defect-plan-save').click();
  await expect(page.locator('[data-testid="dp-canvas"] img')).toBeVisible();
  const box = (await page.locator('.dp-stage').boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  await page.getByTestId('dp-tool-rect').click();
  await expect(page.getByTestId('dp-tool-rect')).toHaveClass(/active/);
  // Rechteck aufziehen, mitten im Ziehen Esc → nichts angelegt, Werkzeug wieder „Auswahl“
  const a = at(0.3, 0.3);
  const b = at(0.5, 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('dp-mark-dialog')).toHaveCount(0);
  await expect(page.getByTestId('dp-item')).toHaveCount(0);
  await expect(page.getByTestId('dp-tool-select')).toHaveClass(/active/);
  await expect(page.getByTestId('dp-tool-rect')).not.toHaveClass(/active/);
  await expect(page.getByTestId('dp-hint')).toHaveCount(0);
});

test('Mängelliste am PC nach rechts einklappen und wieder ausklappen; bleibt gemerkt', async ({ page }) => {
  await freshStart(page);
  await page.goto('./maengel');
  await page.getByTestId('defect-upload').click();
  const dlg = page.getByTestId('defect-plan-dialog');
  await dlg.getByTestId('photo-site').selectOption('__new');
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('Klapp-Baustelle');
  await sd.getByTestId('photo-site-save').click();
  await dlg.getByTestId('defect-plan-file').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  await dlg.getByTestId('defect-plan-save').click();
  const list = page.getByTestId('dp-list');
  await expect(list).toBeVisible();
  const before = (await page.locator('.dp-stage').boundingBox())!;
  await page.getByTestId('dp-side-toggle').click();
  await expect(list).toBeHidden();
  await expect.poll(async () => (await page.locator('.dp-stage').boundingBox())!.width).toBeGreaterThan(before.width);
  await page.reload();
  await expect(page.getByTestId('dp-list')).toBeHidden(); // gemerkt
  await page.getByTestId('dp-side-toggle').click();
  await expect(page.getByTestId('dp-list')).toBeVisible();
});
