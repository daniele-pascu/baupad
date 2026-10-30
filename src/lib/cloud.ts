import { accessToken } from './remote';
import { SUPABASE_KEY, SUPABASE_URL } from './supabase-config';

/**
 * Zugang zur zentralen Ablage über die Supabase-Funktion „storage“. Die App schickt nur ihre Anmeldung mit;
 * die Funktion prüft den Arbeitsbereich und gibt kurzlebige Links auf die Dateien bei Hetzner aus.
 * Ohne eingerichtete Funktion (404/501) bleibt die App beim lokalen Speicher.
 */

export class CloudError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  /** Ablage nicht eingerichtet (Funktion fehlt oder Secrets fehlen) */
  get notConfigured() {
    return this.status === 404 || this.status === 501;
  }
  get offline() {
    return this.status === 0;
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
const browserFetch: FetchLike = (url, init) => fetch(url, init);

const MESSAGES: Record<string, string> = {
  'not-configured': 'Die zentrale Ablage ist noch nicht eingerichtet.',
  unauthorized: 'Bitte neu anmelden.',
  'no-workspace': 'Dein Konto gehört zu keiner Firma – Fotos bleiben auf diesem Gerät.',
  forbidden: 'Dafür fehlt die Berechtigung.',
};

/** ruft eine Aktion der Funktion „storage“ mit der Anmeldung der Person */
export async function cloudCall<T>(action: string, body: Record<string, unknown> = {}, fetchFn: FetchLike = browserFetch): Promise<T> {
  const token = await accessToken();
  if (!token) throw new CloudError(401, 'unauthorized', MESSAGES.unauthorized);
  let r: Response;
  try {
    r = await fetchFn(`${SUPABASE_URL}/functions/v1/storage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CloudError(0, 'offline', 'Keine Verbindung zur zentralen Ablage (offline, Funktion „storage“ nicht erreichbar oder vom Browser blockiert).');
  }
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const code = String(data.error ?? (r.status === 404 ? 'not-configured' : 'failed'));
    const detail = typeof data.detail === 'string' ? ` (${data.detail})` : '';
    throw new CloudError(r.status, code, (MESSAGES[code] ?? `Ablage antwortet mit Fehler ${r.status}`) + (MESSAGES[code] ? '' : detail));
  }
  return data as T;
}
