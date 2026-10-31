import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { cleanView, PATTERN, viewActive, type PlanAnalysis, type PlanView } from '../lib/plan-view';

/**
 * Menü „Ansicht“ der Planunterlage (Aufmaß und Mängelplan gleich): farbig/schwarz-weiß, PDF-Ebenen des CAD-Exports,
 * Inhaltsfilter nach Merkmalen (Text, Bilder, Strichstärke, Farben). Gilt für Ansicht und PDF, wird je Plan gespeichert.
 */
export function ViewMenu({
  gray,
  onGray,
  view,
  onView,
  analyze,
  analysisKey,
  prefix,
  colorTestId,
}: {
  gray: boolean;
  onGray(gray: boolean): void;
  view: PlanView | undefined;
  onView(view: PlanView | undefined): void;
  /** Merkmale der PDF-Seite (null = Bild/Foto, keine Filter) */
  analyze: (() => Promise<PlanAnalysis | null>) | null;
  analysisKey: string;
  /** Vorsilbe der Test-Kennungen */
  prefix: string;
  colorTestId: string;
}) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<{ key: string; data: PlanAnalysis | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !analyze || analysis?.key === analysisKey) return;
    let off = false;
    setLoading(true);
    analyze()
      .then((data) => !off && setAnalysis({ key: analysisKey, data }))
      .catch(() => !off && setAnalysis({ key: analysisKey, data: null }))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, analysisKey]);

  const v = view ?? {};
  const set = (patch: Partial<PlanView>) => onView(cleanView({ ...v, ...patch }));
  const toggleIn = (list: string[] | undefined, key: string, hide: boolean) => (hide ? [...(list ?? []).filter((x) => x !== key), key] : (list ?? []).filter((x) => x !== key));
  const a = analysis?.key === analysisKey ? analysis.data : null;
  const active = viewActive(view);
  const widthOptions = (a?.widths ?? []).filter((w) => w.width > 0);
  const fmt = (n: number) => n.toLocaleString('de-AT', { maximumFractionDigits: 2 });

  return (
    <div className="view-menu" ref={ref}>
      <button
        type="button"
        className={`btn btn-sm${active ? ' btn-primary' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Ansicht der Planunterlage: farbig/schwarz-weiß, PDF-Ebenen, Text und dünne Linien ausblenden"
        data-testid={`${prefix}-view`}
      >
        <Icon name="layers" size={18} /> <span className="hide-sm">Ansicht</span>
      </button>
      {open && (
        <div className="layer-pop view-pop" role="group" aria-label="Ansicht" data-testid={`${prefix}-view-pop`}>
          <div className="pop-title">Planunterlage</div>
          <button type="button" className="btn btn-sm" onClick={() => onGray(!gray)} aria-pressed={gray} title="Gilt für Ansicht und PDF; Markierungen bleiben farbig" data-testid={colorTestId}>
            <Icon name={gray ? 'layers' : 'ellipse'} size={16} /> {gray ? 'Schwarz-weiß' : 'Farbig'}
          </button>
          {analyze && loading && <p className="small muted">Plan wird ausgewertet …</p>}
          {a && a.layers.length > 0 && (
            <>
              <div className="pop-title">PDF-Ebenen</div>
              <div className="view-layers">
                {a.layers.map((l) =>
                  l.heading ? (
                    <div key={l.id} className="small muted view-layer-head" style={{ paddingLeft: l.depth * 14 }}>
                      {l.name}
                    </div>
                  ) : (
                    <label key={l.id} className="check-row" style={{ paddingLeft: l.depth * 14 }}>
                      <input type="checkbox" checked={!v.hideLayers?.includes(l.id)} onChange={(e) => set({ hideLayers: toggleIn(v.hideLayers, l.id, !e.target.checked) })} data-testid={`${prefix}-layer`} data-id={l.id} />
                      <span>{l.name}</span>
                    </label>
                  ),
                )}
              </div>
            </>
          )}
          {a?.vector && (
            <>
              <div className="pop-title">Inhalt</div>
              {a.hasText && (
                <label className="check-row" title="Beschriftungen und Maßzahlen, die als Text im PDF stehen">
                  <input type="checkbox" checked={!v.hideText} onChange={(e) => set({ hideText: !e.target.checked })} data-testid={`${prefix}-text`} />
                  <span>Text anzeigen</span>
                </label>
              )}
              {a.hasImages && (
                <label className="check-row">
                  <input type="checkbox" checked={!v.hideImages} onChange={(e) => set({ hideImages: !e.target.checked })} data-testid={`${prefix}-images`} />
                  <span>Bilder anzeigen</span>
                </label>
              )}
              {widthOptions.length > 1 && (
                <label className="field view-width">
                  <span>Linien</span>
                  <select value={String(v.minWidth ?? 0)} onChange={(e) => set({ minWidth: Number(e.target.value) || 0 })} data-testid={`${prefix}-minwidth`}>
                    <option value="0">alle Linien</option>
                    {widthOptions.map((w) => (
                      <option key={w.width} value={String(w.width)}>
                        ab {fmt(w.width)} pt ({w.count})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {a.colors.length > 1 && (
                <>
                  <span className="small muted">Farben (antippen = ausblenden)</span>
                  <div className="view-colors">
                    {a.colors.map((c) => {
                      const hidden = v.hideColors?.includes(c.key) ?? false;
                      const label = c.key === PATTERN ? 'Schraffur' : c.key;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          className={`view-color${hidden ? ' hidden' : ''}`}
                          onClick={() => set({ hideColors: toggleIn(v.hideColors, c.key, !hidden) })}
                          aria-pressed={!hidden}
                          title={`${label} – ${c.count} Objekte`}
                          data-testid={`${prefix}-view-color`}
                          data-color={c.key}
                        >
                          <span className="view-swatch" style={c.key === PATTERN ? undefined : { background: c.key }}>
                            {c.key === PATTERN ? '▦' : ''}
                          </span>
                          <span className="small">{c.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <p className="small muted">Näherung nach Strichstärke und Farbe – gilt für Ansicht und PDF. Text als Kurven bleibt sichtbar.</p>
            </>
          )}
          {analyze && a && !a.vector && !a.layers.length && <p className="small muted">Dieses PDF enthält keine Vektorlinien (Scan) – nur farbig/schwarz-weiß.</p>}
          {active && (
            <button type="button" className="btn btn-sm" onClick={() => onView(undefined)} data-testid={`${prefix}-view-reset`}>
              <Icon name="undo" size={16} /> Ansicht zurücksetzen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
