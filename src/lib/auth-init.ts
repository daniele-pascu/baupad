/**
 * Verbindet die App mit Supabase. Wird einmal beim Start importiert. Ohne Zugangsdaten (z. B. in einer
 * Testumgebung mit VITE_SUPABASE_URL='') bleibt die Anmeldung „nicht verbunden“.
 */
import { createClient } from '@supabase/supabase-js';
import { setAuthBackend } from './auth';
import { SupabaseAuth } from './auth-supabase';
import { setRemoteClient } from './remote';
import { SUPABASE_KEY, SUPABASE_URL } from './supabase-config';

export function initAuth() {
  if (!SUPABASE_URL || !SUPABASE_KEY || typeof window === 'undefined') return;
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: authSafeFetch },
  });
  const base = `${location.origin}/`;
  setAuthBackend(new SupabaseAuth(client, base, readStoredSession));
  setRemoteClient(client);
  // Offline nicht erneuern (sonst Fehlversuche); nach dem Wiederverbinden kurz warten, bis das Netz steht
  let timer = 0;
  window.addEventListener('offline', () => {
    window.clearTimeout(timer);
    void client.auth.stopAutoRefresh();
  });
  window.addEventListener('online', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void client.auth.startAutoRefresh(), 3000);
  });
}

/**
 * Anfragen an den Anmeldedienst: Offline gar nicht erst senden; kommt beim Erneuern keine echte Antwort des
 * Dienstes zurück (z. B. Anmeldeseite eines WLANs, Netz noch nicht bereit), als Verbindungsfehler melden –
 * Verbindungsfehler lassen die Anmeldung bestehen, nur echte Ablehnungen des Servers melden ab.
 */
async function authSafeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const isToken = url.includes('/auth/v1/token');
  if (isToken && typeof navigator !== 'undefined' && navigator.onLine === false) throw new TypeError('offline');
  const res = await fetch(input, init);
  if (isToken && !res.ok && !(res.headers.get('content-type') ?? '').includes('json')) throw new TypeError(`Netz nicht bereit (${res.status})`);
  return res;
}

/** Gespeicherte Anmeldung lesen (ohne Prüfung) – Grundlage, um offline angemeldet zu bleiben */
function readStoredSession(): { user: { id: string; email?: string }; access_token?: string } | null {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const s = JSON.parse(raw) as { user?: { id?: string }; refresh_token?: string; access_token?: string };
    if (!s?.refresh_token || !s.user?.id) return null;
    return s as { user: { id: string }; access_token?: string };
  } catch {
    return null;
  }
}

/** Gibt es auf diesem Gerät eine gespeicherte Anmeldung? (synchron, für die Startlogik der installierten App) */
export function hasStoredSession(): boolean {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    return Boolean(localStorage.getItem(`sb-${ref}-auth-token`));
  } catch {
    return false;
  }
}
