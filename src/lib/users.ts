import { getMeta, setMeta } from './db';
import { uuid } from './ids';
import type { CompanyUser } from './auth';
import { defaultToolsForRole, isEmail } from './auth';

const KEY = 'companyUsers';

/** Benutzerliste des Unternehmens – bis zur Anbindung der Anmeldung auf diesem Gerät gespeichert */
export async function listCompanyUsers(): Promise<CompanyUser[]> {
  return ((await getMeta<CompanyUser[]>(KEY)) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'de') || a.email.localeCompare(b.email));
}

export async function saveCompanyUser(u: Omit<CompanyUser, 'id' | 'createdAt'> & { id?: string }): Promise<CompanyUser> {
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
  };
  await setMeta(KEY, [...list.filter((x) => x.id !== next.id), next]);
  return next;
}

export async function removeCompanyUser(id: string): Promise<void> {
  const list = (await getMeta<CompanyUser[]>(KEY)) ?? [];
  await setMeta(KEY, list.filter((x) => x.id !== id));
}
