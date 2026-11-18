import { useRef, useState, type CSSProperties } from 'react';
import { InstallButton } from '../../components/InstallApp';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath, type ToolEntry } from '../products';
import { siteAlternates, softwareJsonLd } from '../seo';
import { SiteLayout } from '../components/SiteShell';

/**
 * Produktseite BauPad (hell): oben groß das App-Symbol und „BauPad“, darunter jedes Werkzeug als eigenes Fenster
 * in seiner Farbe – Symbol, Name und nur eine kurze Aufzählung (ohne Beschreibung). Jedes Fenster führt zur Werkzeug-Seite.
 * Die weiteren Inhalte (Probleme und Antworten, Rollen, Einführung) kommen später Werkzeug für Werkzeug dazu.
 */
type Detail = { lead: string; groups: readonly { title: string; items: readonly string[] }[] };

export function BauPadPage() {
  const { lang, t } = useLang();
  const b = t.baupad;
  // Fenster eines Tools: geht aus der angetippten Kachel auf und schließt wieder dorthin
  const [open, setOpen] = useState<ToolEntry | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const from = useRef<HTMLElement | null>(null);
  // laufende Schließ-Animation: wird ein neues Fenster geöffnet, bevor sie fertig ist, darf sie es nicht mehr zumachen
  const closing = useRef<Animation | null>(null);
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || !document.body.animate;
  const morph = (d: HTMLElement, card: HTMLElement) => {
    const a = card.getBoundingClientRect();
    const z = d.getBoundingClientRect();
    return `translate(${a.left + a.width / 2 - (z.left + z.width / 2)}px, ${a.top + a.height / 2 - (z.top + z.height / 2)}px) scale(${a.width / z.width}, ${a.height / z.height})`;
  };
  const openTool = (e: React.MouseEvent<HTMLAnchorElement>, x: ToolEntry) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // neuer Tab → Tool-Seite
    e.preventDefault();
    closing.current?.cancel();
    closing.current = null;
    from.current = e.currentTarget;
    setOpen(x);
    requestAnimationFrame(() => {
      const d = dialog.current;
      if (!d) return;
      if (!d.open) d.showModal();
      if (still()) return;
      d.animate([{ transform: morph(d, from.current!), opacity: 0.4 }, { transform: 'none', opacity: 1 }], {
        duration: 380,
        easing: 'cubic-bezier(.32,.72,0,1)',
      });
    });
  };
  const closeTool = () => {
    const d = dialog.current;
    if (!d) return;
    const done = () => {
      d.close();
      setOpen(null);
    };
    if (still() || !from.current || !d.open) return done();
    const anim = d.animate([{ transform: 'none', opacity: 1 }, { transform: morph(d, from.current), opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.4,0,1,1)' });
    closing.current = anim;
    anim.finished.then(
      () => {
        if (closing.current !== anim) return;
        closing.current = null;
        done();
      },
      () => {}, // abgebrochen: inzwischen wurde ein anderes Fenster geöffnet
    );
  };
  const detail: Detail | undefined = open
    ? ((b.details as Record<string, Detail | undefined>)[open.id] ?? { lead: t.tools[open.id].tagline, groups: t.tools[open.id].groups })
    : undefined;
  return (
    <SiteLayout
      meta={{
        title: b.title,
        description: b.description,
        lang,
        alternates: siteAlternates('baupad'),
        jsonLd: [softwareJsonLd(lang, b.description)],
      }}
      className="ps-baupad"
    >
      <section className="bp-hero" aria-labelledby="ps-bp-title">
        <span className="ps-app-icon bp-icon" aria-hidden="true">
          <span>BauPad</span>
        </span>
        <h1 id="ps-bp-title" data-testid="product-title">
          {t.product}
        </h1>
        <p className="bp-tagline">{t.home.product.tagline}</p>
        <p className="bp-status">{b.hero.status}</p>
        <p className="bp-btns">
          <a href={paths.tools()} className="bp-b1" data-testid="cta-tools">
            {b.hero.secondary}
          </a>
          <a href={paths.contact(lang)} className="bp-b2" data-testid="cta-contact">
            {b.hero.primary}
          </a>
        </p>
        <p className="bp-install">
          <InstallButton variant="link" />
        </p>
      </section>

      <ul id="werkzeuge" className="bp-tools" data-testid="product-grid" aria-label={t.home.product.wall.aria}>
        {TOOL_ENTRIES.map((x) => (
          <li key={x.id}>
            <a href={toolPath(x.id, lang)} className="bp-tool" style={{ '--tool': x.color } as CSSProperties} data-testid="product-card" aria-haspopup="dialog" onClick={(e) => openTool(e, x)}>
              <span className="bp-tool-icon" aria-hidden="true">
                <ToolIcon name={x.icon} size={26} />
              </span>
              <strong>{t.tools[x.id].title}</strong>
              <span className="bp-points">
                {t.tools[x.id].points.map((pt) => (
                  <span key={pt}>{pt}</span>
                ))}
              </span>
            </a>
          </li>
        ))}
      </ul>

      {/* Fenster eines Tools: Kopf in der Tool-Farbe, darunter die Beschreibung in Blöcken */}
      <dialog
        ref={dialog}
        className="bp-dialog"
        aria-labelledby="bp-dialog-title"
        data-testid="tool-dialog"
        onCancel={(e) => {
          e.preventDefault();
          closeTool();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeTool(); // Klick neben das Fenster
        }}
        style={open ? ({ '--tool': open.color } as CSSProperties) : undefined}
      >
        {open && detail && (
          <div className="bp-dialog-in">
            <header className="bp-dialog-head">
              <span className="bp-tool-icon" aria-hidden="true">
                <ToolIcon name={open.icon} size={28} />
              </span>
              <div>
                <h2 id="bp-dialog-title">{t.tools[open.id].title}</h2>
                <p>{detail.lead}</p>
              </div>
              <button type="button" className="bp-dialog-x" aria-label={b.dialog.close} onClick={closeTool} data-testid="tool-dialog-close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>
            <div className="bp-dialog-body">
              {detail.groups.map((g) => (
                <section key={g.title}>
                  <h3>{g.title}</h3>
                  <ul>
                    {g.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <footer className="bp-dialog-foot">
              <a href={toolPath(open.id, lang)} className="bp-b1" data-testid="tool-dialog-more">
                {b.dialog.more}
              </a>
              <button type="button" className="bp-b2" onClick={closeTool}>
                {b.dialog.close}
              </button>
            </footer>
          </div>
        )}
      </dialog>

      {/* Projektregister: ein Projekt einmal anlegen, in jedes Tool übernehmen */}
      <section className="bp-sec bp-register" aria-labelledby="bp-register" data-testid="bp-register">
        <div>
          <p className="ps-eyebrow">{b.register.eyebrow}</p>
          <h2 id="bp-register">{b.register.title}</h2>
          <p className="bp-sec-text bp-register-lead">{b.register.lead}</p>
          <ul className="bp-register-points">
            {b.register.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div className="bp-register-art" aria-hidden="true">
          <span className="bp-register-pill">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z" />
            </svg>
            {b.register.label}
          </span>
          <span className="bp-register-icons">
            {TOOL_ENTRIES.map((x) => (
              <span key={x.id} className="ph-tool-icon" style={{ '--tool': x.color } as CSSProperties}>
                <ToolIcon name={x.icon} size={18} />
              </span>
            ))}
          </span>
        </div>
      </section>

      {/* Speichern: „Speichert alles online. Nichts geht verloren.“ – mit Empfang sofort online, ohne Empfang am Gerät,
          bei der ersten Verbindung automatisch online */}
      <section className="bp-sec" aria-labelledby="bp-saving">
        <p className="ps-eyebrow">{b.saving.eyebrow}</p>
        <h2 id="bp-saving">{b.saving.title}</h2>
        <p className="bp-sec-text" data-testid="bp-safe">
          {b.hero.safe.join(' ')}
        </p>
        <ol className="bp-saving" data-testid="bp-saving">
          {b.saving.items.map((x, i) => (
            <li key={x.title}>
              <span className="bp-saving-icon" aria-hidden="true">
                {SAVING_ICONS[i]}
              </span>
              <strong>{x.title}</strong>
              <span>{x.text}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Rollen: je Nutzerlizenz eine von vier Rollen */}
      <section className="bp-sec" aria-labelledby="bp-access">
        <p className="ps-eyebrow">{b.access.eyebrow}</p>
        <h2 id="bp-access">{b.access.title}</h2>
        <p className="bp-sec-text">{b.access.text}</p>
        <ul className="bp-roles" data-testid="bp-roles">
          {b.access.items.map((r) => (
            <li key={r.role} className={r.full ? 'is-full' : 'is-limited'}>
              <strong>{r.role}</strong>
              <span className="bp-role-badge">{r.full ? b.access.full : b.access.limited}</span>
              <ul>
                {r.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
}

/** Symbole für „Speichern“: Wolke mit Haken, Handy, Pfeile im Kreis */
const SAVING_ICONS = [
  <svg key="a" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19H7a5 5 0 1 1 .9-9.92A6 6 0 0 1 19.5 11 4 4 0 0 1 17.5 19Z" />
    <path d="m9 13.5 2 2 4-4" />
  </svg>,
  <svg key="b" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </svg>,
  <svg key="c" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
    <path d="M4 3.5V8h4.5" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
    <path d="M20 20.5V16h-4.5" />
  </svg>,
];
