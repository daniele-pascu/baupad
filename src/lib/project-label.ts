import type { Project } from './types';

/** Angaben eines Projekts für Überschrift und Zeile darunter – in allen Werkzeugen gleich */
export interface ProjectLabelInfo {
  name: string;
  number?: string | null;
  /** Kostenstelle (Nummer oder Bezeichnung) – steht vor dem Namen, sonst die Projektnummer */
  costCenter?: string | null;
  /** Bauvorhaben / Adresse */
  address?: string | null;
  client?: string | null;
  /** Baubeginn JJJJ-MM-TT */
  date?: string | null;
  notes?: string | null;
}

const fmtDay = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
};

/** Kostenstelle oder Projektnummer – steht fett vor dem Projektnamen */
export const projectPrefix = (p: ProjectLabelInfo) => (p.costCenter || p.number || '').trim();

/** dünne Zeile darunter: Bauvorhaben/Adresse · Auftraggeber · Baubeginn · Bemerkung */
export const projectSubline = (p: ProjectLabelInfo) =>
  [p.address?.trim(), p.client?.trim(), p.date ? `Baubeginn ${fmtDay(p.date)}` : '', p.notes?.trim()].filter(Boolean).join(' · ');

/** Angaben aus einem Projekt des Registers (Kostenstelle separat, da eigene Tabelle) */
export const labelFromProject = (p: Pick<Project, 'name' | 'number' | 'site' | 'address' | 'client' | 'date' | 'notes'>, costCenter = ''): ProjectLabelInfo => ({
  name: p.name,
  number: p.number ?? '',
  costCenter,
  // Bauvorhaben (ältere Projekte haben ein eigenes Feld) und Adresse in der Zeile darunter
  address: [p.site && p.site.trim() !== p.name.trim() ? p.site : '', p.address].filter(Boolean).join(', '),
  client: p.client,
  date: p.date,
  notes: p.notes,
});
