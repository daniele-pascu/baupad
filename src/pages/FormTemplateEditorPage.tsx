import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { getFormFile, getFormTemplate, saveFormTemplate } from '../lib/db';
import { analyzeForm, templateFileId, type FormTemplate } from '../lib/form-template';
import { BASELINE_PT, DEFAULT_PITCH, MM_PT, multiHeight, pitchOf, textBoxHeight, withFontSize, DEFAULT_FORM_COLOR, FIELD_TYPES, FORM_COLORS, FORM_FONTS, fontCss, NAME_SUGGESTIONS, suggestionFor, fieldsFromDetection, fontSizeOf, lineBoxes, lineCapacity, newField, PROJECT_SOURCES, readingOrder, typeLabel, type CustomField, type CustomFieldType } from '../lib/forms';
import { uuid } from '../lib/ids';
import { usePageTitle } from '../lib/page-title';
import { navigate, paths } from '../lib/router';
import { canEditSites } from '../lib/sites';
import { useSession } from '../lib/use-session';
import { ACCENT } from './ReportsPage';

/**
 * Felder einer Firmenvorlage einrichten: PDF als Bild, darauf die Kästen. Feld zeichnen (ziehen), verschieben,
 * an der Ecke vergrößern, in der Seitenleiste Name, Typ, Hinweis, Pflicht, Zeilen, Auswahl usw. festlegen.
 * „Beispiel“ zeigt, wie ausgefüllte Felder später aussehen. Speichern erhöht die Vorlagenversion.
 */

const SAMPLE: Record<CustomFieldType, string> = {
  text: 'Beispieltext',
  multiline: 'Erste Zeile des Textes\nZweite Zeile des Textes\nDritte Zeile des Textes',
  date: '28.10.2026',
  week: '44',
  weekday: 'Mittwoch',
  number: '12',
  amount: '1.250,00',
  person: 'Max Muster, Peter Beispiel',
  project: 'Wohnanlage Sonnenhof',
  company: 'Muster Bau GmbH',
  select: 'Auswahl',
  checkbox: 'X',
  no: '7',
};

/** Schrift wie im ausgefüllten PDF */
const ink = (f: CustomField) => ({ color: f.color || DEFAULT_FORM_COLOR, fontFamily: fontCss(f), fontWeight: f.bold ? 700 : 400 });

type Drag = { kind: 'move' | 'resize' | 'draw' | 'inset'; id: string; x: number; y: number; box: CustomField['box']; moved?: boolean; line?: number; side?: 'left' | 'right'; insets?: { left: number; right: number }[] };

export function FormTemplateEditorPage({ templateId }: { templateId: string }) {
  const session = useSession();
  const [t, setT] = useState<FormTemplate | null | undefined>(undefined);
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [name, setName] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [sample, setSample] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pxPerPt, setPxPerPt] = useState(1);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  usePageTitle(t ? `${t.name} – Felder – BauPad` : 'Vorlage – BauPad');

  useEffect(() => {
    void (async () => {
      const tpl = await getFormTemplate(templateId);
      if (!tpl || tpl.kind !== 'custom') return setT(null);
      setT(tpl);
      setFields(tpl.fields ?? []);
      setName(tpl.name);
      const file = await getFormFile(templateFileId(tpl));
      if (!file) throw new Error('Die PDF-Datei der Vorlage fehlt auf diesem Gerät – bitte unter „Vorlage bearbeiten“ neu hochladen.');
      setPdf(file);
    })().catch((e) => showError(e, 'Vorlage konnte nicht geladen werden'));
  }, [templateId]);

  useEffect(() => {
    if (!pdf) return;
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

  const width = t?.layout.width ?? 595;
  const height = t?.layout.height ?? 842;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPxPerPt(el.getBoundingClientRect().width / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, img]);

  const field = fields.find((f) => f.id === sel) ?? null;
  const ordered = useMemo(() => readingOrder(fields), [fields]);
  const patch = (id: string, p: Partial<CustomField>) => {
    setFields((l) => l.map((f) => (f.id === id ? { ...f, ...p } : f)));
    setDirty(true);
  };
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const toPt = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const k = width / r.width;
    return { x: Math.max(0, Math.min(width, (clientX - r.left) * k)), y: Math.max(0, Math.min(height, (clientY - r.top) * k)) };
  };

  /* Zeiger: Feld verschieben, Ecke ziehen, neues Feld zeichnen */
  const onBoxDown = (e: ReactPointerEvent, f: CustomField, kind: 'move' | 'resize') => {
    if (drawing) return; // zeichnen geht auch über vorhandene Kästen – das Ereignis läuft zur Fläche weiter
    e.stopPropagation();
    setSel(f.id);
    drag.current = { kind, id: f.id, x: e.clientX, y: e.clientY, box: { ...f.box } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  /** Zeilenanfang bzw. -ende ziehen (Einzug je Zeile) */
  const onInsetDown = (e: ReactPointerEvent, f: CustomField, line: number, side: 'left' | 'right') => {
    e.stopPropagation();
    setSel(f.id);
    const n = lineCapacity(f);
    const insets = Array.from({ length: n }, (_, i) => ({ left: f.lineInsets?.[i]?.left ?? 0, right: f.lineInsets?.[i]?.right ?? 0 }));
    drag.current = { kind: 'inset', id: f.id, x: e.clientX, y: e.clientY, box: { ...f.box }, line, side, insets };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onStageDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing) {
      setSel(null);
      return;
    }
    // wie Text: angetippte Stelle = Schreiblinie (Schrift 0,5 mm darüber), nach rechts = Länge, nach unten = weitere Zeilen
    const p = toPt(e.clientX, e.clientY);
    const th = textBoxHeight(10);
    const f = { ...newField({ x: p.x, y: Math.max(0, p.y - th), w: 0, h: th }), fontSize: 10 };
    setFields((l) => [...l, f]);
    drag.current = { kind: 'draw', id: f.id, x: e.clientX, y: e.clientY, box: { ...f.box } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !wrap.current) return;
    const k = width / wrap.current.getBoundingClientRect().width;
    const dx = (e.clientX - d.x) * k;
    const dy = (e.clientY - d.y) * k;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return; // bloßes Antippen ist keine Änderung
    d.moved = true;
    setFields((l) =>
      l.map((f) => {
        if (f.id !== d.id) return f;
        if (d.kind === 'inset' && d.insets && d.line !== undefined) {
          const ins = d.insets.map((x) => ({ ...x }));
          const cur = ins[d.line];
          if (d.side === 'left') cur.left = Math.max(0, Math.min(f.box.w - cur.right - 8, cur.left + dx));
          else cur.right = Math.max(0, Math.min(f.box.w - cur.left - 8, cur.right - dx));
          return { ...f, lineInsets: ins };
        }
        if (d.kind === 'move') return { ...f, box: { ...f.box, x: Math.max(0, Math.min(width - f.box.w, d.box.x + dx)), y: Math.max(0, Math.min(height - f.box.h, d.box.y + dy)) } };
        const w = (x0: number) => Math.max(8, Math.min(width - x0, d.box.w + dx));
        if (d.kind === 'resize') {
          // Textfeld: nur in die Länge (Höhe kommt von der Schrift); Zeilenfeld: Länge und Anzahl Zeilen
          if (f.type === 'multiline' && f.pitch) {
            const n = Math.max(1, Math.round((d.box.h - textBoxHeight(fontSizeOf(f)) + dy) / f.pitch) + 1);
            return { ...f, lines: n, box: { ...f.box, w: w(f.box.x), h: Math.min(height - f.box.y, multiHeight(n, f.pitch, fontSizeOf(f))) } };
          }
          if (f.type === 'checkbox' || f.type === 'multiline') return { ...f, box: { ...f.box, w: w(f.box.x), h: Math.max(6, Math.min(height - f.box.y, d.box.h + dy)) } };
          return { ...f, box: { ...f.box, w: w(f.box.x) } };
        }
        // zeichnen: Länge nach rechts (oder links), nach unten ziehen = weitere Zeilen wie eine Schlange
        const x = Math.max(0, Math.min(d.box.x, d.box.x + dx));
        const bw = Math.min(width - x, Math.abs(dx));
        const n = dy > DEFAULT_PITCH * 0.6 ? 1 + Math.round(dy / DEFAULT_PITCH) : 1;
        const size = fontSizeOf(f);
        if (n > 1) return { ...f, type: 'multiline', lines: n, pitch: f.pitch ?? DEFAULT_PITCH, box: { x, y: d.box.y, w: bw, h: Math.min(height - d.box.y, multiHeight(n, f.pitch ?? DEFAULT_PITCH, size)) } };
        return { ...f, type: f.type === 'multiline' ? 'text' : f.type, lines: undefined, pitch: undefined, box: { x, y: d.box.y, w: bw, h: textBoxHeight(size) } };
      }),
    );
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved || d.kind === 'draw') setDirty(true);
    if (d.kind === 'draw') {
      setDrawing(false);
      // zu klein (bloßer Tipp) → Standardgröße eines Textfeldes
      setFields((l) => l.map((f) => (f.id === d.id && f.box.w < 8 ? { ...f, box: { ...f.box, w: Math.min(140, width - f.box.x) } } : f)));
      setSel(d.id);
      setTimeout(() => nameInput.current?.select(), 0);
    }
  };

  // PC: gewähltes Feld mit den Pfeiltasten genau setzen (1 pt, mit Umschalt 0,5 mm × 10 = 5 mm)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || !e.key.startsWith('Arrow')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      const step = e.shiftKey ? 5 * MM_PT : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      setFields((l) => l.map((f) => (f.id === sel ? { ...f, box: { ...f.box, x: Math.max(0, Math.min(width - f.box.w, f.box.x + dx)), y: Math.max(0, Math.min(height - f.box.h, f.box.y + dy)) } } : f)));
      setDirty(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, width, height]);

  const suggest = () =>
    void (async () => {
      if (!pdf) return;
      const { openPdf, closePdf, readFormPage } = await import('../lib/pdf');
      const doc = await openPdf(pdf);
      const page = await readFormPage(await doc.getPage(1));
      await closePdf(doc);
      const found = fieldsFromDetection(analyzeForm(page, 'tag'));
      // nur Felder, die keinen vorhandenen Kasten überlappen
      const overlaps = (a: CustomField['box'], b: CustomField['box']) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      const fresh = found.filter((f) => !fields.some((g) => overlaps(f.box, g.box)));
      if (!fresh.length) return toast('Keine weiteren Felder erkannt.', 'info');
      setFields((l) => [...l, ...fresh]);
      setDirty(true);
      toast(`${fresh.length} Felder vorgeschlagen – bitte Namen und Typ prüfen.`, 'success');
    })().catch((e) => showError(e, 'Erkennung fehlgeschlagen'));

  const duplicate = (f: CustomField) => {
    const c: CustomField = { ...f, id: uuid(), name: `${f.name} (2)`, box: { ...f.box, y: Math.min(height - f.box.h, f.box.y + f.box.h + 4) } };
    setFields((l) => [...l, c]);
    setSel(c.id);
    setDirty(true);
  };
  const remove = (f: CustomField) => {
    setFields((l) => l.filter((x) => x.id !== f.id));
    setSel(null);
    setDirty(true);
  };
  const save = async () => {
    if (!t) return;
    const bad = fields.find((f) => !f.name.trim());
    if (bad) {
      setSel(bad.id);
      return showError(new Error('Bitte jedem Feld einen Namen geben.'), 'Nicht gespeichert');
    }
    setBusy(true);
    try {
      const next: FormTemplate = { ...t, name: name.trim() || t.name, fields, version: dirty ? (t.version ?? 1) + 1 : (t.version ?? 1), updatedAt: Date.now() };
      await saveFormTemplate(next);
      setT(next);
      setDirty(false);
      toast(`Vorlage gespeichert (Version ${next.version}).`, 'success');
    } catch (e) {
      showError(e, 'Konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    if (dirty && !(await confirmDialog({ title: 'Änderungen verwerfen?', message: <p>Die Felder wurden noch nicht gespeichert.</p>, confirmLabel: 'Verwerfen', danger: true }))) return;
    navigate(paths.formTemplates());
  };

  if (t === undefined) return <SiteNav />;
  if (t === null || !canEditSites(session))
    return (
      <>
        <SiteNav />
        <div className="page">
          <p>{t === null ? 'Vorlage nicht gefunden.' : 'Vorlagen richten Admin oder Büro ein.'}</p>
          <a className="btn" href={paths.formTemplates()}>
            Zu den Vorlagen
          </a>
        </div>
      </>
    );

  const fontPx = (f: CustomField) => Math.max(6, fontSizeOf(f) * pxPerPt);

  return (
    <>
      <SiteNav />
      <div className="page reports-page form-editor-page" style={ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <button type="button" className="icon-link" aria-label="Zu den Vorlagen" title="Zu den Vorlagen" onClick={() => void leave()} data-testid="to-form-templates">
              <Icon name="back" />
            </button>
            <div>
              <h1 data-testid="form-editor-title">{name || t.name}</h1>
              <span className="muted small">
                Felder einrichten · Version {t.version ?? 1} · <span data-testid="form-editor-state">{dirty ? 'nicht gespeichert' : 'gespeichert'}</span>
              </span>
            </div>
          </div>
          <div className="report-actions">
            <button type="button" className={`btn btn-sm${drawing ? ' btn-primary' : ''}`} onClick={() => setDrawing((d) => !d)} aria-pressed={drawing} data-testid="form-editor-draw">
              <Icon name="plus" size={16} /> {drawing ? 'Auf der PDF ziehen …' : 'Feld zeichnen'}
            </button>
            <button type="button" className="btn btn-sm" onClick={suggest} data-testid="form-editor-suggest" title="Beschriftungen und Linien der PDF auswerten">
              Felder vorschlagen
            </button>
            <button type="button" className={`btn btn-sm${sample ? ' btn-primary' : ''}`} onClick={() => setSample((s) => !s)} aria-pressed={sample} data-testid="form-editor-sample">
              Beispiel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !dirty} data-testid="form-editor-save">
              Speichern
            </button>
          </div>
        </header>

        <div className="form-tpl form-editor">
          <div className="form-tpl-stage">
            <p className="muted small">
              {drawing ? 'Mit gedrückter Maus bzw. dem Finger einen Kasten über das Feld der PDF ziehen.' : 'Feld antippen, um es zu bearbeiten oder zu verschieben; an der Ecke rechts unten die Größe ändern.'}
            </p>
            <div ref={wrap} className={`form-tpl-editor${drawing ? ' adding' : ''}`} style={{ aspectRatio: `${width} / ${height}` }} onPointerDown={onStageDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="form-editor-stage">
              {img && <img src={img} alt="Formular" draggable={false} />}
              {fields.map((f) => (
                <div
                  key={f.id}
                  className={`form-tpl-box custom${sel === f.id ? ' sel' : ''}${f.required ? ' req' : ''}${f.type === 'multiline' && f.pitch ? ' strips' : ''}`}
                  style={{ left: pct(f.box.x, width), top: pct(f.box.y, height), width: pct(f.box.w, width), height: pct(f.box.h, height) }}
                  onPointerDown={(e) => onBoxDown(e, f, 'move')}
                  title={`${f.name} – ${typeLabel(f.type)}`}
                  data-testid="form-field-box"
                  data-name={f.name}
                >
                  {f.type === 'multiline' && f.pitch ? (
                    // Zeilenstreifen: jede Zeile einzeln, erste mit Muster (Feldname bzw. Beispiel)
                    lineBoxes(f).map((b, i) => (
                      <i key={i} className="form-line-strip" style={{ top: pct(b.y - f.box.y, f.box.h), height: pct(b.h, f.box.h), left: pct(b.x - f.box.x, f.box.w), width: pct(b.w, f.box.w), right: 'auto' }} data-testid="form-line-strip">
                        {sel === f.id && (
                          <>
                            <b className="form-inset-handle left" onPointerDown={(e) => onInsetDown(e, f, i, 'left')} title="Zeilenanfang ziehen" data-testid="form-inset-left" />
                            <b className="form-inset-handle right" onPointerDown={(e) => onInsetDown(e, f, i, 'right')} title="Zeilenende ziehen" data-testid="form-inset-right" />
                          </>
                        )}
                        <span className="form-sample base" style={{ ...ink(f), fontSize: fontPx(f), paddingBottom: BASELINE_PT * pxPerPt }}>
                          {sample ? (SAMPLE.multiline.split('\n')[i] ?? '') : i === 0 ? f.name || '?' : ''}
                        </span>
                      </i>
                    ))
                  ) : f.type === 'multiline' ? (
                    <>
                      <span className="form-sample multi" style={{ ...ink(f), fontSize: fontPx(f), lineHeight: `${(f.box.h / lineCapacity(f)) * pxPerPt}px` }}>
                        {(sample ? SAMPLE.multiline.split('\n') : [f.name || '?'])
                          .slice(0, lineCapacity(f))
                          .map((x, i) => (
                            <span key={i}>{x}</span>
                          ))}
                      </span>
                      {lineBoxes(f)
                        .slice(1)
                        .map((b, i) => (
                          <i key={i} className="form-line-mark" style={{ top: pct(b.y - f.box.y, f.box.h) }} />
                        ))}
                    </>
                  ) : (
                    // Muster: Feldname in Schrift, Größe und Farbe – sitzt 0,5 mm über der Unterkante
                    <span className={`form-sample${f.type === 'checkbox' ? '' : ' base'}`} style={{ ...ink(f), fontSize: fontPx(f), paddingBottom: f.type === 'checkbox' ? undefined : BASELINE_PT * pxPerPt, justifyContent: f.align === 'right' || f.type === 'amount' || f.type === 'number' ? 'flex-end' : f.type === 'checkbox' || f.align === 'center' ? 'center' : 'flex-start' }}>
                      {sample ? SAMPLE[f.type] : f.type === 'checkbox' ? 'X' : f.name || '?'}
                    </span>
                  )}
                  {f.type === 'multiline' && <em className="form-box-lines">{lineCapacity(f)} Zeilen</em>}
                  {sel === f.id && <b className="form-resize" onPointerDown={(e) => onBoxDown(e, f, 'resize')} data-testid="form-field-resize" />}
                </div>
              ))}
            </div>
          </div>

          <aside className="form-tpl-side">
            <label className="field">
              <span>Formularname</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
                data-testid="form-editor-name"
              />
            </label>
            {field ? (
              <div className="form-tpl-field" data-testid="form-field-panel">
                <label className="field">
                  <span>Feldname *</span>
                  <input
                    ref={nameInput}
                    value={field.name}
                    list="form-name-suggestions"
                    onChange={(e) => {
                      // Vorschlag gewählt (z. B. „Wochentag“) → passender Feldtyp, solange noch „Einzeiliger Text“
                      const sg = suggestionFor(e.target.value);
                      patch(field.id, { name: e.target.value, ...(sg && field.type === 'text' ? { type: sg.type, ...(sg.source ? { source: sg.source } : {}) } : {}) });
                    }}
                    placeholder="z. B. Baustelle – Vorschlag wählen oder selbst schreiben"
                    data-testid="form-field-name"
                  />
                  <datalist id="form-name-suggestions">
                    {NAME_SUGGESTIONS.map((x) => (
                      <option key={x.name} value={x.name} />
                    ))}
                  </datalist>
                  <span className="form-name-chips">
                    {NAME_SUGGESTIONS.filter((x) => !fields.some((g) => g.name.trim().toLowerCase() === x.name.toLowerCase()))
                      .slice(0, 8)
                      .map((x) => (
                        <button key={x.name} type="button" className="chip" onClick={() => patch(field.id, { name: x.name, type: x.type, ...(x.source ? { source: x.source } : {}) })} data-testid="form-name-suggestion">
                          {x.name}
                        </button>
                      ))}
                  </span>
                </label>
                <label className="field">
                  <span>Feldtyp</span>
                  <select value={field.type} onChange={(e) => patch(field.id, { type: e.target.value as CustomFieldType })} data-testid="form-field-type">
                    {FIELD_TYPES.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <small className="muted">{FIELD_TYPES.find((x) => x.id === field.type)?.help}</small>
                </label>
                {field.type === 'project' && (
                  <label className="field">
                    <span>Angabe aus dem Projekt</span>
                    <select value={field.source ?? 'name'} onChange={(e) => patch(field.id, { source: e.target.value as CustomField['source'] })} data-testid="form-field-source">
                      {PROJECT_SOURCES.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {field.type === 'date' && (
                  <label className="field">
                    <span>Datumsformat</span>
                    <select value={field.dateFormat ?? 'dd.MM.yyyy'} onChange={(e) => patch(field.id, { dateFormat: e.target.value as CustomField['dateFormat'] })}>
                      <option value="dd.MM.yyyy">28.10.2026</option>
                      <option value="dd.MM.">28.10. (Jahr steht im Formular)</option>
                    </select>
                  </label>
                )}
                {field.type === 'select' && (
                  <label className="field">
                    <span>Möglichkeiten (eine je Zeile)</span>
                    <textarea rows={4} value={(field.options ?? []).join('\n')} onChange={(e) => patch(field.id, { options: e.target.value.split('\n') })} onBlur={(e) => patch(field.id, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} data-testid="form-field-options" />
                  </label>
                )}
                {field.type !== 'checkbox' && (
                  <div className="form-ink" data-testid="form-field-ink">
                    <div className="rp-grid">
                      {field.type === 'multiline' && (
                        <label className="field">
                          <span>Zeilen</span>
                          <input
                            type="number"
                            min={1}
                            value={field.lines ?? ''}
                            placeholder={String(lineCapacity(field))}
                            onChange={(e) => {
                              const n = Number(e.target.value) > 0 ? Number(e.target.value) : undefined;
                              patch(field.id, field.pitch && n ? { lines: n, box: { ...field.box, h: multiHeight(n, field.pitch, fontSizeOf(field)) } } : { lines: n });
                            }}
                            data-testid="form-field-lines"
                          />
                        </label>
                      )}
                      {field.type === 'multiline' && (
                        <label className="field">
                          <span>Zeilenabstand (mm)</span>
                          <input
                            type="number"
                            min={2}
                            max={30}
                            step={0.5}
                            value={Math.round((pitchOf(field) / MM_PT) * 10) / 10}
                            onChange={(e) => {
                              const mm = Number(e.target.value);
                              if (!(mm > 0)) return;
                              const pitch = mm * MM_PT;
                              const n = lineCapacity(field);
                              patch(field.id, { pitch, lines: n, box: { ...field.box, h: Math.min(height - field.box.y, multiHeight(n, pitch, fontSizeOf(field))) } });
                            }}
                            data-testid="form-field-pitch"
                          />
                        </label>
                      )}
                    </div>
                    {field.type === 'multiline' && field.pitch && (
                      <details className="form-line-insets" open={!!field.lineInsets?.some((x) => x.left || x.right)}>
                        <summary className="small">Beginn und Ende je Zeile (mm)</summary>
                        <p className="muted small">Einzug vom linken bzw. rechten Rand des Kastens – oder im Formular die Enden der Zeile ziehen.</p>
                        <table className="form-inset-table" data-testid="form-line-insets">
                          <thead>
                            <tr>
                              <th>Zeile</th>
                              <th>Beginn</th>
                              <th>Ende</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({ length: lineCapacity(field) }, (_, i) => {
                              const ins = field.lineInsets?.[i] ?? { left: 0, right: 0 };
                              const set = (k: 'left' | 'right', mm: number) => {
                                const all = Array.from({ length: lineCapacity(field) }, (_, j) => ({ left: field.lineInsets?.[j]?.left ?? 0, right: field.lineInsets?.[j]?.right ?? 0 }));
                                all[i] = { ...all[i], [k]: Math.max(0, mm) * MM_PT };
                                patch(field.id, { lineInsets: all });
                              };
                              return (
                                <tr key={i}>
                                  <td>{i + 1}</td>
                                  <td>
                                    <input type="number" min={0} step={0.5} value={Math.round((ins.left / MM_PT) * 10) / 10} onChange={(e) => set('left', Number(e.target.value) || 0)} aria-label={`Zeile ${i + 1} Beginn`} data-testid="form-inset-left-mm" />
                                  </td>
                                  <td>
                                    <input type="number" min={0} step={0.5} value={Math.round((ins.right / MM_PT) * 10) / 10} onChange={(e) => set('right', Number(e.target.value) || 0)} aria-label={`Zeile ${i + 1} Ende`} data-testid="form-inset-right-mm" />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </details>
                    )}
                    <div className="rp-grid">
                      <label className="field">
                        <span>Schriftgröße (pt)</span>
                        <input type="number" min={5.5} max={14} step={0.5} value={field.fontSize ?? ''} placeholder={fontSizeOf(field).toFixed(1)} onChange={(e) => {
                            const v = Number(e.target.value) > 0 ? Number(e.target.value) : undefined;
                            patch(field.id, withFontSize(field, v));
                          }}
                          data-testid="form-field-font"
                        />
                      </label>
                    </div>
                    <div className="rp-grid">
                      <label className="field">
                        <span>Schriftart</span>
                        <select value={field.font ?? 'helvetica'} onChange={(e) => patch(field.id, { font: e.target.value as CustomField['font'] })} data-testid="form-field-fontface">
                          {FORM_FONTS.map((x) => (
                            <option key={x.id} value={x.id} style={{ fontFamily: x.css }}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="check-row form-bold">
                        <input type="checkbox" checked={!!field.bold} onChange={(e) => patch(field.id, { bold: e.target.checked })} data-testid="form-field-bold" />
                        <span>Fett</span>
                      </label>
                    </div>
                    <div className="field">
                      <span>Schriftfarbe</span>
                      <div className="form-colors" role="radiogroup" aria-label="Schriftfarbe">
                        {FORM_COLORS.map((c) => (
                          <button
                            key={c.value}
                            type="button"
                            role="radio"
                            aria-checked={(field.color || DEFAULT_FORM_COLOR) === c.value}
                            aria-label={c.label}
                            title={c.label}
                            className={`form-color${(field.color || DEFAULT_FORM_COLOR) === c.value ? ' on' : ''}`}
                            style={{ background: c.value }}
                            onClick={() => patch(field.id, { color: c.value })}
                            data-testid="form-field-color"
                            data-color={c.value}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="form-ink-sample" style={{ ...ink(field), fontSize: `${Math.max(11, fontSizeOf(field) * 1.4)}px` }}>
                      So wird es ausgefüllt: {SAMPLE[field.type].split('\n')[0]}
                    </p>
                  </div>
                )}
                <label className="field">
                  <span>Bearbeitungshinweis</span>
                  <input value={field.hint ?? ''} onChange={(e) => patch(field.id, { hint: e.target.value })} placeholder="Was soll hier eingetragen werden?" data-testid="form-field-hint" />
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={!!field.required} onChange={(e) => patch(field.id, { required: e.target.checked })} data-testid="form-field-required" />
                  <span>Pflichtfeld</span>
                </label>
                <details className="form-field-geo">
                  <summary className="muted small">Position und Größe (Punkt)</summary>
                  <div className="rp-grid">
                    {(['x', 'y', 'w', 'h'] as const).map((k) => (
                      <label key={k} className="field">
                        <span>{{ x: 'Links', y: 'Oben', w: 'Breite', h: 'Höhe' }[k]}</span>
                        <input type="number" value={Math.round(field.box[k] * 10) / 10} onChange={(e) => patch(field.id, { box: { ...field.box, [k]: Math.max(k === 'w' ? 8 : k === 'h' ? 6 : 0, Number(e.target.value) || 0) } })} data-testid={`form-field-${k}`} />
                      </label>
                    ))}
                  </div>
                  {field.type === 'multiline' && (
                    <p className="muted small">
                      {lineCapacity(field)} Zeilen à {((field.box.h / lineCapacity(field)) * 0.3528).toFixed(1)} mm · Kasten {(field.box.w * 0.3528).toFixed(0)} × {(field.box.h * 0.3528).toFixed(0)} mm
                    </p>
                  )}
                </details>
                <div className="row gap wrap">
                  <button type="button" className="btn btn-sm" onClick={() => duplicate(field)} data-testid="form-field-duplicate">
                    <Icon name="copy" size={16} /> Duplizieren
                  </button>
                  <button type="button" className="btn btn-sm btn-danger-text" onClick={() => remove(field)} data-testid="form-field-remove">
                    <Icon name="trash" size={16} /> Feld löschen
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted small">Kein Feld gewählt. {fields.length === 0 && '„Feld zeichnen“ oder „Felder vorschlagen“ antippen.'}</p>
            )}
            <div className="form-field-list-head">
              <strong>Felder</strong>
              <span className="muted small">{fields.length}</span>
            </div>
            <ol className="form-tpl-list form-field-list" data-testid="form-field-list">
              {ordered.map((f) => (
                <li key={f.id}>
                  <button type="button" className={`link-btn${sel === f.id ? ' on' : ''}${f.name.trim() ? '' : ' text-warn'}`} onClick={() => setSel(f.id)}>
                    {f.name.trim() || 'ohne Namen'}
                    {f.required && ' *'}
                    <span className="muted small">
                      {' '}
                      · {typeLabel(f.type)}
                      {f.type === 'multiline' ? ` · ${lineCapacity(f)} Zeilen` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    </>
  );
}
