import type { ReactNode } from 'react';
import { paths } from '../../lib/router';
import { useLang } from '../i18n';
import { Reveal } from './Reveal';

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const Glyph = ({ size, children }: { size: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
/** Zeichen der fünf Grundsätze (Hammer: Lucide, ISC-Lizenz) */
const VALUE_GLYPHS = [
  <path key="a" d="M12 21s-6-5.6-6-10a6 6 0 0112 0c0 4.400-6 10-6 10zM12 13a2 2 0 100-4 2 2 0 000 4z" />,
  <g key="b">
    <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
    <path d="m18 15 4-4" />
    <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
  </g>,
  <path key="c" d="M5 12.500l4.500 4.500L19 7.500" />,
  <path key="d" d="M20 12a8 8 0 11-2.300-5.700M20 4v5h-5" />,
  <path key="e" d="M5 6h14v5H5zM5 13h14v5H5zM8 8.500h.01M8 15.500h.01" />,
];

/** Zeichen der sechs Technik-Punkte – ebenfalls ohne Nummern */
const TECH_GLYPHS = [
  <path key="a" d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.500 6l-3 12" />,
  <path key="b" d="M5 5h14v6H5zM5 13h14v6H5zM8 8h.01M8 16h.01" />,
  <path key="c" d="M5 6c0-1.700 3.100-3 7-3s7 1.300 7 3-3.100 3-7 3-7-1.300-7-3zM5 6v12c0 1.700 3.100 3 7 3s7-1.300 7-3V6M5 12c0 1.700 3.100 3 7 3s7-1.300 7-3" />,
  <path key="d" d="M12 3l7 3v5c0 4.500-3 8-7 10-4-2-7-5.500-7-10V6zM9 12l2 2 4-4" />,
  <path key="e" d="M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" />,
  <path key="f" d="M20 12a8 8 0 11-2.300-5.700M20 4v5h-5" />,
];

/** „Wofür wir stehen“: fünf Grundsätze, je eine Zeile (heller Bereich) */
export function ValuesSection({ more = false }: { more?: boolean }) {
  const { lang, t } = useLang();
  const a = t.home.about;
  return (
    <section className="ph-sec ph-light" id="werte">
      <div className="ph-w">
        <Reveal className="ph-head">
          <h2 className="ph-h2">{a.title}</h2>
          {more && (
            <a href={paths.company(lang)} className="ph-more">
              {a.more} <Arrow />
            </a>
          )}
        </Reveal>
        <ul className="ph-vals">
          {a.values.map((v, i) => (
            <Reveal key={v.title} as="li" className="ph-val" delay={i * 60}>
              <i aria-hidden="true">
                <Glyph size={26}>{VALUE_GLYPHS[i]}</Glyph>
              </i>
              <h3>{v.title}</h3>
              <p>{v.text}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** „Technik, die mitwächst“: sechs Punkte mit Symbol, dazu der Hinweis ohne Zertifikats-Werbung (schwarzer Bereich) */
export function TechSection() {
  const { t } = useLang();
  const x = t.home.tech;
  return (
    <section className="ph-sec ph-black" id="technologie">
      <div className="ph-w">
        <Reveal className="ph-head">
          <h2 className="ph-h2">{x.title}</h2>
        </Reveal>
        <ul className="ph-tech">
          {x.items.map((it, i) => (
            <Reveal key={it.title} as="li" delay={(i % 3) * 60}>
              <i aria-hidden="true">
                <Glyph size={24}>{TECH_GLYPHS[i]}</Glyph>
              </i>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </Reveal>
          ))}
        </ul>
        <p className="ph-mono ph-note">{x.note}</p>
      </div>
    </section>
  );
}
