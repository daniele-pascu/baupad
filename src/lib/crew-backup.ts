import { safeFileName, type ExportFile } from './aufmass';
import { getMeta, listWeeks, listWorkers, saveWeek, saveWorker, setMeta } from './db';
import type { WeekPlan, Worker, WorkTimes } from './types';

/**
 * Eigene Sicherungsdatei der Arbeitereinteilung (Arbeiter, alle Wochen, Arbeitszeit, Firmenname) –
 * unabhängig von den Projektsicherungen. Wiederherstellen ergänzt bzw. aktualisiert nur
 * (neuerer Stand gewinnt), es wird nichts gelöscht.
 */
const FORMAT = 'baupad-arbeitereinteilung';

interface CrewBackup {
  format: typeof FORMAT;
  version: 1;
  exportedAt: string;
  workers: Worker[];
  weeks: WeekPlan[];
  workTimes: WorkTimes | null;
  company: string;
}

export async function exportCrewBackup(): Promise<ExportFile> {
  const data: CrewBackup = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    workers: await listWorkers(),
    weeks: await listWeeks(),
    workTimes: (await getMeta<WorkTimes>('workTimes')) ?? null,
    company: (await getMeta<string>('companyName')) ?? '',
  };
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    name: `${safeFileName('BauPad', 'Arbeitereinteilung', stamp)}.json`,
    data: new TextEncoder().encode(JSON.stringify(data)),
    mimeType: 'application/json',
  };
}

/** Sicherung einlesen: neue bzw. neuere Arbeiter und Wochen übernehmen; liefert die Anzahl */
export async function importCrewBackup(file: File): Promise<{ workers: number; weeks: number }> {
  let data: CrewBackup;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist keine Sicherung der Arbeitereinteilung.');
  }
  if (data?.format !== FORMAT || !Array.isArray(data.workers) || !Array.isArray(data.weeks)) throw new Error('Die Datei ist keine Sicherung der Arbeitereinteilung.');
  const haveW = new Map((await listWorkers()).map((w) => [w.id, w]));
  const haveK = new Map((await listWeeks()).map((w) => [w.id, w]));
  let workers = 0;
  let weeks = 0;
  for (const w of data.workers) {
    if (!w?.id || typeof w.firstName !== 'string') continue;
    const cur = haveW.get(w.id);
    if (cur && cur.updatedAt >= w.updatedAt) continue;
    await saveWorker(w);
    workers++;
  }
  for (const k of data.weeks) {
    if (!k?.id || !Array.isArray(k.sites)) continue;
    const cur = haveK.get(k.id);
    if (cur && cur.updatedAt >= k.updatedAt) continue;
    await saveWeek(k);
    weeks++;
  }
  if (data.workTimes && !(await getMeta('workTimes'))) await setMeta('workTimes', data.workTimes);
  if (data.company && !(await getMeta('companyName'))) await setMeta('companyName', data.company);
  return { workers, weeks };
}
