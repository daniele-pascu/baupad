import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { deleteFormTemplate, getFormTemplateFile, listFormTemplates, saveFormTemplate } from '../lib/db';
import { analyzeForm, colLabel, FIELD_LABELS, type FieldKey, type FormField, type FormLayout, type FormPage, type FormTemplate } from '../lib/form-template';
import { uuid } from '../lib/ids';
import { REPORT_TYPES, typeInfo } from '../lib/reports';
import type { ReportType } from '../lib/types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { confirmDialog, showError, toast } from './ui';

/**
 * Eigene Firmenformulare (Konto → Firmeninformationen): PDF der Firma hochladen, BauPad erkennt die Felder,
 * der Admin prüft die Zuordnung in der Vorschau (Feld antippen → Wert wählen, verschieben, hinzufügen) und
 * speichert. Beim Export eines Berichts gibt es dann „Firmenformular“.
 */

/** Berichtstyp aus Text und Dateinamen erraten */
function guessType(page: FormPage, fileName: string): ReportType {
  const pick = (text: string): ReportType | null => {
    if (/wochenbericht|bauwoche/.test(text)) return 'woche';
    if (/tagesbericht|tagebuch|tagesrapport/.test(text)) return 'tag';
    if (/regieliste|regiebericht|regieschein|regie/.test(text)) return 'regie';
    return null;
  };
  // zuerst der Titel (größte Schrift), dann Dateiname, dann der ganze Text
  const title = [...page.texts].sort((a, b) => b.h - a.h).slice(0, 3).map((t) => t.str).join(' ').toLowerCase();
  return pick(title) ?? pick(fileName.toLowerCase()) ?? pick(page.texts.map((t) => t.str).join(' ').toLowerCase()) ?? 'tag';
}

const summary = (l: FormLayout) => {
  const n = l.fields.filter((f) => f.key).length;
  const open = l.fields.length - n;
  return `${n} ${n === 1 ? 'Feld' : 'Felder'} erkannt${open ? `, ${open} ohne Zuordnung` : ''}${l.table ? ` · Tabelle ${l.table.rows} Zeilen × ${l.table.cols.length} Spalten${l.table.weekly ? ' (Wochenblatt)' : ''}` : ''}`;
};

export function FormTemplatesSettings() {
  const [list, setList] = useState<FormTemplate[]>([]);
  const [draft, setDraft] = useState<{ t: FormTemplate; pdf: ArrayBuffer } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const reload = () => void listFormTemplates().then(setList).catch(() => setList([]));
  useEffect(reload, []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Bitte das Formular als PDF hochladen.');
      const pdf = await file.arrayBuffer();
      const { openPdf, closePdf, readFormPage } = await import('../lib/pdf');
      const doc = await openPdf(pdf);
      const page = await readFormPage(await doc.getPage(1));
      await closePdf(doc);
      if (page.texts.length < 3) throw new Error('In diesem PDF ist kein Text erkennbar (Scan?). Bitte das Original aus Word/Excel als PDF exportieren.');
      const type = guessType(page, file.name);
      const layout = analyzeForm(page, type);
      const now = Date.now();
      setDraft({ t: { id: uuid(), type, name: file.name.replace(/\.pdf$/i, ''), fileName: file.name, layout, createdAt: now, updatedAt: now }, pdf });
    } catch (e) {
      showError(e, 'Formular konnte nicht gelesen werden');
    } finally {
      setBusy(false);
    }
  };
  const edit = async (t: FormTemplate) => {
    const pdf = await getFormTemplateFile(t.id);
    if (!pdf) return showError(new Error('PDF-Datei fehlt auf diesem Gerät – bitte neu hochladen.'), 'Formular');
    setDraft({ t, pdf });
  };
  const remove = async (t: FormTemplate) => {
    if (!(await confirmDialog({ title: 'Formular entfernen', message: `„${t.name}“ wird entfernt. Berichte bleiben erhalten, nur der Export „Firmenformular“ entfällt.`, confirmLabel: 'Entfernen', danger: true }))) return;
    await deleteFormTemplate(t.id);
    reload();
  };

  return (
    <div className="form-templates" data-testid="form-templates">
      <div className="logo-settings-head">
        <div>
          <strong>Eigene Formulare</strong>
          <span className="muted">Regieliste oder Bautagesbericht deiner Firma als PDF hochladen – BauPad erkennt die Felder und füllt sie beim Export aus.</span>
        </div>
      </div>
      {list.length > 0 && (
        <ul className="form-template-list">
          {list.map((t) => (
            <li key={t.id} className="form-template-row" data-testid="form-template-row">
              <div>
                <strong>{t.name}</strong>
                <span className="muted small">
                  {typeInfo(t.type).label} · {summary(t.layout)}
                </span>
              </div>
              <div className="row gap">
                <button type="button" className="btn btn-sm" onClick={() => void edit(t)} data-testid="form-template-edit">
                  Prüfen
                </button>
                <button type="button" className="btn btn-sm btn-danger-text" onClick={() => void remove(t)} aria-label="Entfernen" data-testid="form-template-remove">
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="row gap wrap">
        <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy} data-testid="form-template-pick">
          <Icon name="upload" /> Formular hochladen (PDF)
        </button>
      </div>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} data-testid="form-template-input" />
      {draft && (
        <FormTemplateDialog
          template={draft.t}
          pdf={draft.pdf}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

const KEYS = Object.keys(FIELD_LABELS) as FieldKey[];

/** Vorschau mit erkannten Feldern: antippen, Wert wählen, verschieben, hinzufügen, Tabelle prüfen */
export function FormTemplateDialog({ template, pdf, onClose, onSaved }: { template: FormTemplate; pdf: ArrayBuffer; onClose(): void; onSaved(t: FormTemplate): void }) {
  const [layout, setLayout] = useState<FormLayout>(template.layout);
  const [name, setName] = useState(template.name);
  const [type, setType] = useState<ReportType>(template.type);
  const [img, setImg] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; bx: number; by: number } | null>(null);

  useEffect(() => {
    let url: string | null = null;
    void (async () => {
      const { openPdf, closePdf, renderPdfToCanvas, canvasToBlob } = await import('../lib/pdf');
      const doc = await openPdf(pdf);
      const canvas = await renderPdfToCanvas(await doc.getPage(1), 1600);
      url = URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.85));
      canvas.width = canvas.height = 0;
      await closePdf(doc);
      setImg(url);
    })().catch((e) => showError(e, 'Vorschau konnte nicht erzeugt werden'));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pdf]);

  /** Bildschirm-Pixel → PDF-Punkte */
  const toPt = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const k = layout.width / r.width;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  };
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const field = layout.fields.find((f) => f.id === sel) ?? null;
  const patch = (id: string, p: Partial<FormField>) => setLayout((l) => ({ ...l, fields: l.fields.map((f) => (f.id === id ? { ...f, ...p } : f)) }));

  const onDown = (e: ReactPointerEvent, f: FormField) => {
    e.stopPropagation();
    setSel(f.id);
    drag.current = { id: f.id, x: e.clientX, y: e.clientY, bx: f.box.x, by: f.box.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !wrap.current) return;
    const k = layout.width / wrap.current.getBoundingClientRect().width;
    const dx = (e.clientX - d.x) * k;
    const dy = (e.clientY - d.y) * k;
    setLayout((l) => ({
      ...l,
      fields: l.fields.map((f) => (f.id === d.id ? { ...f, box: { ...f.box, x: d.bx + dx, y: d.by + dy }, lines: f.lines?.map((b) => ({ ...b, x: b.x + (d.bx + dx - f.box.x), y: b.y + (d.by + dy - f.box.y) })) } : f)),
    }));
  };
  const onUp = () => {
    drag.current = null;
  };
  const onCanvasClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!adding || !wrap.current) {
      setSel(null);
      return;
    }
    const p = toPt(e.clientX, e.clientY);
    const f: FormField = { id: `n${Date.now()}`, key: '', label: 'Neues Feld', box: { x: p.x, y: p.y - 6, w: Math.min(140, layout.width - p.x - 4), h: 11 } };
    setLayout((l) => ({ ...l, fields: [...l.fields, f] }));
    setSel(f.id);
    setAdding(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      const t: FormTemplate = { ...template, name: name.trim() || template.name, type, layout, updatedAt: Date.now() };
      await saveFormTemplate(t, pdf);
      toast('Firmenformular gespeichert.', 'success');
      onSaved(t);
    } catch (e) {
      showError(e, 'Konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };
  const t = layout.table;

  return (
    <Modal
      title="Firmenformular prüfen"
      onClose={onClose}
      full
      testId="form-template-dialog"
      footer={
        <>
          <span className="muted small mr-auto" data-testid="form-template-summary">
            {summary(layout)}
          </span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy} data-testid="form-template-save">
            Speichern
          </button>
        </>
      }
    >
      <div className="form-tpl">
        <div className="form-tpl-stage">
          <p className="muted small">Rote Felder sind erkannt. Feld antippen, um den Wert zu ändern oder es zu verschieben. Fehlt etwas: „Feld hinzufügen“ und auf die Stelle im Formular tippen.</p>
          <div
            ref={wrap}
            className={`form-tpl-editor${adding ? ' adding' : ''}`}
            style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
            onPointerDown={onCanvasClick}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {img && <img src={img} alt="Formular" draggable={false} />}
            {layout.fields.map((f) => (
              <div key={f.id}>
                <div
                  className={`form-tpl-box${sel === f.id ? ' sel' : ''}${f.key ? '' : ' open'}`}
                  style={{ left: pct(f.box.x, layout.width), top: pct(f.box.y, layout.height), width: pct(f.box.w, layout.width), height: pct(f.box.h, layout.height) }}
                  onPointerDown={(e) => onDown(e, f)}
                  title={f.key ? FIELD_LABELS[f.key] : 'ohne Zuordnung'}
                  data-testid="form-tpl-box"
                  data-key={f.key}
                >
                  <span>{f.key ? FIELD_LABELS[f.key] : '?'}</span>
                </div>
                {f.lines?.map((b, i) => (
                  <div key={i} className={`form-tpl-box line${sel === f.id ? ' sel' : ''}`} style={{ left: pct(b.x, layout.width), top: pct(b.y, layout.height), width: pct(b.w, layout.width), height: pct(b.h, layout.height) }} />
                ))}
              </div>
            ))}
            {t &&
              Array.from({ length: t.rows }, (_, r) =>
                t.cols.map((c) => (
                  <div
                    key={`${r}-${c.key}`}
                    className="form-tpl-cell"
                    style={{ left: pct(c.x, layout.width), top: pct(t.top + r * t.rowHeight, layout.height), width: pct(c.w, layout.width), height: pct(t.rowHeight, layout.height) }}
                    title={colLabel(c.key)}
                  />
                )),
              )}
          </div>
        </div>
        <aside className="form-tpl-side">
          <label className="field">
            <span>Bezeichnung</span>
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="form-template-name" />
          </label>
          <label className="field">
            <span>Berichtstyp</span>
            <select value={type} onChange={(e) => setType(e.target.value as ReportType)} data-testid="form-template-type">
              {REPORT_TYPES.map((x) => (
                <option key={x.type} value={x.type}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <div className="row gap wrap">
            <button type="button" className={`btn btn-sm${adding ? ' btn-primary' : ''}`} onClick={() => setAdding((a) => !a)} data-testid="form-template-add">
              <Icon name="plus" size={16} /> {adding ? 'Auf das Formular tippen …' : 'Feld hinzufügen'}
            </button>
          </div>
          {field ? (
            <div className="form-tpl-field" data-testid="form-tpl-field">
              <strong>{field.label}</strong>
              <label className="field">
                <span>Wert aus BauPad</span>
                <select value={field.key} onChange={(e) => patch(field.id, { key: e.target.value as FieldKey | '' })} data-testid="form-tpl-key">
                  <option value="">– nicht ausfüllen –</option>
                  {KEYS.map((k) => (
                    <option key={k} value={k}>
                      {FIELD_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              {field.key === 'date' && (
                <label className="field">
                  <span>Datumsformat</span>
                  <select value={field.dateFormat ?? 'dd.MM.yyyy'} onChange={(e) => patch(field.id, { dateFormat: e.target.value as 'dd.MM.yyyy' | 'dd.MM.' })}>
                    <option value="dd.MM.yyyy">28.10.2026</option>
                    <option value="dd.MM.">28.10. (Jahr steht im Formular)</option>
                  </select>
                </label>
              )}
              <div className="rp-grid">
                <label className="field">
                  <span>Breite</span>
                  <input type="number" value={Math.round(field.box.w)} onChange={(e) => patch(field.id, { box: { ...field.box, w: Math.max(8, Number(e.target.value) || 8) } })} />
                </label>
                <label className="field">
                  <span>Höhe</span>
                  <input type="number" value={Math.round(field.box.h)} onChange={(e) => patch(field.id, { box: { ...field.box, h: Math.max(6, Number(e.target.value) || 6) } })} />
                </label>
              </div>
              {field.lines?.length ? <p className="muted small">{field.lines.length + 1} Schreibzeilen</p> : null}
              <button type="button" className="btn btn-sm btn-danger-text" onClick={() => setLayout((l) => ({ ...l, fields: l.fields.filter((f) => f.id !== field.id) }))} data-testid="form-tpl-remove">
                <Icon name="trash" size={16} /> Feld entfernen
              </button>
            </div>
          ) : (
            <p className="muted small">Kein Feld gewählt.</p>
          )}
          {t && (
            <div className="form-tpl-table">
              <strong>Arbeitertabelle</strong>
              <span className="muted small">
                {t.rows} Zeilen · {t.cols.map((c) => colLabel(c.key)).join(', ')}
              </span>
              <label className="field">
                <span>Zeilen</span>
                <input type="number" value={t.rows} onChange={(e) => setLayout((l) => ({ ...l, table: l.table ? { ...l.table, rows: Math.max(1, Number(e.target.value) || 1) } : null }))} data-testid="form-tpl-rows" />
              </label>
              <button type="button" className="btn btn-sm btn-danger-text" onClick={() => setLayout((l) => ({ ...l, table: null }))}>
                Tabelle nicht ausfüllen
              </button>
            </div>
          )}
          <ul className="form-tpl-list">
            {layout.fields.map((f) => (
              <li key={f.id}>
                <button type="button" className={`link-btn${sel === f.id ? ' on' : ''}`} onClick={() => setSel(f.id)}>
                  {f.label} → {f.key ? FIELD_LABELS[f.key] : '?'}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Modal>
  );
}
