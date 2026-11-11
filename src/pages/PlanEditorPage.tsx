import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AufmassTable } from '../components/AufmassTable';
import { deductionNumbers } from '../lib/numbering';
import { RotatePlanDialog } from '../components/RotatePlanDialog';
import { DamageDialog, type DamageValues, type DrawnDeduction, type Renumber } from '../components/DamageDialog';
import { ElementBar, InsertBar } from '../components/DrawPanel';
import { Icon } from '../components/Icon';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { PlanDetailsDialog } from '../components/PlanFields';
import { PlanViewer, type PlanViewerHandle, type SnapFn, type Tool } from '../components/PlanViewer';
import { SaveErrorBanner, SaveStatus } from '../components/SaveStatus';
import { invoiceLabel, invoiceOfPlan } from '../lib/invoices';
import { confirmDialog, promptDialog, showError, toast } from '../components/ui';
import { getPhotoStorage } from '../lib/photo-storage';
import { photoNoteUpdates } from '../lib/photo-notes';
import { legendEntries, resolveLegend } from '../lib/legend';
import { LegendBox, LegendDialog } from '../components/LegendDialog';
import type { PhotoSite } from '../lib/types';
import { positionGrouping, costCenterLabel, damagesOf, findPosition, lvDocLabel, lvDocsOf, plansOf, planTitle, positionRef, sumArea } from '../lib/aufmass';
import { calibrationStatus, checkDeviation, checkError, formatCm, formatPercent, geometryMeasures, MAX_ERROR_M, planUnitsPerMeter } from '../lib/calibration';
import { ViewMenu } from '../components/ViewMenu';
import { isTouchDevice } from '../lib/platform';
import { DimensionReview } from '../components/DimensionReview';
import { ExcelExportDialog } from '../components/ExcelExportDialog';
import { calibrationFrom, detectScale, sourceText } from '../lib/scale-detect';
import { visibleDamages } from '../lib/layers';
import { LayerMenu } from '../components/LayerMenu';
import { drawingRegion, printSheetRect, isDrawingPlan, lineEnds, paperLabel, shapeToMeters, shapeToPage, suggestMeasures, unitsPerMeter } from '../lib/drawing';
import { convertShape, isOpenShape, lineShape, moveVertex, polygonShape, removeVertex, rotatePoint, shapeVertices, toPage, toScreen, type Point, type View } from '../lib/geometry';
import { probeTarget, type ProbeKind } from '../lib/probe';
import { ProbeBar, ProbeMenu, ProbeOverlay, type ProbeState } from '../components/ProbeLayer';
import { choiceIcon, choiceLabel, MEASURE_CHOICES, MeasureTypeMenu, type MeasureChoice } from '../components/MeasureTypeMenu';
import { calcPath, defaultTypeFor, DEFAULT_WORK_AREAS, quantityOfMeasure, typeInfo, typeOf } from '../lib/measure-types';
import { circleThrough } from '../lib/cad';
import { countKind, deductionText, grossArea, hasArea, isWall, kindOf, measureLabel, netArea, netLength, sumLengths } from '../lib/measure';
import { round2, checkMeasure, computeArea, formatArea, formatMeasure, toInputValue } from '../lib/numbers';
import { compactNumbers, damageNo, duplicateIds, nextNumber, planNumberStart, shiftNumbers, suggestNext, swapNumbers } from '../lib/numbering';
import { navigate, paths } from '../lib/router';
import { findSnap } from '../lib/snap';
import { HatchPreview, hatchLabel } from '../components/HatchPicker';
import { hatchAnchor } from '../lib/style';
import { SegIndex } from '../lib/pdf-snap';
import { clearHistory, newMeta, putRecord, putRecords, redo, softDelete, undo, useAppState, type ProjectState } from '../lib/store';
import { COLORS, SHAPE_LABELS, type Damage, type DrawElementType, type MeasureKind, type MeasureType, type Plan, type Shape, type ShapeStyle, type ShapeType } from '../lib/types';
import { DRAW_TOOLS, PICK_TOOLS, readStyle, SELECT_FIRST, useDrawing, VECTOR_COMMANDS, type DrawTool } from './DrawingMode';
import { CommandBar } from '../components/CommandBar';
import { symbolDef } from '../lib/symbols';
import { DrawRibbon, OrthoButtons } from '../components/DrawRibbon';
import { StylePanel } from '../components/StylePanel';

type DialogState = { mode: 'new'; shape: Shape; number: number; label: string | null; kind: MeasureKind; measureType: MeasureType; fromShape?: boolean; points?: number } | { mode: 'edit'; id: string } | null;

const TOOLS: { id: Tool; label: string; short?: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Auswählen / Verschieben', short: 'Auswahl', icon: 'select', key: 'v' },
  { id: 'line', label: SHAPE_LABELS.line, icon: 'line', key: 'l' },
  { id: 'rect', label: SHAPE_LABELS.rect, icon: 'rect', key: 'r' },
  { id: 'ellipse', label: SHAPE_LABELS.ellipse, icon: 'ellipse', key: 'k' },
  { id: 'polygon', label: 'Fläche: Eckpunkte nacheinander setzen', short: 'Fläche', icon: 'polygon-a', key: 'p' },
  { id: 'polyline', label: 'Freie Form: Punkte nacheinander setzen – offen (Länge) oder geschlossen (Fläche), z. B. ein Dreieck', short: 'Freie Form', icon: 'polyline', key: 'f' },
  // Freihand: ohne Absetzen zeichnen – bleibt genau so (z. B. Risse); am Startpunkt beendet = Fläche
  { id: 'freehand', label: 'Freihand: ohne Absetzen zeichnen – Linie genau wie gezeichnet (z. B. Riss), am Startpunkt beenden ergibt eine Fläche', short: 'Freihand', icon: 'freehand', key: 'h' },
  { id: 'wall', label: 'Wand: Verlauf mit Knicken setzen, Enter oder Doppelklick beendet – danach Wandhöhe eingeben', short: 'Wand', icon: 'wall', key: 'w' },
  // nur bei der Messart Stück: jeder angetippte Punkt zählt ein Stück
  { id: 'points', label: 'Punkte: jedes Stück im Plan antippen – jeder Punkt zählt, „Fertig“ übernimmt die Anzahl', short: 'Punkte', icon: 'pin', key: 'z' },
  { id: 'text', label: 'Text: Stelle antippen und Text eingeben – Farbe, Schriftart, fett, kursiv; mit „Auswahl“ antippen zum Ändern, ziehen zum Verschieben', short: 'Text', icon: 'text', key: 't' },
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
  dimension: 'Maßlinie: 1. Punkt A anklicken, 2. Punkt B anklicken, 3. auf den gewünschten Abstand ziehen und klicken – die Maßlinie bleibt auf A und B bezogen.',
  stretch: '1. Fenster über die Eckpunkte ziehen, die sich bewegen sollen.',
  trim: 'Stutzen: Abschnitt anklicken, der bis zu den nächsten Kanten bzw. Eckpunkten entfernt wird – oder frei über mehrere Linien ziehen (Zaun), um alle gekreuzten Abschnitte zu stutzen.',
  extend: 'Die Linie nahe dem Ende anklicken, das bis zur nächsten Kante verlängert werden soll.',
};

/** Werkzeuge, die Punkt für Punkt gesetzt werden */
const isPointTool = (t: Tool) => t === 'polygon' || t === 'polyline' || t === 'wall';

/** Leiste beim Setzen von Punkten: Polylinie (im Zeichenmodus „Freie Form“) offen beenden oder schließen, Fläche schließen */
function PolylineBar({
  polyline,
  count,
  viewer,
  lineName = 'Polylinie',
  wall = false,
  onInput,
}: {
  polyline: boolean;
  count: number;
  viewer: React.RefObject<PlanViewerHandle | null>;
  lineName?: string;
  wall?: boolean;
  /** Plan zeichnen: Länge des nächsten Abschnitts eintippen (liefert Fehlermeldung oder null) */
  onInput?: (text: string) => string | null;
}) {
  const name = wall ? 'Wand' : polyline ? lineName : 'Fläche';
  // nach jedem Knick: Länge des nächsten Abschnitts eintippen (Zeigerrichtung, ΔX;ΔY oder Länge<Winkel)
  if (onInput && count > 0)
    return (
      <CommandBar
        testId="polygon-bar"
        title={`${name}: ${count} Punkt${count === 1 ? '' : 'e'}`}
        prompt="Nächsten Punkt antippen – oder Länge eintippen: in Zeigerrichtung (2,5), ΔX;ΔY (2,5;0) bzw. Länge<Winkel (3<90)."
        onInput={onInput}
        placeholder="z. B. 2,5 · 2,5;0 · 3<90"
      >
        {wall ? (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => viewer.current?.finishPolygon(false)} disabled={count < 2} data-testid="wall-finish">
              <Icon name="check" size={18} /> Fertig
            </button>
            <button type="button" className="btn btn-sm" onClick={() => viewer.current?.finishPolygon(true)} disabled={count < 3} title="Raum schließen: letzte Wand zurück zum Anfang (oder Startpunkt antippen)" data-testid="wall-close">
              Schließen
            </button>
          </>
        ) : (
          <>
            {polyline && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => viewer.current?.finishPolygon(false)} disabled={count < 2} data-testid="polyline-open">
                <Icon name="check" size={18} /> Offen beenden
              </button>
            )}
            <button type="button" className={`btn btn-sm${polyline ? '' : ' btn-primary'}`} onClick={() => viewer.current?.finishPolygon(true)} disabled={count < 3} data-testid="polygon-finish">
              {!polyline && <Icon name="check" size={18} />} {polyline ? 'Schließen (Fläche)' : 'Fläche schließen'}
            </button>
          </>
        )}
        <button type="button" className="btn btn-sm" onClick={() => viewer.current?.undoPolygonPoint()} title="Letzten Punkt entfernen (Rücktaste)" data-testid="polygon-undo-point">
          <Icon name="undo" size={18} /> Punkt
        </button>
        <button type="button" className="btn btn-sm" onClick={() => viewer.current?.cancelPolygon()} data-testid="polygon-cancel">
          Abbrechen
        </button>
      </CommandBar>
    );
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
            : 'Fläche: Punkte nacheinander antippen wie bei der Polylinie – beliebig viele. Startpunkt antippen, doppelt tippen, Enter oder „Fläche schließen“ ergibt die geschlossene Fläche.'}
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

/** Zeichenwerkzeuge, die am Handy/Tablet nach Gebrauch mit dem nächsten Fingertipp enden (Ändern-Befehle nicht) */
const DRAW_DONE_TOOLS = new Set<string>(['line', 'polyline', 'rect', 'ellipse', 'arc', 'polygon', 'dimension', 'text']);

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
function withShapeMeasures<T extends Pick<Damage, 'areaFromShape' | 'kind' | 'length' | 'area' | 'width' | 'deductions'> & Partial<Pick<Damage, 'measureType' | 'count'>>>(d: T, shape: Shape, k: number | null): T {
  if (!d.areaFromShape) return d;
  if (d.measureType === 'stueck' || d.measureType === 'frei') return d;
  const n = d.count && d.count > 1 ? d.count : 1;
  // Linie mit Länge aus dem Plan: Gesamtlänge aller Abschnitte bzw. Umfang (Höhe/Tiefe bleiben)
  if (!hasArea(kindOf(d))) return k ? { ...d, length: pathLengthOf(shape, k) } : d;
  // Wand: Länge aus allen Abschnitten (bzw. Umfang), Höhe bleibt → Wandfläche neu
  if (isWall({ kind: d.kind, shape, measureType: d.measureType })) {
    if (!k) return d;
    const length = pathLengthOf(shape, k);
    return { ...d, length, area: d.width !== null ? netArea(times(computeArea(length, d.width), n), d.deductions) : null };
  }
  const g = geometryMeasures(shape, k);
  return g ? { ...d, length: g.perimeter, width: null, area: netArea(times(g.area, n), d.deductions) } : d;
}

/** Fläche × Anzahl (ohne Rundungsrauschen) */
const times = (a: number, n: number) => (n === 1 ? a : Math.round(a * n * 1e9) / 1e9);

/** Länge aus dem Plan: offene Form = alle Abschnitte, geschlossene Form = Umfang */
function pathLengthOf(shape: Shape, k: number): number {
  if (isOpenShape(shape)) return suggestMeasures(shape, k).length;
  return geometryMeasures(shape, k)?.perimeter ?? suggestMeasures(shape, k).length;
}

/** Kurzbeschreibung der Maße je Messart */
function measureSummary(d: Pick<Damage, 'kind' | 'length' | 'width' | 'depth' | 'area' | 'areaFromShape' | 'shape' | 'deductions'> & Partial<Pick<Damage, 'measureType' | 'count' | 'qty' | 'unit' | 'formula'>>): string {
  // Stück, Frei, Volumen und Anzahl > 1: Rechenweg der Messart
  if (d.measureType === 'stueck' || d.measureType === 'frei' || d.measureType === 'volumen' || (d.count ?? 1) > 1) return calcPath(d) || '–';
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
  /** Messart neuer Messungen (zuerst wählen, dann mit jedem Werkzeug zeichnen); „auto“ = aus der Form */
  const [mtype, setMtypeState] = useState<MeasureChoice>(() => loadPref('measureType', MEASURE_CHOICES, 'auto'));
  const [mtypeMenu, setMtypeMenu] = useState(false);
  const setMtype = (c: MeasureChoice) => {
    setMtypeState(c);
    storePref('measureType', c);
  };
  /** Arbeitsbereiche zur Auswahl: Vorgaben und alle im Projekt schon benutzten */
  const workAreas = useMemo(
    () => [...new Set([...DEFAULT_WORK_AREAS, ...Object.values(data.damages).filter((d) => d.projectId === plan?.projectId && !d.deletedAt && d.workArea).map((d) => d.workArea!)])],
    [data.damages, plan?.projectId],
  );
  /** Werkzeuge je Messart: Wand nur bei Wand (bzw. automatisch), Punkte nur bei Stück */
  const toolVisible = (id: Tool, c: MeasureChoice = mtype) => (id === 'wall' ? c === 'wand' || c === 'auto' : id === 'points' ? c === 'stueck' : true);
  /** Stück zählen: angetippte Punkte (Seitenkoordinaten), bis „Fertig“ */
  const [pointMarks, setPointMarks] = useState<Point[]>([]);
  useEffect(() => {
    if (tool !== 'points') setPointMarks([]);
  }, [tool]);
  // gemerktes Werkzeug passt nicht zur Messart (z. B. Wand bei Fläche) → Rechteck
  useEffect(() => {
    if (!toolVisible(tool)) setToolState(mtype === 'stueck' ? 'points' : 'rect');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtype]);
  /** Punkte übernehmen: eine Stück-Messung mit allen Punkten, Anzahl = Zahl der Punkte */
  const finishPoints = () => {
    if (!plan || !pointMarks.length) return;
    const pts = pointMarks.length === 1 ? [pointMarks[0], pointMarks[0]] : pointMarks;
    const shape = polygonShape(pts, false);
    setDialog({ mode: 'new', shape, ...suggestNext(stored, planNumberStart(plan)), kind: 'line', measureType: 'stueck', points: pointMarks.length });
    setPointMarks([]);
  };
  /** Messart für eine neu gezeichnete Form */
  const typeForNew = (shape: Shape): MeasureType => (tool === 'wall' ? 'wand' : mtype === 'auto' ? defaultTypeFor(shape) : mtype);
  /** Aufmaß: ausgewählter Eckpunkt der ausgewählten Messung (zum Entfernen) */
  const [measureVertex, setMeasureVertex] = useState<number | null>(null);
  useEffect(() => setMeasureVertex(null), [selectedId]);
  const [dialog, setDialog] = useState<DialogState>(null);
  /** Abzug im Plan zeichnen: Messfenster ausgeblendet, nächste gezeichnete Form wird zum Abzug */
  const [dedDraw, setDedDraw] = useState<{ prevTool: Tool } | null>(null);
  const [drawnDed, setDrawnDed] = useState<DrawnDeduction | null>(null);
  /** in diesem Fenster gezeichnete Abzüge (bis zum Speichern im Plan sichtbar) */
  const [sessionDeds, setSessionDeds] = useState<DedItem[]>([]);
  useEffect(() => {
    if (dialog) return;
    setDedDraw(null);
    setDrawnDed(null);
    setSessionDeds([]);
  }, [dialog]);
  const [overrides, setOverrides] = useState<Record<string, Partial<Damage>>>({});
  const [mobileTab, setMobileTab] = useState<'plan' | 'table'>('plan');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  /** Kalibrieren: Prüfstrecke statt Referenzstrecke ziehen; Prüfbericht */
  const [checking, setChecking] = useState(false);
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
  // Gezeichnete Pläne: zuletzt gewählter Modus je Plan (sonst „Plan bearbeiten“) – auch nach Neuladen bzw. Abgleich
  const modeKey = `editorMode:${planId}`;
  const initialMode = (): 'draw' | 'measure' => {
    if (!isDrawingPlan(data.plans[planId])) return 'measure';
    try {
      const m = localStorage.getItem(modeKey);
      if (m === 'draw' || m === 'measure') return m;
    } catch {
      /* egal */
    }
    return 'draw';
  };
  const [mode, setModeState] = useState<'draw' | 'measure'>(initialMode);
  const setMode = (m: 'draw' | 'measure') => {
    setModeState(m);
    try {
      localStorage.setItem(modeKey, m);
    } catch {
      /* egal */
    }
  };
  const drawMode = drawingPlan && mode === 'draw';
  /** Darstellung: Bedienfeld der ausgewählten Messung bzw. Voreinstellung für neue Messungen */
  const [styleOpen, setStyleOpen] = useState(false);
  const [stylePopOpen, setStylePopOpen] = useState(false);
  const stylePopRef = useRef<HTMLDivElement>(null);
  // Stil-Menü schließt bei einem Klick außerhalb (Plan, Werkzeuge, Messleiste) – wie das Kalibrieren
  useEffect(() => {
    if (!stylePopOpen) return;
    const close = (e: PointerEvent) => {
      if (!stylePopRef.current?.contains(e.target as Node)) setStylePopOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [stylePopOpen]);
  const [measureStyle, setMeasureStyleState] = useState<ShapeStyle>(() => readStyle('measureStyle'));
  const setMeasureStyle = (patch: Partial<ShapeStyle>) => {
    const next = { ...measureStyle, ...patch };
    setMeasureStyleState(next);
    storePref('measureStyle', JSON.stringify(next));
  };
  /** Werkzeugleiste aufgeklappt (klappt nach dem Zeichnen zu, damit der Plan frei bleibt) */
  const [toolsOpen, setToolsOpen] = useState(true);
  /** Leiste wurde durch Tippen auf den Plan zugeklappt (iPad/Handy) – nach dem Fertigstellen wieder öffnen */
  const autoClosed = useRef(false);
  const reopenTools = () => {
    if (!autoClosed.current) return false;
    autoClosed.current = false;
    // Tablet: Leiste wieder auf; Handy: bleibt zu (sie würde den kleinen Plan verdecken)
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 700px)').matches) return false;
    setToolsOpen(true);
    return true;
  };
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
    if (t !== 'calibrate') setChecking(false);
    // anderes Werkzeug: Stil-Menü schließen (wie beim Kalibrieren)
    setStylePopOpen(false);
    // Punktfang (blau) ist bei jedem Werkzeug an
    if (t !== 'select' && !drawing.snapOn) drawing.setSnapOn(true);
    setToolState(t);
    storePref('tool', t);
  };
  const setColor = (c: string) => {
    setColorState(c);
    storePref('color', c);
  };
  const startDedDraw = () => {
    setDedDraw({ prevTool: tool });
    if (!['rect', 'polygon', 'triangle', 'ellipse', 'freehand'].includes(tool)) setTool('rect');
  };
  const finishDedDraw = (shape: Shape) => {
    if (!dedDraw || !k) return;
    // Maße aus dem Plan erkennen: Rechteck = Breite × Höhe, sonst die Fläche der Form
    const m = shapeToMeters(shape, k);
    const geo = geometryMeasures(shape, k);
    const rect = shape.type === 'rect';
    const length = rect ? m.w : (geo?.area ?? 0);
    const width = rect ? m.h : 1;
    setTool(dedDraw.prevTool);
    setDedDraw(null);
    if (!(length > 0) || !(width > 0)) return toast('Abzug konnte nicht erkannt werden – bitte eine geschlossene Form ziehen.', 'error');
    setSessionDeds((l) => [...l, { shape, label: `A${l.length + 1}`, color: DED_DEFAULT }]);
    setDrawnDed({ seq: Date.now(), length, width, shape });
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
    setModeState(initialMode());
    setLastPositionState(loadLastPosition(planId));
    return () => clearHistory();
  }, [planId]);

  const stored = useMemo(() => (plan ? damagesOf(data, plan.id) : []), [data, plan]);
  // Fotos folgen der Messung: Vermerk „Aufmaß <Plan> Nr. …“ in der Fotodokumentation bei neuer Nummer nachziehen
  const photoPrefixText = plan ? `Aufmaß ${plan.planNumber || planTitle(plan)}` : '';
  const photoSig = stored
    .filter((d) => d.photoIds?.length)
    .map((d) => `${d.id}:${damageNo(d)}:${d.photoIds!.join(',')}`)
    .join('|');
  useEffect(() => {
    if (!photoSig || !photoPrefixText) return;
    void (async () => {
      const storage = getPhotoStorage();
      const photos = await storage.list();
      for (const u of photoNoteUpdates(photoPrefixText, stored, photos)) {
        const p = photos.find((x) => x.id === u.id);
        if (p) await storage.update({ ...p, description: u.description });
      }
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSig, photoPrefixText]);
  const projectPlans = useMemo(() => Object.values(data.plans).filter((p) => !p.deletedAt), [data.plans]);
  // Legende: je Plan eigene Farben; an/aus, Lage und Bezeichnungen mit Vorgaben aus den anderen Plänen des Projekts
  const legendInfo = useMemo(() => (plan ? resolveLegend(plan, Object.values(data.plans)) : null), [plan, data.plans]);
  const legend = useMemo(() => (legendInfo ? legendEntries({ legendLabels: legendInfo.labels }, stored) : []), [legendInfo, stored]);
  /** gespeicherte, im Plan gezeichnete Abzüge (schraffiert, Nummer „A1“ … je Messung) */
  const planDeds = useMemo(
    () =>
      stored.flatMap((d) => {
        const nos = deductionNumbers(d);
        return (d.deductions ?? []).flatMap((x, xi) => {
          if (!x.shape) return [];
          const no = nos[xi];
          // Bezeichnung dazu, wenn gewählt (nicht der Vorschlag „Abzug 1“ / „Zuschlag 1“)
          const name = x.label && !/^(Abzug|Zuschlag) \d+$/.test(x.label) ? ` ${x.label}` : '';
          return [{ shape: x.shape, label: `${no}${name}`, labelAt: x.labelAt, damageId: d.id, dedId: x.id, color: x.color }];
        });
      }),
    [stored],
  );
  /** Maße eines gezeichneten Abzugs aus dem Plan (Rechteck: Breite × Höhe, sonst Fläche × 1) */
  const dedMeasures = (shape: Shape): { length: number; width: number } | null => {
    if (!k) return null;
    const m = shapeToMeters(shape, k);
    const geo = geometryMeasures(shape, k);
    const rect = shape.type === 'rect' && !(shape.rotation ?? 0);
    const length = round2(rect ? m.w : (geo?.area ?? 0));
    const width = rect ? round2(m.h) : 1;
    return length > 0 && width > 0 ? { length, width } : null;
  };
  /** Form eines im Plan gezeichneten Abzugs/Zuschlags geändert: Maße neu erkennen, Nettofläche nachführen */
  const editDedShape = (damageId: string, dedId: string, shape: Shape) => {
    const d = data.damages[damageId];
    if (!d || !k) return;
    const m = shapeToMeters(shape, k);
    const geo = geometryMeasures(shape, k);
    const rect = shape.type === 'rect' && !(shape.rotation ?? 0);
    const length = round2(rect ? m.w : (geo?.area ?? 0));
    const width = rect ? round2(m.h) : 1;
    if (!(length > 0)) return;
    const deductions = (d.deductions ?? []).map((x) => (x.id === dedId ? { ...x, shape, length, width } : x));
    const gross = grossArea(d);
    putRecord('damages', { ...d, deductions, area: gross !== null ? netArea(gross, deductions) : d.area });
  };
  /** Nummer eines im Plan gezeichneten Abzugs verschoben */
  const moveDedLabel = (damageId: string, dedId: string, at: Point) => {
    const d = data.damages[damageId];
    if (!d) return;
    putRecord('damages', { ...d, deductions: (d.deductions ?? []).map((x) => (x.id === dedId ? { ...x, labelAt: { x: at.x, y: at.y } } : x)) });
  };
  const damages = useMemo(() => stored.map((d) => (overrides[d.id] ? { ...d, ...overrides[d.id] } : d)), [stored, overrides]);
  // Ebene „Messungen“ ausgeblendet: nicht im Plan (die Tabelle bleibt vollständig)
  const shownDamages = useMemo(() => visibleDamages(plan, damages), [plan, damages]);
  const dupIds = useMemo(() => {
    return duplicateIds(stored);
  }, [stored]);
  const selected = damages.find((d) => d.id === selectedId) ?? null;
  const drawing = useDrawing({ plan, data, damages, viewer, onCreated: () => void (reopenTools() || setToolsOpen(false)) });
  // fertig (Messung gespeichert bzw. abgebrochen, Kalibrieren beendet) → zugeklappte Leiste wieder öffnen
  const hadDialog = useRef(false);
  useEffect(() => {
    if (dialog) hadDialog.current = true;
    else if (hadDialog.current) {
      hadDialog.current = false;
      reopenTools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);
  useEffect(() => {
    if ((drawMode ? drawing.tool : tool) === 'select') reopenTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, drawing.tool, drawMode]);
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
  // Plan messen: Blatt im gewählten Format, die Zeichnung füllt es zentriert (wie im PDF); Plan bearbeiten bleibt
  // unbegrenzt. Nur die Zeichnung bestimmt das Blatt – neue Messungen verschieben die Ansicht nicht.
  const sheetRect = useMemo(
    () => (plan && drawingPlan ? printSheetRect(plan, drawing.allElements, []) : null),
    [plan, drawingPlan, drawing.allElements],
  );
  const measureRegion = sheetRect ?? region;

  /** Gültiger Bereich für neue Formen: gezeichnete Pläne unbegrenzt (wie der Modellbereich im CAD,
   *  der PDF-Export skaliert passend aufs Format), importierte Pläne der Planausschnitt */
  const markerBounds = !plan || drawingPlan ? undefined : (plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight });
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
      // Strg+A: alle Objekte auswählen (Plan bearbeiten)
      if (drawMode && (e.ctrlKey || e.metaKey) && !e.altKey && key === 'a') {
        e.preventDefault();
        drawing.selectAll();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // F11 wie in CAD-Programmen: Spurlinien ein/aus
      if (e.key === 'F11' && drawMode) {
        e.preventDefault();
        drawing.setTrackOn(!drawing.trackOn);
        toast(`Spurlinien ${drawing.trackOn ? 'aus' : 'ein'}`, 'info', 1500);
        return;
      }
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
        else if (e.key === 'Enter' && (SELECT_FIRST.has(drawing.tool) || drawing.tool === 'offset')) {
          // Enter beendet Kopieren/Verschieben/Versetzen (bzw. „Weiter“ nach dem Wählen)
          if (drawing.cmdSelecting && drawing.selection.length) drawing.cmdNext();
          else drawing.finishCommand();
          e.preventDefault();
          return;
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && drawing.selection.length > 1) void drawing.removeSelection();
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
      if (t && !drawMode && toolVisible(t.id)) setTool(t.id);
      else if (e.key === 'Enter' && tool === 'points' && pointMarks.length) finishPoints();
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
  // Fotodokumentation des Projekts (gleiche Baustelle wie in den anderen Werkzeugen)
  const photoSite: PhotoSite = { projectId: data.project.id, name: data.project.site || data.project.name, number: data.project.number ?? '', address: data.project.address };
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
    const mt: MeasureType = mtype !== 'auto' ? mtype : probe.kind === 'area' ? 'flaeche' : 'laenge';
    setDialog({ mode: 'new', shape, ...suggestNext(stored, planNumberStart(plan)), kind: typeInfo(mt).kind, measureType: mt, fromShape: true });
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
    const noDims = v.measureType === 'stueck' || v.measureType === 'frei';
    // Linie mit Länge aus dem Plan: Gesamtlänge aller Abschnitte (bzw. Umfang), wird bei Formänderungen nachgeführt
    const wall = isWall({ kind: v.kind, shape: finalShape, measureType: v.measureType });
    const geo = !noDims && v.areaFromShape && hasArea(v.kind) && !wall ? geometryMeasures(finalShape, k) : null;
    const lineFromPlan = !noDims && v.areaFromShape && (!hasArea(v.kind) || wall) && k ? pathLengthOf(finalShape, k) : null;
    const gross1 = noDims ? null : geo ? geo.area : hasArea(v.kind) && v.width !== null ? computeArea(lineFromPlan ?? v.length, v.width) : null;
    // Anzahl: Fläche × Anzahl (Länge bleibt je Stück, die Summe rechnet mit der Anzahl)
    const gross = gross1 === null ? null : times(gross1, v.count);
    // Abzüge/Zuschläge (Tür, Öffnung …): Flächen mit berechneter Fläche bzw. Linien (Teillängen)
    const deductions = !noDims && v.deductions.length && (hasArea(v.kind) ? gross !== null : true) ? v.deductions : undefined;
    const area = netArea(gross, deductions);
    const measures = {
      kind: v.kind,
      measureType: v.measureType,
      count: v.count > 1 ? v.count : undefined,
      workArea: v.workArea,
      damageType: v.damageType,
      formula: v.formula,
      unit: v.unit,
      qty: v.qty,
      length: noDims ? 0 : geo ? geo.perimeter : (lineFromPlan ?? v.length),
      // Linie: Breite = Höhe, getrennt von der Länge – ergibt keine Fläche
      width: geo || noDims ? null : v.width,
      depth: noDims ? null : v.depth,
      area,
      deductions,
      areaFromShape: geo || lineFromPlan !== null ? true : undefined,
      componentId: v.componentId,
      positionRef: v.positionRef,
      label: v.label,
      note: v.note,
      rebar: v.rebar,
      rebarItems: v.rebarItems.length ? v.rebarItems : null,
      photoIds: v.photoIds.length ? v.photoIds : undefined,
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
    // Vermerk in der Fotodokumentation, wenn das Foto noch keine Beschreibung hat
    if (v.photoIds.length) {
      const note = `Aufmaß ${plan.planNumber || planTitle(plan)} Nr. ${shown}`;
      void (async () => {
        const storage = getPhotoStorage();
        for (const p of (await storage.list()).filter((p) => v.photoIds.includes(p.id) && !p.description.trim())) await storage.update({ ...p, description: note });
      })().catch(() => {});
    }
    if (dialog.mode === 'new') {
      const dmg: Damage = {
        ...newMeta(),
        projectId: plan.projectId,
        planId: plan.id,
        number,
        shape: convertShape(dialog.shape, v.shapeType),
        color: v.color,
        labelOffset: null,
        ...(Object.keys(measureStyle).length || dialog.points ? { style: { ...measureStyle, ...(dialog.points ? { points: true } : {}) } } : {}),
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
      const q = quantityOfMeasure({ ...measures, shape: finalShape });
      const amount = q.value !== null ? `${formatArea(q.value)}${q.unit ? ` ${q.unit}` : ''}` : area !== null ? `${formatArea(area)} m²` : `${formatMeasure(netLength({ kind: v.kind, length: measures.length, deductions, measureType: v.measureType, count: v.count }))} m`;
      toast(`${measureLabel({ kind: v.kind, shape: finalShape, measureType: v.measureType })} ${shown} gespeichert (${amount}).`, 'success', 2500);
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
    doc.positions.map((p) => ({ ref: positionRef(doc.id, p.id), doc: lvDocLabel(doc), label: `${p.number} ${p.shortText} (${p.unit || '–'})`, number: p.number, shortText: p.shortText, unit: p.unit })),
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

          {!drawingPlan && !drawMode && file && (
            <ViewMenu
              gray={!plan.planColor}
              onGray={(gray) => {
                const { planColor: _, ...rest } = data.plans[plan.id];
                putRecord('plans', gray ? rest : { ...rest, planColor: true });
              }}
              prefix="plan"
              colorTestId="plan-view"
            />
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
              <button
                type="button"
                className={`btn btn-sm${drawing.trackOn ? ' active-toggle' : ''}`}
                onClick={() => drawing.setTrackOn(!drawing.trackOn)}
                aria-pressed={drawing.trackOn}
                aria-label="Spurlinien"
                title="Spurlinien (F11): waagrechte und senkrechte Hilfslinien durch angefahrene Fangpunkte – rastet an der Flucht und an Schnittpunkten ein"
                data-testid="track-toggle"
              >
                <Icon name="grid" size={18} /> <span className="hide-sm">Spuren {drawing.trackOn ? 'ein' : 'aus'}</span>
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
        <div
          className="editor-plan"
          ref={planRef}
          onPointerDownCapture={(e) => {
            // iPad/Handy: Werkzeug gewählt und auf den Plan getippt → Leiste unten zuklappen, damit der Plan frei ist
            if (e.pointerType === 'mouse' || (drawMode ? drawing.tool : tool) === 'select' || !toolsOpen) return;
            const t = e.target as Element;
            if (!t.closest?.('[data-testid="plan-viewer"]') || t.closest('button, a, input, select, textarea, label')) return;
            autoClosed.current = true;
            setToolsOpen(false);
          }}
        >
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
              closableWall
              lineClickOnly
              toolDoneAnyPointer
              hatchUnit={hatchAnchor(unitsPerMeter(plan), plan.drawing?.scale ?? 100)}
              ref={viewer}
              plan={plan}
              file={null}
              region={region}
              onToolDone={DRAW_DONE_TOOLS.has(drawing.tool) ? () => drawing.setTool('select') : undefined}
              onExitTool={() => drawing.setTool('select')}
              damages={drawing.items}
              selectedId={drawing.selectedId}
              tool={probe ? 'probe' : drawing.viewerTool}
              color={drawing.color}
              pending={null}
              onSelect={(id) => drawing.select(id)}
              onClickStart={drawing.setCmdBase}
              onHover={drawing.onHover}
              tipText={drawing.tipText}
              onCreate={drawing.onCreate}
              onFence={drawing.onFence}
              onDimension={drawing.onDimension}
              formatLength={drawing.formatLength}
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
                  {drawing.drawOverlay(view, preview, hover ?? null)}
                  {probe && <ProbeOverlay view={view} probe={probe} hover={hover ?? null} k={k} />}
                </>
              )}
              onProbePoint={probePoint}
              probeFrom={probe && !probe.done && probe.points.length ? probe.points[probe.points.length - 1] : null}
              snap={drawing.snapOn || drawing.gridOn || drawing.orthoOn ? drawing.snap : undefined}
              onLupeChange={setLupeOn}
              infinite
              vertexEdit
              selectedVertex={drawing.vertex}
              onVertexSelect={drawing.setVertex}
              onPolygonChange={setPolyCount}
            />
          ) : file || drawingPlan ? (
            <PlanViewer
              key="measure"
              hatchUnit={drawingPlan ? hatchAnchor(unitsPerMeter(plan), plan.drawing?.scale ?? 100) : 1}
              ref={viewer}
              plan={plan}
              file={file}
              region={drawingPlan ? measureRegion : region}
              infinite={drawingPlan && !sheetRect}
              restoreView={!drawingPlan}
              onToolDone={tool !== 'select' && tool !== 'probe' && tool !== 'calibrate' ? () => setTool('select') : undefined}
              onExitTool={() => {
                // außerhalb des Plans getippt: Auswahl, alle Werkzeuge (auch Kalibrieren und Messung) aus
                setProbe(null);
                setProbeMenu(false);
                setStylePopOpen(false);
                setChecking(false);
                setTool('select');
              }}
              underlay={drawingPlan && measureRegion ? drawing.measureUnderlay(measureRegion, !!sheetRect) : drawing.textUnderlay}
              notes={tool === 'select' ? drawing.textNotes : undefined}
              onNoteTap={(id) => void drawing.editText(id)}
              onNoteMove={drawing.moveText}
              bounds={markerBounds}
              onPolygonChange={setPolyCount}
              damages={shownDamages}
              selectedId={selectedId}
              tool={tool}
              color={color}
              pending={dialog?.mode === 'new' ? { shape: dialog.shape, color } : null}
              onSelect={(id) => select(id)}
              onCreate={(shape) =>
                dedDraw
                  ? finishDedDraw(shape)
                  : tool === 'calibrate'
                  ? void (checking ? runCheck(shape) : calibrate(shape))
                  : (() => {
                      // Messart: im Aufmaß gewählt (Werkzeug Wand → Wand), sonst aus der Form
                      const mt = typeForNew(shape);
                      setDialog({ mode: 'new', shape, ...suggestNext(stored, planNumberStart(plan)), kind: typeInfo(mt).kind, measureType: mt });
                    })()
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
                  {tool === 'points' &&
                    pointMarks.map((p, i) => {
                      const q = toScreen(view, p);
                      return (
                        <g key={i} className="point-mark" data-testid="point-mark">
                          <circle cx={q.x} cy={q.y} r={9} fill={color} stroke="#fff" strokeWidth={2} />
                          <text x={q.x} y={q.y + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill="#fff">
                            {i + 1}
                          </text>
                        </g>
                      );
                    })}
                  <DeductionOverlay view={view} items={[...planDeds, ...sessionDeds]} onMoveLabel={moveDedLabel} onEditShape={k ? editDedShape : undefined} tapToEdit={tool === 'select'} />
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
              onPlace={(p) => {
                if (tool === 'points') {
                  setPointMarks((m) => [...m, p]);
                  return;
                }
                if (tool !== 'text') return;
                void drawing.placeText(p).then((ok) => ok && setTool('select'));
              }}
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

          {legendInfo?.show && !drawMode && <LegendBox entries={legend} pos={legendInfo.pos} onOpen={() => setLegendOpen(true)} />}
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
            {!drawMode && (
              <button type="button" className={`icon-btn${legendInfo?.show ? ' active' : ''}`} onClick={() => setLegendOpen(true)} aria-label="Farblegende" title="Farblegende: Bezeichnung je Farbe (im Plan und im PDF)" data-testid="editor-legend">
                <Icon name="legend" />
              </button>
            )}
            {!drawingPlan && !drawMode && file && (
              <button type="button" className="icon-btn" onClick={() => setRotateOpen(true)} aria-label="Plan drehen" title="Plan drehen (Messungen drehen mit, auch im Export)" data-testid="editor-rotate">
                <Icon name="rotate" />
              </button>
            )}
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
                  : (drawing.tool === 'arc' || drawing.tool === 'dimension') && polyCount
                    ? drawing.tool === 'dimension'
                      ? polyCount === 1
                        ? '1. Punkt A gesetzt – jetzt Punkt B anklicken.'
                        : '2. Punkt B gesetzt – jetzt auf den gewünschten Abstand ziehen und klicken.'
                      : `${polyCount} von 3 Punkten gesetzt`
                    : OP_HINTS[drawing.tool]}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => drawing.setTool('select')} data-testid="op-cancel">
                Fertig
              </button>
            </div>
          )}
          {drawMode && !probe && !dialog && (SELECT_FIRST.has(drawing.tool) || PICK_TOOLS.has(drawing.tool) || drawing.tool === 'offset' || drawing.tool === 'symbol' || (drawing.tool === 'wall' && !polyCount) || (drawing.tool === 'line' && drawing.cmdBase)) && !(drawing.tool === 'array' && !drawing.cmdSelecting && !drawing.arrayPolar) && (() => {
            const t = drawing.tool;
            const n = drawing.selection.length;
            const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
            const prompt =
              SELECT_FIRST.has(t) && drawing.cmdSelecting
                ? `Objekte wählen: antippen oder Fenster aufziehen (nach links = auch berührte) – dann „${t === 'join' ? 'Verbinden' : 'Weiter'}“. Ausgewählt: ${n}${t === 'join' ? ` · Lücken bis ${formatMeasure(drawing.joinTol)} m werden geschlossen (Wert eingeben zum Ändern)` : ''}`
                : t === 'wall'
                  ? `Wand ${formatMeasure(drawing.wallThickness)} m stark${drawing.wallHeight ? `, ${formatMeasure(drawing.wallHeight)} m hoch` : ''}: Anfangspunkt und Knicke antippen, Enter bzw. „Fertig“ beendet – Startpunkt antippen bzw. „Schließen“ schließt den Raum. Stärke eintippen (bzw. Stärke;Höhe).`
                : t === 'symbol'
                  ? (() => {
                      const def = symbolDef(drawing.symbolId);
                      const w = drawing.symbolSize?.w ?? def?.w ?? 0;
                      const h = drawing.symbolSize?.h ?? def?.h ?? 0;
                      return `${def?.label ?? 'Bauteil'} ${formatMeasure(w)} × ${formatMeasure(h)} m: Stelle antippen – auf einer Linie bzw. Wand richtet es sich aus. Größe eintippen (Breite bzw. Breite;Tiefe).`;
                    })()
                : t === 'hatch'
                  ? (
                      <span data-testid="hatch-prompt">
                        In eine geschlossene Fläche tippen – sie wird mit <strong>{hatchLabel(drawing.hatchSet)}</strong> schraffiert (auch mehrere nacheinander; im Raum einer geschlossenen Wand bis zur Wandinnenseite).
                      </span>
                    )
                : t === 'room'
                  ? <span data-testid="room-prompt">In einen geschlossenen Raum tippen – Name eingeben, die Fläche (m²) wird automatisch ermittelt (auch aus einzelnen Wänden und Linien).</span>
                : t === 'guide'
                  ? drawing.guideErase
                    ? `Hilfslinie antippen, die gelöscht werden soll (${drawing.guides.length} vorhanden).`
                    : drawing.guideAngle === 'free'
                      ? drawing.pickPts.length
                        ? '2. Punkt antippen – bestimmt die Richtung – oder Winkel eintippen.'
                        : '1. Punkt der Hilfslinie antippen (Fang hilft).'
                      : `Punkt antippen – Hilfslinie unter ${drawing.guideAngle.replace('.', ',')}°. Anderen Winkel eintippen, z. B. 30.`
                : t === 'fillet'
                  ? drawing.filletSrc
                    ? `Zweite Linie antippen – Radius ${formatMeasure(drawing.filletR)} m.`
                    : `Erste Linie antippen (der angetippte Teil bleibt) – oder die Ecke einer Fläche. Radius ${formatMeasure(drawing.filletR)} m${drawing.filletR ? '' : ' = scharfe Ecke'} (Wert eingeben zum Ändern).`
                : t === 'distance'
                  ? drawing.distRes
                    ? (
                        <span data-testid="distance-result">
                          Abstand <strong>{formatMeasure(drawing.distRes.d)} m</strong>
                          {drawing.distRes.rel === 'parallel' ? ' · parallel' : drawing.distRes.rel === 'perpendicular' ? ' · rechtwinklig' : drawing.distRes.angle !== undefined ? ` · Winkel ${String(Math.round(drawing.distRes.angle * 10) / 10).replace('.', ',')}°` : ''}
                          {` · ΔX ${formatMeasure(Math.abs(drawing.distRes.q.x - drawing.distRes.p.x))} · ΔY ${formatMeasure(Math.abs(drawing.distRes.q.y - drawing.distRes.p.y))}`} – nächsten Punkt antippen für eine neue Messung.
                        </span>
                      )
                    : drawing.distPicks.length
                      ? 'Zweiten Punkt, Linie oder Objekt antippen.'
                      : 'Punkt, Linie oder Objekt antippen – dann das zweite. Ändert nichts an der Zeichnung.'
                : t === 'rotate'
                  ? (() => {
                      const m = drawing.pickPts.length;
                      if (!m) return `Drehpunkt antippen (Fang hilft). ${plural(n, 'Objekt', 'Objekte')}.`;
                      if (!drawing.refMode) return `Winkel zeigen und antippen${drawing.rotStep ? ` (in ${drawing.rotStep}°-Schritten)` : ''} – oder eintippen, z. B. 90 bzw. -45 (positiv = gegen den Uhrzeigersinn).`;
                      if (m === 1) return 'Bezug: 1. Punkt der Bezugsrichtung antippen – oder Bezugswinkel eintippen.';
                      if (m === 2) return 'Bezug: 2. Punkt der Bezugsrichtung antippen.';
                      return 'Neue Richtung zeigen und antippen – oder neuen Winkel eintippen.';
                    })()
                : t === 'scale'
                  ? (() => {
                      const m = drawing.pickPts.length;
                      if (!m) return `Basispunkt antippen – er bleibt beim Skalieren stehen. ${plural(n, 'Objekt', 'Objekte')}.`;
                      if (!drawing.refMode) return 'Faktor eintippen, z. B. 2 oder 0,5 – X;Y getrennt z. B. 2;1 – oder „Bezug“ wählen.';
                      if (m === 1) return 'Bezug: Anfangspunkt einer bekannten Strecke antippen.';
                      if (m === 2) return 'Bezug: Endpunkt der Strecke antippen.';
                      return 'Neue Länge eintippen (m) – oder neuen Endpunkt antippen.';
                    })()
                : t === 'align'
                  ? ['1. Punkt am Objekt antippen (Quelle).', '2. Punkt am Objekt antippen – bestimmt die Richtung.', '1. Zielpunkt antippen.', '2. Zielpunkt antippen – bestimmt die neue Richtung.'][Math.min(3, drawing.pickPts.length)]
                : t === 'array'
                  ? 'Mittelpunkt der Reihe antippen (Fang hilft, z. B. Kreismitte).'
                  : t === 'mirror'
                  ? drawing.cmdBase
                    ? '2. Punkt der Spiegelachse antippen – oder Richtung eingeben, z. B. 1<90 (senkrecht) bzw. 1<0 (waagrecht).'
                    : `1. Punkt der Spiegelachse antippen (oder Achse ziehen) – mit 90° waagrecht/senkrecht. ${plural(n, 'Objekt', 'Objekte')}.`
                  : t === 'offset'
                    ? drawing.offsetSrc
                      ? drawing.offsetThrough
                        ? 'Durch Punkt: Stelle antippen, durch die die parallele Kopie laufen soll.'
                        : `Seite antippen – die Kopie entsteht im Abstand ${formatMeasure(drawing.offsetDist)} m.`
                      : `Objekt antippen, das versetzt werden soll · Abstand ${drawing.offsetThrough ? 'durch Punkt' : `${formatMeasure(drawing.offsetDist)} m`} (Wert eingeben zum Ändern).`
                    : VECTOR_COMMANDS.has(t)
                      ? drawing.cmdBase
                        ? drawing.copies
                          ? `${plural(drawing.copies, 'Kopie', 'Kopien')} erstellt – nächsten Zielpunkt antippen (gleicher Basispunkt) oder „Fertig“.`
                          : 'Zielpunkt antippen – oder Abstand in Mausrichtung, ΔX;ΔY bzw. Länge<Winkel eingeben.'
                        : `${drawing.copies ? `${plural(drawing.copies, 'Kopie', 'Kopien')} erstellt. ` : ''}Basispunkt antippen (oder vom Basis- zum Zielpunkt ziehen) – oder Verschiebung ΔX;ΔY bzw. Länge<Winkel eingeben. ${plural(n, 'Objekt', 'Objekte')}.`
                      : 'Endpunkt antippen – oder Länge in Mausrichtung, ΔX;ΔY bzw. Länge<Winkel eingeben.';
            const withInput = (!(SELECT_FIRST.has(t) && drawing.cmdSelecting) || t === 'join') && t !== 'array' && t !== 'align' && t !== 'distance' && t !== 'hatch' && t !== 'room' && !(t === 'guide' && drawing.guideErase);
            return (
              <CommandBar
                key={t}
                title={DRAW_TOOLS.find((x) => x.id === t)?.short ?? ''}
                prompt={prompt}
                onInput={withInput ? drawing.applyInput : undefined}
                placeholder={t === 'wall' ? 'Stärke, z. B. 0,25' : t === 'offset' ? 'Abstand, z. B. 0,25' : t === 'join' ? 'Lücke, z. B. 0,05' : t === 'symbol' ? 'Breite, z. B. 0,9' : t === 'rotate' || t === 'guide' ? 'Winkel, z. B. 90' : t === 'fillet' ? 'Radius, z. B. 0,5' : t === 'scale' ? (drawing.refMode ? 'Länge, z. B. 4,5' : 'Faktor, z. B. 2') : undefined}
              >
                {SELECT_FIRST.has(t) && drawing.cmdSelecting && (
                  <button type="button" className="btn btn-sm btn-primary" disabled={!n} onClick={drawing.cmdNext} data-testid="command-next">
                    {t === 'join' ? 'Verbinden' : t === 'array' ? 'Weiter: Werte' : 'Weiter'}
                  </button>
                )}
                {t === 'offset' && (
                  <button type="button" className={`btn btn-sm${drawing.offsetThrough ? ' active-toggle' : ''}`} aria-pressed={drawing.offsetThrough} onClick={() => drawing.setOffsetThrough(!drawing.offsetThrough)} data-testid="offset-through">
                    Durch Punkt
                  </button>
                )}
                {t === 'mirror' && (
                  <label className="check-row small" data-testid="mirror-keep-row">
                    <input type="checkbox" checked={drawing.mirrorKeep} onChange={(e) => drawing.setMirrorKeep(e.target.checked)} data-testid="mirror-keep" />
                    <span>Original behalten</span>
                  </label>
                )}
                {t === 'guide' && (
                  <>
                    <select value={['free', '0', '45', '90', '135'].includes(drawing.guideAngle) ? drawing.guideAngle : 'custom'} onChange={(e) => (drawing.setGuideAngle(e.target.value), drawing.setGuideErase(false))} aria-label="Winkel der Hilfslinie" data-testid="guide-angle">
                      <option value="0">0° waagrecht</option>
                      <option value="45">45°</option>
                      <option value="90">90° senkrecht</option>
                      <option value="135">135°</option>
                      <option value="free">frei (2 Punkte)</option>
                      {!['free', '0', '45', '90', '135'].includes(drawing.guideAngle) && <option value="custom">{drawing.guideAngle.replace('.', ',')}°</option>}
                    </select>
                    <button type="button" className={`btn btn-sm${drawing.guideErase ? ' active-toggle' : ''}`} aria-pressed={drawing.guideErase} onClick={() => drawing.setGuideErase(!drawing.guideErase)} disabled={!drawing.guides.length} data-testid="guide-erase">
                      Löschen
                    </button>
                    <button type="button" className="btn btn-sm" onClick={drawing.clearGuides} disabled={!drawing.guides.length} data-testid="guide-clear">
                      Alle löschen
                    </button>
                  </>
                )}
                {t === 'hatch' && (
                  <button type="button" className="btn btn-sm hatch-open" onClick={() => void drawing.pickHatch()} data-testid="hatch-change">
                    <HatchPreview s={drawing.hatchSet} w={34} h={20} /> <span>Muster ändern</span>
                  </button>
                )}
                {t === 'distance' && drawing.distRes && drawing.distRes.d > 1e-6 && (
                  <button type="button" className="btn btn-sm" onClick={drawing.distToDimension} data-testid="distance-dimension">
                    Als Maß einfügen
                  </button>
                )}
                {(t === 'rotate' || t === 'scale') && !drawing.cmdSelecting && (
                  <button type="button" className={`btn btn-sm${drawing.refMode ? ' active-toggle' : ''}`} aria-pressed={drawing.refMode} onClick={() => drawing.setRefMode(!drawing.refMode)} title={t === 'rotate' ? 'Bezug: eine vorhandene Richtung (zwei Punkte) auf eine neue Richtung drehen' : 'Bezug: eine bekannte Strecke (zwei Punkte) auf eine neue Länge bringen'} data-testid="transform-ref">
                    Bezug
                  </button>
                )}
                {t === 'rotate' && !drawing.cmdSelecting && (
                  <select value={drawing.rotStep} onChange={(e) => drawing.setRotStep(Number(e.target.value))} aria-label="Winkelschritte" title="Winkel beim Zeigen auf Schritte runden" data-testid="rotate-step">
                    <option value={0}>frei</option>
                    <option value={5}>5°</option>
                    <option value={15}>15°</option>
                    <option value={45}>45°</option>
                    <option value={90}>90°</option>
                  </select>
                )}
                {t === 'align' && !drawing.cmdSelecting && (
                  <label className="check-row small" data-testid="align-move-row">
                    <input type="checkbox" checked={drawing.alignMove} onChange={(e) => drawing.setAlignMove(e.target.checked)} data-testid="align-move" />
                    <span>auch verschieben</span>
                  </label>
                )}
                {t === 'symbol' && (
                  <button type="button" className="btn btn-sm" onClick={() => void drawing.pickSymbol(symbolDef(drawing.symbolId)?.group ?? 'door')} data-testid="symbol-change">
                    Anderes Bauteil
                  </button>
                )}
                {(SELECT_FIRST.has(t) || PICK_TOOLS.has(t) || t === 'offset' || t === 'symbol') && (
                  <button type="button" className="btn btn-sm" onClick={drawing.finishCommand} data-testid="command-done">
                    {(t === 'copy' && drawing.copies) || t === 'offset' || t === 'symbol' || PICK_TOOLS.has(t) ? 'Fertig' : 'Abbrechen'}
                  </button>
                )}
              </CommandBar>
            );
          })()}
          {drawMode && !probe && !dialog && !SELECT_FIRST.has(drawing.tool) && !PICK_TOOLS.has(drawing.tool) && drawing.tool !== 'offset' && drawing.tool !== 'symbol' && drawing.selection.length > 1 && (
            <div className="draw-bar multi-bar" data-testid="multi-bar">
              <strong className="draw-bar-title">{drawing.selection.length} Objekte ausgewählt</strong>
              <button type="button" className="btn btn-sm" onClick={() => drawing.setTool('move')} data-testid="multi-move">
                <Icon name="move" size={16} /> Verschieben
              </button>
              <button type="button" className="btn btn-sm" onClick={() => drawing.setTool('copy')} data-testid="multi-copy">
                <Icon name="copy" size={16} /> Kopieren
              </button>
              <button type="button" className="btn btn-sm" onClick={() => drawing.setTool('mirror')} data-testid="multi-mirror">
                <Icon name="mirror" size={16} /> Spiegeln
              </button>
              <button type="button" className="btn btn-sm" onClick={() => drawing.setTool('array')} data-testid="multi-array">
                <Icon name="array" size={16} /> Reihe
              </button>
              <button type="button" className="btn btn-sm" onClick={() => drawing.setTool('join')} data-testid="multi-join">
                <Icon name="join" size={16} /> Verbinden
              </button>
              <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void drawing.removeSelection()} data-testid="multi-delete">
                <Icon name="trash" size={16} /> Löschen
              </button>
              <button type="button" className="icon-btn icon-btn-sm" onClick={drawing.clearSelection} aria-label="Auswahl aufheben" data-testid="multi-clear">
                <Icon name="close" size={18} />
              </button>
            </div>
          )}
          {drawMode && !probe && !OP_HINTS[drawing.tool] && !SELECT_FIRST.has(drawing.tool) && !PICK_TOOLS.has(drawing.tool) && drawing.tool !== 'offset' && drawing.tool !== 'symbol' && !(drawing.tool === 'wall' && !polyCount && !drawing.selected) && !(drawing.tool === 'line' && drawing.cmdBase) &&
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
                onExtGap={(mm) => drawing.setExtGap(drawing.selected!.id, mm)}
                onFont={(f) => drawing.setFont(drawing.selected!.id, f)}
                onFlip={(axis) => drawing.flipSymbol(drawing.selected!.id, axis)}
                onRoom={() => void drawing.editRoom(drawing.selected!.id)}
                onWall={(patch) => drawing.setWall(drawing.selected!.id, patch)}
                onSegment={(i, len) => drawing.setSegment(drawing.selected!.id, i, len)}
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
          {!probe && !drawMode && tool === 'points' && !dialog && !mtypeMenu && !probeMenu && !stylePopOpen && (
            <div className="draw-bar" data-testid="points-bar">
              {pointMarks.length === 0 ? (
                <span className="muted small">Stück: jedes Stück im Plan antippen – jeder Punkt zählt. „Fertig“ übernimmt die Anzahl.</span>
              ) : (
                <>
                  <strong className="draw-bar-title" data-testid="points-count">
                    {pointMarks.length} Stk
                  </strong>
                  <button type="button" className="btn btn-sm btn-primary" onClick={finishPoints} data-testid="points-done">
                    <Icon name="check" size={18} /> Fertig
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setPointMarks((m) => m.slice(0, -1))} title="Letzten Punkt entfernen" data-testid="points-undo">
                    <Icon name="undo" size={18} /> Punkt
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setPointMarks([])} data-testid="points-cancel">
                    Abbrechen
                  </button>
                </>
              )}
            </div>
          )}
          {!probe && !(!drawMode && (mtypeMenu || probeMenu || stylePopOpen)) && (drawMode ? isPointTool(drawing.viewerTool) && (polyCount > 0 || (!drawing.selected && drawing.tool !== 'wall')) : isPointTool(tool) && (polyCount > 0 || !selected)) && !dialog && (
            <PolylineBar
              polyline={(drawMode ? drawing.tool : tool) === 'polyline'}
              wall={(drawMode ? drawing.tool : tool) === 'wall'}
              count={polyCount}
              viewer={viewer}
              lineName="Freie Form"
              onInput={
                drawMode
                  ? (text) => {
                      const last = viewer.current?.lastPolygonPoint();
                      if (!last) return 'Zuerst den Anfangspunkt antippen.';
                      const next = drawing.polyNext(text, last);
                      if (typeof next === 'string') return next;
                      viewer.current?.addPolygonPoint(next);
                      return null;
                    }
                  : undefined
              }
            />
          )}

          {!drawMode && tool === 'calibrate' && !dialog && (
            <div className="draw-bar calib-bar" data-testid="calibrate-bar">
              {/* Kopf: Titel + Stand der Kalibrierung als Pille */}
              <div className="calib-head">
                <strong className="calib-title">Maßstab</strong>
                {plan.calibration ? (
                  <strong className={`calib-status${calibrationStatus(plan, file?.kind).warn ? ' warn' : ' ok'}`} data-testid="calibration-info" title={calibrationStatus(plan, file?.kind).text}>
                    {plan.calibration.auto
                      ? `Erkannt: ${plan.calibration.auto.label}${plan.calibration.auto.confirmed ? ' (bestätigt)' : ' (ungeprüft)'}`
                      : `Kalibriert: Referenz ${formatMeasure(plan.calibration.meters)} m`}
                    {checkError(plan) !== null && ` · Prüfung ${formatCm(checkError(plan)!.diff)} (${formatPercent(checkDeviation(plan)!)})`}
                  </strong>
                ) : (
                  <strong className="calib-status none" data-testid="calibration-info">
                    Noch nicht kalibriert
                  </strong>
                )}
              </div>
              {/* Anleitung in zwei Schritten */}
              <p className="calib-steps" data-testid="calibrate-hint">
                {checking ? (
                  <>
                    <b>Prüfstrecke:</b> <span className="calib-step">1</span> eine andere bemaßte Strecke im Plan ziehen <span className="calib-step">2</span> ihre bekannte Länge eingeben – der Maßstab bleibt unverändert.
                  </>
                ) : file?.kind === 'image' ? (
                  <>
                    <b>Bild/Foto:</b> Maßstab kann nicht gelesen werden. <span className="calib-step">1</span> möglichst lange bemaßte Strecke (z. B. ganze Wand) anklicken oder ziehen <span className="calib-step">2</span> reale Länge eingeben.
                  </>
                ) : (
                  <>
                    <span className="calib-step">1</span> Punkt A und B einer bemaßten Strecke anklicken oder die Strecke ziehen (X halten = Lupe) <span className="calib-step">2</span> reale Länge eingeben.
                  </>
                )}
              </p>
              {/* Aktionen in Gruppen */}
              {(file?.kind === 'pdf' || plan.calibration) && (
                <div className="calib-actions">
                  {file?.kind === 'pdf' && (
                    <div className="calib-group">
                      <span className="calib-group-label">Aus dem Plan</span>
                      <div className="row gap-s">
                        <button type="button" className="btn btn-sm" onClick={() => void detectFromPlan()} data-testid="calibration-detect" title="Maßlinien, Maßketten und Maßstabsangabe im Plan auswerten">
                          Automatisch erkennen
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setDimsOpen(true)} data-testid="calibration-dims" title="Erkannte Maße prüfen, korrigieren und übernehmen">
                          Maße aus dem Plan
                        </button>
                      </div>
                    </div>
                  )}
                  {plan.calibration && (
                    <div className="calib-group">
                      <span className="calib-group-label">Kontrolle</span>
                      <div className="row gap-s">
                        <button type="button" className={`btn btn-sm${checking ? ' btn-primary' : ''}`} onClick={() => setChecking(!checking)} aria-pressed={checking} data-testid="calibration-check" title="Eine zweite bemaßte Strecke nachmessen – zeigt die Abweichung, ändert den Maßstab nicht">
                          Prüfstrecke
                        </button>

                      </div>
                    </div>
                  )}
                  {plan.calibration && (
                    <div className="calib-group calib-group-end">
                      <span className="calib-group-label">Zurücksetzen</span>
                      <button type="button" className="btn btn-sm calib-remove" onClick={() => putRecord('plans', { ...data.plans[plan.id], calibration: undefined })} data-testid="calibration-remove" title="Maßstab verwerfen – danach neu kalibrieren oder erkennen">
                        Kalibrierung entfernen
                      </button>
                    </div>
                  )}
                </div>
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
              <span className="mtype-anchor">
              <button
                type="button"
                className={`tool-btn mtype-btn${mtypeMenu ? ' active' : ''}`}
                onClick={() => {
                  setProbeMenu(false);
                  setStylePopOpen(false);
                  // neue Messung beginnt: Auswahl aufheben (die Leiste der Auswahl läge unter dem Menü)
                  if (!mtypeMenu) setSelectedId(null);
                  setMtypeMenu(!mtypeMenu);
                }}
                data-mtype-toggle=""
                aria-expanded={mtypeMenu}
                title="Messart wählen – danach misst jedes Werkzeug in dieser Art (Fläche, Wand, Länge, Volumen, Stück, Schadstelle, Frei)"
                data-testid="tool-mtype"
                data-value={mtype}
              >
                <Icon name={choiceIcon(mtype)} />
                <span className="mtype-text">
                  <span className="mtype-prefix">Messart: </span>
                  <span className="mtype-current">{choiceLabel(mtype)}</span>
                </span>
              </button>
              {mtypeMenu && (
                <MeasureTypeMenu
                  value={mtype}
                  onPick={(c) => {
                    setMtype(c);
                    setMtypeMenu(false);
                    // gleich zeichnen: ohne Werkzeug (Auswahl) → Rechteck bzw. Linie für Länge
                    if (c === 'stueck') setTool('points');
                    else if (c === 'wand') setTool('wall');
                    else if (tool === 'select' || tool === 'calibrate' || tool === 'probe' || tool === 'text' || !toolVisible(tool, c)) setTool(c === 'laenge' ? 'line' : 'rect');
                    toast(c === 'auto' ? 'Messart automatisch: offene Linien = Länge, geschlossene Formen = Fläche.' : `Messart ${choiceLabel(c)}: jetzt mit einem Werkzeug im Plan zeichnen.`, 'info', 2200);
                  }}
                  onClose={() => setMtypeMenu(false)}
                />
              )}
            </span>
              {TOOLS.filter((t) => (t.id !== 'calibrate' || !drawingPlan) && (t.id !== 'select' || !isTouchDevice()) && toolVisible(t.id)).map((t) => (
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
            <div className="tool-group color-pick" ref={stylePopRef}>
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
            {...positionGrouping(data)}
            onSelect={(r) => {
              // Tabelle antippen: Maße bearbeiten (nicht zur Stelle im Plan springen)
              select(r.damage.id);
              setDialog({ mode: 'edit', id: r.damage.id });
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
          photoSite={photoSite}
          photoPrefix={`Aufmaß ${plan.planNumber || planTitle(plan)}`}
          mode="new"
          damage={{
            id: '',
            number: dialog.number,
            label: dialog.label,
            color,
            labelOffset: null,
            shapeType: dialog.shape.type,
            kind: dialog.kind,
            measureType: dialog.measureType,
            ...(dialog.points ? { count: dialog.points } : {}),
            positionRef: activePosition ? lastPosition : null,
            // aus einer Messung übernommen: Maße aus dem Plan vorgewählt
            areaFromShape: dialog.fromShape,
          }}
          suggestion={k ? suggestMeasures(dialog.shape, k) : null}
          geometry={geometryMeasures(dialog.shape, k)}
          wall={isWall({ kind: dialog.kind, shape: dialog.shape, measureType: dialog.measureType })}
          openShape={isOpenShape(dialog.shape)}
          workAreas={workAreas}
          others={stored}
          components={[]}
          positions={positionOptions}
          onSave={save}
          onCancel={() => setDialog(null)}
          onDrawDeduction={k ? startDedDraw : undefined}
          drawnDeduction={drawnDed}
          hidden={!!dedDraw}
          dedFromPlan={k ? dedMeasures : undefined}
        />
      )}
      {dialogDamage && (
        <DamageDialog
          photoSite={photoSite}
          photoPrefix={`Aufmaß ${plan.planNumber || planTitle(plan)}`}
          mode="edit"
          damage={{ ...dialogDamage, shapeType: dialogDamage.shape.type as ShapeType, kind: kindOf(dialogDamage), measureType: typeOf(dialogDamage) }}
          suggestion={k ? suggestMeasures(dialogDamage.shape, k) : null}
          geometry={geometryMeasures(dialogDamage.shape, k)}
          wall={isWall(dialogDamage)}
          openShape={isOpenShape(dialogDamage.shape)}
          workAreas={workAreas}
          others={stored}
          components={[]}
          positions={positionOptions}
          onSave={save}
          onCancel={() => setDialog(null)}
          onDelete={() => void removeDamage(dialogDamage)}
          onDrawDeduction={k ? startDedDraw : undefined}
          drawnDeduction={drawnDed}
          hidden={!!dedDraw}
          dedFromPlan={k ? dedMeasures : undefined}
        />
      )}
      {dedDraw && (
        <div className="ded-draw-bar" role="status" data-testid="ded-draw-bar">
          <span>Abzug zeichnen: Form im Plan ziehen (z. B. Tür, Fenster)</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setTool(dedDraw.prevTool);
              setDedDraw(null);
            }}
            data-testid="ded-draw-cancel"
          >
            Abbrechen
          </button>
        </div>
      )}
      {excelOpen && plan && <ExcelExportDialog data={data} scope={{ kind: 'plan', planId: plan.id }} onClose={() => setExcelOpen(false)} />}
      {dimsOpen && plan && file && <DimensionReview data={data} plan={plan} file={file} onClose={() => setDimsOpen(false)} />}
      {detailsOpen && <PlanDetailsDialog plan={plan} data={data} onClose={() => setDetailsOpen(false)} />}
      {legendOpen && plan && (
        <LegendDialog
          entries={legend}
          show={!!legendInfo?.show}
          labels={legendInfo?.labels ?? {}}
          pos={legendInfo?.pos ?? 'bl'}
          planCount={projectPlans.length}
          onClose={() => setLegendOpen(false)}
          onSave={(show, labels, pos, all) => {
            // Bezeichnungen gehören zum Plan; an/aus und Lage auf Wunsch für alle Pläne des Projekts
            const own = Object.fromEntries(Object.entries(labels).filter(([c, t]) => t !== (legendInfo?.labels[c] ?? '') || plan.legendLabels?.[c] !== undefined));
            const others = all ? projectPlans.filter((p) => p.id !== plan.id).map((p) => ({ ...p, showLegend: show, legendPos: pos })) : [];
            putRecords({ plans: [{ ...data.plans[plan.id], showLegend: show, legendLabels: own, legendPos: pos }, ...others] });
            setLegendOpen(false);
          }}
        />
      )}
      {rotateOpen && plan && <RotatePlanDialog data={data} plan={plan} onClose={() => setRotateOpen(false)} onReuse={() => setRotateOpen(false)} />}
      {pdfOpen && <PdfExportDialog data={data} costCenterId={plan.costCenterId} initial={[plan.id]} onClose={() => setPdfOpen(false)} />}
    </div>
  );
}

/** Im Plan gezeichnete Abzüge: rot schraffiert mit Nummer */
const DED_DEFAULT = '#e03131';
type DedItem = { shape: Shape; label: string; labelAt?: Point; damageId?: string; dedId?: string; color?: string };

/** Im Plan gezeichnete Abzüge: rot schraffiert mit Nummer; die Nummer lässt sich verschieben (wie bei allen Formen) */
function DeductionOverlay({
  view,
  items,
  onMoveLabel,
  onEditShape,
  tapToEdit,
}: {
  view: View;
  items: DedItem[];
  onMoveLabel?: (damageId: string, dedId: string, at: Point) => void;
  onEditShape?: (damageId: string, dedId: string, shape: Shape) => void;
  /** Fläche antippen öffnet die Eckpunkte (im Auswahlmodus) */
  tapToEdit?: boolean;
}) {
  const drag = useRef<{ key: string; pointerId: number; dx: number; dy: number; moved: boolean; item: DedItem } | null>(null);
  const [live, setLive] = useState<{ key: string; at: Point } | null>(null);
  /** angetippter Abzug: Eckpunkte zum Ziehen (wie bei der Polylinie) */
  const [editKey, setEditKey] = useState<string | null>(null);
  const vdrag = useRef<{ key: string; index: number; pointerId: number; item: DedItem; moved: boolean } | null>(null);
  const [liveShape, setLiveShape] = useState<{ key: string; shape: Shape } | null>(null);
  const tap = useRef<{ key: string; pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  // außerhalb tippen (Plan, anderer Abzug, Leiste): Markierung weg
  useEffect(() => {
    if (!editKey) return;
    const off = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('[data-testid="ded-area"], [data-testid="ded-vertex"], [data-testid="ded-label"]')) return;
      setEditKey(null);
    };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [editKey]);
  if (!items.length) return null;
  const local = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <g className="ded-overlay" data-testid="ded-overlay">
      <defs>
        {[...new Set(items.map((x) => x.color ?? DED_DEFAULT))].map((c) => (
          <pattern key={c} id={`ded-hatch-${c.slice(1)}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke={c} strokeWidth="2" strokeOpacity="0.6" />
          </pattern>
        ))}
      </defs>
      {items.map((it, i) => {
        const key = it.dedId ?? `s${i}`;
        const shape = liveShape?.key === key ? liveShape.shape : it.shape;
        const verts = shapeVertices(shape);
        const pts = (verts.length ? verts : ellipsePoints(shape)).map((p) => toScreen(view, p));
        const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
        const at = live?.key === key ? toScreen(view, live.at) : it.labelAt ? toScreen(view, it.labelAt) : c;
        const movable = !!(onMoveLabel && it.damageId && it.dedId);
        const col = it.color ?? DED_DEFAULT;
        const away = Math.hypot(at.x - c.x, at.y - c.y) > 14;
        return (
          <g key={key} data-testid="ded-shape">
            <polygon
              points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={`url(#ded-hatch-${col.slice(1)})`}
              stroke={col}
              strokeWidth={editKey === key ? 2.5 : 1.5}
              strokeDasharray="5 3"
              pointerEvents={tapToEdit && onEditShape && it.dedId ? 'visiblePainted' : 'none'}
              data-testid="ded-area"
              onPointerDown={(e) => {
                // Abzug/Zuschlag direkt antippen → Eckpunkte bearbeiten (unabhängig von der Messung)
                e.stopPropagation();
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                const p = local(e);
                tap.current = { key, pointerId: e.pointerId, x: p.x, y: p.y, moved: false };
              }}
              onPointerMove={(e) => {
                const t = tap.current;
                if (!t || t.pointerId !== e.pointerId) return;
                const p = local(e);
                if (Math.hypot(p.x - t.x, p.y - t.y) > 6) t.moved = true;
              }}
              onPointerUp={(e) => {
                const t = tap.current;
                if (!t || t.pointerId !== e.pointerId) return;
                e.stopPropagation();
                tap.current = null;
                if (!t.moved) setEditKey((k0) => (k0 === key ? null : key));
              }}
            />
            {away && <line x1={c.x} y1={c.y} x2={at.x} y2={at.y} stroke={col} strokeWidth={1} strokeDasharray="3 2" pointerEvents="none" />}
            {/* weißes Kästchen wie bei den Nummern der Messungen (gleiche Größe) */}
            <rect
              x={at.x - (it.label.length * 7.4 + 10) / 2}
              y={at.y - 10}
              width={it.label.length * 7.4 + 10}
              height={20}
              rx={3}
              fill="#fff"
              fillOpacity={0.95}
              stroke={col}
              strokeWidth={1.4}
              pointerEvents="none"
            />
            <text
              x={at.x}
              y={at.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={`ded-label${movable ? ' movable' : ''}`}
              data-testid="ded-label"
              onPointerDown={
                movable
                  ? (e) => {
                      e.stopPropagation();
                      (e.currentTarget as Element).setPointerCapture(e.pointerId);
                      const p = local(e);
                      drag.current = { key, pointerId: e.pointerId, dx: at.x - p.x, dy: at.y - p.y, moved: false, item: it };
                    }
                  : undefined
              }
              onPointerMove={(e) => {
                const g = drag.current;
                if (!g || g.pointerId !== e.pointerId) return;
                e.stopPropagation();
                const p = local(e);
                g.moved = true;
                setLive({ key: g.key, at: toPage(view, { x: p.x + g.dx, y: p.y + g.dy }) });
              }}
              onPointerUp={(e) => {
                const g = drag.current;
                if (!g || g.pointerId !== e.pointerId) return;
                e.stopPropagation();
                drag.current = null;
                if (g.moved && live?.key === g.key) onMoveLabel!(g.item.damageId!, g.item.dedId!, live.at);
                else if (!g.moved && onEditShape) setEditKey((k0) => (k0 === g.key ? null : g.key));
                setLive(null);
              }}
              onPointerCancel={() => {
                drag.current = null;
                setLive(null);
              }}
            >
              {it.label}
            </text>
            {editKey === key &&
              movable &&
              verts.map((v, vi) => {
                const sp = toScreen(view, v);
                return (
                  <circle
                    key={vi}
                    cx={sp.x}
                    cy={sp.y}
                    r={9}
                    className="ded-vertex"
                    style={{ stroke: col }}
                    data-testid="ded-vertex"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.currentTarget as Element).setPointerCapture(e.pointerId);
                      vdrag.current = { key, index: vi, pointerId: e.pointerId, item: it, moved: false };
                    }}
                    onPointerMove={(e) => {
                      const g = vdrag.current;
                      if (!g || g.pointerId !== e.pointerId) return;
                      e.stopPropagation();
                      g.moved = true;
                      const pp = toPage(view, local(e));
                      setLiveShape({ key, shape: moveVertex(g.item.shape, g.index, pp) });
                    }}
                    onPointerUp={(e) => {
                      const g = vdrag.current;
                      if (!g || g.pointerId !== e.pointerId) return;
                      e.stopPropagation();
                      vdrag.current = null;
                      if (g.moved && liveShape?.key === key) onEditShape!(g.item.damageId!, g.item.dedId!, liveShape.shape);
                      setLiveShape(null);
                    }}
                    onPointerCancel={() => {
                      vdrag.current = null;
                      setLiveShape(null);
                    }}
                  />
                );
              })}
          </g>
        );
      })}
    </g>
  );
}

/** Ellipse als Vieleck (für die Darstellung) */
function ellipsePoints(s: Shape): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    out.push(rotatePoint({ x: s.x + s.w / 2 + (Math.cos(a) * s.w) / 2, y: s.y + s.h / 2 + (Math.sin(a) * s.h) / 2 }, { x: s.x + s.w / 2, y: s.y + s.h / 2 }, s.rotation ?? 0));
  }
  return out;
}
