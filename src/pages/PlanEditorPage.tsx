import { useEffect, useMemo, useRef, useState } from 'react';
import { AufmassTable } from '../components/AufmassTable';
import { DamageDialog, type DamageValues, type Renumber } from '../components/DamageDialog';
import { Icon } from '../components/Icon';
import { PdfExportDialog } from '../components/PdfExportDialog';
import { PlanDetailsDialog } from '../components/PlanFields';
import { PlanViewer, type PlanViewerHandle, type Tool } from '../components/PlanViewer';
import { SaveErrorBanner, SaveStatus } from '../components/SaveStatus';
import { confirmDialog, offerFile, showError, toast } from '../components/ui';
import { damagesOf, exportXlsx, planTitle, plansOf, sumArea } from '../lib/aufmass';
import { computeArea, formatArea, formatMeasure } from '../lib/numbers';
import { compactNumbers, duplicateNumbers, nextNumber, shiftNumbers, swapNumbers } from '../lib/numbering';
import { navigate, paths } from '../lib/router';
import { newMeta, putRecord, putRecords, softDelete, useAppState, type ProjectState } from '../lib/store';
import { COLORS, SHAPE_LABELS, type Damage, type Shape, type ShapeType } from '../lib/types';

type DialogState = { mode: 'new'; shape: Shape; number: number } | { mode: 'edit'; id: string } | null;

const TOOLS: { id: Tool; label: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Auswählen / Verschieben', icon: 'select', key: 'v' },
  { id: 'ellipse', label: SHAPE_LABELS.ellipse, icon: 'ellipse', key: 'k' },
  { id: 'rect', label: SHAPE_LABELS.rect, icon: 'rect', key: 'r' },
  { id: 'freehand', label: SHAPE_LABELS.freehand, icon: 'freehand', key: 'f' },
];

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
  const plan = data.plans[planId];
  const [tool, setToolState] = useState<Tool>(() => loadPref('tool', TOOLS.map((t) => t.id), 'ellipse'));
  const [color, setColorState] = useState(() => loadPref('color', COLORS.map((c) => c.value), COLORS[0].value));
  const [selectedId, setSelectedId] = useState<string | null>(focusDamageId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<Damage>>>({});
  const [mobileTab, setMobileTab] = useState<'plan' | 'table'>('plan');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [, setHistoryTick] = useState(0);
  const viewer = useRef<PlanViewerHandle>(null);

  const setTool = (t: Tool) => {
    setToolState(t);
    try {
      localStorage.setItem('tool', t);
    } catch {
      /* optional */
    }
  };
  const setColor = (c: string) => {
    setColorState(c);
    try {
      localStorage.setItem('color', c);
    } catch {
      /* optional */
    }
  };

  const stored = useMemo(() => (plan ? damagesOf(data, plan.id) : []), [data, plan]);
  const damages = useMemo(() => stored.map((d) => (overrides[d.id] ? { ...d, ...overrides[d.id] } : d)), [stored, overrides]);
  const dupIds = useMemo(() => {
    const dups = new Set(duplicateNumbers(stored));
    return new Set(stored.filter((d) => dups.has(d.number)).map((d) => d.id));
  }, [stored]);
  const selected = damages.find((d) => d.id === selectedId) ?? null;

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

  // Tastaturkürzel (PC)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || detailsOpen || pdfOpen) return;
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || document.querySelector('.modal')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) setTool(t.id);
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
  const file = data.files[plan.fileId];
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
    const area = computeArea(v.length, v.width);
    if (dialog.mode === 'new') {
      const shape: Shape =
        v.shapeType === dialog.shape.type ? dialog.shape : { type: v.shapeType, x: dialog.shape.x, y: dialog.shape.y, w: dialog.shape.w, h: dialog.shape.h };
      const dmg: Damage = {
        ...newMeta(),
        projectId: plan.projectId,
        planId: plan.id,
        number: v.number,
        shape,
        color: v.color,
        labelOffset: null,
        length: v.length,
        width: v.width,
        depth: v.depth,
        area,
      };
      if (renumber !== 'none') {
        // Kontrollierte Umnummerierung; beim Tausch erhält die bisherige Schadstelle die
        // automatisch vorgeschlagene Nummer der neuen.
        const base = { ...dmg, number: dialog.number };
        const all = [...stored, base];
        const changes = renumber === 'swap' ? swapNumbers(all, base.id, v.number) : shiftNumbers(all, base.id, v.number);
        const recs = [...changes].map(([id, n]) => (id === base.id ? { ...base, number: n } : { ...data.damages[id], number: n }));
        putRecords({ damages: recs });
      } else {
        putRecord('damages', dmg);
      }
      if (v.color !== color) setColor(v.color);
      setSelectedId(dmg.id);
      toast(`Schadstelle ${v.number} gespeichert (${formatArea(area)} m²).`, 'success', 2500);
    } else {
      const d = data.damages[dialog.id];
      const shape: Shape = v.shapeType === d.shape.type ? d.shape : { type: v.shapeType, x: d.shape.x, y: d.shape.y, w: d.shape.w, h: d.shape.h };
      const patch = {
        id: d.id,
        length: v.length,
        width: v.width,
        depth: v.depth,
        area,
        color: v.color,
        shape,
        labelOffset: v.resetLabel ? null : d.labelOffset,
      };
      if (renumber === 'none') putRecord('damages', { ...d, ...patch, number: v.number });
      else {
        const changes = renumber === 'swap' ? swapNumbers(stored, d.id, v.number) : shiftNumbers(stored, d.id, v.number);
        applyRenumber(changes, patch);
      }
    }
    setDialog(null);
  };

  const removeDamage = async (d: Damage) => {
    const ok = await confirmDialog({
      title: `Schadstelle ${d.number} löschen?`,
      message: (
        <p>
          Schadstelle <strong>{d.number}</strong> ({formatMeasure(d.length)} m × {formatMeasure(d.width)} m = {formatArea(d.area)} m²)
          wird gelöscht. Die Nummern der übrigen Schadstellen bleiben unverändert.
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    softDelete({ damages: [data.damages[d.id]] });
    if (selectedId === d.id) setSelectedId(null);
    setDialog(null);
    toast(`Schadstelle ${d.number} gelöscht.`);
  };

  const compact = async () => {
    const changes = compactNumbers(stored, plan.numberStart);
    if (!changes.size) {
      toast('Die Nummerierung ist bereits lückenlos.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Lückenlos neu nummerieren?',
      message: (
        <p>
          {changes.size} Schadstelle(n) erhalten eine neue Nummer (Reihenfolge bleibt erhalten, Start bei {plan.numberStart}). Bereits
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

  const dialogDamage = dialog?.mode === 'edit' ? data.damages[dialog.id] : null;
  const rows = damages.map((damage) => ({ plan, damage }));

  return (
    <div className="editor">
      <header className="topbar editor-topbar">
        <a className="icon-btn" href={paths.costCenter(data.project.id, plan.costCenterId)} aria-label="Zur Kostenstelle">
          <Icon name="back" />
        </a>
        <div className="topbar-title">
          <small>
            {data.project.name} · {cc?.name}
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

      <div className={`editor-main show-${mobileTab}`}>
        <div className="editor-plan">
          {file ? (
            <PlanViewer
              ref={viewer}
              plan={plan}
              file={file}
              damages={damages}
              selectedId={selectedId}
              tool={tool}
              color={color}
              pending={dialog?.mode === 'new' ? { shape: dialog.shape, color } : null}
              onSelect={(id) => select(id)}
              onCreate={(shape) => setDialog({ mode: 'new', shape, number: nextNumber(stored, plan.numberStart) })}
              onShapeChange={(id, shape, commit) => {
                if (commit) {
                  setOverrides(({ [id]: _, ...rest }) => rest);
                  const d = data.damages[id];
                  if (JSON.stringify(d.shape) !== JSON.stringify(shape)) putRecord('damages', { ...d, shape });
                } else setOverrides((o) => ({ ...o, [id]: { ...o[id], shape } }));
              }}
              onLabelChange={(id, offset, commit) => {
                if (commit) {
                  setOverrides(({ [id]: _, ...rest }) => rest);
                  putRecord('damages', { ...data.damages[id], labelOffset: offset });
                } else setOverrides((o) => ({ ...o, [id]: { ...o[id], labelOffset: offset } }));
              }}
              onHistoryChange={() => setHistoryTick((n) => n + 1)}
            />
          ) : (
            <div className="viewer-msg error">Originaldatei fehlt.</div>
          )}

          <div className="zoom-controls">
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
              onClick={() => viewer.current?.back()}
              disabled={!viewer.current?.canGoBack()}
              aria-label="Zur vorherigen Ansicht"
              title="Zur vorherigen Ansicht"
            >
              <Icon name="undoView" />
            </button>
          </div>

          {selected && !dialog && (
            <div className="selection-bar" data-testid="selection-bar">
              <div className="selection-info">
                <span className="color-dot" style={{ background: selected.color }} />
                <strong>Nr. {selected.number}</strong>
                <span>
                  {formatMeasure(selected.length)} × {formatMeasure(selected.width)} m · T {formatMeasure(selected.depth)} m ={' '}
                  <strong>{formatArea(selected.area)} m²</strong>
                </span>
              </div>
              <div className="row gap">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog({ mode: 'edit', id: selected.id })} data-testid="edit-selected">
                  <Icon name="edit" size={18} /> Bearbeiten
                </button>
                <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void removeDamage(selected)} data-testid="delete-selected">
                  <Icon name="trash" size={18} />
                  <span className="sr-only">Löschen</span>
                </button>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setSelectedId(null)} aria-label="Auswahl aufheben">
                  <Icon name="close" size={18} />
                </button>
              </div>
            </div>
          )}

          <div className="toolbar" role="toolbar" aria-label="Werkzeuge">
            <div className="tool-group">
              {TOOLS.map((t) => (
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
                  <span>{t.id === 'select' ? 'Auswahl' : t.label}</span>
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
                  title={selected ? `Farbe ${c.name} (auch für Schadstelle ${selected.number})` : `Farbe ${c.name}`}
                />
              ))}
            </div>
          </div>
        </div>

        <aside className="editor-side">
          <div className="side-head">
            <h2>Aufmaß – {plan.planNumber || planTitle(plan)}</h2>
            <span className="muted small">
              {damages.length} Schadstellen · {formatArea(sumArea(damages))} m²
            </span>
          </div>
          <AufmassTable
            rows={rows}
            selectedId={selectedId}
            duplicates={dupIds}
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
          damage={{ id: '', number: dialog.number, color, labelOffset: null, shapeType: dialog.shape.type }}
          others={stored}
          onSave={save}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialogDamage && (
        <DamageDialog
          mode="edit"
          damage={{ ...dialogDamage, shapeType: dialogDamage.shape.type as ShapeType }}
          others={stored}
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
