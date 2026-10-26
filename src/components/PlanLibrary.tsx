import { useEffect, useMemo, useState } from 'react';
import { costCenterLabel, damagesOf } from '../lib/aufmass';
import { getImageBitmap, getPdfDocument, pageSize } from '../lib/pdf';
import { paths } from '../lib/router';
import { alive, newMeta, putRecord, softDelete, type ProjectState } from '../lib/store';
import { renderSource } from '../lib/thumbs';
import type { Plan, PlanRotation, Rect, SourceFile } from '../lib/types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PlanFields, planNumberError, type PlanFieldValues } from './PlanFields';
import { confirmDialog, showError, toast } from './ui';

/** Planquelle für ein neues Aufmaß: Originaldatei, Seite und Ausschnitt (aus einem vorhandenen Aufmaß oder ganze Seite) */
export interface PlanSource {
  file: SourceFile;
  pageIndex: number;
  /** Vorhandenes Aufmaß, dessen Ausschnitt, Kalibrierung und Papierformat übernommen werden */
  base: Plan | null;
}

/** Ansichten einer Datei: je Seite/Ausschnitt die Aufmaße, die darauf verweisen */
function viewsOf(data: ProjectState, file: SourceFile) {
  const plans = alive(data.plans).filter((p) => p.fileId === file.id && p.source !== 'drawing');
  const views = new Map<string, Plan[]>();
  for (const p of plans.sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt)) {
    const key = `${p.pageIndex}:${p.rotation ?? 0}:${JSON.stringify(p.crop)}`;
    views.set(key, [...(views.get(key) ?? []), p]);
  }
  const usedPages = new Set(plans.map((p) => p.pageIndex));
  const freePages = Array.from({ length: file.pageCount || 1 }, (_, i) => i).filter((i) => !usedPages.has(i));
  return { plans, views: [...views.values()], freePages };
}

export function SourceThumb({ file, pageIndex, crop, rotation = 0 }: { file: SourceFile; pageIndex: number; crop: Rect | null; rotation?: PlanRotation }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    renderSource(file, pageIndex, 360, crop, rotation)
      .then((c) => live && setUrl(c.toDataURL('image/jpeg', 0.75)))
      .catch(() => live && setUrl(''));
    return () => {
      live = false;
    };
  }, [file, pageIndex, crop, rotation]);
  return <div className="thumb lib-thumb">{url ? <img src={url} alt="" /> : <span className="muted small">{url === '' ? 'Keine Vorschau' : 'Vorschau …'}</span>}</div>;
}

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Planbibliothek des Projekts: alle importierten Originalpläne (PDF/Bild), wo sie verwendet
 * werden, und „Neues Aufmaß“ mit demselben Plan – ohne erneutes Hochladen, ohne die Messungen
 * des bisherigen Aufmaßes. Die Originaldatei wird nur einmal gespeichert.
 */
export function PlanLibrary({ data, onClose, onReuse }: { data: ProjectState; onClose: () => void; onReuse: (s: PlanSource) => void }) {
  const [q, setQ] = useState('');
  const files = useMemo(() => alive(data.files).sort((a, b) => b.createdAt - a.createdAt), [data.files]);
  const needle = q.trim().toLowerCase();
  const shown = files
    .map((f) => ({ file: f, ...viewsOf(data, f) }))
    .filter(({ file, plans }) => !needle || [file.name, ...plans.flatMap((p) => [p.planNumber, p.planName, p.title ?? '', p.floor])].some((s) => s.toLowerCase().includes(needle)));

  const removeFile = async (file: SourceFile) => {
    const ok = await confirmDialog({
      title: 'Originalplan entfernen?',
      message: <p>„{file.name}“ wird aus der Planbibliothek entfernt. Es verwendet ihn kein Aufmaß mehr.</p>,
      confirmLabel: 'Entfernen',
      danger: true,
    });
    if (!ok) return;
    softDelete({ files: [file] });
    toast('Originalplan entfernt.');
  };

  return (
    <Modal title="Planbibliothek" onClose={onClose} wide testId="plan-library">
      <p className="muted small">
        Alle importierten Originalpläne dieses Projekts. Mit „Neues Aufmaß“ verwenden Sie denselben Plan noch einmal – z. B. für eine andere
        Leistung oder Plannummer. Der Plan wird nicht erneut hochgeladen; bestehende Aufmaße bleiben unverändert.
      </p>
      <label className="field">
        <span className="sr-only">Suchen</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Plannummer, Bezeichnung oder Dateiname" data-testid="library-search" autoComplete="off" />
      </label>
      {!files.length && <p className="muted">Noch keine Pläne importiert.</p>}
      {files.length > 0 && !shown.length && <p className="muted">Kein Plan gefunden.</p>}
      <div className="lib-list">
        {shown.map(({ file, plans, views, freePages }) => (
          <section key={file.id} className="lib-file" data-testid="library-file" data-file={file.name}>
            <header className="lib-file-head">
              <Icon name={file.kind === 'pdf' ? 'pdf' : 'file'} size={18} />
              <strong className="lib-file-name">{file.name}</strong>
              <span className="muted small">
                {file.kind === 'pdf' ? `PDF · ${file.pageCount} ${file.pageCount === 1 ? 'Seite' : 'Seiten'}` : 'Bild'} · {kb(file.size)} · importiert am{' '}
                {new Date(file.createdAt).toLocaleDateString('de-DE')}
              </span>
              <span className="lib-usage small" data-testid="library-usage">
                {plans.length ? `verwendet in ${plans.length} ${plans.length === 1 ? 'Aufmaß' : 'Aufmaßen'}` : 'nicht verwendet'}
              </span>
            </header>
            <div className="lib-views">
              {views.map((group) => {
                const base = group[0];
                return (
                  <div key={base.id} className="lib-view" data-testid="library-view">
                    <SourceThumb file={file} pageIndex={base.pageIndex} crop={base.crop} rotation={base.rotation} />
                    <div className="lib-view-body">
                      <span className="muted small">
                        {file.pageCount > 1 ? `Seite ${base.pageIndex + 1} · ` : ''}
                        {base.crop ? 'Planbereich' : 'Ganze Seite'}
                        {base.rotation ? ` · gedreht ${base.rotation}°` : ''}
                        {base.calibration ? ` · kalibriert${base.calibration.auto ? ' (automatisch)' : ''}` : ''}
                      </span>
                      <ul className="lib-uses">
                        {group.map((p) => (
                          <li key={p.id}>
                            <a href={paths.plan(data.project.id, p.id)} onClick={onClose} data-testid="library-open">
                              {p.planNumber || 'Ohne Nummer'}
                            </a>{' '}
                            {p.planName && <span>{p.planName}</span>}{' '}
                            <span className="muted small">
                              · {damagesOf(data, p.id).length} Messungen
                              {costCenterLabel(data.costCenters[p.costCenterId]) ? ` · ${costCenterLabel(data.costCenters[p.costCenterId])}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => onReuse({ file, pageIndex: base.pageIndex, base })} data-testid="library-reuse">
                        <Icon name="plus" size={16} /> Neues Aufmaß
                      </button>
                    </div>
                  </div>
                );
              })}
              {freePages.map((i) => (
                <div key={`page-${i}`} className="lib-view" data-testid="library-page">
                  <SourceThumb file={file} pageIndex={i} crop={null} />
                  <div className="lib-view-body">
                    <span className="muted small">{file.pageCount > 1 ? `Seite ${i + 1} · ` : ''}Ganze Seite · noch kein Aufmaß</span>
                    <button type="button" className="btn btn-sm" onClick={() => onReuse({ file, pageIndex: i, base: null })} data-testid="library-reuse-page">
                      <Icon name="plus" size={16} /> Neues Aufmaß
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!plans.length && (
              <button type="button" className="btn btn-sm lib-remove" onClick={() => void removeFile(file)} data-testid="library-remove">
                <Icon name="trash" size={16} /> Aus Bibliothek entfernen
              </button>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** Freie Plannummer als Vorschlag: „A-101“ → „A-101-2“, „A-101-3“ … */
function suggestNumber(data: ProjectState, base: string): string {
  if (!base.trim()) return '';
  const taken = new Set(alive(data.plans).map((p) => p.planNumber.trim().toLowerCase()));
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`.toLowerCase())) return `${base}-${i}`;
}

/** Seitengröße (wie das vorhandene Aufmaß bzw. ungedreht aus einem anderen Aufmaß oder der Datei) */
async function sizeOf(data: ProjectState, file: SourceFile, pageIndex: number, base: Plan | null): Promise<{ width: number; height: number }> {
  if (base) return { width: base.pageWidth, height: base.pageHeight };
  const known = alive(data.plans).find((p) => p.fileId === file.id && p.pageIndex === pageIndex && !p.rotation);
  if (known) return { width: known.pageWidth, height: known.pageHeight };
  if (file.kind === 'pdf') return pageSize(await (await getPdfDocument(file.id)).getPage(pageIndex + 1));
  const bmp = await getImageBitmap(file.id, file.mimeType);
  return { width: bmp.width, height: bmp.height };
}

/**
 * Neues, leeres Aufmaß mit einem vorhandenen Plan: eigene Plannummer und Angaben. Übernommen
 * werden nur Planunterlage (Seite, Ausschnitt), Kalibrierung und Papierformat – keine Messungen,
 * Markierungen, Farben oder Leistungszuordnungen.
 */
export function ReusePlanDialog({
  data,
  source,
  costCenterId,
  onClose,
  onCreated,
}: {
  data: ProjectState;
  source: PlanSource;
  costCenterId: string;
  onClose: () => void;
  onCreated: (planId: string) => void;
}) {
  const { file, base, pageIndex } = source;
  const [v, setV] = useState<PlanFieldValues>({
    planNumber: suggestNumber(data, base?.planNumber ?? ''),
    planName: base?.planName ?? '',
    floor: base?.floor ?? '',
    area: base?.area ?? '',
    description: '',
    title: base?.title ?? '',
    showNote: false,
  });
  const ccs = alive(data.costCenters).sort((a, b) => a.sortIndex - b.sortIndex);
  const [cc, setCc] = useState(data.costCenters[costCenterId] ? costCenterId : (base?.costCenterId ?? ccs[0]?.id ?? ''));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const error = planNumberError(data, v.planNumber);

  const submit = async () => {
    setShow(true);
    if (error || busy) return;
    setBusy(true);
    try {
      const size = await sizeOf(data, file, pageIndex, base);
      const siblings = alive(data.plans).filter((p) => p.costCenterId === cc);
      const plan: Plan = {
        ...newMeta(),
        projectId: data.project.id,
        costCenterId: cc,
        fileId: file.id,
        pageIndex,
        pageWidth: size.width,
        pageHeight: size.height,
        crop: base?.crop ?? null,
        planNumber: v.planNumber.trim(),
        planName: v.planName.trim(),
        floor: v.floor.trim(),
        area: v.area.trim(),
        description: v.description.trim(),
        title: v.title?.trim() ?? '',
        showNote: !!v.showNote,
        numberStart: 1,
        sortIndex: siblings.length ? Math.max(...siblings.map((p) => p.sortIndex)) + 1 : 0,
        // gleiche Planunterlage: Kalibrierung, Papierformat und Darstellung gelten weiter
        ...(base?.calibration ? { calibration: structuredClone(base.calibration) } : {}),
        ...(base?.paper ? { paper: base.paper } : {}),
        ...(base ? { showPaper: base.showPaper, showScale: base.showScale, planColor: base.planColor } : {}),
        ...(base?.rotation ? { rotation: base.rotation } : {}),
      };
      putRecord('plans', plan);
      toast(`Neues Aufmaß „${plan.planNumber}“ angelegt – gleicher Plan, noch ohne Messungen.`, 'success', 4500);
      onCreated(plan.id);
    } catch (e) {
      showError(e, 'Aufmaß konnte nicht angelegt werden');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Neues Aufmaß mit diesem Plan"
      onClose={onClose}
      persistent
      testId="reuse-plan"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} data-testid="reuse-save">
            Aufmaß anlegen
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="reuse-source">
          <SourceThumb file={file} pageIndex={pageIndex} crop={base?.crop ?? null} rotation={base?.rotation} />
          <div className="small">
            <strong>{file.name}</strong>
            <span className="muted">
              {file.pageCount > 1 ? `Seite ${pageIndex + 1} · ` : ''}
              {base?.crop ? 'Planbereich' : 'Ganze Seite'}
            </span>
            <span>
              Übernommen: Planunterlage{base?.calibration ? ', Kalibrierung' : ''}
              {base?.paper ? ', Papierformat' : ''}.
            </span>
            <span className="muted">Nicht übernommen: Messungen, Markierungen, Farben, Leistungszuordnungen, Bauteile.</span>
          </div>
        </div>
        {ccs.length > 1 && (
          <label className="field">
            <span>Kostenstelle</span>
            <select value={cc} onChange={(e) => setCc(e.target.value)} data-testid="reuse-cost-center">
              {ccs.map((c) => (
                <option key={c.id} value={c.id}>
                  {costCenterLabel(c) || 'Ohne Kostenstelle'}
                </option>
              ))}
            </select>
          </label>
        )}
        <PlanFields value={v} onChange={(p) => setV({ ...v, ...p })} error={show ? error : null} />
        {!base?.calibration && file.kind === 'pdf' && (
          <p className="muted small">Noch keine Kalibrierung: im Plan unter „Kalibrieren“ automatisch erkennen lassen oder eine bekannte Strecke ziehen.</p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
