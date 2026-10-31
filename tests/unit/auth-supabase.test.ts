import { describe, expect, it, vi } from 'vitest';
import { SupabaseAuth, translateAuthError, type AuthClientLike } from '../../src/lib/auth-supabase';

/** nachgestellter Supabase-Client: nur die hier benötigten Aufrufe */
function fakeClient(over: Partial<AuthClientLike['auth']> = {}, rpc?: AuthClientLike['rpc']): AuthClientLike {
  const user = { id: 'u1', email: 'max@muster.at', user_metadata: { name: 'Max Muster', company: 'Muster Bau' }, app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email' }] };
  return {
    auth: {
      getSession: async () => ({ data: { session: { user } }, error: null }),
      signInWithPassword: async () => ({ data: { user, session: { user } }, error: null }),
      signInWithOAuth: async () => ({ error: null }),
      signUp: async () => ({ data: { user, session: null }, error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      linkIdentity: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      ...over,
    },
    rpc: rpc ?? (async () => ({ data: { workspace_id: 'w1', workspace_name: 'Muster Bau GmbH', role: 'admin', pkg: 'einzel', tools: ['photos'], sites: ['p:1'], operator: false, name: 'Max Muster', phone: '0664' }, error: null })),
  };
}

describe('SupabaseAuth', () => {
  it('baut die Sitzung aus Benutzer und Kontext der Datenbank', async () => {
    const a = new SupabaseAuth(fakeClient(), 'https://pad-software.at/');
    const s = await a.session();
    expect(s).toEqual({ userId: 'u1', email: 'max@muster.at', name: 'Max Muster', role: 'admin', companyId: 'w1', companyName: 'Muster Bau GmbH', operator: false, phone: '0664', pkg: 'einzel', workspaceActive: true, providers: ['email'], tools: ['photos'], sites: ['p:1'], toolSites: {} });
  });

  it('gesperrter Arbeitsbereich: workspace_active false kommt in die Sitzung', async () => {
    const a = new SupabaseAuth(fakeClient({}, async () => ({ data: { workspace_id: 'w2', workspace_name: 'Neu GmbH', role: 'admin', pkg: 'einzel', tools: [], sites: [], operator: false, workspace_active: false, name: 'Neu', phone: '' }, error: null })), 'x');
    const s = await a.session();
    expect(s?.workspaceActive).toBe(false);
  });

  it('kommt ohne Kontext aus (z. B. Schema noch nicht angelegt): Name und Firma aus der Registrierung', async () => {
    const a = new SupabaseAuth(fakeClient({}, async () => ({ data: null, error: { message: 'function my_context does not exist' } })), 'x');
    const s = await a.session();
    expect(s?.name).toBe('Max Muster');
    expect(s?.companyName).toBe('Muster Bau');
    expect(s?.companyId).toBe('');
  });

  it('übersetzt Fehler des Dienstes', async () => {
    const a = new SupabaseAuth(fakeClient({ signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }) }), 'x');
    await expect(a.signIn('email', 'max@muster.at', 'falsch')).rejects.toThrow('E-Mail-Adresse oder Passwort ist falsch.');
    expect(translateAuthError('Email not confirmed')).toMatch(/bestätigen/);
    expect(translateAuthError('Failed to fetch')).toMatch(/Internetverbindung/);
    expect(translateAuthError('Irgendwas anderes')).toBe('Irgendwas anderes');
  });

  it('Registrierung: E-Mail-Bestätigung ausstehend bzw. Adresse schon vergeben', async () => {
    const a = new SupabaseAuth(fakeClient(), 'x');
    const r = await a.signUp({ name: 'Max', email: ' Max@Muster.at ', password: 'geheim123' });
    expect(r).toEqual({ session: null, confirmEmail: 'max@muster.at' });
    const dup = new SupabaseAuth(fakeClient({ signUp: async () => ({ data: { user: { id: 'u2', identities: [] }, session: null }, error: null }) }), 'x');
    await expect(dup.signUp({ name: 'Max', email: 'max@muster.at', password: 'geheim123' })).rejects.toThrow(/schon ein Konto/);
  });

  it('Anbieter-Anmeldung leitet mit Rücksprungadresse weiter; Microsoft heißt beim Dienst azure', async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const a = new SupabaseAuth(fakeClient({ signInWithOAuth }), 'https://pad-software.at/');
    await a.signIn('microsoft');
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'azure', options: { redirectTo: 'https://pad-software.at/', scopes: 'email openid profile' } });
    await a.signIn('google');
    expect(signInWithOAuth).toHaveBeenLastCalledWith({ provider: 'google', options: { redirectTo: 'https://pad-software.at/' } });
  });

  it('Passwort zurücksetzen nutzt die Rücksprungadresse mit reset=1; Konto löschen ruft die Datenbankfunktion und meldet ab', async () => {
    const resetPasswordForEmail = vi.fn(async () => ({ error: null }));
    const signOut = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const a = new SupabaseAuth(fakeClient({ resetPasswordForEmail, signOut }, rpc), 'https://pad-software.at/');
    await a.resetPassword('Max@Muster.at');
    expect(resetPasswordForEmail).toHaveBeenCalledWith('max@muster.at', { redirectTo: 'https://pad-software.at/?reset=1' });
    await a.deleteAccount();
    expect(rpc).toHaveBeenCalledWith('delete_own_account');
    expect(signOut).toHaveBeenCalled();
  });
});
