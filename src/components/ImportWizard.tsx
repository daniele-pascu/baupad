import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { putBlob } from '../lib/db';
import { uuid } from '../lib/ids';
import { naturalCompare } from '../lib/numbers';
import { contentBounds } from '../lib/layout-detect';
import { closePdf, imageToCanvas, loadImageBitmap, openPdf, pageSize, readPageSegments, readPageText, renderPdfToCanvas, rotatedSize } from '../lib/pdf';
import { calibrationFrom, detectScale, type PageText, type ScaleDetection } from '../lib/scale-detect';
import { alive, newMeta, putRecords, type ProjectState } from '../lib/store';
import type { PaperFormat, Plan, PlanRotation, Rect, SourceFile } from '../lib/types';
import { defaultPaper } from '../lib/sheet-layout';
import { AreaEditor } from './AreaEditor';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { ExportPaperField, PlanFields, planNumberTaken, type PlanFieldValues } from './PlanFields';
import { sameNumberScope } from '../lib/invoices';
import { showError, toast } from './ui';

interface Props {
  file: File;
  data: ProjectState;
  costCenterId: string;
  /** aufgeteiltes Projekt: Rechnung der neuen Pläne */
  invoiceId?: string | null;
  onClose: () => void;
  onDone: (planIds: string[]) => void;
}

interface Draft extends PlanFieldValues {
  key: string;
  pageIndex: number;
  crop: Rect | null;
  /** Drehung der Seite im Uhrzeigersinn */
  rotation: PlanRotation;
  /** Papierformat für den PDF-Export (Standard: A4 passend zur Ausrichtung) */
  paper: PaperFormat;
  /** Format im PDF anzeigen (Standard: nein) */
  showPaper: boolean;
}

type Step = 'loading' | 'pages' | 'areas' | 'describe' | 'saving';

export function detectKind(file: File): 'pdf' | 'image' | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (['image/jpeg', 'image/png', 'image/jpg'].includes(file.type) || /\.(jpe?g|png)$/.test(name)) return 'image';
  return null;
}

function mimeOf(file: File, kind: 'pdf' | 'image'): string {
  if (kind === 'pdf') return 'application/pdf';
  if (file.type) return file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  return file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/**
 * Import-Assistent: Datei → Seitenauswahl (mehrseitige PDFs) → Planbereiche →
 * Planbeschreibung → Speichern.
 */
export function ImportWizard({ file, data, costCenterId, invoiceId = null, onClose, onDone }: Props) {
  const kind = detectKind(file);
  const [step, setStep] = useState<Step>('loading');
  const [buf, setBuf] = useState<ArrayBuffer | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [sizes, setSizes] = useState<Map<number, { width: number; height: number }>>(new Map());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [areas, setAreas] = useState<Map<number, Rect[]>>(new Map());
  // Drehung je Seite (Bereiche beziehen sich auf die gedrehte Seite)
  const [rotations, setRotations] = useState<Map<number, PlanRotation>>(new Map());
  const rotOf = (page: number): PlanRotation => rotations.get(page) ?? 0;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editingPage, setEditingPage] = useState<{ page: number; image: HTMLCanvasElement } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const baseName = file.name.replace(/\.[^.]+$/, '');

  // Datei laden
  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    let bmp: ImageBitmap | null = null;
    (async () => {
      if (!kind) {
        setError('Dieses Dateiformat wird nicht unterstützt. Bitte PDF, JPG oder PNG verwenden.');
        return;
      }
      const data = await file.arrayBuffer();
      if (cancelled) return;
      setBuf(data);
      if (kind === 'pdf') {
        opened = await openPdf(data);
        if (cancelled) return void closePdf(opened);
        setDoc(opened);
        setPageCount(opened.numPages);
        if (opened.numPages === 1) {
          setSelected(new Set([0]));
          setStep('areas');
        } else setStep('pages');
      } else {
        bmp = await loadImageBitmap(data, mimeOf(file, kind));
        if (cancelled) return;
        setBitmap(bmp);
        setPageCount(1);
        setSizes(new Map([[0, { width: bmp.width, height: bmp.height }]]));
        setSelected(new Set([0]));
        setStep('areas');
      }
    })().catch((e) => {
      console.error(e);
      setError(
        (e as Error)?.name === 'PasswordException'
          ? 'Die PDF-Datei ist kennwortgeschützt und kann nicht geöffnet werden.'
          : `Die Datei konnte nicht gelesen werden: ${(e as Error).message}`,
      );
    });
    return () => {
      cancelled = true;
      if (opened) void closePdf(opened);
      bmp?.close();
    };
  }, [file, kind]);

  // Seitengrößen der ausgewählten Seiten ermitteln (ungedreht gespeichert, gedreht geliefert)
  const getSize = async (page: number, rot = rotOf(page)) => {
    let raw = sizes.get(page);
    if (!raw) {
      raw = pageSize(await doc!.getPage(page + 1));
      const s = raw;
      setSizes((m) => new Map(m).set(page, s));
    }
    return rotatedSize(raw.width, raw.height, rot);
  };

  const sortedPages = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);

  const renderPage = async (page: number, maxSide: number): Promise<HTMLCanvasElement> => {
    if (kind === 'pdf') return renderPdfToCanvas(await doc!.getPage(page + 1), maxSide, null, rotOf(page));
    return imageToCanvas(bitmap!, maxSide, null, rotOf(page));
  };

  /** Seite drehen: festgelegte Bereiche gelten danach nicht mehr */
  const rotatePage = (page: number, turn: 90 | 270) => {
    setRotations(new Map(rotations).set(page, ((rotOf(page) + turn) % 360) as PlanRotation));
    if (areas.get(page)?.length) {
      setAreas(new Map(areas).set(page, []));
      toast('Seite gedreht – die Planbereiche bitte neu festlegen.');
    }
  };

  /** Weiße Ränder entfernen: Planbereich = Inhalt der Seite (Vorschlag, unter „Bereiche …“ anpassbar) */
  const trimPage = async (page: number) => {
    try {
      const size = await getSize(page);
      const canvas = await renderPage(page, 1400);
      const img = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
      const r = contentBounds(img, size.width, size.height);
      if (!r) return toast('Kein nennenswerter weißer Rand gefunden – die ganze Seite wird verwendet.');
      setAreas(new Map(areas).set(page, [r]));
      toast('Weißer Rand entfernt. Bei Bedarf unter „Bereiche …“ anpassen.', 'success');
    } catch (e) {
      showError(e);
    }
  };

  const openAreaEditor = async (page: number) => {
    try {
      await getSize(page);
      const image = await renderPage(page, 1800);
      setEditingPage({ page, image });
    } catch (e) {
      showError(e);
    }
  };

  const goDescribe = async () => {
    const pageSizes = new Map<number, { width: number; height: number }>();
    for (const p of sortedPages) pageSizes.set(p, await getSize(p));
    const prev = new Map(drafts.map((d) => [d.key, d]));
    const next: Draft[] = [];
    for (const page of sortedPages) {
      const list = areas.get(page) ?? [];
      const crops: (Rect | null)[] = list.length ? list : [null];
      crops.forEach((crop, i) => {
        const key = `${page}:${rotOf(page)}:${i}:${crop ? Math.round(crop.x) + ',' + Math.round(crop.y) : 'full'}`;
        const old = prev.get(key);
        const suffix = [pageCount > 1 ? `Seite ${page + 1}` : '', crops.length > 1 ? `Bereich ${i + 1}` : ''].filter(Boolean).join(', ');
        next.push(
          old ?? {
            key,
            pageIndex: page,
            crop,
            rotation: rotOf(page),
            showPaper: false,
            paper: defaultPaper(crop ?? { w: pageSizes.get(page)!.width, h: pageSizes.get(page)!.height }),
            planNumber: '',
            planName: suffix ? `${baseName} (${suffix})` : baseName,
            floor: '',
            area: '',
            description: '',
          },
        );
      });
    }
    setDrafts(next);
    setShowErrors(false);
    setStep('describe');
  };

  const existingNumbers = useMemo(
    () => new Set(alive(data.plans).filter(sameNumberScope(data.project, invoiceId)).map((p) => p.planNumber.trim().toLowerCase()).filter(Boolean)),
    [data.plans, data.project, invoiceId],
  );

  const draftErrors = drafts.map((d, i) => {
    const n = d.planNumber.trim().toLowerCase();
    if (!n) return 'Bitte eine Plannummer eingeben.';
    if (existingNumbers.has(n)) return planNumberTaken(data);
    if (drafts.some((o, j) => j !== i && o.planNumber.trim().toLowerCase() === n))
      return 'Diese Plannummer ist mehrfach vergeben.';
    return null;
  });

  const save = async () => {
    setShowErrors(true);
    if (draftErrors.some(Boolean)) {
      toast('Bitte die markierten Angaben prüfen.', 'error');
      return;
    }
    setStep('saving');
    try {
      const fileId = uuid();
      await putBlob(fileId, data.project.id, buf!);
      const sf: SourceFile = {
        ...newMeta(),
        id: fileId,
        projectId: data.project.id,
        name: file.name,
        mimeType: mimeOf(file, kind!),
        size: file.size,
        kind: kind!,
        pageCount,
      };
      const existing = alive(data.plans).filter((p) => p.costCenterId === costCenterId);
      let sortIndex = existing.length ? Math.max(...existing.map((p) => p.sortIndex)) + 1 : 0;
      // Maßstab automatisch erkennen (nur PDF mit Text): Maßstabsangabe und Maßketten im Ausschnitt
      const detected = new Map<number, ScaleDetection | null>();
      if (kind === 'pdf' && doc) {
        const texts = new Map<string, PageText[]>();
        for (const [i, d] of drafts.entries()) {
          try {
            const tk = `${d.pageIndex}:${d.rotation}`;
            const pg = await doc.getPage(d.pageIndex + 1);
            if (!texts.has(tk)) texts.set(tk, await readPageText(pg, d.rotation));
            const size = await getSize(d.pageIndex, d.rotation);
            const region = d.crop ?? { x: 0, y: 0, w: size.width, h: size.height };
            // Maßlinien des Bereichs (Vektor-PDF) – zuverlässigste Quelle für den Maßstab
            const segs = await readPageSegments(pg, d.rotation, region).catch(() => []);
            detected.set(i, detectScale(texts.get(tk)!, region, segs));
          } catch {
            detected.set(i, null); // Erkennung ist optional – Import geht immer weiter
          }
        }
      }
      const draftSizes = await Promise.all(drafts.map((d) => getSize(d.pageIndex, d.rotation)));
      const plans: Plan[] = drafts.map((d, i) => {
        const size = draftSizes[i];
        const det = detected.get(i);
        return {
          ...newMeta(),
          projectId: data.project.id,
          costCenterId,
          ...(invoiceId ? { invoiceId } : {}),
          fileId,
          pageIndex: d.pageIndex,
          pageWidth: size.width,
          pageHeight: size.height,
          crop: d.crop,
          planNumber: d.planNumber.trim(),
          planName: d.planName.trim(),
          floor: d.floor.trim(),
          area: d.area.trim(),
          description: d.description.trim(),
          title: d.title?.trim() ?? '',
          showNote: !!d.showNote,
          showPaper: d.showPaper,
          paper: d.paper,
          numberStart: 1,
          sortIndex: sortIndex++,
          ...(d.rotation ? { rotation: d.rotation } : {}),
          ...(det ? { calibration: calibrationFrom(det) } : {}),
        };
      });
      putRecords({ files: [sf], plans });
      const scaled = plans.filter((p) => p.calibration?.auto);
      toast(
        `${plans.length} Plan/Pläne importiert.` +
          (scaled.length ? ` Maßstab erkannt: ${scaled.map((p) => `${p.planNumber} ${p.calibration!.auto!.label}`).join(', ')}.` : kind === 'pdf' ? ' Kein Maßstab im Plan gefunden – bei Bedarf kalibrieren.' : ''),
        'success',
        scaled.length ? 6000 : undefined,
      );
      onDone(plans.sort((a, b) => naturalCompare(a.planNumber, b.planNumber)).map((p) => p.id));
    } catch (e) {
      showError(e, 'Import fehlgeschlagen');
      setStep('describe');
    }
  };

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (error) {
    body = <div className="banner banner-error">{error}</div>;
    footer = (
      <button type="button" className="btn" onClick={onClose}>
        Schließen
      </button>
    );
  } else if (step === 'loading') {
    body = <p className="muted">Datei wird gelesen …</p>;
  } else if (step === 'pages') {
    body = (
      <>
        <p>
          Die PDF-Datei <strong>{file.name}</strong> enthält <strong>{pageCount} Seiten</strong>. Wählen Sie die Seiten aus, die als
          Pläne verwendet werden sollen.
        </p>
        <div className="row gap">
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(Array.from({ length: pageCount }, (_, i) => i)))}>
            Alle auswählen
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
            Keine
          </button>
          <span className="muted small">{selected.size} ausgewählt</span>
        </div>
        <div className="page-grid" data-testid="page-grid">
          {Array.from({ length: pageCount }, (_, i) => (
            <PageTile
              key={i}
              index={i}
              selected={selected.has(i)}
              render={() => renderPage(i, 240)}
              onToggle={() => {
                const s = new Set(selected);
                if (s.has(i)) s.delete(i);
                else s.add(i);
                setSelected(s);
              }}
            />
          ))}
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
        <button type="button" className="btn btn-primary" disabled={!selected.size} onClick={() => setStep('areas')} data-testid="pages-next">
          Weiter
        </button>
      </>
    );
  } else if (step === 'areas') {
    body = (
      <>
        <p>
          Standardmäßig wird jeweils die ganze Seite als Plan verwendet. Liegen mehrere Pläne auf einer Seite, können Sie
          Planbereiche erkennen lassen oder selbst festlegen.
        </p>
        <ul className="area-list">
          {sortedPages.map((page) => {
            const list = areas.get(page) ?? [];
            return (
              <li key={page} className="area-list-item">
                <PageTile key={rotOf(page)} index={page} render={() => renderPage(page, 240)} small />
                <div className="grow">
                  <strong>{pageCount > 1 ? `Seite ${page + 1}` : file.name}</strong>
                  <div className="muted small" data-testid="page-state">
                    {list.length ? `${list.length} Planbereich(e)` : 'Ganze Seite'}
                    {rotOf(page) ? ` · gedreht um ${rotOf(page)}°` : ''}
                  </div>
                </div>
                <div className="row wrap area-actions">
                  <button type="button" className="icon-btn" onClick={() => rotatePage(page, 270)} title="Nach links drehen (90°)" aria-label="Nach links drehen" data-testid="rotate-page-left">
                    <Icon name="rotate" size={18} className="flip-x" />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => rotatePage(page, 90)} title="Nach rechts drehen (90°)" aria-label="Nach rechts drehen" data-testid="rotate-page-right">
                    <Icon name="rotate" size={18} />
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void trimPage(page)} title="Weiße Ränder automatisch abschneiden" data-testid="trim-page">
                    <Icon name="fit" size={18} /> Ränder abschneiden
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void openAreaEditor(page)} data-testid="edit-areas">
                    <Icon name="crop" size={18} /> Bereiche …
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </>
    );
    footer = (
      <>
        {kind === 'pdf' && pageCount > 1 ? (
          <button type="button" className="btn" onClick={() => setStep('pages')}>
            Zurück
          </button>
        ) : (
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void goDescribe()} data-testid="areas-next">
          Weiter
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p>Beschreiben Sie die Pläne. Die Angaben können später jederzeit geändert werden.</p>
        <div className="draft-list">
          {drafts.map((d, i) => (
            <div key={d.key} className="draft card" data-testid="plan-draft">
              <div className="draft-head">
                <PageTile index={d.pageIndex} render={() => renderDraft(d)} small />
                <div className="muted small">
                  {pageCount > 1 && `Seite ${d.pageIndex + 1} · `}
                  {d.crop ? 'Planbereich' : 'Ganze Seite'}
                  {d.rotation ? ` · gedreht um ${d.rotation}°` : ''}
                </div>
              </div>
              <PlanFields
                value={d}
                error={showErrors ? draftErrors[i] : null}
                onChange={(v) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, ...v } : x)))}
              />
              <ExportPaperField
                value={d.paper}
                onChange={(paper) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, paper } : x)))}
                show={d.showPaper}
                onShow={(showPaper) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, showPaper } : x)))}
              />
            </div>
          ))}
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className="btn" onClick={() => setStep('areas')} disabled={step === 'saving'}>
          Zurück
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={step === 'saving'} data-testid="import-save">
          {step === 'saving' ? 'Wird gespeichert …' : `${drafts.length} Plan/Pläne importieren`}
        </button>
      </>
    );
  }

  async function renderDraft(d: Draft) {
    if (kind === 'pdf') return renderPdfToCanvas(await doc!.getPage(d.pageIndex + 1), 240, d.crop, d.rotation);
    return imageToCanvas(bitmap!, 240, d.crop, d.rotation);
  }

  return (
    <>
      <Modal title="Plan importieren" onClose={onClose} wide persistent footer={footer} testId="import-wizard">
        {body}
      </Modal>
      {editingPage && (
        <AreaEditor
          title={pageCount > 1 ? `Planbereiche – Seite ${editingPage.page + 1}` : 'Planbereiche'}
          image={editingPage.image}
          pageWidth={rotatedSize(sizes.get(editingPage.page)!.width, sizes.get(editingPage.page)!.height, rotOf(editingPage.page)).width}
          pageHeight={rotatedSize(sizes.get(editingPage.page)!.width, sizes.get(editingPage.page)!.height, rotOf(editingPage.page)).height}
          initial={areas.get(editingPage.page) ?? []}
          onClose={() => setEditingPage(null)}
          onDone={(list) => {
            setAreas(new Map(areas).set(editingPage.page, list));
            setEditingPage(null);
          }}
        />
      )}
    </>
  );
}

/** Seitenvorschau, die erst gerendert wird, wenn sie sichtbar ist. */
function PageTile({
  index,
  selected,
  onToggle,
  render,
  small,
}: {
  index: number;
  selected?: boolean;
  onToggle?: () => void;
  render: () => Promise<HTMLCanvasElement>;
  small?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current!;
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (done || !entries.some((e) => e.isIntersecting)) return;
      done = true;
      io.disconnect();
      enqueue(render)
        .then((c) => setUrl(c.toDataURL('image/jpeg', 0.7)))
        .catch((e) => console.warn(e));
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const content = (
    <>
      <div className="thumb">{url ? <img src={url} alt="" /> : <span className="muted small">…</span>}</div>
      {!small && (
        <div className="page-tile-label">
          {onToggle && <input type="checkbox" checked={!!selected} readOnly tabIndex={-1} />}
          Seite {index + 1}
        </div>
      )}
    </>
  );
  if (!onToggle)
    return (
      <div ref={ref} className={`page-tile${small ? ' page-tile-small' : ''}`}>
        {content}
      </div>
    );
  return (
    <div ref={ref} className="page-tile-wrap">
      <button type="button" className={`page-tile${selected ? ' selected' : ''}`} onClick={onToggle} aria-pressed={selected} data-testid="page-tile">
        {content}
      </button>
    </div>
  );
}

// Seitenvorschauen nacheinander rendern (schont Speicher und CPU auf Mobilgeräten)
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const p = chain.then(job, job);
  chain = p.catch(() => {});
  return p;
}
