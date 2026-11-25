import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BauPadWordmark } from '../../components/BauPadWordmark';
import { langOf, LANGS, navigate, parseRoute, paths, sitePath, usePath, type Lang, type SiteRouteName, PRODUCT_SLUG_OF } from '../../lib/router';
import { useSession } from '../../lib/use-session';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { PRODUCTS } from '../products';
import { usePageMeta, type PageMeta } from '../seo';
import { attachNavLens } from '../nav-lens';

/** Logo PAD Software (Zeichen, weiß) – Link zur Startseite */
export function Wordmark({ lang }: { lang: Lang }) {
  return (
    <a href={paths.landing(lang)} className="ps-logo" data-testid="pad-mark">
      <img src="/icons/pad-mark.svg" alt="" width={33} height={32} />
      <span className="ps-logo-name">
        <strong>PAD</strong> Software
      </span>
    </a>
  );
}

/** Adresse derselben Seite in der anderen Sprache (Werkzeug-Seiten behalten ihren Pfad) */
export function switchLangPath(path: string, to: Lang): string {
  const route = parseRoute(path);
  if (route.name === 'product') return paths.product(PRODUCT_SLUG_OF[route.product], to);
  const site = route.name as SiteRouteName;
  const known: SiteRouteName[] = ['landing', 'products', 'baupad', 'company', 'contact', 'thanks', 'future', 'imprint', 'privacy', 'dpa', 'deleteAccountInfo'];
  return known.includes(site) ? sitePath(site, to) : paths.landing(to);
}

const NAV: {
  key: SiteRouteName;
  label: 'home' | 'products' | 'baupad' | 'company' | 'contact' | 'future';
}[] = [
  { key: 'landing', label: 'home' },
  { key: 'products', label: 'products' },
  { key: 'company', label: 'company' },
  { key: 'contact', label: 'contact' },
];

/** BauPad-App-Symbol wie auf dem Handy: schwarzes, abgerundetes Quadrat mit „BauPad“ (echter Text) */
function AppIcon() {
  return (
    <span className="ps-app-icon" aria-hidden="true">
      <BauPadWordmark label={null} />
    </span>
  );
}

/** Fenster unter „Produkte“: App-Symbol, Name und „Die Baustelle in einer App.“ – ein Klick öffnet die BauPad-Seite */
function ProductsPanel({ lang }: { lang: Lang }) {
  const { t } = useLang();
  const h = t.home.product;
  return (
    <div id="ps-products-panel" className="ps-products-panel" data-testid="products-panel">
      <a href={paths.baupad(lang)} className="ps-product" data-testid="products-panel-baupad">
        <AppIcon />
        <strong>{t.product}</strong>
        <span className="ps-product-line">{h.tagline}</span>
      </a>
    </div>
  );
}

/**
 * Leiste oben: schwebt mit Abstand zum Rand, schwarz (95 %) mit Glas-Schimmer und ganz feinem Schatten.
 * Links das Logo, in der Mitte Home · Produkte · Über uns · Kontakt, rechts Anmelden (angemeldet: Name).
 * Schmale Bildschirme: die Links klappen über die Menü-Taste in der Leiste auf.
 */
export function SiteHeader() {
  const { lang, t } = useLang();
  const path = usePath();
  const session = useSession();
  const [open, setOpen] = useState(false);
  // beim Scrollen leicht durchsichtig; Antippen holt die Leiste wieder ganz nach vorne (bis weiter gescrollt wird)
  const [scrolled, setScrolled] = useState(false);
  const [awake, setAwake] = useState(false);
  useEffect(() => setOpen(false), [path]);
  // Leiste immer schwarzes Glas (Logo und Schrift weiß); `light` merkt, ob sie über hellem Grund liegt
  // vor dem ersten Bild prüfen (useLayoutEffect), damit die Leiste beim Seitenwechsel nicht kurz im falschen Modus aufblitzt
  const [light, setLight] = useState(true);
  useLayoutEffect(() => {
    const check = () => {
      const top = document.querySelector('[data-dark-top]');
      setLight(!top || top.getBoundingClientRect().bottom < 44);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [path]);
  useEffect(() => {
    let last = window.scrollY;
    const on = () => {
      const y = window.scrollY;
      setScrolled(y > 8);
      if (Math.abs(y - last) > 40) {
        setAwake(false);
        last = y;
      }
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  // Produkte: Fenster klappt unter der Leiste auf (so breit wie die Links); Klick daneben oder Esc schließt es
  const [products, setProducts] = useState(false);
  // Glaslinse unter den Links (nur breite Bildschirme – am Handy stecken die Links im Menü)
  const navRef = useRef<HTMLElement>(null);
  const lensRef = useRef<HTMLSpanElement>(null);
  useEffect(() => (navRef.current && lensRef.current ? attachNavLens(navRef.current, lensRef.current) : undefined), []);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => setProducts(false), [path]);
  useEffect(() => {
    if (!open && !products) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setProducts(false);
      setOpen(false);
    };
    const outside = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setProducts(false);
        setOpen(false);
      }
    };
    window.addEventListener('keydown', esc);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', esc);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, products]);
  const route = parseRoute(path).name;
  const onLoginPage = route === 'login' || route === 'register' || route === 'newPassword';
  const active = (key: SiteRouteName) => (route === key || (key === 'products' && (route === 'baupad' || route === 'product')) ? 'page' : undefined);
  return (
    <header className={`ps-header${open ? ' open' : ''}${scrolled ? ' scrolled' : ''}${awake ? ' awake' : ''}${light && !open ? ' on-light' : ''}`} data-testid="site-nav" ref={headerRef} onPointerDown={() => setAwake(true)}>
      <a href="#ps-main" className="ps-skip">
        {t.nav.skip}
      </a>
      <div className="ps-bar">
        <Wordmark lang={lang} />
        <nav ref={navRef} id="ps-nav" className="ps-nav" aria-label={lang === 'de' ? 'Hauptnavigation' : 'Main navigation'}>
          <span ref={lensRef} className="ps-lens" aria-hidden="true">
            <span className="ps-lens-clip">
              <span className="ps-lens-copy" inert />
            </span>
          </span>
          {NAV.map((n) =>
            n.key === 'products' ? (
              <div key={n.key} className={`ps-nav-products${products ? ' is-open' : ''}`}>
                <button type="button" aria-current={active(n.key)} aria-expanded={products} aria-controls="ps-products-panel" onClick={() => setProducts(!products)} data-testid="nav-products">
                  {t.nav[n.label]}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {products && <ProductsPanel lang={lang} />}
              </div>
            ) : (
              <a key={n.key} href={sitePath(n.key, lang)} aria-current={active(n.key)}>
                {t.nav[n.label]}
              </a>
            ),
          )}
        </nav>
        <div className="ps-header-actions">
          {/* auf Anmelden, Registrieren und Passwort festlegen braucht es die Taste nicht */}
          {onLoginPage ? null : session ? (
            <a href={paths.account()} className="ps-login" data-testid="nav-account" title={session.email}>
              {session.name ? session.name.split(' ')[0] : t.nav.account}
            </a>
          ) : (
            <a href={paths.login()} className="ps-login" data-testid="nav-login">
              {t.nav.login}
            </a>
          )}
          <button type="button" className="ps-menu-btn" aria-label={open ? t.nav.menuClose : t.nav.menuOpen} aria-expanded={open} aria-controls="ps-nav" onClick={() => setOpen(!open)} data-testid="nav-menu">
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
  const path = usePath();
  const session = useSession();
  return (
    <footer className="ps-footer" data-testid="site-footer">
      <div className="ps-wrap ps-footer-grid">
        <div className="ps-footer-brand">
          <p>
            <strong>{t.company}</strong>
          </p>
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
          <a href={paths.dpa(lang)}>{t.footer.dpa}</a>
          <a href={paths.deleteAccountInfo(lang)}>{t.footer.deleteAccount}</a>
        </nav>
      </div>
      <div className="ps-wrap ps-footer-bottom">
        <span>
          © {new Date().getFullYear()} {t.company}. {t.footer.rights}
        </span>
        <LangSwitch lang={lang} path={path} label={t.nav.langSwitch} />
      </div>
    </footer>
  );
}

/**
 * Rahmen jeder Website-Seite: Kopf, Inhalt, Fuß; setzt Titel und Meta-Angaben (schlicht, ohne Bewegung).
 * `top`: Bereich in voller Breite direkt unter der Leiste (Startseite: schwarzer Kopf mit der Firma).
 */
export function SiteLayout({ meta, children, className = '', top }: { meta: PageMeta; children: ReactNode; className?: string; top?: ReactNode }) {
  const path = usePath();
  usePageMeta(meta);
  return (
    <div className={`ps-site ${className}`} lang={langOf(path)}>
      <SiteHeader />
      {top}
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
