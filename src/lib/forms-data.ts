import type { ExportFile } from './aufmass';
import { DEFAULT_WORK_TIMES, nameWithGrade, weekOf } from './crew';
import { getFormFile, getMeta, getWeek, listWorkers, loadProjectData, previousWeek, saveFormEntry } from './db';
import { templateFileId, type FormTemplate } from './form-template';
import { mainDate, nextFormNo, prefill, type FormEntry, type PrefillContext } from './forms';
import { filledEntryFile } from './forms-pdf';
import { uuid } from './ids';
import { crewForDay, effectiveWeek } from './reports';
import { today } from './reports';
import type { Absence, WorkTimes } from './types';

/**
 * Ausgefüllte Firmenformulare: Anlegen mit Datenübernahme (Projekt, Datum/KW, Mitarbeiter aus der Einteilung,
 * Firma, laufende Nummer), Kopieren, PDF. Nichts wird erfunden: fehlt eine Angabe, bleibt das Feld leer.
 */

/** Angaben des Projekts aus dem Register (für Projektfelder) */
export async function projectInfoFor(projectId: string | null, siteName: string): Promise<NonNullable<PrefillContext['project']>> {
  if (!projectId) return { name: siteName };
  const d = await loadProjectData(projectId);
  if (!d) return { name: siteName };
  const cc = d.costCenters.filter((c) => !c.deletedAt).sort((a, b) => a.sortIndex - b.sortIndex)[0];
  return {
    name: d.project.site || d.project.name,
    number: d.project.number ?? '',
    address: d.project.address,
    client: d.project.client,
    costCenter: cc ? [cc.number, cc.name].filter(Boolean).join(' – ') : '',
  };
}

/** Eingeteilte Mitarbeiter der Baustelle an diesem Tag (ohne Urlaub) – nur, wenn die Zuordnung eindeutig ist */
export async function suggestedPeople(projectId: string | null, siteName: string, date: string): Promise<string[]> {
  if (!date) return [];
  const wid = weekOf(date);
  const [saved, prev, workers, abs] = await Promise.all([getWeek(wid), previousWeek(wid), listWorkers(), getMeta<Absence[]>('absences')]);
  return crewForDay(effectiveWeek(wid, saved, prev), date, { projectId, name: siteName }, workers, abs ?? [])
    .filter((s) => s.absence !== 'urlaub')
    .map((s) => nameWithGrade(s.worker));
}

/** Übernahme-Angaben zu Projekt, Datum und Firma */
export async function prefillContext(projectId: string | null, siteName: string, date: string, no: string): Promise<PrefillContext> {
  const [project, people, company, workTimes] = await Promise.all([projectInfoFor(projectId, siteName), suggestedPeople(projectId, siteName, date), getMeta<string>('companyName'), getMeta<WorkTimes>('workTimes')]);
  return { project, people, company: company ?? '', date, no, workTimes: workTimes ?? DEFAULT_WORK_TIMES };
}

/** Neues Formular aus einer Vorlage – Schnappschuss der Felder, Nummer je Projekt, Werte übernommen */
export async function createFormEntry(t: FormTemplate, site: { projectId: string | null; name: string }, date: string, all: FormEntry[], createdBy: string): Promise<FormEntry> {
  const fields = t.fields ?? [];
  const now = Date.now();
  const base = { projectId: site.projectId, siteName: site.name };
  const no = nextFormNo(all, t.id);
  const values = prefill(fields, await prefillContext(site.projectId, site.name, date, no));
  const e: FormEntry = {
    id: uuid(),
    templateId: t.id,
    templateName: t.name,
    templateVersion: t.version ?? 1,
    fileId: templateFileId(t),
    layout: { width: t.layout.width, height: t.layout.height, fields: fields.map((f) => ({ ...f })) },
    ...base,
    no,
    date: mainDate(fields, values) ?? date,
    values,
    status: 'draft',
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await saveFormEntry(e);
  return e;
}

/** Kopie als neues Formular (heute, nächste Nummer, Entwurf) – Datum/KW/Nummer neu, der Rest bleibt */
export async function copyFormEntry(src: FormEntry, all: FormEntry[], createdBy: string): Promise<FormEntry> {
  const now = Date.now();
  const date = today();
  const no = nextFormNo(all, src.templateId);
  const values = prefill(src.layout.fields, { date, no, workTimes: (await getMeta<WorkTimes>('workTimes')) ?? DEFAULT_WORK_TIMES }, src.values);
  const e: FormEntry = { ...src, id: uuid(), no, date: mainDate(src.layout.fields, values) ?? date, values, status: 'draft', createdBy, createdAt: now, updatedAt: now };
  await saveFormEntry(e);
  return e;
}

/** ausgefülltes PDF (Original-PDF der gespeicherten Vorlagenversion) */
export async function formEntryPdf(e: FormEntry): Promise<ExportFile> {
  const pdf = await getFormFile(e.fileId);
  if (!pdf) throw new Error('Die PDF-Datei der Vorlage fehlt auf diesem Gerät. Bitte den Abgleich mit der Ablage abwarten oder die Vorlage neu hochladen.');
  return filledEntryFile(e, pdf);
}
