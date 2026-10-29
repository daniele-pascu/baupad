import { getMeta, setMeta } from './db';
import { uuid } from './ids';
import type { CompanyUser, Session } from './auth';
import { defaultToolsForRole, isEmail } from './auth';
import { rpc } from './remote';

const KEY = 'companyUsers';

/**
 * Benutzerliste des Unternehmens. Angemeldeter Admin: in der Datenbank (Mitglieder und Einladungen des
 * Arbeitsbereichs). Ohne Anmeldung: auf diesem Gerät gespeichert (Vormerkliste, später übernehmbar).
 */
export const usesRemote = (s: Session | null | undefined) => Boolean(s && s.companyId && s.role === 'admin');

interface RemoteRow {
  id: string;
  email: string;
  name: string;
  role: CompanyUser['role'];
  tools: CompanyUser['tools'];
  pkg: CompanyUser['pkg'];
  active: boolean;
  sites: string[] | null;
  status: 'member' | 'invited';
  me: boolean;
  created_at: number;
}
const fromRow = (r: RemoteRow): CompanyUser => ({ id: r.id, email: r.email, name: r.name, role: r.role, tools: r.tools, pkg: r.pkg, active: r.active, sites: r.sites ?? [], createdAt: r.created_at, status: r.status, me: r.me });

export async function listCompanyUsers(session?: Session | null): Promise<CompanyUser[]> {
  if (usesRemote(session)) {
    const rows = (await rpc<RemoteRow[]>('list_workspace_users')) ?? [];
    return rows.map(fromRow).sort((a, b) => a.name.localeCompare(b.name, 'de') || a.email.localeCompare(b.email));
  }
  return listLocalUsers();
}

export async function listLocalUsers(): Promise<CompanyUser[]> {
  return ((await getMeta<CompanyUser[]>(KEY)) ?? []).map((u) => ({ ...u, sites: u.sites ?? [] })).sort((a, b) => a.name.localeCompare(b.name, 'de') || a.email.localeCompare(b.email));
}

export async function saveCompanyUser(u: Omit<CompanyUser, 'id' | 'createdAt'> & { id?: string }, session?: Session | null): Promise<CompanyUser> {
  if (usesRemote(session)) {
    const email = u.email.trim().toLowerCase();
    if (!isEmail(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
    if (!u.name.trim()) throw new Error('Bitte den Namen eingeben.');
    const r = await rpc<{ status: 'member' | 'invited'; id: string }>('upsert_workspace_user', {
      p_email: email,
      p_name: u.name.trim(),
      p_role: u.role,
      p_tools: u.tools.length ? u.tools : defaultToolsForRole(u.role),
      p_pkg: u.pkg,
      p_active: u.active,
      p_sites: u.sites ?? [],
    });
    return { ...u, id: r.id, email, name: u.name.trim(), createdAt: Date.now(), status: r.status };
  }
  return saveLocalUser(u);
}

/** Vormerkliste vom Gerät in den Arbeitsbereich übernehmen (einmalig nach der ersten Anmeldung des Admins) */
export async function migrateLocalUsers(session: Session): Promise<number> {
  const local = await listLocalUsers();
  let n = 0;
  for (const u of local) {
    await saveCompanyUser(u, session);
    n++;
  }
  await setMeta(KEY, []);
  return n;
}

async function saveLocalUser(u: Omit<CompanyUser, 'id' | 'createdAt'> & { id?: string }): Promise<CompanyUser> {
  const email = u.email.trim().toLowerCase();
  if (!isEmail(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
  if (!u.name.trim()) throw new Error('Bitte den Namen eingeben.');
  const list = (await getMeta<CompanyUser[]>(KEY)) ?? [];
  if (list.some((x) => x.email === email && x.id !== u.id)) throw new Error('Diese E-Mail-Adresse ist schon eingetragen.');
  const existing = list.find((x) => x.id === u.id);
  const next: CompanyUser = {
    id: existing?.id ?? uuid(),
    createdAt: existing?.createdAt ?? Date.now(),
    email,
    name: u.name.trim(),
    role: u.role,
    tools: u.tools.length ? u.tools : defaultToolsForRole(u.role),
    pkg: u.pkg,
    active: u.active,
    sites: u.sites ?? [],
  };
  await setMeta(KEY, [...list.filter((x) => x.id !== next.id), next]);
  return next;
}

export async function removeCompanyUser(u: Pick<CompanyUser, 'id' | 'email'>, session?: Session | null): Promise<void> {
  if (usesRemote(session)) {
    await rpc('remove_workspace_user', { p_email: u.email });
    return;
  }
  const list = (await getMeta<CompanyUser[]>(KEY)) ?? [];
  await setMeta(KEY, list.filter((x) => x.id !== u.id));
}

/** Firmenname des Arbeitsbereichs (nur Admin) */
export async function renameWorkspace(name: string): Promise<void> {
  await rpc('rename_my_workspace', { p_name: name });
}
