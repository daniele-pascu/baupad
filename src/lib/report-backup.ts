import { safeFileName, type ExportFile } from './aufmass';
import { listReports, saveReport } from './db';
import type { Report } from './types';

/**
 * Eigene Sicherungsdatei aller Berichte (auch zu Baustellen ohne Projekt). Wiederherstellen ergänzt bzw.
 * aktualisiert nur (neuerer Stand gewinnt), es wird nichts gelöscht. Berichte zu einem Projekt sind zusätzlich
 * in dessen Projektsicherung enthalten.
 */
const FORMAT = 'baupad-berichte';

export async function exportReportsBackup(): Promise<ExportFile> {
  const data = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), reports: await listReports() };
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { name: `${safeFileName('BauPad', 'Berichte', stamp)}.json`, data: new TextEncoder().encode(JSON.stringify(data)), mimeType: 'application/json' };
}

export async function importReportsBackup(file: File): Promise<number> {
  let data: { format?: string; reports?: Report[] };
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist keine Sicherung der Berichte.');
  }
  if (data?.format !== FORMAT || !Array.isArray(data.reports)) throw new Error('Die Datei ist keine Sicherung der Berichte.');
  const have = new Map((await listReports()).map((r) => [r.id, r]));
  let n = 0;
  for (const r of data.reports) {
    if (!r?.id || !r.type || !r.head || !r.data) continue;
    const cur = have.get(r.id);
    if (cur && cur.updatedAt >= r.updatedAt) continue;
    await saveReport(r);
    n++;
  }
  return n;
}
