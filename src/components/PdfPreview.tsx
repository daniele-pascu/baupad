import { useEffect, useState, type ReactNode } from 'react';
import { safeFileName, type ExportFile } from '../lib/aufmass';
import { getMeta, setMeta } from '../lib/db';
import { canSaveAs, canShareFile, downloadFile, isIOS, isTouchDevice, saveFileAs, shareFile } from '../lib/download';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { showError, toast } from './ui';

/** höchstens so viele Seiten in der Vorschau (Speicher auf iPhone/iPad) */
const MAX_PREVIEW_PAGES = 30;

/** Vorschau des fertigen PDFs (alle Seiten) und Speichern – siehe `FilePreview` */
export function PdfPreview({ file, onBack, onClose }: { file: ExportFile; onBack(): void; onClose(): void }) {
  const [pages, setPages] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const { openPdf, closePdf, renderPdfToCanvas, canvasToBlob } = await import('../lib/pdf');
      const doc = await openPdf(file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength) as ArrayBuffer);
      try {
        if (cancelled) return;
        setCount(doc.numPages);
        for (let i = 1; i <= Math.min(doc.numPages, MAX_PREVIEW_PAGES); i++) {
          const canvas = await renderPdfToCanvas(await doc.getPage(i), 1400);
          const url = URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.88));
          canvas.width = canvas.height = 0;
          if (cancelled) return URL.revokeObjectURL(url);
          urls.push(url);
          setPages([...urls]);
        }
      } finally {
        void closePdf(doc);
      }
    })().catch((e) => !cancelled && showError(e, 'Vorschau konnte nicht erstellt werden'));
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [file]);

  return (
    <FilePreview file={file} title="PDF-Vorschau" testId="pdf-preview" onBack={onBack} onClose={onClose}>
      <div className="preview-pages" data-testid="preview-pages">
        {count === null && <p className="muted">Vorschau wird erstellt …</p>}
        {pages.map((u, i) => (
          <figure key={u} className="preview-page">
            <img src={u} alt={`Seite ${i + 1}`} data-testid="preview-page" />
            <figcaption className="muted small">
              Seite {i + 1}
              {count ? ` von ${count}` : ''}
            </figcaption>
          </figure>
        ))}
        {count !== null && count > MAX_PREVIEW_PAGES && (
          <p className="muted small">Vorschau zeigt die ersten {MAX_PREVIEW_PAGES} Seiten – gespeichert werden alle {count}.</p>
        )}
      </div>
    </FilePreview>
  );
}

/**
 * Rahmen jeder Vorschau (PDF, Excel): Inhalt oben, unten Dateiname und Speichern – am PC „Speichern unter …“ mit
 * Ordnerwahl (Ordner wird gemerkt), auf iPhone/iPad/Android „Teilen / In Dateien sichern“, überall „Herunterladen“.
 * Der Dateiname lässt sich vorher ändern. `onSaved` läuft nach dem Speichern (nicht beim bloßen Schließen).
 */
export function FilePreview({
  file,
  title,
  testId,
  onBack,
  onClose,
  onSaved,
  extra,
  wait,
  children,
}: {
  file: ExportFile;
  title: string;
  testId: string;
  onBack(): void;
  onClose(): void;
  onSaved?(): void;
  /** weitere Angabe neben dem Dateinamen (z. B. Schalter „Excel | PDF“) */
  extra?: ReactNode;
  /** Datei wird gerade erstellt: Speichern erst danach */
  wait?: boolean;
  children: ReactNode;
}) {
  const ext = file.name.split('.').pop() ?? '';
  const pdf = ext.toLowerCase() === 'pdf';
  const [name, setName] = useState(file.name.slice(0, file.name.length - ext.length - 1));
  const [saving, setBusy] = useState(false);
  const busy = saving || !!wait;

  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-').trim() || 'BauPad';
  // „Speichern unter …“: Name genau so; Herunterladen/Teilen: ohne Umlaute (manche Browser verwerfen sonst den Namen)
  const out: ExportFile = { ...file, name: `${clean}.${ext}` };
  const safe: ExportFile = { ...file, name: `${safeFileName(clean) || 'BauPad'}.${ext}` };
  const touch = isTouchDevice();
  const share = touch && canShareFile(safe);
  const saveAs = canSaveAs();
  const done = () => {
    onSaved?.();
    onClose();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  const doSaveAs = () =>
    run(async () => {
      const last = await getMeta<unknown>('lastSaveDir').catch(() => undefined);
      const r = await saveFileAs(out, last);
      if (r.result === 'cancel') return;
      await setMeta('lastSaveDir', r.handle).catch(() => {});
      toast(`„${out.name}“ gespeichert.`, 'success');
      done();
    });
  const doShare = () =>
    run(async () => {
      await shareFile(safe);
      done();
    });
  const doDownload = () => {
    downloadFile(safe);
    toast(`„${safe.name}“ wurde heruntergeladen${isIOS() ? ' (App „Dateien“ → Downloads)' : ' (Ordner „Downloads“)'}.`, 'success', 4500);
    done();
  };

  const what = pdf ? 'das PDF' : 'die Datei';
  const hint = saveAs
    ? '„Speichern unter …“: Ordner und Namen selbst wählen – der Ordner wird für das nächste Mal gemerkt.'
    : isIOS()
      ? '„Teilen / In Dateien sichern“ → „In Dateien sichern“ → Ordner wählen (iCloud Drive oder „Auf meinem iPhone“).'
      : touch
        ? `„Teilen“: z. B. in Google Drive, „Dateien“ oder per E-Mail. „Herunterladen“ legt ${what} im Ordner „Downloads“ ab.`
        : `„Herunterladen“ legt ${what} im Download-Ordner ab. Tipp: In den Browser-Einstellungen „Vor dem Herunterladen fragen“ einschalten, um den Ordner jedes Mal zu wählen.`;

  return (
    <Modal
      title={title}
      onClose={onClose}
      full
      testId={testId}
      footer={
        <div className="preview-footer">
          <div className="preview-fields">
            <label className="field preview-name">
              <span>Dateiname</span>
              <div className="input-unit">
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid={extra ? 'excel-file-name' : pdf ? 'pdf-file-name' : 'excel-file-name'} />
                <span className="unit">.{ext}</span>
              </div>
            </label>
            {extra}
          </div>
          <p className="muted small preview-hint" data-testid="save-hint">
            {hint}
          </p>
          <div className="preview-actions">
            <button type="button" className="btn mr-auto" onClick={onBack} disabled={busy} data-testid="preview-back">
              <Icon name="back" /> Zurück
            </button>
            <button type="button" className={`btn${share || saveAs ? '' : ' btn-primary'}`} onClick={doDownload} disabled={busy} data-testid="preview-download">
              <Icon name="download" /> Herunterladen
            </button>
            {share && (
              <button type="button" className={`btn${saveAs ? '' : ' btn-primary'}`} onClick={() => void doShare()} disabled={busy} data-testid="preview-share">
                <Icon name="share" /> {isIOS() ? 'Teilen / In Dateien sichern' : 'Teilen'}
              </button>
            )}
            {saveAs && (
              <button type="button" className="btn btn-primary" onClick={() => void doSaveAs()} disabled={busy} data-testid="preview-save-as">
                <Icon name="save" /> Speichern unter …
              </button>
            )}
          </div>
        </div>
      }
    >
      {children}
    </Modal>
  );
}
