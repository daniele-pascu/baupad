/**
 * Datenmodell.
 *
 * Alle Datensätze tragen Synchronisations-Metadaten (SyncMeta). Damit kann später ein
 * Server-Abgleich ergänzt werden: `rev` wird bei jeder lokalen Änderung erhöht,
 * `deviceId` nennt das Gerät der letzten Änderung, gelöschte Datensätze bleiben als
 * Grabstein (`deletedAt`) erhalten, damit Löschungen ebenfalls übertragen werden können.
 */

export interface SyncMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Fortlaufende Revision, wird bei jeder Änderung um 1 erhöht. */
  rev: number;
  /** Gerät, auf dem die letzte Änderung erfolgte. */
  deviceId: string;
  /** Zeitpunkt der Löschung (Grabstein) oder null. */
  deletedAt: number | null;
}

export interface Project extends SyncMeta {
  name: string;
  site: string;
  address: string;
  client: string;
  editor: string;
  /** Projektdatum im Format JJJJ-MM-TT */
  date: string;
  notes: string;
}

export interface CostCenter extends SyncMeta {
  projectId: string;
  name: string;
  sortIndex: number;
}

/** Original-Datei (PDF oder Bild). Der Inhalt liegt separat im Store `blobs`. */
export interface SourceFile extends SyncMeta {
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'pdf' | 'image';
  pageCount: number;
}

/** Rechteck in Seitenkoordinaten. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Ein Plan ist eine Seite einer Original-Datei, optional beschränkt auf einen Ausschnitt
 * (Layoutbereich).
 *
 * Seitenkoordinaten: Bei PDFs entspricht eine Einheit einem PDF-Punkt (1/72 Zoll) in der
 * Anzeigeausrichtung der Seite (Seitendrehung bereits berücksichtigt), Ursprung oben links.
 * Bei Bildern entspricht eine Einheit einem Bildpixel (EXIF-Ausrichtung berücksichtigt).
 * Markierungen werden immer in diesen Koordinaten gespeichert – nie in Bildschirmpixeln.
 */
export interface Plan extends SyncMeta {
  projectId: string;
  costCenterId: string;
  fileId: string;
  /** 0-basierter Seitenindex in der Originaldatei */
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  /** Ausschnitt der Seite, der als Plan dient; null = ganze Seite */
  crop: Rect | null;
  planNumber: string;
  planName: string;
  floor: string;
  area: string;
  description: string;
  /** Startnummer der Schadstellennummerierung dieses Plans */
  numberStart: number;
  sortIndex: number;
}

export type ShapeType = 'ellipse' | 'rect' | 'freehand';

export interface Shape {
  type: ShapeType;
  /** Begrenzungsrechteck in Seitenkoordinaten */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Nur Freihand: Punkte relativ zum Begrenzungsrechteck (0..1) */
  points?: [number, number][];
}

export interface Damage extends SyncMeta {
  projectId: string;
  planId: string;
  number: number;
  shape: Shape;
  color: string;
  /** Manuelle Verschiebung der Beschriftung in Seitenkoordinaten; null = automatisch */
  labelOffset: { dx: number; dy: number } | null;
  /** Länge in m */
  length: number;
  /** Breite in m */
  width: number;
  /** Tiefe in m */
  depth: number;
  /** Fläche in m² = Länge × Breite (ungerundet gespeichert) */
  area: number;
}

export type EntityStore = 'projects' | 'costCenters' | 'files' | 'plans' | 'damages';

export interface EntityMap {
  projects: Project;
  costCenters: CostCenter;
  files: SourceFile;
  plans: Plan;
  damages: Damage;
}

export const COLORS: { value: string; name: string }[] = [
  { value: '#e03131', name: 'Rot' },
  { value: '#1c7ed6', name: 'Blau' },
  { value: '#2f9e44', name: 'Grün' },
  { value: '#f5b800', name: 'Gelb' },
  { value: '#f76707', name: 'Orange' },
  { value: '#9c36b5', name: 'Violett' },
];

export const SHAPE_LABELS: Record<ShapeType, string> = {
  ellipse: 'Kreis',
  rect: 'Rechteck',
  freehand: 'Freihand',
};
