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
  /** Projektnummer (optional; ältere Projekte haben keine) */
  number?: string;
  site: string;
  address: string;
  client: string;
  editor: string;
  /** Projektdatum im Format JJJJ-MM-TT */
  date: string;
  notes: string;
  /** zuletzt vergebene Aufmaßblatt-Nummer (Excel); fehlt = noch keine */
  sheetNo?: number;
  /** Pläne und Aufmaß nach Rechnungen aufgeteilt (jede Rechnung hat eigene Pläne) */
  splitByInvoice?: boolean;
  /** Rechnungen des Projekts (nur mit splitByInvoice) */
  invoices?: Invoice[];
  /**
   * Werkzeuge, in denen das Projekt angelegt bzw. übernommen wurde (projects, workers, reports, photos, defects).
   * Fehlt = älteres Projekt aus Aufmaß & Abrechnung. Ein Projekt erscheint nur in den Übersichten dieser Werkzeuge;
   * in allen anderen steht es zum Übernehmen in der Projektauswahl.
   */
  tools?: string[];
}

/**
 * Rechnung: Teilrechnung, Schlussteilrechnung bzw. Schlussrechnung. Die Schlussrechnung ist
 * eine Teilrechnung, nur als letzte gekennzeichnet.
 */
export type InvoiceKind = 'r' | 'tr' | 'str' | 'sr';

export interface Invoice {
  id: string;
  kind: InvoiceKind;
  /** laufende Nummer (1, 2, 3 …) über alle Rechnungen des Projekts */
  no: number;
  /** Leistungszeitraum (frei, z. B. „01.10.–31.10.2026“) */
  period: string;
  /** als abgerechnet markiert: Änderungen bleiben möglich, aber mit Warnung */
  settled?: boolean;
  createdAt: number;
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
  /** Rechnung, zu der der Plan gehört (nur bei „Nach Rechnungen aufteilen“) */
  invoiceId?: string | null;
  /** eigener Name des Aufmaßes dieses Plans (sonst „Aufmaß 1“, „Aufmaß 2“ … durchnummeriert) */
  aufmassName?: string;
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
  /**
   * Importierte Pläne: Papierformat für den PDF-Export (fehlt bei älteren Plänen → A4 passend
   * zur Ausrichtung). Gezeichnete Pläne verwenden das Format des Zeichenblatts (drawing.paper).
   */
  paper?: PaperFormat;
  /** Titel im PDF-Kopf neben der Plannummer (leer bzw. fehlend = „Aufmaßplan“) */
  title?: string;
  /**
   * Importierte Pläne: Kalibrierung über eine bekannte Strecke (Seitenkoordinaten a–b ist
   * `meters` lang). Daraus folgt der Maßstab für Maßvorschläge; gespeicherte Messwerte
   * werden dadurch nie verändert.
   */
  calibration?: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    meters: number;
    /** automatisch erkannt (bis zur eigenen Kalibrierung); `confirmed` = vom Benutzer geprüft */
    auto?: { source: 'scale' | 'dims' | 'scale+dims' | 'lines'; label: string; warning?: string; confirmed?: boolean; unit?: 'm' | 'cm' | 'mm'; count?: number };
    /** Prüfstrecke: bekannte Länge `expected` (m), im Plan gemessen `measured` (m) */
    check?: { a: { x: number; y: number }; b: { x: number; y: number }; expected: number; measured: number; at: number };
  };
  /** Im PDF anzeigen: Bemerkung (description), Papierformat, Maßstab – Standard: nein */
  showNote?: boolean;
  showPaper?: boolean;
  showScale?: boolean;
  /**
   * Importierte Pläne: Planunterlage farbig anzeigen. Standard (fehlt) = Schwarz-Weiß, damit die
   * farbigen Aufmaß-Markierungen besser zu sehen sind (Ansicht und PDF; die Originaldatei bleibt).
   */
  planColor?: boolean;
  /** Ausgeblendete Ebenen (Ansicht und PDF); fehlt = alle sichtbar */
  hiddenLayers?: LayerId[];
  /**
   * Importierte Pläne: Drehung der Planunterlage im Uhrzeigersinn (fehlt = 0). pageWidth/
   * pageHeight, Ausschnitt, Kalibrierung und Messungen beziehen sich auf die gedrehte Seite;
   * die Originaldatei bleibt unverändert.
   */
  rotation?: PlanRotation;
}

export type PlanRotation = 0 | 90 | 180 | 270;

/** Ebenen eines Plans (siehe layers.ts) */
export type LayerId = 'drawing' | 'dims' | 'text' | 'measures';

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
  /** Papierformat des Zeichenblatts (fehlt bei älteren Plänen: Zeichenfläche wächst mit) */
  paper?: PaperFormat;
  /** Maßstab 1:n des Zeichenblatts, z. B. 100 */
  scale?: number;
}

export type PaperFormat = 'A4-hoch' | 'A4-quer' | 'A3-hoch' | 'A3-quer';

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
  /**
   * Kennzeichnung aus Buchstaben bzw. Zahl und Buchstaben, z. B. „A“, „Wand B“, „1A“ (optional).
   * Fehlt sie, wird die Nummer angezeigt. `number` bleibt für die Reihenfolge erhalten.
   */
  label?: string | null;
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
  /** Darstellung (Linientyp, -stärke, Füllung); fehlt = Standarddarstellung. Farbe = `color` */
  style?: ShapeStyle;
  /**
   * Fläche und Umfang aus der Plangeometrie (kalibrierter bzw. gezeichneter Plan): `area` ist
   * die Fläche der Form, `length` ihr Umfang, `width` leer. Wird bei Formänderung nachgeführt.
   */
  areaFromShape?: boolean;
  /**
   * Abzüge bzw. Zuschläge (z. B. Tür, Fenster, Öffnung). Flächen: `area` ist bereits die Nettofläche
   * (Länge × Breite bzw. Fläche aus dem Plan, abzüglich bzw. zuzüglich dieser Teilflächen).
   * Linien: `length` bleibt die gemessene Länge, netto siehe `netLength`.
   */
  deductions?: Deduction[];
}

/** Teilfläche bzw. Teillänge, die von einer Messung abgezogen (bzw. hinzugerechnet) wird */
export interface Deduction {
  id: string;
  /** Bezeichnung, z. B. „Tür“, „Fenster“ */
  label: string;
  /** Anzahl gleicher Teilflächen */
  count: number;
  /** Breite in m (bei Linien: die Länge) */
  length: number;
  /** Höhe in m; fehlt bei Linien (dort zählt nur die Länge) */
  width?: number;
  /** true = hinzurechnen statt abziehen */
  add?: boolean;
}

/** Linientypen (wie in CAD-Programmen); Wellen- und Zickzacklinie sind reine Darstellung */
export type LineType = 'solid' | 'dashed' | 'dotted' | 'dashdot' | 'dashdotdot' | 'wave' | 'zigzag';

/**
 * Darstellung einer Linie bzw. Form – ändert weder Geometrie noch Messwerte.
 * Die Linienfarbe ist `color` des Objekts; Füllung nur bei geschlossenen Formen.
 */
export interface ShapeStyle {
  lineType?: LineType;
  /** Linienstärke in Punkt (im PDF); fehlt = Standard */
  lineWidth?: number;
  /** Füllfarbe; fehlt = Linienfarbe */
  fillColor?: string;
  /** Transparenz der Füllung in % (0 = deckend, 100 = durchsichtig); fehlt = Standard */
  fillTransparency?: number;
  /** Keine Füllung (nur Umrandung) */
  noFill?: boolean;
  /** Art der Füllung: Vollton (Standard) oder Schraffur */
  fillType?: 'solid' | 'hatch';
  /** Schraffur: Muster, Winkel in Grad, Linienabstand in Punkt */
  hatch?: { pattern: HatchPattern; angle: number; spacing: number };
}

export type HatchPattern = 'lines' | 'cross' | 'dots';

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
/** 'arc': Bogen aus drei Punkten, gespeichert als fein unterteilte offene Polylinie */
export type DrawElementType = ShapeType | 'dimension' | 'text' | 'arc';

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
  /** Darstellung (Linientyp, -stärke, Füllung); fehlt = Standarddarstellung */
  style?: ShapeStyle;
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

// ---------------------------------------------------------------------------
// Arbeitereinteilung (eigenständig, nur auf dem Gerät; ab Datenbank-Version 5)

/** Funktion eines Arbeiters (Auswahl in der Arbeitereinteilung; Personalstand in Berichten und Firmenformulare) */
export type WorkerGrade = 'projektleiter' | 'techniker' | 'bautechniker' | 'polier' | 'vorarbeiter' | 'facharbeiter' | 'hilfsarbeiter';

/** Arbeiter der Firma – einmal angelegt, jede Woche wiederverwendet */
export interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  staffNo?: string;
  phone?: string;
  /** Qualifikation bzw. Tätigkeit (frei, z. B. Maurer) */
  role?: string;
  /** Funktion: Projektleiter, Techniker, Bautechniker, Polier, Vorarbeiter, Facharbeiter, Hilfsarbeiter */
  grade?: WorkerGrade;
  /** inaktiv: wird nicht mehr zum Einteilen angeboten, bleibt in alten Wochen sichtbar */
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Baustelle einer Woche – aus einem Projekt (Bezeichnung zum Zeitpunkt der Einteilung) oder manuell */
export interface WeekSite {
  id: string;
  projectId: string | null;
  name: string;
  number?: string;
  address?: string;
  /** fertiggestellt: wird ab der Folgewoche nicht mehr weitergeführt */
  finished?: boolean;
  /** pausiert (Standby): ruht ohne Arbeiter, wird weitergeführt, bis sie fortgesetzt wird */
  paused?: boolean;
  /** Bemerkung für diese Woche (erscheint im PDF) */
  note?: string;
  /** eingeteilte Arbeiter je Tag (0 = Montag … 6 = Sonntag) */
  days: string[][];
}

/** Wochenplanung – je Woche ein eigener Datensatz (id = Montag, JJJJ-MM-TT) */
export interface WeekPlan {
  id: string;
  sites: WeekSite[];
  /** Urlaub je Tag (0 = Montag … 6 = Sonntag) */
  vacation: string[][];
  showWeekend?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Abwesenheit eines Arbeiters von–bis (JJJJ-MM-TT, einschließlich), auch über mehrere Wochen */
export interface Absence {
  id: string;
  workerId: string;
  /** Urlaub: nicht eingeteilt. Krank: bleibt auf der Baustelle eingeteilt, wird nur markiert */
  kind: 'urlaub' | 'krank';
  from: string;
  to: string;
  createdAt: number;
}

/** Arbeitszeit der Firma je Wochentag (0 = Montag); null = kein Arbeitstag */
export type WorkTimes = ({ from: string; to: string } | null)[];

/* ───────────── Berichte & Formulare ───────────── */

/** Berichtstypen; weitere Formulare kommen als neuer Typ hinzu */
export type ReportType = 'regie' | 'tag' | 'woche';

/**
 * Kopfdaten eines Berichts – beim Anlegen aus dem Projekt kopiert und danach frei änderbar.
 * Spätere Änderungen am Projekt verändern einen gespeicherten Bericht nicht.
 */
export interface ReportHead {
  /** Bauvorhaben bzw. Projektname */
  project: string;
  /** Projektnummer */
  number: string;
  /** Baustellenbezeichnung */
  site: string;
  address: string;
  client: string;
  costCenter: string;
  /** verantwortliche Person (optional) */
  responsible: string;
}

/** Arbeiter in einem Bericht (Name als Kopie, damit alte Berichte unverändert bleiben) */
export interface ReportWorker {
  id: string;
  /** Arbeiter aus der Arbeiterliste (fehlt bei frei eingegebenen) */
  workerId?: string;
  name: string;
  role: string;
  /** Funktion (aus der Arbeiterliste, Kopie) */
  grade?: WorkerGrade;
  /** Beginn/Ende „HH:MM“, Pause in Minuten – optional */
  from: string;
  to: string;
  pause: string;
  /** Stunden: von Hand bzw. aus Beginn, Ende und Pause; null = nicht angegeben */
  hours: number | null;
  /** davon Überstunden 50 % / 100 % (nur Regieliste, optional) */
  ot50?: number | null;
  ot100?: number | null;
  /** Wegzeit in Stunden (nur Regieliste, optional – für Firmenformulare mit Wegzeit-Spalte) */
  travel?: number | null;
  /** Bautagesbericht: tatsächlich anwesend */
  present?: boolean;
  /** laut Arbeitereinteilung eingeteilt */
  planned?: boolean;
  /** Hinweis aus der Einteilung, z. B. „krank“ */
  note?: string;
}

/** Material- bzw. Gerätezeile */
export interface ReportItem {
  id: string;
  text: string;
  qty: number | null;
  unit: string;
}

export interface RegieData {
  workers: ReportWorker[];
  /** Tätigkeiten bzw. ausgeführte Arbeiten */
  work: string;
  materials: ReportItem[];
  equipment: ReportItem[];
  notes: string;
  /** Spalten für 50 %/100 % Überstunden und Wegzeit anzeigen */
  overtime: boolean;
  /** Zusatzangaben für Firmenformulare (optional, frei) */
  travelCosts?: string;
  lodgingCosts?: string;
  miscCosts?: string;
}

/** Personalstand je Funktion (null = keine Angabe) */
export type StaffCount = Partial<Record<WorkerGrade, number | null>>;

export interface DailyData {
  /** Arbeitszeit „HH:MM“ (optional) */
  from: string;
  to: string;
  weather: string;
  tempMin: string;
  tempMax: string;
  /** Mannschaft: Einteilung (planned) und tatsächliche Anwesenheit (present) getrennt */
  crew: ReportWorker[];
  /** Anzahl von Hand (ohne Namen bzw. abweichend); null = aus der Liste der Anwesenden */
  crewCount: number | null;
  work: string;
  materials: ReportItem[];
  equipment: ReportItem[];
  incidents: string;
  notes: string;
  /** Personalstand je Funktion – aus der Einteilung vorbelegt, von Hand änderbar */
  staff?: StaffCount;
  /** Schlussabnahme (optional, für Firmenformulare): Uhrzeit und durch wen */
  acceptanceTime?: string;
  acceptanceBy?: string;
}

export interface WeeklyDay {
  date: string;
  /** Mannschaftsstärke; null = keine Angabe */
  count: number | null;
  names: string;
  work: string;
}

export interface WeeklyData {
  days: WeeklyDay[];
  events: string;
  notes: string;
  open: string;
}

interface ReportBase {
  id: string;
  /** Projekt (Aufmaß & Abrechnung) oder null bei frei eingegebener Baustelle */
  projectId: string | null;
  /** fortlaufende Nummer je Baustelle und Typ (änderbar) */
  no: string;
  /** Datum JJJJ-MM-TT; Wochenbericht: Beginn */
  date: string;
  /** Wochenbericht: Ende */
  dateTo?: string;
  status: 'draft' | 'done';
  head: ReportHead;
  createdAt: number;
  updatedAt: number;
}

export type Report =
  | (ReportBase & { type: 'regie'; data: RegieData })
  | (ReportBase & { type: 'tag'; data: DailyData })
  | (ReportBase & { type: 'woche'; data: WeeklyData });

/* ───────────── Fotodokumentation ───────────── */

/**
 * Speicherstatus eines Fotos: `local` = nur auf diesem Gerät (noch keine zentrale Ablage angebunden),
 * `queued`/`uploading`/`failed` = Upload in die zentrale Ablage, `synced` = zentral gespeichert.
 */
export type PhotoSync = 'local' | 'queued' | 'uploading' | 'synced' | 'failed';

/** Baustelle für Fotos: aus einem Projekt (projectId) oder frei angelegt */
export interface PhotoSite {
  projectId: string | null;
  name: string;
  number: string;
  address: string;
  /** weitere Angaben aus dem Projektregister (für die Anzeige in Listen) */
  costCenter?: string;
  client?: string;
  date?: string;
  notes?: string;
  /** Werkzeuge, in denen das Projekt benutzt wird (siehe Project.tools) */
  tools?: string[];
}

export interface Photo {
  id: string;
  /** Unternehmen – bis zur Anmeldung leer (wird mit der Cloud-Anbindung gesetzt) */
  companyId: string | null;
  /** Projekt (Aufmaß & Abrechnung) oder null bei frei eingegebener Baustelle */
  projectId: string | null;
  /** Baustellenbezeichnung als Kopie (bleibt auch bei späterer Umbenennung) */
  siteName: string;
  siteNumber: string;
  siteAddress: string;
  /** Aufnahmezeitpunkt (Ortszeit) – aus den Bilddaten (EXIF) oder dem Zeitpunkt der Aufnahme in der App */
  takenAt: number;
  /** Aufnahmetag JJJJ-MM-TT (Ortszeit) und ISO-Kalenderwoche (Montag JJJJ-MM-TT) */
  day: string;
  week: string;
  /** Quelle des Aufnahmezeitpunkts */
  takenFrom: 'exif' | 'file' | 'now';
  /** Zeitpunkt des Hochladens bzw. Speicherns in der App */
  uploadedAt: number;
  /** Name des Benutzers (aus der Anmeldung; bis dahin der auf dem Gerät hinterlegte Name) */
  userName: string;
  description: string;
  /** ursprünglicher Dateiname */
  fileName: string;
  width: number;
  height: number;
  /** Größe der gespeicherten (verkleinerten) Datei in Bytes */
  size: number;
  /** SHA-256 der Originaldatei – verhindert doppelte Uploads */
  hash: string;
  /** Original in voller Größe zusätzlich gespeichert */
  original: boolean;
  sync: PhotoSync;
  /** Kennung in der zentralen Ablage (nach dem Upload) */
  remoteId?: string;
  syncError?: string;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Mängelplan (ab Datenbank-Version 8)

export type DefectKind = 'mangel' | 'ausbesserung' | 'hinweis' | 'erledigt';
export type MarkShape = 'pin' | 'rect' | 'ellipse' | 'line' | 'freehand' | 'text';

/** Plan einer Baustelle im Mängelplan: Bild (aus PDF-Seite oder Foto), ohne Maßstab */
export interface DefectPlan {
  id: string;
  companyId: string | null;
  projectId: string | null;
  siteName: string;
  siteNumber: string;
  siteAddress: string;
  title: string;
  /** Bildgröße in Pixeln (Markierungen sind relativ 0..1 dazu gespeichert) */
  width: number;
  height: number;
  /** Plan schwarz-weiß anzeigen und exportieren (Standard: farbig, wie hochgeladen) */
  gray?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Markierung im Plan: Pin, Form oder Text, mit Nummer, Art, Beschreibung und Fotos */
export interface DefectMark {
  id: string;
  planId: string;
  /** laufende Nummer je Plan */
  no: number;
  shape: MarkShape;
  color: string;
  /** Punkte relativ zur Bildgröße (0..1); Pin/Text: ein Punkt, Rechteck/Ellipse/Linie: zwei, Freihand: viele */
  points: { x: number; y: number }[];
  /** Beschriftung bei Textmarkierung */
  text: string;
  kind: DefectKind;
  title: string;
  description: string;
  photoIds: string[];
  createdAt: number;
  updatedAt: number;
}
