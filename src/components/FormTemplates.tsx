import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { deleteFormTemplate, getFormTemplateFile, listFormTemplates, saveFormTemplate } from '../lib/db';
import { analyzeForm, colLabel, FIELD_LABELS, type FieldKey, type FormField, type FormLayout, type FormPage, type FormTemplate } from '../lib/form-template';
import { uuid } from '../lib/ids';
import { REPORT_TYPES, typeInfo } from '../lib/reports';
import type { ReportType } from '../lib/types';
import { Icon } from './Icon';
import { inkCss, justifyCss, NumInput, readLastStyle, rememberStyle, StylePanel, usePdfZoom, type TextStyle } from './FormStyle';
import { textBoxHeight } from '../lib/forms';
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
  const reload = () => void listFormTemplates().then((l) => setList(l.filter((t) => !t.kind))).catch(() => setList([]));
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
  const [tableSel, setTableSel] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pxPerPt, setPxPerPt] = useState(1);
  const z = usePdfZoom();
  const wrap = z.stage;
  /** Ziehen: verschieben, Länge (rechte Leiste), neues Feld zeichnen */
  const drag = useRef<{ kind: 'move' | 'resize' | 'draw'; id: string; x: number; y: number; box: FormField['box']; lines?: FormField['lines'] } | null>(null);
  z.onPinchStart.current = () => {
    const d = drag.current;
    if (d?.kind === 'draw') setLayout((l) => ({ ...l, fields: l.fields.filter((f) => f.id !== d.id || f.box.w >= 8) }));
    drag.current = null;
  };

  useEffect(() => {
    let url: string | null = null;
    void (async () => {
      const { openPdf, closePdf, renderPdfToCanvas, canvasToBlob } = await import('../lib/pdf');
      const doc = await openPdf(pdf);
      const canvas = await renderPdfToCanvas(await doc.getPage(1), 1800);
      url = URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.85));
      canvas.width = canvas.height = 0;
      await closePdf(doc);
      setImg(url);
    })().catch((e) => showError(e, 'Vorschau konnte nicht erzeugt werden'));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pdf]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPxPerPt(el.getBoundingClientRect().width / layout.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width, img, wrap]);

  /** Bildschirm-Pixel → PDF-Punkte */
  const toPt = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const k = layout.width / r.width;
    return { x: Math.max(0, Math.min(layout.width, (clientX - r.left) * k)), y: Math.max(0, Math.min(layout.height, (clientY - r.top) * k)) };
  };
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const field = layout.fields.find((f) => f.id === sel) ?? null;
  const patch = (id: string, p: Partial<FormField>) => {
    setLayout((l) => ({ ...l, fields: l.fields.map((f) => (f.id === id ? { ...f, ...p } : f)) }));
    rememberStyle(p);
  };
  /** Schriftgröße: Kasten wächst nach oben, die Schreiblinie bleibt (nur einzeilige Felder) */
  const setStyle = (f: FormField, p: Partial<TextStyle>) => {
    if ('fontSize' in p && !f.lines?.length) {
      const size = p.fontSize ?? 9.5;
      const bottom = f.box.y + f.box.h;
      const h = p.fontSize ? textBoxHeight(size) : f.box.h;
      patch(f.id, { ...p, box: { ...f.box, y: Math.max(0, bottom - h), h } });
    } else patch(f.id, p);
  };
  const moveBox = (f: FormField, x: number, y: number): FormField => ({ ...f, box: { ...f.box, x, y }, lines: f.lines?.map((b) => ({ ...b, x: b.x + (x - f.box.x), y: b.y + (y - f.box.y) })) });

  const onDown = (e: ReactPointerEvent, f: FormField, kind: 'move' | 'resize') => {
    if (adding) return; // zeichnen geht auch über vorhandene Kästen
    e.stopPropagation();
    setSel(f.id);
    setTableSel(false);
    drag.current = { kind, id: f.id, x: e.clientX, y: e.clientY, box: { ...f.box }, lines: f.lines?.map((b) => ({ ...b })) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onCanvasDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (z.pinching()) return;
    if (!adding || !wrap.current) {
      setSel(null);
      setTableSel(false);
      if (z.startPan(e)) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    // wie Text: angetippte Stelle = Schreiblinie, nach rechts ziehen = Länge; Schrift wie zuletzt gewählt
    const p = toPt(e.clientX, e.clientY);
    const ls = readLastStyle();
    const size = ls.fontSize ?? 9.5;
    const th = textBoxHeight(size);
    const f: FormField = { id: `n${Date.now()}`, key: '', label: 'Neues Feld', box: { x: p.x, y: Math.max(0, p.y - th), w: 0, h: th }, ...(ls.fontSize ? { fontSize: ls.fontSize } : {}), ...(ls.font ? { font: ls.font } : {}), ...(ls.bold ? { bold: true } : {}), ...(ls.color ? { color: ls.color } : {}) };
    setLayout((l) => ({ ...l, fields: [...l.fields, f] }));
    setSel(f.id);
    drag.current = { kind: 'draw', id: f.id, x: e.clientX, y: e.clientY, box: { ...f.box } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (z.movePan(e)) return;
    const d = drag.current;
    if (!d || !wrap.current) return;
    const k = layout.width / wrap.current.getBoundingClientRect().width;
    const dx = (e.clientX - d.x) * k;
    const dy = (e.clientY - d.y) * k;
    setLayout((l) => ({
      ...l,
      fields: l.fields.map((f) => {
        if (f.id !== d.id) return f;
        if (d.kind === 'move') return moveBox({ ...f, box: { ...d.box }, lines: d.lines }, Math.max(0, Math.min(l.width - f.box.w, d.box.x + dx)), Math.max(0, Math.min(l.height - f.box.h, d.box.y + dy)));
        const w = Math.max(8, Math.min(l.width - f.box.x, d.box.w + dx));
        if (d.kind === 'resize') return { ...f, box: { ...f.box, w }, lines: f.lines?.map((b) => ({ ...b, w: Math.max(8, b.w + (w - f.box.w)) })) };
        const x = Math.max(0, Math.min(d.box.x, d.box.x + dx));
        return { ...f, box: { ...f.box, x, w: Math.min(l.width - x, Math.abs(dx)) } };
      }),
    }));
  };
  const onUp = () => {
    z.endPan();
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'draw') {
      setAdding(false);
      setLayout((l) => ({ ...l, fields: l.fields.map((f) => (f.id === d.id && f.box.w < 8 ? { ...f, box: { ...f.box, w: Math.min(140, l.width - f.box.x - 4) } } : f)) }));
    }
  };
  // PC: Pfeiltasten verschieben (1 pt, Umschalt 5 mm), Enter = fertig, Entf = Feld entfernen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel) return;
      const tg = e.target as HTMLElement | null;
      const typing = !!tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable);
      if (e.key === 'Enter' && tg?.tagName !== 'TEXTAREA' && tg?.tagName !== 'BUTTON') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        setSel(null);
        setAdding(false);
        return;
      }
      if (e.key === 'Delete' && !typing) {
        e.preventDefault();
        setLayout((l) => ({ ...l, fields: l.fields.filter((f) => f.id !== sel) }));
        setSel(null);
        return;
      }
      if (!e.key.startsWith('Arrow') || typing) return;
      e.preventDefault();
      const step = e.shiftKey ? 5 * (72 / 25.4) : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      setLayout((l) => ({ ...l, fields: l.fields.map((f) => (f.id === sel ? moveBox(f, Math.max(0, Math.min(l.width - f.box.w, f.box.x + dx)), Math.max(0, Math.min(l.height - f.box.h, f.box.y + dy))) : f)) }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

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
  const sizePx = (s: TextStyle | undefined, h: number) => Math.max(5, (s?.fontSize ?? Math.min(9.5, Math.max(5.5, h * 0.82))) * pxPerPt);
  const sample = (f: FormField) => (f.key ? FIELD_LABELS[f.key] : f.label || '?');

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
      <div className="form-tpl form-editor">
        <div className="form-tpl-stage">
          <p className="muted small">
            {adding ? 'Wie Text: an der Schreiblinie ansetzen und nach rechts ziehen.' : 'Feld antippen: Wert und Schrift wählen, verschieben (auch Pfeiltasten), an der rechten Leiste verlängern. Enter = fertig, Entf = entfernen.'}
          </p>
          {z.bar}
          <div ref={z.vp} className="form-tpl-viewport" {...z.vpProps} data-testid="form-editor-viewport">
            <div
              ref={wrap}
              className={`form-tpl-editor${adding ? ' adding' : ''}`}
              style={{ aspectRatio: `${layout.width} / ${layout.height}`, width: `${z.zoom * 100}%` }}
              onPointerDown={onCanvasDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              data-testid="form-template-stage"
            >
              {img && <img src={img} alt="Formular" draggable={false} />}
              {layout.fields.map((f) => (
                <div key={f.id}>
                  <div
                    className={`form-tpl-box custom${sel === f.id ? ' sel' : ''}${f.key ? '' : ' open'}`}
                    style={{ left: pct(f.box.x, layout.width), top: pct(f.box.y, layout.height), width: pct(f.box.w, layout.width), height: pct(f.box.h, layout.height) }}
                    onPointerDown={(e) => onDown(e, f, 'move')}
                    title={f.key ? FIELD_LABELS[f.key] : 'ohne Zuordnung'}
                    data-testid="form-tpl-box"
                    data-key={f.key}
                  >
                    {/* Muster: Wert-Bezeichnung in Schrift, Größe und Farbe */}
                    <span className={`form-sample${f.fontSize ? ' base' : ''}`} style={{ ...inkCss(f), fontSize: sizePx(f, f.box.h), paddingBottom: f.fontSize ? 0.5 * (72 / 25.4) * pxPerPt : undefined, justifyContent: justifyCss(f.align) }}>
                      {sample(f)}
                    </span>
                    {sel === f.id && <b className="form-resize" onPointerDown={(e) => onDown(e, f, 'resize')} title="Länge ziehen" data-testid="form-field-resize" />}
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
                      className={`form-tpl-cell${tableSel ? ' sel' : ''}`}
                      style={{ left: pct(c.x, layout.width), top: pct(t.top + r * t.rowHeight, layout.height), width: pct(c.w, layout.width), height: pct(t.rowHeight, layout.height) }}
                      title={colLabel(c.key)}
                      onPointerDown={(e) => {
                        if (adding) return;
                        e.stopPropagation();
                        setSel(null);
                        setTableSel(true);
                      }}
                    >
                      {r === 0 && c.key === 'name' && (
                        <span className="form-sample" style={{ ...inkCss(t.style ?? {}), fontSize: sizePx(t.style, t.rowHeight - 2) }}>
                          Max Muster
                        </span>
                      )}
                    </div>
                  )),
                )}
            </div>
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
              <Icon name="plus" size={16} /> {adding ? 'Auf der PDF ziehen …' : 'Feld zeichnen'}
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
              <StylePanel value={field} onChange={(p) => setStyle(field, p)} sizePlaceholder={Math.min(9.5, Math.max(5.5, field.box.h * 0.82))} />
              <details className="form-field-geo">
                <summary className="muted small">Position und Größe (Punkt)</summary>
                <div className="rp-grid">
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <label key={k} className="field">
                      <span>{{ x: 'Links', y: 'Oben', w: 'Breite', h: 'Höhe' }[k]}</span>
                      <NumInput
                        min={k === 'w' ? 8 : k === 'h' ? 6 : 0}
                        step={0.5}
                        value={Math.round(field.box[k] * 10) / 10}
                        onCommit={(v) => v !== undefined && (k === 'x' || k === 'y' ? setLayout((l) => ({ ...l, fields: l.fields.map((f) => (f.id === field.id ? moveBox(f, k === 'x' ? v : f.box.x, k === 'y' ? v : f.box.y) : f)) })) : patch(field.id, { box: { ...field.box, [k]: v } }))}
                        testId={`form-tpl-${k}`}
                      />
                    </label>
                  ))}
                </div>
              </details>
              {field.lines?.length ? <p className="muted small">{field.lines.length + 1} Schreibzeilen</p> : null}
              <button type="button" className="btn btn-sm btn-danger-text" onClick={() => setLayout((l) => ({ ...l, fields: l.fields.filter((f) => f.id !== field.id) }))} data-testid="form-tpl-remove">
                <Icon name="trash" size={16} /> Feld entfernen
              </button>
            </div>
          ) : (
            !tableSel && <p className="muted small">Kein Feld gewählt.</p>
          )}
          {t && (
            <div className={`form-tpl-table${tableSel ? ' sel' : ''}`} data-testid="form-tpl-table">
              <strong>Arbeitertabelle</strong>
              <span className="muted small">
                {t.rows} Zeilen · {t.cols.map((c) => colLabel(c.key)).join(', ')}
              </span>
              <div className="rp-grid">
                <label className="field">
                  <span>Zeilen</span>
                  <NumInput min={1} max={60} value={t.rows} onCommit={(v) => v && setLayout((l) => ({ ...l, table: l.table ? { ...l.table, rows: Math.round(v) } : null }))} testId="form-tpl-rows" />
                </label>
                <label className="field">
                  <span>Zeilenhöhe (mm)</span>
                  <NumInput min={2} max={40} step={0.1} value={Math.round((t.rowHeight / (72 / 25.4)) * 10) / 10} onCommit={(v) => v && setLayout((l) => ({ ...l, table: l.table ? { ...l.table, rowHeight: v * (72 / 25.4) } : null }))} testId="form-tpl-rowheight" />
                </label>
              </div>
              <label className="field">
                <span>Oberkante erste Zeile (mm)</span>
                <NumInput min={0} step={0.1} value={Math.round((t.top / (72 / 25.4)) * 10) / 10} onCommit={(v) => v !== undefined && setLayout((l) => ({ ...l, table: l.table ? { ...l.table, top: v * (72 / 25.4) } : null }))} testId="form-tpl-top" />
              </label>
              <span className="muted small">Schrift der Tabelle</span>
              <StylePanel value={t.style ?? {}} onChange={(p) => setLayout((l) => ({ ...l, table: l.table ? { ...l.table, style: { ...l.table.style, ...p } } : null }))} sizePlaceholder={9} testPrefix="form-tpl-table" />
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
