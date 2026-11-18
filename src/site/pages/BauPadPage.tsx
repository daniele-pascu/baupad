import { InstallButton } from "../../components/InstallApp";
import { paths } from "../../lib/router";
import { useLang } from "../i18n";
import { TOOL_ENTRIES, toolPath } from "../products";
import { siteAlternates, softwareJsonLd } from "../seo";
import { SiteLayout } from "../components/SiteShell";

/** Produktseite BauPad – schlicht: Aussage, die sieben Werkzeuge, Zahlen, Probleme und Antworten, Rollen, Technik, Abschluss */
export function BauPadPage() {
  const { lang, t } = useLang();
  const b = t.baupad;
  return (
    <SiteLayout
      meta={{
        title: b.title,
        description: b.description,
        lang,
        alternates: siteAlternates("baupad"),
        jsonLd: [softwareJsonLd(lang, b.description)],
      }}
      className="ps-baupad"
    >
      <section aria-labelledby="ps-bp-title">
        <p className="ps-eyebrow">
          {b.hero.eyebrow} · {b.hero.status}
        </p>
        <h1 id="ps-bp-title" data-testid="product-title">
          {b.hero.title.join(" ")}
        </h1>
        <p>{b.hero.lead}</p>
        <ul id="werkzeuge" data-testid="product-grid">
          {TOOL_ENTRIES.map((x) => (
            <li key={x.id}>
              <a href={toolPath(x.id, lang)} data-testid="product-card">
                {t.tools[x.id].title}
              </a>{" "}
              – {t.tools[x.id].short}
            </li>
          ))}
        </ul>
        <p className="ps-links">
          <a href={paths.contact(lang)} data-testid="cta-contact">
            {b.hero.primary}
          </a>
          <a href={paths.tools()} data-testid="cta-tools">
            {b.hero.secondary}
          </a>
        </p>
      </section>

      <section>
        <ul className="ps-numbers">
          {b.numbers.map((n) => (
            <li key={n.label}>
              <strong>{n.value}</strong> {n.label}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="bp-problems">
        <p className="ps-eyebrow">{b.problems.eyebrow}</p>
        <h2 id="bp-problems">{b.problems.title}</h2>
        <div data-testid="problem-pairs">
          {b.problems.items.map((p) => (
            <article key={p.problem}>
              <h3>
                {b.problems.problemLabel}: {p.problem}
              </h3>
              <p>{p.detail}</p>
              <p>
                <strong>
                  {b.problems.solutionLabel}: {p.solution}
                </strong>
              </p>
              <ul>
                {p.points.map((pt) => (
                  <li key={pt}>{pt}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="bp-one">
        <p className="ps-eyebrow">{b.one.eyebrow}</p>
        <h2 id="bp-one">{b.one.title}</h2>
        <p>{b.one.text}</p>
        <ul>
          {b.one.points.map((pt) => (
            <li key={pt}>{pt}</li>
          ))}
        </ul>
        <p className="ps-eyebrow">{b.roles.eyebrow}</p>
        <h3>{b.roles.title}</h3>
        <p>{b.roles.text}</p>
        <ul data-testid="roles">
          {b.roles.items.map((r) => (
            <li key={r.title}>{r.title}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="bp-intro">
        <p className="ps-eyebrow">{b.intro.eyebrow}</p>
        <h2 id="bp-intro">{b.intro.title}</h2>
        <p>{b.intro.text}</p>
        <ul>
          {b.intro.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p>
          <InstallButton variant="link" />
        </p>
      </section>

      <section aria-labelledby="bp-cta">
        <p className="ps-eyebrow">{b.cta.eyebrow}</p>
        <h2 id="bp-cta">{b.cta.title}</h2>
        <p>{b.cta.text}</p>
        <p className="ps-links">
          <a href={paths.contact(lang)} data-testid="cta-contact-2">
            {b.cta.primary}
          </a>
          <a href={paths.register()} data-testid="cta-register">
            {b.cta.secondary}
          </a>
        </p>
      </section>
    </SiteLayout>
  );
}
