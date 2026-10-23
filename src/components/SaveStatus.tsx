import { flush, reloadProject, useAppState } from '../lib/store';
import { Icon } from './Icon';

const LABELS = {
  saved: 'Gespeichert',
  pending: 'Änderungen werden gespeichert …',
  saving: 'Änderungen werden gespeichert …',
  error: 'Speichern fehlgeschlagen',
  conflict: 'Konflikt – nicht gespeichert',
} as const;

/** Sichtbarer Speicherstatus mit der Möglichkeit, sofort zu speichern. */
export function SaveStatus({ compact }: { compact?: boolean }) {
  const save = useAppState((s) => s.save);
  const label = LABELS[save.status];
  return (
    <div className={`save-status save-${save.status}`} data-testid="save-status" data-status={save.status} title={save.error ?? label}>
      <span className="save-dot" aria-hidden="true" />
      {!compact && <span className="save-label">{label}</span>}
      {compact && <span className="sr-only">{label}</span>}
      {save.status === 'error' && (
        <button type="button" className="btn btn-sm" onClick={() => void flush()}>
          Erneut versuchen
        </button>
      )}
      {save.status === 'conflict' && (
        <button type="button" className="btn btn-sm" onClick={() => void reloadProject()}>
          <Icon name="undoView" size={16} /> Neu laden
        </button>
      )}
    </div>
  );
}

export function SaveErrorBanner() {
  const save = useAppState((s) => s.save);
  if (save.status !== 'error' && save.status !== 'conflict') return null;
  return (
    <div className="banner banner-error" role="alert">
      {save.error}
    </div>
  );
}
