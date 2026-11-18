import type { ReactNode } from "react";
import {
  langOf,
  LANGS,
  navigate,
  parseRoute,
  paths,
  sitePath,
  usePath,
  type Lang,
  type SiteRouteName,
  PRODUCT_SLUG_OF,
} from "../../lib/router";
import { useSession } from "../../lib/use-session";
import { contactData } from "../contact-data";
import { useLang } from "../i18n";
import { PRODUCTS } from "../products";
import { usePageMeta, type PageMeta } from "../seo";

/** Name PAD Software als Text (Link zur Startseite) */
export function Wordmark({ lang }: { lang: Lang }) {
  return (
    <a
      href={paths.landing(lang)}
      className="ps-wordmark"
      data-testid="pad-mark"
    >
      PAD Software
    </a>
  );
}

/** Adresse derselben Seite in der anderen Sprache (Werkzeug-Seiten behalten ihren Pfad) */
export function switchLangPath(path: string, to: Lang): string {
  const route = parseRoute(path);
  if (route.name === "product")
    return paths.product(PRODUCT_SLUG_OF[route.product], to);
  const site = route.name as SiteRouteName;
  const known: SiteRouteName[] = [
    "landing",
    "products",
    "baupad",
    "company",
    "contact",
    "thanks",
    "future",
    "imprint",
    "privacy",
    "dpa",
    "deleteAccountInfo",
  ];
  return known.includes(site) ? sitePath(site, to) : paths.landing(to);
}

const NAV: {
  key: SiteRouteName;
  label: "home" | "products" | "baupad" | "company" | "contact" | "future";
}[] = [
  { key: "landing", label: "home" },
  { key: "products", label: "products" },
  { key: "company", label: "company" },
  { key: "contact", label: "contact" },
];

export function SiteHeader() {
  const { lang, t } = useLang();
  const path = usePath();
  const session = useSession();
  const route = parseRoute(path).name;
  const active = (key: SiteRouteName) =>
    route === key || (key === "baupad" && route === "product")
      ? "page"
      : undefined;
  return (
    <header className="ps-header" data-testid="site-nav">
      <a href="#ps-main" className="ps-skip">
        {t.nav.skip}
      </a>
      <Wordmark lang={lang} />
      <nav
        className="ps-nav"
        aria-label={lang === "de" ? "Hauptnavigation" : "Main navigation"}
      >
        {NAV.map((n) => (
          <a
            key={n.key}
            href={sitePath(n.key, lang)}
            aria-current={active(n.key)}
            data-testid={n.key === "products" ? "nav-products" : undefined}
          >
            {t.nav[n.label]}
          </a>
        ))}
        <a
          href={sitePath("baupad", lang)}
          aria-current={active("baupad")}
          data-testid="nav-baupad"
        >
          {t.nav.baupad}
        </a>
      </nav>
      <div className="ps-header-actions">
        <LangSwitch lang={lang} path={path} label={t.nav.langSwitch} />
        {session ? (
          <a
            href={paths.account()}
            data-testid="nav-account"
            title={session.email}
          >
            {session.name ? session.name.split(" ")[0] : t.nav.account}
          </a>
        ) : (
          <a href={paths.login()} data-testid="nav-login">
            {t.nav.login}
          </a>
        )}
      </div>
    </header>
  );
}

function LangSwitch({
  lang,
  path,
  label,
}: {
  lang: Lang;
  path: string;
  label: string;
}) {
  return (
    <div
      className="ps-lang"
      role="group"
      aria-label={label}
      data-testid="lang-switch"
    >
      {LANGS.map((l, i) => (
        <span key={l}>
          {i > 0 && <i aria-hidden="true">|</i>}
          <a
            href={switchLangPath(path, l)}
            lang={l}
            hrefLang={l}
            aria-current={l === lang ? "true" : undefined}
            data-testid={`lang-${l}`}
          >
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
          {session ? (
            <a href={paths.tools()}>{t.nav.tools}</a>
          ) : (
            <a href={paths.login()}>{t.footer.login}</a>
          )}
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
      </div>
    </footer>
  );
}

/** Rahmen jeder Website-Seite: Kopf, Inhalt, Fuß; setzt Titel und Meta-Angaben (schlicht, ohne Bewegung) */
export function SiteLayout({
  meta,
  children,
  className = "",
}: {
  meta: PageMeta;
  children: ReactNode;
  className?: string;
}) {
  const path = usePath();
  usePageMeta(meta);
  return (
    <div className={`ps-site ${className}`} lang={langOf(path)}>
      <SiteHeader />
      <main
        id="ps-main"
        className="ps-main"
        tabIndex={-1}
        key={path.split("?")[0]}
      >
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
