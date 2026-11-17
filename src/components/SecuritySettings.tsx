import { useEffect, useState } from 'react';
import { AFTER_CHOICES, bioAvailable, checkPin, disableBio, disableLock, enableBio, lockConfig, lockNow, setLockAfter, setPin, validPin, type LockConfig } from '../lib/app-lock';
import { listOutbox } from '../lib/db';
import { wipeDeviceData } from '../lib/device-wipe';
import { cloudState } from '../lib/photo-cloud';
import { paths } from '../lib/router';
import type { Session } from '../lib/auth';
import { Modal } from './Modal';
import { confirmDialog, showError, toast } from './ui';

/**
 * Konto → Sicherheit (je Gerät): App-Sperre mit PIN und auf Wunsch Face ID/Fingerabdruck, Zeit bis zur Sperre,
 * „Abmelden und Daten löschen“ für verlorene oder weitergegebene Geräte.
 */
export function SecuritySettings({ session }: { session: Session | null | undefined }) {
  const [cfg, setCfg] = useState<LockConfig | null>(lockConfig);
  const [bioCan, setBioCan] = useState(false);
  const [dialog, setDialog] = useState<null | 'set' | 'change' | 'off'>(null);
  const refresh = () => setCfg(lockConfig());
  useEffect(() => {
    void bioAvailable().then(setBioCan);
  }, []);

  const toggleBio = async (on: boolean) => {
    try {
      if (on) await enableBio(session?.email ?? '');
      else disableBio();
      refresh();
      toast(on ? 'Face ID / Fingerabdruck ist eingerichtet.' : 'Face ID / Fingerabdruck ausgeschaltet – nur noch PIN.', 'success');
    } catch (e) {
      showError(e, 'Face ID / Fingerabdruck');
    }
  };

  const wipe = async () => {
    const pending = (await listOutbox().catch(() => [])).length + cloudState().pending;
    const ok = await confirmDialog({
      title: 'Abmelden und Daten löschen?',
      message: (
        <>
          <p>Alle Projekte, Pläne, Fotos und Einstellungen der App werden von diesem Gerät gelöscht; du wirst abgemeldet. Was übertragen ist, bleibt in der Ablage der Firma und kommt nach dem Anmelden wieder.</p>
          {pending > 0 && (
            <p className="banner banner-warn small" data-testid="wipe-pending">
              Noch nicht übertragen: {pending} {pending === 1 ? 'Änderung' : 'Änderungen'} – sie gehen verloren. Besser zuerst mit Empfang abgleichen.
            </p>
          )}
        </>
      ),
      confirmLabel: 'Abmelden und löschen',
      danger: true,
    });
    if (!ok) return;
    await wipeDeviceData({ signOut: true, reason: 'Abgemeldet – die Daten wurden von diesem Gerät gelöscht.' });
    location.replace(paths.login());
  };

  return (
    <div className="appearance-settings security-settings" data-testid="security-settings">
      <div className="appearance-row">
        <strong>App-Sperre</strong>
        <span className="muted small">Beim Öffnen und nach der gewählten Zeit im Hintergrund fragt BauPad nach einer PIN – auf Wunsch mit Face ID bzw. Fingerabdruck. Nach 10 falschen PINs löscht die App ihre Daten auf diesem Gerät.</span>
        {cfg ? (
          <div className="row gap wrap security-actions">
            <button type="button" className="btn btn-sm" onClick={() => setDialog('change')} data-testid="lock-change">
              PIN ändern
            </button>
            <button type="button" className="btn btn-sm" onClick={lockNow} data-testid="lock-now">
              Jetzt sperren
            </button>
            <button type="button" className="btn btn-sm btn-danger-text" onClick={() => setDialog('off')} data-testid="lock-off">
              Ausschalten
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog('set')} data-testid="lock-setup">
            App-Sperre einrichten
          </button>
        )}
      </div>
      {cfg && (
        <div className="appearance-row">
          <strong>Sperren nach</strong>
          <span className="muted small">So lange darf BauPad im Hintergrund sein, bevor die PIN wieder gefragt wird. Beim Öffnen der App immer.</span>
          <div className="segmented" role="radiogroup" aria-label="Sperren nach">
            {AFTER_CHOICES.map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={cfg.after === m}
                aria-selected={cfg.after === m}
                onClick={() => {
                  setLockAfter(m);
                  refresh();
                }}
                data-testid={`lock-after-${m}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {cfg && bioCan && (
        <div className="appearance-row">
          <strong>Face ID / Fingerabdruck</strong>
          <span className="muted small">Statt der PIN entsperren – die PIN bleibt als Ersatz.</span>
          <div className="segmented" role="radiogroup" aria-label="Face ID / Fingerabdruck">
            <button type="button" role="radio" aria-checked={!!cfg.bio} aria-selected={!!cfg.bio} onClick={() => void toggleBio(true)} data-testid="lock-bio-on">
              An
            </button>
            <button type="button" role="radio" aria-checked={!cfg.bio} aria-selected={!cfg.bio} onClick={() => void toggleBio(false)} data-testid="lock-bio-off">
              Aus
            </button>
          </div>
        </div>
      )}
      <div className="appearance-row">
        <strong>Daten auf diesem Gerät</strong>
        <span className="muted small">BauPad hält Projekte, Pläne und Fotos auch ohne Empfang auf dem Gerät. Bei einem verlorenen oder weitergegebenen Gerät: abmelden und alles löschen. Wird dein Zugang zur Firma beendet, löscht die App die Daten der Firma von selbst, sobald das Gerät online ist.</span>
        <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => void wipe()} data-testid="wipe-device">
          Abmelden und Daten löschen
        </button>
      </div>
      <p className="muted small">Gilt für dieses Gerät. Zusätzlich die Bildschirmsperre des Geräts (Code, Face ID) verwenden.</p>
      {dialog && (
        <PinDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            refresh();
            toast(text, 'success');
          }}
        />
      )}
    </div>
  );
}

/** PIN festlegen, ändern oder die Sperre ausschalten (dann mit der aktuellen PIN) */
function PinDialog({ mode, onClose, onDone }: { mode: 'set' | 'change' | 'off'; onClose(): void; onDone(text: string): void }) {
  const [current, setCurrent] = useState('');
  const [pin, setPinValue] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = mode === 'set' ? 'App-Sperre einrichten' : mode === 'change' ? 'PIN ändern' : 'App-Sperre ausschalten';
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);

  const save = async () => {
    setError(null);
    if (mode !== 'set' && !(await checkPin(current))) return setError('Die aktuelle PIN stimmt nicht.');
    if (mode === 'off') {
      disableLock();
      return onDone('App-Sperre ist ausgeschaltet.');
    }
    if (!validPin(pin)) return setError('Die PIN muss 4 bis 8 Ziffern haben.');
    if (pin !== again) return setError('Die beiden PINs sind nicht gleich.');
    setBusy(true);
    try {
      await setPin(pin);
      onDone(mode === 'set' ? 'App-Sperre ist eingerichtet.' : 'PIN geändert.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = (label: string, value: string, set: (v: string) => void, testId: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={8} value={value} onChange={(e) => set(digits(e.target.value))} data-testid={testId} />
    </label>
  );

  return (
    <Modal
      title={title}
      onClose={onClose}
      testId="pin-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className={`btn ${mode === 'off' ? 'btn-danger' : 'btn-primary'}`} onClick={() => void save()} disabled={busy} data-testid="pin-save">
            {mode === 'off' ? 'Ausschalten' : 'Speichern'}
          </button>
        </>
      }
    >
      <form
        className="pin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {mode !== 'set' && input('Aktuelle PIN', current, setCurrent, 'pin-current')}
        {mode !== 'off' && (
          <>
            {input('Neue PIN (4 bis 8 Ziffern)', pin, setPinValue, 'pin-new')}
            {input('Neue PIN wiederholen', again, setAgain, 'pin-again')}
          </>
        )}
        {mode === 'set' && <p className="muted small">Die PIN gilt nur für dieses Gerät und wird nicht übertragen. Vergessen? Dann abmelden und neu anmelden – die Daten auf dem Gerät werden dabei gelöscht.</p>}
        {error && (
          <p className="small error-text" role="alert" data-testid="pin-error">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
