import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { navigate, paths } from '../../lib/router';
import { consumeSent, markSent, sendContact, type ContactPayload } from '../contact-api';
import { contactData } from '../contact-data';
import { fill, useLang } from '../i18n';
import { organizationJsonLd, siteAlternates } from '../seo';
import { Reveal } from '../components/Reveal';
import { Section, SectionHead } from '../components/Section';
import { Backdrop } from '../components/Shapes';
import { SiteLayout } from '../components/SiteShell';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Field = 'name' | 'company' | 'email' | 'subject' | 'message' | 'consent';

/** Kontaktseite: direkte Angaben und Formular mit Prüfung; Danke-Seite nur nach echtem Versand */
export function ContactPage() {
  const { lang, t } = useLang();
  const c = t.contactPage;
  const [v, setV] = useState({ name: '', company: '', email: '', subject: '', message: '', consent: false, website: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(Date.now());
  const firstError = useRef<HTMLElement | null>(null);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const validate = () => {
    const e: Partial<Record<Field, string>> = {};
    if (!v.name.trim()) e.name = c.form.errors.name;
    if (!EMAIL_RE.test(v.email.trim())) e.email = c.form.errors.email;
    if (!v.subject.trim()) e.subject = c.form.errors.subject;
    if (v.message.trim().length < 10) e.message = c.form.errors.message;
    if (!v.consent) e.consent = c.form.errors.consent;
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setFailure('');
    if (Object.keys(e).length) {
      firstError.current?.focus();
      return;
    }
    setBusy(true);
    const payload: ContactPayload = { name: v.name.trim(), company: v.company.trim(), email: v.email.trim(), subject: v.subject.trim(), message: v.message.trim(), lang, website: v.website, startedAt: startedAt.current };
    const r = await sendContact(payload);
    setBusy(false);
    if (r.ok) {
      markSent();
      navigate(paths.thanks(lang));
      return;
    }
    const msg = r.reason === 'offline' ? c.form.errors.offline : r.reason === 'not-configured' ? c.form.errors.notConfigured : c.form.errors.failed;
    setFailure(fill(msg, { email: contactData.email }));
  };

  const field = (name: Exclude<Field, 'consent'>, label: string, opts: { type?: string; optional?: boolean; textarea?: boolean; autoComplete?: string } = {}) => {
    const id = `ps-f-${name}`;
    const err = errors[name];
    const common = {
      id,
      name,
      value: v[name],
      'aria-invalid': err ? true : undefined,
      'aria-describedby': err ? `${id}-err` : undefined,
      required: !opts.optional,
      autoComplete: opts.autoComplete,
      'data-testid': `contact-${name}`,
      ref: (el: HTMLElement | null) => {
        if (err && !firstError.current) firstError.current = el;
      },
    };
    return (
      <div className={`ps-field${err ? ' has-error' : ''}`}>
        <label htmlFor={id}>
          {label} {opts.optional && <span className="ps-optional">({c.form.optional})</span>}
        </label>
        {opts.textarea ? (
          <textarea {...common} rows={6} onChange={(e) => setV({ ...v, [name]: e.target.value })} />
        ) : (
          <input {...common} type={opts.type ?? 'text'} onChange={(e) => setV({ ...v, [name]: e.target.value })} />
        )}
        {err && (
          <p className="ps-error" id={`${id}-err`} role="alert">
            {err}
          </p>
        )}
      </div>
    );
  };

  firstError.current = null;
  const rows: [string, string, 'mail' | 'tel' | null][] = [
    [c.direct.email, contactData.email, 'mail'],
    [c.direct.person, contactData.person, null],
    [c.direct.company, contactData.company, null],
    [c.direct.phone, contactData.phone, 'tel'],
    [c.direct.address, contactData.address, null],
  ];

  return (
    <SiteLayout meta={{ title: c.title, description: c.description, lang, alternates: siteAlternates('contact'), jsonLd: [organizationJsonLd(contactData.email)] }} className="ps-contact-page">
      <section className="ps-hero ps-hero-sm tone-midnight" aria-labelledby="ps-contact-title">
        <Backdrop variant="contact" />
        <div className="ps-wrap">
          <p className="ps-eyebrow ps-eyebrow-light">{c.hero.eyebrow}</p>
          <h1 id="ps-contact-title" className="ps-display ps-display-sm">
            {c.hero.title}
          </h1>
          <p className="ps-lead ps-lead-light" data-reveal="">
            {c.hero.lead}
          </p>
        </div>
      </section>

      <Section tone="white">
        <div className="ps-contact-grid">
          <Reveal className="ps-contact-direct">
            <h2 className="ps-h3">{c.direct.title}</h2>
            <dl className="ps-dl" data-testid="contact-list">
              {rows.map(([label, value, kind]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {!value ? (
                      <span className="placeholder">{c.direct.missing}</span>
                    ) : kind === 'mail' ? (
                      <a href={`mailto:${value}`}>{value}</a>
                    ) : kind === 'tel' ? (
                      <a href={`tel:${value.replace(/[^\d+]/g, '')}`}>{value}</a>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={100} className="ps-contact-form-wrap">
            <h2 className="ps-h3">{c.form.title}</h2>
            <form className="ps-form" onSubmit={(e) => void submit(e)} noValidate data-testid="contact-form">
              {field('name', c.form.name, { autoComplete: 'name' })}
              {field('company', c.form.company, { optional: true, autoComplete: 'organization' })}
              {field('email', c.form.email, { type: 'email', autoComplete: 'email' })}
              {field('subject', c.form.subject)}
              {field('message', c.form.message, { textarea: true })}
              {/* Honigtopf: für Menschen unsichtbar, Bots füllen ihn aus */}
              <div className="ps-hp" aria-hidden="true">
                <label htmlFor="ps-f-website">Website</label>
                <input id="ps-f-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} />
              </div>
              <div className={`ps-field ps-field-check${errors.consent ? ' has-error' : ''}`}>
                <label>
                  <input type="checkbox" checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} aria-invalid={errors.consent ? true : undefined} data-testid="contact-consent" />
                  <span>
                    {c.form.consent}{' '}
                    <a href={paths.privacy(lang)} target="_blank" rel="noopener">
                      {c.form.privacyLink}
                    </a>
                  </span>
                </label>
                {errors.consent && (
                  <p className="ps-error" role="alert">
                    {errors.consent}
                  </p>
                )}
              </div>
              {failure && (
                <p className="ps-error ps-error-box" role="alert" data-testid="contact-failure">
                  {failure}
                </p>
              )}
              <button type="submit" className="ps-btn ps-btn-navy ps-btn-lg" disabled={busy} data-testid="contact-submit">
                {busy ? c.form.sending : c.form.submit} <Icon name="next" size={16} />
              </button>
            </form>
          </Reveal>
        </div>
      </Section>
    </SiteLayout>
  );
}

/** Danke-Seite – nur nach erfolgreichem Versand; sonst zurück zum Formular */
export function ThanksPage() {
  const { lang, t } = useLang();
  const c = t.contactPage.thanks;
  const [allowed] = useState(() => consumeSent());
  useEffect(() => {
    if (!allowed) navigate(paths.contact(lang), true);
  }, [allowed, lang]);
  if (!allowed) return null;
  return (
    <SiteLayout meta={{ title: c.title, description: c.text, lang, alternates: siteAlternates('thanks') }}>
      <Section tone="white" className="ps-thanks">
        <SectionHead eyebrow={t.contactPage.hero.eyebrow} title={c.heading} text={c.text} align="center" level={1} id="ps-thanks-title" />
        <Reveal className="ps-actions ps-actions-center">
          <a href={paths.landing(lang)} className="ps-btn ps-btn-navy" data-testid="thanks-home">
            {c.home}
          </a>
          <a href={paths.baupad(lang)} className="ps-btn ps-btn-outline-dark">
            {c.baupad}
          </a>
        </Reveal>
      </Section>
    </SiteLayout>
  );
}
