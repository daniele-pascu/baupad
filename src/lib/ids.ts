import { getMeta, setMeta } from './db';

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let deviceId = 'unbekannt';

/** Liest bzw. erzeugt die dauerhafte Gerätekennung (für spätere Synchronisierung). */
export async function initDeviceId(): Promise<string> {
  const stored = await getMeta<string>('deviceId');
  if (stored) {
    deviceId = stored;
  } else {
    deviceId = uuid();
    await setMeta('deviceId', deviceId);
  }
  return deviceId;
}

export function getDeviceId(): string {
  return deviceId;
}
