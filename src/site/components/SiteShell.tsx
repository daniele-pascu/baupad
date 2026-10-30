import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { langOf, LANGS, navigate, parseRoute, paths, sitePath, usePath, type Lang, type SiteRouteName } from '../../lib/router';
import { useSession } from '../../lib/use-session';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { PRODUCTS } from '../products';
import { usePageMeta, type PageMeta } from '../seo';
import { useParallax, useReveal } from './Reveal';

/**
 * Wortmarke PAD Software – der bestehende Schriftzug (Text), unverändert in Form, Schrift und Farben.
 * Eine Logo-Datei für PAD Software liegt nicht vor; sobald sie da ist, wird sie hier eins zu eins eingesetzt.
 */
export function Wordmark({ lang }: { lang: Lang }) {
  return (
    <a href={paths.landing(lang)} className="site-wordmark ps-wordmark" aria-label="PAD Software">
      <span className="wm-pad">PAD</span>
      <span className="wm-soft">Software</span>
    </a>
  );
}

/** Adresse derselben Seite in der anderen Sprache (Werkzeug-Seiten behalten ihren Pfad) */
export function switchLangPath(path: string, to: Lang): string {
  const route = parseRoute(path);
  if (route.name === 'product') return paths.product(path.replace(/^\/en/, '').split('/')[2] ?? '', to);
  const site = route.name as SiteRouteName;
  const known: SiteRouteName[] = ['landing', 'products', 'baupad', 'company', 'contact', 'thanks', 'future', 'imprint', 'privacy', 'deleteAccountInfo'];
  return known.includes(site) ? sitePath(site, to) : paths.landing(to);
}

const NAV: { key: SiteRouteName; label: 'home' | 'products' | 'baupad' | 'company' | 'contact' | 'future' }[] = [
  { key: 'landing', label: 'home' },
  { key: 'products', label: 'products' },
  { key: 'baupad', label: 'baupad' },
  { key: 'company', label: 'company' },
  { key: 'future', label: 'future' },
  { key: 'contact', label: 'contact' },
];

export function SiteHeader() {
  const { lang, t } = useLang();
  const path = usePath();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    document.body.classList.toggle('ps-menu-open', open);
    return () => document.body.classList.remove('ps-menu-open');
  }, [open]);
  const route = parseRoute(path).name;
  const active = (key: SiteRouteName) => (route === key || (key === 'baupad' && route === 'product') ? 'page' : undefined);
  return (
    <header className={`ps-header${scrolled ? ' is-scrolled' : ''}`} data-testid="site-nav">
      <a href="#ps-main" className="ps-skip">
        {t.nav.skip}
      </a>
      <div className="ps-wrap ps-header-inner">
        <Wordmark lang={lang} />
        <nav id="ps-nav" className={`ps-nav${open ? ' open' : ''}`} aria-label={lang === 'de' ? 'Hauptnavigation' : 'Main navigation'}>
          {NAV.map((n) => (
            <a key={n.key} href={sitePath(n.key, lang)} aria-current={active(n.key)}>
              {t.nav[n.label]}
            </a>
          ))}
          <div className="ps-nav-mobile-extra">
            <LangSwitch lang={lang} path={path} label={t.nav.langSwitch} />
            {session ? (
              <a href={paths.tools()} className="ps-btn ps-btn-ghost">
                {t.nav.tools}
              </a>
            ) : (
              <a href={paths.login()} className="ps-btn ps-btn-ghost">
                {t.nav.login}
              </a>
            )}
          </div>
        </nav>
        <div className="ps-header-actions">
          <LangSwitch lang={lang} path={path} label={t.nav.langSwitch} />
          {session ? (
            <a href={paths.account()} className="ps-btn ps-btn-ghost ps-hide-sm" data-testid="nav-account" title={session.email}>
              {session.name ? session.name.split(' ')[0] : t.nav.account}
            </a>
          ) : (
            <a href={paths.login()} className="ps-btn ps-btn-ghost ps-hide-sm" data-testid="nav-login">
              {t.nav.login}
            </a>
          )}
          <a href={paths.contact(lang)} className="ps-btn ps-btn-primary ps-hide-sm" data-testid="nav-cta">
            {t.nav.cta}
          </a>
          <button type="button" className="ps-menu-btn" aria-label={open ? t.nav.menuClose : t.nav.menuOpen} aria-expanded={open} aria-controls="ps-nav" onClick={() => setOpen(!open)}>
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}

function LangSwitch({ lang, path, label }: { lang: Lang; path: string; label: string }) {
  return (
    <div className="ps-lang" role="group" aria-label={label} data-testid="lang-switch">
      {LANGS.map((l, i) => (
        <span key={l}>
          {i > 0 && <i aria-hidden="true">|</i>}
          <a href={switchLangPath(path, l)} lang={l} hrefLang={l} aria-current={l === lang ? 'true' : undefined} data-testid={`lang-${l}`}>
            {l.toUpperCase()}
          </a>
        </span>
      ))}
    </div>
  );
}

export function SiteFooter() {
  const { lang, t } = useLang();
  const session = useSession();
  return (
    <footer className="ps-footer" data-testid="site-footer">
      <div className="ps-wrap ps-footer-grid">
        <div className="ps-footer-brand">
          <Wordmark lang={lang} />
          <p>{t.footer.claim}</p>
          <a href={`mailto:${contactData.email}`} className="ps-footer-mail">
            {contactData.email}
          </a>
        </div>
        <nav aria-label={t.footer.products}>
          <h2>{t.footer.products}</h2>
          <a href={paths.products(lang)}>{t.nav.products}</a>
          {PRODUCTS.map((p) => (
            <a key={p.id} href={p.path(lang)}>
              {t.product}
            </a>
          ))}
          <a href={paths.future(lang)}>{t.nav.future}</a>
        </nav>
        <nav aria-label={t.footer.companyCol}>
          <h2>{t.footer.companyCol}</h2>
          <a href={paths.company(lang)}>{t.nav.company}</a>
          <a href={paths.contact(lang)}>{t.nav.contact}</a>
          {session ? <a href={paths.tools()}>{t.nav.tools}</a> : <a href={paths.login()}>{t.footer.login}</a>}
        </nav>
        <nav aria-label={t.footer.legal}>
          <h2>{t.footer.legal}</h2>
          <a href={paths.imprint(lang)}>{t.footer.imprint}</a>
          <a href={paths.privacy(lang)}>{t.footer.privacy}</a>
          <a href={paths.deleteAccountInfo(lang)}>{t.footer.deleteAccount}</a>
        </nav>
      </div>
      <div className="ps-wrap ps-footer-bottom">
        <span>
          © {new Date().getFullYear()} {t.company}. {t.footer.rights}
        </span>
        <button type="button" className="ps-totop" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label={t.common.toTop}>
          <Icon name="up" size={16} />
        </button>
      </div>
    </footer>
  );
}

/** Rahmen jeder Website-Seite: Kopf, Inhalt mit Einblend-Animationen, Fuß; setzt Titel und Meta-Angaben */
export function SiteLayout({ meta, children, className = '' }: { meta: PageMeta; children: ReactNode; className?: string }) {
  const path = usePath();
  usePageMeta(meta);
  useReveal([path]);
  useParallax();
  return (
    <div className={`ps-site ${className}`} lang={langOf(path)}>
      <SiteHeader />
      <main id="ps-main" className="ps-main" tabIndex={-1} key={path.split('?')[0]}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** Verwendung: Seite in anderer Sprache aufrufen (Umschalter im Menü) */
export function goLang(to: Lang) {
  navigate(switchLangPath(location.pathname, to));
}
