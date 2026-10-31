import type { ExportFile } from './aufmass';
import { weekOf } from './crew';
import { getFormTemplateFile, getMeta, listFormTemplates, listReports } from './db';
import { dailyValues, filledFormFile, regieValues, regieWeekValues } from './form-fill';
import type { FormTemplate } from './form-template';
import { fmtDate, siteKey, siteLabel, typeInfo } from './reports';
import type { Report, ReportType } from './types';

/** Firmenformulare für einen Berichtstyp (Konto → Firmeninformationen → Eigene Formulare) */
export async function templatesFor(type: ReportType): Promise<FormTemplate[]> {
  return (await listFormTemplates()).filter((t) => t.type === type);
}

/**
 * Bericht in das Firmenformular schreiben. Regieliste mit Wochenblatt: alle Regielisten des Projekts aus der
 * Kalenderwoche des Berichts kommen zusammen auf das Blatt (Spalte je Wochentag).
 */
export async function companyFormFile(r: Report, template: FormTemplate): Promise<ExportFile & { note?: string }> {
  const pdf = await getFormTemplateFile(template.id);
  if (!pdf) throw new Error('Die PDF-Datei des Firmenformulars fehlt auf diesem Gerät. Bitte das Formular unter Konto → Firmeninformationen neu hochladen.');
  const company = (await getMeta<string>('companyName')) ?? '';
  const layout = template.layout;
  const base = `${typeInfo(r.type).label}_${siteLabel(r)}`;
  if (r.type === 'tag') return filledFormFile(template, pdf, dailyValues(r, layout, company), `${base}_Nr${r.no}_${r.date}`);
  if (r.type === 'regie') {
    if (layout.table?.weekly) {
      const weekStart = weekOf(r.date);
      const key = siteKey(r);
      const all = (await listReports()).filter((x): x is Report & { type: 'regie' } => x.type === 'regie' && siteKey(x) === key && weekOf(x.date) === weekStart);
      const list = all.length ? all : [r];
      const file = await filledFormFile(template, pdf, regieWeekValues(list, weekStart, layout, company), `${base}_KW${weekStart}`);
      return { ...file, note: `Wochenblatt ab ${fmtDate(weekStart, false)}: ${list.length} ${list.length === 1 ? 'Regieliste' : 'Regielisten'} zusammengefasst.` };
    }
    return filledFormFile(template, pdf, regieValues(r, layout, company), `${base}_Nr${r.no}_${r.date}`);
  }
  throw new Error('Für Bauwochenberichte gibt es noch kein Firmenformular.');
}
