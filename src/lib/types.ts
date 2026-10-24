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
  /** Kostenstellennummer (optional; ältere Datensätze haben keine) */
  number?: string;
  /** Bezeichnung, z. B. „Tiefgarage“ */
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
  /**
   * Herkunft: importierte Datei (Standard, fehlt bei älteren Plänen) oder selbst gezeichnet.
   * Gezeichnete Pläne haben keine Datei (fileId = '').
   */
  source?: 'file' | 'drawing';
  /** Nur gezeichnete Pläne: Maßsystem (siehe DrawElement) */
  drawing?: DrawingInfo;
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
  /** Startnummer der Schadstellennummerierung dieses Plans (mindestens 1) */
  numberStart: number;
  sortIndex: number;
}

/**
 * Maßsystem gezeichneter Pläne.
 *
 * Reale Maße der Zeichnungsobjekte werden in Metern gespeichert (unit = 'm'). Für die
 * Planansicht und die Markierungen gelten wie bei importierten Plänen Seitenkoordinaten;
 * eine Seiteneinheit entspricht dort 1/unitsPerMeter m (1 cm). Zoom, Verschieben und
 * Bildschirmgröße ändern weder Seitenkoordinaten noch reale Maße.
 */
export interface DrawingInfo {
  unit: 'm';
  unitsPerMeter: number;
}

export type ShapeType = 'ellipse' | 'rect' | 'freehand' | 'line' | 'triangle';

export interface Shape {
  type: ShapeType;
  /** Begrenzungsrechteck in Seitenkoordinaten */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Freihand, Linie, Dreieck: Punkte relativ zum Begrenzungsrechteck (0..1) */
  points?: [number, number][];
  /** Nur Freihand: geschlossene Fläche (Standard) oder offene Linie, z. B. ein Riss */
  closed?: boolean;
  /** Drehung in Grad im Uhrzeigersinn um die Mitte des Begrenzungsrechtecks (Standard 0) */
  rotation?: number;
}

/**
 * Messart:
 * - 'damage' Schadstelle (Länge × Breite, Tiefe optional) – Standard für ältere Einträge
 * - 'area'   Flächenmessung (Länge × Breite, Tiefe optional), z. B. Malerarbeiten
 * - 'line'   Linienmessung (nur Länge, keine Fläche)
 */
export type MeasureKind = 'damage' | 'area' | 'line';

/** Messung bzw. Schadstelle (Name „Damage“ aus Version 1 beibehalten). */
export interface Damage extends SyncMeta {
  projectId: string;
  planId: string;
  number: number;
  /** Messart; fehlt bei älteren Einträgen und gilt dann als Schadstelle */
  kind?: MeasureKind;
  shape: Shape;
  color: string;
  labelOffset: { dx: number; dy: number } | null;
  /** Länge in m */
  length: number;
  /** Breite in m (bei Linienmessungen null) */
  width: number | null;
  /** Tiefe in m – optional; null = nicht gemessen (nicht 0!) */
  depth: number | null;
  /** Fläche in m² = Länge × Breite; null, wenn keine Fläche (Linie) */
  area: number | null;
  /** Zugeordnetes Bauteil (Buchstabe), optional */
  componentId?: string | null;
  /** Zugeordnete Leistungsposition „<LV-Dokument-ID>:<Positions-ID>“, optional */
  positionRef?: string | null;
}

/** Bauteilkennzeichnung im Plan, z. B. „A – Wand“. */
export interface Component extends SyncMeta {
  projectId: string;
  planId: string;
  /** Buchstabe, z. B. „A“ (max. 3 Zeichen) */
  letter: string;
  /** Bezeichnung, z. B. „Wand“, „Decke“ (optional) */
  name: string;
  color: string;
  /** Position der Kennzeichnung in Seitenkoordinaten */
  x: number;
  y: number;
}

/** Objektart eines gezeichneten Plans */
export type DrawElementType = ShapeType | 'dimension' | 'text';

/**
 * Zeichnungsobjekt eines selbst gezeichneten Plans (eigener Datensatz je Objekt).
 *
 * Alle Koordinaten und Maße in Metern (Einheit m), Ursprung oben links, y nach unten.
 * - Rechteck: shape.w = Länge, shape.h = Breite
 * - Linie und Maßlinie: Endpunkte über shape.points (relativ zum Begrenzungsrechteck)
 * - Kreis: shape.w = shape.h = Durchmesser (Ellipse bei w ≠ h)
 * - Dreieck: shape.w = Grundseite, shape.h = Höhe, Spitze über points
 * - Text: Begrenzungsrechteck; shape.h = Schrifthöhe
 */
export interface DrawElement extends SyncMeta {
  projectId: string;
  planId: string;
  type: DrawElementType;
  /** Geometrie in Metern */
  shape: Shape;
  color: string;
  /** Text (nur Textobjekte) */
  text?: string;
  /** Maße am Objekt anzeigen (Standard: ja) */
  showDims?: boolean;
  /** Maßlinie: Abstand der Maßlinie von der gemessenen Strecke in m (Vorzeichen = Seite) */
  offset?: number;
}

/** Leistungsposition eines LV bzw. einer MFK */
export interface LvPosition {
  id: string;
  /** Positionsnummer, z. B. „92 01 01 B1“ */
  number: string;
  shortText: string;
  longText: string;
  /** Einheit, z. B. „m“, „m²“, „Stk“ */
  unit: string;
  /** Menge laut LV (null = nicht angegeben) */
  quantity: number | null;
  /** Einheitspreis in EUR (null = nicht angegeben) */
  unitPrice: number | null;
  /** Positionspreis in EUR laut Dokument */
  totalPrice: number | null;
  /** Untergruppe, z. B. „92 01“ */
  group: string;
  /** Beim Import nicht sicher erkannte Angaben; leer = geprüft */
  issues: string[];
}

/** Leistungsverzeichnis (LV) oder Mehrkostenforderung (MFK) eines Projekts. */
export interface LvDocument extends SyncMeta {
  projectId: string;
  kind: 'lv' | 'mfk';
  /** Bezeichnung, z. B. „Markierungsarbeiten“ */
  name: string;
  /** Nummer, z. B. MFK-Nummer (optional) */
  number: string;
  /** Name der importierten Datei ('' = manuell angelegt) */
  fileName: string;
  groups: { number: string; title: string }[];
  positions: LvPosition[];
}

export type EntityStore = 'projects' | 'costCenters' | 'files' | 'plans' | 'damages' | 'components' | 'elements' | 'lvDocs';

export interface EntityMap {
  projects: Project;
  costCenters: CostCenter;
  files: SourceFile;
  plans: Plan;
  damages: Damage;
  components: Component;
  elements: DrawElement;
  lvDocs: LvDocument;
}

export const COLORS: { value: string; name: string }[] = [
  { value: '#1c1c1e', name: 'Schwarz' },
  { value: '#ffffff', name: 'Weiß' },
  { value: '#e03131', name: 'Rot' },
  { value: '#1c7ed6', name: 'Blau' },
  { value: '#2f9e44', name: 'Grün' },
  { value: '#f5b800', name: 'Gelb' },
  { value: '#f76707', name: 'Orange' },
  { value: '#9c36b5', name: 'Violett' },
];

export const SHAPE_LABELS: Record<ShapeType, string> = {
  line: 'Linie',
  rect: 'Rechteck',
  ellipse: 'Kreis',
  triangle: 'Dreieck',
  freehand: 'Freihand',
};
