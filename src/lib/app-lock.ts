import { useSyncExternalStore } from 'react';

/**
 * App-Sperre (je Gerät, freiwillig): Beim Öffnen der App und nach einer einstellbaren Zeit im Hintergrund muss die
 * PIN eingegeben werden – auf Wunsch auch Face ID bzw. Fingerabdruck (WebAuthn, nur wo das Gerät es anbietet).
 * Gespeichert wird nur ein Prüfwert der PIN (PBKDF2), nie die PIN selbst, und nur auf diesem Gerät (localStorage).
 * Nach 5 falschen PINs wird gewartet (30 s, dann immer doppelt so lang), nach 10 löscht die App ihre Daten auf dem
 * Gerät und meldet ab (device-wipe.ts). Die Sperre schützt die Bedienung; die Daten selbst liegen weiter im Speicher
 * des Browsers – darum zusätzlich die Gerätesperre (Code/Face ID) des Handys verwenden.
 */
export interface LockConfig {
  v: 1;
  salt: string;
  hash: string;
  iter: number;
  /** sperren nach so vielen Minuten im Hintergrund (0 = sofort) */
  after: number;
  /** Kennung der Face-ID-/Fingerabdruck-Anmeldung (WebAuthn) */
  bio?: string | null;
}
const KEY = 'baupad.appLock';
const FAILS = 'baupad.appLockFails';
/** sessionStorage: in diesem Tab entsperrt (nach dem Schließen der App wieder gesperrt) */
const UNLOCKED = 'baupad.unlocked';
const HIDDEN = 'baupad.hiddenAt';
const ITER = 150_000;
export const AFTER_CHOICES: [number, string][] = [
  [0, 'Sofort'],
  [1, '1 Min.'],
  [5, '5 Min.'],
  [15, '15 Min.'],
];
export const MAX_FAILS = 10;
export const WAIT_FROM = 5;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* kein Speicher */
    }
  },
};
const session = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      /* kein Speicher */
    }
  },
};

export function lockConfig(): LockConfig | null {
  try {
    const c = JSON.parse(store.get(KEY) ?? 'null') as LockConfig | null;
    return c && c.v === 1 && c.hash && c.salt ? c : null;
  } catch {
    return null;
  }
}
const saveConfig = (c: LockConfig | null) => {
  store.set(KEY, c ? JSON.stringify(c) : null);
  emit();
};

export const validPin = (pin: string) => /^\d{4,8}$/.test(pin);

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, base, 256);
  return b64(new Uint8Array(bits));
}
/** gleich lange Zeichenketten ohne frühen Abbruch vergleichen */
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

/** PIN festlegen bzw. ändern (Zeit und Face ID bleiben) */
export async function setPin(pin: string, after?: number): Promise<void> {
  if (!validPin(pin)) throw new Error('Die PIN muss 4 bis 8 Ziffern haben.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const old = lockConfig();
  saveConfig({ v: 1, salt: b64(salt), hash: await derive(pin, salt, ITER), iter: ITER, after: after ?? old?.after ?? 1, bio: old?.bio ?? null });
  resetFails();
  markUnlocked();
}
export async function checkPin(pin: string): Promise<boolean> {
  const c = lockConfig();
  if (!c) return true;
  if (!validPin(pin)) return false;
  return same(await derive(pin, unb64(c.salt), c.iter), c.hash);
}
export function setLockAfter(minutes: number) {
  const c = lockConfig();
  if (c) saveConfig({ ...c, after: minutes });
}
export function disableLock() {
  saveConfig(null);
  resetFails();
  locked = false;
  emit();
}

// ---- Fehlversuche -------------------------------------------------------------------------------------------
export interface Fails {
  count: number;
  /** gesperrt bis (ms) */
  until: number;
}
export function fails(): Fails {
  try {
    const f = JSON.parse(store.get(FAILS) ?? 'null') as Fails | null;
    return f && typeof f.count === 'number' ? f : { count: 0, until: 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}
export const resetFails = () => store.set(FAILS, null);
/** falsche PIN merken; wipe = Grenze erreicht (Daten löschen), wait = so lange warten (ms) */
export function registerFail(now = Date.now()): { count: number; wait: number; wipe: boolean } {
  const count = fails().count + 1;
  const wait = count >= WAIT_FROM ? 30_000 * 2 ** (count - WAIT_FROM) : 0;
  store.set(FAILS, JSON.stringify({ count, until: now + wait }));
  return { count, wait, wipe: count >= MAX_FAILS };
}

// ---- Face ID / Fingerabdruck (WebAuthn, nur Prüfung auf dem Gerät) -------------------------------------------
export async function bioAvailable(): Promise<boolean> {
  try {
    const P = (globalThis as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
    return !!P?.isUserVerifyingPlatformAuthenticatorAvailable && (await P.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}
/** Face ID / Fingerabdruck für die Sperre einrichten */
export async function enableBio(userName: string): Promise<void> {
  const c = lockConfig();
  if (!c) throw new Error('Zuerst eine PIN festlegen.');
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'BauPad' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: userName || 'BauPad', displayName: userName || 'BauPad' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Face ID bzw. Fingerabdruck wurde nicht eingerichtet.');
  saveConfig({ ...c, bio: b64(new Uint8Array(cred.rawId)) });
}
export function disableBio() {
  const c = lockConfig();
  if (c) saveConfig({ ...c, bio: null });
}
/** mit Face ID / Fingerabdruck entsperren; true = erkannt (Gerät hat die Person geprüft) */
export async function unlockWithBio(): Promise<boolean> {
  const c = lockConfig();
  if (!c?.bio) return false;
  const res = (await navigator.credentials.get({
    publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64(c.bio) as BufferSource }], userVerification: 'required', timeout: 60_000 },
  })) as PublicKeyCredential | null;
  const data = res?.response && 'authenticatorData' in res.response ? new Uint8Array((res.response as AuthenticatorAssertionResponse).authenticatorData) : null;
  // Kennzeichen „UV“ (Person geprüft): Bit 2 im Byte 32
  const ok = !!data && data.length > 32 && (data[32] & 0x04) !== 0;
  if (ok) unlock();
  return ok;
}

// ---- Zustand gesperrt/entsperrt ------------------------------------------------------------------------------
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function markUnlocked() {
  session.set(UNLOCKED, '1');
  session.set(HIDDEN, null);
}
/** beim Start: gesperrt, außer in diesem Tab schon entsperrt und nicht zu lange im Hintergrund */
export function lockedOnStart(now = Date.now()): boolean {
  const c = lockConfig();
  if (!c) return false;
  if (session.get(UNLOCKED) !== '1' || c.after === 0) return true;
  const hidden = Number(session.get(HIDDEN) ?? 0);
  return !!hidden && now - hidden >= c.after * 60_000;
}
let locked = lockedOnStart();
export const isLocked = () => locked && !!lockConfig();
export function lockNow() {
  if (!lockConfig()) return;
  locked = true;
  session.set(UNLOCKED, null);
  emit();
}
export function unlock() {
  locked = false;
  resetFails();
  markUnlocked();
  emit();
}
export function useAppLocked(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isLocked,
    () => false,
  );
}
/** Sperre beim Wechsel in den Hintergrund: „sofort“ sperrt gleich (auch das Vorschaubild der App-Übersicht) */
export function watchAppLock(): () => void {
  const onVis = () => {
    const c = lockConfig();
    if (!c) return;
    if (document.visibilityState === 'hidden') {
      session.set(HIDDEN, String(Date.now()));
      if (c.after === 0) lockNow();
    } else {
      const hidden = Number(session.get(HIDDEN) ?? 0);
      if (hidden && Date.now() - hidden >= c.after * 60_000) lockNow();
      session.set(HIDDEN, null);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}
