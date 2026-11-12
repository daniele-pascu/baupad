import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { elementLabel } from '../components/DrawPanel';
import { renderDims, renderElement, renderPreviewDims, renderSheet } from '../components/DrawingLayer';
import type { PlanViewerHandle, SnapFn, Tool, ViewerItem } from '../components/PlanViewer';
import { confirmDialog, toast } from '../components/ui';
import { textDialog } from '../components/TextDialog';
import { cleanFont } from '../lib/text-font';
import { elementsOf } from '../lib/aufmass';
import { damageNo } from '../lib/numbering';
import { formatMeasure } from '../lib/numbers';
import { hatchAnchor } from '../lib/style';
import {
  applyMeasures,
  circleFromMeasures,
  formatM,
  gridStep,
  lineEnds,
  lineFromMeasures,
  rectFromMeasures,
  roundM,
  shapeToMeters,
  shapeToPage,
  snapAngle,
  snapToGrid,
  textBoxHeight,
  textBoxWidth,
  textFontSize,
  textShape,
  triangleFromMeasures,
  unitsPerMeter,
  type Apex,
  type Measures,
} from '../lib/drawing';
import { type OrthoDir, arcShape, circleThrough, extendLine, ORTHO_DIRS, orthoPoint, rotateShapeBy, scaleShape, stretchShape, translateShape, trimByFence, trimShape } from '../lib/cad';
import { edgesOf, findSnap, normalizeSnapKinds, segmentIntersection, type SnapKind, type SnapSeg } from '../lib/snap';
import { inputVector, parseCadInput, vectorInfo } from '../lib/cad-input';
import { angleBetween, angleCcw, arrayOffsets, canOffset, distanceToShape, filletCorner, filletLines, joinShapes, offsetPath, mirrorShape, offsetShape, pointLineDistance, polarAngles, rotateAround, scaleAbout, segSegDistance, setSegmentLength, type ArrayParams } from '../lib/cad-ops';
import { DEFAULT_HATCH_SETTING, hatchLabel, hatchPicker, hatchStyle, type HatchSetting } from '../components/HatchPicker';
import { arrayDialog } from '../components/ArrayDialog';
import { roomDialog } from '../components/RoomDialog';
import { boundarySegments, regionAt, withRoomAreas } from '../lib/regions';
import { symbolPicker } from '../components/SymbolPicker';
import { symbolAnchor, symbolDef, symbolGeometry, symbolWall, type SymbolGroup } from '../lib/symbols';
import { wallOpenings, wallGeometry } from '../lib/walls';
import { dimsVisible, visibleElements } from '../lib/layers';
import { distToSegment, isOpenShape, lineShape, pathToSvg, rectsOverlap, removeVertex, setPolylineClosed, shapeAABB, pointInPolygon, polygonArea, shapeFromVertices, shapePath, shapeVertices, toScreen, type Point, type View } from '../lib/geometry';
import { newMeta, putRecord, putRecords, softDelete, type ProjectState } from '../lib/store';
import type { Damage, DrawElement, DrawElementType, GuideLine, Plan, Rect, Shape, ShapeStyle, TextFont } from '../lib/types';

/** Werkzeuge der Planbearbeitung (selbst gezeichnete Pläne) */
/** Gruppen der Werkzeugleiste (wie in CAD-Programmen) */
export type ToolGroup = 'select' | 'draw' | 'annotate' | 'modify';

/** Werkzeuge des Zeichenmodus: Zeichnen sowie Ändern (Kopieren, Verschieben, Strecken …) */
export type DrawTool = Tool | 'copy' | 'move' | 'stretch' | 'join' | 'offset' | 'mirror' | 'array' | 'symbol' | 'rotate' | 'scale' | 'align' | 'guide' | 'fillet' | 'distance' | 'hatch' | 'room';
/** Hilfslinie, Abrunden, Abstand: Punkte bzw. Objekte antippen */
/** Objektarten, die beim Ziehen von Ecken bzw. Anfassern nie zu einer freien Form werden */
const KEEP_TYPE = new Set<DrawElementType>(['wall', 'text', 'symbol', 'dimension', 'arc']);
/** Text/Raumstempel: nur gleichmäßig um die Mitte vergrößern */
const TEXT_ASPECT = { x: 0.5, y: 0.5 };
export const PICK_TOOLS = new Set<DrawTool>(['guide', 'fillet', 'distance', 'hatch', 'room']);
/** Abstand-Werkzeug: angetippter Punkt, ggf. mit Kante und Objekt */
export interface DistPick {
  point: Point;
  seg?: [Point, Point];
  id?: string;
}
export interface DistResult {
  p: Point;
  q: Point;
  d: number;
  /** parallel bzw. rechtwinklig (nur bei zwei angetippten geraden Kanten) */
  rel?: 'parallel' | 'perpendicular';
  /** Winkel zwischen zwei Kanten (0…90°) */
  angle?: number;
}
/** Drehen, Skalieren, Ausrichten: Punkte antippen (Basis, Bezug, Ziel) */
export const TRANSFORM_TOOLS = new Set<DrawTool>(['rotate', 'scale', 'align']);

/** Befehle, die ausgewählte Objekte brauchen (ohne Auswahl fragen sie zuerst danach) */
export const NEEDS_SELECTION = new Set<DrawTool>(['copy', 'move']);
/** Befehle mit Basispunkt → Zielpunkt bzw. Eingabe im Befehlsfeld */
export const VECTOR_COMMANDS = new Set<DrawTool>(['copy', 'move', 'mirror']);
/** Befehle, die zuerst Objekte brauchen (ohne Auswahl: wählen, dann „Weiter“) */
export const SELECT_FIRST = new Set<DrawTool>(['copy', 'move', 'mirror', 'join', 'array', 'rotate', 'scale', 'align']);

export const DRAW_TOOLS: { id: DrawTool; label: string; short?: string; icon: string; key: string; group: ToolGroup }[] = [
  { id: 'select', label: 'Auswahl: Objekte verschieben, Eckpunkte bearbeiten', short: 'Auswahl', icon: 'select', key: 'v', group: 'select' },
  { id: 'selwin', label: 'Fenster: mehrere Objekte auswählen – nach rechts aufziehen = nur ganz Enthaltenes, nach links = alles Berührte; antippen wählt einzeln', short: 'Fenster', icon: 'crop', key: 'w', group: 'select' },
  { id: 'line', label: 'Linie (z. B. Wand)', short: 'Linie', icon: 'line', key: 'l', group: 'draw' },
  { id: 'polyline', label: 'Freie Form: Punkte nacheinander setzen – offen (Länge) oder geschlossen (Fläche), z. B. ein Dreieck', short: 'Freie Form', icon: 'polyline', key: 'f', group: 'draw' },
  { id: 'rect', label: 'Rechteck (z. B. Raum)', short: 'Rechteck', icon: 'rect', key: 'r', group: 'draw' },
  { id: 'ellipse', label: 'Kreis', short: 'Kreis', icon: 'ellipse', key: 'k', group: 'draw' },
  { id: 'arc', label: 'Bogen: Anfangspunkt, Punkt auf dem Bogen, Endpunkt', short: 'Bogen', icon: 'arc', key: 'b', group: 'draw' },
  // Dreieck: über „Freie Form“ (drei Eckpunkte); bestehende Dreiecke bleiben bearbeitbar
  { id: 'polygon', label: 'Fläche: Eckpunkte nacheinander setzen, Startpunkt antippen schließt', short: 'Fläche', icon: 'polygon', key: 'p', group: 'draw' },
  { id: 'dimension', label: 'Maßlinie', short: 'Maß', icon: 'dimension', key: 'm', group: 'annotate' },
  { id: 'text', label: 'Text / Beschriftung', short: 'Text', icon: 'text', key: 't', group: 'annotate' },
  { id: 'move', label: 'Verschieben: Basispunkt zum Zielpunkt ziehen (mit Fang)', short: 'Verschieben', icon: 'move', key: 'g', group: 'modify' },
  { id: 'copy', label: 'Kopieren: Basispunkt zum Zielpunkt ziehen (mit Fang)', short: 'Kopieren', icon: 'copy', key: 'c', group: 'modify' },
  { id: 'stretch', label: 'Strecken: Fenster über Eckpunkte ziehen, dann Verschiebung ziehen', short: 'Strecken', icon: 'stretch', key: 's', group: 'modify' },
  { id: 'rotate', label: 'Drehen: Drehpunkt antippen, dann Winkel mit der Maus bzw. dem Finger oder eintippen (positiv = gegen den Uhrzeigersinn) – oder Bezug über zwei Punkte', short: 'Drehen', icon: 'rotate', key: 'd', group: 'modify' },
  { id: 'scale', label: 'Skalieren: Basispunkt antippen, Faktor eintippen (X;Y getrennt möglich) – oder Bezugsstrecke über zwei Punkte und neue Länge', short: 'Skalieren', icon: 'scale', key: 'q', group: 'modify' },
  { id: 'align', label: 'Ausrichten: zwei Punkte am Objekt, dann zwei Punkte auf der Ziellinie – nur drehen oder drehen und verschieben', short: 'Ausrichten', icon: 'align', key: 'h', group: 'modify' },
  { id: 'mirror', label: 'Spiegeln: Objekte an einer Achse aus zwei Punkten spiegeln – Original behalten oder löschen', short: 'Spiegeln', icon: 'mirror', key: 'i', group: 'modify' },
  { id: 'offset', label: 'Versetzen: parallele Kopie im Abstand – Objekt antippen, dann die Seite (Wandstärke, parallele Linien, Rechteck nach innen/außen)', short: 'Versetzen', icon: 'offset', key: 'o', group: 'modify' },
  { id: 'wall', label: 'Wand: Achse Punkt für Punkt setzen (Enter bzw. „Fertig“ beendet) – Wandstärke eingeben; Türen und Fenster schneiden die Öffnung aus', short: 'Wand', icon: 'wall', key: 'y', group: 'draw' },
  { id: 'symbol', label: 'Bauteil einsetzen: Tür, Fenster, Elektro – Stelle antippen', short: 'Bauteil', icon: 'door', key: 'u', group: 'draw' },
  { id: 'array', label: 'Reihe: ausgewählte Objekte rechteckig (Spalten × Zeilen), linear oder im Kreis mehrfach anordnen', short: 'Reihe', icon: 'array', key: 'a', group: 'modify' },
  { id: 'join', label: 'Verbinden: Linien, Polylinien und Bögen an gemeinsamen Endpunkten zu einer Linie bzw. geschlossenen Fläche verbinden – kleine Lücken werden geschlossen', short: 'Verbinden', icon: 'join', key: 'j', group: 'modify' },
  { id: 'trim', label: 'Stutzen: Abschnitt bis zu den nächsten Kanten bzw. Eckpunkten entfernen – anklicken oder frei über mehrere Linien ziehen (Zaun)', short: 'Stutzen', icon: 'trim', key: 'z', group: 'modify' },
  { id: 'extend', label: 'Verlängern: Linie bis zur nächsten Kante verlängern', short: 'Verlängern', icon: 'extend', key: 'e', group: 'modify' },
  { id: 'hatch', label: 'Schraffur: Muster bzw. Baustoff und Farbe wählen, dann in eine geschlossene Fläche tippen (Rechteck, Kreis, Fläche, Raum aus geschlossener Wand)', short: 'Schraffur', icon: 'hatch', key: '', group: 'draw' },
  { id: 'room', label: 'Raumstempel: in einen geschlossenen Raum tippen – Name eingeben, die Fläche (m²) wird automatisch aus Wänden, Linien bzw. der Form ermittelt und passt sich bei Änderungen an', short: 'Raum', icon: 'room', key: '', group: 'draw' },
  { id: 'fillet', label: 'Abrunden: zwei Linien antippen – mit Radius gerundet bzw. bei Radius 0 zur Ecke gekürzt/verlängert; oder die Ecke einer Fläche/Polylinie antippen', short: 'Abrunden', icon: 'fillet', key: '', group: 'modify' },
  { id: 'guide', label: 'Hilfslinie: unendliche Konstruktionslinie (0°, 45°, 90°, 135° oder frei) – nur beim Zeichnen sichtbar, nicht im PDF; Fang an Schnittpunkten', short: 'Hilfslinie', icon: 'guide', key: 'n', group: 'annotate' },
  { id: 'distance', label: 'Abstand: zwei Punkte, Linien oder Objekte antippen – kürzester Abstand, parallel bzw. rechtwinklig wird erkannt (ändert nichts)', short: 'Abstand', icon: 'distance', key: '', group: 'annotate' },
];

export const DRAW_DEFAULT_COLOR = '#1c1c1e';

const isCoarse = () => matchMedia('(pointer: coarse)').matches;

/** Werkzeuge, deren Vorschau Maße zeigt (Form wird gezogen) */
const DRAW_SHAPE_TOOLS = new Set<DrawTool>(['line', 'rect', 'ellipse', 'triangle', 'dimension']);

function pref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function storePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* optional */
  }
}

/** Gespeicherte Darstellung für neue Objekte lesen */
export function readStyle(key: string): ShapeStyle {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' ? (v as ShapeStyle) : {};
  } catch {
    return {};
  }
}

export const ORTHO_DIR_LABELS: Record<OrthoDir, string> = { auto: 'Richtung automatisch', h: 'Nur waagrecht', v: 'Nur senkrecht' };
/** Werkzeuge mit Ausgangspunkt, für die der 90°-Modus gilt (auch Endpunkte ziehen und Vektoren) */
const ORTHO_TOOLS = new Set<string>(['line', 'dimension', 'polyline', 'polygon', 'vector']);
/** Fangpunkte, die als Spurlinien-Bezug gemerkt werden */
const TRACK_KINDS = new Set<SnapKind>(['end', 'intersection', 'mid', 'center', 'quadrant']);
/** Parallel/rechtwinklig zu einer angefahrenen Kante: beim Zeichnen von Linien, Polylinien, Wänden, Vektoren */
const PARALLEL_TOOLS = new Set<string>(['line', 'dimension', 'polyline', 'polygon', 'vector', 'wall']);
/** Hilfslinie als sehr lange Strecke (m) – für Fang und Anzeige */
export function guideSeg(g: { x: number; y: number; angle: number }, half = 5000): [Point, Point] {
  const a = (g.angle * Math.PI) / 180;
  const dx = Math.cos(a) * half;
  const dy = -Math.sin(a) * half;
  return [
    { x: g.x - dx, y: g.y - dy },
    { x: g.x + dx, y: g.y + dy },
  ];
}

/**
 * Darstellung eines neu gezeichneten Objekts: nur Linientyp und -stärke aus der Voreinstellung,
 * immer „Keine Füllung“ (eigene Einstellung). Gefüllt wird nur nachträglich über „Darstellung“.
 */
export function newElementStyle(d: ShapeStyle): ShapeStyle {
  return { ...(d.lineType ? { lineType: d.lineType } : {}), ...(d.lineWidth ? { lineWidth: d.lineWidth } : {}), noFill: true };
}

/** Geometrie gerundet auf 0,1 mm speichern (keine Gleitkommareste aus der Bildschirmumrechnung) */
const roundShape = (s: Shape): Shape => ({ ...s, x: roundM(s.x), y: roundM(s.y), w: roundM(s.w), h: roundM(s.h) });

/**
 * Zustand und Bedienlogik der Planbearbeitung für selbst gezeichnete Pläne.
 * Die Zeichnungsobjekte sind eigene Datensätze in Metern; Messungen bleiben davon unberührt.
 */
export function useDrawing(opts: {
  plan: Plan | undefined;
  data: ProjectState;
  damages: Damage[];
  viewer: React.RefObject<PlanViewerHandle | null>;
  /** Objekt fertig gezeichnet bzw. eingefügt (z. B. Werkzeugleiste zuklappen) */
  onCreated?: () => void;
}) {
  const { plan, data, damages, viewer, onCreated } = opts;
  const k = plan ? unitsPerMeter(plan) : 100;
  const [tool, setToolState] = useState<DrawTool>(() => {
    const t = pref('drawTool', 'rect') as DrawTool;
    return DRAW_TOOLS.some((x) => x.id === t) && !NEEDS_SELECTION.has(t) && t !== 'stretch' ? t : 'rect';
  });
  /** Strecken: zuerst Fenster (Meter), dann Verschiebung */
  const [stretchWin, setStretchWin] = useState<Rect | null>(null);
  const [color, setColorState] = useState(() => pref('drawColor', DRAW_DEFAULT_COLOR));
  /**
   * Darstellung für neue Objekte (Linientyp, -stärke, Füllung) – vor dem Zeichnen einstellbar.
   * Neue Formen sind ohne Füllung, solange die Füllung hier nicht ausdrücklich gewählt wurde
   * (eigene Einstellung „Keine Füllung“; eine früher gewählte Füllfarbe füllt nicht ungefragt).
   */
  const [defaultStyle, setDefaultStyleState] = useState<ShapeStyle>(() => {
    // einmalige Übernahme der bisherigen Voreinstellung, dabei „Keine Füllung“ setzen
    return pref('drawStyle2', '') ? readStyle('drawStyle2') : { ...readStyle('drawStyle'), noFill: true };
  });
  /** Auswahl: ein oder mehrere Objekte (ein Objekt = bisherige Einzelauswahl mit Griffen und Leiste) */
  const [selIds, setSelIds] = useState<string[]>([]);
  const selectedId = selIds.length === 1 ? selIds[0] : null;
  const setSelectedIdState = (id: string | null) => setSelIds(id ? [id] : []);
  /** Mehrfachauswahl (Handy/Tablet): Antippen fügt hinzu bzw. nimmt heraus; am PC mit Umschalt- oder Strg-Taste */
  const [multi, setMulti] = useState(false);
  const addKey = useRef(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => (addKey.current = e.shiftKey || e.ctrlKey || e.metaKey);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
    };
  }, []);
  /** Verschieben/Kopieren ohne Auswahl: zuerst Objekte wählen, dann „Weiter“ */
  const [cmdSelecting, setCmdSelecting] = useState(false);
  /** Basispunkt des laufenden Befehls (Seitenkoordinaten) und Mausposition (für Abstand in Mausrichtung) */
  const [cmdBase, setCmdBase] = useState<Point | null>(null);
  const hoverRef = useRef<Point | null>(null);
  /** Kopieren: Anzahl der Kopien in diesem Befehl */
  const [copies, setCopies] = useState(0);
  /** Versetzen: gewähltes Objekt, Abstand (m), „durch Punkt“ */
  const [offsetSrc, setOffsetSrc] = useState<string | null>(null);
  /** Hilfslinien: Winkel ('free' = durch zwei Punkte), Löschen-Modus, Anzeige an/aus (je Gerät) */
  const [guideAngle, setGuideAngleState] = useState(() => pref('guideAngle', '0'));
  const setGuideAngle = (v: string) => {
    setGuideAngleState(v);
    storePref('guideAngle', v);
  };
  const [guideErase, setGuideErase] = useState(false);
  const [guidesOn, setGuidesOnState] = useState(() => pref('guides', '1') !== '0');
  const setGuidesOn = (on: boolean) => {
    setGuidesOnState(on);
    storePref('guides', on ? '1' : '0');
  };
  /** Schraffur-Werkzeug: gewähltes Muster und Farben (je Gerät gemerkt) */
  const [hatchSet, setHatchSetState] = useState<HatchSetting>(() => {
    try {
      const v = JSON.parse(pref('hatchSet', 'null')) as HatchSetting | null;
      return v?.hatch?.pattern ? v : DEFAULT_HATCH_SETTING;
    } catch {
      return DEFAULT_HATCH_SETTING;
    }
  });
  const setHatchSet = (h: HatchSetting) => {
    setHatchSetState(h);
    storePref('hatchSet', JSON.stringify(h));
  };
  /** Abrunden: Radius (m, je Gerät) und erste angetippte Linie */
  const [filletR, setFilletRState] = useState(() => Math.max(0, Number(pref('filletR', '0')) || 0));
  const setFilletR = (r: number) => {
    setFilletRState(r);
    storePref('filletR', String(r));
  };
  const [filletSrc, setFilletSrc] = useState<{ id: string; tap: Point } | null>(null);
  /** Abstand: angetippte Punkte/Objekte und Ergebnis */
  const [distPicks, setDistPicks] = useState<DistPick[]>([]);
  const [distRes, setDistRes] = useState<DistResult | null>(null);
  const [offsetDist, setOffsetDistState] = useState(() => Number(pref('offsetDist', '0.25')) || 0.25);
  const [offsetThrough, setOffsetThroughState] = useState(() => pref('offsetThrough', '0') === '1');
  const setOffsetDist = (d: number) => {
    setOffsetDistState(d);
    storePref('offsetDist', String(d));
  };
  const setOffsetThrough = (on: boolean) => {
    setOffsetThroughState(on);
    storePref('offsetThrough', on ? '1' : '0');
  };
  /** Spiegeln: Original behalten (Standard) */
  const [mirrorKeep, setMirrorKeepState] = useState(() => pref('mirrorKeep', '1') !== '0');
  const setMirrorKeep = (on: boolean) => {
    setMirrorKeepState(on);
    storePref('mirrorKeep', on ? '1' : '0');
  };
  /** Wand: Stärke und Höhe (m) für neue Wände – je Gerät gemerkt */
  const [wallThickness, setWallThicknessState] = useState(() => Number(pref('wallThickness', '0.25')) || 0.25);
  const [wallHeight, setWallHeightState] = useState(() => Number(pref('wallHeight', '0')) || 0);
  const setWallDefaults = (t: number, h?: number) => {
    setWallThicknessState(t);
    storePref('wallThickness', String(t));
    if (h !== undefined) {
      setWallHeightState(h);
      storePref('wallHeight', String(h));
    }
  };
  /** Bauteil einsetzen: gewähltes Symbol und Größe (null = Standardgröße) */
  const [symbolId, setSymbolId] = useState(() => pref('symbolId', 'door1'));
  const [symbolSize, setSymbolSize] = useState<{ w: number; h: number } | null>(null);
  /** Reihe (polar): Werte aus dem Dialog, Mittelpunkt wird noch angetippt */
  const [arrayPolar, setArrayPolar] = useState<Extract<ArrayParams, { kind: 'polar' }> | null>(null);
  /** Drehen/Skalieren/Ausrichten: angetippte Punkte (m) und Bezug-Modus */
  const [pickPts, setPickPts] = useState<Point[]>([]);
  const [refMode, setRefMode] = useState(false);
  /** Drehen in festen Winkelschritten (0 = frei) – je Gerät gemerkt */
  const [rotStep, setRotStepState] = useState(() => Number(pref('rotStep', '0')) || 0);
  const setRotStep = (v: number) => {
    setRotStepState(v);
    storePref('rotStep', String(v));
  };
  /** Ausrichten: auch verschieben (Standard) oder nur drehen */
  const [alignMove, setAlignMoveState] = useState(() => pref('alignMove', '1') !== '0');
  const setAlignMove = (on: boolean) => {
    setAlignMoveState(on);
    storePref('alignMove', on ? '1' : '0');
  };
  /** Verbinden: Lücken bis zu diesem Abstand (m) schließen */
  const [joinTol, setJoinTolState] = useState(() => Number(pref('joinTol', '0.02')) || 0.02);
  const setJoinTol = (t: number) => {
    setJoinTolState(t);
    storePref('joinTol', String(t));
  };
  /** Ausgewählter Eckpunkt des ausgewählten Objekts (zum Entfernen) */
  const [vertex, setVertex] = useState<number | null>(null);
  const setSelectedId = (id: string | null) => {
    setSelectedIdState(id);
    if (id !== selectedId) setVertex(null);
  };
  const [overrides, setOverrides] = useState<Record<string, Shape>>({});
  const [snapOn, setSnapOnState] = useState(() => pref('snap', '1') !== '0');
  /** Raster-Einrasten (Standard: aus – Formen folgen genau der Bewegung, Maße frei wählbar) */
  const [gridOn, setGridOnState] = useState(() => pref('gridSnap', '0') === '1');
  /** 90° / Orthogonal (F8): Linien, Polylinien, Maßlinien und Vektoren nur waagrecht/senkrecht */
  const [orthoOn, setOrthoOnState] = useState(() => pref('ortho', '0') === '1');
  /** Richtung im Orthogonalmodus: automatisch (nach der Mausbewegung), waagrecht oder senkrecht */
  const [orthoDir, setOrthoDirState] = useState<OrthoDir>(() => {
    const d = pref('orthoDir', 'auto') as OrthoDir;
    return ORTHO_DIRS.includes(d) ? d : 'auto';
  });
  /** Spurlinien (wie die Objektfang-Spuren im CAD): waagrecht/senkrecht durch angefahrene Fangpunkte */
  const [trackOn, setTrackOnState] = useState(() => pref('track', '1') !== '0');
  const setTrackOn = (on: boolean) => {
    setTrackOnState(on);
    storePref('track', on ? '1' : '0');
  };
  /** Objektfang-Arten: Reihenfolge = Vorrang, eingeschaltete – je Gerät gemerkt */
  const [snapCfg, setSnapCfgState] = useState(() => {
    try {
      const o = JSON.parse(pref('snapKinds', 'null')) as { order?: unknown; enabled?: unknown } | null;
      return normalizeSnapKinds(o?.order, o?.enabled);
    } catch {
      return normalizeSnapKinds(null, null);
    }
  });
  const setSnapCfg = (c: { order: SnapKind[]; enabled: SnapKind[] }) => {
    setSnapCfgState(c);
    storePref('snapKinds', JSON.stringify(c));
  };
  const snapKinds = useMemo(() => snapCfg.order.filter((x) => snapCfg.enabled.includes(x)), [snapCfg]);
  /**
   * angefahrene Fangpunkte (zuletzt bis zu 4), aktuelle Spurlinien, zuletzt angefahrene Kante
   * (für Parallel/Rechtwinklig) und deren aktuelle Richtungslinie – nur für die Anzeige
   */
  const track = useRef<{ acquired: Point[]; lines: { from: Point; axis: 'h' | 'v' }[]; edge: SnapSeg | null; par: { from: Point; to: Point } | null; held: { h: Point | null; v: Point | null } }>({
    acquired: [],
    lines: [],
    edge: null,
    par: null,
    held: { h: null, v: null },
  });
  /** Ende der zuletzt eingefügten Linie – die nächste Linie schließt dort an (Wände) */
  const [lastLineEnd, setLastLineEnd] = useState<Point | null>(null);

  const setTool = (t: DrawTool) => {
    setToolState(t);
    setStretchWin(null);
    setCmdBase(null);
    setCopies(0);
    setArrayPolar(null);
    setPickPts([]);
    setRefMode(false);
    setGuideErase(false);
    setFilletSrc(null);
    setDistPicks([]);
    setDistRes(null);
    // Reihe mit Auswahl: gleich die Werte abfragen
    if (t === 'array' && selIds.length) {
      setCmdSelecting(false);
      void openArray(selIds);
      return;
    }
    // Versetzen: ein gewähltes Objekt wird gleich übernommen
    setOffsetSrc(t === 'offset' && selIds.length === 1 ? selIds[0] : null);
    // Verbinden mit Auswahl: sofort ausführen
    if (t === 'join' && selIds.length) {
      const ok = runJoin(selIds);
      // nicht verbunden (Lücke zu groß): Leiste bleibt offen – größere Lücke eingeben, erneut „Verbinden“
      setToolState(ok ? 'select' : 'join');
      setCmdSelecting(!ok);
      return;
    }
    // Verschieben/Kopieren/Spiegeln/Verbinden ohne Auswahl: zuerst Objekte wählen
    setCmdSelecting(SELECT_FIRST.has(t) && !selIds.length);
    if (!NEEDS_SELECTION.has(t) && t !== 'selwin') storePref('drawTool', t);
  };
  /** Werkzeug der Planansicht: Befehle nutzen Vektor (Basis → Ziel) bzw. Fenster */
  const viewerTool: Tool = PICK_TOOLS.has(tool) || (TRANSFORM_TOOLS.has(tool) && !cmdSelecting) ? 'pick' : tool === 'symbol' ? 'pick' : tool === 'array' && arrayPolar ? 'pick' : SELECT_FIRST.has(tool) && cmdSelecting ? 'selwin' : VECTOR_COMMANDS.has(tool) ? 'vector' : tool === 'offset' ? 'pick' : tool === 'stretch' ? (stretchWin ? 'vector' : 'window') : (tool as Tool);
  const setColor = (c: string) => {
    setColorState(c);
    storePref('drawColor', c);
  };
  const setDefaultStyle = (patch: Partial<ShapeStyle>) => {
    const next = { ...defaultStyle, ...patch };
    setDefaultStyleState(next);
    storePref('drawStyle2', JSON.stringify(next));
  };
  const setSnapOn = (on: boolean) => {
    setSnapOnState(on);
    storePref('snap', on ? '1' : '0');
  };
  const setGridOn = (on: boolean) => {
    setGridOnState(on);
    storePref('gridSnap', on ? '1' : '0');
  };
  const setOrthoOn = (on: boolean) => {
    setOrthoOnState(on);
    storePref('ortho', on ? '1' : '0');
  };
  const setOrthoDir = (d: OrthoDir) => {
    setOrthoDirState(d);
    storePref('orthoDir', d);
  };

  // Raumstempel: Fläche immer aus der aktuellen Zeichnung
  const allStored = useMemo(() => (plan ? withRoomAreas(elementsOf(data, plan.id), (e, h) => textBoxWidth(e, h, e.font)) : []), [data, plan]);
  // Ausgeblendete Ebenen: nicht sichtbar, nicht fang-, auswähl- oder veränderbar
  const stored = useMemo(() => visibleElements(plan, allStored), [plan, allStored]);
  /** Schraffur am Plan fixiert: Abstand wie auf dem Papier beim Planmaßstab */
  const hatchUnit = hatchAnchor(k, plan?.drawing?.scale ?? 100);
  /** Hilfslinien des Plans (nur beim Zeichnen) und als Fanglinien */
  const guides = plan?.drawing?.guides ?? [];
  const guideSegs = useMemo(() => (guidesOn ? (plan?.drawing?.guides ?? []).map((g) => guideSeg(g)) : []), [plan?.drawing?.guides, guidesOn]);
  /** Bögen als Kreis (Mitte, Radius) für Fang: Bogenmitte, Lotpunkt, Tangente */
  const arcCircles = (movingId?: string) =>
    stored
      .filter((e) => e.type === 'arc' && e.id !== movingId)
      .map((e) => {
        const v = shapeVertices(e.shape);
        return v.length >= 3 ? circleThrough(v[0], v[Math.floor(v.length / 2)], v[v.length - 1]) : null;
      })
      .filter((c): c is { c: Point; r: number } => !!c);
  const showDims = dimsVisible(plan);
  const elements = useMemo(() => stored.map((e) => (overrides[e.id] ? { ...e, shape: overrides[e.id] } : e)), [stored, overrides]);
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const items: ViewerItem[] = useMemo(
    () => elements.map((e) => ({ id: e.id, number: 0, shape: shapeToPage(e.shape, k), color: e.color, labelOffset: null, noVertexEdit: e.type === 'arc', boxOnly: e.type === 'text' || e.type === 'symbol', keepAspect: e.type === 'symbol' ? symbolAnchor(e.symbol) : e.type === 'text' ? TEXT_ASPECT : null })),
    [elements, k],
  );
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  /** Öffnungen (Türen, Fenster) für die Wände – Seitenkoordinaten */
  const openingsPage = useMemo(() => wallOpenings(elements, k), [elements, k]);
  /** alle ausgewählten (sichtbaren) Objekte */
  const selection = useMemo(() => selIds.map((id) => byId.get(id)).filter((e): e is DrawElement => !!e), [selIds, byId]);
  const selSet = useMemo(() => new Set(selection.map((e) => e.id)), [selection]);

  /** Antippen eines Objekts: auswählen – mit Mehrfachauswahl (bzw. Umschalt/Strg) hinzufügen oder herausnehmen */
  const select = (id: string | null) => {
    if (tool === 'offset') {
      // Versetzen: angetipptes Objekt ist das zu versetzende
      setOffsetSrc(id);
      return setSelectedId(id);
    }
    const add = multi || addKey.current || cmdSelecting;
    if (!add) return setSelectedId(id);
    if (!id) return; // ins Leere getippt: Mehrfachauswahl bleibt
    setVertex(null);
    setSelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };
  const selectAll = () => {
    setVertex(null);
    setSelIds(stored.map((e) => e.id));
  };
  const clearSelection = () => setSelectedId(null);

  /**
   * Auswahlfenster (Meter): nach rechts aufgezogen nur Objekte, die ganz im Fenster liegen; nach links
   * aufgezogen alles, was das Fenster berührt (wie in AutoCAD). Mit Mehrfachauswahl wird ergänzt.
   */
  const selectWindow = (a: Point, b: Point) => {
    const win = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    const crossing = b.x < a.x;
    const inside = (p: Point) => p.x >= win.x - 1e-9 && p.x <= win.x + win.w + 1e-9 && p.y >= win.y - 1e-9 && p.y <= win.y + win.h + 1e-9;
    const box: [Point, Point][] = [
      [{ x: win.x, y: win.y }, { x: win.x + win.w, y: win.y }],
      [{ x: win.x + win.w, y: win.y }, { x: win.x + win.w, y: win.y + win.h }],
      [{ x: win.x + win.w, y: win.y + win.h }, { x: win.x, y: win.y + win.h }],
      [{ x: win.x, y: win.y + win.h }, { x: win.x, y: win.y }],
    ];
    const hits = stored
      .filter((e) => {
        const bb = shapeAABB(e.shape);
        const whole = inside({ x: bb.x, y: bb.y }) && inside({ x: bb.x + bb.w, y: bb.y + bb.h });
        if (whole || !crossing) return whole;
        if (!rectsOverlap(bb, win)) return false;
        return edgesOf(e.shape).some(([u, v]) => inside(u) || inside(v) || box.some((edge) => segmentIntersection([u, v], edge)));
      })
      .map((e) => e.id);
    setVertex(null);
    const add = multi || addKey.current || cmdSelecting;
    setSelIds((ids) => (add ? [...ids, ...hits.filter((id) => !ids.includes(id))] : hits));
    if (!hits.length && !add) toast(crossing ? 'Das Fenster berührt kein Objekt.' : 'Kein Objekt liegt ganz im Fenster (nach links aufziehen wählt auch berührte Objekte).', 'info', 3000);
  };

  // -------------------------------------------------------------------------
  // Einrasten: Fangpunkte anderer Objekte und 15°-Richtungen (abschaltbar); Raster nur, wenn
  // ausdrücklich eingeschaltet – sonst folgen Formen genau der Bewegung (keine erzwungene Rundung)

  const snap: SnapFn = (p, ctx) => {
    // eingerastete Spurlinien des letzten Schritts (halten etwas weiter, damit sie nicht flackern)
    const held = track.current.held;
    track.current.held = { h: null, v: null };
    track.current.lines = [];
    track.current.par = null;
    if (ctx.tool === 'selwin') return p;
    if (!snapOn && !gridOn && !orthoOn) return p;
    const pm = { x: p.x / k, y: p.y / k };
    const pxPerM = ctx.scale * k;
    const tol = (isCoarse() ? 16 : 9) / pxPerM;
    /**
     * Spurlinien: gemerkter Punkt, unter/über bzw. neben dem der Zeiger steht (Senkrechte bzw. Waagrechte durch den
     * Punkt). Eine schon eingerastete Spurlinie hält mit doppelter Toleranz – sie bleibt fix, solange man genau
     * darunter bleibt.
     */
    const trackRefs = (extra: Point[] = []) => {
      const refs = [...track.current.acquired, ...extra];
      let h: Point | null = null;
      let v: Point | null = null;
      const same = (a: Point | null, b: Point) => !!a && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
      for (const r of refs) {
        const th = same(held.h, r) ? tol * 2 : tol;
        const tv = same(held.v, r) ? tol * 2 : tol;
        if (Math.abs(pm.y - r.y) < th && (!h || Math.abs(pm.y - r.y) < Math.abs(pm.y - h.y))) h = r;
        if (Math.abs(pm.x - r.x) < tv && (!v || Math.abs(pm.x - r.x) < Math.abs(pm.x - v.x))) v = r;
      }
      return { h, v };
    };
    // Fangpunkte: End-/Eckpunkte, Schnittpunkte, Mittelpunkte, nächster Punkt auf Linien
    const others = stored.filter((e) => e.id !== ctx.movingId && e.type !== 'text').map((e) => e.shape);
    const from0 = ctx.from ? { x: ctx.from.x / k, y: ctx.from.y / k } : null;
    const hit = snapOn ? findSnap(pm, others, tol, [], { kinds: snapKinds, from: from0, circles: arcCircles(ctx.movingId), lines: guideSegs }) : null;
    if (hit?.kind === 'nearest' && hit.seg) track.current.edge = hit.seg;
    let q: Point = pm;
    let kind: SnapKind | undefined;
    if (orthoOn && ctx.from && ctx.tool && ORTHO_TOOLS.has(ctx.tool)) {
      // 90°: vom letzten Punkt nur waagrecht oder senkrecht; ein Fangpunkt bestimmt nur die
      // Länge (Projektion auf die Achse) – der rechte Winkel bleibt immer exakt
      const from = { x: ctx.from.x / k, y: ctx.from.y / k };
      const target = hit ? hit.point : pm;
      const o = orthoPoint(from, target, orthoDir);
      // Spurlinie quer zur Ortho-Richtung: waagrecht zeichnen und genau unter einem gemerkten Punkt → dort einrasten
      if (!hit && trackOn && snapOn) {
        const horiz = o.y === from.y;
        const { h, v } = trackRefs();
        const r = horiz ? v : h;
        if (r) {
          q = horiz ? { x: r.x, y: from.y } : { x: from.x, y: r.y };
          track.current.lines = [{ from: r, axis: horiz ? 'v' : 'h' }];
          track.current.held = horiz ? { h: null, v: r } : { h: r, v: null };
          return { x: q.x * k, y: q.y * k, kind: 'track' };
        }
      }
      if (!hit && gridOn) {
        const step = gridStep(pxPerM, 14);
        const len = o.x === from.x ? o.y - from.y : o.x - from.x;
        const L = Math.round(len / step) * step;
        q = o.x === from.x ? { x: from.x, y: from.y + L } : { x: from.x + L, y: from.y };
      } else q = o;
      if (hit && Math.hypot(q.x - hit.point.x, q.y - hit.point.y) < 1e-9) kind = hit.kind;
      return { x: q.x * k, y: q.y * k, kind };
    }
    if (!snapOn && !gridOn) return p;
    // Spurlinien: eindeutige Fangpunkte merken; ohne Fangpunkt an der Waagrechten/Senkrechten durch einen
    // gemerkten Punkt (oder den letzten Punkt) einrasten – an zweien davon im Schnittpunkt
    // nur feste Objektpunkte merken (Lotpunkt/Tangente hängen vom letzten Punkt ab)
    if (trackOn && snapOn && hit && TRACK_KINDS.has(hit.kind)) {
      const acq = track.current.acquired.filter((a) => Math.hypot(a.x - hit.point.x, a.y - hit.point.y) > 1e-6);
      track.current.acquired = [...acq, hit.point].slice(-4);
    }
    // Parallel / rechtwinklig zur zuletzt angefahrenen Kante (vom letzten Punkt aus)
    if (snapOn && !hit && from0 && track.current.edge && snapKinds.includes('parallel') && ctx.tool && PARALLEL_TOOLS.has(ctx.tool)) {
      const [ea, eb] = track.current.edge;
      const el = Math.hypot(eb.x - ea.x, eb.y - ea.y);
      if (el > 1e-9) {
        const ex = (eb.x - ea.x) / el;
        const ey = (eb.y - ea.y) / el;
        for (const [dx, dy, kind] of [
          [ex, ey, 'parallel'],
          [-ey, ex, 'square'],
        ] as const) {
          const t = (pm.x - from0.x) * dx + (pm.y - from0.y) * dy;
          const qx = from0.x + t * dx;
          const qy = from0.y + t * dy;
          if (Math.abs(t) > tol * 2 && Math.hypot(pm.x - qx, pm.y - qy) < tol) {
            track.current.par = { from: from0, to: { x: qx, y: qy } };
            return { x: qx * k, y: qy * k, kind };
          }
        }
      }
    }
    if (trackOn && snapOn && (!hit || hit.kind === 'nearest')) {
      const { h, v } = trackRefs(from0 ? [from0] : []);
      if (h || v) {
        q = { x: v ? v.x : pm.x, y: h ? h.y : pm.y };
        // nur eine Spurlinie und eine Richtung vom letzten Punkt (15°-Schritte, z. B. waagrecht): im Schnittpunkt
        // von Richtung und Spurlinie einrasten – die Linie bleibt waagrecht, die Senkrechte bleibt sichtbar
        if (from0 && !(h && v) && ctx.tool && PARALLEL_TOOLS.has(ctx.tool)) {
          const dir = snapAngle(from0, pm);
          const dx = dir.x - from0.x;
          const dy = dir.y - from0.y;
          if ((dir.x !== pm.x || dir.y !== pm.y) && Math.hypot(dx, dy) > 1e-9) {
            if (v && Math.abs(dx) > 1e-9 && Math.abs(v.x - from0.x) > 1e-9) q = { x: v.x, y: from0.y + ((v.x - from0.x) * dy) / dx };
            else if (h && Math.abs(dy) > 1e-9 && Math.abs(h.y - from0.y) > 1e-9) q = { x: from0.x + ((h.y - from0.y) * dx) / dy, y: h.y };
          }
        }
        track.current.lines = [...(h ? [{ from: h, axis: 'h' as const }] : []), ...(v ? [{ from: v, axis: 'v' as const }] : [])];
        track.current.held = { h, v };
        return { x: q.x * k, y: q.y * k, kind: 'track' };
      }
    }
    if (hit) {
      q = hit.point;
      kind = hit.kind;
    } else {
      const step = gridStep(pxPerM, 14);
      if (ctx.from && (ctx.tool === 'line' || ctx.tool === 'dimension')) {
        const from = { x: ctx.from.x / k, y: ctx.from.y / k };
        const dir = snapOn ? snapAngle(from, pm) : pm;
        const len = Math.hypot(dir.x - from.x, dir.y - from.y);
        const L = gridOn ? Math.round(len / step) * step : len;
        q = len > 1e-9 ? { x: from.x + ((dir.x - from.x) / len) * L, y: from.y + ((dir.y - from.y) / len) * L } : dir;
      } else if (gridOn) {
        q = snapToGrid(pm, step);
        kind = 'grid';
      }
    }
    return { x: q.x * k, y: q.y * k, kind };
  };

  // -------------------------------------------------------------------------
  // Anlegen und Ändern

  /**
   * Objekt speichern und auswählen. Danach gilt wieder „Auswahl“ (das Objekt ist sofort
   * bearbeitbar) – außer bei Linien aus der Maßeingabe: Die nächste Linie schließt an (Wände).
   */
  const create = (type: DrawElementType, shape: Shape, extra: Partial<DrawElement> = {}, keepTool = false) => {
    if (!plan) return;
    // Formen: Linientyp/-stärke der Voreinstellung, immer ohne Füllung (Füllung nur nachträglich) und ohne Maße
    // (Maße je Form nachträglich über „Maße anzeigen“; Bemaßung macht das Werkzeug Bemaßung)
    const styled = type !== 'text' && type !== 'dimension';
    const rec: DrawElement = {
      ...newMeta(),
      projectId: plan.projectId,
      planId: plan.id,
      type,
      shape: roundShape(shape),
      color,
      ...(styled ? { style: newElementStyle(defaultStyle), showDims: false } : {}),
      ...extra,
    };
    putRecord('elements', rec);
    setSelectedId(rec.id);
    setLastLineEnd(type === 'line' ? lineEnds(rec.shape)[1] : null);
    if (!keepTool) setTool('select');
    onCreated?.();
  };

  /** Maßlinie aus drei Punkten (Seitenkoordinaten): Lage der Maßlinie und Abstand zu den gemessenen Punkten */
  const onDimension = (a2: Point, b2: Point, offset: number) => {
    const gap = Number(pref('dimGap', '1'));
    create('dimension', lineShape({ x: a2.x / k, y: a2.y / k }, { x: b2.x / k, y: b2.y / k }), { offset: Math.round((offset / k) * 10000) / 10000 || undefined, ...(Number.isFinite(gap) && gap !== 1 ? { extGap: gap } : {}) }, true);
  };
  /** Abstand der Hilfslinien zum Objekt (mm) – gilt auch als Vorgabe für die nächsten Maßlinien */
  const setExtGap = (id: string, mm: number) => {
    const e = data.elements[id];
    if (!e) return;
    storePref('dimGap', String(mm));
    putRecord('elements', { ...e, extGap: mm });
  };
  const formatLength = (len: number) => formatM(len / k);

  /** Im Plan gezogene Form übernehmen (Seitenkoordinaten → Meter) bzw. Befehl ausführen */
  const onCreate = (pageShape: Shape) => {
    const shape = shapeToMeters(pageShape, k);
    if (tool === 'selwin' || (SELECT_FIRST.has(tool) && cmdSelecting)) {
      const [a, b] = lineEnds(shape);
      selectWindow(a, b);
      return;
    }
    if (VECTOR_COMMANDS.has(tool)) {
      // Basispunkt → Zielpunkt (gezogen oder Klick, Klick)
      const [a, b] = lineEnds(shape);
      if (tool === 'mirror') runMirror(a, b);
      else runVector(b.x - a.x, b.y - a.y, { x: a.x * k, y: a.y * k });
      return;
    }
    if (tool === 'stretch') {
      if (tool === 'stretch' && !stretchWin) {
        setStretchWin({ x: shape.x, y: shape.y, w: shape.w, h: shape.h });
        return;
      }
      const [a, b] = lineEnds(shape);
      runVector(b.x - a.x, b.y - a.y);
      return;
    }
    if (tool === 'wall') {
      create('wall', shape, { wall: { thickness: wallThickness, ...(wallHeight > 0 ? { height: wallHeight } : {}) } });
      return;
    }
    const type: DrawElementType = tool === 'dimension' ? 'dimension' : tool === 'arc' ? 'arc' : pageShape.type;
    create(type, shape);
  };

  /** Kopieren, Verschieben bzw. Strecken um den gezogenen Vektor (in m); base: Basispunkt (Seitenkoordinaten) für weitere Kopien */
  const runVector = (dx: number, dy: number, base: Point | null = null) => {
    if (tool === 'stretch' && stretchWin) {
      const changed: DrawElement[] = [];
      for (const e of stored) {
        const next = stretchShape(e.shape, stretchWin, dx, dy);
        if (!next) continue;
        const type = e.type !== 'dimension' && e.type !== 'arc' && next.type === 'freehand' ? 'freehand' : e.type;
        changed.push({ ...e, type, shape: roundShape(next) });
      }
      setStretchWin(null);
      if (!changed.length) {
        toast('Im Fenster liegen keine Eckpunkte.', 'info');
        return;
      }
      putRecords({ elements: changed }); // ein Rückgängig-Schritt
      toast(`${changed.length} Objekt(e) gestreckt.`, 'success', 2000);
      return;
    }
    const list = selection.map((x) => data.elements[x.id]).filter(Boolean);
    if (!list.length) {
      toast('Bitte zuerst Objekte auswählen.', 'info');
      return;
    }
    const moved = list.map((e) => ({ ...e, shape: roundShape(translateShape(e.shape, dx, dy)) }));
    if (tool === 'copy') {
      // alle Eigenschaften übernehmen (Linienart, Farbe, Stärke, Füllung/Schraffur, Maße, Text …), neue Kennung
      putRecords({ elements: moved.map((e) => ({ ...e, ...newMeta() })) }); // ein Rückgängig-Schritt
      const n = copies + 1;
      setCopies(n);
      toast(list.length === 1 ? `${elementLabel(list[0])} kopiert (${n}).` : `${list.length} Objekte kopiert (${n}).`, 'success', 2000);
      // Mehrfachkopie: derselbe Basispunkt gilt für die nächste Kopie, das Werkzeug bleibt aktiv
      if (base) viewer.current?.armClick(base);
      return;
    }
    putRecords({ elements: moved });
    toast(list.length === 1 ? `${elementLabel(list[0])} verschoben.` : `${list.length} Objekte verschoben.`, 'success', 2000);
    setTool('select');
  };

  /**
   * Eingabe im Befehlsfeld (Meter): „ΔX;ΔY“, „Länge<Winkel“ oder ein Abstand in Mausrichtung –
   * für Verschieben/Kopieren und für den Endpunkt einer Linie (Klick, dann Länge eingeben).
   * Liefert eine Fehlermeldung oder null.
   */
  const applyInput = (text: string): string | null => {
    if (tool === 'fillet') {
      const d = parseCadInput(text);
      if (!d || d.kind !== 'dist' || d.len < 0) return 'Bitte den Radius in m eingeben, z. B. 0,5 (0 = Ecke).';
      setFilletR(d.len);
      return null;
    }
    if (tool === 'guide') {
      const d = parseCadInput(text);
      if (!d || d.kind !== 'dist') return 'Bitte den Winkel in Grad eingeben, z. B. 30.';
      if (pickPts.length) {
        addGuide(pickPts[0], d.len);
        return null;
      }
      setGuideAngle(String(((d.len % 180) + 180) % 180));
      setGuideErase(false);
      return null;
    }
    if (tool === 'rotate') {
      const d = parseCadInput(text);
      if (!d || d.kind !== 'dist') return 'Bitte den Winkel in Grad eingeben, z. B. 90 oder -45.';
      if (!pickPts.length) return 'Zuerst den Drehpunkt antippen.';
      if (!refMode) return runRotate(pickPts[0], d.len), null;
      if (pickPts.length === 1) {
        // Bezugswinkel direkt eingegeben
        const a = (d.len * Math.PI) / 180;
        setPickPts([pickPts[0], pickPts[0], { x: pickPts[0].x + Math.cos(a), y: pickPts[0].y - Math.sin(a) }]);
        return null;
      }
      if (pickPts.length < 3) return 'Zweiten Bezugspunkt antippen.';
      return runRotate(pickPts[0], d.len - angleCcw(pickPts[1], pickPts[2])), null;
    }
    if (tool === 'scale') {
      const d = parseCadInput(text);
      if (!pickPts.length) return 'Zuerst den Basispunkt antippen.';
      if (refMode) {
        if (pickPts.length < 3) return 'Zuerst zwei Punkte der bekannten Strecke antippen.';
        if (!d || d.kind !== 'dist' || !(d.len > 0)) return 'Bitte die neue Länge in m eingeben, z. B. 4,5.';
        const ref = dist2(pickPts[1], pickPts[2]);
        return runScale(pickPts[0], d.len / ref), null;
      }
      if (d?.kind === 'dist' && d.len > 0) return runScale(pickPts[0], d.len), null;
      if (d?.kind === 'rel' && d.dx > 0 && d.dy > 0) return runScale(pickPts[0], d.dx, d.dy), null;
      return 'Bitte einen Faktor eingeben, z. B. 2 oder 0,5 – oder X;Y getrennt, z. B. 2;1.';
    }
    if (tool === 'wall') {
      const d = parseCadInput(text);
      if (d?.kind === 'dist' && d.len > 0) return setWallDefaults(d.len), null;
      if (d?.kind === 'rel' && d.dx > 0 && d.dy >= 0) return setWallDefaults(d.dx, d.dy), null;
      return 'Bitte die Wandstärke in m eingeben, z. B. 0,25 – oder Stärke;Höhe, z. B. 0,25;2,8.';
    }
    if (tool === 'symbol') {
      const def = symbolDef(symbolId);
      const d = parseCadInput(text);
      if (!def || !d || d.kind === 'polar') return 'Bitte die Breite in m eingeben, z. B. 0,9 – oder Breite;Tiefe, z. B. 1,2;0,3.';
      if (d.kind === 'dist') {
        if (!(d.len > 0)) return 'Die Breite muss größer als 0 sein.';
        setSymbolSize({ w: d.len, h: def.keepAspect ? (d.len * def.h) / def.w : (symbolSize?.h ?? def.h) });
      } else {
        if (!(Math.abs(d.dx) > 0 && Math.abs(d.dy) > 0)) return 'Breite und Tiefe müssen größer als 0 sein.';
        setSymbolSize({ w: Math.abs(d.dx), h: Math.abs(d.dy) });
      }
      return null;
    }
    if (tool === 'offset') {
      const d = parseCadInput(text);
      if (!d || d.kind !== 'dist' || !(d.len > 0)) return 'Bitte den Abstand in m eingeben, z. B. 0,25.';
      setOffsetDist(d.len);
      setOffsetThrough(false);
      return null;
    }
    if (tool === 'join') {
      const d = parseCadInput(text);
      if (!d || d.kind !== 'dist' || d.len < 0) return 'Bitte die größte Lücke in m eingeben, z. B. 0,05.';
      setJoinTol(d.len);
      return null;
    }
    const inp = parseCadInput(text);
    if (!inp) return 'Bitte z. B. 1,25 oder 2,5;0 oder 3<45 eingeben.';
    const base = cmdBase ? { x: cmdBase.x / k, y: cmdBase.y / k } : null;
    const hover = hoverRef.current ? { x: hoverRef.current.x / k, y: hoverRef.current.y / k } : null;
    const dir = base && hover ? { x: hover.x - base.x, y: hover.y - base.y } : null;
    const v = inputVector(inp, dir);
    if (!v) return base ? 'Richtung fehlt: mit der Maus in die Richtung zeigen – oder ΔX;ΔY bzw. Länge<Winkel eingeben.' : 'Zuerst den Basispunkt antippen – oder ΔX;ΔY bzw. Länge<Winkel eingeben.';
    if (tool === 'mirror') {
      if (cmdSelecting) return 'Zuerst die Objekte wählen und „Weiter“ tippen.';
      if (!base) return 'Zuerst den 1. Punkt der Spiegelachse antippen – dann z. B. 1<90 (senkrechte Achse) eingeben.';
      viewer.current?.armClick(null);
      if (Math.hypot(v.x, v.y) < 1e-9) return 'Die Achse braucht zwei verschiedene Punkte.';
      runMirror(base, { x: base.x + v.x, y: base.y + v.y });
      return null;
    }
    if (VECTOR_COMMANDS.has(tool)) {
      if (cmdSelecting) return 'Zuerst die Objekte wählen und „Weiter“ tippen.';
      const b = cmdBase;
      viewer.current?.armClick(null);
      runVector(v.x, v.y, b);
      return null;
    }
    if (tool === 'line' && base) {
      viewer.current?.armClick(null);
      if (Math.hypot(v.x, v.y) < 1e-6) return 'Die Länge muss größer als 0 sein.';
      create('line', lineShape(base, { x: base.x + v.x, y: base.y + v.y }));
      return null;
    }
    return 'Hier ist keine Eingabe möglich.';
  };

  /** Verbinden: ausgewählte Linien, Polylinien und Bögen zu einer Geometrie (ein Rückgängig-Schritt) */
  const runJoin = (ids: string[] = selIds): boolean => {
    const list = ids.map((id) => data.elements[id]).filter((e): e is DrawElement => !!e && !e.deletedAt && (e.type === 'line' || e.type === 'arc' || ((e.type === 'freehand' || e.type === 'wall') && e.shape.closed !== true && (e.type === 'wall' || e.shape.closed === false))));
    if (!list.length) {
      toast('Verbinden geht mit offenen Linien, Polylinien und Bögen.', 'info', 3500);
      return false;
    }
    const { chains, minGap } = joinShapes(list.map((e) => e.shape), joinTol);
    if (!chains.length) {
      toast(minGap !== null ? `Nichts verbunden: kleinste Lücke ${formatMeasure(minGap)} m (geschlossen werden Lücken bis ${formatMeasure(joinTol)} m).` : 'Nichts zu verbinden.', 'info', 4500);
      return false;
    }
    const now = Date.now();
    const changed: DrawElement[] = [];
    const keep: string[] = [];
    let closed = 0;
    for (const c of chains) {
      const first = list[c.members[0]];
      const type: DrawElementType = first.type === 'wall' ? 'wall' : c.shape.type === 'line' ? 'line' : 'freehand';
      changed.push({ ...first, type, shape: roundShape(c.shape) });
      keep.push(first.id);
      for (const m of c.members.slice(1)) changed.push({ ...list[m], deletedAt: now });
      if (c.closed) closed++;
    }
    putRecords({ elements: changed }); // ein Rückgängig-Schritt
    setVertex(null);
    setSelIds(keep);
    const n = chains.reduce((a, c) => a + c.members.length, 0);
    toast(
      closed
        ? `${n === 1 ? 'Linie' : `${n} Teile`} zu ${closed === 1 ? 'einer geschlossenen Fläche' : `${closed} geschlossenen Flächen`} verbunden – Füllung und Schraffur unter „Eigenschaften“.`
        : `${n} Teile zu ${chains.length === 1 ? 'einer Linie' : `${chains.length} Linien`} verbunden${minGap !== null ? ` · offen bleibt eine Lücke von ${formatMeasure(minGap)} m` : ''}.`,
      'success',
      4500,
    );
    return true;
  };

  /** Spiegeln an der Achse a–b (Meter): Original behalten oder ersetzen (ein Rückgängig-Schritt) */
  const runMirror = (a: Point, b: Point) => {
    const list = selection.map((x) => data.elements[x.id]).filter(Boolean);
    if (!list.length) {
      toast('Bitte zuerst Objekte auswählen.', 'info');
      return;
    }
    const out = list.map((e) => {
      const shape = roundShape(mirrorShape(e.shape, a, b, e.type === 'text'));
      // Maßlinie: Seite der Maßlinie mitspiegeln; Bauteil: Öffnungsrichtung mitspiegeln
      const extra = e.type === 'dimension' && e.offset ? { offset: -e.offset } : e.type === 'symbol' && e.symbol ? { symbol: { ...e.symbol, flipY: !e.symbol.flipY || undefined } } : {};
      return mirrorKeep ? { ...e, ...newMeta(), shape, ...extra } : { ...e, shape, ...extra };
    });
    putRecords({ elements: out });
    toast(`${list.length === 1 ? elementLabel(list[0]) : `${list.length} Objekte`} gespiegelt${mirrorKeep ? ' (Original bleibt)' : ''}.`, 'success', 2500);
    setToolState('select');
    setCmdBase(null);
    setSelIds(out.map((e) => e.id));
  };

  /** Versetzen: Seite (bzw. Punkt bei „durch Punkt“) angetippt – parallele Kopie mit allen Eigenschaften */
  const runOffset = (pm: Point) => {
    const e = offsetSrc ? data.elements[offsetSrc] : undefined;
    if (!e || e.deletedAt) return;
    const d = offsetThrough ? distanceToShape(e.shape, pm) : offsetDist;
    const shape = offsetShape(e.shape, d, pm);
    if (!shape) {
      toast(`Versetzen um ${formatMeasure(d)} m nicht möglich (nach innen zu groß?).`, 'error', 3500);
      return;
    }
    const type: DrawElementType = e.type === 'triangle' || e.type === 'rect' || e.type === 'ellipse' || e.type === 'line' || e.type === 'wall' ? e.type : 'freehand';
    const rec: DrawElement = { ...e, ...newMeta(), type: shape.type === 'freehand' && e.type === 'arc' ? 'arc' : type, shape: roundShape(shape) };
    putRecord('elements', rec);
    toast(`Versetzt um ${formatMeasure(d)} m.`, 'success', 1800);
    // nächstes Objekt (AutoCAD-Ablauf): das neue bleibt gewählt, kann gleich weiter versetzt werden
    setOffsetSrc(null);
    setSelectedId(null);
  };

  /** Reihe: Werte abfragen (Dialog); polar wartet danach auf den Mittelpunkt */
  const openArray = async (ids: string[] = selIds) => {
    const p = await arrayDialog(ids.length);
    if (!p) {
      setToolState('select');
      setCmdSelecting(false);
      return;
    }
    if (p.kind === 'polar') {
      setArrayPolar(p);
      setToolState('array');
      setCmdSelecting(false);
      return;
    }
    runArrayAt(p, null, ids);
  };

  /** Reihe anlegen: Kopien mit allen Eigenschaften (ein Rückgängig-Schritt) */
  const runArrayAt = (p: ArrayParams, center: Point | null, ids: string[] = selIds) => {
    const list = ids.map((id) => data.elements[id]).filter((e): e is DrawElement => !!e && !e.deletedAt);
    if (!list.length) return;
    const copies: DrawElement[] = [];
    if (p.kind === 'polar') {
      if (!center) return;
      for (const a of polarAngles(p.count, p.total)) for (const e of list) copies.push({ ...e, ...newMeta(), shape: roundShape(rotateAround(e.shape, center, a, p.rotate || e.type === 'dimension')) });
    } else for (const o of arrayOffsets(p)) for (const e of list) copies.push({ ...e, ...newMeta(), shape: roundShape(translateShape(e.shape, o.x, o.y)) });
    putRecords({ elements: copies });
    toast(`Reihe: ${copies.length} Kopie${copies.length === 1 ? '' : 'n'} angelegt.`, 'success', 2500);
    setArrayPolar(null);
    setToolState('select');
    setCmdSelecting(false);
  };

  /**
   * Polylinie, Fläche, Wand: nächsten Knick aus einer Eingabe – Länge in Zeigerrichtung, ΔX;ΔY oder Länge<Winkel
   * (vom zuletzt gesetzten Punkt, Seitenkoordinaten). Liefert den Punkt oder eine Fehlermeldung.
   */
  const polyNext = (text: string, last: Point): Point | string => {
    const inp = parseCadInput(text);
    if (!inp) return 'Bitte z. B. 2,5 (Länge in Zeigerrichtung), 2,5;0 (ΔX;ΔY) oder 3<90 (Länge<Winkel) eingeben.';
    const hover = hoverRef.current;
    const dir = hover ? { x: (hover.x - last.x) / k, y: (hover.y - last.y) / k } : null;
    const v = inputVector(inp, dir && Math.hypot(dir.x, dir.y) > 1e-6 ? dir : null);
    if (!v) return 'Richtung fehlt: mit Maus bzw. Stift in die Richtung zeigen – oder ΔX;ΔY bzw. Länge<Winkel eingeben (z. B. 3<90 = 3 m nach oben).';
    if (Math.hypot(v.x, v.y) < 1e-9) return 'Die Länge muss größer als 0 sein.';
    return { x: last.x + v.x * k, y: last.y + v.y * k };
  };

  /** Fangradius in m für das Antippen von Objekten */
  const pickTol = () => (isCoarse() ? 18 : 10) / ((viewer.current?.scale() ?? 1) * k);

  // ---------------- Schraffur ----------------
  /** Muster wählen, danach Flächen antippen */
  const pickHatch = async () => {
    const r = await hatchPicker(hatchSet, { title: 'Schraffur wählen – danach in die Fläche tippen' });
    if (!r) return;
    setHatchSet({ ...r, none: false });
    setTool('hatch');
    setSelectedId(null);
  };
  /**
   * In eine geschlossene Fläche getippt: die innerste geschlossene Form unter dem Punkt bekommt die Schraffur
   * (Rechteck, Kreis, Dreieck, Fläche, Wand-Band). Innerhalb einer geschlossenen Wand (Raum) entsteht eine
   * schraffierte Fläche bis zur Wandinnenseite.
   */
  const hatchAt = (pm: Point) => {
    const style = hatchStyle(hatchSet);
    let best: { e: DrawElement; area: number } | null = null;
    let room: { e: DrawElement; inner: Point[]; area: number } | null = null;
    for (const e of stored) {
      if (e.type === 'text' || e.type === 'dimension' || e.type === 'symbol' || e.type === 'line' || e.type === 'arc') continue;
      if (e.type === 'wall') {
        const axis = shapeVertices(e.shape);
        const closedWall = !isOpenShape(e.shape);
        const t = e.wall?.thickness ?? 0.25;
        const band = wallGeometry(axis, closedWall, t).quads;
        if (band.some((q) => pointInPolygon(pm, q))) {
          const a = band.reduce((s2, q) => s2 + polygonArea(q), 0);
          if (!best || a < best.area) best = { e, area: a };
          continue;
        }
        if (closedWall && axis.length >= 3 && pointInPolygon(pm, axis)) {
          // Raum: Wandachse um die halbe Stärke nach innen (die kleinere der beiden Seiten)
          const a1 = offsetPath(axis, t / 2, true);
          const a2 = offsetPath(axis, -t / 2, true);
          const inner = polygonArea(a1) < polygonArea(a2) ? a1 : a2;
          const area = polygonArea(inner);
          if (!room || area < room.area) room = { e, inner, area };
        }
        continue;
      }
      if (isOpenShape(e.shape)) continue;
      const poly = shapeVertices(e.shape);
      const outline = e.shape.type === 'ellipse' ? edgesOf(e.shape).map(([a]) => a) : poly;
      if (outline.length >= 3 && pointInPolygon(pm, outline)) {
        const a = polygonArea(outline);
        if (!best || a < best.area) best = { e, area: a };
      }
    }
    if (best && (!room || best.area <= room.area)) {
      const e = best.e;
      putRecord('elements', { ...e, style: { ...e.style, ...style } });
      toast(hatchSet.none ? 'Schraffur entfernt.' : `Schraffiert: ${hatchLabel(hatchSet)}.`, 'success', 1800);
      return;
    }
    if (room && !hatchSet.none) {
      create('freehand', shapeFromVertices({ type: 'freehand', x: 0, y: 0, w: 0, h: 0, closed: true }, room.inner), { style: { ...newElementStyle(defaultStyle), lineWidth: 0.25, ...style } }, true);
      setSelectedId(null);
      toast(`Raum schraffiert: ${hatchLabel(hatchSet)}.`, 'success', 1800);
      return;
    }
    // Raum aus einzelnen Wänden/Linien: kleinste geschlossene Masche um den Punkt
    const region = !hatchSet.none ? regionAt(pm, boundarySegments(stored)) : null;
    if (region) {
      create('freehand', shapeFromVertices({ type: 'freehand', x: 0, y: 0, w: 0, h: 0, closed: true }, region.outline), { style: { ...newElementStyle(defaultStyle), lineWidth: 0.25, ...style } }, true);
      setSelectedId(null);
      toast(`Fläche schraffiert: ${hatchLabel(hatchSet)}.`, 'success', 1800);
      return;
    }
    toast('Hier ist keine geschlossene Fläche. Tipp: Linien mit „Verbinden“ zu einer Fläche machen oder die Fläche mit „Fläche“ nachzeichnen.', 'info', 4500);
  };

  /** Raumstempel: in einen geschlossenen Raum getippt → Name abfragen, Stempel mittig an die Stelle */
  const roomAt = async (pm: Point) => {
    const region = regionAt(pm, boundarySegments(stored));
    if (!region) {
      toast('Hier ist kein geschlossener Raum. Wände bzw. Linien müssen rundum geschlossen sein (Türen und Fenster zählen als geschlossen).', 'info', 4500);
      return;
    }
    const area = Math.round(region.area * 1e4) / 1e4;
    const r = await roomDialog(area);
    if (!r) return;
    const room = { area, ...(r.note ? { note: r.note } : {}) };
    const proto = { text: r.name, room };
    // Schrift 3,5 mm auf dem Papier (Planmaßstab); passt der Stempel nicht in den Raum, kleiner
    const xs = region.outline.map((q) => q.x);
    const ys = region.outline.map((q) => q.y);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    let fs = 0.0035 * (plan?.drawing?.scale ?? 100);
    const w0 = textBoxWidth(proto, textBoxHeight(proto, fs));
    const h0 = textBoxHeight(proto, fs);
    fs *= Math.min(1, (0.85 * bw) / w0, (0.85 * bh) / h0);
    const h = textBoxHeight(proto, Math.max(0.02, Math.round(fs * 1000) / 1000));
    const w = textBoxWidth(proto, h);
    create('text', { type: 'rect', x: pm.x - w / 2, y: pm.y - h / 2, w, h }, { text: r.name, room, color: pref('textColor', DRAW_DEFAULT_COLOR) }, true);
    setSelectedId(null);
    toast(`Raumstempel „${r.name}“: ${formatMeasure(area)} m².`, 'success', 1800);
  };

  /** Raumstempel bearbeiten (Name, Zusatz) */
  const editRoom = async (id: string) => {
    const e = data.elements[id];
    if (!e?.room) return;
    const r = await roomDialog(e.room.area, { name: e.text ?? '', note: e.room.note ?? '' });
    if (!r) return;
    const room = { area: e.room.area, ...(r.note ? { note: r.note } : {}) };
    const next = { ...e, text: r.name, room };
    // Zeilenzahl kann sich ändern: Schrifthöhe bleibt, Mitte bleibt
    const fs = textFontSize(e, e.shape.h);
    const h = textBoxHeight(next, fs);
    const w = textBoxWidth(next, h, e.font);
    const c = { x: e.shape.x + e.shape.w / 2, y: e.shape.y + e.shape.h / 2 };
    putRecord('elements', { ...next, shape: roundShape({ ...e.shape, x: c.x - w / 2, y: c.y - h / 2, w, h }) });
  };

  // ---------------- Hilfslinien ----------------
  const saveGuides = (list: GuideLine[]) => {
    const pl = plan ? data.plans[plan.id] : undefined;
    if (!pl?.drawing) return;
    const drawingInfo = { ...pl.drawing, guides: list.length ? list : undefined };
    if (!list.length) delete drawingInfo.guides;
    putRecords({ plans: [{ ...pl, drawing: drawingInfo }] }, { history: true }); // Rückgängig wie bei Zeichnungsobjekten
  };
  const addGuide = (at: Point, angle: number) => {
    const a = ((angle % 180) + 180) % 180;
    saveGuides([...guides, { id: newMeta().id, x: Math.round(at.x * 10000) / 10000, y: Math.round(at.y * 10000) / 10000, angle: Math.round(a * 10000) / 10000 }]);
    if (!guidesOn) setGuidesOn(true);
    setPickPts([]);
  };
  const clearGuides = () => {
    if (!guides.length) return;
    saveGuides([]);
    toast('Alle Hilfslinien gelöscht (Rückgängig holt sie zurück).', 'success', 2500);
  };
  const guidePoint = (pm: Point) => {
    if (guideErase) {
      let best: { id: string; d: number } | null = null;
      for (const g of guides) {
        const d = pointLineDistance(pm, guideSeg(g)).d;
        if (!best || d < best.d) best = { id: g.id, d };
      }
      if (!best || best.d > pickTol()) return toast('Keine Hilfslinie an dieser Stelle.', 'info', 2000);
      saveGuides(guides.filter((g) => g.id !== best!.id));
      return;
    }
    if (guideAngle !== 'free') return addGuide(pm, Number(guideAngle) || 0);
    if (!pickPts.length) return setPickPts([pm]);
    if (dist2(pickPts[0], pm) < 1e-9) return;
    addGuide(pickPts[0], angleCcw(pickPts[0], pm));
  };

  // ---------------- Abrunden ----------------
  const filletPoint = (pm: Point) => {
    const tol = pickTol();
    let best: { e: DrawElement; d: number } | null = null;
    for (const e of stored) {
      if (e.type === 'text' || e.type === 'dimension' || e.type === 'symbol' || e.type === 'arc' || e.shape.type === 'ellipse') continue;
      const d = distanceToShape(e.shape, pm);
      if (d <= tol && (!best || d < best.d)) best = { e, d };
    }
    if (!best) return toast(filletSrc ? 'Bitte die zweite Linie antippen.' : 'Bitte eine Linie oder die Ecke einer Fläche antippen.', 'info', 2500);
    const e = best.e;
    if (e.type === 'line') {
      if (!filletSrc) {
        setFilletSrc({ id: e.id, tap: pm });
        setSelectedId(e.id);
        return;
      }
      if (filletSrc.id === e.id) return toast('Bitte eine andere Linie antippen.', 'info', 2500);
      const e1 = data.elements[filletSrc.id];
      if (!e1) return setFilletSrc(null);
      const r = filletLines(lineEnds(e1.shape), filletSrc.tap, lineEnds(e.shape), pm, filletR);
      if ('error' in r) {
        toast(r.error, 'error', 3500);
        return;
      }
      const out: DrawElement[] = [
        { ...e1, shape: roundShape(lineShape(r.a[0], r.a[1])) },
        { ...e, shape: roundShape(lineShape(r.b[0], r.b[1])) },
      ];
      const arc = r.arc ? arcShape(r.arc[0], r.arc[1], r.arc[2]) : null;
      if (arc) out.push({ ...e1, ...newMeta(), type: 'arc', shape: roundShape(arc), showDims: false });
      putRecords({ elements: out });
      toast(filletR > 0 ? `Abgerundet (Radius ${formatMeasure(filletR)} m).` : 'Ecke gebildet.', 'success', 2500);
      setFilletSrc(null);
      setSelectedId(null);
      return;
    }
    // Ecke einer Fläche, Polylinie, eines Rechtecks oder einer Wand
    if (filletSrc) return toast('Bitte eine zweite Linie antippen – oder „Abbrechen“.', 'info', 2500);
    const pts = shapeVertices(e.shape);
    let vi = -1;
    let vd = Infinity;
    pts.forEach((v, i) => {
      const d = dist2(v, pm);
      if (d < vd) {
        vd = d;
        vi = i;
      }
    });
    if (vi < 0 || vd > tol * 2.5) return toast('Bitte nahe an der Ecke antippen.', 'info', 2500);
    if (filletR <= 0) return toast('Zuerst einen Radius eingeben (z. B. 0,5).', 'info', 3000);
    const closed = !isOpenShape(e.shape);
    const res = filletCorner(pts, closed, vi, filletR);
    if ('error' in res) return toast(res.error, 'error', 3500);
    const sh = shapeFromVertices({ type: 'freehand', x: 0, y: 0, w: 0, h: 0, closed }, res);
    putRecords({ elements: [{ ...e, type: e.type === 'wall' ? 'wall' : 'freehand', shape: roundShape(sh) }] });
    toast(`Ecke abgerundet (Radius ${formatMeasure(filletR)} m).`, 'success', 2500);
  };

  // ---------------- Abstand ----------------
  const distancePoint = (pm: Point) => {
    const tol = pickTol();
    let best: { e: DrawElement; seg: [Point, Point]; d: number } | null = null;
    for (const e of stored) {
      if (e.type === 'text') continue;
      for (const seg of edgesOf(e.shape)) {
        const d = distToSegment(pm, seg[0], seg[1]);
        if (d <= tol && (!best || d < best.d)) best = { e, seg, d };
      }
    }
    const pick: DistPick = best ? { point: pm, seg: best.seg, id: best.e.id } : { point: pm };
    const picks = distPicks.length >= 2 ? [pick] : [...distPicks, pick];
    setDistPicks(picks);
    setDistRes(picks.length === 2 ? measureDistance(picks[0], picks[1]) : null);
  };
  const measureDistance = (a: DistPick, b: DistPick): DistResult => {
    let rel: DistResult['rel'];
    let angle: number | undefined;
    if (a.seg && b.seg) {
      angle = angleBetween(a.seg, b.seg);
      if (angle < 0.5) rel = 'parallel';
      else if (angle > 89.5) rel = 'perpendicular';
    }
    if (rel === 'parallel' && a.seg) {
      const r = pointLineDistance(b.point, a.seg);
      return { p: r.foot, q: b.point, d: r.d, rel, angle };
    }
    const edges = (pk: DistPick, other: DistPick): [Point, Point][] => {
      const e = pk.id ? byId.get(pk.id) : undefined;
      if (e && pk.id !== other.id) return edgesOf(e.shape);
      return pk.seg ? [pk.seg] : [[pk.point, pk.point]];
    };
    let out = { d: Infinity, p: a.point, q: b.point };
    for (const s1 of edges(a, b)) for (const s2 of edges(b, a)) {
      const r = segSegDistance(s1, s2);
      if (r.d < out.d) out = r;
    }
    return { ...out, rel, angle };
  };
  /** Abstand als Maßlinie einfügen */
  const distToDimension = () => {
    if (!distRes || distRes.d < 1e-6) return;
    create('dimension', lineShape(distRes.p, distRes.q), {}, true);
    setDistPicks([]);
    setDistRes(null);
  };

  /** Winkel auf Winkelschritte runden */
  const stepAngle = (a: number) => (rotStep > 0 ? Math.round(a / rotStep) * rotStep : Math.round(a * 100) / 100);
  const dist2 = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  /** Drehen, Skalieren, Ausrichten: nächster angetippter Punkt */
  const transformPoint = (pm: Point) => {
    const pts = [...pickPts, pm];
    if (tool === 'rotate') {
      if (pts.length === 1) return setPickPts(pts);
      if (!refMode) return runRotate(pts[0], stepAngle(angleCcw(pts[0], pm)));
      if (pts.length < 4) return setPickPts(pts);
      return runRotate(pts[0], stepAngle(angleCcw(pts[0], pm)) - angleCcw(pts[1], pts[2]));
    }
    if (tool === 'scale') {
      if (pts.length === 1) return setPickPts(pts);
      if (!refMode) {
        toast('Faktor eintippen (z. B. 2 oder 0,5) – oder „Bezug“ wählen und zwei Punkte einer bekannten Strecke antippen.', 'info', 4000);
        return;
      }
      if (pts.length < 4) return setPickPts(pts);
      const ref = dist2(pts[1], pts[2]);
      return ref > 1e-9 ? runScale(pts[0], dist2(pts[1], pm) / ref) : undefined;
    }
    if (tool === 'align') {
      if (pts.length < 4) return setPickPts(pts);
      return runAlign(pts[0], pts[1], pts[2], pts[3]);
    }
  };

  /** Auswahl als Datensätze, Ergebnis speichern (ein Rückgängig-Schritt), Auswahl bleibt */
  const applyTransform = (fn: (e: DrawElement) => DrawElement | null, done: string) => {
    const list = selection.map((x) => data.elements[x.id]).filter(Boolean);
    const out: DrawElement[] = [];
    for (const e of list) {
      const r = fn(e);
      if (!r) {
        toast(`${elementLabel(e)}: so nicht möglich (z. B. gedrehter Kreis bzw. Text nur gleichmäßig).`, 'error', 4000);
        return;
      }
      out.push(r);
    }
    putRecords({ elements: out });
    toast(done, 'success', 2500);
    setToolState('select');
    setPickPts([]);
    setRefMode(false);
  };

  const runRotate = (c: Point, deg: number) =>
    applyTransform((e) => ({ ...e, shape: roundShape(rotateAround(e.shape, c, deg, true)) }), `Gedreht um ${String(Math.round(deg * 100) / 100).replace('.', ',')}°.`);

  const runScale = (c: Point, sx: number, sy = sx) =>
    applyTransform((e) => {
      const uniform = Math.abs(sx - sy) < 1e-12;
      if (e.type === 'text' && !uniform) return null;
      if (e.type === 'symbol' && e.shape.rotation && !uniform) return null;
      let sh = scaleAbout(e.shape, c, sx, sy);
      if (!sh) return null;
      if (e.type === 'text') sh = { ...sh, w: textBoxWidth(e, sh.h, e.font) };
      const type: DrawElementType = e.type === 'rect' && sh.type === 'freehand' ? 'freehand' : e.type;
      return { ...e, type, shape: roundShape(sh) };
    }, `Skaliert ${uniform2(sx, sy)}.`);
  const uniform2 = (sx: number, sy: number) => (Math.abs(sx - sy) < 1e-12 ? `mit Faktor ${formatFactor(sx)}` : `X ${formatFactor(sx)}, Y ${formatFactor(sy)}`);
  const formatFactor = (f: number) => String(Math.round(f * 10000) / 10000).replace('.', ',');

  const runAlign = (s1: Point, s2: Point, d1: Point, d2: Point) => {
    if (dist2(s1, s2) < 1e-9 || dist2(d1, d2) < 1e-9) {
      toast('Die Punkte je Richtung müssen verschieden sein.', 'error');
      setPickPts([]);
      return;
    }
    const deg = angleCcw(d1, d2) - angleCcw(s1, s2);
    applyTransform((e) => {
      let sh = rotateAround(e.shape, s1, deg, true);
      if (alignMove) sh = translateShape(sh, d1.x - s1.x, d1.y - s1.y);
      return { ...e, shape: roundShape(sh) };
    }, alignMove ? 'Ausgerichtet (gedreht und verschoben).' : 'Ausgerichtet (nur gedreht).');
  };

  /** Bauteil wählen (Tür, Fenster, Elektro …) und danach einsetzen */
  const pickSymbol = async (group: SymbolGroup) => {
    const id = await symbolPicker(group);
    if (!id) return;
    setSymbolId(id);
    storePref('symbolId', id);
    setSymbolSize(null);
    setTool('symbol');
    setSelectedId(null);
  };

  /**
   * Lage eines neuen Bauteils am Punkt pm (m): Türen und Fenster richten sich an einer Linie/Kante in der Nähe aus
   * (Drehung wie die Linie; Fenster mittig in der Linie, Türen mit der Öffnungslinie auf der Linie), sonst waagrecht.
   */
  const symbolPlacement = (pm: Point): Shape | null => {
    const def = symbolDef(symbolId);
    if (!def) return null;
    const w = symbolSize?.w ?? def.w;
    let h = symbolSize?.h ?? def.h;
    let center = pm;
    let rotation = 0;
    const wallV = symbolWall(def);
    if (wallV !== null || def.group === 'window') {
      const tol = (isCoarse() ? 22 : 14) / ((viewer.current?.scale() ?? 1) * k);
      let best: { q: Point; a: number; d: number; wallT?: number } | null = null;
      for (const e of stored) {
        if (e.type === 'text' || e.type === 'dimension' || e.type === 'symbol') continue;
        for (const [u, v] of edgesOf(e.shape)) {
          const d = distToSegment(pm, u, v);
          if (d > tol || (best && d >= best.d)) continue;
          const dx = v.x - u.x;
          const dy = v.y - u.y;
          const l2 = dx * dx + dy * dy || 1e-12;
          const t = Math.max(0, Math.min(1, ((pm.x - u.x) * dx + (pm.y - u.y) * dy) / l2));
          best = { q: { x: u.x + t * dx, y: u.y + t * dy }, a: (Math.atan2(dy, dx) * 180) / Math.PI, d, wallT: e.type === 'wall' ? e.wall?.thickness : undefined };
        }
      }
      if (best) {
        // Fenster in einer Wand: Tiefe = Wandstärke (wenn keine eigene Größe eingegeben)
        if (def.group === 'window' && best.wallT && !symbolSize) h = best.wallT;
        // Richtung so wählen, dass das Symbol „aufrecht“ bleibt (−90° … 90°)
        let a = best.a;
        if (a > 90) a -= 180;
        if (a <= -90) a += 180;
        rotation = ((a % 360) + 360) % 360;
        const r = (a * Math.PI) / 180;
        // Tür: Wandlinie des Symbols (unten, bei Pendeltür/Drehkreuz/Kipptor in der Mitte) auf der Linie
        const up = wallV !== null ? (wallV - 0.5) * h : 0;
        center = { x: best.q.x + up * Math.sin(r), y: best.q.y - up * Math.cos(r) };
      }
    }
    return { type: 'rect', x: center.x - w / 2, y: center.y - h / 2, w, h, ...(rotation ? { rotation } : {}) };
  };

  /** Bauteil: Anschlag bzw. Öffnungsrichtung umschalten */
  const flipSymbol = (id: string, axis: 'x' | 'y') => {
    const e = data.elements[id];
    if (!e?.symbol) return;
    const next = !e.symbol[axis === 'x' ? 'flipX' : 'flipY'];
    let shape = e.shape;
    // Tür: Öffnungsrichtung wechseln = Flügel auf die andere Wandseite; die Öffnungslinie bleibt auf der Wand
    const wallV = symbolWall(symbolDef(e.symbol.id));
    if (axis === 'y' && wallV !== null && wallV !== 0.5) {
      const dy = (next ? 1 : -1) * (2 * wallV - 1) * e.shape.h;
      const r = ((e.shape.rotation ?? 0) * Math.PI) / 180;
      shape = roundShape(translateShape(e.shape, -dy * Math.sin(r), dy * Math.cos(r)));
    }
    putRecord('elements', { ...e, shape, symbol: { ...e.symbol, [axis === 'x' ? 'flipX' : 'flipY']: next || undefined } });
  };

  /** Befehl „Weiter“ (nach dem Wählen der Objekte) */
  const cmdNext = () => {
    if (tool === 'array') {
      setCmdSelecting(false);
      void openArray();
      return;
    }
    if (tool === 'join') {
      if (runJoin()) {
        setToolState('select');
        setCmdSelecting(false);
      }
      return;
    }
    setCmdSelecting(false);
  };

  /** Befehl beenden (Kopieren: „Fertig“) */
  const finishCommand = () => {
    viewer.current?.armClick(null);
    setTool('select');
  };

  /** Text am Cursor: Abstand, ΔX, ΔY (nach oben positiv) und Winkel – laufend beim Zeichnen bzw. Verschieben */
  const tipText = (a: Point, b: Point): string | null => {
    const i = vectorInfo((b.x - a.x) / k, (b.y - a.y) / k);
    if (i.len < 1e-9) return null;
    const n = (v: number) => (Math.abs(v) < 0.005 ? '0,00' : `${v < 0 ? '−' : ''}${formatMeasure(Math.abs(v))}`);
    return `${formatMeasure(i.len)} m · ΔX ${n(i.dx)} · ΔY ${n(i.dy)} · ${String(i.angle).replace('.', ',')}°`;
  };

  /** Ausgewählte Objekte löschen (ein Rückgängig-Schritt) */
  const removeSelection = async () => {
    if (selection.length === 1) return remove(selection[0]);
    if (!selection.length) return;
    const over = new Set(selection.flatMap((e) => overlapping(e).map((d) => d.id)));
    if (over.size) {
      const ok = await confirmDialog({
        title: `${selection.length} Objekte löschen?`,
        message: <p>Auf den Objekten liegen <strong>{over.size} Messung(en)</strong>. Die Messungen bleiben erhalten – nur die Zeichnungsobjekte werden entfernt. Mit „Rückgängig“ lassen sie sich wiederherstellen.</p>,
        confirmLabel: 'Objekte löschen',
        danger: true,
      });
      if (!ok) return;
    }
    softDelete({ elements: selection.map((e) => data.elements[e.id]) });
    toast(`${selection.length} Objekte gelöscht.`, 'info', 2000);
    setSelectedId(null);
  };

  /** Drehen bzw. Skalieren des ausgewählten Objekts um seinen Mittelpunkt */
  const transformSelected = (kind: 'rotate' | 'scale', value: number) => {
    const e = selected ? data.elements[selected.id] : undefined;
    if (!e) return;
    let shape = kind === 'rotate' ? rotateShapeBy(e.shape, value) : scaleShape(e.shape, value);
    // Text: Breite folgt der Schrifthöhe
    if (e.type === 'text' && kind === 'scale') shape = { ...shape, w: textBoxWidth(e, shape.h, e.font) };
    putRecord('elements', { ...e, shape: roundShape(shape) });
  };

  /** Elementtyp eines gestutzten Teilstücks (Bogen bleibt Bogen, sonst Linie bzw. offene Polylinie) */
  const pieceType = (orig: DrawElement, piece: Shape): DrawElementType => (orig.type === 'wall' ? 'wall' : piece.type === 'line' ? 'line' : orig.type === 'arc' ? 'arc' : 'freehand');

  /** Ergebnis des Stutzens speichern: erstes Teil ersetzt das Original, weitere werden neu angelegt */
  const trimmedRecords = (e: DrawElement, parts: Shape[]): DrawElement[] =>
    parts.map((sh, i) => ({ ...e, ...(i ? newMeta() : {}), type: pieceType(e, sh), shape: roundShape(sh) }));

  /** Stutzen-fähige Objekte: alles mit Kanten außer Text und Maßlinien */
  const trimmable = (e: DrawElement) => e.type !== 'text' && e.type !== 'dimension' && e.type !== 'symbol';

  /** Stutzen (Klick) bzw. Verlängern: angeklicktes Objekt gegen alle anderen Objekte */
  const trimOrExtend = (p: Point) => {
    const pm = { x: p.x / k, y: p.y / k };
    const pxPerM = (viewer.current?.scale() ?? 1) * k;
    const tol = (isCoarse() ? 18 : 10) / pxPerM;
    let best: { e: DrawElement; d: number } | null = null;
    for (const e of stored) {
      if (tool === 'extend' ? e.type !== 'line' : !trimmable(e)) continue;
      const d = Math.min(...edgesOf(e.shape).map(([a, b]) => distToSegment(pm, a, b)));
      if (d <= tol && (!best || d < best.d)) best = { e, d };
    }
    if (!best) {
      toast(tool === 'trim' ? 'Bitte eine Linie oder Kante anklicken – oder über mehrere Linien ziehen (Zaun).' : 'Bitte eine Linie nahe dem zu verlängernden Ende anklicken.', 'info');
      return;
    }
    const line = best.e;
    const others = stored.filter((x) => x.id !== line.id && x.type !== 'text').map((x) => x.shape);
    if (tool === 'extend') {
      const next = extendLine(line.shape, pm, others);
      if (!next) toast('In dieser Richtung gibt es keine Kante zum Verlängern.', 'info');
      else putRecord('elements', { ...line, shape: roundShape(next) });
      return;
    }
    const parts = trimShape(line.shape, pm, others);
    if (!parts) {
      toast(line.type === 'line' || line.type === 'arc' || isOpenShape(line.shape) ? 'Die Linie schneidet keine andere Kante.' : 'Zum Stutzen einer geschlossenen Form braucht es mindestens zwei Schnittpunkte.', 'info');
      return;
    }
    if (selectedId === line.id) setSelectedId(null);
    if (!parts.length) softDelete({ elements: [line] });
    else putRecords({ elements: trimmedRecords(line, parts) });
  };

  /** Stutzen mit Zaun (frei gezogen): alle gekreuzten Linien zwischen ihren Schnittkanten bzw. Eckpunkten entfernen (ein Rückgängig-Schritt) */
  const onFence = (path: Point[]) => {
    const list = stored.filter((e) => e.type !== 'text');
    const res = trimByFence(
      list.map((e) => e.shape),
      path.map((q) => ({ x: q.x / k, y: q.y / k })),
    );
    const changed: DrawElement[] = [];
    const removed: DrawElement[] = [];
    for (const [i, parts] of res) {
      const e = list[i];
      if (!trimmable(e)) continue;
      if (!parts.length) removed.push(e);
      else changed.push(...trimmedRecords(e, parts));
    }
    if (!changed.length && !removed.length) {
      toast('Der Zaun kreuzt keine Linie, die gestutzt werden kann.', 'info');
      return;
    }
    setSelectedId(null);
    if (changed.length) putRecords({ elements: changed });
    if (removed.length) softDelete({ elements: removed });
    toast(`${res.size} Objekt(e) gestutzt.`, 'success', 2000);
  };

  const onShapeChange = (id: string, pageShape: Shape, commit: boolean) => {
    const shape = roundShape(shapeToMeters(pageShape, k));
    if (!commit) {
      setOverrides((o) => ({ ...o, [id]: shape }));
      return;
    }
    setOverrides(({ [id]: _, ...rest }) => rest);
    const e = data.elements[id];
    // Rechteck/Dreieck mit verschobener, eingefügter oder entfernter Ecke ist danach eine Polylinie
    // (geschlossen = Fläche); eine Linie mit eingefügtem Punkt eine offene Polylinie.
    // Wand, Text/Raumstempel, Bauteil, Maß und Bogen bleiben immer, was sie sind.
    const type = e && !KEEP_TYPE.has(e.type) && shape.type === 'freehand' ? 'freehand' : e?.type;
    // Text/Raumstempel: Breite folgt der Schrifthöhe (Mitte bleibt)
    const fixed = e?.type === 'text' ? (() => {
      const w = textBoxWidth(e, shape.h, e.font);
      return roundShape({ ...shape, x: shape.x + (shape.w - w) / 2, w });
    })() : shape;
    if (e && type && JSON.stringify(e.shape) !== JSON.stringify(fixed)) putRecord('elements', { ...e, type, shape: fixed });
  };

  const textHeightNow = () => {
    const pxPerM = (viewer.current?.scale() ?? 1) * k;
    return Math.max(0.05, Math.round(22 / pxPerM / 0.05) * 0.05);
  };

  /** Werkzeug „Text“: Stelle angetippt */
  const onPlace = async (p: Point) => {
    if (tool === 'guide') return guidePoint({ x: p.x / k, y: p.y / k });
    if (tool === 'hatch') return hatchAt({ x: p.x / k, y: p.y / k });
    if (tool === 'room') return roomAt({ x: p.x / k, y: p.y / k });
    if (tool === 'fillet') return filletPoint({ x: p.x / k, y: p.y / k });
    if (tool === 'distance') return distancePoint({ x: p.x / k, y: p.y / k });
    if (TRANSFORM_TOOLS.has(tool)) {
      transformPoint({ x: p.x / k, y: p.y / k });
      return;
    }
    if (tool === 'symbol') {
      const sh = symbolPlacement({ x: p.x / k, y: p.y / k });
      if (sh) create('symbol', sh, { symbol: { id: symbolId } }, true);
      return;
    }
    if (tool === 'array' && arrayPolar) {
      runArrayAt(arrayPolar, { x: p.x / k, y: p.y / k });
      return;
    }
    if (tool === 'offset') {
      const pm = { x: p.x / k, y: p.y / k };
      if (!offsetSrc) {
        // Objekt unter dem Finger (Kante in der Nähe)
        const tol = (isCoarse() ? 18 : 10) / ((viewer.current?.scale() ?? 1) * k);
        let best: { id: string; d: number } | null = null;
        for (const e of stored) {
          if (e.type === 'text' || e.type === 'dimension' || e.type === 'symbol' || !canOffset(e.shape)) continue;
          const d = distanceToShape(e.shape, pm);
          if (d <= tol && (!best || d < best.d)) best = { id: e.id, d };
        }
        if (!best) {
          toast('Bitte eine Linie oder Kante antippen.', 'info', 2500);
          return;
        }
        setOffsetSrc(best.id);
        setSelectedId(best.id);
        return;
      }
      runOffset(pm);
      return;
    }
    if (tool === 'trim' || tool === 'extend') {
      trimOrExtend(p);
      return;
    }
    if (tool !== 'text') return;
    const r = await askNewText();
    if (!r) return;
    create('text', textShape({ x: p.x / k, y: p.y / k }, r.text, textHeightNow() * r.scale, r.font), { text: r.text, color: r.color, font: r.font });
  };

  /** Neuer Text: Dialog mit der zuletzt benutzten Schrift und Farbe (wird gemerkt) */
  const askNewText = async () => {
    const lastFont = (() => {
      try {
        return JSON.parse(pref('textFont', '{}')) as TextFont;
      } catch {
        return {};
      }
    })();
    const r = await textDialog({ title: 'Text einfügen', confirmLabel: 'Einfügen', color: pref('textColor', DRAW_DEFAULT_COLOR), font: cleanFont(lastFont) });
    if (!r || !r.text.trim()) return null;
    storePref('textFont', JSON.stringify(r.font ?? {}));
    storePref('textColor', r.color);
    return { ...r, text: r.text.trim(), font: cleanFont(r.font) };
  };

  /** Aufmaß: Text an der angetippten Stelle (Seitenkoordinaten) einfügen – Werkzeug und Auswahl des Zeichenmodus bleiben */
  const placeText = async (p: Point) => {
    if (!plan) return false;
    const r = await askNewText();
    if (!r) return false;
    const rec: DrawElement = {
      ...newMeta(),
      projectId: plan.projectId,
      planId: plan.id,
      type: 'text',
      shape: roundShape(textShape({ x: p.x / k, y: p.y / k }, r.text, textHeightNow() * r.scale, r.font)),
      color: r.color,
      text: r.text,
      ...(r.font ? { font: r.font } : {}),
    };
    putRecord('elements', rec);
    return true;
  };

  /** Aufmaß: angetippten Text bearbeiten (Text, Schrift, Farbe, Größe) oder löschen */
  const editText = async (id: string) => {
    const e = data.elements[id];
    if (!e || e.type !== 'text') return;
    const r = await textDialog({ title: 'Text bearbeiten', text: e.text, color: e.color, font: e.font, canDelete: true, canResize: true });
    if (!r) return;
    if (r.remove) {
      softDelete({ elements: [e] });
      return;
    }
    const font = cleanFont(r.font);
    const h = roundM(e.shape.h * r.scale);
    const { font: _f, ...rest } = e;
    putRecord('elements', { ...rest, ...(font ? { font } : {}), text: r.text.trim(), color: r.color, shape: { ...e.shape, h, w: textBoxWidth({ ...e, text: r.text.trim() }, h, font) } });
  };

  /** Aufmaß: Text verschieben (Verschiebung in Seitenkoordinaten); commit speichert */
  const moveText = (id: string, dx: number, dy: number, commit: boolean) => {
    const e = data.elements[id];
    if (!e) return;
    const shape = { ...e.shape, x: roundM(e.shape.x + dx / k), y: roundM(e.shape.y + dy / k) };
    if (!commit) {
      setOverrides((o) => ({ ...o, [id]: shape }));
      return;
    }
    setOverrides(({ [id]: _, ...rest }) => rest);
    if (dx || dy) putRecord('elements', { ...e, shape });
  };

  /** Aufmaß: Texte zum Antippen/Verschieben (Seitenkoordinaten) */
  const textNotes = useMemo(() => elements.filter((e) => e.type === 'text').map((e) => ({ id: e.id, shape: shapeToPage(e.shape, k) })), [elements, k]);

  /** Aufmaß auf importierten Plänen: nur die Texte über dem Plan */
  const textUnderlay = (view: View) => (
    <>
      {elements
        .filter((e) => e.type === 'text')
        .map((e) => (
          <g key={e.id}>{renderElement(e, shapeToPage(e.shape, k), view, false, false, k, [], hatchUnit)}</g>
        ))}
    </>
  );

  /** Einfügen über die Maßeingabe (Position: Mitte der Ansicht bzw. Ende der letzten Linie) */
  const insert = (m: Measures, apex: Apex) => {
    const c = viewer.current?.center();
    const center = c ? { x: c.x / k, y: c.y / k } : { x: 1, y: 1 };
    const grid = (p: Point) => snapToGrid(p, 0.05);
    if (tool === 'line' && m.length) create('line', lineFromMeasures(lastLineEnd ?? grid(center), m.length, m.angle ?? 0), {}, true);
    else if (tool === 'rect' && m.length && m.width) create('rect', rectFromMeasures(grid({ x: center.x - m.length / 2, y: center.y - m.width / 2 }), m.length, m.width));
    else if (tool === 'ellipse' && m.diameter) create('ellipse', circleFromMeasures(grid(center), m.diameter));
    else if (tool === 'triangle' && m.base && m.height)
      create('triangle', triangleFromMeasures(grid({ x: center.x - m.base / 2, y: center.y - m.height / 2 }), m.base, m.height, apex));
  };

  const apply = (id: string, m: Measures) => {
    const e = data.elements[id];
    if (!e) return;
    putRecord('elements', { ...e, shape: applyMeasures(e, m) });
  };

  const setText = (id: string, text: string) => {
    const e = data.elements[id];
    if (!e) return;
    const w = textBoxWidth({ ...e, text }, e.shape.h, e.font);
    // Raumstempel bleibt mittig stehen, Text wächst nach rechts
    putRecord('elements', { ...e, text, shape: { ...e.shape, w, ...(e.room ? { x: roundM(e.shape.x + (e.shape.w - w) / 2) } : {}) } });
  };

  /** Schrift eines Textes ändern (Breite folgt) */
  const setFont = (id: string, font: TextFont | undefined) => {
    const e = data.elements[id];
    if (!e) return;
    const { font: _f, ...rest } = e;
    const f = cleanFont(font);
    if (f) storePref('textFont', JSON.stringify(f));
    const w = textBoxWidth(e, e.shape.h, f);
    putRecord('elements', { ...rest, ...(f ? { font: f } : {}), shape: { ...e.shape, w, ...(e.room ? { x: roundM(e.shape.x + (e.shape.w - w) / 2) } : {}) } });
  };

  /** Ausgewählten Eckpunkt entfernen bzw. Polylinie öffnen/schließen */
  const changeVertices = (id: string, change: (s: Shape) => Shape | null) => {
    const e = data.elements[id];
    const next = e ? change(e.shape) : null;
    if (!e || !next) return false;
    putRecord('elements', { ...e, type: e.type === 'wall' ? 'wall' : 'freehand', shape: roundShape(next) });
    return true;
  };
  const removeSelectedVertex = () => {
    if (!selectedId || vertex === null) return false;
    const ok = changeVertices(selectedId, (s) => removeVertex(s, vertex));
    if (ok) setVertex(null);
    return ok;
  };
  const setClosed = (id: string, closed: boolean) => changeVertices(id, (s) => setPolylineClosed(s, closed));

  const setShowDims = (id: string, show: boolean) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, showDims: show });
  };
  /** Fenster: Höhe und Rohbauparapethöhe (ÖNORM-Beschriftung) */
  const setOpening = (id: string, patch: { height?: number | null; sill?: number | null }) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, opening: { ...e.opening, ...patch } });
  };

  const recolor = (id: string, c: string) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, color: c });
  };

  /** Darstellung bzw. Farbe aller ausgewählten Objekte (Linien/Formen) ändern – ein Rückgängig-Schritt */
  const restyleMany = (patch: Partial<ShapeStyle>) => {
    const list = selection.filter((e) => e.type !== 'text' && e.type !== 'dimension').map((e) => data.elements[e.id]);
    if (list.length) putRecords({ elements: list.map((e) => ({ ...e, style: { ...e.style, ...patch } })) });
  };
  const recolorMany = (c: string) => {
    const list = selection.map((e) => data.elements[e.id]);
    if (list.length) putRecords({ elements: list.map((e) => ({ ...e, color: c })) });
  };

  /** Darstellung nur dieses Objekts ändern – Geometrie und Maße bleiben unverändert */
  const restyle = (id: string, patch: Partial<ShapeStyle>) => {
    const e = data.elements[id];
    if (e) putRecord('elements', { ...e, style: { ...e.style, ...patch } });
  };

  /** Messungen, deren Markierung das Objekt überlappt */
  const overlapping = (e: DrawElement) => {
    const r = shapeAABB(shapeToPage(e.shape, k));
    const grown: Rect = { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 };
    return damages.filter((d) => rectsOverlap(grown, shapeAABB(d.shape)));
  };

  const remove = async (e: DrawElement) => {
    const over = overlapping(e);
    if (over.length) {
      const ok = await confirmDialog({
        title: `${elementLabel(e)} löschen?`,
        message: (
          <p>
            Auf diesem Objekt liegen <strong>{over.length} Messung(en)</strong> (Nr. {over.map((d) => damageNo(d)).join(', ')}). Die Messungen und
            ihre Maße bleiben erhalten – nur das Zeichnungsobjekt wird entfernt. Mit „Rückgängig“ lässt es sich wiederherstellen.
          </p>
        ),
        confirmLabel: 'Objekt löschen',
        danger: true,
      });
      if (!ok) return;
    }
    softDelete({ elements: [data.elements[e.id]] });
    if (selectedId === e.id) setSelectedId(null);
    toast(`${elementLabel(e)} gelöscht.`, 'info', 2000);
  };

  // -------------------------------------------------------------------------
  // Darstellung

  const renderItem = (item: ViewerItem, view: View, sel: boolean): ReactNode => {
    const e = byId.get(item.id);
    return e ? renderElement(e, item.shape, view, sel || selSet.has(e.id), false, k, openingsPage, hatchUnit) : null;
  };

  /** Planbearbeitung: nur die Zeichenfläche mit Raster – Messungen gehören ins Aufmaß und werden hier nicht gezeigt */
  const drawUnderlay = (region: Rect) => (view: View, size: { w: number; h: number }) => (
    <>
      {renderSheet(view, size, region, k, true, true)}
    </>
  );

  /** Aufmaß: Zeichnung als ruhender Hintergrund mit Maßen */
  /** sheet: Blatt des gewählten Formats (wie im PDF) – sonst unbegrenzte weiße Fläche */
  const measureUnderlay = (region: Rect, sheet = false) => (view: View, size: { w: number; h: number }) => (
    <>
      {renderSheet(view, size, region, k, false, !sheet)}
      {elements.map((e) => (
        <g key={e.id}>{renderElement(e, shapeToPage(e.shape, k), view, false, false, k, openingsPage, hatchUnit)}</g>
      ))}
      {showDims && renderDims(view, elements, k, { color: '#5b6b80' })}
    </>
  );

  const drawOverlay = (view: View, preview: Shape | null, hover: Point | null = null) => {
    const previewType: DrawElementType | null = DRAW_SHAPE_TOOLS.has(tool) ? (tool as DrawElementType) : null;
    // Kopieren/Verschieben/Strecken: Vorschau des Ergebnisses (gestrichelt)
    let ghost: ReactNode = null;
    // Vektor: gezogen (preview) bzw. Klick-Klick vom Basispunkt zur Maus
    const vec = preview && (VECTOR_COMMANDS.has(tool) || (tool === 'stretch' && stretchWin)) ? lineEnds(shapeToMeters(preview, k)) : VECTOR_COMMANDS.has(tool) && cmdBase && hover ? [{ x: cmdBase.x / k, y: cmdBase.y / k }, { x: hover.x / k, y: hover.y / k }] : null;
    if (vec && !(VECTOR_COMMANDS.has(tool) && cmdSelecting)) {
      const [a, b] = vec;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const targets =
        tool === 'stretch'
          ? stored.map((e) => stretchShape(e.shape, stretchWin!, dx, dy)).filter((x): x is Shape => !!x)
          : tool === 'mirror'
            ? Math.hypot(dx, dy) > 1e-9
              ? selection.map((e) => mirrorShape(e.shape, a, b, e.type === 'text'))
              : []
            : selection.map((e) => translateShape(e.shape, dx, dy));
      ghost = (
        <g className="cad-ghost" data-testid="cad-ghost">
          {targets.map((t, i) => (
            <path key={i} d={pathToSvg(shapePath(shapeToPage(t, k)), (p) => toScreen(view, p))} />
          ))}
        </g>
      );
    }
    // Drehen/Skalieren/Ausrichten: Vorschau und Wert an der Maus, angetippte Punkte markiert
    let transformLabel: ReactNode = null;
    if (TRANSFORM_TOOLS.has(tool) && !cmdSelecting && pickPts.length) {
      const hm = hover ? { x: hover.x / k, y: hover.y / k } : null;
      let shapes: Shape[] = [];
      let label = '';
      if (hm && tool === 'rotate' && (!refMode || pickPts.length === 3)) {
        const deg = stepAngle(angleCcw(pickPts[0], hm)) - (refMode ? angleCcw(pickPts[1], pickPts[2]) : 0);
        shapes = selection.map((e) => rotateAround(e.shape, pickPts[0], deg, true));
        label = `${String(Math.round(deg * 10) / 10).replace('.', ',')}°`;
      } else if (hm && tool === 'scale' && refMode && pickPts.length === 3) {
        const f = dist2(pickPts[1], hm) / (dist2(pickPts[1], pickPts[2]) || 1);
        shapes = selection.map((e) => scaleAbout(e.shape, pickPts[0], f)).filter((x): x is Shape => !!x);
        label = `${formatMeasure(dist2(pickPts[1], hm))} m · ×${formatFactor(Math.round(f * 1000) / 1000)}`;
      } else if (hm && tool === 'align' && pickPts.length === 3) {
        const deg = angleCcw(pickPts[2], hm) - angleCcw(pickPts[0], pickPts[1]);
        shapes = selection.map((e) => {
          const r = rotateAround(e.shape, pickPts[0], deg, true);
          return alignMove ? translateShape(r, pickPts[2].x - pickPts[0].x, pickPts[2].y - pickPts[0].y) : r;
        });
      }
      ghost = (
        <g className="cad-ghost" data-testid="cad-ghost">
          {shapes.map((sh, i) => (
            <path key={i} d={pathToSvg(shapePath(shapeToPage(sh, k)), (q) => toScreen(view, q))} />
          ))}
          {pickPts.map((q, i) => {
            const sq = toScreen(view, { x: q.x * k, y: q.y * k });
            return <circle key={`p${i}`} cx={sq.x} cy={sq.y} r={5} className="poly-point" data-testid="pick-point" />;
          })}
        </g>
      );
      if (label && hover) {
        const sh = toScreen(view, hover);
        transformLabel = (
          <text x={sh.x + 14} y={sh.y - 10} className="transform-label" data-testid="transform-label">
            {label}
          </text>
        );
      }
    }
    // Bauteil: Vorschau an der Maus (ausgerichtet wie beim Einsetzen)
    if (tool === 'symbol' && hover) {
      const sh = symbolPlacement({ x: hover.x / k, y: hover.y / k });
      if (sh) {
        const geo = symbolGeometry({ id: symbolId }, shapeToPage(sh, k));
        ghost = (
          <g className="cad-ghost" data-testid="cad-ghost">
            {geo.lines.map((l, i) => (
              <path key={i} d={l.pts.map((q, j) => `${j ? 'L' : 'M'}${toScreen(view, q).x} ${toScreen(view, q).y}`).join('') + (l.closed ? 'Z' : '')} />
            ))}
          </g>
        );
      }
    }
    // Reihe (polar): Vorschau um den Mittelpunkt an der Maus
    if (tool === 'array' && arrayPolar && hover) {
      const c = { x: hover.x / k, y: hover.y / k };
      ghost = (
        <g className="cad-ghost" data-testid="cad-ghost">
          {polarAngles(arrayPolar.count, arrayPolar.total).flatMap((a) =>
            selection.map((e) => <path key={`${a}-${e.id}`} d={pathToSvg(shapePath(shapeToPage(rotateAround(e.shape, c, a, arrayPolar.rotate), k)), (q) => toScreen(view, q))} />),
          )}
        </g>
      );
    }
    // Versetzen: Vorschau der parallelen Kopie an der Maus
    if (tool === 'offset' && offsetSrc && hover && byId.get(offsetSrc)) {
      const src = byId.get(offsetSrc)!;
      const hm = { x: hover.x / k, y: hover.y / k };
      const sh = offsetShape(src.shape, offsetThrough ? distanceToShape(src.shape, hm) : offsetDist, hm);
      if (sh)
        ghost = (
          <g className="cad-ghost" data-testid="cad-ghost">
            <path d={pathToSvg(shapePath(shapeToPage(sh, k)), (p) => toScreen(view, p))} />
          </g>
        );
    }
    return (
      <>
        {showDims && renderDims(view, elements, k)}
        {renderPreviewDims(view, preview, previewType, k)}
        {/* Mehrfachauswahl: jedes ausgewählte Objekt blau umrandet */}
        {selection.length > 1 && (
          <g className="multi-sel" data-testid="multi-sel">
            {selection.map((e) => (
              <path key={e.id} d={pathToSvg(shapePath(shapeToPage(e.shape, k)), (p) => toScreen(view, p))} />
            ))}
          </g>
        )}
        {/* Auswahlfenster: nach rechts = durchgezogen (ganz enthalten), nach links = gestrichelt (berührt) */}
        {preview && (tool === 'selwin' || (VECTOR_COMMANDS.has(tool) && cmdSelecting)) && (() => {
          const [a, b] = lineEnds(preview);
          const p = toScreen(view, a);
          const q = toScreen(view, b);
          return <rect className={`sel-window${q.x < p.x ? ' crossing' : ''}`} data-testid="sel-window" x={Math.min(p.x, q.x)} y={Math.min(p.y, q.y)} width={Math.abs(q.x - p.x)} height={Math.abs(q.y - p.y)} />;
        })()}
        {stretchWin && (
          <path
            className="cad-window"
            data-testid="stretch-window"
            d={pathToSvg(shapePath(shapeToPage({ type: 'rect', ...stretchWin }, k)), (p) => toScreen(view, p))}
          />
        )}
        {guidesOn && guides.length > 0 && (
          <g className="guide-lines" data-testid="guide-lines">
            {guides.map((g) => {
              const [u, v] = guideSeg(g).map((q) => toScreen(view, { x: q.x * k, y: q.y * k }));
              return <path key={g.id} d={`M${u.x} ${u.y}L${v.x} ${v.y}`} className="guide-line" data-testid="guide-line" data-angle={g.angle} />;
            })}
          </g>
        )}
        {tool === 'guide' && !guideErase && hover && (() => {
          const hm = { x: hover.x / k, y: hover.y / k };
          const g = guideAngle !== 'free' ? { x: hm.x, y: hm.y, angle: Number(guideAngle) || 0 } : pickPts[0] && dist2(pickPts[0], hm) > 1e-9 ? { ...pickPts[0], angle: angleCcw(pickPts[0], hm) } : null;
          if (!g) return null;
          const [u, v] = guideSeg(g).map((q) => toScreen(view, { x: q.x * k, y: q.y * k }));
          return <path d={`M${u.x} ${u.y}L${v.x} ${v.y}`} className="guide-line guide-preview" data-testid="guide-preview" />;
        })()}
        {tool === 'guide' &&
          pickPts.map((q, i) => {
            const sq = toScreen(view, { x: q.x * k, y: q.y * k });
            return <circle key={`gp${i}`} cx={sq.x} cy={sq.y} r={5} className="poly-point" data-testid="pick-point" />;
          })}
        {track.current.par && (() => {
          const { from, to } = track.current.par;
          const a2 = toScreen(view, { x: from.x * k, y: from.y * k });
          const b2 = toScreen(view, { x: to.x * k, y: to.y * k });
          const l = Math.hypot(b2.x - a2.x, b2.y - a2.y) || 1;
          const ex = ((b2.x - a2.x) / l) * 4000;
          const ey = ((b2.y - a2.y) / l) * 4000;
          const edge = track.current.edge;
          const e1 = edge && toScreen(view, { x: edge[0].x * k, y: edge[0].y * k });
          const e2 = edge && toScreen(view, { x: edge[1].x * k, y: edge[1].y * k });
          return (
            <g className="parallel-hint" data-testid="parallel-hint">
              <path d={`M${a2.x - ex} ${a2.y - ey}L${a2.x + ex} ${a2.y + ey}`} className="track-line" />
              {e1 && e2 && <path d={`M${e1.x} ${e1.y}L${e2.x} ${e2.y}`} className="parallel-edge" />}
            </g>
          );
        })()}
        {tool === 'distance' && (
          <g className="dist-overlay" data-testid="dist-overlay">
            {distPicks.map((pk, i) => {
              const sq = toScreen(view, { x: pk.point.x * k, y: pk.point.y * k });
              return <circle key={i} cx={sq.x} cy={sq.y} r={4.5} className="poly-point" data-testid="pick-point" />;
            })}
            {distRes && (() => {
              const a2 = toScreen(view, { x: distRes.p.x * k, y: distRes.p.y * k });
              const b2 = toScreen(view, { x: distRes.q.x * k, y: distRes.q.y * k });
              return (
                <>
                  <path d={`M${a2.x} ${a2.y}L${b2.x} ${b2.y}`} className="dist-line" data-testid="dist-line" />
                  <text x={(a2.x + b2.x) / 2 + 8} y={(a2.y + b2.y) / 2 - 8} className="transform-label" data-testid="distance-label">
                    {formatMeasure(distRes.d)} m
                  </text>
                </>
              );
            })()}
          </g>
        )}
        {ghost}
        {transformLabel}
        {trackOn && snapOn && tool !== 'select' && (
          <g className="track-lines" data-testid="track-lines">
            {track.current.acquired.map((a, i) => {
              const s2 = toScreen(view, { x: a.x * k, y: a.y * k });
              return <path key={`a${i}`} d={`M${s2.x - 4} ${s2.y}H${s2.x + 4}M${s2.x} ${s2.y - 4}V${s2.y + 4}`} className="track-acquired" />;
            })}
            {track.current.lines.map((l, i) => {
              const s2 = toScreen(view, { x: l.from.x * k, y: l.from.y * k });
              return <path key={`l${i}`} d={l.axis === 'h' ? `M-20000 ${s2.y}H20000` : `M${s2.x} -20000V20000`} className="track-line" data-testid="track-line" data-axis={l.axis} />;
            })}
          </g>
        )}
      </>
    );
  };

  const resetOverrides = () => setOverrides({});

  return {
    k,
    tool,
    setTool,
    color,
    setColor,
    snapOn,
    setSnapOn,
    gridOn,
    setGridOn,
    orthoOn,
    trackOn,
    setTrackOn,
    onDimension,
    setExtGap,
    formatLength,
    setOrthoOn,
    orthoDir,
    setOrthoDir,
    elements,
    allElements: allStored,
    items,
    selected,
    selectedId,
    setSelectedId,
    selection,
    select,
    selectAll,
    clearSelection,
    multi,
    setMulti,
    cmdSelecting,
    setCmdSelecting,
    cmdBase,
    setCmdBase,
    copies,
    onHover: (p: Point | null) => void (hoverRef.current = p),
    applyInput,
    finishCommand,
    tipText,
    removeSelection,
    runJoin,
    cmdNext,
    offsetSrc,
    offsetDist,
    offsetThrough,
    setOffsetThrough,
    mirrorKeep,
    setMirrorKeep,
    joinTol,
    arrayPolar,
    symbolId,
    symbolSize,
    pickPts,
    refMode,
    setRefMode: (on: boolean) => {
      setRefMode(on);
      setPickPts((p) => p.slice(0, 1));
    },
    rotStep,
    setRotStep,
    polyNext,
    hatchSet,
    pickHatch,
    editRoom,
    guides,
    guidesOn,
    setGuidesOn,
    guideAngle,
    setGuideAngle,
    guideErase,
    setGuideErase: (on: boolean) => {
      setGuideErase(on);
      setPickPts([]);
    },
    clearGuides,
    filletR,
    filletSrc,
    distPicks,
    distRes,
    distToDimension,
    snapCfg,
    setSnapCfg,
    alignMove,
    setAlignMove,
    wallThickness,
    wallHeight,
    /** Länge eines Abschnitts (Knick zu Knick) einer Polylinie, Fläche bzw. Wand ändern */
    setSegment: (id: string, i: number, len: number) => {
      const e = data.elements[id];
      if (!e) return;
      const closed = !isOpenShape(e.shape);
      const pts = setSegmentLength(shapeVertices(e.shape), closed, i, len);
      if (!pts) return;
      const shape = e.shape.type === 'line' && pts.length === 2 ? lineShape(pts[0], pts[1]) : shapeFromVertices({ type: 'freehand', x: 0, y: 0, w: 0, h: 0, closed }, pts);
      putRecord('elements', { ...e, shape: roundShape(shape) });
    },
    setWall: (id: string, patch: Partial<NonNullable<DrawElement['wall']>>) => {
      const e = data.elements[id];
      if (e?.wall) putRecord('elements', { ...e, wall: { ...e.wall, ...patch } });
    },
    pickSymbol,
    flipSymbol,
    viewerTool,
    stretchWin,
    transformSelected,
    vertex,
    setVertex,
    removeSelectedVertex,
    canRemoveVertex: !!selected && vertex !== null && removeVertex(selected.shape, vertex) !== null,
    setClosed,
    lastLineEnd,
    snap,
    onCreate,
    onShapeChange,
    onPlace: (p: Point) => void onPlace(p),
    insert,
    apply,
    setText,
    setShowDims,
    setOpening,
    recolor,
    restyle,
    restyleMany,
    recolorMany,
    defaultStyle,
    setDefaultStyle,
    overlapping,
    remove,
    renderItem,
    onFence,
    drawUnderlay,
    measureUnderlay,
    textUnderlay,
    textNotes,
    placeText,
    editText,
    moveText,
    setFont,
    drawOverlay,
    resetOverrides,
  };
}
