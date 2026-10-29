import { test as base } from '@playwright/test';
export { expect } from '@playwright/test';
export type { Page, Download, CDPSession, BrowserContext } from '@playwright/test';

/**
 * Die Tools sind nur mit Anmeldung erreichbar. Der Anmeldedienst (Supabase) ist aus der Testumgebung
 * nicht erreichbar, deshalb legen die Tests eine gespeicherte Sitzung ins localStorage – so, wie sie
 * der Supabase-Client nach einer echten Anmeldung ablegt. Der Kontext aus der Datenbank fehlt dann
 * (Arbeitsbereich leer), die App fällt auf die Angaben aus der Sitzung zurück.
 * Tests der Anmeldeseite selbst schalten das mit test.use({ signedIn: false }) ab.
 */
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = 4102444800; // 2100
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'test-user', email: 'test@baupad.local', role: 'authenticated', aud: 'authenticated', exp, iat: 1700000000 })}.test`;
export const FAKE_SESSION = {
  access_token: jwt,
  refresh_token: 'test-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: exp,
  user: { id: 'test-user', aud: 'authenticated', role: 'authenticated', email: 'test@baupad.local', user_metadata: { name: 'Test Nutzer', company: 'Testfirma' }, app_metadata: { provider: 'email' }, identities: [], created_at: '2026-01-01T00:00:00Z' },
};
export const SESSION_KEY = 'sb-knaskwuhjixxpnqjfqpx-auth-token';

export const signInScript = (): { key: string; value: string } => ({ key: SESSION_KEY, value: JSON.stringify(FAKE_SESSION) });
const install = ({ key, value }: { key: string; value: string }) => {
  try {
    if (sessionStorage.getItem('e2e-signed-out') === '1') return;
    if (!localStorage.getItem(key)) localStorage.setItem(key, value);
  } catch {
    /* kein localStorage */
  }
};

/** innerhalb eines Tests abmelden (gilt für alle weiteren Seitenaufrufe dieses Tabs) */
export const signOutInPage = (page: import('@playwright/test').Page) =>
  page.evaluate((key) => {
    sessionStorage.setItem('e2e-signed-out', '1');
    localStorage.removeItem(key);
  }, SESSION_KEY);
/** innerhalb eines Tests wieder anmelden */
export const signInInPage = (page: import('@playwright/test').Page) =>
  page.evaluate(({ key, value }) => {
    sessionStorage.removeItem('e2e-signed-out');
    localStorage.setItem(key, value);
  }, signInScript());

const remove = (key: string) => {
  try {
    sessionStorage.setItem('e2e-signed-out', '1');
    localStorage.removeItem(key);
  } catch {
    /* kein localStorage */
  }
};

export const test = base.extend<{ signedIn: boolean }>({
  signedIn: [true, { option: true }],
  // jeder Kontext (auch selbst angelegte über browser.newContext) bekommt die Sitzung
  browser: [
    async ({ browser }, use) => {
      const orig = browser.newContext.bind(browser);
      browser.newContext = (async (...args: Parameters<typeof orig>) => {
        const c = await orig(...args);
        await c.addInitScript(install, signInScript());
        return c;
      }) as typeof orig;
      await use(browser);
      browser.newContext = orig;
    },
    { scope: 'worker' },
  ],
  // Tests der Anmeldeseite: Sitzung wieder entfernen (läuft nach dem Einfügen, vor der Seite)
  context: async ({ context, signedIn }, use) => {
    if (!signedIn) await context.addInitScript(remove, SESSION_KEY);
    await use(context);
  },
});
