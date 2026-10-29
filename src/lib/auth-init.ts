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
  });
  const base = `${location.origin}${location.pathname}`;
  setAuthBackend(new SupabaseAuth(client, base));
  setRemoteClient(client);
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
