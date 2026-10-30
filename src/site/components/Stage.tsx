import type { CSSProperties } from 'react';
import { ToolIcon } from '../../components/ToolIcon';
import { TOOL_ENTRIES } from '../products';
import { Badge } from './Section';

export type PanelKind = 'tools' | 'plan' | 'week' | 'photos' | 'report' | 'defects';

/**
 * Schematische Software-Panels (Platzhalter). Sie zeigen Aufbau und Tiefe der Präsentation, aber keine echte
 * BauPad-Oberfläche – jedes Panel trägt deshalb die Kennzeichnung. Sobald echte Bildschirmfotos vorliegen,
 * wird `image` gesetzt und das Bild ersetzt die Skizze ohne Umbau.
 */
export function Panel({ kind, label, image, alt = '', className = '', style, placeholderLabel }: { kind: PanelKind; label?: string; image?: string; alt?: string; className?: string; style?: CSSProperties; placeholderLabel: string }) {
  return (
    <figure className={`ps-panel kind-${kind} ${className}`} style={style} aria-label={label}>
      <span className="ps-panel-bar" aria-hidden="true">
        <i />
        <i />
        <i />
        {label && <em>{label}</em>}
      </span>
      {image ? (
        <img src={image} alt={alt} loading="lazy" />
      ) : (
        <div className="ps-panel-body" aria-hidden="true">
          <Sketch kind={kind} />
          <span className="ps-panel-tag">{placeholderLabel}</span>
        </div>
      )}
    </figure>
  );
}

/** Skizzen aus Flächen und Linien – bewusst abstrakt */
function Sketch({ kind }: { kind: PanelKind }) {
  if (kind === 'tools')
    return (
      <div className="sk sk-tools">
        {TOOL_ENTRIES.map((t) => (
          <span key={t.id} className="sk-tile" style={{ '--c': t.color } as CSSProperties}>
            <i>
              <ToolIcon name={t.icon} size={16} />
            </i>
            <b />
            <s />
          </span>
        ))}
      </div>
    );
  if (kind === 'plan')
    return (
      <div className="sk sk-plan">
        <div className="sk-canvas">
          <span className="sk-grid" />
          <span className="sk-shape a" />
          <span className="sk-shape b" />
          <span className="sk-shape c" />
          <span className="sk-pin p1">1</span>
          <span className="sk-pin p2">2</span>
          <span className="sk-pin p3">3</span>
        </div>
        <div className="sk-side">
          <b />
          <s />
          <s />
          <s />
          <s className="sum" />
        </div>
      </div>
    );
  if (kind === 'week')
    return (
      <div className="sk sk-week">
        <div className="sk-days">
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <span key={d} />
          ))}
        </div>
        {[0, 1, 2].map((r) => (
          <div key={r} className="sk-row">
            <b />
            {[0, 1, 2, 3, 4].map((d) => (
              <span key={d} className={`chip c${(r + d) % 3}`} />
            ))}
          </div>
        ))}
      </div>
    );
  if (kind === 'photos')
    return (
      <div className="sk sk-photos">
        <b />
        <div className="sk-thumbs">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <span key={i} className={`t${i % 4}`} />
          ))}
        </div>
      </div>
    );
  if (kind === 'report')
    return (
      <div className="sk sk-report">
        <b />
        <div className="sk-fields">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} />
          ))}
        </div>
        <div className="sk-table">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} />
          ))}
        </div>
      </div>
    );
  return (
    <div className="sk sk-plan sk-defects">
      <div className="sk-canvas">
        <span className="sk-grid" />
        <span className="sk-pin red p1">1</span>
        <span className="sk-pin blue p2">2</span>
        <span className="sk-shape ring" />
      </div>
      <div className="sk-side">
        <b />
        <s />
        <s />
        <s />
      </div>
    </div>
  );
}

/**
 * Bühne: ein großes Panel mit zwei schwebenden kleineren – räumliche Tiefe durch Versatz, Schatten und
 * langsames Schweben. Auf dem Handy stapeln sich die Panels.
 */
export function Stage({ main, floats, placeholderLabel, floatLabel, note, labels, immediate }: { main: PanelKind; floats: PanelKind[]; placeholderLabel: string; floatLabel?: string; note?: string; labels: string[]; immediate?: boolean }) {
  return (
    <div className="ps-stage" data-reveal="" data-immediate={immediate ? '' : undefined}>
      <Panel kind={main} label={labels[0]} className="ps-stage-main" placeholderLabel={placeholderLabel} />
      {floats.slice(0, 2).map((k, i) => (
        <Panel key={k} kind={k} label={labels[i + 1]} className={`ps-stage-float f${i + 1}`} placeholderLabel={floatLabel ?? placeholderLabel} />
      ))}
      {note && (
        <p className="ps-stage-note">
          <Badge kind="neutral">{note}</Badge>
        </p>
      )}
    </div>
  );
}
