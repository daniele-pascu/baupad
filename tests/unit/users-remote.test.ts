import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/lib/auth';
import { setRemoteClient } from '../../src/lib/remote';
import { listCompanyUsers, removeCompanyUser, saveCompanyUser, usesRemote } from '../../src/lib/users';

const admin: Session = { userId: 'u1', email: 'chef@muster.at', name: 'Chef', role: 'admin', companyId: 'w1', companyName: 'Muster Bau', operator: false, phone: '', pkg: 'firma', providers: ['email'] };

function withRpc(rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>) {
  setRemoteClient({ auth: {} as never, rpc });
}

describe('Benutzerverwaltung in der Datenbank', () => {
  it('nur ein angemeldeter Admin mit Arbeitsbereich nutzt die Datenbank', () => {
    expect(usesRemote(admin)).toBe(true);
    expect(usesRemote({ ...admin, role: 'polier' })).toBe(false);
    expect(usesRemote({ ...admin, companyId: '' })).toBe(false);
    expect(usesRemote(null)).toBe(false);
  });

  it('liest Mitglieder und Einladungen und sortiert nach Name', async () => {
    withRpc(async (fn) => ({
      data:
        fn === 'list_workspace_users'
          ? [
              { id: 'inv:polier@muster.at', email: 'polier@muster.at', name: 'Max Muster', role: 'polier', tools: ['photos', 'reports'], pkg: 'team', active: true, status: 'invited', me: false, created_at: 2 },
              { id: 'u1', email: 'chef@muster.at', name: 'Chef', role: 'admin', tools: ['projects', 'workers', 'reports', 'photos'], pkg: 'firma', active: true, status: 'member', me: true, created_at: 1 },
            ]
          : null,
      error: null,
    }));
    const list = await listCompanyUsers(admin);
    expect(list.map((u) => u.name)).toEqual(['Chef', 'Max Muster']);
    expect(list[0].me).toBe(true);
    expect(list[1].status).toBe('invited');
  });

  it('speichert über upsert_workspace_user und entfernt über remove_workspace_user', async () => {
    const rpc = vi.fn(async (fn: string) => ({ data: fn === 'upsert_workspace_user' ? { status: 'invited', id: 'inv:neu@muster.at' } : null, error: null }));
    withRpc(rpc);
    const saved = await saveCompanyUser({ email: ' Neu@Muster.at ', name: 'Neu', role: 'arbeiter', tools: [], pkg: 'team', active: true }, admin);
    expect(rpc).toHaveBeenCalledWith('upsert_workspace_user', { p_email: 'neu@muster.at', p_name: 'Neu', p_role: 'arbeiter', p_tools: ['photos'], p_pkg: 'team', p_active: true });
    expect(saved.status).toBe('invited');
    await removeCompanyUser(saved, admin);
    expect(rpc).toHaveBeenLastCalledWith('remove_workspace_user', { p_email: 'neu@muster.at' });
  });

  it('gibt Fehler der Datenbank verständlich weiter', async () => {
    withRpc(async () => ({ data: null, error: { message: 'Du kannst dich nicht selbst entfernen.' } }));
    await expect(removeCompanyUser({ id: 'u1', email: 'chef@muster.at' }, admin)).rejects.toThrow('Du kannst dich nicht selbst entfernen.');
  });
});
