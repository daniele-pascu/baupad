import { SUPABASE_KEY, SUPABASE_URL } from '../lib/supabase-config';

export interface ContactPayload {
  name: string;
  company: string;
  email: string;
  subject: string;
  message: string;
  lang: 'de' | 'en';
  /** Honigtopf: muss leer bleiben (Bots füllen ihn) */
  website: string;
  /** Zeitpunkt, an dem das Formular geöffnet wurde (zu schnelle Absendungen werden abgelehnt) */
  startedAt: number;
}

export type ContactResult = { ok: true } | { ok: false; reason: 'offline' | 'not-configured' | 'rejected' | 'failed' };

/** Adresse der Supabase-Funktion „contact“ (nimmt die Nachricht entgegen und verschickt sie per E-Mail) */
export const CONTACT_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/contact` : '';

/** Nachricht an die Funktion senden; ein Erfolg wird nur bei Antwort 2xx gemeldet – nie simuliert */
export async function sendContact(p: ContactPayload, fetchFn: typeof fetch = fetch): Promise<ContactResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
  if (!CONTACT_ENDPOINT || !SUPABASE_KEY) return { ok: false, reason: 'not-configured' };
  try {
    const r = await fetchFn(CONTACT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify(p),
    });
    if (r.ok) return { ok: true };
    if (r.status === 404 || r.status === 501) return { ok: false, reason: 'not-configured' };
    if (r.status === 400 || r.status === 422 || r.status === 429) return { ok: false, reason: 'rejected' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Merker für die Danke-Seite: nur nach erfolgreichem Versand erreichbar */
const SENT_KEY = 'ps-contact-sent';
export function markSent() {
  try {
    sessionStorage.setItem(SENT_KEY, String(Date.now()));
  } catch {
    /* ohne Speicher keine Danke-Seite, der Hinweis erscheint dann im Formular */
  }
}
export function consumeSent(): boolean {
  try {
    const v = sessionStorage.getItem(SENT_KEY);
    if (!v) return false;
    sessionStorage.removeItem(SENT_KEY);
    return Date.now() - Number(v) < 10 * 60 * 1000;
  } catch {
    return false;
  }
}
