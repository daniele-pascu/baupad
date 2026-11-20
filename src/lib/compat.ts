/**
 * Ersatz für neuere Browser-Funktionen, damit BauPad auch auf älteren Geräten läuft
 * (z. B. Fernseher-Browser, ältere iPhones/Android): dort gibt es AbortSignal.timeout (Chrome 103, Safari 16)
 * bzw. structuredClone (Chrome 98, Safari 15.4) noch nicht – ohne Ersatz scheiterte jedes Hochladen („Online-Fehler“).
 */

/** Signal, das nach `ms` Millisekunden abbricht */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { timeout?: unknown }).timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** tiefe Kopie (Daten aus der Datenbank: nur einfache Werte, Listen und Objekte) */
export function deepClone<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
