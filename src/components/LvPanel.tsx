import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { damagesForPosition, lvDocLabel, lvDocsOf, planTitle, positionRef } from '../lib/aufmass';
import { uuid } from '../lib/ids';
import { damageNo, nextPositionNumber } from '../lib/numbering';
import { readLvFromPdf } from '../lib/lv-import';
import { parseGermanNumber, sumPositions, type ParsedLv } from '../lib/lv-parse';
import { netLength, quantityBasis, quantityFor } from '../lib/measure';
import { formatArea, formatMeasure, parseDecimal } from '../lib/numbers';
import { closePdf, openPdf } from '../lib/pdf';
import { paths } from '../lib/router';
import { newMeta, putRecord, putRecords, type ProjectState } from '../lib/store';
import type { LvDocument, LvPosition } from '../lib/types';
import { ActionMenu } from './ActionMenu';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { confirmDialog, showError, toast } from './ui';

const eur = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${formatArea(n)} €`);
const qty = (n: number | null | undefined) => (n === null || n === undefined ? '–' : formatMeasure(n));

/** Aufmaßmenge und -betrag einer Position aus den zugeordneten Messungen */
function measured(data: ProjectState, doc: LvDocument, pos: LvPosition) {
  const damages = damagesForPosition(data, positionRef(doc.id, pos.id));
  const q = quantityFor(pos.unit, damages);
  return { damages, ...q, amount: q.value !== null && pos.unitPrice !== null ? Math.round(q.value * pos.unitPrice * 100) / 100 : null };
}

/**
 * Leistungsverzeichnisse (LV) und Mehrkostenforderungen (MFK) eines Projekts:
 * Import aus PDF mit Prüfansicht, Suche, Positionsdetails und Aufmaßmengen.
 */
export function LvPanel({ data }: { data: ProjectState }) {
  const docs = lvDocsOf(data);
  // aufgeklapptes Dokument: anfangs das erste (LV vor MFK); '' = alle zugeklappt
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = docs.find((d) => d.id === activeId) ?? (activeId === null ? docs[0] : null) ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [importKind, setImportKind] = useState<'lv' | 'mfk'>('lv');
  const [review, setReview] = useState<{ parsed: ParsedLv; fileName: string; kind: 'lv' | 'mfk' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [docDialog, setDocDialog] = useState<{ doc: LvDocument | null; kind: 'lv' | 'mfk' } | null>(null);

  const startImport = (kind: 'lv' | 'mfk') => {
    setImportKind(kind);
    fileRef.current?.click();
  };

  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const doc = await openPdf(await f.arrayBuffer());
      try {
        const parsed = await readLvFromPdf(doc);
        if (!parsed.positions.length) throw new Error('Im PDF wurden keine Leistungspositionen erkannt. Bitte ein LV im ÖNORM-Format (Positionsnummer, Menge, Einheit) verwenden oder die Positionen manuell anlegen.');
        setReview({ parsed, fileName: f.name, kind: importKind });
      } finally {
        void closePdf(doc);
      }
    } catch (e) {
      showError(e, 'LV konnte nicht gelesen werden');
    } finally {
      setBusy(false);
    }
  };

  const removeDoc = async (doc: LvDocument) => {
    const refs = new Set(doc.positions.map((p) => positionRef(doc.id, p.id)));
    const linked = Object.values(data.damages).filter((d) => !d.deletedAt && d.positionRef && refs.has(d.positionRef));
    const ok = await confirmDialog({
      title: `${lvDocLabel(doc)} löschen?`,
      message: (
        <p>
          Das Dokument mit {doc.positions.length} Position(en) wird gelöscht.
          {linked.length > 0 && ` ${linked.length} Messung(en) bleiben erhalten, verlieren aber die Leistungszuordnung.`}
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    putRecords({ lvDocs: [{ ...doc, deletedAt: Date.now() }], damages: linked.map((d) => ({ ...d, positionRef: null })) });
    setActiveId(null);
    toast('Dokument gelöscht.');
  };

  return (
    <div className="lv-panel" data-testid="lv-panel">
      <div className="lv-toolbar">
        <div className="row gap wrap">
          <button type="button" className="btn btn-sm" onClick={() => startImport('lv')} disabled={busy} data-testid="lv-import">
            <Icon name="upload" size={18} /> LV importieren (PDF)
          </button>
          <button type="button" className="btn btn-sm" onClick={() => startImport('mfk')} disabled={busy} data-testid="mfk-import">
            <Icon name="upload" size={18} /> MFK importieren (PDF)
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setDocDialog({ doc: null, kind: docs.some((d) => d.kind === 'lv') ? 'mfk' : 'lv' })} data-testid="lv-new">
            <Icon name="plus" size={18} /> Manuell anlegen
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          data-testid="lv-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onFile(f);
          }}
        />
      </div>
      {busy && <p className="muted">PDF wird gelesen …</p>}
      {!docs.length && !busy && (
        <div className="empty">
          <p>Noch kein Leistungsverzeichnis.</p>
          <p className="muted">Importieren Sie ein LV oder eine MFK als PDF (ÖNORM-Ausdruck mit Positionsnummern) oder legen Sie eine MFK manuell an.</p>
        </div>
      )}
      {docs.length > 0 && (
        <ul className="lv-doc-list" aria-label="Dokumente">
          {docs.map((d) => {
            const open = active?.id === d.id;
            return (
              <li key={d.id} className={`lv-doc-item card${open ? ' open' : ''}`}>
                <button type="button" className="lv-doc-row" aria-expanded={open} onClick={() => setActiveId(open ? '' : d.id)} data-testid="lv-doc-tab">
                  <span className={`lv-kind lv-kind-${d.kind}`}>{d.kind === 'lv' ? 'LV' : 'MFK'}</span>
                  <span className="lv-doc-name">{[d.number, d.name].filter(Boolean).join(' – ') || lvDocLabel(d)}</span>
                  <span className="lv-doc-meta muted small">
                    {d.positions.length} Pos. · {eur(sumPositions(d.positions))}
                  </span>
                  <Icon name={open ? 'minus' : 'plus'} size={18} />
                </button>
                {open && <LvDocView data={data} doc={d} onEdit={() => setDocDialog({ doc: d, kind: d.kind })} onDelete={() => void removeDoc(d)} />}
              </li>
            );
          })}
        </ul>
      )}
      {review && (
        <LvReviewDialog
          review={review}
          onCancel={() => setReview(null)}
          onSave={(doc) => {
            putRecord('lvDocs', { ...doc, projectId: data.project.id });
            setActiveId(doc.id);
            setReview(null);
            toast(`${lvDocLabel(doc)} mit ${doc.positions.length} Positionen übernommen.`, 'success');
          }}
        />
      )}
      {docDialog && (
        <DocDialog
          data={data}
          doc={docDialog.doc}
          kind={docDialog.kind}
          onClose={() => setDocDialog(null)}
          onSaved={(id) => {
            setActiveId(id);
            setDocDialog(null);
          }}
        />
      )}
    </div>
  );
}

/** Prüfansicht nach dem Import: Summenkontrolle, unsichere Angaben, Bezeichnung. */
function LvReviewDialog({
  review,
  onCancel,
  onSave,
}: {
  review: { parsed: ParsedLv; fileName: string; kind: 'lv' | 'mfk' };
  onCancel: () => void;
  onSave: (doc: LvDocument) => void;
}) {
  const { parsed } = review;
  // als MFK erkannt (z. B. „M1-003.MFK …“) → Art und MFK-Nummer vorbelegt
  const [kind, setKind] = useState(parsed.kind ?? review.kind);
  // „M1-003.MFK Tiefgarage …“ → Bezeichnung „Tiefgarage …“ (die Nummer steht im eigenen Feld)
  const [name, setName] = useState(() => {
    const title = parsed.title || review.fileName.replace(/\.pdf$/i, '');
    const short = parsed.number ? title.replace(new RegExp(`^${parsed.number}\\.?\\s*M(?:FK|KF)\\b[\\s\\-–]*`, 'i'), '').trim() : title;
    return short || title;
  });
  const [number, setNumber] = useState(parsed.number ?? '');
  const total = sumPositions(parsed.positions);
  const flagged = parsed.positions.filter((p) => p.issues.length);
  // Summenkontrolle je Gruppe (mit direkt darunter liegenden Positionen) gegen die im Dokument ausgewiesenen Summen
  const checks = Object.entries(parsed.groupSums)
    .filter(([g]) => parsed.positions.some((p) => p.group === g))
    .map(([g, sum]) => ({ group: g, sum, found: sumPositions(parsed.positions.filter((p) => p.group === g)) }));
  const mismatches = checks.filter((c) => Math.abs(c.sum - c.found) > 0.05);
  // Gesamtsumme laut Dokument (Kurz-LV „SUMME:“); je Position bis zu 0,5 Cent Rundung
  const totalOff = parsed.total != null && Math.abs(parsed.total - total) > Math.max(0.05, parsed.positions.length * 0.005);
  return (
    <Modal
      title="LV prüfen und übernehmen"
      onClose={onCancel}
      persistent
      wide
      testId="lv-review"
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                ...newMeta(),
                projectId: '',
                kind,
                name: name.trim(),
                number: number.trim(),
                fileName: review.fileName,
                groups: parsed.groups,
                positions: parsed.positions.map((p) => ({ ...p, id: uuid() })),
              })
            }
            data-testid="lv-review-save"
          >
            Übernehmen
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>Art</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'lv' | 'mfk')} data-testid="lv-kind">
            <option value="lv">Leistungsverzeichnis (LV)</option>
            <option value="mfk">Mehrkostenforderung (MFK)</option>
          </select>
        </label>
        <label className="field">
          <span>{kind === 'mfk' ? 'MFK-Nummer' : 'Nummer (optional)'}</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} data-testid="lv-number" />
        </label>
        <label className="field span-2">
          <span>Bezeichnung *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="lv-name" />
        </label>
      </div>
      <div className={`banner ${mismatches.length || flagged.length || totalOff ? 'banner-warn' : 'banner-info'}`} data-testid="lv-review-summary">
        <p>
          <strong>{parsed.positions.length} Positionen</strong> erkannt · Summe der Positionspreise <strong>{eur(total)}</strong> (netto, ohne
          Nachlass/USt.)
        </p>
        {checks.length > 0 && (
          <p>
            {mismatches.length
              ? `Summenkontrolle: ${mismatches.length} von ${checks.length} Gruppensummen weichen ab (${mismatches.map((m) => m.group).join(', ')}).`
              : `Summenkontrolle: alle ${checks.length} Gruppensummen stimmen mit dem Dokument überein.`}
          </p>
        )}
        {parsed.total != null && (
          <p data-testid="lv-total-check">
            {totalOff
              ? `Summenkontrolle: Summe laut Dokument ${eur(parsed.total)} weicht ab – bitte prüfen, ob alle Positionen erkannt wurden.`
              : `Summenkontrolle: Summe stimmt mit dem Dokument überein (${eur(parsed.total)}).`}
          </p>
        )}
        {flagged.length > 0 && <p>{flagged.length} Position(en) mit unsicheren Angaben – bitte nach dem Übernehmen prüfen (markiert).</p>}
      </div>
      <div className="table-wrap lv-review-table">
        <table className="aufmass-table">
          <thead>
            <tr>
              <th>Pos.-Nr.</th>
              <th>Kurztext</th>
              <th className="num">Menge</th>
              <th>EH</th>
              <th className="num">EP</th>
              <th className="num">GP</th>
            </tr>
          </thead>
          <tbody>
            {parsed.positions.map((p) => (
              <tr key={p.number} className={p.issues.length ? 'lv-flagged' : ''} title={p.issues.join(' · ') || undefined}>
                <td className="nowrap">{p.number}</td>
                <td className="lv-text">
                  {p.shortText}
                  {p.issues.length > 0 && <small className="error"> ⚠ {p.issues.join(' · ')}</small>}
                </td>
                <td className="num">{qty(p.quantity)}</td>
                <td>{p.unit || '–'}</td>
                <td className="num">{eur(p.unitPrice)}</td>
                <td className="num">{eur(p.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Ansicht eines LV bzw. einer MFK: Suche, Gruppen, Positionen mit Aufmaßmengen. */
function LvDocView({ data, doc, onEdit, onDelete }: { data: ProjectState; doc: LvDocument; onEdit: () => void; onDelete: () => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<LvPosition | 'new' | null>(null);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      doc.positions
        .filter((p) => !q || `${p.number} ${p.shortText} ${p.longText}`.toLowerCase().includes(q))
        .map((p) => ({ pos: p, m: measured(data, doc, p) })),
    [doc, q, data],
  );
  const groupTitle = (g: string) => doc.groups.find((x) => x.number === g)?.title ?? '';
  const lvTotal = sumPositions(doc.positions);
  const measuredTotal = Math.round(rows.reduce((s, r) => s + (r.m.amount ?? 0), 0) * 100) / 100;
  const flagged = doc.positions.filter((p) => p.issues.length).length;

  return (
    <section className="lv-doc" data-testid="lv-doc">
      <div className="lv-doc-head">
        <div>
          <h3 className="sr-only" data-testid="lv-doc-title">
            {lvDocLabel(doc)}
          </h3>
          <p className="muted small">
            {doc.positions.length} Positionen · LV-Summe {eur(lvTotal)} · Aufmaß {query ? '(Auswahl) ' : ''}
            <span data-testid="lv-measured-total">{eur(measuredTotal)}</span>
            {doc.fileName && ` · Quelle: ${doc.fileName}`}
          </p>
          {flagged > 0 && (
            <p className="small error" data-testid="lv-flagged">
              ⚠ {flagged} Position(en) mit unsicheren Angaben – bitte prüfen und bestätigen.
            </p>
          )}
        </div>
        <ActionMenu
          label={`Aktionen für ${lvDocLabel(doc)}`}
          testId="lv-doc-actions"
          actions={[
            { label: 'Position hinzufügen', icon: 'plus', onSelect: () => setEditing('new'), testId: 'lv-add-position' },
            { label: doc.fileName ? 'Bezeichnung bearbeiten' : 'Positionen bearbeiten', icon: 'edit', onSelect: onEdit, testId: 'lv-doc-edit' },
            { label: 'Dokument löschen', icon: 'trash', danger: true, onSelect: onDelete, testId: 'lv-delete' },
          ]}
        />
      </div>
      <input
        type="search"
        className="lv-search"
        placeholder="Suchen: Positionsnummer oder Text, z. B. „Sperrfläche“"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="lv-search"
      />
      <div className="table-wrap">
        <table className="aufmass-table lv-table" data-testid="lv-table">
          <thead>
            <tr>
              <th>Pos.-Nr.</th>
              <th>Kurztext</th>
              <th>EH</th>
              <th className="num">LV-Menge</th>
              <th className="num">Aufmaß</th>
              <th className="num hide-sm">EP</th>
              <th className="num hide-sm">GP Aufmaß</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pos, m }, i) => {
              const showGroup = i === 0 || rows[i - 1].pos.group !== pos.group;
              const isOpen = open === pos.id;
              return (
                <Fragment key={pos.id}>
                  {showGroup && pos.group && (
                    <tr className="lv-group">
                      <td colSpan={7}>
                        {pos.group} {groupTitle(pos.group)}
                      </td>
                    </tr>
                  )}
                  <tr
                    className={`${isOpen ? 'selected' : ''}${pos.issues.length ? ' lv-flagged' : ''}`}
                    onClick={() => setOpen(isOpen ? null : pos.id)}
                    data-testid="lv-row"
                    data-number={pos.number}
                  >
                    <td className="nowrap">{pos.number}</td>
                    <td className="lv-text">
                      {pos.shortText}
                      {pos.issues.length > 0 && <span className="lv-warn" title={pos.issues.join(' · ')}> ⚠</span>}
                    </td>
                    <td>{pos.unit}</td>
                    <td className="num">{qty(pos.quantity)}</td>
                    <td className="num" data-testid="lv-measured">
                      {m.damages.length ? (m.value !== null ? qty(m.value) : `${m.damages.length} Mess.`) : '–'}
                    </td>
                    <td className="num hide-sm">{eur(pos.unitPrice)}</td>
                    <td className="num hide-sm">{m.amount !== null && m.damages.length ? eur(m.amount) : '–'}</td>
                  </tr>
                  {isOpen && (
                    <tr className="lv-detail">
                      <td colSpan={7}>
                        {pos.issues.length > 0 && <p className="error small">⚠ {pos.issues.join(' · ')}</p>}
                        {pos.longText && <p className="pre lv-longtext">{pos.longText}</p>}
                        <p className="small muted">
                          LV: {qty(pos.quantity)} {pos.unit} × {eur(pos.unitPrice)} = {eur(pos.totalPrice)}
                          {!quantityBasis(pos.unit) && ' · Einheit nicht aus Messungen ableitbar (Menge manuell)'}
                          {m.missing > 0 && ` · ${m.missing} Messung(en) ohne passende Größe (z. B. Linie bei m²) nicht mitgezählt`}
                        </p>
                        {m.damages.length > 0 ? (
                          <ul className="lv-measures">
                            {m.damages.map((d) => {
                              const plan = data.plans[d.planId];
                              return (
                                <li key={d.id}>
                                  <a href={paths.plan(data.project.id, d.planId, d.id)}>
                                    {plan ? planTitle(plan) : 'Plan'} · Nr. {damageNo(d)}
                                  </a>{' '}
                                  <span className="muted">
                                    {formatMeasure(netLength(d))} m{d.area !== null ? ` · ${formatArea(d.area)} m²` : ''}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="small muted">Noch keine Messungen zugeordnet (Zuordnung im Messdialog des Plans).</p>
                        )}
                        <button type="button" className="btn btn-sm" onClick={() => setEditing(pos)} data-testid="lv-edit-position">
                          <Icon name="edit" size={18} /> {pos.issues.length ? 'Prüfen und bestätigen' : 'Bearbeiten'}
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="muted empty-cell">
                  {query ? 'Keine Position gefunden.' : 'Noch keine Positionen.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <PositionDialog
          position={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            const exists = doc.positions.some((x) => x.id === p.id);
            putRecord('lvDocs', { ...doc, positions: exists ? doc.positions.map((x) => (x.id === p.id ? p : x)) : [...doc.positions, p] });
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

/** Position anlegen bzw. prüfen/korrigieren (Hinweise werden damit bestätigt). */
function PositionDialog({ position, onClose, onSave }: { position: LvPosition | null; onClose: () => void; onSave: (p: LvPosition) => void }) {
  const [v, setV] = useState({
    number: position?.number ?? '',
    shortText: position?.shortText ?? '',
    longText: position?.longText ?? '',
    unit: position?.unit ?? '',
    quantity: position?.quantity !== null && position?.quantity !== undefined ? String(position.quantity).replace('.', ',') : '',
    unitPrice: position?.unitPrice !== null && position?.unitPrice !== undefined ? String(position.unitPrice).replace('.', ',') : '',
    group: position?.group ?? '',
  });
  const [show, setShow] = useState(false);
  const q = v.quantity.trim() ? parseDecimal(v.quantity) : null;
  const ep = v.unitPrice.trim() ? parseDecimal(v.unitPrice) : null;
  const error = !v.number.trim()
    ? 'Bitte eine Positionsnummer eingeben.'
    : !v.shortText.trim()
      ? 'Bitte einen Kurztext eingeben.'
      : (v.quantity.trim() && q === null) || (v.unitPrice.trim() && ep === null)
        ? 'Menge und Einheitspreis bitte als Zahl eingeben (z. B. 1 234,50).'
        : null;
  const submit = () => {
    setShow(true);
    if (error) return;
    onSave({
      id: position?.id ?? uuid(),
      number: v.number.trim(),
      shortText: v.shortText.trim(),
      longText: v.longText.trim(),
      unit: v.unit.trim(),
      quantity: q,
      unitPrice: ep,
      totalPrice: q !== null && ep !== null ? Math.round(q * ep * 100) / 100 : null,
      group: v.group.trim(),
      issues: [], // geprüft und bestätigt
    });
  };
  const field = (k: keyof typeof v, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-testid={`pos-${k}`} {...extra} />
    </label>
  );
  return (
    <Modal
      title={position ? `Position ${position.number}` : 'Position hinzufügen'}
      onClose={onClose}
      persistent
      testId="position-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} data-testid="pos-save">
            {position?.issues.length ? 'Geprüft – speichern' : 'Speichern'}
          </button>
        </>
      }
    >
      {position && position.issues.length > 0 && <div className="banner banner-warn">⚠ {position.issues.join(' · ')}</div>}
      <div className="form-grid">
        {field('number', 'Positionsnummer *')}
        {field('group', 'Gruppe (z. B. 92 01)')}
        <label className="field span-2">
          <span>Kurztext *</span>
          <input value={v.shortText} onChange={(e) => setV({ ...v, shortText: e.target.value })} data-testid="pos-shortText" />
        </label>
        {field('quantity', 'Menge laut LV', { inputMode: 'decimal' })}
        {field('unit', 'Einheit (m, m², Stk …)')}
        {field('unitPrice', 'Einheitspreis (EUR)', { inputMode: 'decimal' })}
        <label className="field span-2">
          <span>Langtext</span>
          <textarea value={v.longText} onChange={(e) => setV({ ...v, longText: e.target.value })} rows={4} />
        </label>
      </div>
      {show && error && <p className="error">{error}</p>}
    </Modal>
  );
}

/** Preis/Zahl: „12,5“, „12.5“, „1 234,50“ oder „1.234,50“ */
const parsePrice = (s: string) => (s.trim() ? (parseDecimal(s) ?? parseGermanNumber(s.trim())) : null);
const priceText = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

type GridRow = { id: string; number: string; shortText: string; unit: string; unitPrice: string };
const GRID_COLS = ['number', 'shortText', 'unit', 'unitPrice'] as const;
const emptyRow = (number = ''): GridRow => ({ id: uuid(), number, shortText: '', unit: '', unitPrice: '' });

/**
 * LV/MFK manuell anlegen bzw. bearbeiten: Art, Nummer, Bezeichnung und – bei selbst angelegten Dokumenten –
 * die Positionen als Tabelle (Pos.-Nr. | Positionstext | Einheit | Preis pro Einheit). Enter springt in die
 * nächste Zeile; am Ende kommt eine neue Zeile mit der nächsten Nummer dazu. Importierte Dokumente: nur Bezeichnung.
 */
function DocDialog({
  data,
  doc,
  kind,
  onClose,
  onSaved,
}: {
  data: ProjectState;
  doc: LvDocument | null;
  kind: 'lv' | 'mfk';
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [k, setK] = useState(doc?.kind ?? kind);
  const [name, setName] = useState(doc?.name ?? '');
  const [number, setNumber] = useState(doc?.number ?? '');
  const withGrid = !doc || !doc.fileName;
  const [rows, setRows] = useState<GridRow[]>(() => {
    const list = (doc?.positions ?? []).map((p) => ({ id: p.id, number: p.number, shortText: p.shortText, unit: p.unit, unitPrice: priceText(p.unitPrice) }));
    return [...list, emptyRow(list.length ? nextPositionNumber(list[list.length - 1].number) : '1')];
  });
  const [show, setShow] = useState(false);
  const cells = useRef(new Map<string, HTMLInputElement>());
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  useEffect(() => {
    if (!focus) return;
    cells.current.get(`${focus.row}:${focus.col}`)?.focus();
    setFocus(null);
  }, [focus, rows.length]);

  // nur die (vorgeschlagene) Nummer allein zählt nicht als Position
  const filled = (r: GridRow) => !!(r.shortText.trim() || r.unit.trim() || r.unitPrice.trim());
  const used = rows.filter(filled);
  const rowError = (r: GridRow): string | null => {
    if (!filled(r)) return null;
    if (!r.number.trim()) return 'Pos.-Nr. fehlt';
    if (!r.shortText.trim()) return 'Positionstext fehlt';
    if (r.unitPrice.trim() && parsePrice(r.unitPrice) === null) return 'Preis bitte als Zahl (z. B. 12,50)';
    if (used.filter((x) => x.number.trim() === r.number.trim()).length > 1) return 'Pos.-Nr. doppelt';
    return null;
  };
  const errors = withGrid ? rows.map(rowError) : [];
  const invalid = !name.trim() || errors.some(Boolean);

  const update = (i: number, key: keyof GridRow, value: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const onKey = (i: number, col: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const r = rows[i];
    if (i === rows.length - 1) {
      if (!filled(r)) return;
      const next = nextPositionNumber(r.number);
      setRows((rs) => [...rs, emptyRow(next)]);
      setFocus({ row: i + 1, col: next ? 1 : 0 }); // Nummer vorgeschlagen → gleich den Text eingeben
    } else setFocus({ row: i + 1, col: col === 0 ? 0 : 1 });
  };
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [emptyRow('1')]));

  const save = async () => {
    setShow(true);
    if (invalid) return;
    const base = new Map((doc?.positions ?? []).map((p) => [p.id, p]));
    const positions: LvPosition[] = withGrid
      ? used.map((r) => {
          const old = base.get(r.id);
          const ep = parsePrice(r.unitPrice);
          return {
            id: r.id,
            number: r.number.trim(),
            shortText: r.shortText.trim(),
            longText: old?.longText ?? '',
            unit: r.unit.trim(),
            quantity: old?.quantity ?? null,
            unitPrice: ep,
            totalPrice: old?.quantity != null && ep !== null ? Math.round(old.quantity * ep * 100) / 100 : null,
            group: old?.group ?? '',
            issues: [],
          };
        })
      : (doc?.positions ?? []);
    // entfernte Positionen: zugeordnete Messungen bleiben, verlieren nur die Zuordnung (mit Rückfrage)
    const kept = new Set(positions.map((p) => p.id));
    const removedRefs = doc ? new Set(doc.positions.filter((p) => !kept.has(p.id)).map((p) => positionRef(doc.id, p.id))) : new Set<string>();
    const linked = Object.values(data.damages).filter((d) => !d.deletedAt && d.positionRef && removedRefs.has(d.positionRef));
    if (linked.length) {
      const ok = await confirmDialog({
        title: 'Positionen entfernen?',
        message: <p>{linked.length} Messung(en) sind entfernten Positionen zugeordnet. Sie bleiben erhalten, verlieren aber die Leistungszuordnung.</p>,
        confirmLabel: 'Entfernen',
        danger: true,
      });
      if (!ok) return;
    }
    const rec: LvDocument = doc
      ? { ...doc, kind: k, name: name.trim(), number: number.trim(), positions }
      : { ...newMeta(), projectId: data.project.id, kind: k, name: name.trim(), number: number.trim(), fileName: '', groups: [], positions };
    putRecords({ lvDocs: [rec], damages: linked.map((d) => ({ ...d, positionRef: null })) });
    onSaved(rec.id);
  };

  return (
    <Modal
      title={doc ? (withGrid ? `${lvDocLabel(doc)} bearbeiten` : 'Bezeichnung bearbeiten') : 'LV oder MFK anlegen'}
      onClose={onClose}
      persistent
      wide={withGrid}
      testId="lv-doc-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!name.trim()} data-testid="lv-doc-save">
            {withGrid ? `Speichern (${used.length} Pos.)` : 'Speichern'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>Art</span>
          <select value={k} onChange={(e) => setK(e.target.value as 'lv' | 'mfk')} data-testid="lv-doc-kind">
            <option value="lv">Leistungsverzeichnis (LV)</option>
            <option value="mfk">Mehrkostenforderung (MFK)</option>
          </select>
        </label>
        <label className="field">
          <span>{k === 'mfk' ? 'MFK-Nummer' : 'Nummer (optional)'}</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} data-testid="lv-doc-number" />
        </label>
        <label className="field span-2">
          <span>Bezeichnung *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // Enter → in die erste Tabellenzeile
              if (e.key === 'Enter' && withGrid && !e.nativeEvent.isComposing) {
                e.preventDefault();
                setFocus({ row: 0, col: rows[0].number ? 1 : 0 });
              }
            }}
            enterKeyHint={withGrid ? 'next' : undefined}
            data-autofocus
            data-testid="lv-doc-name"
          />
        </label>
      </div>
      {withGrid && (
        <>
          <p className="muted small lv-grid-hint">Positionen eintragen – Enter springt in die nächste Zeile, eine neue Zeile bekommt die nächste Nummer.</p>
          <div className="table-wrap lv-grid-wrap">
            <table className="lv-grid" data-testid="lv-grid">
              <thead>
                <tr>
                  <th>Pos.-Nr.</th>
                  <th>Positionstext</th>
                  <th>Einheit</th>
                  <th className="num">Preis / Einheit (€)</th>
                  <th aria-label="Entfernen" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Fragment key={r.id}>
                    <tr className={show && errors[i] ? 'invalid' : undefined} data-testid="lv-grid-row">
                      {GRID_COLS.map((key, col) => (
                        <td key={key} className={key === 'unitPrice' ? 'num' : undefined}>
                          <input
                            ref={(el) => {
                              if (el) cells.current.set(`${i}:${col}`, el);
                              else cells.current.delete(`${i}:${col}`);
                            }}
                            value={r[key]}
                            onChange={(e) => update(i, key, e.target.value)}
                            onKeyDown={onKey(i, col)}
                            list={key === 'unit' ? 'lv-units' : undefined}
                            inputMode={key === 'unitPrice' ? 'decimal' : undefined}
                            enterKeyHint="next"
                            placeholder={['Nr.', 'Positionstext', 'Einheit', 'Preis €'][col]}
                            aria-label={`${['Pos.-Nr.', 'Positionstext', 'Einheit', 'Preis pro Einheit'][col]} Zeile ${i + 1}`}
                            data-testid={`grid-${key}`}
                          />
                        </td>
                      ))}
                      <td>
                        <button type="button" className="icon-btn" onClick={() => removeRow(i)} aria-label={`Zeile ${i + 1} entfernen`} data-testid="grid-remove">
                          <Icon name="close" size={16} />
                        </button>
                      </td>
                    </tr>
                    {show && errors[i] && (
                      <tr className="lv-grid-error">
                        <td colSpan={5} className="error small">
                          Zeile {i + 1}: {errors[i]}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="lv-units">
            {['m', 'm²', 'm³', 'Stk', 'PA', 'kg', 't', 'l', 'h', 'Wo', 'd', 'lfm'].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const last = rows[rows.length - 1];
              setRows((rs) => [...rs, emptyRow(nextPositionNumber(last.number))]);
              setFocus({ row: rows.length, col: 0 });
            }}
            data-testid="grid-add"
          >
            <Icon name="plus" size={18} /> Zeile hinzufügen
          </button>
        </>
      )}
      {show && !name.trim() && <p className="error">Bitte eine Bezeichnung eingeben.</p>}
    </Modal>
  );
}
