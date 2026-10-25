import { useState } from 'react';
import { DRAW_TOOLS, NEEDS_SELECTION, type DrawTool, type useDrawing } from '../pages/DrawingMode';
import { COLORS } from '../lib/types';
import { Icon } from './Icon';
import type { PlanViewerHandle } from './PlanViewer';
import { StylePanel } from './StylePanel';
import { promptDialog, toast } from './ui';

/**
 * Obere Werkzeugleiste des Zeichenmodus mit Registerkarten (nach dem Vorbild von CAD-Programmen):
 * Zeichnen, Ändern, Darstellung, Messen, Ansicht. Auf schmalen Bildschirmen lässt sich jede
 * Zeile waagrecht wischen.
 */

type Tab = 'draw' | 'modify' | 'style' | 'measure' | 'view';
const TABS: { id: Tab; label: string }[] = [
  { id: 'draw', label: 'Zeichnen' },
  { id: 'modify', label: 'Ändern' },
  { id: 'style', label: 'Darstellung' },
  { id: 'measure', label: 'Messen' },
  { id: 'view', label: 'Ansicht' },
];

const DRAW_IDS: DrawTool[] = ['select', 'line', 'polyline', 'rect', 'ellipse', 'arc', 'triangle', 'polygon', 'text'];
const MODIFY_IDS: DrawTool[] = ['select', 'move', 'copy', 'stretch', 'trim', 'extend'];

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
  canRedo,
  onUndo,
  onRedo,
  onMeasure,
}: {
  drawing: ReturnType<typeof useDrawing>;
  viewer: React.RefObject<PlanViewerHandle | null>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** Weiter zum Aufmaß */
  onMeasure(): void;
}) {
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem('ribbonTab', t);
    } catch {
      /* optional */
    }
  };
  const sel = drawing.selected;

  const toolBtn = (id: DrawTool) => {
    const t = DRAW_TOOLS.find((x) => x.id === id)!;
    const needsSel = NEEDS_SELECTION.has(id) && !sel;
    return (
      <button
        key={id}
        type="button"
        className={`tool-btn${drawing.tool === id ? ' active' : ''}`}
        onClick={() => drawing.setTool(id)}
        aria-pressed={drawing.tool === id}
        disabled={needsSel}
        title={`${t.label} (${t.key.toUpperCase()})${needsSel ? ' – zuerst ein Objekt auswählen' : ''}`}
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

  /** Drehen bzw. Skalieren mit Zahleneingabe (um den Mittelpunkt) */
  const transform = async (kind: 'rotate' | 'scale') => {
    if (!sel) return;
    const input = await promptDialog({
      title: kind === 'rotate' ? 'Drehen' : 'Skalieren',
      label: kind === 'rotate' ? 'Winkel in Grad (im Uhrzeigersinn, z. B. 90 oder -45)' : 'Faktor (z. B. 2 = doppelt so groß, 0,5 = halb so groß)',
      value: kind === 'rotate' ? '90' : '2',
      confirmLabel: kind === 'rotate' ? 'Drehen' : 'Skalieren',
    });
    if (input === null) return;
    const v = Number(input.trim().replace(',', '.').replace('°', ''));
    if (!Number.isFinite(v) || (kind === 'scale' && v <= 0)) {
      toast(kind === 'rotate' ? 'Bitte einen Winkel in Grad eingeben.' : 'Bitte einen Faktor größer als 0 eingeben.', 'error');
      return;
    }
    drawing.transformSelected(kind, v);
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

  const styled = sel && sel.type !== 'text' && sel.type !== 'dimension';
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
              {DRAW_IDS.map(toolBtn)}
            </div>
            {editGroup}
          </>
        )}
        {tab === 'modify' && (
          <>
            <div className="tool-group" role="group" aria-label="Ändern">
              {MODIFY_IDS.slice(0, 3).map(toolBtn)}
              {btn('draw-rotate', 'rotate', 'Drehen', () => void transform('rotate'), { disabled: !sel, title: 'Ausgewähltes Objekt um einen Winkel drehen' })}
              {btn('draw-scale', 'scale', 'Skalieren', () => void transform('scale'), { disabled: !sel, title: 'Ausgewähltes Objekt mit einem Faktor skalieren' })}
              {MODIFY_IDS.slice(3).map(toolBtn)}
            </div>
            {editGroup}
          </>
        )}
        {tab === 'style' && (
          <div className="ribbon-style" data-testid="ribbon-style">
            <div className="pop-swatches" role="group" aria-label="Farben">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`swatch${drawing.color === c.value ? ' active' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => {
                    drawing.setColor(c.value);
                    if (sel) drawing.recolor(sel.id, c.value);
                  }}
                  aria-label={`Farbe ${c.name}`}
                  aria-pressed={drawing.color === c.value}
                  title={sel ? `Farbe ${c.name} (auch für das ausgewählte Objekt)` : `Farbe ${c.name}`}
                />
              ))}
            </div>
            <div className="pop-title">{styled ? 'Ausgewähltes Objekt' : 'Darstellung neuer Objekte'}</div>
            {styled ? (
              <StylePanel
                color={sel.color}
                style={sel.style}
                open={sel.type === 'line' || sel.type === 'arc' || (sel.type === 'freehand' && sel.shape.closed === false)}
                defaultWidth={1.1}
                kind="element"
                hideColor
                onColor={(c) => drawing.recolor(sel.id, c)}
                onStyle={(p) => drawing.restyle(sel.id, p)}
              />
            ) : (
              <StylePanel color={drawing.color} style={drawing.defaultStyle} open={false} defaultWidth={1.1} kind="element" hideColor onColor={drawing.setColor} onStyle={drawing.setDefaultStyle} />
            )}
          </div>
        )}
        {tab === 'measure' && (
          <div className="tool-group" role="group" aria-label="Messen">
            {toolBtn('dimension')}
            {btn('ribbon-measure', 'table', 'Zum Aufmaß', onMeasure, { title: 'Weiter zum Aufmaß: Messungen erfassen' })}
          </div>
        )}
        {tab === 'view' && (
          <div className="tool-group" role="group" aria-label="Ansicht">
            {btn('view-zoom-in', 'plus', 'Vergrößern', () => viewer.current?.zoomIn())}
            {btn('view-zoom-out', 'minus', 'Verkleinern', () => viewer.current?.zoomOut())}
            {btn('view-fit', 'fit', 'Alles', () => viewer.current?.fit(), { title: 'Gesamten Plan anzeigen (0)' })}
            {btn('view-zoom-sel', 'zoomSel', 'Auswahl', () => sel && viewer.current?.zoomTo(sel.id), { disabled: !sel, title: 'Zoom auf Auswahl' })}
            {btn('view-back', 'undoView', 'Vorherige', () => viewer.current?.back(), { title: 'Zur vorherigen Ansicht' })}
            {btn('view-grid', 'grid', 'Raster', () => drawing.setGridOn(!drawing.gridOn), { pressed: drawing.gridOn, title: 'Am Raster einrasten' })}
            {btn('view-snap', 'snap', 'Fang', () => drawing.setSnapOn(!drawing.snapOn), { pressed: drawing.snapOn, title: 'Punktfang (X)' })}
          </div>
        )}
      </div>
    </div>
  );
}
