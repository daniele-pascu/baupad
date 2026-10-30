/**
 * Anmeldedienst Supabase: E-Mail mit Passwort, Google, Apple, Microsoft (Azure), Passwort zurücksetzen,
 * Konto löschen. Die Datenbank legt bei jeder Registrierung automatisch einen Arbeitsbereich an
 * (docs/supabase/schema.sql); diese Datei liest nur den Kontext („my_context“) und übersetzt Fehler.
 *
 * Der Client wird hereingereicht, damit Tests mit einem nachgestellten Client laufen (Supabase ist aus der
 * Testumgebung nicht erreichbar).
 */
import type { AuthBackend, AuthProviderId, PackageId, Role, Session, SignUpResult, ToolId } from './auth';

/** Nur die Teile des Supabase-Clients, die hier gebraucht werden */
export interface AuthClientLike {
  auth: {
    getSession(): Promise<{ data: { session: RawSession | null }; error: { message: string } | null }>;
    signInWithPassword(c: { email: string; password: string }): Promise<AuthResult>;
    signInWithOAuth(c: { provider: 'google' | 'apple' | 'azure'; options?: { redirectTo?: string; scopes?: string } }): Promise<{ error: { message: string } | null }>;
    signUp(c: { email: string; password: string; options?: { data?: Record<string, string>; emailRedirectTo?: string } }): Promise<AuthResult>;
    signOut(): Promise<{ error: { message: string } | null }>;
    resetPasswordForEmail(email: string, o?: { redirectTo?: string }): Promise<{ error: { message: string } | null }>;
    updateUser(a: { email?: string; password?: string; data?: Record<string, string> }): Promise<{ error: { message: string } | null }>;
    linkIdentity(c: { provider: 'google' | 'apple' | 'azure'; options?: { redirectTo?: string; scopes?: string } }): Promise<{ error: { message: string } | null }>;
    onAuthStateChange(cb: (event: string, session: RawSession | null) => void): { data: { subscription: { unsubscribe(): void } } };
  };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export interface RawUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: { provider?: string; providers?: string[] };
  identities?: { provider?: string }[];
}
export interface RawSession {
  user: RawUser;
  /** Zugangs-Token für Dienste, die die Anmeldung prüfen (Supabase-Funktionen) */
  access_token?: string;
}
interface AuthResult {
  data: { user: RawUser | null; session: RawSession | null };
  error: { message: string; status?: number } | null;
}

/** Antwort der Datenbankfunktion my_context() */
interface Context {
  workspace_id: string | null;
  workspace_name: string | null;
  role: Role | null;
  pkg: PackageId | null;
  tools: ToolId[] | null;
  sites: string[] | null;
  tool_sites: Record<string, string[]> | null;
  operator: boolean;
  name: string | null;
  phone: string | null;
}

const PROVIDER_MAP: Record<Exclude<AuthProviderId, 'email'>, 'google' | 'apple' | 'azure'> = { google: 'google', apple: 'apple', microsoft: 'azure' };

/** Übersetzt die englischen Meldungen des Dienstes in verständliche Sätze */
export function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials')) return 'E-Mail-Adresse oder Passwort ist falsch.';
  if (m.includes('email not confirmed')) return 'Bitte zuerst die E-Mail-Adresse bestätigen – der Link steht in der E-Mail, die du beim Registrieren bekommen hast.';
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user_already_exists')) return 'Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte anmelden oder das Passwort zurücksetzen.';
  if (m.includes('password should be') || m.includes('weak_password') || m.includes('password is too short')) return 'Das Passwort braucht mindestens 8 Zeichen.';
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('over_email_send_rate_limit')) return 'Zu viele Versuche – bitte in ein paar Minuten noch einmal.';
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) return 'Keine Verbindung zum Anmeldedienst. Bitte die Internetverbindung prüfen.';
  if (m.includes('signups not allowed') || m.includes('signup_disabled')) return 'Die Registrierung ist derzeit nicht möglich.';
  if (m.includes('same password') || m.includes('same_password')) return 'Das neue Passwort muss sich vom bisherigen unterscheiden.';
  if (m.includes('session') && m.includes('missing')) return 'Nicht angemeldet. Bitte den Link aus der E-Mail erneut öffnen.';
  if (m.includes('email_address_invalid') || m.includes('invalid email')) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  if (m.includes('provider is not enabled') || m.includes('unsupported provider') || m.includes('validation_failed') && m.includes('provider')) return 'Diese Anmeldemethode ist noch nicht freigeschaltet. Bitte mit E-Mail und Passwort anmelden.';
  if (m.includes('manual linking is disabled') || m.includes('manual_linking_disabled')) return 'Das Verbinden weiterer Anmeldemethoden ist beim Dienst noch nicht freigeschaltet.';
  if (m.includes('identity_already_exists') || m.includes('already linked')) return 'Diese Anmeldemethode ist schon mit einem Konto verbunden.';
  if (m.includes('email_exists') || m.includes('email address is already')) return 'Diese E-Mail-Adresse wird schon von einem anderen Konto verwendet.';
  if (m.includes('reauthentication') || m.includes('reauth')) return 'Bitte zuerst abmelden und neu anmelden, dann noch einmal versuchen.';
  return message;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(translateAuthError(message));
    this.name = 'AuthError';
  }
}

export class SupabaseAuth implements AuthBackend {
  readonly connected = true;
  /** Sitzung je Benutzer; partial = Kontext der Datenbank fehlte (offline), wird beim nächsten Aufruf online nachgeholt */
  private cache: { userId: string; session: Session; partial: boolean } | null = null;
  private pending: { userId: string; promise: Promise<Session> } | null = null;
  private listeners = new Set<(s: Session | null) => void>();
  constructor(
    private client: AuthClientLike,
    /** Rücksprungadresse für Anbieter-Anmeldung und E-Mail-Links (Seite ohne Hash) */
    private redirectBase: string,
  ) {}

  async session(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    return data.session ? this.build(data.session) : null;
  }

  async signIn(provider: AuthProviderId, email?: string, password?: string): Promise<Session | void> {
    if (provider === 'email') {
      const { data, error } = await this.client.auth.signInWithPassword({ email: (email ?? '').trim().toLowerCase(), password: password ?? '' });
      if (error) throw new AuthError(error.message);
      if (!data.session) throw new AuthError('Anmeldung fehlgeschlagen.');
      return this.build(data.session);
    }
    const { error } = await this.client.auth.signInWithOAuth({
      provider: PROVIDER_MAP[provider],
      options: { redirectTo: this.redirectBase, ...(provider === 'microsoft' ? { scopes: 'email openid profile' } : {}) },
    });
    if (error) throw new AuthError(error.message);
    // der Browser wechselt jetzt zum Anbieter; nach der Rückkehr liefert session() die Anmeldung
  }

  async signUp(d: { name: string; email: string; password: string; company?: string }): Promise<SignUpResult> {
    const email = d.email.trim().toLowerCase();
    const { data, error } = await this.client.auth.signUp({
      email,
      password: d.password,
      options: { data: { name: d.name.trim(), company: (d.company ?? '').trim() }, emailRedirectTo: this.redirectBase },
    });
    if (error) throw new AuthError(error.message);
    // Bei eingeschalteter E-Mail-Bestätigung liefert der Dienst für schon registrierte Adressen einen
    // Benutzer ohne Identitäten statt eines Fehlers – ehrlich melden, nicht so tun, als wäre registriert.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new AuthError('User already registered');
    if (data.session) return { session: await this.build(data.session) };
    return { session: null, confirmEmail: email };
  }

  async signOut() {
    this.cache = null;
    const { error } = await this.client.auth.signOut();
    if (error) throw new AuthError(error.message);
  }

  async resetPassword(email: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${this.redirectBase}?reset=1` });
    if (error) throw new AuthError(error.message);
  }

  async updatePassword(password: string) {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw new AuthError(error.message);
  }

  async deleteAccount() {
    const { error } = await this.client.rpc('delete_own_account');
    if (error) throw new AuthError(error.message);
    this.cache = null;
    await this.client.auth.signOut();
  }

  async updateProfile(p: { name: string; phone: string }) {
    const { error } = await this.client.rpc('update_my_profile', { p_name: p.name.trim(), p_phone: p.phone.trim() });
    if (error) throw new AuthError(error.message);
    // Name auch in den Benutzerdaten des Dienstes, damit er ohne Datenbankkontext (offline) stimmt
    await this.client.auth.updateUser({ data: { name: p.name.trim() } });
    await this.refresh();
  }

  async updateEmail(email: string) {
    const { error } = await this.client.auth.updateUser({ email: email.trim().toLowerCase() });
    if (error) throw new AuthError(error.message);
  }

  async linkProvider(provider: Exclude<AuthProviderId, 'email'>) {
    const { error } = await this.client.auth.linkIdentity({
      provider: PROVIDER_MAP[provider],
      options: { redirectTo: this.redirectBase, ...(provider === 'microsoft' ? { scopes: 'email openid profile' } : {}) },
    });
    if (error) throw new AuthError(error.message);
  }

  async refresh() {
    this.cache = null;
    const s = await this.session();
    for (const cb of this.listeners) cb(s);
    return s;
  }

  onChange(cb: (s: Session | null) => void) {
    this.listeners.add(cb);
    const { data } = this.client.auth.onAuthStateChange((_event, raw) => {
      if (!raw) {
        this.cache = null;
        cb(null);
        return;
      }
      void this.build(raw).then(cb, () => cb(null));
    });
    return () => {
      this.listeners.delete(cb);
      data.subscription.unsubscribe();
    };
  }

  /**
   * Baut die Session aus Benutzer + Kontext der Datenbank – einmal je Benutzer, gleichzeitige Aufrufe teilen
   * sich eine Anfrage. Offline wird der Dienst gar nicht erst angefragt; der Kontext wird nachgeholt,
   * sobald wieder eine Verbindung besteht.
   */
  private build(raw: RawSession): Promise<Session> {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (this.cache && this.cache.userId === raw.user.id && (!this.cache.partial || !online)) return Promise.resolve(this.cache.session);
    if (this.pending && this.pending.userId === raw.user.id) return this.pending.promise;
    const promise = this.buildNow(raw, online).finally(() => {
      if (this.pending?.promise === promise) this.pending = null;
    });
    this.pending = { userId: raw.user.id, promise };
    return promise;
  }

  private async buildNow(raw: RawSession, online: boolean): Promise<Session> {
    const meta = raw.user.user_metadata ?? {};
    const metaName = String(meta.name ?? meta.full_name ?? '').trim();
    let ctx: Context | null = null;
    if (online) {
      try {
        // offene Einladungen übernehmen (falls die Person vom Admin eingetragen wurde), dann den Kontext lesen
        await this.client.rpc('accept_invitations');
        const { data, error } = await this.client.rpc('my_context');
        if (!error && data && typeof data === 'object') ctx = data as Context;
      } catch {
        /* ohne Kontext (z. B. Verbindung weg) reicht der Benutzer selbst */
      }
    }
    const providers = raw.user.app_metadata?.providers ?? (raw.user.identities ?? []).map((i) => i.provider ?? '').filter(Boolean);
    const session: Session = {
      userId: raw.user.id,
      email: raw.user.email ?? '',
      name: ctx?.name || metaName || (raw.user.email ?? '').split('@')[0],
      role: ctx?.role ?? 'admin',
      companyId: ctx?.workspace_id ?? '',
      companyName: ctx?.workspace_name ?? String(meta.company ?? ''),
      operator: Boolean(ctx?.operator),
      phone: ctx?.phone ?? '',
      pkg: ctx?.pkg ?? null,
      tools: ctx?.tools ?? [],
      sites: ctx?.sites ?? [],
      toolSites: (ctx?.tool_sites ?? {}) as Session['toolSites'],
      providers: providers.length ? providers : raw.user.app_metadata?.provider ? [raw.user.app_metadata.provider] : [],
    };
    this.cache = { userId: raw.user.id, session, partial: ctx === null };
    return session;
  }
}
