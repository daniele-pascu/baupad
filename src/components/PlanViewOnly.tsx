import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getImageBitmap, getPdfDocument, pageSize } from '../lib/pdf';
import type { Plan, SourceFile } from '../lib/types';
import { Icon } from './Icon';
import { PlanViewer, type PlanViewerHandle } from './PlanViewer';

const noop = () => {};

/**
 * Plan aus der Planbibliothek nur ansehen: ganze Seite in Originalfarben, wie im Aufmaß-Plan – mit zwei Fingern
 * (bzw. Mausrad) vergrößern, mit einem Finger verschieben, beim Hineinzoomen scharf in voller Auflösung nachgezeichnet.
 * Ohne Bearbeiten; mehrseitige PDFs blättern.
 */
export function PlanViewOnly({ file, pageIndex, onClose }: { file: SourceFile; pageIndex: number; onClose: () => void }) {
  const [page, setPage] = useState(pageIndex);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const viewer = useRef<PlanViewerHandle>(null);

  useEffect(() => {
    let live = true;
    setSize(null);
    setFailed(false);
    (file.kind === 'pdf'
      ? getPdfDocument(file.id).then((doc) => doc.getPage(page + 1)).then((p) => pageSize(p))
      : getImageBitmap(file.id, file.mimeType).then((b) => ({ width: b.width, height: b.height }))
    )
      .then((s) => live && setSize(s))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [file, page]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);

  // nur für die Anzeige: ganze Seite, Originalfarben, ohne Messungen (wird nirgends gespeichert)
  const plan = useMemo(
    () =>
      size
        ? ({
            id: `library-view:${file.id}:${page}`,
            projectId: file.projectId,
            fileId: file.id,
            pageIndex: page,
            pageWidth: size.width,
            pageHeight: size.height,
            crop: null,
            planColor: true,
          } as unknown as Plan)
        : null,
    [file.id, file.projectId, page, size],
  );

  const pages = file.pageCount || 1;
  // eigene Ebene über allem (nicht im Fenster der Planbibliothek eingesperrt)
  return createPortal(
    <div className="lib-viewer" role="dialog" aria-modal="true" aria-label={`${file.name} ansehen`} data-testid="library-viewer">
      <header className="lib-viewer-head">
        <strong className="lib-viewer-name">{file.name}</strong>
        {pages > 1 && (
          <span className="lib-viewer-pages">
            <button type="button" className="icon-btn" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Vorherige Seite">
              <Icon name="back" size={18} />
            </button>
            <span className="small" data-testid="library-viewer-page">
              Seite {page + 1} / {pages}
            </span>
            <button type="button" className="icon-btn" onClick={() => setPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} aria-label="Nächste Seite">
              <Icon name="next" size={18} />
            </button>
          </span>
        )}
        <span className="lib-viewer-zoom">
          <button type="button" className="icon-btn" onClick={() => viewer.current?.zoomOut()} disabled={!plan} aria-label="Verkleinern" data-testid="library-viewer-zoom-out">
            <Icon name="minus" size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={() => viewer.current?.fit()} disabled={!plan} aria-label="Ganzer Plan" data-testid="library-viewer-fit">
            <Icon name="fit" size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={() => viewer.current?.zoomIn()} disabled={!plan} aria-label="Vergrößern" data-testid="library-viewer-zoom-in">
            <Icon name="plus" size={18} />
          </button>
        </span>
        <button type="button" className="icon-btn lib-viewer-close" onClick={onClose} aria-label="Schließen" data-testid="library-viewer-close">
          <Icon name="close" size={20} />
        </button>
      </header>
      <div className="lib-viewer-body">
        {plan ? (
          <PlanViewer
            key={plan.id}
            ref={viewer}
            plan={plan}
            file={file}
            damages={[]}
            selectedId={null}
            tool="select"
            color="#000000"
            pending={null}
            onSelect={noop}
            onCreate={noop}
            onShapeChange={noop}
            onLabelChange={noop}
            components={[]}
            selectedComponentId={null}
            onSelectComponent={noop}
            onComponentMove={noop}
            onPlace={noop}
            restoreView={false}
            showLabels={false}
          />
        ) : (
          <span className="lib-viewer-msg muted">{failed ? 'Keine Vorschau möglich' : 'Plan wird geladen …'}</span>
        )}
      </div>
    </div>,
    document.body,
  );
}
