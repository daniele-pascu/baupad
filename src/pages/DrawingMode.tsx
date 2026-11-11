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
  textShape,
  textWidth,
  triangleFromMeasures,
  unitsPerMeter,
  type Apex,
  type Measures,
} from '../lib/drawing';
import { type OrthoDir, extendLine, ORTHO_DIRS, orthoPoint, rotateShapeBy, scaleShape, stretchShape, translateShape, trimByFence, trimShape } from '../lib/cad';
import { edgesOf, findSnap, segmentIntersection, type SnapKind } from '../lib/snap';
import { inputVector, parseCadInput, vectorInfo } from '../lib/cad-input';
import { arrayOffsets, canOffset, distanceToShape, joinShapes, mirrorShape, offsetShape, polarAngles, rotateAround, type ArrayParams } from '../lib/cad-ops';
import { arrayDialog } from '../components/ArrayDialog';
import { symbolPicker } from '../components/SymbolPicker';
import { symbolDef, symbolGeometry, type SymbolGroup } from '../lib/symbols';
import { wallOpenings } from '../lib/walls';
import { dimsVisible, visibleDamages, visibleElements } from '../lib/layers';
import { distToSegment, isOpenShape, lineShape, pathToSvg, rectsOverlap, removeVertex, setPolylineClosed, shapeAABB, shapePath, toScreen, type Point, type View } from '../lib/geometry';
import { newMeta, putRecord, putRecords, softDelete, type ProjectState } from '../lib/store';
import type { Damage, DrawElement, DrawElementType, Plan, Rect, Shape, ShapeStyle, TextFont } from '../lib/types';

/** Werkzeuge der Planbearbeitung (selbst gezeichnete Pläne) */
/** Gruppen der Werkzeugleiste (wie in CAD-Programmen) */
export type ToolGroup = 'select' | 'draw' | 'annotate' | 'modify';

/** Werkzeuge des Zeichenmodus: Zeichnen sowie Ändern (Kopieren, Verschieben, Strecken …) */
export type DrawTool = Tool | 'copy' | 'move' | 'stretch' | 'join' | 'offset' | 'mirror' | 'array' | 'symbol';

/** Befehle, die ausgewählte Objekte brauchen (ohne Auswahl fragen sie zuerst danach) */
export const NEEDS_SELECTION = new Set<DrawTool>(['copy', 'move']);
/** Befehle mit Basispunkt → Zielpunkt bzw. Eingabe im Befehlsfeld */
export const VECTOR_COMMANDS = new Set<DrawTool>(['copy', 'move', 'mirror']);
/** Befehle, die zuerst Objekte brauchen (ohne Auswahl: wählen, dann „Weiter“) */
export const SELECT_FIRST = new Set<DrawTool>(['copy', 'move', 'mirror', 'join', 'array']);

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
  { id: 'mirror', label: 'Spiegeln: Objekte an einer Achse aus zwei Punkten spiegeln – Original behalten oder löschen', short: 'Spiegeln', icon: 'mirror', key: 'i', group: 'modify' },
  { id: 'offset', label: 'Versetzen: parallele Kopie im Abstand – Objekt antippen, dann die Seite (Wandstärke, parallele Linien, Rechteck nach innen/außen)', short: 'Versetzen', icon: 'offset', key: 'o', group: 'modify' },
  { id: 'wall', label: 'Wand: Achse Punkt für Punkt setzen (Enter bzw. „Fertig“ beendet) – Wandstärke eingeben; Türen und Fenster schneiden die Öffnung aus', short: 'Wand', icon: 'wall', key: 'y', group: 'draw' },
  { id: 'symbol', label: 'Bauteil einsetzen: Tür, Fenster, Elektro – Stelle antippen', short: 'Bauteil', icon: 'door', key: 'u', group: 'draw' },
  { id: 'array', label: 'Reihe: ausgewählte Objekte rechteckig (Spalten × Zeilen), linear oder im Kreis mehrfach anordnen', short: 'Reihe', icon: 'array', key: 'a', group: 'modify' },
  { id: 'join', label: 'Verbinden: Linien, Polylinien und Bögen an gemeinsamen Endpunkten zu einer Linie bzw. geschlossenen Fläche verbinden – kleine Lücken werden geschlossen', short: 'Verbinden', icon: 'join', key: 'j', group: 'modify' },
  { id: 'trim', label: 'Stutzen: Abschnitt bis zu den nächsten Kanten bzw. Eckpunkten entfernen – anklicken oder frei über mehrere Linien ziehen (Zaun)', short: 'Stutzen', icon: 'trim', key: 'z', group: 'modify' },
  { id: 'extend', label: 'Verlängern: Linie bis zur nächsten Kante verlängern', short: 'Verlängern', icon: 'extend', key: 'e', group: 'modify' },
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
  /** angefahrene Fangpunkte (zuletzt bis zu 4) und aktuelle Spurlinien – nur für die Anzeige */
  const track = useRef<{ acquired: Point[]; lines: { from: Point; axis: 'h' | 'v' }[] }>({ acquired: [], lines: [] });
  /** Ende der zuletzt eingefügten Linie – die nächste Linie schließt dort an (Wände) */
  const [lastLineEnd, setLastLineEnd] = useState<Point | null>(null);

  const setTool = (t: DrawTool) => {
    setToolState(t);
    setStretchWin(null);
    setCmdBase(null);
    setCopies(0);
    setArrayPolar(null);
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
  const viewerTool: Tool = tool === 'symbol' ? 'pick' : tool === 'array' && arrayPolar ? 'pick' : SELECT_FIRST.has(tool) && cmdSelecting ? 'selwin' : VECTOR_COMMANDS.has(tool) ? 'vector' : tool === 'offset' ? 'pick' : tool === 'stretch' ? (stretchWin ? 'vector' : 'window') : (tool as Tool);
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

  const allStored = useMemo(() => (plan ? elementsOf(data, plan.id) : []), [data, plan]);
  // Ausgeblendete Ebenen: nicht sichtbar, nicht fang-, auswähl- oder veränderbar
  const stored = useMemo(() => visibleElements(plan, allStored), [plan, allStored]);
  const showDims = dimsVisible(plan);
  const shownDamages = visibleDamages(plan, damages);
  const elements = useMemo(() => stored.map((e) => (overrides[e.id] ? { ...e, shape: overrides[e.id] } : e)), [stored, overrides]);
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const items: ViewerItem[] = useMemo(
    () => elements.map((e) => ({ id: e.id, number: 0, shape: shapeToPage(e.shape, k), color: e.color, labelOffset: null, noVertexEdit: e.type === 'arc' })),
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
    track.current.lines = [];
    if (ctx.tool === 'selwin') return p;
    if (!snapOn && !gridOn && !orthoOn) return p;
    const pm = { x: p.x / k, y: p.y / k };
    const pxPerM = ctx.scale * k;
    const tol = (isCoarse() ? 16 : 9) / pxPerM;
    // Fangpunkte: End-/Eckpunkte, Schnittpunkte, Mittelpunkte, nächster Punkt auf Linien
    const others = stored.filter((e) => e.id !== ctx.movingId && e.type !== 'text').map((e) => e.shape);
    const hit = snapOn ? findSnap(pm, others, tol) : null;
    let q: Point = pm;
    let kind: SnapKind | undefined;
    if (orthoOn && ctx.from && ctx.tool && ORTHO_TOOLS.has(ctx.tool)) {
      // 90°: vom letzten Punkt nur waagrecht oder senkrecht; ein Fangpunkt bestimmt nur die
      // Länge (Projektion auf die Achse) – der rechte Winkel bleibt immer exakt
      const from = { x: ctx.from.x / k, y: ctx.from.y / k };
      const target = hit ? hit.point : pm;
      const o = orthoPoint(from, target, orthoDir);
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
    if (trackOn && snapOn && hit && hit.kind !== 'nearest' && hit.kind !== 'grid') {
      const acq = track.current.acquired.filter((a) => Math.hypot(a.x - hit.point.x, a.y - hit.point.y) > 1e-6);
      track.current.acquired = [...acq, hit.point].slice(-4);
    }
    if (trackOn && snapOn && (!hit || hit.kind === 'nearest')) {
      const refs = [...track.current.acquired, ...(ctx.from ? [{ x: ctx.from.x / k, y: ctx.from.y / k }] : [])];
      let h: Point | null = null;
      let v: Point | null = null;
      for (const r of refs) {
        if (Math.abs(pm.y - r.y) < tol && (!h || Math.abs(pm.y - r.y) < Math.abs(pm.y - h.y))) h = r;
        if (Math.abs(pm.x - r.x) < tol && (!v || Math.abs(pm.x - r.x) < Math.abs(pm.x - v.x))) v = r;
      }
      if (h || v) {
        q = { x: v ? v.x : pm.x, y: h ? h.y : pm.y };
        track.current.lines = [...(h ? [{ from: h, axis: 'h' as const }] : []), ...(v ? [{ from: v, axis: 'v' as const }] : [])];
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
    if (def.group === 'door' || def.group === 'window') {
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
        // Tür: Öffnungslinie (unten im Symbol) auf der Linie → Mitte um h/2 nach „oben“ (im Symbol) versetzt
        const up = def.group === 'door' ? h / 2 : 0;
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
    if (axis === 'y' && symbolDef(e.symbol.id)?.group === 'door') {
      const dy = next ? e.shape.h : -e.shape.h;
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
    if (e.type === 'text' && kind === 'scale') shape = { ...shape, w: textWidth(e.text ?? '', shape.h, e.font) };
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
    // (geschlossen = Fläche); eine Linie mit eingefügtem Punkt eine offene Polylinie
    const type = e && e.type !== 'dimension' && e.type !== 'arc' && shape.type === 'freehand' ? 'freehand' : e?.type;
    if (e && type && JSON.stringify(e.shape) !== JSON.stringify(shape)) putRecord('elements', { ...e, type, shape });
  };

  const textHeightNow = () => {
    const pxPerM = (viewer.current?.scale() ?? 1) * k;
    return Math.max(0.05, Math.round(22 / pxPerM / 0.05) * 0.05);
  };

  /** Werkzeug „Text“: Stelle angetippt */
  const onPlace = async (p: Point) => {
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
    putRecord('elements', { ...rest, ...(font ? { font } : {}), text: r.text.trim(), color: r.color, shape: { ...e.shape, h, w: textWidth(r.text.trim(), h, font) } });
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
          <g key={e.id}>{renderElement(e, shapeToPage(e.shape, k), view, false, false, k)}</g>
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
    putRecord('elements', { ...e, text, shape: { ...e.shape, w: textWidth(text, e.shape.h, e.font) } });
  };

  /** Schrift eines Textes ändern (Breite folgt) */
  const setFont = (id: string, font: TextFont | undefined) => {
    const e = data.elements[id];
    if (!e) return;
    const { font: _f, ...rest } = e;
    const f = cleanFont(font);
    if (f) storePref('textFont', JSON.stringify(f));
    putRecord('elements', { ...rest, ...(f ? { font: f } : {}), shape: { ...e.shape, w: textWidth(e.text ?? '', e.shape.h, f) } });
  };

  /** Ausgewählten Eckpunkt entfernen bzw. Polylinie öffnen/schließen */
  const changeVertices = (id: string, change: (s: Shape) => Shape | null) => {
    const e = data.elements[id];
    const next = e ? change(e.shape) : null;
    if (!e || !next) return false;
    putRecord('elements', { ...e, type: 'freehand', shape: roundShape(next) });
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
    return e ? renderElement(e, item.shape, view, sel || selSet.has(e.id), false, k, openingsPage) : null;
  };

  const markerPaths = (view: View) => (
    <g className="faded-markers" opacity={0.35} key="faded">
      {shownDamages.map((d) => (
        <path key={d.id} d={pathToSvg(shapePath(d.shape), (p) => toScreen(view, p))} fill="none" stroke={d.color} strokeWidth={2} strokeDasharray="5 4" />
      ))}
    </g>
  );

  /** Planbearbeitung: Zeichenfläche mit Raster, Messungen nur blass zur Orientierung */
  const drawUnderlay = (region: Rect) => (view: View, size: { w: number; h: number }) => (
    <>
      {renderSheet(view, size, region, k, true, true)}
      {markerPaths(view)}
    </>
  );

  /** Aufmaß: Zeichnung als ruhender Hintergrund mit Maßen */
  /** sheet: Blatt des gewählten Formats (wie im PDF) – sonst unbegrenzte weiße Fläche */
  const measureUnderlay = (region: Rect, sheet = false) => (view: View, size: { w: number; h: number }) => (
    <>
      {renderSheet(view, size, region, k, false, !sheet)}
      {elements.map((e) => (
        <g key={e.id}>{renderElement(e, shapeToPage(e.shape, k), view, false, false, k, openingsPage)}</g>
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
        {ghost}
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
    wallThickness,
    wallHeight,
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
