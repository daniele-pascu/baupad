import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { PdfPreview } from '../components/PdfPreview';
import { PhotoCapture } from '../components/PhotoCapture';
import { PhotoImg } from '../components/PhotoImg';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError } from '../components/ui';
import { getCompanyLogo } from '../lib/company';
import { getDefectPlan, getMeta } from '../lib/db';
import { defectPdf } from '../lib/defect-pdf';
import { defectSiteKey, hitMark, KINDS, kindInfo, loadMarks, MARK_COLORS, markAnchor, markBox, newMark, nextMarkNo, planImage, putMark, removeMark, renumber, SHAPES, thinPoints } from '../lib/defects';
import { getPhotoStorage } from '../lib/photo-storage';
import { photoSiteKey } from '../lib/photos';
import { navigate, paths } from '../lib/router';
import type { DefectKind, DefectMark, DefectPlan, MarkShape, Photo, PhotoSite } from '../lib/types';
import type { ExportFile } from '../lib/aufmass';
import { safeFileName } from '../lib/aufmass';
import { DEFECT_ACCENT } from './DefectsPage';
import { usePlanThumb } from './DefectSitePage';
import { usePageTitle } from './SitePages';

type Tool = 'select' | MarkShape;
type Pt = { x: number; y: number };

const SHAPE_ICON: Record<MarkShape, string> = { pin: 'map', rect: 'rect', ellipse: 'ellipse', line: 'line', freehand: 'freehand', text: 'text' };

/** Pin als SVG-Pfad in Bildkoordinaten (Spitze am Punkt), Größe in Bildpixeln */
function pinPath(x: number, y: number, s: number): string {
  // s = Höhe des Pins
  const r = s * 0.36;
  const cy = y - s + r;
  return `M${x} ${y} C${x - r * 0.9} ${y - s * 0.45} ${x - r} ${cy + r * 0.2} ${x - r} ${cy} A${r} ${r} 0 1 1 ${x + r} ${cy} C${x + r} ${cy + r * 0.2} ${x + r * 0.9} ${y - s * 0.45} ${x} ${y}Z`;
}

/**
 * Plan mit Markierungen: Bild + SVG-Ebene. Werkzeug „auswählen“ trifft Markierungen (und verschiebt sie),
 * die Zeichenwerkzeuge legen Pins, Formen und Text an. Koordinaten sind relativ (0..1) zum Bild.
 */
function PlanCanvas({
  plan,
  url,
  marks,
  selectedId,
  tool,
  color,
  zoom,
  onCreate,
  onSelect,
  onOpen,
  onMove,
}: {
  plan: DefectPlan;
  url: string | null;
  marks: DefectMark[];
  selectedId: string | null;
  tool: Tool;
  color: string;
  zoom: number;
  onCreate(shape: MarkShape, points: Pt[]): void;
  onSelect(id: string | null): void;
  onOpen(id: string): void;
  onMove(id: string, points: Pt[]): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [fitW, setFitW] = useState(800);
  const [draft, setDraft] = useState<{ shape: MarkShape; points: Pt[] } | null>(null);
  const drag = useRef<{ kind: 'draw' | 'move'; start: Pt; last: Pt; id?: string; orig?: Pt[]; moved: boolean } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFitW(el.clientWidth - 2));
    ro.observe(el);
    setFitW(el.clientWidth - 2);
    return () => ro.disconnect();
  }, []);
  const W = plan.width;
  const H = plan.height;
  const ar = W / H;
  const dispW = Math.max(100, fitW) * zoom;
  const dispH = dispW / ar;
  /** Strich- und Symbolgrößen in Bildpixeln, damit sie bei jeder Zoomstufe am Bildschirm gleich groß sind */
  const px = (n: number) => (n * W) / dispW;
  const tol = px(14) / H;

  const rel = (e: RPointerEvent): Pt => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const hitAt = (p: Pt) => [...marks].reverse().find((m) => hitMark(m, p, tol, ar)) ?? null;

  const down = (e: RPointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = rel(e);
    if (tool === 'select') {
      const m = hitAt(p);
      if (!m) {
        onSelect(null);
        return;
      }
      (e.target as Element).setPointerCapture(e.pointerId);
      drag.current = { kind: 'move', start: p, last: p, id: m.id, orig: m.points, moved: false };
      onSelect(m.id);
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { kind: 'draw', start: p, last: p, moved: false };
    if (tool === 'freehand') setDraft({ shape: 'freehand', points: [p] });
    else setDraft({ shape: tool, points: [p, p] });
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = rel(e);
    if (Math.hypot((p.x - d.start.x) * ar, p.y - d.start.y) > 0.004) d.moved = true;
    d.last = p;
    if (d.kind === 'move' && d.id && d.orig && d.moved) {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      onMove(d.id, d.orig.map((q) => ({ x: Math.min(1, Math.max(0, q.x + dx)), y: Math.min(1, Math.max(0, q.y + dy)) })));
      return;
    }
    if (d.kind === 'draw') {
      if (tool === 'freehand') setDraft((s) => (s ? { ...s, points: [...s.points, p] } : s));
      else if (tool !== 'pin' && tool !== 'text' && tool !== 'select') setDraft({ shape: tool, points: [d.start, p] });
    }
  };
  const up = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = rel(e);
    if (d.kind === 'move') {
      if (!d.moved && d.id && d.id === selectedId) onOpen(d.id);
      return;
    }
    setDraft(null);
    if (tool === 'pin' || tool === 'text') {
      onCreate(tool, [p]);
      return;
    }
    if (tool === 'freehand') {
      const pts = thinPoints(draft?.points ?? [d.start, p]);
      if (pts.length >= 2) onCreate('freehand', pts);
      return;
    }
    if (!d.moved || tool === 'select') return; // zu klein
    onCreate(tool, [d.start, p]);
  };

  const sw = px(3);
  const renderShape = (m: { shape: MarkShape; points: Pt[]; color: string; text?: string }, key: string, selected: boolean, isDraft = false) => {
    const c = m.color;
    const common = { stroke: c, strokeWidth: selected ? sw * 1.6 : sw, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, opacity: isDraft ? 0.7 : 1 };
    const P = m.points.map((q) => ({ x: q.x * W, y: q.y * H }));
    switch (m.shape) {
      case 'pin': {
        const s = px(38);
        return (
          <g key={key}>
            <path d={pinPath(P[0].x, P[0].y, s)} fill={c} stroke="#fff" strokeWidth={px(1.5)} />
            <circle cx={P[0].x} cy={P[0].y - s * 0.64} r={px(5)} fill="#fff" />
          </g>
        );
      }
      case 'rect': {
        const b = markBox(m);
        return <rect key={key} x={b.x * W} y={b.y * H} width={b.w * W} height={b.h * H} rx={px(3)} {...common} fill={c} fillOpacity={0.12} />;
      }
      case 'ellipse': {
        const b = markBox(m);
        return <ellipse key={key} cx={(b.x + b.w / 2) * W} cy={(b.y + b.h / 2) * H} rx={(b.w / 2) * W} ry={(b.h / 2) * H} {...common} fill={c} fillOpacity={0.12} />;
      }
      case 'line':
        return <line key={key} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} {...common} />;
      case 'freehand':
        return <polyline key={key} points={P.map((q) => `${q.x},${q.y}`).join(' ')} {...common} />;
      case 'text': {
        const t = m.text || 'Text';
        const fs = px(14);
        const w = t.length * fs * 0.58 + px(12);
        return (
          <g key={key}>
            <rect x={P[0].x - px(6)} y={P[0].y - fs - px(4)} width={w} height={fs + px(10)} rx={px(3)} fill="#fff" stroke={c} strokeWidth={selected ? sw * 1.4 : sw * 0.7} />
            <text x={P[0].x} y={P[0].y} fontSize={fs} fontFamily="-apple-system, Segoe UI, Inter, sans-serif" fontWeight="600" fill={c}>
              {t}
            </text>
          </g>
        );
      }
    }
  };

  return (
    <div ref={box} className={`dp-canvas${tool === 'select' ? '' : ' drawing'}`} data-testid="dp-canvas">
      <div ref={stage} className="dp-stage" style={{ width: dispW, height: dispH }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => (drag.current = null)}>
        {url ? <img src={url} alt="" draggable={false} /> : <div className="dp-loading muted small">Plan wird geladen …</div>}
        <svg viewBox={`0 0 ${W} ${H}`} width={dispW} height={dispH} aria-hidden="true">
          {marks.map((m) => renderShape(m, m.id, m.id === selectedId))}
          {draft && renderShape({ ...draft, color }, 'draft', false, true)}
        </svg>
        {marks.map((m) => {
          const a = markAnchor(m);
          const dy = m.shape === 'pin' ? -44 : m.shape === 'text' ? -22 : -2;
          return (
            <button
              key={m.id}
              type="button"
              className={`dp-num${m.id === selectedId ? ' on' : ''}`}
              style={{ left: `${a.x * 100}%`, top: `calc(${a.y * 100}% + ${dy}px)`, borderColor: m.color, color: m.color }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => (m.id === selectedId ? onOpen(m.id) : onSelect(m.id))}
              aria-label={`Markierung ${m.no}`}
              data-testid="dp-num"
              data-no={m.no}
            >
              {m.no}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Fotos der Baustelle aus der Fotodokumentation auswählen */
function SitePhotosPicker({ photos, chosen, onClose, onDone }: { photos: Photo[]; chosen: string[]; onClose(): void; onDone(ids: string[]): void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(chosen));
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <Modal
      title="Fotos aus der Fotodokumentation"
      onClose={onClose}
      wide
      testId="dp-photo-picker"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onDone([...sel])} data-testid="dp-photo-picker-done">
            {sel.size} übernehmen
          </button>
        </>
      }
    >
      {photos.length === 0 ? (
        <p className="muted">Noch keine Fotos auf dieser Baustelle.</p>
      ) : (
        <div className="dp-photo-grid">
          {photos.map((p) => (
            <button key={p.id} type="button" className={`dp-photo-pick${sel.has(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={sel.has(p.id)} data-testid="dp-photo-pick">
              <PhotoImg id={p.id} />
              <span className="small">{new Date(p.takenAt).toLocaleDateString('de-DE')}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Markierung bearbeiten: Art, Titel, Beschreibung, Farbe, Text, Fotos */
function MarkDialog({
  mark,
  site,
  photos,
  onClose,
  onSave,
  onDelete,
  onPhotosAdded,
}: {
  mark: DefectMark;
  site: PhotoSite;
  photos: Photo[];
  onClose(): void;
  onSave(m: DefectMark): void;
  onDelete(m: DefectMark): void;
  onPhotosAdded(): void;
}) {
  const [m, setM] = useState(mark);
  const [picking, setPicking] = useState(false);
  const set = <K extends keyof DefectMark>(k: K, v: DefectMark[K]) => setM((p) => ({ ...p, [k]: v }));
  const setKind = (kind: DefectKind) => setM((p) => ({ ...p, kind, color: MARK_COLORS.includes(p.color) && p.color !== kindInfo(p.kind).color ? p.color : kindInfo(kind).color }));
  const hashes = useMemo(() => new Set(photos.map((p) => p.hash)), [photos]);
  const linked = photos.filter((p) => m.photoIds.includes(p.id));
  return (
    <Modal
      title={`Nr. ${m.no} · ${SHAPES.find((s) => s.id === m.shape)?.label ?? ''}`}
      onClose={onClose}
      testId="dp-mark-dialog"
      footer={
        <>
          <button type="button" className="btn btn-danger-text" onClick={() => onDelete(m)} data-testid="dp-mark-delete">
            <Icon name="trash" size={16} /> Löschen
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(m)} data-testid="dp-mark-save">
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field dp-kinds-field">
          <span>Art</span>
          <div className="segmented dp-kinds" role="radiogroup" aria-label="Art">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={m.kind === k.id} aria-selected={m.kind === k.id} onClick={() => setKind(k.id)} style={m.kind === k.id ? { background: k.color, color: '#fff', borderColor: k.color } : undefined} data-testid={`dp-kind-${k.id}`}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Titel</span>
          <input value={m.title} onChange={(e) => set('title', e.target.value)} placeholder="z. B. Abplatzung Decke, Achse B3" data-autofocus data-testid="dp-mark-title" />
        </label>
        {m.shape === 'text' && (
          <label className="field">
            <span>Text im Plan</span>
            <input value={m.text} onChange={(e) => set('text', e.target.value)} placeholder="kurzer Text, erscheint im Plan" data-testid="dp-mark-text" />
          </label>
        )}
        <label className="field">
          <span>Beschreibung</span>
          <textarea value={m.description} onChange={(e) => set('description', e.target.value)} rows={3} placeholder="Was ist zu tun, Menge, Material, Hinweise fürs Angebot" data-testid="dp-mark-desc" />
        </label>
        <div className="field">
          <span>Farbe im Plan</span>
          <div className="row gap">
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" className={`dp-color${m.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} aria-label={`Farbe ${c}`} aria-pressed={m.color === c} />
            ))}
          </div>
        </div>
        <div className="field">
          <span>Fotos ({linked.length})</span>
          {linked.length > 0 && (
            <div className="dp-photo-row" data-testid="dp-mark-photos">
              {linked.map((p) => (
                <span key={p.id} className="dp-photo-chip">
                  <PhotoImg id={p.id} />
                  <button type="button" className="dp-photo-x" onClick={() => set('photoIds', m.photoIds.filter((x) => x !== p.id))} aria-label="Foto entfernen">
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="row gap wrap">
            <PhotoCapture
              sites={[site]}
              site={site}
              existingHashes={hashes}
              onSaved={(saved) => {
                set('photoIds', [...m.photoIds, ...saved.map((p) => p.id)]);
                onPhotosAdded();
              }}
              render={({ camera, library }) => (
                <>
                  <button type="button" className="btn btn-sm" onClick={camera} data-testid="dp-photo-camera">
                    <Icon name="camera" size={16} /> Foto aufnehmen
                  </button>
                  <button type="button" className="btn btn-sm" onClick={library} data-testid="dp-photo-library">
                    <Icon name="images" size={16} /> Aus Galerie
                  </button>
                </>
              )}
            />
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)} data-testid="dp-photo-from-doku">
              <Icon name="folder" size={16} /> Aus Fotodokumentation
            </button>
          </div>
          <p className="muted small">Neue Fotos landen auch in der Fotodokumentation dieser Baustelle, mit Vermerk „Mängelplan Nr. {m.no}“.</p>
        </div>
      </div>
      {picking && <SitePhotosPicker photos={photos} chosen={m.photoIds} onClose={() => setPicking(false)} onDone={(ids) => { set('photoIds', ids); setPicking(false); }} />}
    </Modal>
  );
}

/** Planseite des Mängelplans: Werkzeugleiste, Plan mit Markierungen, Liste, Bearbeiten, PDF */
export function DefectPlanPage({ planId, markId }: { planId: string; markId: string | null }) {
  const [plan, setPlan] = useState<DefectPlan | null | undefined>(undefined);
  const [marks, setMarks] = useState<DefectMark[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState(MARK_COLORS[0]);
  const [kind, setKind] = useState<DefectKind>('mangel');
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(markId);
  const [editing, setEditing] = useState<DefectMark | null>(null);
  const [filter, setFilter] = useState<DefectKind | 'all'>('all');
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const [busy, setBusy] = useState(false);
  const url = usePlanThumb(planId, 'data');
  usePageTitle(`${plan?.title ?? 'Plan'} – Mängelplan`);

  const site: PhotoSite | null = plan ? { projectId: plan.projectId, name: plan.siteName, number: plan.siteNumber, address: plan.siteAddress } : null;
  const sitePhotos = useMemo(() => (site ? photos.filter((p) => !p.deletedAt && photoSiteKey(p) === defectSiteKey(plan!)) : []), [photos, site, plan]);

  const reloadPhotos = () => getPhotoStorage().list().then(setPhotos).catch(() => {});
  useEffect(() => {
    void getDefectPlan(planId).then((p) => setPlan(p ?? null));
    void loadMarks(planId).then(setMarks);
    void reloadPhotos();
  }, [planId]);
  useEffect(() => {
    if (markId) {
      const m = marks.find((x) => x.id === markId);
      if (m) setEditing(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markId, marks.length]);

  const create = async (shape: MarkShape, points: Pt[]) => {
    const m = newMark(planId, nextMarkNo(marks), shape, color, points, kind);
    await putMark(m);
    setMarks((l) => [...l, m]);
    setSelected(m.id);
    setEditing(m);
  };
  const moveMark = (id: string, points: Pt[]) => setMarks((l) => l.map((m) => (m.id === id ? { ...m, points } : m)));
  const commitMove = async (id: string) => {
    const m = marks.find((x) => x.id === id);
    if (m) await putMark(m);
  };
  const save = async (m: DefectMark) => {
    try {
      await putMark(m);
      setMarks((l) => l.map((x) => (x.id === m.id ? m : x)));
      // Vermerk in der Fotodokumentation, wenn das Foto noch keine Beschreibung hat
      const storage = getPhotoStorage();
      for (const p of photos.filter((p) => m.photoIds.includes(p.id) && !p.description.trim())) await storage.update({ ...p, description: `Mängelplan Nr. ${m.no}${m.title ? `: ${m.title}` : ''}` });
      void reloadPhotos();
      setEditing(null);
      if (markId) navigate(paths.defectPlan(planId), true);
    } catch (e) {
      showError(e, 'Markierung konnte nicht gespeichert werden');
    }
  };
  const del = async (m: DefectMark) => {
    const ok = await confirmDialog({ title: `Markierung Nr. ${m.no} löschen?`, message: <p>Die Fotos bleiben in der Fotodokumentation. Die Nummern der folgenden Markierungen rücken nach.</p>, confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    await removeMark(m.id);
    setMarks(await renumber(planId));
    setEditing(null);
    setSelected(null);
  };
  const exportPdf = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const img = await planImage(plan.id);
      if (!img) throw new Error('Planbild nicht gefunden.');
      const [company, lines, logo] = await Promise.all([getMeta<string>('companyName'), getMeta<string>('companyLines'), getCompanyLogo()]);
      const blobs = new Map<string, ArrayBuffer>();
      const storage = getPhotoStorage();
      for (const id of new Set(marks.flatMap((m) => m.photoIds))) {
        const b = await storage.blobs(id);
        if (b) blobs.set(id, b.data);
      }
      const data = await defectPdf(plan, marks, img.data, blobs, { company: company ?? '', lines: lines ?? '', logo });
      setPreview({ name: `${safeFileName(`Maengelplan ${plan.siteName} ${plan.title}`)}.pdf`, data, mimeType: 'application/pdf' });
    } catch (e) {
      showError(e, 'PDF konnte nicht erstellt werden');
    } finally {
      setBusy(false);
    }
  };

  const shown = marks.filter((m) => filter === 'all' || m.kind === filter);
  const pickTool = (t: Tool) => setTool((cur) => (cur === t && t !== 'select' ? 'select' : t));

  if (plan === null)
    return (
      <>
        <SiteNav />
        <div className="page">
          <p>Plan nicht gefunden.</p>
          <a href={paths.defects()} className="btn">
            Zum Mängelplan
          </a>
        </div>
      </>
    );

  return (
    <>
      <SiteNav />
      <div className="page defects-page dp-page" style={DEFECT_ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={plan ? paths.defectSite(defectSiteKey(plan)) : paths.defects()} className="icon-link" aria-label="Zur Baustelle" title="Zur Baustelle" data-testid="to-defect-site">
              <Icon name="back" />
            </a>
            <div>
              <p className="muted small page-sub">{plan?.siteName ?? ''} · Mängelplan</p>
              <h1 data-testid="dp-title">{plan?.title ?? '…'}</h1>
            </div>
          </div>
          <div className="row gap">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void exportPdf()} disabled={busy || !marks.length} data-testid="dp-pdf">
              <Icon name="pdf" size={16} /> {busy ? 'Wird erstellt …' : 'PDF'}
            </button>
          </div>
        </header>

        <div className="dp-toolbar" role="toolbar" aria-label="Werkzeuge" data-testid="dp-toolbar">
          <button type="button" className={`tb${tool === 'select' ? ' on' : ''}`} onClick={() => setTool('select')} data-testid="dp-tool-select" title="Auswählen und verschieben">
            <Icon name="hand" size={16} /> <span className="lbl">Auswählen</span>
          </button>
          {SHAPES.map((s) => (
            <button key={s.id} type="button" className={`tb${tool === s.id ? ' on' : ''}`} onClick={() => pickTool(s.id)} data-testid={`dp-tool-${s.id}`} title={s.label}>
              <Icon name={SHAPE_ICON[s.id] as never} size={16} /> <span className="lbl">{s.label}</span>
            </button>
          ))}
          <span className="dp-sep" />
          {MARK_COLORS.map((c) => (
            <button key={c} type="button" className={`dp-color${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Farbe ${c}`} aria-pressed={color === c} data-testid="dp-color" data-color={c} />
          ))}
          <span className="dp-sep" />
          <select value={kind} onChange={(e) => { const k = e.target.value as DefectKind; setKind(k); setColor(kindInfo(k).color); }} aria-label="Art neuer Markierungen" data-testid="dp-kind">
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <span className="dp-sep" />
          <button type="button" className="tb" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="Vergrößern" data-testid="dp-zoom-in">
            <Icon name="plus" size={16} />
          </button>
          <button type="button" className="tb" onClick={() => setZoom((z) => Math.max(1, z / 1.25))} aria-label="Verkleinern" disabled={zoom <= 1} data-testid="dp-zoom-out">
            <Icon name="minus" size={16} />
          </button>
          {zoom > 1 && (
            <button type="button" className="tb" onClick={() => setZoom(1)} aria-label="Einpassen">
              <Icon name="fit" size={16} />
            </button>
          )}
        </div>
        {tool !== 'select' && (
          <p className="muted small dp-hint" data-testid="dp-hint">
            {tool === 'pin' || tool === 'text' ? 'Im Plan antippen, wo die Markierung sitzen soll.' : tool === 'freehand' ? 'Mit dem Finger oder der Maus im Plan zeichnen.' : 'Im Plan aufziehen: Startpunkt drücken, ziehen, loslassen.'}
          </p>
        )}

        <div className="dp-layout">
          {plan && (
            <PlanCanvas
              plan={plan}
              url={url}
              marks={marks}
              selectedId={selected}
              tool={tool}
              color={color}
              zoom={zoom}
              onCreate={(s, p) => void create(s, p)}
              onSelect={setSelected}
              onOpen={(id) => setEditing(marks.find((m) => m.id === id) ?? null)}
              onMove={(id, p) => {
                moveMark(id, p);
                window.clearTimeout((window as unknown as { __dpMove?: number }).__dpMove);
                (window as unknown as { __dpMove?: number }).__dpMove = window.setTimeout(() => void commitMove(id), 400);
              }}
            />
          )}
          <aside className="dp-list" data-testid="dp-list">
            <header>
              <strong>Markierungen ({marks.length})</strong>
              <select value={filter} onChange={(e) => setFilter(e.target.value as DefectKind | 'all')} aria-label="Filter" data-testid="dp-filter">
                <option value="all">Alle</option>
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </header>
            {marks.length === 0 && <p className="muted small">Noch keine Markierung. Oben ein Werkzeug wählen und im Plan antippen.</p>}
            <ul>
              {shown.map((m) => {
                const k = kindInfo(m.kind);
                return (
                  <li key={m.id} className={m.id === selected ? 'on' : ''} data-testid="dp-item" data-no={m.no}>
                    <button type="button" className="dp-item-main" onClick={() => (selected === m.id ? setEditing(m) : setSelected(m.id))} onDoubleClick={() => setEditing(m)}>
                      <span className="dp-item-no" style={{ background: m.color }}>
                        {m.no}
                      </span>
                      <span className="dp-item-text">
                        <strong>{m.title || (m.shape === 'text' && m.text) || `Nr. ${m.no}`}</strong>
                        <small className="muted">
                          {m.description || 'keine Beschreibung'}
                          {m.photoIds.length > 0 && ` · ${m.photoIds.length} ${m.photoIds.length === 1 ? 'Foto' : 'Fotos'}`}
                        </small>
                        <span className="dp-tag" style={{ background: k.color }}>
                          {k.label}
                        </span>
                      </span>
                      {m.photoIds[0] && (
                        <span className="dp-item-photo">
                          <PhotoImg id={m.photoIds[0]} />
                        </span>
                      )}
                    </button>
                    <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditing(m)} aria-label={`Nr. ${m.no} bearbeiten`} data-testid="dp-item-edit">
                      <Icon name="edit" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="muted small dp-list-note">Fotos liegen auch in der Fotodokumentation dieser Baustelle.</p>
          </aside>
        </div>
      </div>
      {editing && site && (
        <MarkDialog
          mark={editing}
          site={site}
          photos={sitePhotos}
          onClose={() => {
            setEditing(null);
            if (markId) navigate(paths.defectPlan(planId), true);
          }}
          onSave={(m) => void save(m)}
          onDelete={(m) => void del(m)}
          onPhotosAdded={() => void reloadPhotos()}
        />
      )}
      {preview && <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={() => setPreview(null)} />}
    </>
  );
}
