import { useEffect, useState } from 'react';
import { symbolDef } from '../lib/symbols';
import { DRAW_TOOLS, ORTHO_DIR_LABELS, type DrawTool, type useDrawing } from '../pages/DrawingMode';
import { ORTHO_DIRS } from '../lib/cad';
import { Icon } from './Icon';
import { isTouchDevice } from '../lib/platform';
import { ProbeMenu } from './ProbeLayer';
import type { ProbeKind } from '../lib/probe';
import type { PlanViewerHandle } from './PlanViewer';
import { StylePanel } from './StylePanel';
import { snapKindsDialog } from './SnapKindsDialog';

/**
 * Obere Werkzeugleiste des Zeichenmodus mit Registerkarten (nach dem Vorbild von CAD-Programmen):
 * Zeichnen, Ändern, Darstellung, Messen, Ansicht. Auf schmalen Bildschirmen lässt sich jede
 * Zeile waagrecht wischen.
 */

type Tab = 'draw' | 'parts' | 'modify' | 'style' | 'precision' | 'view';
const TABS: { id: Tab; label: string }[] = [
  { id: 'draw', label: 'Zeichnen' },
  { id: 'parts', label: 'Bauteile' },
  { id: 'modify', label: 'Ändern' },
  { id: 'style', label: 'Eigenschaften' },
  { id: 'precision', label: 'Präzision' },
  { id: 'view', label: 'Ansicht' },
];

const DRAW_IDS: DrawTool[] = ['select', 'line', 'polyline', 'polygon', 'rect', 'ellipse', 'arc', 'text', 'dimension'];

function readTab(): Tab {
  try {
    const t = localStorage.getItem('ribbonTab') as Tab | null;
    return t && TABS.some((x) => x.id === t) ? t : 'draw';
  } catch {
    return 'draw';
  }
}

export function DrawRibbon({
  drawing,
  viewer,
  canUndo,
  onProbeCancel,
  canRedo,
  onUndo,
  onRedo,
  onMeasure,
  probeActive = false,
  onProbe,
}: {
  drawing: ReturnType<typeof useDrawing>;
  viewer: React.RefObject<PlanViewerHandle | null>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** Weiter zum Aufmaß */
  onMeasure(): void;
  /** Kontrollmessung läuft */
  probeActive?: boolean;
  /** Messung mit der gewählten Messart starten */
  onProbe?(kind: ProbeKind): void;
  /** laufende Messung beenden (anderes Werkzeug gewählt) */
  onProbeCancel?(): void;
}) {
  const [probeMenu, setProbeMenu] = useState(false);
  // anderes Werkzeug bzw. andere Registerkarte: Menü der Messung zu
  useEffect(() => setProbeMenu(false), [drawing.tool]);
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    setProbeMenu(false);
    try {
      localStorage.setItem('ribbonTab', t);
    } catch {
      /* optional */
    }
  };
  const sel = drawing.selected;

  const toolBtn = (id: DrawTool) => {
    const t = DRAW_TOOLS.find((x) => x.id === id)!;
    // Verschieben/Kopieren fragen ohne Auswahl selbst nach den Objekten
    const needsSel = false;
    // nie zwei zugleich: während Messung (Menü oder laufend) leuchtet nur „Messung“
    const lit = drawing.tool === id && !probeMenu && !probeActive;
    return (
      <button
        key={id}
        type="button"
        className={`tool-btn${lit ? ' active' : ''}`}
        onClick={() => {
          setProbeMenu(false);
          if (probeActive) onProbeCancel?.();
          drawing.setTool(id);
        }}
        aria-pressed={drawing.tool === id}
        disabled={needsSel}
        title={t.key ? `${t.label} (${t.key.toUpperCase()})` : t.label}
        data-testid={`draw-${id}`}
      >
        <Icon name={t.icon} />
        <span>{t.short ?? t.label}</span>
      </button>
    );
  };
  const btn = (id: string, icon: string, label: string, onClick: () => void, opts: { disabled?: boolean; title?: string; pressed?: boolean } = {}) => (
    <button
      key={id}
      type="button"
      className={`tool-btn${opts.pressed ? ' active' : ''}`}
      onClick={onClick}
      disabled={opts.disabled}
      aria-pressed={opts.pressed}
      title={opts.title ?? label}
      data-testid={id}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );

  const openSnapKinds = async () => {
    const c = await snapKindsDialog(drawing.snapCfg);
    if (c) drawing.setSnapCfg(c);
  };

  const editGroup = (
    <div className="tool-group" role="group" aria-label="Bearbeiten">
      {btn('draw-delete', 'trash', 'Löschen', () => sel && !drawing.removeSelectedVertex() && void drawing.remove(sel), {
        disabled: !sel,
        title: drawing.vertex !== null ? 'Ausgewählten Eckpunkt löschen (Entf)' : 'Ausgewähltes Objekt löschen (Entf)',
      })}
      {btn('draw-undo', 'undo', 'Zurück', onUndo, { disabled: !canUndo, title: 'Rückgängig (Strg+Z)' })}
      {btn('draw-redo', 'redo', 'Vor', onRedo, { disabled: !canRedo, title: 'Wiederholen (Strg+Umschalt+Z)' })}
    </div>
  );

  return (
    <div className="ribbon" role="toolbar" aria-label="Zeichenwerkzeuge" data-testid="draw-toolbar">
      <div className="ribbon-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`ribbon-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="ribbon-row" data-tab={tab}>
        {tab === 'draw' && (
          <>
            <div className="tool-group" role="group" aria-label="Zeichnen">
              {DRAW_IDS.filter((id) => id !== 'select' || !isTouchDevice()).map(toolBtn)}
            </div>
            <div className="tool-group" role="group" aria-label="Wand">
              {toolBtn('wall')}
            </div>
            <div className="tool-group" role="group" aria-label="Schraffur und Raum">
              {toolBtn('room')}
              {btn('draw-hatch', 'hatch', 'Schraffur', () => void drawing.pickHatch(), { pressed: drawing.tool === 'hatch', title: 'Schraffur: Muster bzw. Baustoff und Farbe wählen, dann in eine geschlossene Fläche tippen' })}
            </div>
            {editGroup}
          </>
        )}
        {tab === 'parts' && (
          <>
            <div className="tool-group" role="group" aria-label="Bauteile">
              {btn('draw-door', 'door', 'Tür', () => void drawing.pickSymbol('door'), { pressed: drawing.tool === 'symbol' && symbolDef(drawing.symbolId)?.group === 'door', title: 'Tür einsetzen (Dreh-, Pendel-, Schiebe-, Falttür, Tore, Drehkreuz)' })}
              {btn('draw-window', 'window', 'Fenster', () => void drawing.pickSymbol('window'), { pressed: drawing.tool === 'symbol' && symbolDef(drawing.symbolId)?.group === 'window', title: 'Fenster einsetzen (ein-/zweiflügelig, Festverglasung, Schiebefenster)' })}
              {btn('draw-electro', 'plug', 'Elektro', () => void drawing.pickSymbol('electro'), { pressed: drawing.tool === 'symbol' && symbolDef(drawing.symbolId)?.group === 'electro', title: 'Elektrosymbole (ÖNORM)' })}
              {btn('draw-shaft', 'shaft', 'Durchbruch', () => void drawing.pickSymbol('shaft'), { pressed: drawing.tool === 'symbol' && symbolDef(drawing.symbolId)?.group === 'shaft', title: 'Fänge (Rauch-, Abgas-, Luftfang), Durchbrüche und Aussparungen (ÖNORM)' })}
            </div>
            {editGroup}
          </>
        )}
        {tab === 'modify' && (
          <>
            <div className="tool-group" role="group" aria-label="Auswahl">
              {!isTouchDevice() && toolBtn('select')}
              {toolBtn('selwin')}
              {btn('draw-multi', 'plus', 'Mehrfach', () => drawing.setMulti(!drawing.multi), {
                pressed: drawing.multi,
                title: 'Mehrfachauswahl: Antippen fügt Objekte hinzu bzw. nimmt sie heraus (am PC auch mit Umschalt- oder Strg-Taste)',
              })}
              {btn('draw-select-all', 'select', 'Alles', drawing.selectAll, { title: 'Alle Objekte auswählen (Strg+A)' })}
            </div>
            <div className="tool-group" role="group" aria-label="Ändern">
              {toolBtn('move')}
              {toolBtn('copy')}
              {toolBtn('mirror')}
              {toolBtn('offset')}
              {toolBtn('array')}
              {toolBtn('join')}
              {toolBtn('rotate')}
              {toolBtn('scale')}
              {toolBtn('align')}
              {toolBtn('stretch')}
              {toolBtn('trim')}
              {toolBtn('extend')}
              {toolBtn('fillet')}
            </div>
            {editGroup}
          </>
        )}
        {tab === 'style' && (() => {
          const many = drawing.selection.filter((e) => e.type !== 'text' && e.type !== 'dimension');
          const first = many[0];
          const isOpen = (e: NonNullable<typeof first>) => e.type !== 'wall' && (e.type === 'line' || e.type === 'arc' || (e.type === 'freehand' && e.shape.closed === false));
          return (
            <div className="ribbon-style" data-testid="ribbon-style">
              <span className="ribbon-context" title={first ? 'Einstellungen der ausgewählten Objekte' : 'Einstellungen für neue Objekte'} data-testid="ribbon-style-context">
                {many.length > 1 ? `Auswahl (${many.length})` : first ? 'Auswahl' : 'Neue Objekte'}
              </span>
              {first ? (
                <StylePanel
                  compact
                  color={first.color}
                  style={first.style}
                  open={many.every(isOpen)}
                  openHint={many.some((e) => e.type === 'freehand' && e.shape.closed === false)}
                  defaultWidth={1.1}
                  kind="element"
                  onColor={(c) => {
                    drawing.setColor(c);
                    drawing.recolorMany(c);
                  }}
                  onStyle={(p) => drawing.restyleMany(p)}
                />
              ) : (
                // Voreinstellung nur für die Linie: neue Formen sind immer ohne Füllung
                <StylePanel compact color={drawing.color} style={drawing.defaultStyle} open defaultWidth={1.1} kind="element" onColor={drawing.setColor} onStyle={drawing.setDefaultStyle} />
              )}
              {!first && (
                <span className="ribbon-hint" data-testid="ribbon-no-fill-hint">
                  Neue Formen: keine Füllung
                </span>
              )}
            </div>
          );
        })()}
        {tab === 'precision' && (
          <>
            <div className="tool-group" role="group" aria-label="Fang und Hilfen">
              {btn('view-snap', 'snap', 'Fang', () => drawing.setSnapOn(!drawing.snapOn), { pressed: drawing.snapOn, title: 'Punktfang: Endpunkt, Mittelpunkt, Schnittpunkt, Kreismitte, auf Linie (Umschalt+X) · X gedrückt halten vergrößert an der Maus' })}
              {btn('view-track', 'ruler', 'Spuren', () => drawing.setTrackOn(!drawing.trackOn), { pressed: drawing.trackOn, title: 'Spurlinien (F11): waagrecht und senkrecht durch angefahrene Fangpunkte' })}
              {btn('view-ortho', 'ortho', '90°', () => drawing.setOrthoOn(!drawing.orthoOn), { pressed: drawing.orthoOn, title: '90° / Orthogonal: nur waagrecht und senkrecht zeichnen (F8)' })}
              {btn('view-grid', 'grid', 'Raster', () => drawing.setGridOn(!drawing.gridOn), { pressed: drawing.gridOn, title: 'Am Raster einrasten' })}
              {btn('view-snap-kinds', 'snapkinds', 'Fangarten', () => void openSnapKinds(), { title: 'Objektfang-Arten ein-/ausschalten und Vorrang festlegen (je Gerät)' })}
            </div>
            <div className="tool-group" role="group" aria-label="Hilfslinien">
              {toolBtn('guide')}
              {btn('view-guides', 'layers', 'Anzeigen', () => drawing.setGuidesOn(!drawing.guidesOn), { pressed: drawing.guidesOn, title: 'Hilfslinien anzeigen bzw. ausblenden (im PDF nie sichtbar)' })}
            </div>
            <div className="tool-group" role="group" aria-label="Messen">
              {toolBtn('dimension')}
              {toolBtn('distance')}
              {onProbe && (
                <span className="probe-anchor" data-probe-toggle>
                  {btn('ribbon-probe', 'ruler', 'Messung', () => setProbeMenu(!probeMenu), {
                    pressed: probeActive || probeMenu,
                    title: 'Messung: Länge, Fläche, Winkel, Radius oder Abstand nachmessen – ändert nichts',
                  })}
                  {probeMenu && (
                    <ProbeMenu
                      down
                      onClose={() => setProbeMenu(false)}
                      onPick={(kind) => {
                        setProbeMenu(false);
                        onProbe(kind);
                      }}
                    />
                  )}
                </span>
              )}
              {btn('ribbon-measure', 'table', 'Zum Aufmaß', onMeasure, { title: 'Weiter zum Aufmaß: Messungen erfassen' })}
            </div>
          </>
        )}
        {tab === 'view' && (
          <div className="tool-group" role="group" aria-label="Ansicht">
            {btn('view-zoom-in', 'plus', 'Vergrößern', () => viewer.current?.zoomIn())}
            {btn('view-zoom-out', 'minus', 'Verkleinern', () => viewer.current?.zoomOut())}
            {btn('view-fit', 'fit', 'Alles', () => viewer.current?.fit(), { title: 'Gesamten Plan anzeigen (0)' })}
            {btn('view-zoom-sel', 'zoomSel', 'Auswahl', () => sel && viewer.current?.zoomTo(sel.id), { disabled: !sel, title: 'Zoom auf Auswahl' })}
            {btn('view-back', 'undoView', 'Vorherige', () => viewer.current?.back(), { title: 'Zur vorherigen Ansicht' })}
          </div>
        )}
      </div>
    </div>
  );
}

const ORTHO_DIR_ICONS = { auto: 'orthoAuto', h: 'orthoH', v: 'orthoV' } as const;

/**
 * 90° / Orthogonal (wie ORTHO in AutoCAD, Taste F8): ein/aus und – solange eingeschaltet –
 * Richtung automatisch, nur waagrecht oder nur senkrecht (Antippen wechselt).
 */
export function OrthoButtons({ drawing }: { drawing: ReturnType<typeof useDrawing> }) {
  const d = drawing.orthoDir;
  const next = ORTHO_DIRS[(ORTHO_DIRS.indexOf(d) + 1) % ORTHO_DIRS.length];
  return (
    <span className="ortho-btns">
      <button
        type="button"
        className={`btn btn-sm${drawing.orthoOn ? ' active-toggle' : ''}`}
        onClick={() => drawing.setOrthoOn(!drawing.orthoOn)}
        aria-pressed={drawing.orthoOn}
        aria-label="90° / Orthogonal"
        title={`90° / Orthogonal ${drawing.orthoOn ? 'ein' : 'aus'}: Linien und Polylinien nur waagrecht und senkrecht (F8)`}
        data-testid="ortho-toggle"
      >
        <Icon name="ortho" size={18} /> <span className="hide-sm">90° {drawing.orthoOn ? 'ein' : 'aus'}</span>
      </button>
      {drawing.orthoOn && (
        <button
          type="button"
          className="btn btn-sm ortho-dir"
          onClick={() => drawing.setOrthoDir(next)}
          aria-label={`${ORTHO_DIR_LABELS[d]} – wechseln zu: ${ORTHO_DIR_LABELS[next]}`}
          title={`${ORTHO_DIR_LABELS[d]} (antippen: ${ORTHO_DIR_LABELS[next]})`}
          data-testid="ortho-dir"
          data-dir={d}
        >
          <Icon name={ORTHO_DIR_ICONS[d]} size={18} />
        </button>
      )}
    </span>
  );
}
