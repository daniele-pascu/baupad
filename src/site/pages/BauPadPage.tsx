import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { InstallButton } from '../../components/InstallApp';
import { ToolIcon, type ToolIconName } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { siteAlternates, softwareJsonLd } from '../seo';
import { motionOk, Reveal } from '../components/Reveal';
import { SiteLayout } from '../components/SiteShell';

const IMG = '/site/baupad';
/** Bildschirme, die im Laptop der Bühne wechseln (Reihenfolge wie die Reiter darüber) */
const SCREENS = ['pc-aufmass', 'pc-zeit', 'pc-material', 'pc-bestellungen'];
/** Farbe und Symbol der drei Kärtchen, die über der Bühne schweben */
const CHIPS: { icon: ToolIconName; color: string }[] = [
  { icon: 'projects', color: '#2f80ed' },
  { icon: 'materials', color: '#c2850c' },
  { icon: 'times', color: '#0f9d76' },
];

function Laptop({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bp-lap ${className}`}>
      <div className="bp-lap-scr">{children}</div>
      <div className="bp-lap-base" />
    </div>
  );
}
function Shot({ name, w, h, eager = false, className = '' }: { name: string; w: number; h: number; eager?: boolean; className?: string }) {
  return <img src={`${IMG}/${name}.jpg`} width={w} height={h} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" className={className} />;
}
function Phone({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div className={`bp-ph ${className}`}>
      <div className="bp-ph-bar">
        <b>9:41</b>
        <i />
      </div>
      <Shot name={name} w={560} h={1212} />
    </div>
  );
}
function Tablet({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div className={`bp-tab ${className}`}>
      <Shot name={name} w={1000} h={695} />
    </div>
  );
}
const Points = ({ items }: { items: string[] }) => (
  <ul className="bp-points">
    {items.map((pt) => (
      <li key={pt}>
        <i>
          <Icon name="check" size={14} />
        </i>
        {pt}
      </li>
    ))}
  </ul>
);

/** Produktseite BauPad: die App in Geräten als erster Blick, Limette auf Schwarz, dann Werkzeuge, Probleme → Antworten, Rollen, Technik */
export function BauPadPage() {
  const { lang, t } = useLang();
  const b = t.baupad;
  const [screen, setScreen] = useState(0);
  const [auto, setAuto] = useState(true);
  // der Bildschirm im Laptop wechselt von selbst, bis jemand einen Reiter wählt
  useEffect(() => {
    if (!auto || !motionOk()) return;
    const id = window.setInterval(() => setScreen((s) => (s + 1) % SCREENS.length), 3200);
    return () => window.clearInterval(id);
  }, [auto]);
  const marquee = TOOL_ENTRIES.map((x) => (
    <span key={x.id} style={{ '--c': x.color } as CSSProperties}>
      <i>
        <ToolIcon name={x.icon} size={18} />
      </i>
      {t.tools[x.id].title}
    </span>
  ));
  const stages = [
    <Laptop key="a">
      <Shot name="pc-aufmass" w={1200} h={750} />
    </Laptop>,
    <>
      <Phone key="b1" name="handy-zeit" />
      <Phone key="b2" name="handy-tools" />
    </>,
    <Tablet key="c" name="tablet-bestellungen" />,
  ];
  return (
    <SiteLayout meta={{ title: b.title, description: b.description, lang, alternates: siteAlternates('baupad'), jsonLd: [softwareJsonLd(lang, b.description)] }} className="ps-baupad">
      {/* 1. Kopf: Aussage, Tasten, Bühne mit der App in Laptop, Tablet und Handy */}
      <section className="bp-hero" aria-labelledby="ps-bp-title" data-hero="">
        <div className="bp-wrap">
          <div className="bp-top" data-reveal="" data-immediate="">
            <p className="bp-pill">
              <img src="/icons/baupad-icon.png" width={28} height={28} alt="" />
              {b.hero.eyebrow}
            </p>
            <p className="bp-status">
              <i />
              {b.hero.status}
            </p>
          </div>
          <h1 id="ps-bp-title" className="bp-h1" data-testid="product-title">
            {b.hero.title.map((line, i) => (
              <span key={line} className={i === b.hero.title.length - 1 ? 'bp-accent' : undefined}>
                {line}
                {i < b.hero.title.length - 1 ? ' ' : ''}
              </span>
            ))}
          </h1>
          <p className="bp-lead" data-reveal="" data-immediate="">
            {b.hero.lead}
          </p>
          <div className="bp-actions" data-reveal="" data-immediate="">
            <a href={paths.contact(lang)} className="bp-btn bp-btn-lime" data-testid="cta-contact">
              {b.hero.primary} <Icon name="next" size={16} />
            </a>
            <a href={paths.tools()} className="bp-btn bp-btn-ghost" data-testid="cta-tools">
              {b.hero.secondary}
            </a>
          </div>
          <div className="bp-stage" role="group" aria-label={b.show.label} data-testid="bp-stage">
            <div className="bp-tabs" role="tablist">
              {b.show.tabs.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={screen === i}
                  className={screen === i ? 'on' : undefined}
                  onClick={() => {
                    setAuto(false);
                    setScreen(i);
                  }}
                  data-testid="bp-tab"
                >
                  {label}
                </button>
              ))}
            </div>
            <Laptop className="bp-stage-lap">
              {SCREENS.map((name, i) => (
                <Shot key={name} name={name} w={1200} h={750} eager={i === 0} className={screen === i ? 'on' : undefined} />
              ))}
            </Laptop>
            <Tablet name="tablet-material" className="bp-stage-tab" />
            <Phone name="handy-zeit" className="bp-stage-ph" />
            {b.show.chips.map((c, i) => (
              <div key={c.title} className={`bp-chip bp-chip-${i + 1}`} style={{ '--c': CHIPS[i].color } as CSSProperties}>
                <i>
                  <ToolIcon name={CHIPS[i].icon} size={18} />
                </i>
                <span>
                  {c.title}
                  <small>{c.text}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2. Laufband: die sieben Werkzeuge */}
      <div className="bp-marquee" aria-hidden="true">
        <div>
          {marquee}
          {marquee}
          {marquee}
        </div>
      </div>

      {/* 3. Drei Werkzeuge groß gezeigt */}
      {b.show.items.map((it, i) => (
        <section key={it.title} className={`bp-sec ${i === 1 ? 'bp-tint' : ''}`}>
          <div className={`bp-wrap bp-row ${i === 1 ? 'bp-flip' : ''}`} data-progress="through">
            <Reveal className="bp-row-text">
              <span className="bp-eye">{it.eyebrow}</span>
              <h2 className="bp-h2">{it.title}</h2>
              <p className="bp-sub">{it.text}</p>
              <Points items={it.points} />
            </Reveal>
            <Reveal className={`bp-shotbox bp-shotbox-${i + 1}`} delay={80}>
              {stages[i]}
            </Reveal>
          </div>
        </section>
      ))}

      {/* 4. Zahlen */}
      <div className="bp-nums">
        <div className="bp-wrap">
          {b.numbers.map((n) => (
            <div key={n.label}>
              <b data-count={n.value}>{n.value}</b>
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Problem → Antwort */}
      <section className="bp-sec">
        <div className="bp-wrap">
          <Reveal>
            <span className="bp-eye">{b.problems.eyebrow}</span>
            <h2 className="bp-h2">{b.problems.title}</h2>
          </Reveal>
          <div className="bp-pairs" data-testid="problem-pairs">
            {b.problems.items.map((p, i) => (
              <Reveal key={p.problem} delay={i * 80} as="article" className="bp-pair">
                <div className="bp-pair-problem">
                  <span className="bp-pair-label">{b.problems.problemLabel}</span>
                  <h3>{p.problem}</h3>
                  <p>{p.detail}</p>
                </div>
                <div className="bp-pair-solution">
                  <span className="bp-pair-label">{b.problems.solutionLabel}</span>
                  <h3>{p.solution}</h3>
                  <Points items={p.points} />
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Ein Projekt, alle Werkzeuge + Rollen */}
      <section className="bp-dark">
        <div className="bp-wrap">
          <div className="bp-two">
            <Reveal>
              <span className="bp-eye">{b.one.eyebrow}</span>
              <h2 className="bp-h2">{b.one.title}</h2>
              <p className="bp-sub">{b.one.text}</p>
            </Reveal>
            <Reveal delay={80}>
              <Points items={b.one.points} />
            </Reveal>
          </div>
          <div className="bp-roles">
            <Reveal>
              <span className="bp-eye">{b.roles.eyebrow}</span>
              <h3 className="bp-h3">{b.roles.title}</h3>
              <p className="bp-sub">{b.roles.text}</p>
            </Reveal>
            <ul className="bp-role-list" data-testid="roles">
              {b.roles.items.map((r) => (
                <li key={r.title}>
                  <Icon name="hand" size={18} />
                  {r.title}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 7. Die sieben Werkzeuge */}
      <section className="bp-sec" id="werkzeuge">
        <div className="bp-wrap">
          <Reveal>
            <span className="bp-eye">{b.tools.eyebrow}</span>
            <h2 className="bp-h2">{b.tools.title}</h2>
            <p className="bp-sub">{b.tools.text}</p>
          </Reveal>
          <div className="bp-tools" data-testid="product-grid">
            {TOOL_ENTRIES.map((x, i) => {
              const tool = b.tools.items[x.id];
              return (
                <Reveal key={x.id} delay={(i % 3) * 60} as="article" className="bp-tool" style={{ '--c': x.color } as CSSProperties}>
                  <div className="bp-tool-head">
                    <span className="bp-tool-icon">
                      <ToolIcon name={x.icon} size={26} />
                    </span>
                    <div>
                      <h3>
                        <a href={toolPath(x.id, lang)} className="bp-tool-title" data-testid="product-card">
                          {t.tools[x.id].title}
                        </a>
                      </h3>
                      <p className="bp-tool-hook">{tool.hook}</p>
                    </div>
                  </div>
                  {/* kurz gehalten: die vier wichtigsten Punkte – alle stehen auf der Seite des Werkzeugs */}
                  <Points items={tool.points.slice(0, 4)} />
                  <a href={toolPath(x.id, lang)} className="bp-link">
                    {b.tools.more} <Icon name="next" size={14} />
                  </a>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* 8. Technik kurz */}
      <section className="bp-sec bp-tint">
        <div className="bp-wrap bp-two">
          <Reveal>
            <span className="bp-eye">{b.intro.eyebrow}</span>
            <h2 className="bp-h2">{b.intro.title}</h2>
            <p className="bp-sub">{b.intro.text}</p>
          </Reveal>
          <Reveal delay={80}>
            <Points items={b.intro.facts} />
            <div className="bp-install">
              <InstallButton variant="link" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* 9. Abschluss */}
      <section className="bp-cta">
        <div className="bp-wrap">
          <Reveal>
            <span className="bp-eye">{b.cta.eyebrow}</span>
            <h2 className="bp-h2">{b.cta.title}</h2>
            <p className="bp-sub">{b.cta.text}</p>
          </Reveal>
          <Reveal className="bp-actions">
            <a href={paths.contact(lang)} className="bp-btn bp-btn-dark" data-testid="cta-contact-2">
              {b.cta.primary} <Icon name="next" size={16} />
            </a>
            <a href={paths.register()} className="bp-btn bp-btn-line" data-testid="cta-register">
              {b.cta.secondary}
            </a>
          </Reveal>
        </div>
      </section>
    </SiteLayout>
  );
}
