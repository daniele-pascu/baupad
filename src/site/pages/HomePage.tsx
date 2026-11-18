import { useEffect, useRef, type CSSProperties } from 'react';
import { ToolIcon } from '../../components/ToolIcon';
import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { useLang } from '../i18n';
import { TOOL_ENTRIES, toolPath } from '../products';
import { organizationJsonLd, siteAlternates, softwareJsonLd } from '../seo';
import { PadMarkGlass } from '../components/PadMarkGlass';
import { SiteLayout } from '../components/SiteShell';

/**
 * Startseite PAD Software: oben ein schwarzer Kopf mit der Firma (Licht in Violett und Petrol, kaum sichtbar das PAD-Zeichen),
 * darunter heller Grund mit zarten Farblichtern; alles Weitere liegt in Fenstern aus hellem Liquid Glass:
 * BauPad mit allen Werkzeugen (wie in der App); Arbeitsweise (als Linie) und Kontakt stehen frei, ohne Fenster.
 */
export function HomePage() {
  const { lang, t } = useLang();
  const h = t.home;
  const w = h.product.wall;
  return (
    <SiteLayout
      meta={{
        title: h.title,
        description: h.description,
        lang,
        alternates: siteAlternates('landing'),
        jsonLd: [organizationJsonLd(contactData.email), softwareJsonLd(lang, t.baupad.description)],
      }}
      className="ps-home"
      top={
        <div className="ph-top" data-dark-top="">
          <section className="ph-hero" aria-labelledby="ph-title">
            {/* großes, ganz zartes PAD-Zeichen; mittig darauf das Zeichen aus weißem Liquid Glass (wächst beim Öffnen) */}
            <div className="ph-mark" aria-hidden="true">
              <img src="/site/pad-mark-bg.svg" alt="" width={859} height={830} />
              <PadMarkGlass />
            </div>
            <p className="ps-eyebrow">{h.hero.eyebrow}</p>
            <h1 id="ph-title">
              PAD <span>Software</span>
            </h1>
            <p className="ps-motto" data-testid="home-motto">
              {/* in Großbuchstaben mit Mittelpunkt dazwischen – ohne die Punkte am Wortende */}
              {h.hero.motto.map((m) => (
                <span key={m}>{m.replace(/\.$/, '')}</span>
              ))}
            </p>
            <p className="ph-lead">{h.hero.lead}</p>
            <p className="ph-btns">
              <a href="#loesungen" className="ph-b1" data-testid="cta-solutions">
                {h.hero.primary}
              </a>
              <a href={paths.company(lang)} className="ph-b2" data-testid="cta-company">
                {h.hero.secondary}
              </a>
            </p>
          </section>
        </div>
      }
    >
      <section id="loesungen" className="ph-win ph-prod" aria-labelledby="ph-bp-title">
        <div>
          <p className="ps-eyebrow">{h.product.eyebrow}</p>
          {/* App-Symbol, daneben Name und „Die Baustelle in einer App.“ */}
          <div className="ph-prod-head">
            <span className="ps-app-icon ph-app-icon" aria-hidden="true">
              <span>BauPad</span>
            </span>
            <div>
              <h2 id="ph-bp-title">
                {h.product.name} <span className="ph-tag">{h.product.status}</span>
              </h2>
              <p className="ph-tagline">{h.product.tagline}</p>
            </div>
          </div>
          {/* alle Werkzeuge wie in der App: Symbol im farbigen Feld, daneben der Name – jedes führt zur Werkzeug-Seite */}
          <ul className="ph-tools" data-testid="home-tool-list" aria-label={w.aria}>
            {TOOL_ENTRIES.map((x) => (
              <li key={x.id}>
                <a href={toolPath(x.id, lang)} style={{ '--tool': x.color } as CSSProperties}>
                  <span className="ph-tool-icon" aria-hidden="true">
                    <ToolIcon name={x.icon} size={22} />
                  </span>
                  {t.tools[x.id].title}
                </a>
              </li>
            ))}
          </ul>
          <p className="ph-btns">
            <a href={paths.baupad(lang)} className="ph-b1" data-testid="home-product">
              {h.product.cta}
            </a>
            <a href={paths.tools()} className="ph-b2" data-testid="home-open">
              {h.product.open}
            </a>
          </p>
        </div>
        <div className="ph-phone">
          <img src="/site/fotos-baustelle-iphone.jpg" alt={h.product.alts[2]} width={600} height={1298} loading="lazy" decoding="async" />
        </div>
      </section>

      <section id="entwicklung" className="ph-sec" aria-labelledby="ph-process-title">
        <p className="ps-eyebrow">{h.process.label}</p>
        <h2 id="ph-process-title">{h.process.title}</h2>
        <StepsLine steps={h.process.steps} />
      </section>

      <section id="kontakt" className="ph-sec" aria-labelledby="ph-contact-title">
        <p className="ps-eyebrow">{h.contact.label}</p>
        <h2 id="ph-contact-title">{h.contact.title}</h2>
        <p>{h.contact.text}</p>
        <p>
          <a href={`mailto:${contactData.email}`} className="ph-mail">
            {contactData.email}
          </a>
        </p>
        <p className="ph-btns">
          <a href={paths.contact(lang)} className="ph-b1" data-testid="cta-contact-2">
            {h.contact.primary}
          </a>
          <a href={paths.products(lang)} className="ph-b2" data-testid="cta-products">
            {h.contact.secondary}
          </a>
        </p>
      </section>
    </SiteLayout>
  );
}

/**
 * Arbeitsweise auf einer Linie: am Anfang ein Punkt, bei Schritt 2 und 3 nur ein kleiner Schnittpunkt.
 * Ein Lichtpunkt läuft vom Anfang die Linie entlang, hält an jedem Schnittpunkt kurz, läuft ans Ende, verschwindet
 * und beginnt von vorne. Die Wege werden gemessen (nebeneinander am PC, untereinander am Handy).
 * „Bewegung reduzieren“ → kein laufender Punkt.
 */
function StepsLine({ steps }: { steps: { title: string }[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dot = el.querySelector<HTMLElement>('.ph-steps-run');
    if (!dot || !dot.animate) return;
    let anim: Animation | undefined;
    const build = () => {
      const b = el.getBoundingClientRect();
      const ol = el.querySelector('ol')!.getBoundingClientRect();
      const li = [...el.querySelectorAll('li')].map((x) => x.getBoundingClientRect());
      if (li.length < 3 || !b.width) return;
      const row = Math.abs(li[1].top - li[0].top) < 2;
      // Mitte des Punkts bzw. Schnittpunkts jedes Schritts (13 px groß, oben links im Schritt)
      const p = li.map((r) => [r.left - b.left + 6.5, r.top - b.top + 6.5]);
      const end = row ? [ol.right - b.left + 8, p[0][1]] : [p[0][0], li[2].bottom - b.top + 14];
      const at = ([x, y]: number[], s = 1) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
      const c = ['#6a55f0', '#3e7dbf', '#12a58e'];
      const move = 'cubic-bezier(.45,0,.25,1)';
      anim?.cancel();
      anim = dot.animate(
        [
          { offset: 0, transform: at(p[0], 0.4), opacity: 0, backgroundColor: c[0] },
          { offset: 0.07, transform: at(p[0]), opacity: 1, backgroundColor: c[0], easing: move },
          { offset: 0.25, transform: at(p[1]), opacity: 1, backgroundColor: c[1] },
          { offset: 0.37, transform: at(p[1]), opacity: 1, backgroundColor: c[1], easing: move },
          { offset: 0.55, transform: at(p[2]), opacity: 1, backgroundColor: c[2] },
          { offset: 0.67, transform: at(p[2]), opacity: 1, backgroundColor: c[2], easing: 'cubic-bezier(.45,0,.6,1)' },
          { offset: 0.86, transform: at(end, 0.5), opacity: 0, backgroundColor: c[2] },
          { offset: 1, transform: at(end, 0.5), opacity: 0, backgroundColor: c[2] },
        ],
        { duration: 5000, iterations: Infinity },
      );
    };
    build();
    const ro = new ResizeObserver(build);
    ro.observe(el);
    return () => {
      ro.disconnect();
      anim?.cancel();
    };
  }, []);
  return (
    <div className="ph-steps-box" ref={box}>
      <ol className="ph-steps" data-testid="home-steps">
        {steps.map((s) => (
          <li key={s.title}>{s.title}</li>
        ))}
      </ol>
      <span className="ph-steps-run" aria-hidden="true" />
    </div>
  );
}
