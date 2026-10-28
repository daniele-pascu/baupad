import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { PdfPreview } from '../components/PdfPreview';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import type { ExportFile } from '../lib/aufmass';
import { getCompanyLogo } from '../lib/company';
import { addDays, DAY_NAMES, weekOf } from '../lib/crew';
import { deleteReport, getMeta, getReport, getWeek, listReports, listWorkers, loadProjectData, previousWeek, saveReport } from '../lib/db';
import { navigate, paths } from '../lib/router';
import { reportPdf } from '../lib/report-pdf';
import {
  copyReport,
  crewForDay,
  effectiveWeek,
  fmtDate,
  fmtHours,
  headFromProject,
  hoursFromTimes,
  newItem,
  periodLabel,
  siteKey,
  sumHours,
  today,
  typeInfo,
  workerHours,
  workerRow,
  type CrewSuggestion,
} from '../lib/reports';
import type { Absence, DailyData, RegieData, Report, ReportHead, ReportItem, ReportWorker, WeeklyData, Worker } from '../lib/types';
import { usePageTitle } from './SitePages';

/** PDF eines Berichts mit Firmenname und Firmenlogo (Einstellungen) */
export async function reportPdfFile(r: Report): Promise<ExportFile> {
  const [company, lines, logo] = await Promise.all([getMeta<string>('companyName'), getMeta<string>('companyLines'), getCompanyLogo()]);
  return reportPdf(r, { company: company ?? '', lines: lines ?? '', logo });
}

/** Eingeteilte Arbeiter der Baustelle des Berichts an einem Tag (Vorschlag aus der Arbeitereinteilung) */
async function suggestionsFor(r: Report, date: string): Promise<CrewSuggestion[]> {
  const wid = weekOf(date);
  const [saved, prev, workers, abs] = await Promise.all([getWeek(wid), previousWeek(wid), listWorkers(), getMeta<Absence[]>('absences')]);
  return crewForDay(effectiveWeek(wid, saved, prev), date, { projectId: r.projectId, name: r.head.site || r.head.project }, workers, abs ?? []);
}

const num = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const numText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

/**
 * Formular eines Berichts: Kopf (aus dem Projekt übernommen, änderbar), danach die Abschnitte je Typ.
 * Jede Änderung wird automatisch gespeichert.
 */
export function ReportEditorPage({ reportId }: { reportId: string }) {
  const [r, setR] = useState<Report | null | undefined>(undefined);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [saved, setSaved] = useState(true);
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const pending = useRef<Report | null>(null);
  const timer = useRef(0);
  usePageTitle(r ? `${typeInfo(r.type).label} Nr. ${r.no} – BauPad` : 'Bericht – BauPad');

  useEffect(() => {
    void Promise.all([getReport(reportId), listWorkers()])
      .then(([rep, w]) => {
        setR(rep ?? null);
        setWorkers(w.filter((x) => x.active));
      })
      .catch((e) => showError(e, 'Bericht konnte nicht geladen werden'));
  }, [reportId]);

  const flush = () => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next) saveReport(next).then(() => setSaved(true), (e) => showError(e, 'Speichern fehlgeschlagen'));
  };
  useEffect(() => flush, []);

  const update = (fn: (x: Report) => Report) =>
    setR((prev) => {
      if (!prev) return prev;
      const next = { ...fn(prev), updatedAt: Date.now() } as Report;
      pending.current = next;
      setSaved(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 350);
      return next;
    });
  const setHead = (patch: Partial<ReportHead>) => update((x) => ({ ...x, head: { ...x.head, ...patch } }));
  const setData = <T,>(patch: Partial<T>) => update((x) => ({ ...x, data: { ...x.data, ...patch } }) as Report);

  if (r === undefined) return <SiteNav />;
  if (r === null)
    return (
      <>
        <SiteNav />
        <div className="page">
          <p>Bericht nicht gefunden.</p>
          <a className="btn" href={paths.reports()}>
            Zur Übersicht
          </a>
        </div>
      </>
    );

  const info = typeInfo(r.type);
  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));
  const showPdf = () =>
    run(async () => {
      flush();
      setPreview(await reportPdfFile(r));
    });
  const print = () => {
    const win = window.open('', '_blank');
    run(async () => {
      const f = await reportPdfFile(r);
      const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: 'application/pdf' }));
      if (win) win.location.href = url;
      else setPreview(f);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  };
  const copy = () =>
    run(async () => {
      flush();
      const c = copyReport(r, r.type === 'woche' ? r.date : today(), await listReports());
      await saveReport(c);
      toast(`Kopie angelegt: ${info.label} Nr. ${c.no}.`, 'success');
      navigate(paths.report(c.id));
    });
  const remove = () =>
    void confirmDialog({ title: 'Bericht löschen?', message: <p>{info.label} Nr. {r.no} wird endgültig gelöscht.</p>, confirmLabel: 'Löschen', danger: true }).then((ok) => {
      if (!ok) return;
      void run(async () => {
        pending.current = null;
        window.clearTimeout(timer.current);
        await deleteReport(r.id);
        toast('Bericht gelöscht.', 'success');
        navigate(paths.reports());
      });
    });
  const reloadHead = () =>
    run(async () => {
      if (!r.projectId) return;
      const d = await loadProjectData(r.projectId);
      if (!d) return toast('Das Projekt gibt es nicht mehr.', 'error');
      setHead(headFromProject(d.project, d.costCenters.filter((c) => !c.deletedAt).sort((a, b) => a.sortIndex - b.sortIndex)));
      toast('Kopfdaten aus dem Projekt übernommen.', 'success');
    });
  const setDate = (date: string) => {
    if (!date) return;
    if (r.type !== 'woche') return update((x) => ({ ...x, date }));
    const monday = weekOf(date);
    update((x) => ({ ...x, date: monday, dateTo: addDays(monday, 6), data: { ...(x.data as WeeklyData), days: (x.data as WeeklyData).days.map((d, i) => ({ ...d, date: addDays(monday, i) })) } }) as Report);
  };

  return (
    <>
      <SiteNav />
      <div className="page report-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.reports()} className="icon-link" aria-label="Zur Übersicht" title="Zur Übersicht" data-testid="to-reports" onClick={flush}>
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="report-title">
                {info.label} Nr. {r.no}
              </h1>
              <span className="muted small">
                {r.head.site || r.head.project} · {periodLabel(r)} · <span data-testid="save-state">{saved ? 'gespeichert' : 'wird gespeichert …'}</span>
              </span>
            </div>
          </div>
          <div className="report-actions">
            <button type="button" className={`btn btn-sm report-status-btn ${r.status}`} onClick={() => update((x) => ({ ...x, status: x.status === 'done' ? 'draft' : 'done' }))} data-testid="report-status-toggle">
              {r.status === 'done' ? (
                <>
                  <Icon name="check" size={16} /> Fertig
                </>
              ) : (
                'Entwurf · als fertig markieren'
              )}
            </button>
            <button type="button" className="btn btn-primary" onClick={showPdf} data-testid="report-pdf-btn">
              <Icon name="pdf" /> PDF
            </button>
            <ActionMenu
              label="Weitere Aktionen"
              testId="report-more"
              actions={[
                { label: 'Drucken', icon: 'pdf', onSelect: print, testId: 'report-print' },
                { label: 'Kopieren als neuer Bericht', icon: 'copy', onSelect: copy, testId: 'report-copy' },
                { label: 'Löschen', icon: 'trash', danger: true, onSelect: remove, testId: 'report-delete' },
              ]}
            />
          </div>
        </header>

        <Section title="Baustelle & Datum">
          <div className="rp-grid">
            <Field label="Nr." value={r.no} onChange={(no) => update((x) => ({ ...x, no }))} testId="rp-no" narrow />
            <Field label={r.type === 'woche' ? 'Woche (Mo–So)' : 'Datum'} type="date" value={r.date} onChange={setDate} testId="rp-date" />
            {r.type === 'woche' && <p className="muted small rp-hint">{periodLabel(r)}</p>}
            <Field label="Bauvorhaben" value={r.head.project} onChange={(project) => setHead({ project })} testId="rp-project" wide />
            <Field label="Baustelle" value={r.head.site} onChange={(site) => setHead({ site })} testId="rp-site" wide />
            <Field label="Adresse" value={r.head.address} onChange={(address) => setHead({ address })} testId="rp-address" wide />
            <Field label="Auftraggeber" value={r.head.client} onChange={(client) => setHead({ client })} testId="rp-client" />
            <Field label="Projekt-Nr." value={r.head.number} onChange={(number) => setHead({ number })} testId="rp-number" />
            <Field label="Kostenstelle" value={r.head.costCenter} onChange={(costCenter) => setHead({ costCenter })} testId="rp-costcenter" />
            <Field label="Verantwortlich (optional)" value={r.head.responsible} onChange={(responsible) => setHead({ responsible })} testId="rp-responsible" />
          </div>
          {r.projectId && (
            <button type="button" className="btn btn-sm" onClick={reloadHead} data-testid="rp-reload-head">
              Kopfdaten erneut aus dem Projekt übernehmen
            </button>
          )}
        </Section>

        {r.type === 'regie' && <RegieForm r={r} data={r.data} workers={workers} setData={setData<RegieData>} />}
        {r.type === 'tag' && <DailyForm r={r} data={r.data} workers={workers} setData={setData<DailyData>} />}
        {r.type === 'woche' && <WeeklyForm r={r} data={r.data} setData={setData<WeeklyData>} />}

        <div className="report-bottom">
          <button type="button" className="btn btn-primary" onClick={showPdf}>
            <Icon name="pdf" /> PDF ansehen / teilen
          </button>
          <a className="btn" href={paths.reports()} onClick={flush}>
            Fertig – zur Übersicht
          </a>
        </div>
      </div>
      {preview && <PdfPreview file={preview} onBack={() => setPreview(null)} onClose={() => setPreview(null)} />}
    </>
  );
}

/* ───────────── gemeinsame Bausteine ───────────── */

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rp-section">
      <header className="rp-section-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  testId,
  wide,
  narrow,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  type?: string;
  testId?: string;
  wide?: boolean;
  narrow?: boolean;
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <label className={`field${wide ? ' rp-wide' : ''}${narrow ? ' rp-narrow' : ''}`}>
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} data-testid={testId} />
    </label>
  );
}

function TextBlock({ label, value, onChange, testId, placeholder, rows = 4 }: { label: string; value: string; onChange(v: string): void; testId: string; placeholder?: string; rows?: number }) {
  return (
    <Section title={label}>
      <textarea className="rp-text" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} data-testid={testId} />
    </Section>
  );
}

/** Material- bzw. Gerätezeilen */
function ItemRows({ title, items, onChange, testId, placeholder }: { title: string; items: ReportItem[]; onChange(list: ReportItem[]): void; testId: string; placeholder: string }) {
  const set = (id: string, patch: Partial<ReportItem>) => onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <Section title={title}>
      {items.length > 0 && (
        <div className="rp-items" data-testid={testId}>
          {items.map((x) => (
            <div key={x.id} className="rp-item" data-testid={`${testId}-row`}>
              <input value={numText(x.qty)} onChange={(e) => set(x.id, { qty: num(e.target.value) })} inputMode="decimal" placeholder="Menge" aria-label="Menge" className="rp-qty" />
              <input value={x.unit} onChange={(e) => set(x.id, { unit: e.target.value })} placeholder="EH" aria-label="Einheit" className="rp-unit" />
              <input value={x.text} onChange={(e) => set(x.id, { text: e.target.value })} placeholder={placeholder} aria-label="Bezeichnung" className="rp-desc" />
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => onChange(items.filter((y) => y.id !== x.id))} aria-label="Zeile entfernen">
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...items, newItem()])} data-testid={`${testId}-add`}>
        <Icon name="plus" size={16} /> Zeile hinzufügen
      </button>
    </Section>
  );
}

/**
 * Arbeiter aus der Arbeitereinteilung übernehmen (Vorschlag mit Auswahl) bzw. einzeln aus der Arbeiterliste
 * oder frei hinzufügen. Urlaub wird nicht vorausgewählt, krank gekennzeichnet.
 */
function CrewTools({ r, date, rows, workers, onAdd }: { r: Report; date: string; rows: ReportWorker[]; workers: Worker[]; onAdd(list: ReportWorker[]): void }) {
  const [sugg, setSugg] = useState<CrewSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const have = new Set(rows.map((x) => x.workerId).filter(Boolean));
  const load = () =>
    suggestionsFor(r, date)
      .then((list) => {
        setSugg(list);
        setPicked(new Set(list.filter((s) => s.absence !== 'urlaub' && !have.has(s.worker.id)).map((s) => s.worker.id)));
      })
      .catch((e) => showError(e));
  const others = workers.filter((w) => !have.has(w.id));
  return (
    <div className="rp-crew-tools">
      <div className="row gap wrap">
        <button type="button" className="btn btn-sm" onClick={load} data-testid="crew-import">
          <Icon name="calendar" size={16} /> Aus Arbeitereinteilung ({fmtDate(date)})
        </button>
        <select
          value=""
          onChange={(e) => {
            const w = workers.find((x) => x.id === e.target.value);
            if (e.target.value === 'frei') onAdd([workerRow()]);
            else if (w) onAdd([workerRow(w)]);
          }}
          className="rp-add-worker"
          aria-label="Arbeiter hinzufügen"
          data-testid="crew-add"
        >
          <option value="">+ Arbeiter hinzufügen …</option>
          {others.map((w) => (
            <option key={w.id} value={w.id}>
              {[w.firstName, w.lastName].filter(Boolean).join(' ')}
              {w.role ? ` – ${w.role}` : ''}
            </option>
          ))}
          <option value="frei">Name frei eingeben</option>
        </select>
      </div>
      {sugg && (
        <div className="rp-suggest" data-testid="crew-suggest">
          {sugg.length === 0 ? (
            <p className="muted small">Für diese Baustelle ist an diesem Tag niemand eingeteilt – Arbeiter einfach hinzufügen.</p>
          ) : (
            <>
              <p className="small">Laut Einteilung an diesem Tag auf der Baustelle – bitte prüfen:</p>
              {sugg.map((s) => (
                <label key={s.worker.id} className="check-row" data-testid="crew-suggest-row">
                  <input
                    type="checkbox"
                    disabled={have.has(s.worker.id)}
                    checked={picked.has(s.worker.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(s.worker.id);
                      else next.delete(s.worker.id);
                      setPicked(next);
                    }}
                  />
                  {[s.worker.firstName, s.worker.lastName].filter(Boolean).join(' ')}
                  {s.worker.role && <span className="muted small"> · {s.worker.role}</span>}
                  {s.absence && <span className={`rp-badge ${s.absence}`}>{s.absence === 'urlaub' ? 'Urlaub' : 'krank'}</span>}
                  {have.has(s.worker.id) && <span className="muted small"> (schon in der Liste)</span>}
                </label>
              ))}
              <div className="row gap">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!picked.size}
                  onClick={() => {
                    onAdd(sugg.filter((s) => picked.has(s.worker.id)).map((s) => workerRow(s.worker, { planned: true, note: s.absence === 'krank' ? 'krank' : undefined })));
                    setSugg(null);
                  }}
                  data-testid="crew-suggest-apply"
                >
                  {picked.size} übernehmen
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setSugg(null)}>
                  Schließen
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────── Regieliste ───────────── */

function RegieForm({ r, data, workers, setData }: { r: Report; data: RegieData; workers: Worker[]; setData(p: Partial<RegieData>): void }) {
  const setW = (id: string, patch: Partial<ReportWorker>) => setData({ workers: data.workers.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const total = sumHours(data.workers);
  return (
    <>
      <Section
        title="Personal und Stunden"
        aside={
          <label className="check-row small">
            <input type="checkbox" checked={data.overtime} onChange={(e) => setData({ overtime: e.target.checked })} data-testid="rp-overtime" />
            Überstunden 50 %/100 %
          </label>
        }
      >
        <CrewTools r={r} date={r.date} rows={data.workers} workers={workers} onAdd={(list) => setData({ workers: [...data.workers, ...list] })} />
        {data.workers.length > 0 && (
          <div className={`rp-workers regie${data.overtime ? ' ot' : ''}`} data-testid="rp-workers">
            <div className="rp-wh" aria-hidden="true">
              <span>Name</span>
              <span>Qualifikation</span>
              <span>von</span>
              <span>bis</span>
              <span>Pause (min)</span>
              <span>Std.</span>
              {data.overtime && (
                <>
                  <span>50 %</span>
                  <span>100 %</span>
                </>
              )}
              <span />
            </div>
            {data.workers.map((w) => {
              const auto = hoursFromTimes(w.from, w.to, w.pause);
              return (
                <div key={w.id} className="rp-w" data-testid="rp-worker">
                  <input value={w.name} onChange={(e) => setW(w.id, { name: e.target.value })} placeholder="Name" aria-label="Name" className="rp-name" data-testid="rp-worker-name" />
                  <input value={w.role} onChange={(e) => setW(w.id, { role: e.target.value })} placeholder="Qualifikation" aria-label="Qualifikation" />
                  <input type="time" value={w.from} onChange={(e) => setW(w.id, { from: e.target.value })} aria-label="Beginn" data-testid="rp-worker-from" />
                  <input type="time" value={w.to} onChange={(e) => setW(w.id, { to: e.target.value })} aria-label="Ende" data-testid="rp-worker-to" />
                  <input value={w.pause} onChange={(e) => setW(w.id, { pause: e.target.value })} inputMode="numeric" placeholder="Pause min" aria-label="Pause in Minuten" data-testid="rp-worker-pause" />
                  <input
                    value={numText(w.hours)}
                    onChange={(e) => setW(w.id, { hours: num(e.target.value) })}
                    inputMode="decimal"
                    placeholder={auto !== null ? fmtHours(auto) : 'Std.'}
                    aria-label="Stunden"
                    title={auto !== null && w.hours === null ? 'aus Beginn, Ende und Pause berechnet' : undefined}
                    data-testid="rp-worker-hours"
                  />
                  {data.overtime && (
                    <>
                      <input value={numText(w.ot50)} onChange={(e) => setW(w.id, { ot50: num(e.target.value) })} inputMode="decimal" placeholder="–" aria-label="davon 50 %" />
                      <input value={numText(w.ot100)} onChange={(e) => setW(w.id, { ot100: num(e.target.value) })} inputMode="decimal" placeholder="–" aria-label="davon 100 %" />
                    </>
                  )}
                  <button type="button" className="icon-btn icon-btn-sm" onClick={() => setData({ workers: data.workers.filter((x) => x.id !== w.id) })} aria-label="Arbeiter entfernen" data-testid="rp-worker-remove">
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {total !== null && (
          <p className="rp-total" data-testid="rp-total">
            Summe: <strong>{fmtHours(total)} Std.</strong>
            {data.workers.some((w) => workerHours(w) === null) && <span className="muted small"> (ohne Arbeiter ohne Stundenangabe)</span>}
          </p>
        )}
      </Section>
      <TextBlock label="Tätigkeiten / ausgeführte Arbeiten" value={data.work} onChange={(work) => setData({ work })} testId="rp-work" placeholder="Was wurde in Regie gearbeitet? Wo, auf wessen Anordnung?" />
      <ItemRows title="Material" items={data.materials} onChange={(materials) => setData({ materials })} testId="rp-materials" placeholder="z. B. Reparaturmörtel" />
      <ItemRows title="Geräte" items={data.equipment} onChange={(equipment) => setData({ equipment })} testId="rp-equipment" placeholder="z. B. Stemmhammer" />
      <TextBlock label="Bemerkungen" value={data.notes} onChange={(notes) => setData({ notes })} testId="rp-notes" rows={3} />
    </>
  );
}

/* ───────────── Bautagesbericht ───────────── */

const WEATHER = ['sonnig', 'heiter', 'bewölkt', 'Regen', 'Schnee', 'Wind/Sturm', 'Frost', 'Nebel'];

function DailyForm({ r, data, workers, setData }: { r: Report; data: DailyData; workers: Worker[]; setData(p: Partial<DailyData>): void }) {
  const setW = (id: string, patch: Partial<ReportWorker>) => setData({ crew: data.crew.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const present = data.crew.filter((w) => w.present);
  const unconfirmed = data.crew.filter((w) => w.planned && w.present === undefined);
  return (
    <>
      <Section title="Arbeitszeit und Wetter">
        <div className="rp-grid">
          <Field label="Arbeitszeit von" type="time" value={data.from} onChange={(from) => setData({ from })} testId="rp-from" />
          <Field label="bis" type="time" value={data.to} onChange={(to) => setData({ to })} testId="rp-to" />
          <label className="field">
            <span>Wetter</span>
            <input list="rp-weather" value={data.weather} onChange={(e) => setData({ weather: e.target.value })} placeholder="z. B. bewölkt" data-testid="rp-weather" />
            <datalist id="rp-weather">
              {WEATHER.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
          </label>
          <Field label="Temperatur min. (°C)" value={data.tempMin} onChange={(tempMin) => setData({ tempMin })} inputMode="decimal" testId="rp-tmin" narrow />
          <Field label="max. (°C)" value={data.tempMax} onChange={(tempMax) => setData({ tempMax })} inputMode="decimal" testId="rp-tmax" narrow />
        </div>
      </Section>
      <Section title="Mannschaft">
        <CrewTools r={r} date={r.date} rows={data.crew} workers={workers} onAdd={(list) => setData({ crew: [...data.crew, ...list.map((w) => (w.planned ? w : { ...w, present: true }))] })} />
        {unconfirmed.length > 0 && (
          <div className="banner banner-info rp-confirm" data-testid="rp-unconfirmed">
            <p>
              {unconfirmed.length} laut Einteilung – Anwesenheit noch nicht bestätigt. Einteilung und tatsächliche Mannschaft können abweichen.
            </p>
            <button type="button" className="btn btn-sm" onClick={() => setData({ crew: data.crew.map((w) => (w.planned && w.present === undefined ? { ...w, present: true } : w)) })} data-testid="rp-all-present">
              Alle als anwesend bestätigen
            </button>
          </div>
        )}
        {data.crew.length > 0 && (
          <div className="rp-workers daily" data-testid="rp-crew">
            {data.crew.map((w) => (
              <div key={w.id} className={`rp-w${w.present === false ? ' absent' : ''}`} data-testid="rp-crew-row">
                <label className="rp-present" title="anwesend">
                  <input
                    type="checkbox"
                    checked={!!w.present}
                    ref={(el) => {
                      if (el) el.indeterminate = w.present === undefined;
                    }}
                    onChange={(e) => setW(w.id, { present: e.target.checked })}
                    aria-label={`${w.name || 'Arbeiter'} anwesend`}
                    data-testid="rp-crew-present"
                  />
                </label>
                <input value={w.name} onChange={(e) => setW(w.id, { name: e.target.value })} placeholder="Name" aria-label="Name" className="rp-name" />
                <input value={w.role} onChange={(e) => setW(w.id, { role: e.target.value })} placeholder="Qualifikation" aria-label="Qualifikation" />
                <input value={numText(w.hours)} onChange={(e) => setW(w.id, { hours: num(e.target.value) })} inputMode="decimal" placeholder="Std. (opt.)" aria-label="Stunden" />
                <span className="rp-tags">
                  {w.planned && <span className="rp-badge">laut Einteilung</span>}
                  {w.note && <span className="rp-badge krank">{w.note}</span>}
                </span>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setData({ crew: data.crew.filter((x) => x.id !== w.id) })} aria-label="Entfernen">
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="rp-grid rp-count">
          <p className="rp-total" data-testid="rp-present-count">
            Anwesend: <strong>{present.length}</strong> {present.length === 1 ? 'Person' : 'Personen'}
          </p>
          <Field
            label="Anzahl abweichend / ohne Namen (optional)"
            value={numText(data.crewCount)}
            onChange={(v) => setData({ crewCount: num(v) === null ? null : Math.max(0, Math.round(num(v)!)) })}
            inputMode="numeric"
            testId="rp-crew-count"
          />
        </div>
      </Section>
      <TextBlock label="Durchgeführte Arbeiten" value={data.work} onChange={(work) => setData({ work })} testId="rp-work" placeholder="Was wurde heute wo gemacht?" />
      <ItemRows title="Material" items={data.materials} onChange={(materials) => setData({ materials })} testId="rp-materials" placeholder="Bezeichnung" />
      <ItemRows title="Geräte" items={data.equipment} onChange={(equipment) => setData({ equipment })} testId="rp-equipment" placeholder="Bezeichnung" />
      <TextBlock label="Besondere Vorkommnisse / Behinderungen" value={data.incidents} onChange={(incidents) => setData({ incidents })} testId="rp-incidents" rows={3} />
      <TextBlock label="Bemerkungen" value={data.notes} onChange={(notes) => setData({ notes })} testId="rp-notes" rows={3} />
    </>
  );
}

/* ───────────── Bauwochenbericht ───────────── */

function WeeklyForm({ r, data, setData }: { r: Report; data: WeeklyData; setData(p: Partial<WeeklyData>): void }) {
  const setDay = (i: number, patch: Partial<WeeklyData['days'][number]>) => setData({ days: data.days.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
  const run = (fn: () => Promise<void>) => fn().catch((e) => showError(e, 'Das hat nicht geklappt'));

  /** Mannschaft je Tag aus der Arbeitereinteilung – nur leere Tage werden ergänzt */
  const fromCrew = () =>
    run(async () => {
      let n = 0;
      const days = await Promise.all(
        data.days.map(async (d) => {
          if (d.count !== null || d.names.trim()) return d;
          const s = (await suggestionsFor(r, d.date)).filter((x) => x.absence !== 'urlaub');
          if (!s.length) return d;
          n++;
          return { ...d, count: s.length, names: s.map((x) => [x.worker.firstName, x.worker.lastName].filter(Boolean).join(' ')).join(', ') };
        }),
      );
      setData({ days });
      toast(n ? `Mannschaft für ${n} ${n === 1 ? 'Tag' : 'Tage'} übernommen – bitte prüfen. Bereits ausgefüllte Tage bleiben unverändert.` : 'Keine Einteilung für leere Tage gefunden.', n ? 'success' : 'info', 5000);
    });

  /** Aus Bautagesberichten derselben Baustelle – nur leere Felder werden ergänzt, Vorkommnisse angehängt */
  const fromDaily = () =>
    run(async () => {
      const key = siteKey(r);
      const daily = (await listReports()).filter((x): x is Extract<Report, { type: 'tag' }> => x.type === 'tag' && siteKey(x) === key && x.date >= r.date && x.date <= (r.dateTo ?? r.date));
      if (!daily.length) return toast('Für diese Baustelle gibt es in dieser Woche keine Bautagesberichte.', 'info');
      let events = data.events;
      const days = data.days.map((d) => {
        const t = daily.filter((x) => x.date === d.date);
        if (!t.length) return d;
        const present = t.flatMap((x) => x.data.crew.filter((w) => w.present && w.name.trim()).map((w) => w.name.trim()));
        const count = t.map((x) => x.data.crewCount ?? x.data.crew.filter((w) => w.present).length).reduce((a, b) => Math.max(a, b), 0);
        const work = t.map((x) => x.data.work.trim()).filter(Boolean).join('\n');
        for (const x of t) {
          const line = x.data.incidents.trim() && `${fmtDate(d.date)}: ${x.data.incidents.trim()}`;
          if (line && !events.includes(line)) events = [events.trim(), line].filter(Boolean).join('\n');
        }
        return {
          ...d,
          count: d.count ?? (count || null),
          names: d.names.trim() ? d.names : [...new Set(present)].join(', '),
          work: d.work.trim() ? d.work : work,
        };
      });
      setData({ days, events });
      toast(`${daily.length} Bautagesbericht(e) übernommen – bitte prüfen. Bereits ausgefüllte Felder bleiben unverändert.`, 'success', 5000);
    });

  return (
    <>
      <Section title="Wochenübersicht">
        <div className="row gap wrap rp-week-tools">
          <button type="button" className="btn btn-sm" onClick={fromDaily} data-testid="rp-from-daily">
            Aus Bautagesberichten übernehmen
          </button>
          <button type="button" className="btn btn-sm" onClick={fromCrew} data-testid="rp-from-crew">
            <Icon name="calendar" size={16} /> Mannschaft aus Arbeitereinteilung
          </button>
        </div>
        <div className="rp-days">
          {data.days.map((d, i) => (
            <div key={d.date} className="rp-day" data-testid="rp-day" data-date={d.date}>
              <div className="rp-day-head">
                <strong>{DAY_NAMES[i]}</strong>
                <span className="muted small">{fmtDate(d.date, false)}</span>
              </div>
              <div className="rp-day-crew">
                <input value={numText(d.count)} onChange={(e) => setDay(i, { count: num(e.target.value) === null ? null : Math.max(0, Math.round(num(e.target.value)!)) })} inputMode="numeric" placeholder="Anz." aria-label="Mannschaftsstärke" className="rp-count-input" data-testid="rp-day-count" />
                <input value={d.names} onChange={(e) => setDay(i, { names: e.target.value })} placeholder="Namen (optional)" aria-label="Namen" data-testid="rp-day-names" />
              </div>
              <textarea rows={2} value={d.work} onChange={(e) => setDay(i, { work: e.target.value })} placeholder="Durchgeführte Arbeiten" aria-label={`Arbeiten ${DAY_NAMES[i]}`} data-testid="rp-day-work" />
            </div>
          ))}
        </div>
      </Section>
      <TextBlock label="Wichtige Ereignisse / Behinderungen" value={data.events} onChange={(events) => setData({ events })} testId="rp-events" rows={3} />
      <TextBlock label="Bemerkungen" value={data.notes} onChange={(notes) => setData({ notes })} testId="rp-notes" rows={3} />
      <TextBlock label="Offene Punkte" value={data.open} onChange={(open) => setData({ open })} testId="rp-open" rows={3} />
    </>
  );
}
