import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { bioAvailable, checkPin, fails, lockConfig, MAX_FAILS, registerFail, unlock, unlockWithBio, WAIT_FROM } from '../lib/app-lock';
import { wipeDeviceData } from '../lib/device-wipe';
import { paths } from '../lib/router';

/**
 * Sperrbildschirm der App-Sperre (lib/app-lock.ts): liegt über der App (die Seite bleibt darunter erhalten, z. B. eine
 * offene Zeichnung), die App darunter ist nicht bedienbar (inert). PIN, auf Wunsch Face ID/Fingerabdruck,
 * „PIN vergessen?“ = abmelden und Daten des Geräts löschen.
 */
export function AppLockScreen({ name }: { name: string }) {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [forgot, setForgot] = useState(false);
  const [bio, setBio] = useState(false);
  const f = fails();
  const wait = Math.max(0, f.until - now);

  // App darunter sperren (keine Bedienung, kein Vorlesen)
  useEffect(() => {
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => root?.removeAttribute('inert');
  }, []);
  useEffect(() => {
    if (lockConfig()?.bio) void bioAvailable().then(setBio);
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const wipe = async (reason: string) => {
    await wipeDeviceData({ signOut: true, reason });
    location.replace(paths.login());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || wait > 0 || !pin) return;
    setBusy(true);
    try {
      if (await checkPin(pin)) {
        unlock();
        return;
      }
      const r = registerFail();
      setPin('');
      setNow(Date.now());
      if (r.wipe) {
        await wipe('Zu viele falsche PINs – die Daten wurden von diesem Gerät gelöscht. Bitte neu anmelden.');
        return;
      }
      const left = MAX_FAILS - r.count;
      setMsg(r.count >= WAIT_FROM - 2 ? `Falsche PIN. Noch ${left} ${left === 1 ? 'Versuch' : 'Versuche'}, dann werden die Daten auf diesem Gerät gelöscht.` : 'Falsche PIN.');
    } finally {
      setBusy(false);
    }
  };

  const tryBio = async () => {
    setMsg(null);
    try {
      if (!(await unlockWithBio())) setMsg('Nicht erkannt – bitte die PIN eingeben.');
    } catch {
      setMsg('Face ID bzw. Fingerabdruck abgebrochen – bitte die PIN eingeben.');
    }
  };

  return createPortal(
    <div className="app-lock" role="dialog" aria-modal="true" aria-labelledby="app-lock-title" data-testid="app-lock">
      <div className="app-lock-card">
        <img src="/icons/logo-header.png" alt="BauPad" height={30} className="app-lock-logo" />
        <h1 id="app-lock-title" className="app-lock-title">
          BauPad ist gesperrt
        </h1>
        {name && <p className="muted small">{name}</p>}
        {!forgot ? (
          <>
            <form className="app-lock-form" onSubmit={(e) => void submit(e)}>
              <label className="field">
                <span>PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  disabled={wait > 0}
                  data-autofocus
                  autoFocus
                  aria-describedby="app-lock-msg"
                  data-testid="lock-pin"
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy || wait > 0 || pin.length < 4} data-testid="lock-unlock">
                Entsperren
              </button>
            </form>
            <p id="app-lock-msg" className={`small app-lock-msg${msg || wait ? ' error' : ''}`} role="status" aria-live="polite" data-testid="lock-msg">
              {wait > 0 ? `Zu viele falsche PINs – bitte ${Math.ceil(wait / 1000)} s warten.` : (msg ?? '')}
            </p>
            {bio && (
              <button type="button" className="btn" onClick={() => void tryBio()} data-testid="lock-bio">
                Mit Face ID / Fingerabdruck entsperren
              </button>
            )}
            <button type="button" className="btn btn-sm app-lock-link" onClick={() => setForgot(true)} data-testid="lock-forgot">
              PIN vergessen?
            </button>
          </>
        ) : (
          <div className="app-lock-forgot" data-testid="lock-forgot-confirm">
            <p className="small">Ohne PIN geht es nur so: abmelden und alle Daten der App auf diesem Gerät löschen. Danach mit E-Mail und Passwort neu anmelden – Übertragenes kommt aus der Ablage wieder. Noch nicht übertragene Änderungen gehen verloren.</p>
            <div className="row gap wrap app-lock-actions">
              <button type="button" className="btn" onClick={() => setForgot(false)} data-testid="lock-forgot-cancel">
                Zurück
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void wipe('Abgemeldet – die Daten wurden von diesem Gerät gelöscht.')} data-testid="lock-forgot-wipe">
                Abmelden und löschen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
