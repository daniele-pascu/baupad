/**
 * Anmeldung, Rollen und Tool-Freigaben – Schnittstelle und Grundwerte.
 *
 * Die Oberfläche (Anmelden, Registrieren, Benutzerverwaltung) ist fertig; der Anmeldedienst (Supabase mit
 * Google, Apple, Microsoft und E-Mail) wird angebunden, sobald das Projekt dort angelegt ist. Bis dahin meldet
 * jede Anmeldung ehrlich „noch nicht eingerichtet“ – es wird nichts gesendet und nichts vorgetäuscht.
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
}

export interface Session {
  userId: string;
  email: string;
  name: string;
  role: Role;
  companyId: string;
}

/** Anmeldedienst – heute nicht verbunden, später Supabase */
export interface AuthBackend {
  readonly connected: boolean;
  session(): Promise<Session | null>;
  signIn(provider: AuthProviderId, email?: string, password?: string): Promise<Session>;
  signUp(data: { name: string; email: string; password: string; company?: string }): Promise<Session>;
  signOut(): Promise<void>;
}

export class AuthNotConnected extends Error {
  constructor() {
    super('Die Anmeldung ist noch nicht eingerichtet.');
    this.name = 'AuthNotConnected';
  }
}

class NotConnectedAuth implements AuthBackend {
  readonly connected = false;
  async session() {
    return null;
  }
  async signIn(): Promise<Session> {
    throw new AuthNotConnected();
  }
  async signUp(): Promise<Session> {
    throw new AuthNotConnected();
  }
  async signOut() {
    /* nichts angemeldet */
  }
}

let backend: AuthBackend = new NotConnectedAuth();
export const getAuth = () => backend;
export const setAuthBackend = (b: AuthBackend) => {
  backend = b;
};
export const authConnected = () => backend.connected;

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
