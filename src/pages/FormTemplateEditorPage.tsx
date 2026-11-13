import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { getFormFile, getFormTemplate, saveFormTemplate } from '../lib/db';
import { analyzeForm, templateFileId, type FormTemplate } from '../lib/form-template';
import { alignOf, justifyOf, BASELINE_PT, DEFAULT_PITCH, MM_PT, multiHeight, pitchOf, textBoxHeight, withFontSize, DEFAULT_FORM_COLOR, FIELD_TYPES, FORM_COLORS, FORM_FONTS, fontCss, NAME_SUGGESTIONS, suggestionFor, fieldsFromDetection, fontSizeOf, lineBoxes, lineCapacity, newField, PROJECT_SOURCES, readingOrder, typeLabel, type CustomField, type CustomFieldType } from '../lib/forms';
import { uuid } from '../lib/ids';
import { usePageTitle } from '../lib/page-title';
import { navigate, paths } from '../lib/router';
import { canEditSites } from '../lib/sites';
import { useSession } from '../lib/use-session';
import { ACCENT } from './ReportsPage';
import { ToolMark } from '../components/ToolIcon';

/**
 * Felder einer Firmenvorlage einrichten: PDF als Bild, darauf die Kästen. Feld zeichnen (ziehen), verschieben,
 * an der Ecke vergrößern, in der Seitenleiste Name, Typ, Hinweis, Pflicht, Zeilen, Auswahl usw. festlegen.
 * Jeder Kasten zeigt seinen Feldnamen als Muster (Schrift, Größe, Farbe). Speichern erhöht die Vorlagenversion.
 */


/** Zahleneingabe, in die man frei tippen kann (leer, „1“ auf dem Weg zu „12“ …) – übernommen wird jeder gültige Wert */
function NumInput({ value, min, max, step, onCommit, testId, label }: { value: number; min: number; max?: number; step?: number; onCommit(v: number): void; testId: string; label?: string }) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(String(value));
  }, [value, focus]);
  const ok = (v: number) => Number.isFinite(v) && v >= min && (max === undefined || v <= max);
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      aria-label={label}
      onFocus={() => setFocus(true)}
      onBlur={() => {
        setFocus(false);
        setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value.replace(',', '.'));
        if (e.target.value.trim() && ok(v)) onCommit(v);
      }}
      data-testid={testId}
    />
  );
}

/** Schrift wie im ausgefüllten PDF */
const ink = (f: CustomField) => ({ color: f.color || DEFAULT_FORM_COLOR, fontFamily: fontCss(f), fontWeight: f.bold ? 700 : 400 });

type Drag = { kind: 'move' | 'resize' | 'draw' | 'inset' | 'pan'; sl?: number; st?: number; id: string; x: number; y: number; box: CustomField['box']; moved?: boolean; line?: number; side?: 'left' | 'right'; insets?: { left: number; right: number }[] };

export function FormTemplateEditorPage({ templateId }: { templateId: string }) {
  const session = useSession();
  const [t, setT] = useState<FormTemplate | null | undefined>(undefined);
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [name, setName] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pxPerPt, setPxPerPt] = useState(1);
  const wrap = useRef<HTMLDivElement>(null);
  /** Ansicht der PDF: eigener Zoom (unabhängig von Seite und Seitenleiste) */
  const vp = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const ZMIN = 1;
  const ZMAX = 6;
  /** zoomen und dabei den Punkt unter Finger/Maus (bzw. die Mitte) festhalten */
  const zoomAt = (next: number, clientX?: number, clientY?: number) => {
    const v = vp.current;
    const st = wrap.current;
    if (!v || !st) return;
    const z = Math.max(ZMIN, Math.min(ZMAX, next));
    const vr = v.getBoundingClientRect();
    const sr = st.getBoundingClientRect();
    const cx = (clientX ?? vr.left + vr.width / 2) - vr.left;
    const cy = (clientY ?? vr.top + vr.height / 2) - vr.top;
    anchor.current = { fx: (cx + v.scrollLeft) / sr.width, fy: (cy + v.scrollTop) / sr.height, cx, cy };
    setZoom(z);
  };
  useLayoutEffect(() => {
    const v = vp.current;
    const st = wrap.current;
    const a = anchor.current;
    if (!v || !st || !a) return;
    anchor.current = null;
    const sr = st.getBoundingClientRect();
    v.scrollLeft = a.fx * sr.width - a.cx;
    v.scrollTop = a.fy * sr.height - a.cy;
  }, [zoom]);
  // PC: Strg/⌘ + Mausrad zoomt die PDF (nicht die Seite)
  useEffect(() => {
    const v = vp.current;
    if (!v) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(zoomRef.current * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Handy/Tablet: zwei Finger zoomen (und verschieben)
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number; mx: number; my: number } | null>(null);
  const pinchPoints = () => [...touches.current.values()];
  const onVpDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      // zweiter Finger: laufendes Ziehen abbrechen (ein gerade begonnenes Feld wieder entfernen)
      const d = drag.current;
      if (d?.kind === 'draw') setFields((l) => l.filter((f) => f.id !== d.id || f.box.w >= 8));
      drag.current = null;
      const [a, b] = pinchPoints();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoomRef.current, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  };
  const onVpMove = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    const v = vp.current;
    if (!p || touches.current.size < 2 || !v) return;
    const [a, b] = pinchPoints();
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    v.scrollLeft -= mx - p.mx;
    v.scrollTop -= my - p.my;
    p.mx = mx;
    p.my = my;
    zoomAt((p.z * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, p.d), mx, my);
  };
  const onVpUp = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  };
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
  /** zuletzt gewählte Schrift (Farbe, Art, fett, Größe) – gilt für das nächste neue Feld; auf dem Gerät gemerkt */
  const lastStyle = useRef<Pick<CustomField, 'color' | 'font' | 'bold' | 'fontSize'>>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem('formFieldStyle') ?? '{}');
      } catch {
        return {};
      }
    })(),
  );
  const patch = (id: string, p: Partial<CustomField>) => {
    setFields((l) => l.map((f) => (f.id === id ? { ...f, ...p } : f)));
    setDirty(true);
    const st: Partial<CustomField> = {};
    for (const k of ['color', 'font', 'bold', 'fontSize'] as const) if (k in p) (st as Record<string, unknown>)[k] = p[k];
    if (Object.keys(st).length) {
      lastStyle.current = { ...lastStyle.current, ...st };
      try {
        localStorage.setItem('formFieldStyle', JSON.stringify(lastStyle.current));
      } catch {
        /* egal */
      }
    }
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
    if (pinch.current) return;
    if (!drawing) {
      setSel(null);
      // freie Fläche mit dem Finger ziehen = Ansicht verschieben (gezoomte PDF)
      if (e.pointerType === 'touch' && vp.current) {
        drag.current = { kind: 'pan', id: '', x: e.clientX, y: e.clientY, box: { x: 0, y: 0, w: 0, h: 0 }, sl: vp.current.scrollLeft, st: vp.current.scrollTop };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
      return;
    }
    // wie Text: angetippte Stelle = Schreiblinie (Schrift 0,5 mm darüber), nach rechts = Länge, nach unten = weitere Zeilen
    const p = toPt(e.clientX, e.clientY);
    // Schrift wie beim zuletzt bearbeiteten Feld (Farbe, Art, fett, Größe)
    const ls = lastStyle.current;
    const size = ls.fontSize ?? 10;
    const th = textBoxHeight(size);
    const f: CustomField = { ...newField({ x: p.x, y: Math.max(0, p.y - th), w: 0, h: th }), fontSize: size, ...(ls.color ? { color: ls.color } : {}), ...(ls.font ? { font: ls.font } : {}), ...(ls.bold ? { bold: true } : {}) };
    setFields((l) => [...l, f]);
    drag.current = { kind: 'draw', id: f.id, x: e.clientX, y: e.clientY, box: { ...f.box } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !wrap.current || pinch.current) return;
    if (d.kind === 'pan') {
      if (vp.current) {
        vp.current.scrollLeft = (d.sl ?? 0) - (e.clientX - d.x);
        vp.current.scrollTop = (d.st ?? 0) - (e.clientY - d.y);
      }
      return;
    }
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
    if (!d || d.kind === 'pan') return;
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
      if (!sel) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      // Enter = Feld fertig (auch im Namensfeld; im mehrzeiligen Textfeld bleibt Enter eine neue Zeile)
      if (e.key === 'Enter' && t?.tagName !== 'TEXTAREA' && t?.tagName !== 'BUTTON') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        setSel(null);
        setDrawing(false);
        return;
      }
      // Entf = gewähltes Feld löschen (nicht beim Schreiben in einem Eingabefeld)
      if (e.key === 'Delete' && !typing) {
        e.preventDefault();
        setFields((l) => l.filter((x) => x.id !== sel));
        setSel(null);
        setDirty(true);
        toast('Feld gelöscht.', 'success');
        return;
      }
      if (!e.key.startsWith('Arrow') || typing) return;
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
      toast('Vorlage gespeichert.', 'success');
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
            <ToolMark name="reports" />
            <div>
              <h1 data-testid="form-editor-title">{name || t.name}</h1>
              <span className="muted small">
                Felder einrichten · <span data-testid="form-editor-state">{dirty ? 'nicht gespeichert' : 'gespeichert'}</span>
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
            <div className="form-zoom-bar" role="group" aria-label="PDF vergrößern">
              <button type="button" className="icon-btn" onClick={() => zoomAt(zoom / 1.25)} disabled={zoom <= ZMIN} aria-label="Verkleinern" title="Verkleinern" data-testid="form-zoom-out">
                <Icon name="minus" />
              </button>
              <span className="form-zoom-level" data-testid="form-zoom-level">
                {Math.round(zoom * 100)} %
              </span>
              <button type="button" className="icon-btn" onClick={() => zoomAt(zoom * 1.25)} disabled={zoom >= ZMAX} aria-label="Vergrößern" title="Vergrößern" data-testid="form-zoom-in">
                <Icon name="plus" />
              </button>
              <button type="button" className="btn btn-sm" onClick={() => zoomAt(1)} disabled={zoom === 1} data-testid="form-zoom-fit">
                Ganze Breite
              </button>
              <span className="muted small hide-mobile">Strg + Mausrad · am Handy mit zwei Fingern</span>
            </div>
            <div ref={vp} className="form-tpl-viewport" onPointerDownCapture={onVpDown} onPointerMoveCapture={onVpMove} onPointerUpCapture={onVpUp} onPointerCancelCapture={onVpUp} data-testid="form-editor-viewport">
            <div ref={wrap} className={`form-tpl-editor${drawing ? ' adding' : ''}`} style={{ aspectRatio: `${width} / ${height}`, width: `${zoom * 100}%` }} onPointerDown={onStageDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="form-editor-stage">
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
                        <span className="form-sample base" style={{ ...ink(f), fontSize: fontPx(f), paddingBottom: BASELINE_PT * pxPerPt, justifyContent: justifyOf(f) }}>
                          {i === 0 ? f.name || '?' : ''}
                        </span>
                      </i>
                    ))
                  ) : f.type === 'multiline' ? (
                    <>
                      <span className="form-sample multi" style={{ ...ink(f), fontSize: fontPx(f), lineHeight: `${(f.box.h / lineCapacity(f)) * pxPerPt}px` }}>
                        {[f.name || '?']
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
                    <span className={`form-sample${f.type === 'checkbox' ? '' : ' base'}`} style={{ ...ink(f), fontSize: fontPx(f), paddingBottom: f.type === 'checkbox' ? undefined : BASELINE_PT * pxPerPt, justifyContent: justifyOf(f) }}>
                      {f.type === 'checkbox' ? 'X' : f.name || '?'}
                    </span>
                  )}
                  {f.type === 'multiline' && <em className="form-box-lines">{lineCapacity(f)} Zeilen</em>}
                  {sel === f.id && <b className="form-resize" onPointerDown={(e) => onBoxDown(e, f, 'resize')} data-testid="form-field-resize" />}
                </div>
              ))}
            </div>
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
                    onChange={(e) => {
                      // Vorschlag gewählt (z. B. „Wochentag“) → passender Feldtyp, solange noch „Einzeiliger Text“
                      const sg = suggestionFor(e.target.value);
                      patch(field.id, { name: e.target.value, ...(sg && field.type === 'text' ? { type: sg.type, ...(sg.source ? { source: sg.source } : {}), ...(sg.timeOf ? { timeOf: sg.timeOf } : {}) } : {}) });
                    }}
                    placeholder="z. B. Baustelle – Vorschlag wählen oder selbst schreiben"
                    data-testid="form-field-name"
                  />
                  {/* Auswahlliste: immer alle Vorschläge, auch wenn schon ein Name drinsteht */}
                  <select
                    className="form-name-pick"
                    value=""
                    onChange={(e) => {
                      const x = NAME_SUGGESTIONS.find((n) => n.name === e.target.value);
                      if (x) patch(field.id, { name: x.name, type: x.type, ...(x.source ? { source: x.source } : {}), ...(x.timeOf ? { timeOf: x.timeOf } : {}) });
                    }}
                    aria-label="Feldname aus der Liste wählen"
                    data-testid="form-name-pick"
                  >
                    <option value="">Name aus der Liste wählen …</option>
                    {NAME_SUGGESTIONS.map((x) => (
                      <option key={x.name} value={x.name}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <span className="form-name-chips">
                    {NAME_SUGGESTIONS.filter((x) => !fields.some((g) => g.name.trim().toLowerCase() === x.name.toLowerCase()))
                      .slice(0, 8)
                      .map((x) => (
                        <button key={x.name} type="button" className="chip" onClick={() => patch(field.id, { name: x.name, type: x.type, ...(x.source ? { source: x.source } : {}), ...(x.timeOf ? { timeOf: x.timeOf } : {}) })} data-testid="form-name-suggestion">
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
                {field.type === 'time' && (
                  <label className="field">
                    <span>Aus den Arbeitszeiten der Firma</span>
                    <select value={field.timeOf ?? ''} onChange={(e) => patch(field.id, { timeOf: (e.target.value || undefined) as CustomField['timeOf'] })} data-testid="form-field-timeof">
                      <option value="from">Arbeitsbeginn</option>
                      <option value="to">Arbeitsende</option>
                      <option value="">nichts vorschlagen</option>
                    </select>
                    <small className="muted">Je nach Wochentag des Datums (Zeitaufzeichnung bzw. Einteilung → Arbeitszeiten); beim Ausfüllen änderbar.</small>
                  </label>
                )}
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
                          <NumInput
                            min={2}
                            max={40}
                            step={0.5}
                            value={Math.round((pitchOf(field) / MM_PT) * 10) / 10}
                            onCommit={(mm) => {
                              const pitch = mm * MM_PT;
                              const n = lineCapacity(field);
                              patch(field.id, { pitch, lines: n, box: { ...field.box, h: Math.min(height - field.box.y, multiHeight(n, pitch, fontSizeOf(field))) } });
                            }}
                            testId="form-field-pitch"
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
                                    <NumInput min={0} step={0.5} value={Math.round((ins.left / MM_PT) * 10) / 10} onCommit={(v) => set('left', v)} label={`Zeile ${i + 1} Beginn`} testId="form-inset-left-mm" />
                                  </td>
                                  <td>
                                    <NumInput min={0} step={0.5} value={Math.round((ins.right / MM_PT) * 10) / 10} onCommit={(v) => set('right', v)} label={`Zeile ${i + 1} Ende`} testId="form-inset-right-mm" />
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
                            patch(field.id, { fontSize: v, box: withFontSize(field, v).box });
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
                      <span>Ausrichtung</span>
                      <div className="segmented form-align" role="radiogroup" aria-label="Ausrichtung">
                        {(
                          [
                            ['left', 'Links'],
                            ['center', 'Mittig'],
                            ['right', 'Rechts'],
                          ] as const
                        ).map(([a, label]) => (
                          <button key={a} type="button" role="radio" aria-checked={alignOf(field) === a} aria-selected={alignOf(field) === a} onClick={() => patch(field.id, { align: a })} data-testid={`form-field-align-${a}`}>
                            {label}
                          </button>
                        ))}
                      </div>
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
