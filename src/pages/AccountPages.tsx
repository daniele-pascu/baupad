import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { SiteFooter, SiteNav } from '../components/SiteNav';
import { getCompanyLogo, logoHeaderSize, removeCompanyLogo, saveCompanyLogo, type CompanyLogo } from '../lib/company';
import { getMeta, setMeta } from '../lib/db';
import { AuthNotConnected, getAuth, isEmail, PACKAGES, PROVIDERS, ROLES, TOOLS, defaultToolsForRole, type CompanyUser, type PackageId, type Role, type Session, type ToolId } from '../lib/auth';
import { useSession } from '../lib/use-session';
import { listCompanyUsers, listLocalUsers, migrateLocalUsers, removeCompanyUser, saveCompanyUser, usesRemote } from '../lib/users';
import { ProviderIcon } from '../components/ProviderIcon';
import { Modal } from '../components/Modal';
import { navigate, paths } from '../lib/router';
import { confirmDialog, showError, toast } from '../components/ui';
import { AppStorageSettings } from '../components/InstallApp';
import { usePageTitle } from './SitePages';

/*
 * Anmelden und Registrieren: Google, Apple, Microsoft (Outlook) und E-Mail mit Passwort über Supabase
 * (lib/auth-supabase.ts). Jede Registrierung legt einen Arbeitsbereich an, die Person ist dessen Admin.
 * Ohne angeschlossenen Dienst meldet jeder Versuch ehrlich „noch nicht eingerichtet“.
 */

export function LoginPage({ register = false }: { register?: boolean }) {
  usePageTitle(register ? 'Registrieren – BauPad' : 'Anmelden – BauPad');
  const session = useSession();
  const [tab, setTab] = useState<'login' | 'register'>(register ? 'register' : 'login');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const attempt = async (fn: () => Promise<unknown>) => {
    setError('');
    setInfo('');
    setUnavailable(false);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof AuthNotConnected) setUnavailable(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const done = (s: Session) => {
    toast(`Angemeldet als ${s.name || s.email}.`, 'success');
    navigate(paths.tools(), true);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return setError('Bitte eine gültige E-Mail-Adresse eingeben.');
    if (tab === 'register') {
      if (!name.trim()) return setError('Bitte deinen Namen eingeben.');
      if (password.length < 8) return setError('Das Passwort braucht mindestens 8 Zeichen.');
      if (password !== password2) return setError('Die Passwörter stimmen nicht überein.');
      void attempt(async () => {
        const r = await getAuth().signUp({ name, email, password, company });
        if (r.session) done(r.session);
        else setInfo(`Fast geschafft: Wir haben eine E-Mail an ${r.confirmEmail} geschickt. Bitte den Link darin öffnen, dann ist dein Konto aktiv.`);
      });
    } else {
      if (!password) return setError('Bitte das Passwort eingeben.');
      void attempt(async () => {
        const s = await getAuth().signIn('email', email, password);
        if (s) done(s);
      });
    }
  };
  const forgot = () => {
    if (!isEmail(email)) return setError('Bitte oben deine E-Mail-Adresse eingeben, dann schicken wir den Link zum Zurücksetzen.');
    void attempt(async () => {
      await getAuth().resetPassword(email);
      setInfo(`Wenn es ein Konto für ${email.trim()} gibt, ist der Link zum Zurücksetzen unterwegs. Bitte auch den Spam-Ordner prüfen.`);
    });
  };
  const switchTab = (t: 'login' | 'register') => {
    setTab(t);
    setError('');
    setInfo('');
    setUnavailable(false);
    navigate(t === 'register' ? paths.register() : paths.login(), true);
  };

  return (
    <div className="site">
      <SiteNav />
      <main className="site-main auth">
        <div className="auth-logo" aria-hidden="true">
          <img src="./icons/icon-192.png" alt="" width={72} height={72} />
        </div>
        <h1 className="site-title">{tab === 'register' ? 'Registrieren' : 'Anmelden'}</h1>
        {session ? (
          <div className="auth-card" data-testid="login-signed-in">
            <p>
              Du bist angemeldet als <strong>{session.name || session.email}</strong>
              {session.companyName ? ` (${session.companyName})` : ''}.
            </p>
            <div className="row gap wrap">
              <a href={paths.tools()} className="btn btn-primary">
                Zu den Tools
              </a>
              <a href={paths.account()} className="btn">
                Konto und Einstellungen
              </a>
            </div>
          </div>
        ) : (
          <>
            <p className="auth-intro">{tab === 'register' ? 'Konto anlegen – du wirst Admin deines Arbeitsbereichs und kannst später Kollegen einladen.' : 'Mit deinem Konto auf allen Geräten dieselben Baustellen, Fotos und Berichte.'}</p>
            <div className="segmented auth-tabs" role="tablist" aria-label="Anmelden oder Registrieren">
              <button type="button" role="tab" aria-selected={tab === 'login'} onClick={() => switchTab('login')} data-testid="auth-tab-login">
                Anmelden
              </button>
              <button type="button" role="tab" aria-selected={tab === 'register'} onClick={() => switchTab('register')} data-testid="auth-tab-register">
                Registrieren
              </button>
            </div>
            <div className="auth-card">
              <div className="auth-providers">
                {PROVIDERS.map((p) => (
                  <button key={p.id} type="button" className="btn btn-lg auth-provider" disabled={busy} onClick={() => void attempt(() => getAuth().signIn(p.id))} data-testid="login-provider" data-provider={p.id}>
                    <ProviderIcon id={p.id} /> Mit {p.label} {tab === 'register' ? 'registrieren' : 'anmelden'}
                  </button>
                ))}
              </div>
              <div className="auth-divider">
                <span>oder mit E-Mail</span>
              </div>
              <form onSubmit={submit} noValidate data-testid="login-form">
                {tab === 'register' && (
                  <>
                    <label className="field">
                      <span>Name *</span>
                      <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="register-name" />
                    </label>
                    <label className="field">
                      <span>Firma (optional)</span>
                      <input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" placeholder="z. B. Muster Bau GmbH" data-testid="register-company" />
                    </label>
                  </>
                )}
                <label className="field">
                  <span>E-Mail-Adresse *</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" data-testid="login-email" />
                </label>
                <label className="field">
                  <span>Passwort *</span>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'register' ? 'new-password' : 'current-password'} data-testid="login-password" />
                </label>
                {tab === 'register' && (
                  <label className="field">
                    <span>Passwort wiederholen *</span>
                    <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" data-testid="register-password2" />
                  </label>
                )}
                {error && (
                  <p className="error small" role="alert" data-testid="auth-error">
                    {error}
                  </p>
                )}
                {info && (
                  <p className="banner banner-info small" role="status" data-testid="auth-info">
                    {info}
                  </p>
                )}
                <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={busy} data-testid="login-submit">
                  {busy ? 'Bitte warten …' : tab === 'register' ? 'Konto anlegen' : 'Anmelden'}
                </button>
                {tab === 'login' && (
                  <p className="auth-small muted small">
                    <button type="button" className="link-btn" onClick={forgot} disabled={busy} data-testid="login-forgot">
                      Passwort vergessen?
                    </button>
                  </p>
                )}
              </form>
              {unavailable && (
                <div className="banner banner-info" role="status" data-testid="login-unavailable">
                  <p>
                    <strong>Die Anmeldung ist derzeit nicht verfügbar.</strong> Es wurden keine Daten gesendet. Bitte später noch einmal versuchen.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        <p className="auth-note">
          Für die Werkzeuge ist ein Konto nötig. Projekte, Fotos und Berichte bleiben auf dem Gerät; das Konto verbindet später alle Geräte deiner Firma.
          {' '}
          <a href={paths.landing()}>Zur Startseite</a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

/** Neues Passwort setzen – nach dem Link aus der E-Mail „Passwort zurücksetzen“ */
export function NewPasswordPage() {
  usePageTitle('Neues Passwort – BauPad');
  const session = useSession();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Das Passwort braucht mindestens 8 Zeichen.');
    if (password !== password2) return setError('Die Passwörter stimmen nicht überein.');
    setError('');
    setBusy(true);
    try {
      await getAuth().updatePassword(password);
      toast('Neues Passwort gespeichert.', 'success');
      navigate(paths.tools(), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main auth">
        <h1 className="site-title">Neues Passwort</h1>
        {session === null ? (
          <div className="banner banner-info" role="status">
            <p>Der Link ist abgelaufen oder wurde schon benutzt. Bitte auf der Anmeldeseite erneut „Passwort vergessen?“ wählen.</p>
            <a href={paths.login()} className="btn btn-sm">
              Zur Anmeldung
            </a>
          </div>
        ) : (
          <div className="auth-card">
            <form onSubmit={submit} noValidate data-testid="new-password-form">
              <label className="field">
                <span>Neues Passwort *</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" data-testid="new-password" />
              </label>
              <label className="field">
                <span>Passwort wiederholen *</span>
                <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" data-testid="new-password2" />
              </label>
              {error && (
                <p className="error small" role="alert" data-testid="auth-error">
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={busy || !session} data-testid="new-password-save">
                Passwort speichern
              </button>
            </form>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

const SECTIONS: [string, string][] = [
  ['Persönliche Daten', 'Name, Telefon und Anzeigename'],
  ['E-Mail und Konto', 'E-Mail-Adresse ändern, Konto verwalten'],
  ['Passwort und Anmeldemethoden', 'Passwort ändern, Outlook, Google oder Apple verbinden'],
  ['Abonnement und Zahlung', 'Paket wird vom Admin auf der Website verwaltet – Karte, SEPA oder Rechnung'],
  ['Firmeninformationen', 'Firma und Adresse für Exporte'],
  ['Weitere Einstellungen', 'Sprache, Benachrichtigungen und Datenschutz'],
];

export function AccountPage() {
  usePageTitle('Konto und Einstellungen – BauPad');
  const session = useSession();
  const logout = async () => {
    try {
      await getAuth().signOut();
      toast('Abgemeldet.', 'success');
      navigate(paths.login(), true);
    } catch (e) {
      showError(e, 'Abmelden fehlgeschlagen');
    }
  };
  const deleteAccount = async () => {
    const ok = await confirmDialog({
      title: 'Konto endgültig löschen?',
      message: (
        <>
          <p>Dein Benutzerkonto und dein Arbeitsbereich beim Anmeldedienst werden gelöscht. Das lässt sich nicht rückgängig machen.</p>
          <p>Projekte, Fotos und Berichte auf diesem Gerät bleiben erhalten.</p>
        </>
      ),
      confirmLabel: 'Konto löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await getAuth().deleteAccount();
      toast('Dein Konto wurde gelöscht.', 'success');
      navigate(paths.landing(), true);
    } catch (e) {
      showError(e, 'Konto konnte nicht gelöscht werden');
    }
  };
  return (
    <div className="site">
      <SiteNav />
      <main className="site-main auth">
        <h1 className="site-title">Konto und Einstellungen</h1>
        {session ? (
          <section className="logo-settings" data-testid="account-session">
            <div className="logo-settings-head">
              <div>
                <strong>Angemeldet als {session.name || session.email}</strong>
                <span className="muted">
                  {session.email}
                  {session.companyName ? ` · ${session.companyName}` : ''}
                  {' · '}
                  {ROLES.find((r) => r.id === session.role)?.label ?? session.role}
                  {session.operator ? ' · Betreiber' : ''}
                </span>
              </div>
            </div>
            <div className="row gap wrap">
              <button type="button" className="btn" onClick={() => void logout()} data-testid="account-logout">
                Abmelden
              </button>
              <button type="button" className="btn btn-danger-outline" onClick={() => void deleteAccount()} data-testid="account-delete">
                Konto löschen
              </button>
            </div>
          </section>
        ) : (
          session === null && (
            <div className="banner banner-info" role="status" data-testid="account-preview">
              <p>
                <strong>Nicht angemeldet.</strong>
              </p>
              <a href={paths.login()} className="btn btn-sm btn-primary">
                Anmelden oder registrieren
              </a>
            </div>
          )
        )}
        <AppStorageSettings />
        <LogoSettings />
        <UsersSettings />
        <ul className="account-list">
          {SECTIONS.map(([title, text]) => (
            <li key={title} className="account-item" aria-disabled="true" data-testid="account-section">
              <div>
                <strong>{title}</strong>
                <span className="muted">{text}</span>
              </div>
              <span className="auth-soon">geplant</span>
            </li>
          ))}
        </ul>
        <div className="row gap wrap">
          <a href={paths.tools()} className="btn btn-primary">
            <Icon name="back" /> Zu den Tools
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * Firmenlogo (schon aktiv, ohne Konto): wird auf diesem Gerät gespeichert und automatisch in
 * die Kopfzeile jeder exportierten Excel-Datei eingefügt (Aufmaßblatt: links oben).
 */
function LogoSettings() {
  const [logo, setLogo] = useState<CompanyLogo | null | undefined>(undefined);
  /** Firmenname und Anschrift/Kontakt für den Kopf der Formulare (Regieliste, Bautagesbericht) */
  const [company, setCompany] = useState('');
  const [lines, setLines] = useState('');
  useEffect(() => {
    void Promise.all([getMeta<string>('companyName'), getMeta<string>('companyLines')]).then(([c, l]) => {
      setCompany(c ?? '');
      setLines(l ?? '');
    });
  }, []);
  const saveCompany = () =>
    Promise.all([setMeta('companyName', company.trim()), setMeta('companyLines', lines.trim())])
      .then(() => toast('Firmenangaben gespeichert.', 'success'))
      .catch((e) => showError(e, 'Konnte nicht gespeichert werden'));
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void getCompanyLogo().then(setLogo);
  }, []);
  const url = useMemo(() => (logo ? URL.createObjectURL(new Blob([logo.bytes as BlobPart], { type: `image/${logo.type}` })) : null), [logo]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setLogo(await saveCompanyLogo(file));
      toast('Firmenlogo gespeichert – es erscheint ab jetzt in der Excel-Kopfzeile.', 'success');
    } catch (e) {
      showError(e, 'Logo konnte nicht übernommen werden');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Firmenlogo entfernen?', message: <p>Exporte enthalten danach kein Logo mehr.</p>, confirmLabel: 'Entfernen', danger: true }))) return;
    await removeCompanyLogo();
    setLogo(null);
  };

  return (
    <section className="logo-settings" data-testid="logo-settings">
      <div className="logo-settings-head">
        <div>
          <strong>Firmenlogo</strong>
          <span className="muted">
            Erscheint automatisch in der Kopfzeile jeder exportierten Excel-Datei (Aufmaßblatt: links oben). Leere Ränder werden abgeschnitten und die
            Größe passend zum Logo gewählt – breite Logos flach, quadratische höher. Wird nur auf diesem Gerät gespeichert.
          </span>
        </div>
      </div>
      <div className="logo-settings-body">
        <div className="logo-preview" data-testid="logo-preview">
          {url ? <img src={url} alt="Firmenlogo" data-testid="logo-image" /> : <span className="muted small">{logo === undefined ? '…' : 'Kein Logo'}</span>}
        </div>
        {logo && url && (
          <div className="logo-header-preview" data-testid="logo-header-preview" aria-label="Vorschau Kopfzeile">
            {(() => {
              const s = logoHeaderSize(logo);
              // Punkt → Bildschirmpixel (1 pt ≈ 1,33 px)
              return <img src={url} alt="" style={{ width: s.width * 1.333, height: s.height * 1.333 }} />;
            })()}
            <span className="muted small">1 von 2</span>
            <span className="logo-header-caption muted small">So erscheint es in der Kopfzeile des Aufmaßblatts</span>
          </div>
        )}
        <div className="row gap wrap">
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy} data-testid="logo-pick">
            <Icon name="upload" /> {logo ? 'Logo ersetzen' : 'Logo auswählen'}
          </button>
          {logo && (
            <button type="button" className="btn btn-danger-text" onClick={() => void remove()} data-testid="logo-remove">
              <Icon name="trash" /> Entfernen
            </button>
          )}
        </div>
        <div className="company-lines" data-testid="company-settings">
          <label className="field">
            <span>Firmenname</span>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="z. B. Muster Bau GmbH" data-testid="company-name" />
          </label>
          <label className="field">
            <span>Anschrift und Kontakt (Kopf der Berichte, eine Zeile je Angabe)</span>
            <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={4} placeholder={'A-1100 Wien, Musterstraße 1\nTel. 01/234 56 78\noffice@muster.at\nwww.muster.at'} data-testid="company-lines" />
          </label>
          <button type="button" className="btn btn-sm" onClick={() => void saveCompany()} data-testid="company-save">
            <Icon name="save" size={16} /> Firmenangaben speichern
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          hidden
          data-testid="logo-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void pick(f);
          }}
        />
      </div>
    </section>
  );
}

/** Leerer Benutzer für den Dialog */
const emptyUser = (): Omit<CompanyUser, 'id' | 'createdAt'> => ({ email: '', name: '', role: 'arbeiter', tools: defaultToolsForRole('arbeiter'), pkg: 'team', active: true });

/**
 * Benutzer & Rollen: Der Admin trägt E-Mail, Name, Funktion, Tools und Paket ein. Gespeichert wird die Liste
 * bis zur Anbindung der Anmeldung auf diesem Gerät; Einladungen werden dann verschickt.
 */
function UsersSettings() {
  const session = useSession();
  const remote = usesRemote(session);
  const [users, setUsers] = useState<CompanyUser[] | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [editing, setEditing] = useState<(Omit<CompanyUser, 'id' | 'createdAt'> & { id?: string }) | null>(null);
  const reload = () =>
    listCompanyUsers(session)
      .then(setUsers)
      .catch((e) => showError(e, 'Benutzer konnten nicht geladen werden'));
  useEffect(() => {
    if (session === undefined) return;
    void reload();
    if (usesRemote(session)) void listLocalUsers().then((l) => setLocalCount(l.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  const remove = (u: CompanyUser) =>
    void confirmDialog({
      title: 'Benutzer entfernen?',
      message: <p>{u.name} ({u.email}) wird {remote ? 'aus deinem Arbeitsbereich' : 'aus der Liste'} entfernt.</p>,
      confirmLabel: 'Entfernen',
      danger: true,
    }).then((ok) => {
      if (ok)
        void removeCompanyUser(u, session)
          .then(reload)
          .catch((e) => showError(e, 'Benutzer konnte nicht entfernt werden'));
    });
  const migrate = async () => {
    if (!session) return;
    try {
      const n = await migrateLocalUsers(session);
      toast(`${n} Benutzer in den Arbeitsbereich übernommen.`, 'success');
      setLocalCount(0);
      void reload();
    } catch (e) {
      showError(e, 'Übernahme fehlgeschlagen');
    }
  };
  const toolLabel = (t: ToolId) => TOOLS.find((x) => x.id === t)?.label ?? t;
  return (
    <section className="logo-settings users-settings" data-testid="users-settings">
      <div className="logo-settings-head">
        <div>
          <strong>Benutzer &amp; Rollen</strong>
          <span className="muted">
            {remote
              ? `Benutzer deines Arbeitsbereichs „${session?.companyName}“: E-Mail, Name, Funktion, freigegebene Werkzeuge und Paket. Wer noch kein Konto hat, registriert sich auf pad-software.at mit genau dieser E-Mail-Adresse und landet automatisch in deinem Arbeitsbereich.`
              : 'Als Admin legst du fest, wer in deiner Firma BauPad nutzt: E-Mail, Name, Funktion, freigegebene Werkzeuge und Paket. Ohne Anmeldung ist das eine Vormerkliste auf diesem Gerät – nach dem Anmelden kannst du sie in deinen Arbeitsbereich übernehmen.'}
          </span>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing(emptyUser())} data-testid="user-add">
          <Icon name="plus" size={16} /> Benutzer
        </button>
      </div>
      {remote && localCount > 0 && (
        <div className="banner banner-info" role="status" data-testid="users-migrate">
          <p>
            Auf diesem Gerät sind noch {localCount} vorgemerkte Benutzer gespeichert.
          </p>
          <button type="button" className="btn btn-sm" onClick={() => void migrate()}>
            In den Arbeitsbereich übernehmen
          </button>
        </div>
      )}
      {users && users.length === 0 && <p className="muted small">Noch keine Benutzer eingetragen. Du selbst bist Admin deines Arbeitsbereichs.</p>}
      {users && users.length > 0 && (
        <ul className="user-list" data-testid="user-list">
          {users.map((u) => (
            <li key={u.id} className="user-row" data-testid="user-row" data-email={u.email}>
              <button type="button" className="user-main" onClick={() => setEditing({ ...u })} data-testid="user-open">
                <strong>
                  {u.name}
                  {u.me && <span className="muted small"> (du)</span>}
                </strong>
                <span className="muted small">{u.email}</span>
                <span className="small">
                  <span className={`user-role r-${u.role}`}>{ROLES.find((r) => r.id === u.role)?.label}</span> · {PACKAGES.find((p) => p.id === u.pkg)?.label} ·{' '}
                  {u.tools.map(toolLabel).join(', ')}
                  {!u.active && ' · gesperrt'}
                  {u.status === 'invited' && <span className="user-invited"> · eingeladen, noch nicht registriert</span>}
                </span>
              </button>
              {!u.me && (
                <button type="button" className="icon-btn icon-btn-sm danger" onClick={() => remove(u)} aria-label={`${u.name} entfernen`} data-testid="user-remove">
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <UserDialog
          value={editing}
          session={session}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            toast(remote && saved.status === 'invited' ? `Gespeichert. ${saved.name} registriert sich mit ${saved.email} und ist dann in deinem Arbeitsbereich.` : 'Benutzer gespeichert.', 'success');
            void reload();
          }}
        />
      )}
    </section>
  );
}

function UserDialog({ value, session, onClose, onSaved }: { value: Omit<CompanyUser, 'id' | 'createdAt'> & { id?: string }; session?: Session | null; onClose(): void; onSaved(u: CompanyUser): void }) {
  const [u, setU] = useState(value);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof u>(k: K, v: (typeof u)[K]) => setU((p) => ({ ...p, [k]: v }));
  const setRole = (role: Role) => setU((p) => ({ ...p, role, tools: defaultToolsForRole(role) }));
  const toggleTool = (t: ToolId) => setU((p) => ({ ...p, tools: p.tools.includes(t) ? p.tools.filter((x) => x !== t) : [...p.tools, t] }));
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await saveCompanyUser(u, session));
    } catch (e) {
      showError(e, 'Benutzer konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={u.id ? 'Benutzer bearbeiten' : 'Benutzer hinzufügen'}
      onClose={onClose}
      testId="user-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy} data-testid="user-save">
            Speichern
          </button>
        </>
      }
    >
      <div className="stack-fields">
        <label className="field">
          <span>E-Mail-Adresse *</span>
          <input type="email" value={u.email} onChange={(e) => set('email', e.target.value)} inputMode="email" autoComplete="off" data-autofocus data-testid="user-email" />
        </label>
        <label className="field">
          <span>Name *</span>
          <input value={u.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" data-testid="user-name" />
        </label>
        <fieldset className="field">
          <span>Funktion</span>
          <div className="role-choice" role="radiogroup">
            {ROLES.map((r) => (
              <label key={r.id} className={`role-option${u.role === r.id ? ' on' : ''}`}>
                <input type="radio" name="user-role" checked={u.role === r.id} onChange={() => setRole(r.id)} data-testid={`user-role-${r.id}`} />
                <strong>{r.label}</strong>
                <span className="muted small">{r.text}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <span>Werkzeuge (Vorschlag je Funktion, anpassbar)</span>
          <div className="check-inline">
            {TOOLS.map((t) => (
              <label key={t.id} className="check">
                <input type="checkbox" checked={u.tools.includes(t.id)} onChange={() => toggleTool(t.id)} data-testid={`user-tool-${t.id}`} /> {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>Paket (vorläufig)</span>
          <select value={u.pkg} onChange={(e) => set('pkg', e.target.value as PackageId)} data-testid="user-pkg">
            {PACKAGES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} – {p.text}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={u.active} onChange={(e) => set('active', e.target.checked)} data-testid="user-active" /> Aktiv (abwählen = gesperrt)
        </label>
      </div>
    </Modal>
  );
}
