/**
 * Anmeldung, Rollen und Tool-Freigaben – Schnittstelle und Grundwerte.
 *
 * Der Anmeldedienst ist Supabase (siehe auth-supabase.ts); diese Datei kennt nur die Schnittstelle, damit
 * Oberfläche und Tests nicht vom Dienst abhängen. Ohne angeschlossenen Dienst meldet jede Anmeldung ehrlich
 * „noch nicht eingerichtet“ – es wird nichts gesendet und nichts vorgetäuscht.
 */

export type AuthProviderId = 'google' | 'apple' | 'microsoft' | 'email';
export const PROVIDERS: { id: AuthProviderId; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'apple', label: 'Apple' },
  { id: 'microsoft', label: 'Microsoft (Outlook)' },
];

export type Role = 'admin' | 'polier' | 'arbeiter' | 'buero';
export const ROLES: { id: Role; label: string; text: string }[] = [
  { id: 'admin', label: 'Admin', text: 'Benutzer und Rechte verwalten, alle Werkzeuge' },
  { id: 'buero', label: 'Büro', text: 'Alle Werkzeuge, Abrechnung und Verwaltung' },
  { id: 'polier', label: 'Polier', text: 'Fotos, Berichte und Formulare, Einteilung lesen' },
  { id: 'arbeiter', label: 'Arbeiter', text: 'Fotos der freigegebenen Baustellen' },
];

export type ToolId = 'projects' | 'workers' | 'reports' | 'photos';
export const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'projects', label: 'Aufmaß & Abrechnung' },
  { id: 'workers', label: 'Arbeitereinteilung' },
  { id: 'reports', label: 'Berichte & Formulare' },
  { id: 'photos', label: 'Fotodokumentation' },
];

/** Standard-Freigaben je Rolle (der Admin kann sie je Benutzer ändern) */
export function defaultToolsForRole(role: Role): ToolId[] {
  switch (role) {
    case 'admin':
    case 'buero':
      return ['projects', 'workers', 'reports', 'photos'];
    case 'polier':
      return ['photos', 'reports'];
    case 'arbeiter':
      return ['photos'];
  }
}

export type PackageId = 'einzel' | 'team' | 'firma';
/** Pakete (vorläufige Bezeichnungen – Preise folgen mit der Anmeldung) */
export const PACKAGES: { id: PackageId; label: string; text: string }[] = [
  { id: 'einzel', label: 'Einzel', text: 'eine Person, ein Arbeitsbereich' },
  { id: 'team', label: 'Team', text: 'mehrere Benutzer, gemeinsame Ablage' },
  { id: 'firma', label: 'Firma', text: 'Rollen, mehr Speicher, mehrere Admins' },
];

/** Benutzer eines Unternehmens, wie ihn der Admin anlegt */
export interface CompanyUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tools: ToolId[];
  pkg: PackageId;
  active: boolean;
  createdAt: number;
  /** aus der Datenbank: Mitglied mit Konto oder eingeladen (noch nicht registriert) */
  status?: 'member' | 'invited';
  /** die angemeldete Person selbst */
  me?: boolean;
}

export interface Session {
  userId: string;
  email: string;
  name: string;
  role: Role;
  /** Arbeitsbereich (Firma); jede Registrierung legt einen an, die Person ist dessen Admin */
  companyId: string;
  companyName: string;
  /** Betreiber (PAD Software) sieht zusätzlich die Betreiber-Übersicht */
  operator: boolean;
}

/** Ergebnis einer Registrierung: entweder sofort angemeldet oder E-Mail-Bestätigung ausstehend */
export type SignUpResult = { session: Session } | { session: null; confirmEmail: string };

/** Anmeldedienst (Supabase) – oder „nicht verbunden“ */
export interface AuthBackend {
  readonly connected: boolean;
  session(): Promise<Session | null>;
  /** Anbieter-Anmeldung leitet zum Anbieter weiter (löst nie mit Session auf); E-Mail liefert die Session */
  signIn(provider: AuthProviderId, email?: string, password?: string): Promise<Session | void>;
  signUp(data: { name: string; email: string; password: string; company?: string }): Promise<SignUpResult>;
  signOut(): Promise<void>;
  /** schickt den Link zum Zurücksetzen des Passworts */
  resetPassword(email: string): Promise<void>;
  /** setzt das Passwort der angemeldeten Person (nach dem Link aus der E-Mail oder in den Einstellungen) */
  updatePassword(password: string): Promise<void>;
  /** löscht das eigene Konto samt Mitgliedschaften (Vorgabe der Stores) */
  deleteAccount(): Promise<void>;
  /** ruft cb bei jeder Änderung (Anmelden, Abmelden, Token erneuert); liefert Abmeldefunktion */
  onChange(cb: (s: Session | null) => void): () => void;
}

export class AuthNotConnected extends Error {
  constructor() {
    super('Die Anmeldung ist noch nicht eingerichtet.');
    this.name = 'AuthNotConnected';
  }
}

export class NotConnectedAuth implements AuthBackend {
  readonly connected = false;
  async session() {
    return null;
  }
  async signIn(): Promise<Session> {
    throw new AuthNotConnected();
  }
  async signUp(): Promise<SignUpResult> {
    throw new AuthNotConnected();
  }
  async signOut() {
    /* nichts angemeldet */
  }
  async resetPassword() {
    throw new AuthNotConnected();
  }
  async updatePassword() {
    throw new AuthNotConnected();
  }
  async deleteAccount() {
    throw new AuthNotConnected();
  }
  onChange() {
    return () => {};
  }
}

let backend: AuthBackend = new NotConnectedAuth();
export const getAuth = () => backend;
export const setAuthBackend = (b: AuthBackend) => {
  backend = b;
};
export const authConnected = () => backend.connected;

/** Merker „ohne Konto weiter“ in der installierten App (sonst fragt sie beim Start nach der Anmeldung) */
const SKIP_KEY = 'authSkipped';
export function authSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return true;
  }
}
export function setAuthSkipped(v: boolean) {
  try {
    if (v) localStorage.setItem(SKIP_KEY, '1');
    else localStorage.removeItem(SKIP_KEY);
  } catch {
    /* optional */
  }
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
