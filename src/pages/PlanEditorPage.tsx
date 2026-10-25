import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AufmassTable } from '../components/AufmassTable';
import { DamageDialog, type DamageValues, type Renumber } from '../components/DamageDialog';
import { ElementBar, InsertBar } from '../components/DrawPanel';
import { Icon } from '../components/Icon';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { PlanDetailsDialog } from '../components/PlanFields';
import { PlanViewer, type PlanViewerHandle, type SnapFn, type Tool } from '../components/PlanViewer';
import { SaveErrorBanner, SaveStatus } from '../components/SaveStatus';
import { confirmDialog, offerFile, promptDialog, showError, toast } from '../components/ui';
import { costCenterLabel, damagesOf, elementsOf, exportXlsx, findPosition, lvDocLabel, lvDocsOf, plansOf, planTitle, positionRef, sumArea } from '../lib/aufmass';
import { geometryMeasures, planUnitsPerMeter } from '../lib/calibration';
import { visibleDamages } from '../lib/layers';
import { LayerMenu } from '../components/LayerMenu';
import { drawingRegion, drawingSheet, isDrawingPlan, lineEnds, paperLabel, shapeToPage, suggestMeasures, unitsPerMeter } from '../lib/drawing';
import { convertShape, isOpenShape, toScreen, type View } from '../lib/geometry';
import { countKind, defaultKindFor, hasArea, KIND_LABELS, KINDS, kindOf, sumLengths } from '../lib/measure';
import { checkMeasure, computeArea, formatArea, formatMeasure, toInputValue } from '../lib/numbers';
import { compactNumbers, damageNo, duplicateIds, nextNumber, planNumberStart, shiftNumbers, suggestNext, swapNumbers } from '../lib/numbering';
import { navigate, paths } from '../lib/router';
import { findSnap } from '../lib/snap';
import { clearHistory, newMeta, putRecord, putRecords, redo, softDelete, undo, useAppState, type ProjectState } from '../lib/store';
import { COLORS, SHAPE_LABELS, type Damage, type DrawElementType, type MeasureKind, type Plan, type Shape, type ShapeStyle, type ShapeType } from '../lib/types';
import { DRAW_TOOLS, readStyle, useDrawing, type DrawTool } from './DrawingMode';
import { DrawRibbon, OrthoButtons } from '../components/DrawRibbon';
import { elementLabel } from '../components/DrawPanel';
import { StylePanel } from '../components/StylePanel';

type DialogState = { mode: 'new'; shape: Shape; number: number; label: string | null; kind: MeasureKind } | { mode: 'edit'; id: string } | null;

const TOOLS: { id: Tool; label: string; short?: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Auswählen / Verschieben', short: 'Auswahl', icon: 'select', key: 'v' },
  { id: 'line', label: SHAPE_LABELS.line, icon: 'line', key: 'l' },
  { id: 'rect', label: SHAPE_LABELS.rect, icon: 'rect', key: 'r' },
  { id: 'ellipse', label: SHAPE_LABELS.ellipse, icon: 'ellipse', key: 'k' },
  { id: 'triangle', label: SHAPE_LABELS.triangle, icon: 'triangle', key: 'd' },
  { id: 'polygon', label: 'Fläche: Eckpunkte nacheinander setzen', short: 'Fläche', icon: 'polygon', key: 'p' },
  { id: 'polyline', label: 'Polylinie: Punkte nacheinander setzen – offen (Länge) oder geschlossen (Fläche)', short: 'Polylinie', icon: 'polyline', key: 'f' },
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
const isPointTool = (t: Tool) => t === 'polygon' || t === 'polyline';

/** Leiste beim Setzen von Punkten: Polylinie offen beenden oder schließen, Polygon schließen */
function PolylineBar({ polyline, count, viewer }: { polyline: boolean; count: number; viewer: React.RefObject<PlanViewerHandle | null> }) {
  const name = polyline ? 'Polylinie' : 'Fläche';
  return (
    <div className="draw-bar" data-testid="polygon-bar">
      {count === 0 ? (
        <span className="muted small">
          {polyline
            ? 'Polylinie: Punkte nacheinander antippen. Doppelklick oder Enter beendet sie offen (Länge), Antippen des Startpunkts oder „Schließen“ ergibt eine Fläche.'
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
function withShapeMeasures<T extends Pick<Damage, 'areaFromShape' | 'kind' | 'length' | 'area' | 'width'>>(d: T, shape: Shape, k: number | null): T {
  if (!d.areaFromShape || !hasArea(kindOf(d))) return d;
  const g = geometryMeasures(shape, k);
  return g ? { ...d, length: g.perimeter, width: null, area: g.area } : d;
}

/** Kurzbeschreibung der Maße je Messart */
function measureSummary(d: Pick<Damage, 'kind' | 'length' | 'width' | 'depth' | 'area' | 'areaFromShape'>): string {
  if (!hasArea(kindOf(d))) return `L ${formatMeasure(d.length)} m`;
  const depth = d.depth !== null ? ` · T ${formatMeasure(d.depth)} m` : '';
  if (d.areaFromShape && d.area !== null) return `${formatArea(d.area)} m² aus Plan · U ${formatMeasure(d.length)} m${depth}`;
  // ohne Breite/Höhe: nur die Länge, keine Fläche
  if (d.width === null || d.area === null) return `L ${formatMeasure(d.length)} m${depth}`;
  return `${formatMeasure(d.length)} × ${formatMeasure(d.width)} m${depth} = ${formatArea(d.area)} m²`;
}

/**
 * Gezeichnete Pläne: Maße der Markierung laut Plan (Maßstab bekannt) zur Kontrolle; weichen sie
 * mehr als 5 % von den eingetragenen Werten ab (z. B. nach Formänderung), wird gewarnt.
 */
function MeasureCheck({ damage, k }: { damage: Damage; k: number }) {
  if (damage.areaFromShape) {
    return (
      <span className="small muted" data-testid="measure-check">
        Fläche und Umfang werden aus der Form berechnet
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
  const [tool, setToolState] = useState<Tool>(() => loadPref('tool', TOOLS.map((t) => t.id), 'ellipse'));
  const [color, setColorState] = useState(() => loadPref('color', COLORS.map((c) => c.value), DEFAULT_COLOR));
  const [selectedId, setSelectedId] = useState<string | null>(focusDamageId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<Damage>>>({});
  const [mobileTab, setMobileTab] = useState<'plan' | 'table'>('plan');
  const [detailsOpen, setDetailsOpen] = useState(false);
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
    const hit = findSnap(p, shapes, (matchMedia('(pointer: coarse)').matches ? 16 : 9) / ctx.scale);
    return hit ? { ...hit.point, kind: hit.kind } : p;
  };

  // Gezeichnete Pläne haben ihren Maßstab – dort gibt es kein Kalibrieren
  useEffect(() => {
    if (drawingPlan && tool === 'calibrate') setTool('select');
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
    toast(`Plan kalibriert: Strecke = ${formatMeasure(r.value)} m. Gespeicherte Messwerte bleiben unverändert.`, 'success', 4000);
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
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || document.querySelector('.modal')) return;
      const key = e.key.toLowerCase();
      // Punktwerkzeuge: Enter beendet (Polylinie offen, Polygon geschlossen), C schließt,
      // Rücktaste nimmt den letzten Punkt zurück, Escape verwirft
      if (polyCount && ['Enter', 'Escape', 'Backspace'].includes(e.key) || (polyCount && key === 'c' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        if (e.key === 'Enter') viewer.current?.finishPolygon();
        else if (key === 'c') viewer.current?.finishPolygon(true);
        else if (e.key === 'Backspace') viewer.current?.undoPolygonPoint();
        else viewer.current?.cancelPolygon();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // X: Punktfang ein/aus (wie in CAD-Programmen)
      // F8 wie in CAD-Programmen: 90° / Orthogonal ein/aus (nur beim Zeichnen)
      if (e.key === 'F8' && drawMode) {
        e.preventDefault();
        drawing.setOrthoOn(!drawing.orthoOn);
        toast(`90° / Orthogonal ${drawing.orthoOn ? 'aus' : 'ein'}`, 'info', 1500);
        return;
      }
      if (key === 'x') {
        e.preventDefault();
        drawing.setSnapOn(!drawing.snapOn);
        toast(`Punktfang ${drawing.snapOn ? 'aus' : 'ein'}`, 'info', 1500);
        return;
      }
      if (drawMode) {
        const dt = DRAW_TOOLS.find((x) => x.key === key);
        if (dt) drawing.setTool(dt.id);
        else if (e.key === 'Escape') drawing.setSelectedId(null);
        else if ((e.key === 'Delete' || e.key === 'Backspace') && drawing.selected) {
          // ausgewählter Eckpunkt zuerst, sonst das ganze Objekt
          if (!drawing.removeSelectedVertex()) void drawing.remove(drawing.selected);
        }
        else if (!['+', '=', '-', '0'].includes(e.key)) return;
        if (dt || e.key === 'Escape' || e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          return;
        }
      }
      const t = TOOLS.find((x) => x.key === key);
      if (t && !drawMode) setTool(t.id);
      else if (e.key === '+' || e.key === '=') viewer.current?.zoomIn();
      else if (e.key === '-') viewer.current?.zoomOut();
      else if (e.key === '0') viewer.current?.fit();
      else if (e.key === 'Escape') setSelectedId(null);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        void removeDamage(selected);
      } else if (e.key === 'Enter' && selected) setDialog({ mode: 'edit', id: selected.id });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
  const siblings = plansOf(data, plan.costCenterId);
  const idx = siblings.findIndex((p) => p.id === plan.id);

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

  const save = (v: DamageValues, renumber: Renumber) => {
    if (!dialog) return;
    // Fläche aus der Geometrie: aus der endgültigen Form (auch nach einem Formwechsel) berechnen
    const finalShape = convertShape(dialog.mode === 'new' ? dialog.shape : data.damages[dialog.id].shape, v.shapeType);
    const geo = v.areaFromShape && hasArea(v.kind) ? geometryMeasures(finalShape, k) : null;
    const area = geo ? geo.area : hasArea(v.kind) && v.width !== null ? computeArea(v.length, v.width) : null;
    const measures = {
      kind: v.kind,
      length: geo ? geo.perimeter : v.length,
      width: hasArea(v.kind) && !geo ? v.width : null,
      depth: hasArea(v.kind) ? v.depth : null,
      area,
      areaFromShape: geo ? true : undefined,
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
    storePref('measureKind', v.kind);
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
      const amount = area !== null ? `${formatArea(area)} m²` : `${formatMeasure(v.length)} m`;
      toast(`${KIND_LABELS[v.kind]} ${shown} gespeichert (${amount}).`, 'success', 2500);
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
    const label = `${KIND_LABELS[kindOf(d)]} ${damageNo(d)}`;
    const ok = await confirmDialog({
      title: `${label} löschen?`,
      message: (
        <p>
          {label} ({measureSummary(d)}) wird gelöscht. Die Nummern der übrigen Messungen bleiben unverändert. Mit „Rückgängig“ lässt sich
          das Löschen zurücknehmen.
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

  const exportExcel = () => {
    try {
      void offerFile(exportXlsx(data, { kind: 'plan', planId: plan.id }));
    } catch (e) {
      showError(e, 'Excel-Export fehlgeschlagen');
    }
  };

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
          <button type="button" className="btn btn-sm" onClick={() => setDetailsOpen(true)} title="Planangaben">
            <Icon name="info" size={18} /> <span className="hide-sm">Angaben</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={exportExcel} title="Aufmaß dieses Plans als Excel" data-testid="export-xlsx-plan">
            <Icon name="excel" size={18} /> <span className="hide-sm">Excel</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPdfOpen(true)} title="Plan als PDF" data-testid="export-pdf-plan">
            <Icon name="pdf" size={18} /> <span className="hide-sm">PDF</span>
          </button>
        </div>
      </header>
      <SaveErrorBanner />
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

      <div className={`editor-main show-${mobileTab}`} style={{ '--side-w': `${sideWidth}px` } as React.CSSProperties}>
        <div className="editor-plan" ref={planRef}>
          {drawMode ? (
            <PlanViewer
              key="draw"
              ref={viewer}
              plan={plan}
              file={null}
              region={region}
              damages={drawing.items}
              selectedId={drawing.selectedId}
              tool={drawing.viewerTool}
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
              overlay={drawing.drawOverlay}
              snap={drawing.snapOn || drawing.gridOn || drawing.orthoOn ? drawing.snap : undefined}
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
                  ? void calibrate(shape)
                  : setDialog({
                      mode: 'new',
                      shape,
                      ...suggestNext(stored, planNumberStart(plan)),
                      kind: defaultKindFor(shape, loadPref('measureKind', KINDS, 'damage')),
                    })
              }
              snap={drawing.snapOn ? measureSnap : undefined}
              overlay={tool === 'calibrate' && plan.calibration ? (view) => <CalibrationLine view={view} c={plan.calibration!} /> : undefined}
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
                title={`Punktfang ${drawing.snapOn ? 'ein' : 'aus'} (X): End-, Schnitt-, Mittelpunkte und Linien`}
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

          {drawMode && OP_HINTS[drawing.tool] && !dialog && (
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
          {drawMode && !OP_HINTS[drawing.tool] &&
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

          {(drawMode ? isPointTool(drawing.viewerTool) && (polyCount > 0 || !drawing.selected) : isPointTool(tool) && (polyCount > 0 || !selected)) && !dialog && (
            <PolylineBar polyline={(drawMode ? drawing.tool : tool) === 'polyline'} count={polyCount} viewer={viewer} />
          )}

          {!drawMode && tool === 'calibrate' && !dialog && (
            <div className="draw-bar" data-testid="calibrate-bar">
              <span className="muted small">
                Kalibrieren: Strecke bekannter Länge im Plan ziehen (z. B. eine bemaßte Wand), danach die reale Länge eingeben.
              </span>
              {plan.calibration ? (
                <>
                  <strong className="small" data-testid="calibration-info">
                    Kalibriert: Referenz {formatMeasure(plan.calibration.meters)} m
                  </strong>
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

          {!drawMode && selected && !dialog && !polyCount && tool !== 'calibrate' && (
            <div className="selection-bar" data-testid="selection-bar">
              <div className="selection-info">
                <span className="color-dot" style={{ background: selected.color }} />
                <strong>
                  {kindOf(selected) === 'damage' ? '' : `${KIND_LABELS[kindOf(selected)]} `}Nr. {damageNo(selected)}
                </strong>
                <span>{measureSummary(selected)}</span>
                {k && <MeasureCheck damage={selected} k={k} />}
              </div>
              {tool === 'select' ? (
                <div className="selection-hint muted small">Ziehen = verschieben · ⟳ oben = drehen · Ecken = Größe</div>
              ) : null}
              <div className="row gap">
                {tool !== 'select' && (
                  <button type="button" className="btn btn-sm" onClick={() => setTool('select')} data-testid="adjust-selected">
                    <Icon name="select" size={18} /> Verschieben / Drehen
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
                  className={`tool-btn${tool === t.id ? ' active' : ''}`}
                  onClick={() => setTool(t.id)}
                  aria-pressed={tool === t.id}
                  title={`${t.label} (${t.key.toUpperCase()})`}
                  data-testid={`tool-${t.id}`}
                >
                  <Icon name={t.icon} />
                  <span>{t.short ?? t.label}</span>
                </button>
              ))}
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
                onClick={() => setStylePopOpen(!stylePopOpen)}
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
          }}
          suggestion={k ? suggestMeasures(dialog.shape, k) : null}
          geometry={geometryMeasures(dialog.shape, k)}
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
          others={stored}
          components={[]}
          positions={positionOptions}
          onSave={save}
          onCancel={() => setDialog(null)}
          onDelete={() => void removeDamage(dialogDamage)}
        />
      )}
      {detailsOpen && <PlanDetailsDialog plan={plan} data={data} onClose={() => setDetailsOpen(false)} />}
      {pdfOpen && <PdfExportDialog data={data} costCenterId={plan.costCenterId} initial={[plan.id]} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}
