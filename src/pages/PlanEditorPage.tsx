import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AufmassTable } from '../components/AufmassTable';
import { DamageDialog, type DamageValues, type Renumber } from '../components/DamageDialog';
import { ElementBar, InsertBar } from '../components/DrawPanel';
import { Icon } from '../components/Icon';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { PlanDetailsDialog } from '../components/PlanFields';
import { PlanViewer, type PlanViewerHandle, type SnapFn, type Tool } from '../components/PlanViewer';
import { SaveErrorBanner, SaveStatus } from '../components/SaveStatus';
import { invoiceLabel, invoiceOfPlan } from '../lib/invoices';
import { confirmDialog, promptDialog, showError, toast } from '../components/ui';
import { costCenterLabel, damagesOf, elementsOf, findPosition, lvDocLabel, lvDocsOf, plansOf, planTitle, positionRef, sumArea } from '../lib/aufmass';
import { calibrationStatus, checkDeviation, checkError, formatCm, formatPercent, geometryMeasures, MAX_ERROR_M, planUnitsPerMeter } from '../lib/calibration';
import { CalibrationReport } from '../components/CalibrationReport';
import { DimensionReview } from '../components/DimensionReview';
import { ExcelExportDialog } from '../components/ExcelExportDialog';
import { calibrationFrom, detectScale, sourceText } from '../lib/scale-detect';
import { visibleDamages } from '../lib/layers';
import { LayerMenu } from '../components/LayerMenu';
import { drawingRegion, drawingSheet, isDrawingPlan, lineEnds, paperLabel, shapeToPage, suggestMeasures, unitsPerMeter } from '../lib/drawing';
import { convertShape, isOpenShape, lineShape, polygonShape, removeVertex, rotatePoint, shapeVertices, toScreen, type Point, type View } from '../lib/geometry';
import { probeTarget, type ProbeKind } from '../lib/probe';
import { ProbeBar, ProbeMenu, ProbeOverlay, type ProbeState } from '../components/ProbeLayer';
import { circleThrough } from '../lib/cad';
import { countKind, deductionText, defaultKindFor, grossArea, hasArea, isWall, KIND_LABELS, kindOf, measureLabel, netArea, netLength, sumLengths } from '../lib/measure';
import { checkMeasure, computeArea, formatArea, formatMeasure, toInputValue } from '../lib/numbers';
import { compactNumbers, damageNo, duplicateIds, nextNumber, planNumberStart, shiftNumbers, suggestNext, swapNumbers } from '../lib/numbering';
import { navigate, paths } from '../lib/router';
import { findSnap } from '../lib/snap';
import { SegIndex } from '../lib/pdf-snap';
import { clearHistory, newMeta, putRecord, putRecords, redo, softDelete, undo, useAppState, type ProjectState } from '../lib/store';
import { COLORS, SHAPE_LABELS, type Damage, type DrawElementType, type MeasureKind, type Plan, type Shape, type ShapeStyle, type ShapeType } from '../lib/types';
import { DRAW_TOOLS, readStyle, useDrawing, type DrawTool } from './DrawingMode';
import { DrawRibbon, OrthoButtons } from '../components/DrawRibbon';
import { elementLabel } from '../components/DrawPanel';
import { StylePanel } from '../components/StylePanel';

type DialogState = { mode: 'new'; shape: Shape; number: number; label: string | null; kind: MeasureKind; fromShape?: boolean } | { mode: 'edit'; id: string } | null;

const TOOLS: { id: Tool; label: string; short?: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Auswählen / Verschieben', short: 'Auswahl', icon: 'select', key: 'v' },
  { id: 'line', label: SHAPE_LABELS.line, icon: 'line', key: 'l' },
  { id: 'rect', label: SHAPE_LABELS.rect, icon: 'rect', key: 'r' },
  { id: 'ellipse', label: SHAPE_LABELS.ellipse, icon: 'ellipse', key: 'k' },
  { id: 'polygon', label: 'Fläche: Eckpunkte nacheinander setzen', short: 'Fläche', icon: 'polygon', key: 'p' },
  { id: 'polyline', label: 'Freie Form: Punkte nacheinander setzen – offen (Länge) oder geschlossen (Fläche), z. B. ein Dreieck', short: 'Freie Form', icon: 'polyline', key: 'f' },
  // Freihand: ohne Absetzen zeichnen – bleibt genau so (z. B. Risse); am Startpunkt beendet = Fläche
  { id: 'freehand', label: 'Freihand: ohne Absetzen zeichnen – Linie genau wie gezeichnet (z. B. Riss), am Startpunkt beenden ergibt eine Fläche', short: 'Freihand', icon: 'freehand', key: 'h' },
  { id: 'wall', label: 'Wand: Verlauf mit Knicken setzen, Enter oder Doppelklick beendet – danach Wandhöhe eingeben', short: 'Wand', icon: 'wall', key: 'w' },
  // Kontrollmessung: Menü mit Länge, Fläche, Winkel, Radius, Abstand – verändert nichts
  { id: 'probe', label: 'Messung: Länge, Fläche, Winkel, Radius oder Abstand nachmessen – ändert nichts', short: 'Messung', icon: 'dimension', key: 'n' },
  // nur importierte Pläne (gezeichnete haben ihren Maßstab bereits)
  { id: 'calibrate', label: 'Maßstab kalibrieren: Strecke bekannter Länge im Plan ziehen', short: 'Kalibrieren', icon: 'calibrate', key: 'm' },
];

/** Werkzeuge mit Maßeingabe bzw. Hinweis vor dem Einfügen */
const INSERT_TOOLS = new Set<DrawTool>(['line', 'rect', 'ellipse', 'triangle', 'dimension', 'text']);

/** Hinweise zu den Befehlen im Zeichenmodus */
const OP_HINTS: Partial<Record<DrawTool, string>> = {
  arc: 'Anfangspunkt, einen Punkt auf dem Bogen und den Endpunkt antippen.',
  move: 'Objekt auswählen, dann vom Basispunkt zum Zielpunkt ziehen (Fang nutzt Ecken und Endpunkte).',
  copy: 'Objekt auswählen, dann vom Basispunkt zum Zielpunkt ziehen – die Kopie wird dort eingefügt.',
  stretch: '1. Fenster über die Eckpunkte ziehen, die sich bewegen sollen.',
  trim: 'Den Linienabschnitt anklicken, der bis zur nächsten Kante entfernt werden soll.',
  extend: 'Die Linie nahe dem Ende anklicken, das bis zur nächsten Kante verlängert werden soll.',
};

/** Werkzeuge, die Punkt für Punkt gesetzt werden */
const isPointTool = (t: Tool) => t === 'polygon' || t === 'polyline' || t === 'wall';

/** Leiste beim Setzen von Punkten: Polylinie (im Zeichenmodus „Freie Form“) offen beenden oder schließen, Fläche schließen */
function PolylineBar({ polyline, count, viewer, lineName = 'Polylinie', wall = false }: { polyline: boolean; count: number; viewer: React.RefObject<PlanViewerHandle | null>; lineName?: string; wall?: boolean }) {
  const name = wall ? 'Wand' : polyline ? lineName : 'Fläche';
  if (wall)
    return (
      <div className="draw-bar" data-testid="polygon-bar">
        {count === 0 ? (
          <span className="muted small">Wand: Anfangspunkt und alle Knicke nacheinander antippen. Enter, Doppelklick oder „Fertig“ beendet den Verlauf – danach die Wandhöhe eingeben.</span>
        ) : (
          <>
            <strong className="draw-bar-title">
              {name}: {count} Punkt{count === 1 ? '' : 'e'}
            </strong>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => viewer.current?.finishPolygon(false)} disabled={count < 2} data-testid="wall-finish">
              <Icon name="check" size={18} /> Fertig
            </button>
            <button type="button" className="btn btn-sm" onClick={() => viewer.current?.undoPolygonPoint()} title="Letzten Punkt entfernen (Rücktaste)" data-testid="polygon-undo-point">
              <Icon name="undo" size={18} /> Punkt
            </button>
            <button type="button" className="btn btn-sm" onClick={() => viewer.current?.cancelPolygon()} data-testid="polygon-cancel">
              Abbrechen
            </button>
          </>
        )}
      </div>
    );
  return (
    <div className="draw-bar" data-testid="polygon-bar">

      {count === 0 ? (
        <span className="muted small">
          {polyline
            ? `${lineName}: Punkte nacheinander antippen. Doppelklick oder Enter beendet sie offen (Länge), Antippen des Startpunkts oder „Schließen“ ergibt eine Fläche.`
            : 'Fläche: Eckpunkte nacheinander antippen. Zum Abschließen den ersten Punkt antippen, doppelt tippen oder „Fläche schließen“.'}
        </span>
      ) : (
        <>
          <strong className="draw-bar-title">
            {name}: {count} Punkt{count === 1 ? '' : 'e'}
          </strong>
          {polyline && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => viewer.current?.finishPolygon(false)} disabled={count < 2} data-testid="polyline-open">
              <Icon name="check" size={18} /> Offen beenden
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm${polyline ? '' : ' btn-primary'}`}
            onClick={() => viewer.current?.finishPolygon(true)}
            disabled={count < 3}
            data-testid="polygon-finish"
          >
            {!polyline && <Icon name="check" size={18} />} {polyline ? 'Schließen (Fläche)' : 'Fläche schließen'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => viewer.current?.undoPolygonPoint()} title="Letzten Punkt entfernen (Rücktaste)" data-testid="polygon-undo-point">
            <Icon name="undo" size={18} /> Punkt
          </button>
          <button type="button" className="btn btn-sm" onClick={() => viewer.current?.cancelPolygon()} data-testid="polygon-cancel">
            Abbrechen
          </button>
        </>
      )}
    </div>
  );
}

/** Referenzstrecke der Kalibrierung (nur beim Kalibrieren sichtbar) */
function CalibrationLine({ view, c }: { view: View; c: NonNullable<Plan['calibration']> }) {
  const a = toScreen(view, c.a);
  const b = toScreen(view, c.b);
  return (
    <g className="calibration-line" data-testid="calibration-line" pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <circle cx={a.x} cy={a.y} r={4} />
      <circle cx={b.x} cy={b.y} r={4} />
      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle">
        {formatMeasure(c.meters)} m
      </text>
    </g>
  );
}

/** Prüfstrecke (nur beim Kalibrieren sichtbar), gestrichelt mit Soll und gemessen */
function CheckLine({ view, c }: { view: View; c: NonNullable<NonNullable<Plan['calibration']>['check']> }) {
  const a = toScreen(view, c.a);
  const b = toScreen(view, c.b);
  return (
    <g className="calibration-line check-line" data-testid="check-line" pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeDasharray="6 4" />
      <circle cx={a.x} cy={a.y} r={4} />
      <circle cx={b.x} cy={b.y} r={4} />
      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle">
        Prüfung {formatMeasure(c.expected)} m → {formatMeasure(c.measured)} m
      </text>
    </g>
  );
}

/** Zugeklappte Werkzeugleiste: ein Knopf mit dem aktuellen Werkzeug öffnet sie wieder */
function ToolsOpenButton({ tool, onOpen }: { tool?: { icon: string; label: string; short?: string }; onOpen: () => void }) {
  return (
    <button type="button" className="tool-btn tools-open" onClick={onOpen} aria-expanded={false} title="Werkzeugleiste öffnen" data-testid="tools-open">
      <Icon name={tool?.icon ?? 'select'} />
      <span>Werkzeuge</span>
    </button>
  );
}

function ToolsCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="icon-btn icon-btn-sm tools-close" onClick={onClose} aria-label="Werkzeugleiste ausblenden" title="Werkzeugleiste ausblenden" data-testid="tools-close">
      <Icon name="close" size={18} />
    </button>
  );
}

/** Breite der Messleiste (PC/Tablet quer): Grenzen in Pixeln */
export const SIDE_MIN = 280;
export const SIDE_MAX = 720;
const SIDE_DEFAULT = 440;
/** Standardfarbe Rot (Schwarz und Weiß stehen in der Palette vorne) */
const DEFAULT_COLOR = (COLORS.find((c) => c.name === 'Rot') ?? COLORS[0]).value;
const clampSide = (w: number) => Math.round(Math.min(Math.max(w, SIDE_MIN), Math.max(SIDE_MIN, Math.min(SIDE_MAX, window.innerWidth * 0.6))));

function loadSideWidth(): number {
  try {
    const v = Number(localStorage.getItem('sideWidth'));
    return v > 0 ? clampSide(v) : SIDE_DEFAULT;
  } catch {
    return SIDE_DEFAULT;
  }
}

function storePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* optional */
  }
}

/**
 * Messung mit Fläche aus der Plangeometrie: Fläche und Umfang aus der (geänderten) Form
 * neu berechnen. Ohne Ergebnis (z. B. offene Form, kein Maßstab) bleiben die Werte stehen.
 */
function withShapeMeasures<T extends Pick<Damage, 'areaFromShape' | 'kind' | 'length' | 'area' | 'width' | 'deductions'>>(d: T, shape: Shape, k: number | null): T {
  if (!d.areaFromShape) return d;
  // Linie mit Länge aus dem Plan: Gesamtlänge aller Abschnitte (Höhe/Tiefe bleiben)
  if (!hasArea(kindOf(d))) return k ? { ...d, length: suggestMeasures(shape, k).length } : d;
  // Wand: Länge aus allen Abschnitten, Höhe bleibt → Wandfläche neu
  if (isWall({ kind: d.kind, shape })) {
    if (!k) return d;
    const length = suggestMeasures(shape, k).length;
    return { ...d, length, area: d.width !== null ? netArea(computeArea(length, d.width), d.deductions) : null };
  }
  const g = geometryMeasures(shape, k);
  return g ? { ...d, length: g.perimeter, width: null, area: netArea(g.area, d.deductions) } : d;
}

/** Kurzbeschreibung der Maße je Messart */
function measureSummary(d: Pick<Damage, 'kind' | 'length' | 'width' | 'depth' | 'area' | 'areaFromShape' | 'shape' | 'deductions'>): string {
  if (!hasArea(kindOf(d))) return `L ${formatMeasure(d.length)} m${d.deductions?.length ? ` ${deductionText(d.deductions, true)} = ${formatMeasure(netLength(d))} m` : ''}`;
  const depth = d.depth !== null ? ` · T ${formatMeasure(d.depth)} m` : '';
  // Abzüge/Zuschläge: Brutto ± Teilflächen = Netto
  const deds = d.area !== null && d.deductions?.length ? ` ${deductionText(d.deductions)} = ${formatArea(d.area)} m²` : '';
  // Wand: Länge (aus dem Plan) × Höhe – kein Umfang
  if (d.areaFromShape && d.area !== null && !isWall(d)) return `${formatArea(grossArea(d))} m² aus Plan${deds} · U ${formatMeasure(d.length)} m${depth}`;
  // ohne Breite/Höhe: nur die Länge, keine Fläche
  if (d.width === null || d.area === null) return `L ${formatMeasure(d.length)} m${depth}`;
  return `${formatMeasure(d.length)} × ${formatMeasure(d.width)} m${depth} = ${formatArea(grossArea(d))} m²${deds}`;
}

/**
 * Gezeichnete Pläne: Maße der Markierung laut Plan (Maßstab bekannt) zur Kontrolle; weichen sie
 * mehr als 5 % von den eingetragenen Werten ab (z. B. nach Formänderung), wird gewarnt.
 */
function MeasureCheck({ damage, k }: { damage: Damage; k: number }) {
  if (damage.areaFromShape) {
    return (
      <span className="small muted" data-testid="measure-check">
        {isWall(damage) ? 'Wandlänge wird aus der Form berechnet' : hasArea(kindOf(damage)) ? 'Fläche und Umfang werden aus der Form berechnet' : 'Länge wird aus der Form berechnet'}
      </span>
    );
  }
  const s = suggestMeasures(damage.shape, k);
  const off = (a: number, b: number | null) => b !== null && b > 0 && Math.abs(a - b) / b > 0.05;
  // Reihenfolge von Länge und Breite ist frei – längere mit längerer Seite vergleichen
  const area = hasArea(kindOf(damage)) && damage.width !== null && s.width !== null;
  const bad = area
    ? off(Math.max(damage.length, damage.width!), s.length) || off(Math.min(damage.length, damage.width!), s.width)
    : off(damage.length, s.length);
  const text = s.width !== null && hasArea(kindOf(damage)) ? `${formatMeasure(s.length)} × ${formatMeasure(s.width)} m` : `${formatMeasure(s.length)} m`;
  return (
    <span className={`small ${bad ? 'warn-text' : 'muted'}`} data-testid="measure-check">
      Plan: {text}
      {bad && ' – Maße prüfen'}
    </span>
  );
}

function loadLastPosition(planId: string): string {
  try {
    return localStorage.getItem(`lastPosition:${planId}`) ?? '';
  } catch {
    return '';
  }
}

function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function PlanEditorPage({ planId, focusDamageId }: { planId: string; focusDamageId: string | null }) {
  const data = useAppState((s) => s.data) as ProjectState;
  const history = useAppState((s) => s.history);
  const plan = data.plans[planId];
  const [tool, setToolState] = useState<Tool>(() => loadPref('tool', TOOLS.map((t) => t.id).filter((t) => t !== 'probe'), 'ellipse'));
  const [color, setColorState] = useState(() => loadPref('color', COLORS.map((c) => c.value), DEFAULT_COLOR));
  const [selectedId, setSelectedId] = useState<string | null>(focusDamageId);
  /** Kontrollmessung (Werkzeug „Messung“) – wird nicht gespeichert */
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [probeMenu, setProbeMenu] = useState(false);
  /** Aufmaß: ausgewählter Eckpunkt der ausgewählten Messung (zum Entfernen) */
  const [measureVertex, setMeasureVertex] = useState<number | null>(null);
  useEffect(() => setMeasureVertex(null), [selectedId]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<Damage>>>({});
  const [mobileTab, setMobileTab] = useState<'plan' | 'table'>('plan');
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Kalibrieren: Prüfstrecke statt Referenzstrecke ziehen; Prüfbericht */
  const [checking, setChecking] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [dimsOpen, setDimsOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  /** Werkzeug „Fläche“: Anzahl bereits gesetzter Eckpunkte */
  const [polyCount, setPolyCount] = useState(0);
  /** Leistung für neue Messungen: bleibt bis zur nächsten Änderung aktiv ('' = ohne Leistungszuordnung) */
  const [lastPosition, setLastPositionState] = useState(() => loadLastPosition(planId));
  const setLastPosition = (ref: string) => {
    setLastPositionState(ref);
    storePref(`lastPosition:${planId}`, ref);
  };
  const [pdfOpen, setPdfOpen] = useState(false);
  const [sideWidth, setSideWidth] = useState(loadSideWidth);
  /** Messleiste am PC eingeklappt (nach rechts) – bleibt gemerkt */
  const [sideCollapsed, setSideCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sideCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleSide = () => {
    setSideCollapsed((c) => {
      storePref('sideCollapsed', c ? '0' : '1');
      return !c;
    });
  };
  const [, setHistoryTick] = useState(0);
  const viewer = useRef<PlanViewerHandle>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const drawingPlan = isDrawingPlan(plan);
  /** Gezeichnete Pläne: Planbearbeitung („draw“) oder Aufmaß („measure“) */
  const initialMode = () => (isDrawingPlan(data.plans[planId]) && !elementsOf(data, planId).length ? 'draw' : 'measure');
  const [mode, setMode] = useState<'draw' | 'measure'>(initialMode);
  const drawMode = drawingPlan && mode === 'draw';
  /** Darstellung: Bedienfeld der ausgewählten Messung bzw. Voreinstellung für neue Messungen */
  const [styleOpen, setStyleOpen] = useState(false);
  const [stylePopOpen, setStylePopOpen] = useState(false);
  const [measureStyle, setMeasureStyleState] = useState<ShapeStyle>(() => readStyle('measureStyle'));
  const setMeasureStyle = (patch: Partial<ShapeStyle>) => {
    const next = { ...measureStyle, ...patch };
    setMeasureStyleState(next);
    storePref('measureStyle', JSON.stringify(next));
  };
  /** Werkzeugleiste aufgeklappt (klappt nach dem Zeichnen zu, damit der Plan frei bleibt) */
  const [toolsOpen, setToolsOpen] = useState(true);
  // Höhe der Werkzeugleiste (kann umbrechen) – Leisten darüber werden passend versetzt
  // Zeichenmodus: Registerkarten-Leiste oben – die Planfläche beginnt darunter
  useLayoutEffect(() => {
    const host = planRef.current;
    if (!host) return;
    const bar = host.querySelector('.toolbar');
    const ribbon = host.querySelector('.ribbon');
    // Abstand von der Oberkante der unteren Leiste bis zum unteren Rand der Planfläche
    const update = () => {
      host.style.setProperty('--toolbar-h', bar ? `${Math.round(host.getBoundingClientRect().bottom - bar.getBoundingClientRect().top)}px` : '0px');
      host.style.setProperty('--ribbon-h', ribbon ? `${Math.round(ribbon.getBoundingClientRect().height)}px` : '0px');
    };
    update();
    const ro = new ResizeObserver(update);
    if (bar) ro.observe(bar);
    if (ribbon) ro.observe(ribbon);
    return () => ro.disconnect();
  }, [drawMode]);

  const setTool = (t: Tool) => {
    setToolState(t);
    storePref('tool', t);
  };
  const setColor = (c: string) => {
    setColorState(c);
    storePref('color', c);
  };
  /** Kalibrieren starten: Menü der Messung, laufende Messung und Stil-Fenster zu (nie zwei Werkzeuge zugleich) */
  const startCalibrate = () => {
    setProbeMenu(false);
    setProbe(null);
    setStylePopOpen(false);
    setTool('calibrate');
  };

  // Rückgängig/Wiederholen gilt je geöffnetem Plan
  useEffect(() => {
    clearHistory();
    setMode(initialMode());
    setLastPositionState(loadLastPosition(planId));
    return () => clearHistory();
  }, [planId]);

  const stored = useMemo(() => (plan ? damagesOf(data, plan.id) : []), [data, plan]);
  const damages = useMemo(() => stored.map((d) => (overrides[d.id] ? { ...d, ...overrides[d.id] } : d)), [stored, overrides]);
  // Ebene „Messungen“ ausgeblendet: nicht im Plan (die Tabelle bleibt vollständig)
  const shownDamages = useMemo(() => visibleDamages(plan, damages), [plan, damages]);
  const dupIds = useMemo(() => {
    return duplicateIds(stored);
  }, [stored]);
  const selected = damages.find((d) => d.id === selectedId) ?? null;
  const drawing = useDrawing({ plan, data, damages, viewer, onCreated: () => setToolsOpen(false) });
  // Aufmaß: Messung endet mit einem anderen Werkzeug; Zeichenmodus: mit einem Zeichenwerkzeug bzw. Moduswechsel
  useEffect(() => {
    if (mode !== 'draw' && tool !== 'probe') setProbe(null);
  }, [tool, mode]);
  useEffect(() => {
    if (mode === 'draw') setProbe(null);
  }, [drawing.tool, mode]);
  const region = useMemo(
    () => (plan && drawingPlan ? drawingRegion(plan, drawing.allElements, stored) : undefined),
    [plan, drawingPlan, drawing.allElements, stored],
  );

  /** Gültiger Bereich für neue Formen: Zeichenblatt bzw. Planausschnitt (Seitenkoordinaten) */
  const sheetBounds = plan && drawingPlan ? drawingSheet(plan) : undefined;
  const markerBounds = !plan ? undefined : drawingPlan ? sheetBounds : (plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight });
  /** Maßstab (Seiteneinheiten je m): gezeichnete Pläne immer, importierte nach Kalibrierung */
  const k = plan ? planUnitsPerMeter(plan) : null;

  /**
   * Punktfang im Aufmaß: an Markierungen (und bei gezeichneten Plänen an Zeichnungsobjekten) –
   * End-/Eckpunkte, Schnittpunkte, Mittelpunkte, nächster Punkt auf Linien.
   */
  const measureSnap: SnapFn = (p, ctx) => {
    const shapes = [
      ...shownDamages.filter((d) => d.id !== ctx.movingId).map((d) => d.shape),
      ...(drawingPlan ? drawing.elements.filter((e) => e.type !== 'text').map((e) => shapeToPage(e.shape, unitsPerMeter(plan!))) : []),
    ];
    const tol = (matchMedia('(pointer: coarse)').matches ? 16 : 9) / ctx.scale;
    // Vektor-PDF: auch Ecken, Mittel- und Schnittpunkte der Planlinien
    const hit = findSnap(p, shapes, tol, planLines?.index.near(p, tol) ?? []);
    return hit ? { ...hit.point, kind: hit.kind } : p;
  };
  /** X gedrückt: vergrößert (Hinweis anzeigen) */
  const [lupeOn, setLupeOn] = useState(false);
  /** Linien des PDF-Plans für den Punktfang (einmal je Plan eingelesen) */
  const [planLines, setPlanLines] = useState<{ key: string; index: SegIndex } | null>(null);

  // Gezeichnete Pläne haben ihren Maßstab – dort gibt es kein Kalibrieren
  useEffect(() => {
    if (drawingPlan && tool === 'calibrate') setTool('select');
    if (tool !== 'calibrate' && checking) setChecking(false);
  });

  /** Kalibrieren: gezogene Strecke + reale Länge → Maßstab des Plans (Messwerte bleiben) */
  const calibrate = async (shape: Shape) => {
    if (!plan || drawingPlan) return;
    const [a, b] = lineEnds(shape);
    const input = await promptDialog({
      title: 'Maßstab kalibrieren',
      label: 'Reale Länge der gezogenen Strecke (m)',
      value: plan.calibration ? toInputValue(plan.calibration.meters) : '',
      confirmLabel: 'Kalibrieren',
    });
    if (input === null) return;
    const r = checkMeasure(input, 'Länge');
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    putRecord('plans', { ...data.plans[plan.id], calibration: { a, b, meters: r.value } });
    setTool('select');
    // kurze Referenzstrecke → Ablesefehler wirkt sich stärker aus
    const reg = plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
    const short = Math.hypot(b.x - a.x, b.y - a.y) < 0.2 * Math.max(reg.w, reg.h);
    toast(
      `Plan kalibriert: Strecke = ${formatMeasure(r.value)} m. Gespeicherte Messwerte bleiben unverändert.` +
        (short ? ' Tipp: Eine längere Referenzstrecke (z. B. ganze Wand) ist genauer – mit „Prüfstrecke“ kontrollieren.' : ''),
      'success',
      short ? 7000 : 4000,
    );
  };

  /** Prüfstrecke: bekannte Länge nachmessen → Abweichung der Kalibrierung (ändert nichts am Maßstab) */
  const runCheck = async (shape: Shape) => {
    if (!plan || !k || !plan.calibration) return;
    const [a, b] = lineEnds(shape);
    const measured = Math.round((Math.hypot(b.x - a.x, b.y - a.y) / k) * 1000) / 1000;
    const input = await promptDialog({
      title: 'Prüfstrecke',
      label: `Im Plan gemessen: ${formatMeasure(measured)} m – bekannte (bemaßte) Länge dieser Strecke (m)`,
      value: '',
      confirmLabel: 'Prüfen',
    });
    if (input === null) return;
    const r = checkMeasure(input, 'Länge');
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    const cur = data.plans[plan.id];
    putRecord('plans', { ...cur, calibration: { ...cur.calibration!, check: { a, b, expected: r.value, measured, at: Date.now() } } });
    setChecking(false);
    const diff = measured - r.value;
    const ok = Math.abs(diff) <= MAX_ERROR_M;
    toast(
      `Prüfstrecke: Soll ${formatMeasure(r.value)} m, gemessen ${formatMeasure(measured)} m – Abweichung ${formatCm(diff)} (auf 10 m ≈ ${formatCm((diff / r.value) * 10)}). ` +
        (ok ? 'Die Kalibrierung passt.' : 'Mehr als 2 cm: bitte neu kalibrieren (z. B. längere Referenzstrecke).'),
      ok ? 'success' : 'error',
      7000,
    );
  };

  /** Maßstab nachträglich aus dem Plan erkennen (PDF mit Text) */
  const detectFromPlan = async () => {
    if (!plan || !file || file.kind !== 'pdf') return;
    try {
      const { getPdfDocument, readPageSegments, readPageText } = await import('../lib/pdf');
      const page = await (await getPdfDocument(plan.fileId)).getPage(plan.pageIndex + 1);
      const region = plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
      const det = detectScale(await readPageText(page, plan.rotation), region, await readPageSegments(page, plan.rotation, region));
      if (!det) {
        toast('Im Plan wurde kein eindeutiger Maßstab gefunden – bitte an einer bekannten Strecke kalibrieren.', 'info', 5000);
        return;
      }
      putRecord('plans', { ...data.plans[plan.id], calibration: calibrationFrom(det) });
      toast(`Maßstab ${det.label} erkannt (${sourceText(det)}). Gespeicherte Messwerte bleiben unverändert.`, 'success', 5000);
    } catch (e) {
      showError(e, 'Maßstab konnte nicht erkannt werden');
    }
  };

  const switchMode = (m: 'draw' | 'measure') => {
    setMode(m);
    setToolsOpen(true);
    setSelectedId(null);
    drawing.setSelectedId(null);
  };

  // Schadstelle aus der Tabelle (andere Seite) anzeigen
  useEffect(() => {
    if (!focusDamageId) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      viewer.current?.focus(focusDamageId);
      if (tries > 3) clearInterval(t);
    }, 150);
    return () => clearInterval(t);
  }, [focusDamageId]);

  const doUndo = () => {
    if (!undo()) return;
    setOverrides({});
    drawing.resetOverrides();
    toast('Rückgängig gemacht.', 'info', 1500);
  };
  const doRedo = () => {
    if (!redo()) return;
    setOverrides({});
    drawing.resetOverrides();
    toast('Wiederhergestellt.', 'info', 1500);
  };

  // Tastaturkürzel (PC)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || detailsOpen || pdfOpen) return;
      const target = e.target as HTMLElement;
      const key = e.key.toLowerCase();
      const typing = ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;
      // X gedrückt halten: vergrößert an der Maus (Tastenwiederholung ignorieren), loslassen → zurück (keyup).
      // Auch wenn noch eine Auswahlliste oder ein Knopf den Fokus hat (z. B. nach dem Planwechsel).
      if (key === 'x' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !typing && !document.querySelector('.modal')) {
        e.preventDefault();
        if (target.tagName === 'SELECT' || target.tagName === 'BUTTON') target.blur();
        if (e.repeat || viewer.current?.lupeActive()) return;
        if (!drawing.snapOn) drawing.setSnapOn(true);
        viewer.current?.zoomHold(true);
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || document.querySelector('.modal')) return;
      // Esc beendet alles – gesetzte Punkte, Messung, Menü, Auswahl – und schaltet auf „Auswahl“
      // (im Aufmaß und unter „Plan bearbeiten“)
      if (e.key === 'Escape') {
        e.preventDefault();
        viewer.current?.cancelPolygon();
        setProbe(null);
        setProbeMenu(false);
        setStylePopOpen(false);
        if (drawMode) {
          drawing.setSelectedId(null);
          drawing.setTool('select');
        } else {
          setSelectedId(null);
          setTool('select');
        }
        return;
      }
      // Messung: Enter beendet (Länge/Fläche), Rücktaste nimmt den letzten Punkt zurück
      if (probe && (drawMode || tool === 'probe') && ['Enter', 'Backspace', 'Delete'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Enter') finishProbe();
        else if (!probe.done) setProbe({ ...probe, points: probe.points.slice(0, -1) });
        return;
      }
      // Punktwerkzeuge: Enter beendet (Polylinie offen, Polygon geschlossen), C schließt,
      // Rücktaste/Entf nimmt den letzten Punkt zurück (Escape verwirft, siehe oben)
      if (polyCount && ['Enter', 'Backspace', 'Delete'].includes(e.key) || (polyCount && key === 'c' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        if (e.key === 'Enter') viewer.current?.finishPolygon();
        else if (key === 'c') viewer.current?.finishPolygon(true);
        else viewer.current?.undoPolygonPoint();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // F8 wie in CAD-Programmen: 90° / Orthogonal ein/aus (nur beim Zeichnen)
      if (e.key === 'F8' && drawMode) {
        e.preventDefault();
        drawing.setOrthoOn(!drawing.orthoOn);
        toast(`90° / Orthogonal ${drawing.orthoOn ? 'aus' : 'ein'}`, 'info', 1500);
        return;
      }
      // Umschalt+X: Punktfang ein/aus
      if (key === 'x') {
        e.preventDefault();
        drawing.setSnapOn(!drawing.snapOn);
        toast(`Punktfang ${drawing.snapOn ? 'aus' : 'ein'}`, 'info', 1500);
        return;
      }
      if (drawMode) {
        const dt = DRAW_TOOLS.find((x) => x.key === key);
        if (dt) drawing.setTool(dt.id);
        else if ((e.key === 'Delete' || e.key === 'Backspace') && drawing.selected) {
          // ausgewählter Eckpunkt zuerst, sonst das ganze Objekt
          if (!drawing.removeSelectedVertex()) void drawing.remove(drawing.selected);
        }
        else if (!['+', '=', '-', '0'].includes(e.key)) return;
        if (dt || e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          return;
        }
      }
      const t = TOOLS.find((x) => x.key === key);
      if (t && !drawMode) setTool(t.id);
      else if (e.key === '+' || e.key === '=') viewer.current?.zoomIn();
      else if (e.key === '-') viewer.current?.zoomOut();
      else if (e.key === '0') viewer.current?.fit();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        // ausgewählter Eckpunkt zuerst, sonst die ganze Messung
        if (measureVertex === null || !removeMeasureVertex()) void removeDamage(selected);
      } else if (e.key === 'Enter' && selected) setDialog({ mode: 'edit', id: selected.id });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // X losgelassen (auch während eines Dialogs) bzw. Fenster verlassen: zurück zur vorherigen Ansicht
  useEffect(() => {
    const release = (e?: KeyboardEvent) => {
      if (e && e.key.toLowerCase() !== 'x') return;
      viewer.current?.zoomHold(false);
    };
    const blur = () => release();
    const hidden = () => document.hidden && release();
    window.addEventListener('keyup', release);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keyup', release);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  // (vor dem Abbruch unten: Hooks immer in gleicher Reihenfolge)
  const lineFile = plan && !plan.deletedAt && !drawingPlan ? data.files[plan.fileId] : undefined;
  const linesKey = plan && lineFile?.kind === 'pdf' ? `${lineFile.id}:${plan.pageIndex}:${plan.rotation ?? 0}:${JSON.stringify(plan.crop)}` : '';
  useEffect(() => {
    if (!linesKey || planLines?.key === linesKey) return;
    let live = true;
    const p = data.plans[planId];
    void (async () => {
      const { getPdfDocument, readPageSegments } = await import('../lib/pdf');
      const page = await (await getPdfDocument(p.fileId)).getPage(p.pageIndex + 1);
      const segs = await readPageSegments(page, p.rotation, p.crop);
      if (live) setPlanLines({ key: linesKey, index: new SegIndex(segs) });
    })().catch((e) => console.warn('Planlinien für den Punktfang nicht lesbar', e));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);

  if (!plan || plan.deletedAt) {
    return (
      <div className="page">
        <div className="banner banner-error">Plan nicht gefunden.</div>
        <a className="btn" href={paths.project(data.project.id)}>
          Zum Projekt
        </a>
      </div>
    );
  }
  const file = drawingPlan ? null : data.files[plan.fileId];
  const cc = data.costCenters[plan.costCenterId];
  // aufgeteiltes Projekt: nur die Pläne derselben Rechnung
  const siblings = plansOf(data, plan.costCenterId, data.project.splitByInvoice ? (plan.invoiceId ?? null) : undefined);
  const idx = siblings.findIndex((p) => p.id === plan.id);
  // abgerechnete Rechnung: nicht gesperrt, aber deutlich gewarnt
  const settledInvoice = invoiceOfPlan(data.project, plan)?.settled ? invoiceOfPlan(data.project, plan) : null;

  const select = (id: string | null, focus = false) => {
    setSelectedId(id);
    if (id && focus) viewer.current?.focus(id);
  };

  const applyRenumber = (changes: Map<string, number>, extra?: Partial<Damage> & { id: string }) => {
    const recs: Damage[] = [];
    for (const [id, n] of changes) {
      const d = data.damages[id];
      recs.push({ ...d, ...(extra?.id === id ? extra : {}), number: n });
    }
    if (extra && !changes.has(extra.id)) recs.push({ ...data.damages[extra.id], ...extra });
    putRecords({ damages: recs });
  };

  /** Messung starten: mit ausgewähltem Objekt gleich dessen Länge, Fläche bzw. Radius; bei „Abstand“ und einer ausgewählten Linie senkrecht zu ihr */
  const startProbe = (kind: ProbeKind) => {
    setProbeMenu(false);
    // ausgewähltes Objekt: Messung bzw. Zeichnungsobjekt (in Plankoordinaten)
    const dsel = selectedId ? data.damages[selectedId] : null;
    const item = drawMode && drawing.selected ? drawing.items.find((i) => i.id === drawing.selected!.id) : null;
    const sel = drawMode ? (item ? { id: item.id, shape: item.shape, deletedAt: null } : null) : dsel;
    let st: ProbeState = { kind, points: [], done: false, ref: null };
    if (sel && !sel.deletedAt) {
      const verts = shapeVertices(sel.shape);
      const open = isOpenShape(sel.shape);
      // Bogen (Zeichnung): Radius aus Anfangs-, Mittel- und Endpunkt
      const arc = drawMode && drawing.selected?.type === 'arc' && verts.length >= 3 ? circleThrough(verts[0], verts[Math.floor(verts.length / 2)], verts[verts.length - 1]) : null;
      if (kind === 'radius' && arc) st = { kind, points: [arc.c, verts[0]], done: true, fromObject: sel.id };
      else
      if (kind === 'length' && verts.length >= 2) st = { kind, points: open ? verts : [...verts, verts[0]], done: true, fromObject: sel.id };
      else if (kind === 'area' && !open && verts.length >= 3) st = { kind, points: verts, done: true, fromObject: sel.id };
      else if (kind === 'radius' && sel.shape.type === 'ellipse') {
        const c = { x: sel.shape.x + sel.shape.w / 2, y: sel.shape.y + sel.shape.h / 2 };
        st = { kind, points: [c, rotatePoint({ x: c.x + sel.shape.w / 2, y: c.y }, c, sel.shape.rotation ?? 0)], done: true, fromObject: sel.id };
      } else if (kind === 'distance' && open && verts.length === 2) st = { kind, points: [], done: false, ref: [verts[0], verts[1]] };
    }
    setProbe(st);
    if (!drawMode) setTool('probe');
  };
  const probePoint = (p: Point, scale: number) =>
    setProbe((pr) => {
      if (!pr) return pr;
      // fertig: nächster Punkt beginnt eine neue Messung derselben Art
      const base = pr.done ? { ...pr, points: [], done: false, fromObject: null } : pr;
      // Fläche: Antippen des Startpunkts schließt
      if (base.kind === 'area' && base.points.length >= 3 && Math.hypot(p.x - base.points[0].x, p.y - base.points[0].y) * scale < (matchMedia('(pointer: coarse)').matches ? 22 : 12))
        return { ...base, done: true };
      const points = [...base.points, p];
      const target = probeTarget(base.kind, !!base.ref);
      return { ...base, points, done: target !== null && points.length >= target };
    });
  const finishProbe = () =>
    setProbe((pr) => (pr && !pr.done && ((pr.kind === 'length' && pr.points.length >= 2) || (pr.kind === 'area' && pr.points.length >= 3)) ? { ...pr, done: true } : pr));
  const closeProbe = () => {
    setProbe(null);
    if (!drawMode) setTool('select');
  };
  /** Ausdrücklich ins Aufmaß übernehmen: Länge → Linie, Fläche → Fläche (Maße aus dem Plan) */
  const adoptProbe = () => {
    if (!probe || !probe.done) return;
    const pts = probe.points;
    const shape = probe.kind === 'area' ? polygonShape(pts, true) : pts.length === 2 ? lineShape(pts[0], pts[1]) : polygonShape(pts, false);
    // im Zeichenmodus: ins Aufmaß wechseln, dort die neue Messung anlegen
    if (drawMode) switchMode('measure');
    setProbe(null);
    setTool('select');
    setDialog({ mode: 'new', shape, ...suggestNext(stored, planNumberStart(plan)), kind: probe.kind === 'area' ? 'area' : 'line', fromShape: true });
  };

  /** Ausgewählten Eckpunkt der Messung entfernen (Maße aus dem Plan werden nachgeführt) */
  const removeMeasureVertex = (): boolean => {
    const d = selectedId ? data.damages[selectedId] : null;
    const shape = d && measureVertex !== null ? removeVertex(d.shape, measureVertex) : null;
    if (!d || !shape) return false;
    putRecord('damages', withShapeMeasures({ ...d, shape }, shape, k));
    setMeasureVertex(null);
    return true;
  };

  const save = (v: DamageValues, renumber: Renumber) => {
    if (!dialog) return;
    // Fläche aus der Geometrie: aus der endgültigen Form (auch nach einem Formwechsel) berechnen
    const finalShape = convertShape(dialog.mode === 'new' ? dialog.shape : data.damages[dialog.id].shape, v.shapeType);
    const geo = v.areaFromShape && hasArea(v.kind) ? geometryMeasures(finalShape, k) : null;
    // Linie mit Länge aus dem Plan: Gesamtlänge aller Abschnitte, wird bei Formänderungen nachgeführt
    const wall = isWall({ kind: v.kind, shape: finalShape });
    const lineFromPlan = v.areaFromShape && (!hasArea(v.kind) || wall) && k ? suggestMeasures(finalShape, k).length : null;
    const gross = geo ? geo.area : hasArea(v.kind) && v.width !== null ? computeArea(lineFromPlan ?? v.length, v.width) : null;
    // Abzüge/Zuschläge (Tür, Öffnung …): Flächen mit berechneter Fläche bzw. Linien (Teillängen)
    const deductions = v.deductions.length && (hasArea(v.kind) ? gross !== null : true) ? v.deductions : undefined;
    const area = netArea(gross, deductions);
    const measures = {
      kind: v.kind,
      length: geo ? geo.perimeter : (lineFromPlan ?? v.length),
      // Linie: Breite = Höhe, getrennt von der Länge – ergibt keine Fläche
      width: geo ? null : v.width,
      depth: v.depth,
      area,
      deductions,
      areaFromShape: geo || lineFromPlan !== null ? true : undefined,
      componentId: v.componentId,
      positionRef: v.positionRef,
      label: v.label,
    };
    // Kennzeichnung (z. B. „A“): Die Nummer dient nur der Reihenfolge – bestehende bleibt, neue ans Ende
    const number = v.label
      ? dialog.mode === 'edit'
        ? data.damages[dialog.id].number
        : nextNumber(stored, planNumberStart(plan))
      : v.number;
    // Umnummerieren betrifft nur Messungen mit reiner Nummer
    const plain = stored.filter((d) => !d.label);
    const shown = v.label ?? String(v.number);
    setLastPosition(v.positionRef ?? '');
    if (dialog.mode === 'new') {
      const dmg: Damage = {
        ...newMeta(),
        projectId: plan.projectId,
        planId: plan.id,
        number,
        shape: convertShape(dialog.shape, v.shapeType),
        color: v.color,
        labelOffset: null,
        ...(Object.keys(measureStyle).length ? { style: { ...measureStyle } } : {}),
        ...measures,
      };
      if (renumber !== 'none' && !v.label) {
        // Kontrollierte Umnummerierung; beim Tausch erhält die bisherige Schadstelle die
        // automatisch vorgeschlagene Nummer der neuen.
        const base = { ...dmg, number: dialog.number };
        const all = [...plain, base];
        const changes = renumber === 'swap' ? swapNumbers(all, base.id, v.number) : shiftNumbers(all, base.id, v.number);
        const recs = [...changes].map(([id, n]) => (id === base.id ? { ...base, number: n } : { ...data.damages[id], number: n }));
        putRecords({ damages: recs });
      } else {
        putRecord('damages', dmg);
      }
      if (v.color !== color) setColor(v.color);
      setSelectedId(dmg.id);
      // Fertig: zurück zur Auswahl (Messung bleibt ausgewählt und bearbeitbar), Leiste zuklappen
      setTool('select');
      setToolsOpen(false);
      const amount = area !== null ? `${formatArea(area)} m²` : `${formatMeasure(netLength({ kind: v.kind, length: measures.length, deductions }))} m`;
      toast(`${wall ? 'Wand' : KIND_LABELS[v.kind]} ${shown} gespeichert (${amount}).`, 'success', 2500);
    } else {
      const d = data.damages[dialog.id];
      const patch = {
        id: d.id,
        ...measures,
        color: v.color,
        shape: convertShape(d.shape, v.shapeType),
        labelOffset: v.resetLabel ? null : d.labelOffset,
      };
      if (renumber === 'none' || v.label) putRecord('damages', { ...d, ...patch, number });
      else {
        const changes = renumber === 'swap' ? swapNumbers([...plain.filter((x) => x.id !== d.id), d], d.id, v.number) : shiftNumbers([...plain.filter((x) => x.id !== d.id), d], d.id, v.number);
        applyRenumber(changes, patch);
      }
    }
    setDialog(null);
  };

  const removeDamage = async (d: Damage) => {
    const label = `${measureLabel(d)} ${damageNo(d)}`;
    const ok = await confirmDialog({
      title: `${label} löschen?`,
      message: (
        <p>
          {label} ({measureSummary(d)}) wird gelöscht. Die Nummern der übrigen Messungen bleiben unverändert. Mit „Rückgängig“ lässt sich
          das Löschen zurücknehmen.
          {settledInvoice && <strong className="error" data-testid="settled-confirm"> Achtung: {invoiceLabel(settledInvoice)} ist bereits abgerechnet.</strong>}
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    softDelete({ damages: [data.damages[d.id]] });
    if (selectedId === d.id) setSelectedId(null);
    setDialog(null);
    toast(`${label} gelöscht.`);
  };


  const compact = async () => {
    // Nur reine Nummern werden lückenlos gemacht; Kennzeichnungen (A, B …) bleiben unverändert
    const changes = compactNumbers(stored.filter((d) => !d.label), planNumberStart(plan));
    if (!changes.size) {
      toast('Die Nummerierung ist bereits lückenlos.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Lückenlos neu nummerieren?',
      message: (
        <p>
          {changes.size} Messung(en) erhalten eine neue Nummer (Reihenfolge bleibt erhalten, Start bei {planNumberStart(plan)}). Bereits
          ausgedruckte oder notierte Nummern stimmen danach nicht mehr überein.
        </p>
      ),
      confirmLabel: 'Neu nummerieren',
    });
    if (ok) applyRenumber(changes);
  };

  const exportExcel = () => setExcelOpen(true);

  // Messleiste in der Breite verstellen (nur Anzeige – Plan- und Markierungskoordinaten bleiben unverändert)
  const commitSideWidth = (w: number) => {
    const c = clampSide(w);
    setSideWidth(c);
    storePref('sideWidth', String(c));
  };
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = sideWidth;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = clampSide(startW + (startX - ev.clientX));
      setSideWidth(w);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      commitSideWidth(w);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const dialogDamage = dialog?.mode === 'edit' ? data.damages[dialog.id] : null;
  const rows = damages.map((damage) => ({ plan, damage }));
  const lineCount = countKind(damages, 'line');
  const activePosition = findPosition(data, lastPosition);
  const positionOptions = lvDocsOf(data).flatMap((doc) =>
    doc.positions.map((p) => ({ ref: positionRef(doc.id, p.id), doc: lvDocLabel(doc), label: `${p.number} ${p.shortText} (${p.unit || '–'})` })),
  );

  return (
    <div className="editor">
      <header className="topbar editor-topbar">
        <a className="icon-btn" href={paths.costCenter(data.project.id, plan.costCenterId)} aria-label="Zurück zur Planliste">
          <Icon name="back" />
        </a>
        <div className="topbar-title">
          <small>
            {[data.project.name, costCenterLabel(cc)].filter(Boolean).join(' · ')}
          </small>
          <div className="plan-switch">
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              disabled={idx <= 0}
              onClick={() => navigate(paths.plan(data.project.id, siblings[idx - 1].id))}
              aria-label="Vorheriger Plan"
            >
              <Icon name="back" size={18} />
            </button>
            <select
              value={plan.id}
              onChange={(e) => navigate(paths.plan(data.project.id, e.target.value))}
              aria-label="Plan wechseln"
              data-testid="plan-select"
            >
              {siblings.map((p) => (
                <option key={p.id} value={p.id}>
                  {planTitle(p)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              disabled={idx >= siblings.length - 1}
              onClick={() => navigate(paths.plan(data.project.id, siblings[idx + 1].id))}
              aria-label="Nächster Plan"
            >
              <Icon name="next" size={18} />
            </button>
          </div>
        </div>
        <SaveStatus compact />
        <div className="topbar-actions">
          <div className="history-btns">
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={doUndo}
              disabled={!history.undo}
              aria-label="Rückgängig"
              title="Rückgängig (Strg+Z)"
              data-testid="undo"
            >
              <Icon name="undo" size={20} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={doRedo}
              disabled={!history.redo}
              aria-label="Wiederholen"
              title="Wiederholen (Strg+Umschalt+Z)"
              data-testid="redo"
            >
              <Icon name="redo" size={20} />
            </button>
          </div>
          {!drawingPlan &&
            (() => {
              const st = calibrationStatus(plan, file?.kind);
              return (
                <button
                  type="button"
                  className={`status-pill scale-status${st.warn ? ' warn' : ' ok'}`}
                  onClick={startCalibrate}
                  title={`${st.text} – zum Kalibrieren tippen`}
                  data-testid="scale-status"
                  data-state={st.state}
                >
                  <span className="hide-sm">Maßstab </span>
                  {st.short}
                </button>
              );
            })()}
          <button type="button" className="btn btn-sm" onClick={() => setDetailsOpen(true)} title="Planangaben">
            <Icon name="info" size={18} /> <span className="hide-sm">Angaben</span>
          </button>
          {!drawingPlan && !drawMode && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const { planColor: _, ...rest } = data.plans[plan.id];
                putRecord('plans', plan.planColor ? rest : { ...rest, planColor: true });
              }}
              aria-pressed={!!plan.planColor}
              title={plan.planColor ? 'Plan farbig – antippen für schwarz-weiß (Ansicht und PDF)' : 'Plan schwarz-weiß – antippen für farbig (Ansicht und PDF)'}
              data-testid="plan-color-toggle"
            >
              <Icon name="layers" size={18} /> <span className="hide-sm">{plan.planColor ? 'Farbig' : 'Schwarz-weiß'}</span>
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={exportExcel} title="Aufmaß dieses Plans als Excel" data-testid="export-xlsx-plan">
            <Icon name="excel" size={18} /> <span className="hide-sm">Excel</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPdfOpen(true)} title="Plan als PDF" data-testid="export-pdf-plan">
            <Icon name="pdf" size={18} /> <span className="hide-sm">PDF</span>
          </button>
        </div>
      </header>
      <SaveErrorBanner />
      {settledInvoice && (
        <div className="banner banner-warn" role="status" data-testid="settled-warning">
          <p>
            <strong>{invoiceLabel(settledInvoice)} ist abgerechnet.</strong> Änderungen und Löschungen in diesem Plan ändern eine bereits abgerechnete Rechnung.
          </p>
        </div>
      )}
      {drawingPlan && (
        <div className={`mode-bar${drawMode ? ' drawing' : ''}`} data-testid="mode-bar">
          <div className="segmented" role="tablist" aria-label="Ansicht">
            <button type="button" role="tab" aria-selected={drawMode} onClick={() => switchMode('draw')} data-testid="mode-draw">
              <Icon name="drawPlan" size={18} /> <span className="hide-sm">Plan bearbeiten</span>
              <span className="show-sm mode-label">Zeichnen</span>
            </button>
            <button type="button" role="tab" aria-selected={!drawMode} onClick={() => switchMode('measure')} data-testid="mode-measure-tab">
              <Icon name="table" size={18} /> <span className="mode-label">Aufmaß</span>
            </button>
          </div>
          {plan.drawing?.paper && (
            <button type="button" className="btn btn-sm sheet-chip" onClick={() => setDetailsOpen(true)} title="Papierformat und Maßstab ändern" data-testid="sheet-label">
              {paperLabel(plan.drawing)}
            </button>
          )}
          {drawMode && (
            <>
              <button
                type="button"
                className={`btn btn-sm${drawing.snapOn ? ' active-toggle' : ''}`}
                onClick={() => drawing.setSnapOn(!drawing.snapOn)}
                aria-pressed={drawing.snapOn}
                aria-label="Einrasten"
                title="An Eck-/Endpunkten anderer Objekte und an 15°-Richtungen einrasten"
                data-testid="snap-toggle"
              >
                <Icon name="snap" size={18} /> <span className="hide-sm">Einrasten {drawing.snapOn ? 'ein' : 'aus'}</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm${drawing.gridOn ? ' active-toggle' : ''}`}
                onClick={() => drawing.setGridOn(!drawing.gridOn)}
                aria-pressed={drawing.gridOn}
                aria-label="Am Raster einrasten"
                title="Am Raster einrasten (aus = Maße frei, z. B. 1,38 m)"
                data-testid="grid-toggle"
              >
                <Icon name="grid" size={18} /> <span className="hide-sm">Raster {drawing.gridOn ? 'ein' : 'aus'}</span>
              </button>
              <OrthoButtons drawing={drawing} />
              <button type="button" className="btn btn-sm btn-primary mode-next" onClick={() => switchMode('measure')} data-testid="mode-measure">
                Weiter<span className="hide-sm"> zum Aufmaß</span> <Icon name="next" size={18} />
              </button>
            </>
          )}
        </div>
      )}
      {!drawMode && !drawingPlan && plan.calibration?.auto && !plan.calibration.auto.confirmed && (
        <div className={`banner ${plan.calibration.auto.warning ? 'banner-warn' : 'banner-info'} scale-banner`} data-testid="scale-detected">
          <p>
            <strong>Maßstab {plan.calibration.auto.label}</strong> automatisch erkannt ({sourceText(plan.calibration.auto)}). Maßvorschläge und Flächen
            aus dem Plan nutzen diesen Maßstab – bitte einmal an einer bekannten Strecke prüfen.
            {plan.calibration.auto.warning && <> {plan.calibration.auto.warning}</>}
          </p>
          <div className="row gap wrap">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                // bestätigt: bleibt als „automatisch erkannt“ gekennzeichnet
                const cal = data.plans[plan.id].calibration!;
                putRecord('plans', { ...data.plans[plan.id], calibration: { ...cal, auto: { ...cal.auto!, confirmed: true } } });
              }}
              data-testid="scale-confirm"
            >
              Passt
            </button>
            <button type="button" className="btn btn-sm" onClick={startCalibrate} data-testid="scale-recalibrate">
              Selbst kalibrieren
            </button>
          </div>
        </div>
      )}
      {dupIds.size > 0 && (
        <div className="banner banner-warn">
          Achtung: In diesem Plan sind Nummern doppelt vergeben (markiert). Bitte korrigieren oder „Lückenlos neu nummerieren“.
        </div>
      )}

      <div className="mobile-tabs segmented" role="tablist">
        <button type="button" role="tab" aria-selected={mobileTab === 'plan'} onClick={() => setMobileTab('plan')}>
          <Icon name="map" size={18} /> Plan
        </button>
        <button type="button" role="tab" aria-selected={mobileTab === 'table'} onClick={() => setMobileTab('table')} data-testid="mobile-tab-table">
          <Icon name="table" size={18} /> Tabelle ({damages.length})
        </button>
      </div>

      <div className={`editor-main show-${mobileTab}${sideCollapsed ? ' side-collapsed' : ''}`} style={{ '--side-w': `${sideWidth}px` } as React.CSSProperties}>
        <div className="editor-plan" ref={planRef}>
          <button
            type="button"
            className="side-toggle"
            onClick={toggleSide}
            aria-expanded={!sideCollapsed}
            aria-label={sideCollapsed ? 'Aufmaß-Tabelle einblenden' : 'Aufmaß-Tabelle ausblenden'}
            title={sideCollapsed ? 'Aufmaß-Tabelle einblenden' : 'Aufmaß-Tabelle nach rechts einklappen'}
            data-testid="side-toggle"
          >
            <Icon name={sideCollapsed ? 'back' : 'next'} size={18} />
          </button>
          {drawMode ? (
            <PlanViewer
              key="draw"
              ref={viewer}
              plan={plan}
              file={null}
              region={region}
              damages={drawing.items}
              selectedId={drawing.selectedId}
              tool={probe ? 'probe' : drawing.viewerTool}
              color={drawing.color}
              pending={null}
              onSelect={(id) => drawing.setSelectedId(id)}
              onCreate={drawing.onCreate}
              onShapeChange={drawing.onShapeChange}
              onLabelChange={() => {}}
              onHistoryChange={() => setHistoryTick((n) => n + 1)}
              components={[]}
              selectedComponentId={null}
              onSelectComponent={() => {}}
              onComponentMove={() => {}}
              onPlace={drawing.onPlace}
              showLabels={false}
              renderItem={drawing.renderItem}
              underlay={region ? drawing.drawUnderlay(region) : undefined}
              overlay={(view, preview, hover) => (
                <>
                  {drawing.drawOverlay(view, preview)}
                  {probe && <ProbeOverlay view={view} probe={probe} hover={hover ?? null} k={k} />}
                </>
              )}
              onProbePoint={probePoint}
              probeFrom={probe && !probe.done && probe.points.length ? probe.points[probe.points.length - 1] : null}
              snap={drawing.snapOn || drawing.gridOn || drawing.orthoOn ? drawing.snap : undefined}
              onLupeChange={setLupeOn}
              bounds={sheetBounds}
              vertexEdit
              selectedVertex={drawing.vertex}
              onVertexSelect={drawing.setVertex}
              onPolygonChange={setPolyCount}
            />
          ) : file || drawingPlan ? (
            <PlanViewer
              key="measure"
              ref={viewer}
              plan={plan}
              file={file}
              region={region}
              underlay={drawingPlan && region ? drawing.measureUnderlay(region) : undefined}
              bounds={markerBounds}
              onPolygonChange={setPolyCount}
              damages={shownDamages}
              selectedId={selectedId}
              tool={tool}
              color={color}
              pending={dialog?.mode === 'new' ? { shape: dialog.shape, color } : null}
              onSelect={(id) => select(id)}
              onCreate={(shape) =>
                tool === 'calibrate'
                  ? void (checking ? runCheck(shape) : calibrate(shape))
                  : setDialog({
                      mode: 'new',
                      shape,
                      ...suggestNext(stored, planNumberStart(plan)),
                      // Wand: Fläche mit offenem Verlauf (Länge × Höhe)
                      kind: tool === 'wall' ? 'area' : defaultKindFor(shape),
                    })
              }
              snap={drawing.snapOn ? measureSnap : undefined}
              onLupeChange={setLupeOn}
              overlay={(view, _preview, hover) => (
                <>
                  {tool === 'calibrate' && plan.calibration && (
                    <>
                      <CalibrationLine view={view} c={plan.calibration} />
                      {plan.calibration.check && <CheckLine view={view} c={plan.calibration.check} />}
                    </>
                  )}
                  {tool === 'probe' && probe && <ProbeOverlay view={view} probe={probe} hover={hover ?? null} k={k} />}
                </>
              )}
              onProbePoint={probePoint}
              probeFrom={probe && !probe.done && probe.points.length ? probe.points[probe.points.length - 1] : null}
              onShapeChange={(id, shape, commit) => {
                if (commit) {
                  setOverrides(({ [id]: _, ...rest }) => rest);
                  const d = data.damages[id];
                  if (JSON.stringify(d.shape) !== JSON.stringify(shape)) putRecord('damages', withShapeMeasures({ ...d, shape }, shape, k));
                } else setOverrides((o) => ({ ...o, [id]: { ...o[id], shape } }));
              }}
              onLabelChange={(id, offset, commit) => {
                if (commit) {
                  setOverrides(({ [id]: _, ...rest }) => rest);
                  putRecord('damages', { ...data.damages[id], labelOffset: offset });
                } else setOverrides((o) => ({ ...o, [id]: { ...o[id], labelOffset: offset } }));
              }}
              onHistoryChange={() => setHistoryTick((n) => n + 1)}
              components={[]}
              selectedComponentId={null}
              onSelectComponent={() => {}}
              onComponentMove={() => {}}
              onPlace={() => {}}
              vertexEdit
              selectedVertex={measureVertex}
              onVertexSelect={setMeasureVertex}
            />
          ) : (
            <div className="viewer-msg error">Originaldatei fehlt.</div>
          )}

          {!drawMode && positionOptions.length > 0 && (
            <div className={`position-chip${activePosition ? ' active' : ''}`} data-testid="current-position" title="Leistung, die neue Messungen automatisch erhalten">
              <span className="muted">Neue Messungen:</span>{' '}
              {activePosition ? (
                <>
                  <strong>{activePosition.pos.number}</strong> <span className="position-chip-text">{activePosition.pos.shortText}</span>
                  <button type="button" className="icon-btn icon-btn-sm" onClick={() => setLastPosition('')} aria-label="Leistungszuordnung für neue Messungen aufheben">
                    <Icon name="close" size={16} />
                  </button>
                </>
              ) : (
                <strong>ohne Leistungszuordnung</strong>
              )}
            </div>
          )}

          <div className="zoom-controls">
            <LayerMenu
              hidden={plan.hiddenLayers ?? []}
              layers={drawingPlan ? undefined : ['measures']}
              planColor={
                drawingPlan
                  ? undefined
                  : {
                      on: !!plan.planColor,
                      onChange: (on) => {
                        const { planColor: _, ...rest } = data.plans[plan.id];
                        putRecord('plans', on ? { ...rest, planColor: true } : rest);
                      },
                    }
              }
              onChange={(hidden) => {
                const { hiddenLayers: _, ...rest } = data.plans[plan.id];
                putRecord('plans', hidden.length ? { ...rest, hiddenLayers: hidden } : rest);
                if (selectedId && hidden.includes('measures')) select(null);
              }}
            />
            <button type="button" className="icon-btn" onClick={() => viewer.current?.zoomIn()} aria-label="Vergrößern" title="Vergrößern (+)">
              <Icon name="plus" />
            </button>
            <button type="button" className="icon-btn" onClick={() => viewer.current?.zoomOut()} aria-label="Verkleinern" title="Verkleinern (−)">
              <Icon name="minus" />
            </button>
            <button type="button" className="icon-btn" onClick={() => viewer.current?.fit()} aria-label="Gesamten Plan anzeigen" title="Gesamten Plan anzeigen (0)">
              <Icon name="fit" />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                const id = drawMode ? drawing.selectedId : selectedId;
                if (id) viewer.current?.zoomTo(id);
              }}
              disabled={!(drawMode ? drawing.selectedId : selectedId)}
              aria-label="Zoom auf Auswahl"
              title="Zoom auf Auswahl"
              data-testid="zoom-selection"
            >
              <Icon name="zoomSel" />
            </button>
            {!drawMode && (
              <button
                type="button"
                className={`icon-btn${drawing.snapOn ? ' active-toggle' : ''}`}
                onClick={() => drawing.setSnapOn(!drawing.snapOn)}
                aria-pressed={drawing.snapOn}
                aria-label="Punktfang"
                title={`Punktfang ${drawing.snapOn ? 'ein' : 'aus'} (Umschalt+X): End-, Schnitt-, Mittelpunkte und Linien · X vergrößert an der Maus`}
                data-testid="snap-toggle-measure"
              >
                <Icon name="snap" />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={() => viewer.current?.back()}
              disabled={!viewer.current?.canGoBack()}
              aria-label="Zur vorherigen Ansicht"
              title="Zur vorherigen Ansicht"
            >
              <Icon name="undoView" />
            </button>
          </div>

          {drawMode && !probe && OP_HINTS[drawing.tool] && !dialog && (
            <div className="draw-bar" data-testid="op-bar">
              <strong className="draw-bar-title">{DRAW_TOOLS.find((t) => t.id === drawing.tool)?.short}</strong>
              <span className="muted small" data-testid="op-hint">
                {drawing.tool === 'stretch' && drawing.stretchWin
                  ? '2. Basispunkt zum Zielpunkt ziehen – die Punkte im Fenster werden verschoben.'
                  : drawing.tool === 'arc' && polyCount
                    ? `${polyCount} von 3 Punkten gesetzt`
                    : OP_HINTS[drawing.tool]}
              </span>
              {drawing.selected && (drawing.tool === 'copy' || drawing.tool === 'move') && (
                <span className="small">Ausgewählt: {elementLabel(drawing.selected)}</span>
              )}
              <button type="button" className="btn btn-sm" onClick={() => drawing.setTool('select')} data-testid="op-cancel">
                Fertig
              </button>
            </div>
          )}
          {drawMode && !probe && !OP_HINTS[drawing.tool] &&
            (drawing.selected && !polyCount ? (
              <ElementBar
                key={drawing.selected.id}
                element={drawing.selected}
                overlapping={drawing.overlapping(drawing.selected).length}
                onApply={(m) => drawing.apply(drawing.selected!.id, m)}
                onText={(t) => drawing.setText(drawing.selected!.id, t)}
                onShowDims={(v) => drawing.setShowDims(drawing.selected!.id, v)}
                vertex={drawing.vertex}
                canRemoveVertex={drawing.canRemoveVertex}
                onRemoveVertex={() => drawing.removeSelectedVertex()}
                onSetClosed={(c) => drawing.setClosed(drawing.selected!.id, c)}
                onStyle={(patch) => drawing.restyle(drawing.selected!.id, patch)}
                styleOpen={styleOpen}
                onToggleStyle={() => setStyleOpen(!styleOpen)}
                onColor={(c) => drawing.recolor(drawing.selected!.id, c)}
                onDelete={() => void drawing.remove(drawing.selected!)}
                onClose={() => drawing.setSelectedId(null)}
              />
            ) : INSERT_TOOLS.has(drawing.tool) ? (
              <InsertBar
                tool={drawing.tool as DrawElementType}
                onInsert={drawing.insert}
                continues={drawing.tool === 'line' && !!drawing.lastLineEnd}
              />
            ) : null)}

          {lupeOn && (
            <div className="zoom-hint small" data-testid="lupe-hint">
              X gehalten: <span className="lupe-dot" /> Fangpunkt · Klick setzt ihn <span className="lupe-dot set" /> · loslassen = zurück · Enter fertig · ⌫ letzter Punkt
            </div>
          )}
          {probe && (drawMode || tool === 'probe') && !dialog && (
            <ProbeBar
              probe={probe}
              k={k}
              onKind={(kind) => setProbe({ kind, points: [], done: false, ref: kind === 'distance' ? probe.ref : null })}
              onFinish={finishProbe}
              onUndo={() => setProbe({ ...probe, points: probe.points.slice(0, -1) })}
              onReset={() => setProbe({ ...probe, points: [], done: false, fromObject: null })}
              onAdopt={adoptProbe}
              onClose={closeProbe}
            />
          )}
          {!probe && (drawMode ? isPointTool(drawing.viewerTool) && (polyCount > 0 || !drawing.selected) : isPointTool(tool) && (polyCount > 0 || !selected)) && !dialog && (
            <PolylineBar polyline={(drawMode ? drawing.tool : tool) === 'polyline'} wall={!drawMode && tool === 'wall'} count={polyCount} viewer={viewer} lineName="Freie Form" />
          )}

          {!drawMode && tool === 'calibrate' && !dialog && (
            <div className="draw-bar" data-testid="calibrate-bar">
              <span className="muted small" data-testid="calibrate-hint">
                {checking
                  ? 'Prüfstrecke: eine andere bemaßte Strecke im Plan ziehen, danach ihre bekannte Länge eingeben – der Maßstab bleibt unverändert.'
                  : file?.kind === 'image'
                    ? 'Bild/Foto: Maßstab kann nicht gelesen werden. Möglichst lange bemaßte Strecke wählen (z. B. ganze Wand): Punkt A und B anklicken oder ziehen, danach die reale Länge eingeben.'
                    : 'Kalibrieren: Punkt A und Punkt B einer bemaßten Strecke anklicken (X halten = vergrößern) oder die Strecke ziehen, danach die reale Länge eingeben.'}
              </span>
              {file?.kind === 'pdf' && (
                <button type="button" className="btn btn-sm" onClick={() => void detectFromPlan()} data-testid="calibration-detect" title="Maßlinien, Maßketten und Maßstabsangabe im Plan auswerten">
                  Automatisch erkennen
                </button>
              )}
              {file?.kind === 'pdf' && (
                <button type="button" className="btn btn-sm" onClick={() => setDimsOpen(true)} data-testid="calibration-dims" title="Erkannte Maße prüfen, korrigieren und übernehmen">
                  Maße aus dem Plan
                </button>
              )}
              {plan.calibration ? (
                <>
                  <strong className={`small${calibrationStatus(plan, file?.kind).warn ? ' text-warn' : ''}`} data-testid="calibration-info" title={calibrationStatus(plan, file?.kind).text}>
                    {plan.calibration.auto
                      ? `Erkannt: ${plan.calibration.auto.label}${plan.calibration.auto.confirmed ? ' (bestätigt)' : ' (ungeprüft)'}`
                      : `Kalibriert: Referenz ${formatMeasure(plan.calibration.meters)} m`}
                    {checkError(plan) !== null && ` · Prüfung ${formatCm(checkError(plan)!.diff)} (${formatPercent(checkDeviation(plan)!)})`}
                  </strong>
                  <button type="button" className={`btn btn-sm${checking ? ' btn-primary' : ''}`} onClick={() => setChecking(!checking)} aria-pressed={checking} data-testid="calibration-check">
                    Prüfstrecke
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setReportOpen(true)} data-testid="calibration-report-open">
                    Prüfbericht
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => putRecord('plans', { ...data.plans[plan.id], calibration: undefined })} data-testid="calibration-remove">
                    Kalibrierung entfernen
                  </button>
                </>
              ) : (
                <strong className="small" data-testid="calibration-info">
                  Noch nicht kalibriert
                </strong>
              )}
            </div>
          )}

          {!drawMode && selected && !dialog && !polyCount && tool !== 'calibrate' && tool !== 'probe' && (
            <div className="selection-bar" data-testid="selection-bar">
              <div className="selection-info">
                <span className="color-dot" style={{ background: selected.color }} />
                <strong>
                  {kindOf(selected) === 'damage' ? '' : `${measureLabel(selected)} `}Nr. {damageNo(selected)}
                </strong>
                <span>{measureSummary(selected)}</span>
                {k && <MeasureCheck damage={selected} k={k} />}
              </div>
              {tool === 'select' ? (
                <div className="selection-hint muted small">Ziehen = verschieben · ⟳ oben = drehen · Eckpunkte (○) einzeln ziehen · Seitengriffe (□) = Seite · Doppelklick auf Kante = Punkt einfügen</div>
              ) : null}
              <div className="row gap">
                {tool !== 'select' && (
                  <button type="button" className="btn btn-sm" onClick={() => setTool('select')} data-testid="adjust-selected">
                    <Icon name="select" size={18} /> Verschieben / Drehen
                  </button>
                )}
                {measureVertex !== null && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => removeMeasureVertex()}
                    disabled={removeVertex(selected.shape, measureVertex) === null}
                    title="Ausgewählten Eckpunkt entfernen (Entf)"
                    data-testid="vertex-remove"
                  >
                    <Icon name="trash" size={16} /> Eckpunkt {measureVertex + 1}
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog({ mode: 'edit', id: selected.id })} data-testid="edit-selected">
                  <Icon name="edit" size={18} /> Bearbeiten
                </button>
                <button type="button" className={`btn btn-sm${styleOpen ? ' active' : ''}`} onClick={() => setStyleOpen(!styleOpen)} aria-expanded={styleOpen} data-testid="style-toggle">
                  Darstellung
                </button>
                <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void removeDamage(selected)} data-testid="delete-selected">
                  <Icon name="trash" size={18} />
                  <span className="sr-only">Löschen</span>
                </button>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setSelectedId(null)} aria-label="Auswahl aufheben">
                  <Icon name="close" size={18} />
                </button>
              </div>
              {styleOpen && (
                <StylePanel
                  color={selected.color}
                  style={selected.style}
                  open={isOpenShape(selected.shape)}
                  defaultWidth={1}
                  kind="damage"
                  onColor={(c) => putRecord('damages', { ...data.damages[selected.id], color: c })}
                  onStyle={(patch) => {
                    const d = data.damages[selected.id];
                    putRecord('damages', { ...d, style: { ...d.style, ...patch } });
                  }}
                />
              )}
            </div>
          )}

          {drawMode ? (
            <DrawRibbon
              drawing={drawing}
              viewer={viewer}
              canUndo={history.undo > 0}
              canRedo={history.redo > 0}
              onUndo={doUndo}
              onRedo={doRedo}
              onMeasure={() => switchMode('measure')}
              probeActive={!!probe}
              onProbe={startProbe}
              onProbeCancel={() => setProbe(null)}
            />
          ) : (
          <div className={`toolbar${toolsOpen ? '' : ' toolbar-collapsed'}`} role="toolbar" aria-label="Werkzeuge">
            {!toolsOpen ? (
              <ToolsOpenButton tool={TOOLS.find((t) => t.id === tool)} onOpen={() => setToolsOpen(true)} />
            ) : (
            <>
            <div className="tool-group">
              {TOOLS.filter((t) => t.id !== 'calibrate' || !drawingPlan).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  // nie zwei zugleich: bei offenem Menü (Messung, Stil) leuchtet nur dessen Knopf
                  className={`tool-btn${(t.id === 'probe' ? probeMenu || (tool === 'probe' && !stylePopOpen) : tool === t.id && !probeMenu && !stylePopOpen) ? ' active' : ''}`}
                  onClick={() => {
                    setStylePopOpen(false);
                    if (t.id === 'probe') {
                      // Menü der Messung öffnen beendet das Kalibrieren
                      if (!probeMenu && tool === 'calibrate') setTool('select');
                      setProbeMenu(!probeMenu);
                    } else {
                      // anderes Werkzeug: Menü der Messung zu, laufende Messung beenden
                      setProbeMenu(false);
                      setProbe(null);
                      setTool(t.id);
                    }
                  }}
                  data-probe-toggle={t.id === 'probe' ? '' : undefined}
                  aria-pressed={tool === t.id}
                  aria-expanded={t.id === 'probe' ? probeMenu : undefined}
                  title={`${t.label} (${t.key.toUpperCase()})`}
                  data-testid={`tool-${t.id}`}
                >
                  <Icon name={t.icon} />
                  <span>{t.short ?? t.label}</span>
                </button>
              ))}
              {probeMenu && <ProbeMenu onPick={startProbe} onClose={() => setProbeMenu(false)} />}
            </div>
            <div className="tool-group colors">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`swatch${color === c.value ? ' active' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => {
                    setColor(c.value);
                    if (selected) putRecord('damages', { ...data.damages[selected.id], color: c.value });
                  }}
                  aria-label={`Farbe ${c.name}`}
                  aria-pressed={color === c.value}
                  title={
                    selected ? `Farbe ${c.name} (auch für Nr. ${damageNo(selected)})` : `Farbe ${c.name}`
                  }
                />
              ))}
            </div>
            <div className="tool-group color-pick">
              <button
                type="button"
                className={`tool-btn${stylePopOpen ? ' active' : ''}`}
                onClick={() => {
                  // Stil öffnen schließt das Menü der Messung und beendet das Kalibrieren (nie zwei zugleich)
                  setProbeMenu(false);
                  if (!stylePopOpen && tool === 'calibrate') setTool('select');
                  setStylePopOpen(!stylePopOpen);
                }}
                aria-expanded={stylePopOpen}
                title="Darstellung neuer Messungen (Linientyp, Stärke, Füllung)"
                data-testid="tool-style"
              >
                <Icon name="layers" />
                <span>Stil</span>
              </button>
              {stylePopOpen && (
                <div className="color-pop style-pop" data-testid="default-style">
                  <div className="pop-title">Darstellung neuer Messungen</div>
                  <StylePanel color={color} style={measureStyle} open={false} defaultWidth={1} kind="damage" hideColor onColor={setColor} onStyle={setMeasureStyle} />
                </div>
              )}
            </div>
            <ToolsCloseButton onClose={() => setToolsOpen(false)} />
            </>
            )}
          </div>
          )}
        </div>

        <div
          className="side-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Breite der Messleiste ändern"
          aria-valuemin={SIDE_MIN}
          aria-valuemax={SIDE_MAX}
          aria-valuenow={sideWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={() => commitSideWidth(SIDE_DEFAULT)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') commitSideWidth(sideWidth + 24);
            else if (e.key === 'ArrowRight') commitSideWidth(sideWidth - 24);
            else return;
            e.preventDefault();
          }}
          title="Ziehen, um die Messleiste breiter oder schmaler zu machen (Doppelklick = Standard)"
          data-testid="side-resizer"
        />

        <aside className="editor-side" data-testid="editor-side">
          <div className="side-head">
            <h2>Aufmaß – {plan.planNumber || planTitle(plan)}</h2>
            <span className="muted small" data-testid="side-summary">
              {damages.length} Messung{damages.length === 1 ? '' : 'en'} · {formatArea(sumArea(damages))} m²
              {lineCount > 0 && ` · Linien ${formatMeasure(sumLengths(damages))} m`}
            </span>
          </div>
          <AufmassTable
            rows={rows}
            selectedId={selectedId}
            duplicates={dupIds}
            positionLabel={(ref) => findPosition(data, ref)?.pos.number ?? null}
            onSelect={(r) => {
              select(r.damage.id, true);
              setMobileTab('plan');
            }}
            onEdit={(r) => setDialog({ mode: 'edit', id: r.damage.id })}
            onDelete={(r) => void removeDamage(r.damage)}
          />
          <div className="side-foot">
            <button type="button" className="btn btn-sm" onClick={() => void compact()}>
              <Icon name="hash" size={18} /> Lückenlos neu nummerieren
            </button>
          </div>
        </aside>
      </div>

      {dialog?.mode === 'new' && (
        <DamageDialog
          mode="new"
          damage={{
            id: '',
            number: dialog.number,
            label: dialog.label,
            color,
            labelOffset: null,
            shapeType: dialog.shape.type,
            kind: dialog.kind,
            positionRef: activePosition ? lastPosition : null,
            // aus einer Messung übernommen: Maße aus dem Plan vorgewählt
            areaFromShape: dialog.fromShape,
          }}
          suggestion={k ? suggestMeasures(dialog.shape, k) : null}
          geometry={geometryMeasures(dialog.shape, k)}
          wall={isWall({ kind: dialog.kind, shape: dialog.shape })}
          others={stored}
          components={[]}
          positions={positionOptions}
          onSave={save}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialogDamage && (
        <DamageDialog
          mode="edit"
          damage={{ ...dialogDamage, shapeType: dialogDamage.shape.type as ShapeType, kind: kindOf(dialogDamage) }}
          suggestion={k ? suggestMeasures(dialogDamage.shape, k) : null}
          geometry={geometryMeasures(dialogDamage.shape, k)}
          wall={isWall(dialogDamage)}
          others={stored}
          components={[]}
          positions={positionOptions}
          onSave={save}
          onCancel={() => setDialog(null)}
          onDelete={() => void removeDamage(dialogDamage)}
        />
      )}
      {excelOpen && plan && <ExcelExportDialog data={data} scope={{ kind: 'plan', planId: plan.id }} onClose={() => setExcelOpen(false)} />}
      {dimsOpen && plan && file && <DimensionReview data={data} plan={plan} file={file} onClose={() => setDimsOpen(false)} />}
      {reportOpen && plan && <CalibrationReport plan={plan} file={file ?? undefined} onClose={() => setReportOpen(false)} />}
      {detailsOpen && <PlanDetailsDialog plan={plan} data={data} onClose={() => setDetailsOpen(false)} />}
      {pdfOpen && <PdfExportDialog data={data} costCenterId={plan.costCenterId} initial={[plan.id]} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}
