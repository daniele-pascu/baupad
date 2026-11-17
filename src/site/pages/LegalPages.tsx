import { paths } from '../../lib/router';
import { contactData } from '../contact-data';
import { fill, useLang } from '../i18n';
import { siteAlternates } from '../seo';
import { Reveal } from '../components/Reveal';
import { Section } from '../components/Section';
import { SiteLayout } from '../components/SiteShell';
import { AVV_INTRO, AVV_SECTIONS, AVV_STAND, AVV_SUBPROCESSORS, AVV_TOM, type AvvSection } from '../legal/avv';

function LegalRow({ label, value, missing }: { label: string; value: string; missing: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ? <span className="pre">{value}</span> : <span className="placeholder">{missing}</span>}</dd>
    </div>
  );
}

/** Impressum (§ 5 ECG, § 25 MedienG) – fehlende Angaben sichtbar als Platzhalter, nichts wird erfunden */
export function ImprintPage() {
  const { lang, t } = useLang();
  const i = t.legal.imprint;
  const c = contactData;
  return (
    <SiteLayout meta={{ title: i.title, description: i.description, lang, alternates: siteAlternates('imprint') }} className="ps-legal">
      <Section tone="white">
        <Reveal className="ps-text">
          <h1 className="ps-h1">{i.heading}</h1>
          <p className="ps-lead ps-lead-dark">{i.intro}</p>
          <dl className="ps-dl" data-testid="imprint-list">
            <LegalRow label={i.rows.company} value={c.company} missing={i.missing} />
            <LegalRow label={i.rows.owner} value={c.person} missing={i.missing} />
            <LegalRow label={i.rows.address} value={c.address} missing={i.missing} />
            <LegalRow label={i.rows.email} value={c.email} missing={i.missing} />
            <LegalRow label={i.rows.phone} value={c.phone} missing={i.missing} />
            <LegalRow label={i.rows.uid} value={c.uid} missing={i.missing} />
            <LegalRow label={i.rows.register} value={c.register} missing={i.missing} />
          </dl>
          <p className="ps-small">{i.note}</p>
        </Reveal>
      </Section>
    </SiteLayout>
  );
}

/** Datenschutzerklärung – beschreibt nur, was Website und BauPad tatsächlich tun */
export function PrivacyPage() {
  const { lang, t } = useLang();
  const p = t.legal.privacy;
  const c = contactData;
  const vars = { company: c.company, address: c.address ? `, ${c.address}` : '', email: c.email ? `, ${lang === 'de' ? 'E-Mail' : 'e-mail'}: ${c.email}` : '' };
  return (
    <SiteLayout meta={{ title: p.title, description: p.description, lang, alternates: siteAlternates('privacy') }} className="ps-legal">
      <Section tone="white">
        <Reveal className="ps-text">
          <h1 className="ps-h1">{p.heading}</h1>
          <p className="ps-lead ps-lead-dark">
            {p.stand}: {p.standDate}. {p.summary}
          </p>
          {p.sections.map((s) => (
            <section key={s.h} className="ps-legal-section">
              <h2>{s.h}</h2>
              {s.p.map((para, k) => (
                <p key={k}>{fill(para, vars)}</p>
              ))}
            </section>
          ))}
        </Reveal>
      </Section>
    </SiteLayout>
  );
}

function AvvBlock({ s, vars }: { s: AvvSection; vars: Record<string, string> }) {
  return (
    <section className="ps-legal-section">
      <h3>{s.h}</h3>
      {s.p?.map((para, k) => (
        <p key={k}>{fill(para, vars)}</p>
      ))}
      {s.list && (
        <ul className="ps-legal-list">
          {s.list.map((li, k) => (
            <li key={k}>{fill(li, vars)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Vertrag zur Auftragsverarbeitung (Art. 28 DSGVO) für Firmen – Vertragstext deutsch (lib: site/legal/avv.ts) */
export function DpaPage() {
  const { lang, t } = useLang();
  const d = t.legal.dpa;
  const c = contactData;
  const vars = { company: c.company + (c.person ? ` (${c.person})` : ''), address: c.address ? `, ${c.address}` : '', email: c.email ? `, E-Mail: ${c.email}` : '' };
  const mail = { ...vars, email: c.email || 'uns' };
  return (
    <SiteLayout meta={{ title: d.title, description: d.description, lang, alternates: siteAlternates('dpa') }} className="ps-legal">
      <Section tone="white">
        <Reveal className="ps-text" data-testid="dpa-page">
          <h1 className="ps-h1">{d.heading}</h1>
          <p className="ps-lead ps-lead-dark">
            {d.stand}: {AVV_STAND}. {fill(AVV_INTRO, mail)}
          </p>
          {d.langNote && <p className="ps-small">{d.langNote}</p>}
          <p>
            <button type="button" className="ps-btn ps-btn-outline-dark ps-print-hide" onClick={() => window.print()} data-testid="dpa-print">
              {d.print}
            </button>
          </p>
          <div lang="de">
            {AVV_SECTIONS.map((s) => (
              <AvvBlock key={s.h} s={s} vars={vars} />
            ))}
            <section className="ps-legal-section">
              <h2>{d.annex1}</h2>
            </section>
            {AVV_TOM.map((s) => (
              <AvvBlock key={s.h} s={s} vars={vars} />
            ))}
            <section className="ps-legal-section">
              <h2>{d.annex2}</h2>
              <dl className="ps-dl" data-testid="dpa-subprocessors">
                {AVV_SUBPROCESSORS.map((x) => (
                  <div key={x.name}>
                    <dt>{x.name}</dt>
                    <dd>
                      {x.task}
                      <br />
                      <span className="ps-small">{x.where}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </Reveal>
      </Section>
    </SiteLayout>
  );
}

/** Öffentliche Anleitung „Konto löschen“ (Vorgabe von Google Play und App Store) */
export function DeleteAccountPage() {
  const { lang, t } = useLang();
  const d = t.legal.deleteAccount;
  return (
    <SiteLayout meta={{ title: d.title, description: d.description, lang, alternates: siteAlternates('deleteAccountInfo') }} className="ps-legal">
      <Section tone="white">
        <Reveal className="ps-text">
          <h1 className="ps-h1">{d.heading}</h1>
          <p className="ps-lead ps-lead-dark">{d.intro}</p>
          <ol className="ps-steps" data-testid="delete-steps">
            {d.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <section className="ps-legal-section">
            <h2>{d.deletedTitle}</h2>
            <p>{d.deleted}</p>
            <h2>{d.keptTitle}</h2>
            <p>{d.kept}</p>
            <h2>{d.noAccessTitle}</h2>
            <p>{fill(d.noAccess, { email: contactData.email })}</p>
          </section>
          <p>
            <a href={paths.login()} className="ps-btn ps-btn-navy">
              {d.login}
            </a>
          </p>
        </Reveal>
      </Section>
    </SiteLayout>
  );
}

export function NotFoundPage() {
  const { lang, t } = useLang();
  return (
    <SiteLayout meta={{ title: t.notFound.title, description: t.notFound.text, lang, alternates: {} }} className="ps-legal">
      <Section tone="white">
        <div className="ps-text">
          <h1 className="ps-h1">{t.notFound.heading}</h1>
          <p className="ps-lead ps-lead-dark">{t.notFound.text}</p>
          <a href={paths.landing(lang)} className="ps-btn ps-btn-navy">
            {t.notFound.home}
          </a>
        </div>
      </Section>
    </SiteLayout>
  );
}
