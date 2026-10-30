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

export type ToolId = 'projects' | 'workers' | 'reports' | 'photos' | 'defects';
/** je Werkzeug: Projekt-Schlüssel (p:<Projekt>), auf die der Benutzer zugreifen darf; fehlt/leer = alle Projekte */
export type ToolSites = Partial<Record<ToolId, string[]>>;
export const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'projects', label: 'Aufmaß & Abrechnung' },
  { id: 'workers', label: 'Arbeitereinteilung' },
  { id: 'reports', label: 'Berichte & Formulare' },
  { id: 'photos', label: 'Fotodokumentation' },
  { id: 'defects', label: 'Mängelplan' },
];

/** Standard-Freigaben je Rolle (der Admin kann sie je Benutzer ändern) */
export function defaultToolsForRole(role: Role): ToolId[] {
  switch (role) {
    case 'admin':
    case 'buero':
      return ['projects', 'workers', 'reports', 'photos', 'defects'];
    case 'polier':
      return ['photos', 'reports', 'defects'];
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
  /** ältere Einstellung: Baustellen für alle Werkzeuge gemeinsam (p:<Projekt> bzw. n:<Name>); leer = alle */
  sites: string[];
  /** Projekte je Werkzeug (Admin legt sie fest); fehlt/leer = alle Projekte des Werkzeugs */
  toolSites: ToolSites;
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
  phone: string;
  /** Paket laut Mitgliedschaft (null ohne Arbeitsbereich) */
  pkg: PackageId | null;
  /** freigegebene Werkzeuge und Baustellen (leer = alle); Admin hat immer alles */
  tools: ToolId[];
  sites: string[];
  /** Projekte je Werkzeug (leer = alle) */
  toolSites: ToolSites;
  /** verbundene Anmeldemethoden (email, google, apple, azure) */
  providers: string[];
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
  /** Name und Telefon im Profil */
  updateProfile(p: { name: string; phone: string }): Promise<void>;
  /** neue E-Mail-Adresse; der Dienst schickt Bestätigungslinks, die Änderung gilt nach dem Klick */
  updateEmail(email: string): Promise<void>;
  /** weitere Anmeldemethode verbinden (leitet zum Anbieter weiter) */
  linkProvider(provider: Exclude<AuthProviderId, 'email'>): Promise<void>;
  /** Sitzung neu aus dem Dienst lesen (nach Profiländerungen) und Beobachter benachrichtigen */
  refresh(): Promise<Session | null>;
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
  async updateProfile() {
    throw new AuthNotConnected();
  }
  async updateEmail() {
    throw new AuthNotConnected();
  }
  async linkProvider() {
    throw new AuthNotConnected();
  }
  async refresh() {
    return null;
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

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
