import { useEffect, useRef, useState } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { PdfPreview } from '../components/PdfPreview';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import type { ExportFile } from '../lib/aufmass';
import { deleteFormEntry, getFormEntry, getFormFile, getMeta, listFormEntries, saveFormEntry } from '../lib/db';
import { DEFAULT_WORK_TIMES } from '../lib/crew';
import type { WorkTimes } from '../lib/types';
import { useDataChanged } from '../lib/data-events';
import { workTimeFor, justifyOf, BASELINE_PT, lineBoxes, wrapToLines, displayValue, entrySiteKey, fits, fontCss, DEFAULT_FORM_COLOR, fmtFieldDate, fontSizeOf, isoWeekLabel, lineCapacity, mainDate, missingRequired, prefill, readingOrder, type CustomField, type FormEntry, type Measure } from '../lib/forms';
import { copyFormEntry, formEntryPdf, prefillContext, suggestedPeople } from '../lib/forms-data';
import { helveticaMeasure } from '../lib/forms-pdf';
import { usePageTitle } from '../lib/page-title';
import { navigate, paths } from '../lib/router';
import { useSession } from '../lib/use-session';
import { ACCENT } from './ReportsPage';

/**
 * Firmenformular ausfüllen: Eingabemaske nur mit den eingerichteten Feldern (Name, Hinweis, Pflicht, Typ),
 * rechts die Vorlage mit den Werten als Kontrolle. Mehrzeilige Felder zeigen „Zeile x von y“ und warnen bei
 * Platzmangel; „PDF“ erst, wenn Pflichtfelder gefüllt sind und nichts überläuft. Jede Änderung wird gespeichert.
 */

/** Näherung, bis die PDF-Schrift geladen ist */
const roughMeasure: Measure = (s, size) => s.length * size * 0.5;

/** Schrift wie im PDF: Farbe, Schriftart, fett */
const inkStyle = (f: CustomField) => ({ color: f.color || DEFAULT_FORM_COLOR, fontFamily: fontCss(f), fontWeight: f.bold ? 700 : 400 });

export function FormEntryPage({ entryId }: { entryId: string }) {
  const session = useSession();
  const [e, setE] = useState<FormEntry | null | undefined>(undefined);
  const [img, setImg] = useState<string | null>(null);
  const [measure, setMeasure] = useState<Measure>(() => roughMeasure);
  const [saved, setSaved] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(true);
  const [pxPerPt, setPxPerPt] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const pending = useRef<FormEntry | null>(null);
  const timer = useRef(0);
  usePageTitle(e ? `${e.templateName} Nr. ${e.no} – BauPad` : 'Formular – BauPad');

  /** Arbeitszeiten der Firma – Uhrzeit-Felder Beginn/Ende je Wochentag */
  const [workTimes, setWorkTimes] = useState<WorkTimes>(DEFAULT_WORK_TIMES);
  useEffect(() => {
    void Promise.all([getFormEntry(entryId), helveticaMeasure(), getMeta<WorkTimes>('workTimes')])
      .then(([entry, m, wt]) => {
        setE(entry ?? null);
        setMeasure(() => m);
        setWorkTimes(wt ?? DEFAULT_WORK_TIMES);
      })
      .catch((err) => showError(err, 'Formular konnte nicht geladen werden'));
  }, [entryId]);
  useDataChanged(() => {
    if (pending.current) return;
    void getFormEntry(entryId).then((x) => x && setE((cur) => (cur && x.updatedAt > cur.updatedAt ? x : cur)));
  });

  // Vorschaubild der Vorlage (Version des Eintrags)
  useEffect(() => {
    if (!e) return;
    let url: string | null = null;
    void (async () => {
      const pdf = await getFormFile(e.fileId);
      if (!pdf) return;
      const { openPdf, closePdf, renderPdfToCanvas, canvasToBlob } = await import('../lib/pdf');
      const doc = await openPdf(pdf);
      const canvas = await renderPdfToCanvas(await doc.getPage(1), 1400);
      url = URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.8));
      canvas.width = canvas.height = 0;
      await closePdf(doc);
      setImg(url);
    })().catch(() => setImg(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [e?.fileId]);
  useEffect(() => {
    const el = stage.current;
    if (!el || !e) return;
    const ro = new ResizeObserver(() => setPxPerPt(el.getBoundingClientRect().width / e.layout.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [e?.layout.width, img, showPreview]);

  // Vorschlag aus der Arbeitereinteilung zum Hauptdatum
  useEffect(() => {
    if (!e || !e.layout.fields.some((f) => f.type === 'person')) return;
    void suggestedPeople(e.projectId, e.siteName, e.date).then(setPeople).catch(() => setPeople([]));
  }, [e?.projectId, e?.siteName, e?.date]);

  const flush = () => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next) saveFormEntry(next).then(() => setSaved(true), (err) => showError(err, 'Speichern fehlgeschlagen'));
  };
  useEffect(() => flush, []);
  const update = (fn: (x: FormEntry) => FormEntry) =>
    setE((prev) => {
      if (!prev) return prev;
      const next = { ...fn(prev), updatedAt: Date.now() };
      pending.current = next;
      setSaved(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 350);
      return next;
    });
  const setValue = (f: CustomField, v: string) =>
    update((x) => {
      let values = { ...x.values, [f.id]: v };
      // Datum geändert → Kalenderwoche und Wochentag nachziehen, Hauptdatum des Formulars;
      // Arbeitsbeginn/-ende nur, wenn noch leer bzw. noch der Vorschlag des alten Datums (eigene Änderung bleibt)
      if (f.type === 'date') {
        const old = x.values[f.id];
        values = prefill(x.layout.fields.filter((g) => g.type === 'week' || g.type === 'weekday'), { date: v }, values);
        for (const g of x.layout.fields.filter((g) => g.type === 'time' && g.timeOf)) {
          const cur = values[g.id] ?? '';
          if (!cur || cur === workTimeFor(g, { date: old, workTimes })) values[g.id] = workTimeFor(g, { date: v, workTimes }) ?? '';
        }
      }
      return { ...x, values, date: mainDate(x.layout.fields, values) ?? x.date };
    });
  const setNo = (no: string) => update((x) => ({ ...x, no, values: prefill(x.layout.fields.filter((g) => g.type === 'no'), { no }, x.values) }));

  if (e === undefined) return <SiteNav />;
  if (e === null)
    return (
      <>
        <SiteNav />
        <div className="page">
          <p>Formular nicht gefunden.</p>
          <a className="btn" href={paths.reports()}>
            Zur Übersicht
          </a>
        </div>
      </>
    );

  const fields = readingOrder(e.layout.fields);
  const missing = missingRequired(e.layout.fields, e.values);
  const overflow = e.layout.fields.filter((f) => !fits(f, e.values[f.id] ?? '', measure).ok);
  const ready = missing.length === 0 && overflow.length === 0;
  const run = (fn: () => Promise<void>) => fn().catch((err) => showError(err, 'Das hat nicht geklappt'));
  const showPdf = () =>
    run(async () => {
      flush();
      setPreview(await formEntryPdf(e));
    });
  const copy = () =>
    run(async () => {
      flush();
      const c = await copyFormEntry(e, await listFormEntries(), session?.name ?? '');
      toast(`Kopie angelegt: ${c.templateName} Nr. ${c.no}.`, 'success');
      navigate(paths.formEntry(c.id));
    });
  const remove = () =>
    void confirmDialog({ title: 'Formular löschen?', message: <p>{e.templateName} Nr. {e.no} wird endgültig gelöscht.</p>, confirmLabel: 'Löschen', danger: true }).then((ok) => {
      if (!ok) return;
      void run(async () => {
        pending.current = null;
        window.clearTimeout(timer.current);
        await deleteFormEntry(e.id);
        toast('Formular gelöscht.', 'success');
        navigate(paths.reportSite(entrySiteKey(e)));
      });
    });
  const reloadProject = () =>
    run(async () => {
      const ctx = await prefillContext(e.projectId, e.siteName, e.date, e.no);
      update((x) => ({ ...x, values: prefill(x.layout.fields.filter((f) => f.type === 'project' || f.type === 'company'), ctx, x.values) }));
      toast('Angaben aus dem Projekt übernommen.', 'success');
    });
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  return (
    <>
      <SiteNav />
      <div className="page report-page form-entry-page" style={ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.reportSite(entrySiteKey(e))} className="icon-link" aria-label="Zum Projekt" title="Zum Projekt" data-testid="to-reports" onClick={flush}>
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="form-entry-title">
                {e.templateName} Nr. {e.no}
              </h1>
              <span className="muted small">
                {e.siteName} · {fmtFieldDate(e.date)} · {isoWeekLabel(e.date)} · <span data-testid="save-state">{saved ? 'gespeichert' : 'wird gespeichert …'}</span>
              </span>
            </div>
          </div>
          <div className="report-actions">
            <button type="button" className={`btn btn-sm report-status-btn ${e.status}`} onClick={() => update((x) => ({ ...x, status: x.status === 'done' ? 'draft' : 'done' }))} data-testid="form-entry-status">
              {e.status === 'done' ? (
                <>
                  <Icon name="check" size={16} /> Fertig
                </>
              ) : (
                'Entwurf · als fertig markieren'
              )}
            </button>
            <button type="button" className="btn btn-primary" onClick={showPdf} disabled={!ready} title={ready ? 'Ausgefülltes PDF ansehen und teilen' : 'Erst Pflichtfelder füllen und zu lange Texte kürzen'} data-testid="form-entry-pdf">
              <Icon name="pdf" /> PDF
            </button>
            <ActionMenu
              label="Weitere Aktionen"
              testId="form-entry-more"
              actions={[
                { label: showPreview ? 'Vorschau ausblenden' : 'Vorschau einblenden', icon: 'images', onSelect: () => setShowPreview((s) => !s), testId: 'form-entry-toggle-preview' },
                ...(e.projectId ? [{ label: 'Projektangaben erneut übernehmen', icon: 'refresh', onSelect: reloadProject, testId: 'form-entry-reload' }] : []),
                { label: 'Kopieren als neues Formular', icon: 'copy', onSelect: copy, testId: 'form-entry-copy' },
                { label: 'Löschen', icon: 'trash', danger: true, onSelect: remove, testId: 'form-entry-delete' },
              ]}
            />
          </div>
        </header>

        {(missing.length > 0 || overflow.length > 0) && (
          <div className="banner banner-warn form-entry-check" role="status" data-testid="form-entry-check">
            {missing.length > 0 && (
              <p>
                <strong>Pflichtfelder offen:</strong> {missing.map((f) => f.name).join(', ')}
              </p>
            )}
            {overflow.length > 0 && (
              <p>
                <strong>Text passt nicht in den Kasten:</strong> {overflow.map((f) => f.name).join(', ')} – bitte kürzen, sonst wird im PDF abgeschnitten.
              </p>
            )}
          </div>
        )}

        <div className={`form-entry${showPreview ? '' : ' no-preview'}`}>
          <div className="form-entry-fields">
            <section className="rp-section">
              <div className="rp-grid">
                <label className="field">
                  <span>Nr.</span>
                  <input value={e.no} onChange={(ev) => setNo(ev.target.value)} data-testid="form-entry-no" />
                </label>
              </div>
            </section>
            <section className="rp-section">
              {fields.length === 0 && <p className="muted">Diese Vorlage hat keine Felder. Bitte unter „Vorlagen“ Felder einrichten.</p>}
              {fields.map((f) => (
                <FieldInput key={f.id} f={f} value={e.values[f.id] ?? ''} measure={measure} people={people} onChange={(v) => setValue(f, v)} onFocus={() => setFocus(f.id)} />
              ))}
            </section>
            <div className="report-bottom">
              <button type="button" className="btn btn-primary" onClick={showPdf} disabled={!ready}>
                <Icon name="pdf" /> PDF ansehen / teilen
              </button>
              <a className="btn" href={paths.reportSite(entrySiteKey(e))} onClick={flush}>
                Fertig – zum Projekt
              </a>
            </div>
          </div>
          {showPreview && (
            <aside className="form-entry-preview" aria-label="Vorschau">
              <p className="muted small">Vorschau – zum Kontrollieren, eingetippt wird links.</p>
              <div ref={stage} className="form-preview-stage" style={{ aspectRatio: `${e.layout.width} / ${e.layout.height}` }} data-testid="form-entry-preview">
                {img ? <img src={img} alt="" draggable={false} /> : <div className="form-preview-blank" />}
                {e.layout.fields.map((f) => {
                  const text = displayValue(f, e.values[f.id]);
                  const size = Math.max(5, fontSizeOf(f) * pxPerPt);
                  const bad = !fits(f, e.values[f.id] ?? '', measure).ok;
                  return (
                    <div key={f.id} className={`form-preview-box${focus === f.id ? ' focus' : ''}${bad ? ' bad' : ''}`} style={{ left: pct(f.box.x, e.layout.width), top: pct(f.box.y, e.layout.height), width: pct(f.box.w, e.layout.width), height: pct(f.box.h, e.layout.height) }} title={f.name}>
                      {f.type === 'multiline' && f.pitch ? (
                        // Zeilenstreifen: jede Zeile an ihrer Stelle, Schrift auf der Schreiblinie
                        wrapToLines(f, text, measure)
                          .slice(0, lineCapacity(f))
                          .map((line, i) => {
                            const b = lineBoxes(f)[i];
                            return (
                              <span key={i} className="form-sample base" style={{ ...inkStyle(f), fontSize: size, top: pct(b.y - f.box.y, f.box.h), height: pct(b.h, f.box.h), left: pct(b.x - f.box.x, f.box.w), width: pct(b.w, f.box.w), right: 'auto', bottom: 'auto', paddingBottom: BASELINE_PT * pxPerPt, justifyContent: justifyOf(f) }}>
                                {line}
                              </span>
                            );
                          })
                      ) : f.type === 'multiline' ? (
                        <span className="form-sample multi" style={{ ...inkStyle(f), fontSize: size, lineHeight: `${(f.box.h / lineCapacity(f)) * pxPerPt}px` }}>
                          {text.split('\n').map((s, i) => (
                            <span key={i}>{s}</span>
                          ))}
                        </span>
                      ) : (
                        <span className={`form-sample${f.type === 'checkbox' ? '' : ' base'}`} style={{ ...inkStyle(f), fontSize: size, paddingBottom: f.type === 'checkbox' ? undefined : BASELINE_PT * pxPerPt, justifyContent: justifyOf(f) }}>
                          {text}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </div>
      {preview && <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={() => setPreview(null)} />}
    </>
  );
}

/** ein Eingabefeld je Typ */
function FieldInput({ f, value, measure, people, onChange, onFocus }: { f: CustomField; value: string; measure: Measure; people: string[]; onChange(v: string): void; onFocus(): void }) {
  const fit = fits(f, value, measure);
  const id = `ff-${f.id}`;
  const label = (
    <span className="form-entry-label">
      {f.name}
      {f.required && <b aria-label="Pflichtfeld"> *</b>}
      {f.type === 'multiline' && (
        <small className={fit.ok ? 'muted' : 'text-warn'} data-testid="form-entry-lines">
          Zeile {Math.max(1, fit.lines)} von {fit.capacity}
        </small>
      )}
    </span>
  );
  const hint = f.hint ? <small className="muted form-entry-hint">{f.hint}</small> : null;
  // einzeilige Felder: Enter springt zum nächsten Feld (mehrzeilig bleibt Enter = neue Zeile)
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || f.type === 'multiline' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const all = [...document.querySelectorAll<HTMLElement>('[data-testid="form-entry-field"]')];
    const next = all[all.indexOf(e.currentTarget) + 1];
    if (next) next.focus();
    else e.currentTarget.blur();
  };
  const common = { id, onFocus, onKeyDown, 'data-testid': 'form-entry-field', 'data-name': f.name, 'aria-invalid': (f.required && !value.trim()) || !fit.ok ? true : undefined };
  const suggestion = people.filter((p) => !value.toLowerCase().includes(p.toLowerCase()));
  const append = (...ns: string[]) => onChange([value.trim(), ...ns].filter(Boolean).join(', '));
  switch (f.type) {
    case 'multiline':
      return (
        <label className={`field form-entry-multi${fit.ok ? '' : ' overflow'}`} htmlFor={id}>
          {label}
          <textarea {...common} rows={Math.min(12, Math.max(2, fit.capacity))} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.hint} />
          {!fit.ok && <small className="text-warn">Zu lang: {fit.lines} Zeilen, Platz für {fit.capacity}. Bitte kürzen.</small>}
          {fit.ok && hint}
        </label>
      );
    case 'date':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
          {value && <small className="muted">{isoWeekLabel(value)}</small>}
          {hint}
        </label>
      );
    case 'week':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} type="number" inputMode="numeric" min={1} max={53} value={value} onChange={(e) => onChange(e.target.value)} />
          <small className="muted">{f.hint || 'wird aus dem Datum berechnet'}</small>
        </label>
      );
    case 'time':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} type="time" value={value} onChange={(e) => onChange(e.target.value)} />
          <small className="muted">{f.hint || (f.timeOf ? `Vorschlag: ${f.timeOf === 'from' ? 'Arbeitsbeginn' : 'Arbeitsende'} laut Arbeitszeiten der Firma` : '')}</small>
        </label>
      );
    case 'weekday':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} value={value} onChange={(e) => onChange(e.target.value)} placeholder="z. B. Montag" />
          <small className="muted">{f.hint || 'wird aus dem Datum berechnet'}</small>
        </label>
      );
    case 'number':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.hint} />
          {hint}
        </label>
      );
    case 'amount':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.hint || '0,00'} />
          {hint}
        </label>
      );
    case 'select':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">– bitte wählen –</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {hint}
        </label>
      );
    case 'checkbox':
      return (
        <label className="check-row form-entry-check-row" htmlFor={id}>
          <input {...common} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? 'x' : '')} />
          <span>
            {f.name}
            {f.required && <b> *</b>}
            {hint}
          </span>
        </label>
      );
    case 'person':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.hint || 'Namen, mit Komma getrennt'} />
          <span className="row gap wrap form-entry-people">
            {suggestion.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => append(...suggestion)} data-testid="form-entry-people-suggest" title="Laut Arbeitereinteilung an diesem Tag auf der Baustelle">
                Aus Einteilung: {suggestion.join(', ')}
              </button>
            )}
          </span>
          {hint}
        </label>
      );
    case 'no':
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} value={value} readOnly />
          <small className="muted">laufende Nummer – oben unter „Nr.“ ändern</small>
        </label>
      );
    default:
      return (
        <label className="field" htmlFor={id}>
          {label}
          <input {...common} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.hint} />
          {!fit.ok && <small className="text-warn">Zu lang für den Kasten – wird im PDF abgeschnitten.</small>}
          {fit.ok && hint}
        </label>
      );
  }
}
