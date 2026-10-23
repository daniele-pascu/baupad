import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ExportFile } from '../lib/aufmass';
import { canShareFile, downloadFile, isTouchDevice, shareFile } from '../lib/download';
import { Icon } from './Icon';
import { Modal } from './Modal';

/**
 * Globale Dialoge (Sicherheitsabfragen, Texteingabe, Datei bereit) und Hinweise (Toasts).
 */

type DialogSpec =
  | {
      kind: 'confirm';
      title: string;
      message: ReactNode;
      confirmLabel: string;
      danger?: boolean;
      resolve: (v: boolean) => void;
    }
  | {
      kind: 'prompt';
      title: string;
      label: string;
      value: string;
      confirmLabel: string;
      resolve: (v: string | null) => void;
    }
  | { kind: 'file'; file: ExportFile; resolve: () => void };

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
}

let dialogs: DialogSpec[] = [];
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let snapshot = { dialogs, toasts };
const sub = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function update() {
  snapshot = { dialogs, toasts };
  emit();
}

function pushDialog(d: DialogSpec) {
  dialogs = [...dialogs, d];
  update();
}
function popDialog(d: DialogSpec) {
  dialogs = dialogs.filter((x) => x !== d);
  update();
}

export function confirmDialog(opts: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) =>
    pushDialog({ kind: 'confirm', confirmLabel: opts.confirmLabel ?? 'OK', ...opts, resolve }),
  );
}

export function promptDialog(opts: { title: string; label: string; value?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) =>
    pushDialog({ kind: 'prompt', value: '', confirmLabel: 'Speichern', ...opts, resolve }),
  );
}

let toastId = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const t = { id: ++toastId, message, kind };
  // höchstens 3 Hinweise gleichzeitig – ältere werden ersetzt
  toasts = [...toasts.slice(-2), t];
  update();
  setTimeout(() => {
    toasts = toasts.filter((x) => x !== t);
    update();
  }, ms);
}

export function showError(e: unknown, prefix = '') {
  console.error(e);
  const msg = (e as Error)?.message ?? String(e);
  toast(prefix ? `${prefix}: ${msg}` : msg, 'error', 7000);
}

/**
 * Stellt eine erzeugte Datei bereit. Am PC wird direkt heruntergeladen; auf iPhone/iPad
 * erscheint ein Dialog zum Teilen bzw. Sichern in „Dateien“ (benötigt eine neue
 * Benutzeraktion, daher nicht automatisch).
 */
export function offerFile(file: ExportFile): Promise<void> {
  if (!isTouchDevice()) {
    downloadFile(file);
    toast(`„${file.name}“ wurde heruntergeladen.`, 'success');
    return Promise.resolve();
  }
  return new Promise((resolve) => pushDialog({ kind: 'file', file, resolve }));
}

export function DialogHost() {
  const { dialogs: ds, toasts: ts } = useSyncExternalStore(sub, () => snapshot);
  return (
    <>
      {ds.map((d, i) => (
        <DialogView key={i} d={d} />
      ))}
      <div className="toasts" role="status" aria-live="polite">
        {ts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}

function DialogView({ d }: { d: DialogSpec }) {
  const [value, setValue] = useState(d.kind === 'prompt' ? d.value : '');
  if (d.kind === 'confirm') {
    const close = (v: boolean) => {
      popDialog(d);
      d.resolve(v);
    };
    return (
      <Modal
        title={d.title}
        onClose={() => close(false)}
        testId="confirm-dialog"
        footer={
          <>
            <button type="button" className="btn" onClick={() => close(false)}>
              Abbrechen
            </button>
            <button type="button" className={`btn ${d.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} data-autofocus>
              {d.confirmLabel}
            </button>
          </>
        }
      >
        <div className="confirm-message">{d.message}</div>
      </Modal>
    );
  }
  if (d.kind === 'prompt') {
    const close = (v: string | null) => {
      popDialog(d);
      d.resolve(v);
    };
    const ok = value.trim().length > 0;
    return (
      <Modal
        title={d.title}
        onClose={() => close(null)}
        testId="prompt-dialog"
        footer={
          <>
            <button type="button" className="btn" onClick={() => close(null)}>
              Abbrechen
            </button>
            <button type="submit" form="prompt-form" className="btn btn-primary" disabled={!ok}>
              {d.confirmLabel}
            </button>
          </>
        }
      >
        <form
          id="prompt-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) close(value.trim());
          }}
        >
          <label className="field">
            <span>{d.label}</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} data-autofocus enterKeyHint="done" />
          </label>
        </form>
      </Modal>
    );
  }
  const close = () => {
    popDialog(d);
    d.resolve();
  };
  const share = canShareFile(d.file);
  return (
    <Modal title="Datei bereit" onClose={close} testId="file-dialog">
      <p className="file-ready">
        <Icon name="file" /> <strong>{d.file.name}</strong>
        <br />
        <span className="muted">{(d.file.data.byteLength / 1024).toFixed(0)} KB</span>
      </p>
      <div className="stack">
        {share && (
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => {
              shareFile(d.file).then(close, (e) => showError(e, 'Teilen fehlgeschlagen'));
            }}
          >
            <Icon name="share" /> Teilen / In „Dateien“ sichern
          </button>
        )}
        <button
          type="button"
          className={`btn btn-lg ${share ? '' : 'btn-primary'}`}
          onClick={() => {
            downloadFile(d.file);
            close();
          }}
        >
          <Icon name="download" /> Herunterladen
        </button>
      </div>
    </Modal>
  );
}
