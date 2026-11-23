import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { costCenterLabel } from '../lib/aufmass';
import { closePdf, getImageBitmap, getPdfDocument, openPdf, pageSize } from '../lib/pdf';
import { putBlob } from '../lib/db';
import { uuid } from '../lib/ids';
import { detectKind, mimeOf } from './ImportWizard';
import { sameNumberScope } from '../lib/invoices';
import { alive, newMeta, putRecord, softDelete, type ProjectState } from '../lib/store';
import { renderSource } from '../lib/thumbs';
import type { Plan, PlanRotation, Rect, SourceFile } from '../lib/types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PlanFields, planNumberError, type PlanFieldValues } from './PlanFields';
import { confirmDialog, promptDialog, showError, toast } from './ui';
import { deepClone } from '../lib/compat';

/** Planquelle für ein neues Aufmaß: Originaldatei, Seite und Ausschnitt (aus einem vorhandenen Aufmaß oder ganze Seite) */
export interface PlanSource {
  file: SourceFile;
  pageIndex: number;
  /** Vorhandenes Aufmaß, dessen Ausschnitt, Kalibrierung und Papierformat übernommen werden */
  base: Plan | null;
}

// Plan groß ansehen (Planansicht wie im Aufmaß) erst bei Bedarf laden
const PlanViewOnly = lazy(() => import('./PlanViewOnly').then((m) => ({ default: m.PlanViewOnly })));

/**
 * Seiten einer Datei. Je Seite das älteste Aufmaß mit der ganzen, ungedrehten Seite als Vorlage für „Neues Aufmaß“
 * (Kalibrierung, Papierformat, Plannummer als Vorschlag); angezeigt wird es nicht.
 */
function pagesOf(data: ProjectState, file: SourceFile) {
  const plans = alive(data.plans)
    .filter((p) => p.fileId === file.id && p.source !== 'drawing')
    .sort((a, b) => a.createdAt - b.createdAt);
  const pages = Array.from({ length: file.pageCount || 1 }, (_, i) => ({
    index: i,
    base: plans.find((p) => p.pageIndex === i && !p.crop && !p.rotation) ?? null,
  }));
  return { plans, pages };
}

export function SourceThumb({
  file,
  pageIndex,
  crop,
  rotation = 0,
  size = 360,
}: {
  file: SourceFile;
  pageIndex: number;
  crop: Rect | null;
  rotation?: PlanRotation;
  /** längste Seite der Vorschau in Pixeln */
  size?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    renderSource(file, pageIndex, size, crop, rotation)
      .then((c) => live && setUrl(c.toDataURL('image/jpeg', size > 360 ? 0.85 : 0.75)))
      .catch(() => live && setUrl(''));
    return () => {
      live = false;
    };
  }, [file, pageIndex, crop, rotation, size]);
  return <div className="thumb lib-thumb">{url ? <img src={url} alt="" /> : <span className="muted small">{url === '' ? 'Keine Vorschau' : 'Vorschau …'}</span>}</div>;
}

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Planbibliothek des Projekts: nur die importierten Originalpläne (PDF/Bild), je Seite groß – ohne Angabe, wo sie
 * verwendet werden. Antippen öffnet den Plan wie im Aufmaß (Finger-Zoom, volle Auflösung); „Neues Aufmaß“ mit
 * demselben Plan ohne erneutes Hochladen und ohne die Messungen bisheriger Aufmaße. Die Datei wird nur einmal gespeichert.
 */
export function PlanLibrary({ data, onClose, onReuse }: { data: ProjectState; onClose: () => void; onReuse: (s: PlanSource) => void }) {
  const [q, setQ] = useState('');
  // Plan nur ansehen (Tipp auf die Vorschau): groß öffnen und wieder schließen, ohne etwas zu ändern
  const [viewing, setViewing] = useState<{ file: SourceFile; pageIndex: number } | null>(null);
  const files = useMemo(() => alive(data.files).sort((a, b) => b.createdAt - a.createdAt), [data.files]);
  const needle = q.trim().toLowerCase();
  const shown = files
    .map((f) => ({ file: f, ...pagesOf(data, f) }))
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

  /** Plan umbenennen: nur die Bezeichnung in der Bibliothek – die Dateiendung (.pdf, .jpg …) bleibt erhalten */
  const renameFile = async (file: SourceFile) => {
    const ext = /\.[A-Za-z0-9]{2,5}$/.exec(file.name)?.[0] ?? '';
    const input = await promptDialog({ title: 'Plan umbenennen', label: 'Bezeichnung', value: ext ? file.name.slice(0, -ext.length) : file.name });
    const base = input?.trim();
    if (!base) return;
    const name = ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base;
    if (name === file.name) return;
    putRecord('files', { ...file, name });
    toast('Plan umbenannt.', 'success', 2000);
  };

  // Pläne nur in die Bibliothek hochladen (ohne Aufmaß) – später mit „Neues Aufmaß“ auswählen
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    let n = 0;
    try {
      for (const f of Array.from(list)) {
        const kind = detectKind(f);
        if (!kind) {
          toast(`„${f.name}“: nur PDF, JPG oder PNG.`, 'error');
          continue;
        }
        const buf = await f.arrayBuffer();
        let pageCount = 1;
        if (kind === 'pdf') {
          const doc = await openPdf(buf);
          pageCount = doc.numPages;
          await closePdf(doc);
        }
        const id = uuid();
        await putBlob(id, data.project.id, buf);
        putRecord('files', { ...newMeta(), id, projectId: data.project.id, name: f.name, mimeType: mimeOf(f, kind), size: f.size, kind, pageCount });
        n++;
      }
      if (n) toast(n === 1 ? 'Plan in die Planbibliothek hochgeladen.' : `${n} Pläne in die Planbibliothek hochgeladen.`, 'success');
    } catch (e) {
      showError(e, 'Hochladen fehlgeschlagen');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Modal title="Planbibliothek" onClose={onClose} wide testId="plan-library">
      <p className="muted small">
        Alle Originalpläne dieses Projekts – unbearbeitet, so wie hochgeladen. Jeder Plan, der für ein Aufmaß importiert wird, landet automatisch
        hier. Pläne lassen sich auch nur hier hochladen und später mit „Neues Aufmaß“ auswählen.
      </p>
      <div className="row gap wrap lib-upload-row">
        <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={uploading} data-testid="library-upload">
          <Icon name="upload" size={18} /> {uploading ? 'Wird hochgeladen …' : 'Pläne hochladen'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
          data-testid="library-file-input"
        />
      </div>
      <label className="field">
        <span className="sr-only">Suchen</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Plannummer, Bezeichnung oder Dateiname" data-testid="library-search" autoComplete="off" />
      </label>
      {!files.length && <p className="muted">Noch keine Pläne – oben hochladen oder einen Plan für ein Aufmaß importieren.</p>}
      {files.length > 0 && !shown.length && <p className="muted">Kein Plan gefunden.</p>}
      <div className="lib-list">
        {shown.map(({ file, plans, pages }) => (
          <section key={file.id} className="lib-file" data-testid="library-file" data-file={file.name}>
            <header className="lib-file-head">
              <Icon name={file.kind === 'pdf' ? 'pdf' : 'file'} size={18} />
              <strong className="lib-file-name">{file.name}</strong>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => void renameFile(file)} aria-label={`„${file.name}“ umbenennen`} title="Umbenennen" data-testid="library-rename">
                <Icon name="edit" size={16} />
              </button>
              <span className="muted small">
                {file.kind === 'pdf' ? `PDF · ${file.pageCount} ${file.pageCount === 1 ? 'Seite' : 'Seiten'}` : 'Bild'} · {kb(file.size)} · hochgeladen am{' '}
                {new Date(file.createdAt).toLocaleDateString('de-DE')}
              </span>
            </header>
            <div className="lib-pages">
              {pages.map(({ index, base }) => (
                <div key={index} className="lib-page" data-testid="library-page">
                  <button
                    type="button"
                    className="lib-thumb-btn"
                    onClick={() => setViewing({ file, pageIndex: index })}
                    aria-label={`${file.name}${file.pageCount > 1 ? `, Seite ${index + 1}` : ''} ansehen`}
                    data-testid="library-view-open"
                  >
                    <SourceThumb file={file} pageIndex={index} crop={null} size={900} />
                  </button>
                  <div className="lib-page-foot">
                    <span className="muted small">{file.pageCount > 1 ? `Seite ${index + 1}` : ''}</span>
                    <button type="button" className="btn btn-sm" onClick={() => onReuse({ file, pageIndex: index, base })} data-testid="library-reuse">
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
      {viewing && (
        <Suspense fallback={null}>
          <PlanViewOnly file={viewing.file} pageIndex={viewing.pageIndex} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </Modal>
  );
}

/** Freie Plannummer als Vorschlag: „A-101“ (in einer anderen Rechnung noch frei) bzw. „A-101-2“, „A-101-3“ … */
export function suggestNumber(data: ProjectState, base: string, invoiceId: string | null): string {
  if (!base.trim()) return '';
  const scope = sameNumberScope(data.project, invoiceId);
  const taken = new Set(alive(data.plans).filter(scope).map((p) => p.planNumber.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return base.trim();
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
  invoiceId = null,
  onClose,
  onCreated,
}: {
  data: ProjectState;
  source: PlanSource;
  costCenterId: string;
  /** aufgeteiltes Projekt: Rechnung des neuen Plans */
  invoiceId?: string | null;
  onClose: () => void;
  onCreated: (planId: string) => void;
}) {
  const { file, base, pageIndex } = source;
  const [v, setV] = useState<PlanFieldValues>({
    planNumber: suggestNumber(data, base?.planNumber ?? '', invoiceId),
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
  const error = planNumberError(data, v.planNumber, undefined, invoiceId);

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
        ...(invoiceId ? { invoiceId } : {}),
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
        showName: v.showName !== false,
        showFloor: v.showFloor !== false,
        numberStart: 1,
        sortIndex: siblings.length ? Math.max(...siblings.map((p) => p.sortIndex)) + 1 : 0,
        // gleiche Planunterlage: Kalibrierung, Papierformat und Darstellung gelten weiter
        ...(base?.calibration ? { calibration: deepClone(base.calibration) } : {}),
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
