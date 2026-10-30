import type { CSSProperties, ReactNode } from 'react';
import { Reveal } from './Reveal';

export type Tone = 'white' | 'mist' | 'navy' | 'midnight';

/** Abschnitt in einer der Flächenfarben; `tight` für schmalere Innenabstände */
export function Section({ tone = 'white', id, className = '', children, label, tight, style }: { tone?: Tone; id?: string; className?: string; children: ReactNode; label?: string; tight?: boolean; style?: CSSProperties }) {
  return (
    <section id={id} className={`ps-section tone-${tone}${tight ? ' tight' : ''} ${className}`} aria-label={label} style={style}>
      <div className="ps-wrap">{children}</div>
    </section>
  );
}

/** Kopf eines Abschnitts: kleine Zeile, große Überschrift, optional Text */
export function SectionHead({ eyebrow, title, text, align = 'left', level = 2, id }: { eyebrow?: string; title: ReactNode; text?: ReactNode; align?: 'left' | 'center'; level?: 1 | 2 | 3; id?: string }) {
  const H = `h${level}` as 'h2';
  return (
    <Reveal className={`ps-head align-${align}`}>
      {eyebrow && <p className="ps-eyebrow">{eyebrow}</p>}
      <H id={id} className="ps-h2">
        {title}
      </H>
      {text && <p className="ps-lead">{text}</p>}
    </Reveal>
  );
}

/** Mehrzeilige Überschrift (Zeilen aus den Texten), Zeile für Zeile eingeblendet */
export function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <span key={i} className="ps-line" style={{ '--i': i } as CSSProperties}>
          {l}
        </span>
      ))}
    </>
  );
}

/** Kennzeichnung „Verfügbar“ / „In Planung“ / „Platzhalter“ */
export function Badge({ children, kind = 'neutral' }: { children: ReactNode; kind?: 'neutral' | 'ok' | 'plan' }) {
  return <span className={`ps-badge ps-badge-${kind}`}>{children}</span>;
}

/** Raster aus Karten gleicher Höhe; Kinder werden gestaffelt eingeblendet */
export function Grid({ children, cols = 3, className = '' }: { children: ReactNode[]; cols?: 2 | 3 | 4; className?: string }) {
  return (
    <div className={`ps-grid cols-${cols} ${className}`}>
      {children.map((c, i) => (
        <Reveal key={i} delay={i * 70} className="ps-grid-item">
          {c}
        </Reveal>
      ))}
    </div>
  );
}

/** Aussage mit Nummer, Titel und Text (Probleme, Lösungen, Nutzen) */
export function Statement({ no, title, text, icon }: { no?: string; title: string; text: string; icon?: ReactNode }) {
  return (
    <div className="ps-statement">
      {icon ? <span className="ps-statement-icon">{icon}</span> : no ? <span className="ps-no">{no}</span> : null}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
