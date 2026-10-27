import { useEffect, useMemo, useState, type CSSProperties, type InputHTMLAttributes } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { confirmDialog, showError, toast } from '../components/ui';
import {
  addDays,
  addSite,
  assign,
  carryOver,
  DAY_NAMES,
  DAY_SHORT,
  dayDate,
  dayList,
  DEFAULT_WORK_TIMES,
  emptyWeek,
  isoWeekNo,
  moveWorker,
  removeSite,
  setVacation,
  siteFromProject,
  sitesOf,
  sortWorkers,
  timeLabel,
  unassign,
  unassigned,
  updateSite,
  vacationSummary,
  visibleDays,
  weekOf,
  weekRange,
  workerName,
} from '../lib/crew';
import { getMeta, getWeek, listProjects, listWorkers, previousWeek, saveWeek, saveWorker, setMeta } from '../lib/db';
import { uuid } from '../lib/ids';
import { paths } from '../lib/router';
import type { Project, WeekPlan, WeekSite, Worker, WorkTimes } from '../lib/types';
import { usePageTitle } from './SitePages';

const ACCENT = { '--tool': '#2f80ed' } as CSSProperties;

/**
 * Arbeitereinteilung: Wochenplanung nach Baustellen (Baustelle → Tag → Arbeiter). Jede Woche ist ein
 * eigener Datensatz; eine neue Woche läuft mit den Baustellen und Arbeitern der Vorwoche weiter.
 */
export function WorkersPage() {
  usePageTitle('Arbeitereinteilung – BauPad');
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [times, setTimes] = useState<WorkTimes | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [weekId, setWeekId] = useState(() => weekOf(new Date()));
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  /** nicht gespeicherte Woche: aus dieser Woche weitergeführt (bzw. leer) */
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<
    | { kind: 'workers' }
    | { kind: 'times' }
    | { kind: 'site'; site?: WeekSite }
    | { kind: 'assign'; siteId: string; days: number[] }
    | { kind: 'chip'; siteId: string; day: number; workerId: string }
    | { kind: 'open'; day: number; workerId: string }
    | null
  >(null);

  useEffect(() => {
    void Promise.all([listWorkers(), getMeta<WorkTimes>('workTimes'), listProjects()])
      .then(([w, t, p]) => {
        setWorkers(w);
        setTimes(t ?? null);
        setProjects(p);
      })
      .catch((e) => showError(e, 'Arbeitereinteilung konnte nicht geladen werden'));
  }, []);

  useEffect(() => {
    let off = false;
    setPlan(null);
    void (async () => {
      const saved = await getWeek(weekId);
      if (off) return;
      if (saved) {
        setPlan(saved);
        setDraftFrom(null);
        return;
      }
      const prev = await previousWeek(weekId);
      if (off) return;
      setPlan(prev ? carryOver(prev, weekId) : emptyWeek(weekId));
      setDraftFrom(prev ? prev.id : '');
    })().catch((e) => showError(e, 'Woche konnte nicht geladen werden'));
    return () => {
      off = true;
    };
  }, [weekId]);

  const byId = useMemo(() => new Map((workers ?? []).map((w) => [w.id, w])), [workers]);
  const active = useMemo(() => sortWorkers((workers ?? []).filter((w) => w.active)), [workers]);
  const workTimes = times ?? DEFAULT_WORK_TIMES;
  const nameOf = (id: string) => (byId.get(id) ? workerName(byId.get(id)!) : 'Unbekannt');

  /** Woche speichern (jede Änderung sofort, nur diese Woche) */
  const save = (next: WeekPlan) => {
    setPlan(next);
    setDraftFrom(null);
    saveWeek(next).catch((e) => showError(e, 'Speichern fehlgeschlagen'));
  };

  const saveWorkers = async (w: Worker) => {
    await saveWorker(w);
    setWorkers((list) => [...(list ?? []).filter((x) => x.id !== w.id), w]);
  };

  /** Konflikt prüfen: Arbeiter am selben Tag schon auf einer anderen Baustelle → nach Bestätigung trotzdem */
  const confirmConflicts = async (p: WeekPlan, siteId: string, days: number[], ids: string[]) => {
    const lines: string[] = [];
    for (const id of ids)
      for (const d of days) {
        const other = sitesOf(p, id, d, siteId);
        if (other.length) lines.push(`${nameOf(id)}: ${DAY_NAMES[d]} auf ${other.map((s) => s.name).join(', ')}`);
      }
    if (!lines.length) return true;
    return confirmDialog({
      title: 'Schon auf einer anderen Baustelle',
      message: (
        <>
          <p>Diese Arbeiter sind zur gleichen Zeit bereits eingeteilt:</p>
          <ul data-testid="conflict-list">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="muted">Trotzdem zusätzlich einteilen (z. B. bei unterschiedlichen Einsatzzeiten)?</p>
        </>
      ),
      confirmLabel: 'Trotzdem einteilen',
    });
  };

  if (!workers || times === undefined || !plan)
    return (
      <>
        <SiteNav />
        <div className="page loading">Arbeitereinteilung wird geladen …</div>
      </>
    );

  const days = visibleDays(plan);
  const workDays = days.filter((d) => workTimes[d]);
  const open = workDays.map((d) => ({ d, list: unassigned(plan, sortWorkers(workers), d) })).filter((x) => x.list.length);
  const vacations = vacationSummary(plan, days);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <SiteNav />
      <div className="page crew-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="workers-title">Arbeitereinteilung</h1>
          </div>
        </header>

        <div className="crew-actions">
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'workers' })} data-testid="crew-workers">
            <ToolIcon name="workers" size={18} /> Arbeiter ({active.length})
          </button>
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'times' })} data-testid="crew-times">
            <Icon name="calendar" size={18} /> Arbeitszeit
          </button>
        </div>

        {times === null && (
          <div className="crew-setup" style={ACCENT} data-testid="crew-setup-times">
            <span className="tool-icon">
              <Icon name="calendar" size={22} />
            </span>
            <div>
              <strong>Arbeitszeit der Firma festlegen</strong>
              <p className="muted small">Einmal eintragen – gilt dann für alle Baustellen und Wochen.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'times' })}>
              Festlegen
            </button>
          </div>
        )}
        {active.length === 0 && (
          <div className="crew-setup" style={ACCENT} data-testid="crew-setup-workers">
            <span className="tool-icon">
              <ToolIcon name="workers" size={22} />
            </span>
            <div>
              <strong>Arbeiter anlegen</strong>
              <p className="muted small">Die Arbeiterliste wird einmal angelegt und jede Woche wiederverwendet.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'workers' })}>
              Anlegen
            </button>
          </div>
        )}

        <div className="crew-week" data-testid="crew-week">
          <button type="button" className="icon-btn" onClick={() => setWeekId(addDays(weekId, -7))} aria-label="Vorige Woche" data-testid="week-prev">
            <Icon name="back" />
          </button>
          <div className="crew-week-label">
            <strong data-testid="week-label">KW {isoWeekNo(weekId)}</strong>
            <span className="muted">{weekRange(weekId, plan.showWeekend ? 6 : 4)}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setWeekId(addDays(weekId, 7))} aria-label="Nächste Woche" data-testid="week-next">
            <Icon name="next" />
          </button>
          <label className="crew-date" title="Datum wählen">
            <span className="sr-only">Datum wählen</span>
            <input type="date" value={weekId} onChange={(e) => e.target.value && setWeekId(weekOf(e.target.value))} data-testid="week-date" />
          </label>
          {weekId !== weekOf(new Date()) && (
            <button type="button" className="btn btn-sm" onClick={() => setWeekId(weekOf(new Date()))} data-testid="week-today">
              Diese Woche
            </button>
          )}
          <label className="check-row crew-weekend">
            <input type="checkbox" checked={!!plan.showWeekend} onChange={(e) => save({ ...plan, showWeekend: e.target.checked, updatedAt: Date.now() })} data-testid="week-weekend" />
            Sa/So
          </label>
        </div>

        {draftFrom !== null && plan.sites.length > 0 && (
          <div className="banner banner-info" role="status" data-testid="draft-banner">
            <p>
              Weitergeführt aus <strong>KW {isoWeekNo(draftFrom)}</strong>: gleiche Baustellen und Arbeiter. Änderungen gelten nur für diese Woche – die Vorwoche bleibt
              unverändert.
            </p>
          </div>
        )}

        {open.length > 0 ? (
          <section className="crew-open" data-testid="crew-open">
            <h2>
              <Icon name="info" size={18} /> Noch nicht eingeteilt
            </h2>
            {open.map(({ d, list }) => (
              <div key={d} className="crew-open-row" data-day={d}>
                <span className="crew-open-day">{DAY_SHORT[d]}</span>
                <span className="crew-chips">
                  {list.map((w) => (
                    <button key={w.id} type="button" className="crew-chip open" onClick={() => setDialog({ kind: 'open', day: d, workerId: w.id })} data-testid="open-chip">
                      {workerName(w)}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ) : (
          plan.sites.length > 0 &&
          active.length > 0 && (
            <p className="crew-all-set" data-testid="crew-all-set">
              <Icon name="check" size={18} /> Alle Arbeiter sind eingeteilt.
            </p>
          )
        )}
        {vacations.length > 0 && (
          <p className="crew-vacations" data-testid="crew-vacations">
            <strong>Urlaub:</strong>
            {vacations.map((v) => (
              <span key={v.workerId} className="crew-chip vacation" data-testid="vacation-chip">
                {nameOf(v.workerId)} · {dayList(v.days)}
              </span>
            ))}
          </p>
        )}

        <section className="crew-sites">
          {plan.sites.map((s) => {
            const isOpen = !collapsed.has(s.id);
            const count = new Set(s.days.flat()).size;
            return (
              <article key={s.id} className={`crew-site${s.finished ? ' finished' : ''}`} data-testid="site-card" data-site={s.name}>
                <header className="crew-site-head">
                  <button type="button" className="crew-site-toggle" aria-expanded={isOpen} onClick={() => toggle(s.id)} data-testid="site-toggle">
                    <Icon name="next" size={18} />
                    <span className="crew-site-title">
                      <strong data-testid="site-name">{s.name}</strong>
                      <span className="muted small">
                        {[s.number, s.address].filter(Boolean).join(' · ')}
                        {s.finished && <span className="crew-finished"> · fertiggestellt</span>}
                      </span>
                    </span>
                    <span className="crew-count" title="Arbeiter in dieser Woche">
                      {count}
                    </span>
                  </button>
                  <ActionMenu
                    label={`Aktionen für ${s.name}`}
                    testId="site-actions"
                    actions={[
                      { label: 'Arbeiter einteilen (ganze Woche)', icon: 'plus', onSelect: () => setDialog({ kind: 'assign', siteId: s.id, days: workDays }), testId: 'site-assign' },
                      { label: 'Baustelle bearbeiten', icon: 'edit', onSelect: () => setDialog({ kind: 'site', site: s }), testId: 'site-edit' },
                      {
                        label: s.finished ? 'Wieder als laufend markieren' : 'Fertiggestellt (ab nächster Woche weg)',
                        icon: 'check',
                        onSelect: () => save(updateSite(plan, s.id, { finished: !s.finished })),
                        testId: 'site-finish',
                      },
                      {
                        label: 'Aus dieser Woche entfernen',
                        icon: 'trash',
                        danger: true,
                        onSelect: () =>
                          void confirmDialog({
                            title: 'Baustelle entfernen?',
                            message: <p>„{s.name}“ und ihre Einteilung werden aus dieser Woche entfernt. Andere Wochen bleiben unverändert.</p>,
                            confirmLabel: 'Entfernen',
                            danger: true,
                          }).then((ok) => ok && save(removeSite(plan, s.id))),
                        testId: 'site-remove',
                      },
                    ]}
                  />
                </header>
                {isOpen && (
                  <div className="crew-days">
                    {days.map((d) => (
                      <div key={d} className={`crew-day${workTimes[d] ? '' : ' off'}`} data-testid="day-row" data-day={d}>
                        <span className="crew-day-label">
                          <strong>
                            {DAY_SHORT[d]} {dayDate(weekId, d)}
                          </strong>
                          <span className="muted small">{timeLabel(workTimes[d])}</span>
                        </span>
                        <span className="crew-chips">
                          {s.days[d].map((id) => (
                            <button
                              key={id}
                              type="button"
                              className={`crew-chip${byId.get(id)?.active === false ? ' inactive' : ''}${sitesOf(plan, id, d, s.id).length ? ' conflict' : ''}`}
                              onClick={() => setDialog({ kind: 'chip', siteId: s.id, day: d, workerId: id })}
                              data-testid="crew-chip"
                              data-worker={nameOf(id)}
                            >
                              {nameOf(id)}
                            </button>
                          ))}
                          <button type="button" className="crew-add" onClick={() => setDialog({ kind: 'assign', siteId: s.id, days: [d] })} aria-label={`Arbeiter für ${DAY_NAMES[d]} einteilen`} data-testid="day-add">
                            <Icon name="plus" size={16} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
          {plan.sites.length === 0 && (
            <div className="empty" data-testid="crew-empty">
              <p>Noch keine Baustelle in dieser Woche.</p>
              <p className="muted">Baustelle aus der Projektverwaltung wählen oder manuell anlegen, dann die Arbeiter je Tag einteilen.</p>
            </div>
          )}
          <button type="button" className="btn btn-primary crew-add-site" onClick={() => setDialog({ kind: 'site' })} data-testid="add-site">
            <Icon name="plus" /> Baustelle
          </button>
        </section>
      </div>

      {dialog?.kind === 'workers' && <WorkersDialog workers={workers} onSave={saveWorkers} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'times' && (
        <TimesDialog
          times={workTimes}
          onClose={() => setDialog(null)}
          onSave={(t) => {
            setTimes(t);
            setDialog(null);
            setMeta('workTimes', t).catch((e) => showError(e));
            toast('Arbeitszeit gespeichert.', 'success');
          }}
        />
      )}
      {dialog?.kind === 'site' && (
        <SiteDialog
          site={dialog.site}
          projects={projects}
          taken={plan.sites.map((s) => s.projectId).filter(Boolean) as string[]}
          onClose={() => setDialog(null)}
          onSave={(fields) => {
            if (dialog.site) save(updateSite(plan, dialog.site.id, fields));
            else {
              const r = addSite(plan, fields);
              save(r.week);
              setDialog({ kind: 'assign', siteId: r.site.id, days: workDays });
              return;
            }
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'assign' && (
        <AssignDialog
          plan={plan}
          site={plan.sites.find((s) => s.id === dialog.siteId)!}
          days={days}
          initialDays={dialog.days}
          workers={active}
          onClose={() => setDialog(null)}
          onSave={async (ids, ds) => {
            if (!(await confirmConflicts(plan, dialog.siteId, ds, ids))) return;
            save(assign(plan, dialog.siteId, ds, ids));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'chip' && (
        <ChipDialog
          plan={plan}
          name={nameOf(dialog.workerId)}
          siteId={dialog.siteId}
          day={dialog.day}
          onClose={() => setDialog(null)}
          onRemove={() => {
            save(unassign(plan, dialog.siteId, dialog.day, dialog.workerId));
            setDialog(null);
          }}
          onMove={async (to) => {
            const moved = moveWorker(plan, dialog.workerId, dialog.siteId, to, dialog.day);
            const target = moved.sites.find((s) => s.id === to)!;
            const ds = target.days.map((l, d) => (l.includes(dialog.workerId) ? d : -1)).filter((d) => d >= dialog.day);
            if (!(await confirmConflicts(unassignAll(plan, dialog.workerId, dialog.siteId, dialog.day), to, ds, [dialog.workerId]))) return;
            save(moved);
            setDialog(null);
            toast(`${nameOf(dialog.workerId)} ab ${DAY_NAMES[dialog.day]} auf ${target.name}.`, 'success');
          }}
          onVacation={(week) => {
            save(setVacation(plan, dialog.workerId, week ? workDays.filter((d) => d >= dialog.day) : [dialog.day], true));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'open' && (
        <OpenDialog
          plan={plan}
          worker={byId.get(dialog.workerId)!}
          day={dialog.day}
          onClose={() => setDialog(null)}
          onAssign={(siteId, rest) => {
            const ds = rest ? workDays.filter((d) => d >= dialog.day && unassigned(plan, workers, d).some((w) => w.id === dialog.workerId)) : [dialog.day];
            save(assign(plan, siteId, ds, [dialog.workerId]));
            setDialog(null);
          }}
          onVacation={(rest) => {
            save(setVacation(plan, dialog.workerId, rest ? workDays.filter((d) => d >= dialog.day) : [dialog.day], true));
            setDialog(null);
          }}
        />
      )}
    </>
  );
}

/** Woche ohne die Einteilung des Arbeiters auf `siteId` ab `fromDay` (für die Konfliktprüfung beim Verschieben) */
function unassignAll(p: WeekPlan, workerId: string, siteId: string, fromDay: number): WeekPlan {
  let next = p;
  for (let d = fromDay; d < 7; d++) next = unassign(next, siteId, d, workerId);
  return next;
}

/** Arbeiterliste: anlegen, bearbeiten, aktiv/inaktiv */
function WorkersDialog({ workers, onSave, onClose }: { workers: Worker[]; onSave(w: Worker): Promise<void>; onClose(): void }) {
  const blank = { firstName: '', lastName: '', staffNo: '', phone: '', role: '' };
  const [edit, setEdit] = useState<Worker | null>(null);
  const [v, setV] = useState(blank);
  const [show, setShow] = useState(false);
  const list = sortWorkers(workers);
  const startEdit = (w: Worker | null) => {
    setEdit(w);
    setV(w ? { firstName: w.firstName, lastName: w.lastName, staffNo: w.staffNo ?? '', phone: w.phone ?? '', role: w.role ?? '' } : blank);
    setShow(false);
  };
  const submit = async () => {
    setShow(true);
    if (!v.firstName.trim()) return;
    const now = Date.now();
    const w: Worker = {
      ...(edit ?? { id: uuid(), active: true, createdAt: now }),
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      staffNo: v.staffNo.trim(),
      phone: v.phone.trim(),
      role: v.role.trim(),
      updatedAt: now,
    } as Worker;
    // Formular sofort leeren – der nächste Name kann gleich eingegeben werden
    const was = edit;
    startEdit(null);
    try {
      await onSave(w);
      toast(`${workerName(w)} ${was ? 'gespeichert' : 'angelegt'}.`, 'success');
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    }
  };
  const field = (k: keyof typeof blank, label: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} autoComplete="off" data-testid={`worker-${k}`} {...extra} />
    </label>
  );
  return (
    <Modal title="Arbeiter" onClose={onClose} testId="workers-dialog" wide>
      <form
        className="crew-worker-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3>{edit ? `${workerName(edit)} bearbeiten` : 'Neuer Arbeiter'}</h3>
        <div className="form-grid">
          {field('firstName', 'Vorname *', { 'aria-invalid': show && !v.firstName.trim() ? true : undefined })}
          {field('lastName', 'Nachname')}
          {field('role', 'Tätigkeit / Qualifikation (optional)', { placeholder: 'z. B. Polier, Maurer' })}
          {field('staffNo', 'Personalnummer (optional)')}
          {field('phone', 'Telefon (optional)', { type: 'tel', inputMode: 'tel' })}
        </div>
        {show && !v.firstName.trim() && <p className="error small">Bitte einen Vornamen eingeben.</p>}
        <div className="row gap wrap">
          <button type="submit" className="btn btn-primary" data-testid="worker-save">
            <Icon name={edit ? 'check' : 'plus'} size={18} /> {edit ? 'Speichern' : 'Hinzufügen'}
          </button>
          {edit && (
            <button type="button" className="btn" onClick={() => startEdit(null)}>
              Abbrechen
            </button>
          )}
        </div>
      </form>
      <ul className="crew-worker-list" data-testid="worker-list">
        {list.map((w) => (
          <li key={w.id} className={w.active ? '' : 'inactive'} data-testid="worker-row">
            <button type="button" className="crew-worker-main" onClick={() => startEdit(w)}>
              <strong>{workerName(w)}</strong>
              <span className="muted small">{[w.role, w.staffNo && `Nr. ${w.staffNo}`, w.phone].filter(Boolean).join(' · ') || (w.active ? '' : 'inaktiv')}</span>
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void onSave({ ...w, active: !w.active, updatedAt: Date.now() })}
              data-testid="worker-active"
            >
              {w.active ? 'Deaktivieren' : 'Aktivieren'}
            </button>
          </li>
        ))}
        {!list.length && <li className="muted">Noch keine Arbeiter angelegt.</li>}
      </ul>
    </Modal>
  );
}

/** Arbeitszeit der Firma je Wochentag (einmal eingeben) */
function TimesDialog({ times, onSave, onClose }: { times: WorkTimes; onSave(t: WorkTimes): void; onClose(): void }) {
  const [t, setT] = useState<WorkTimes>(() => times.map((x) => (x ? { ...x } : null)));
  const set = (d: number, x: WorkTimes[number]) => setT(t.map((y, i) => (i === d ? x : y)));
  return (
    <Modal
      title="Arbeitszeit der Firma"
      onClose={onClose}
      testId="times-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(t)} data-testid="times-save">
            Speichern
          </button>
        </>
      }
    >
      <p className="muted small">Gilt für alle Baustellen und Wochen. Erscheint in der Einteilung und später im PDF.</p>
      <div className="crew-times">
        {DAY_NAMES.map((name, d) => (
          <div key={d} className="crew-time-row">
            <label className="check-row">
              <input type="checkbox" checked={!!t[d]} onChange={(e) => set(d, e.target.checked ? { from: '07:00', to: d === 4 ? '12:00' : '16:00' } : null)} data-testid={`time-day-${d}`} />
              {name}
            </label>
            {t[d] ? (
              <span className="crew-time-inputs">
                <input type="time" value={t[d]!.from} onChange={(e) => set(d, { ...t[d]!, from: e.target.value })} aria-label={`${name} von`} data-testid={`time-from-${d}`} />
                <span>–</span>
                <input type="time" value={t[d]!.to} onChange={(e) => set(d, { ...t[d]!, to: e.target.value })} aria-label={`${name} bis`} data-testid={`time-to-${d}`} />
              </span>
            ) : (
              <span className="muted small">frei</span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Baustelle hinzufügen (aus der Projektverwaltung oder manuell) bzw. bearbeiten */
function SiteDialog({
  site,
  projects,
  taken,
  onSave,
  onClose,
}: {
  site?: WeekSite;
  projects: Project[];
  taken: string[];
  onSave(f: Pick<WeekSite, 'projectId' | 'name' | 'number' | 'address'>): void;
  onClose(): void;
}) {
  const [projectId, setProjectId] = useState<string>(site?.projectId ?? '');
  const [name, setName] = useState(site?.name ?? '');
  const [number, setNumber] = useState(site?.number ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [show, setShow] = useState(false);
  const pick = (id: string) => {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p) {
      const f = siteFromProject(p);
      setName(f.name);
      setNumber(f.number);
      setAddress(f.address);
    }
  };
  const submit = () => {
    setShow(true);
    if (!name.trim()) return;
    onSave({ projectId: projectId || null, name: name.trim(), number: number.trim(), address: address.trim() });
  };
  return (
    <Modal
      title={site ? 'Baustelle bearbeiten' : 'Baustelle hinzufügen'}
      onClose={onClose}
      testId="site-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} data-testid="site-save">
            {site ? 'Speichern' : 'Hinzufügen'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>Aus der Projektverwaltung</span>
          <select value={projectId} onChange={(e) => pick(e.target.value)} data-testid="site-project">
            <option value="">– manuell eingeben –</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id} disabled={taken.includes(p.id) && p.id !== site?.projectId}>
                {[p.number, p.name].filter(Boolean).join(' · ')}
                {taken.includes(p.id) && p.id !== site?.projectId ? ' (schon in dieser Woche)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid crew-site-fields">
          <label className="field span-2">
            <span>Bezeichnung *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={show && !name.trim() ? true : undefined} placeholder="z. B. Neubau Musterstraße" data-testid="site-name-input" />
          </label>
          <label className="field">
            <span>Projektnummer</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} data-testid="site-number" />
          </label>
          <label className="field">
            <span>Adresse</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} data-testid="site-address" />
          </label>
        </div>
        {show && !name.trim() && <p className="error small">Bitte eine Bezeichnung eingeben.</p>}
        <p className="muted small">Die Bezeichnung wird in dieser Woche gespeichert – spätere Umbenennungen des Projekts ändern alte Wochen nicht.</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Arbeiter einer Baustelle an gewählten Tagen einteilen (Auswahl aus der Arbeiterliste) */
function AssignDialog({
  plan,
  site,
  days,
  initialDays,
  workers,
  onSave,
  onClose,
}: {
  plan: WeekPlan;
  site: WeekSite;
  days: number[];
  initialDays: number[];
  workers: Worker[];
  onSave(ids: string[], days: number[]): void;
  onClose(): void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [ds, setDs] = useState<number[]>(initialDays);
  const status = (w: Worker) => {
    if (ds.length && ds.every((d) => site.days[d].includes(w.id))) return { text: 'schon hier', here: true };
    const other = [...new Set(ds.flatMap((d) => sitesOf(plan, w.id, d, site.id).map((s) => s.name)))];
    if (other.length) return { text: `auf ${other.join(', ')}`, warn: true };
    if (ds.some((d) => plan.vacation[d].includes(w.id))) return { text: 'Urlaub', warn: true };
    return { text: 'frei' };
  };
  return (
    <Modal
      title={`Einteilen: ${site.name}`}
      onClose={onClose}
      testId="assign-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" disabled={!sel.size || !ds.length} onClick={() => onSave([...sel], ds)} data-testid="assign-save">
            {sel.size ? `${sel.size} einteilen` : 'Einteilen'}
          </button>
        </>
      }
    >
      <div className="crew-day-toggles" role="group" aria-label="Tage">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className={`chip${ds.includes(d) ? ' active' : ''}`}
            aria-pressed={ds.includes(d)}
            onClick={() => setDs(ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort())}
            data-testid={`assign-day-${d}`}
          >
            {DAY_SHORT[d]}
          </button>
        ))}
      </div>
      {workers.length === 0 && <p className="muted">Noch keine aktiven Arbeiter – bitte zuerst unter „Arbeiter“ anlegen.</p>}
      <ul className="crew-pick">
        {workers.map((w) => {
          const st = status(w);
          return (
            <li key={w.id}>
              <label className={`check-row${st.here ? ' muted' : ''}`} data-testid="assign-worker" data-worker={workerName(w)}>
                <input
                  type="checkbox"
                  disabled={!!st.here}
                  checked={sel.has(w.id)}
                  onChange={(e) => {
                    const next = new Set(sel);
                    if (e.target.checked) next.add(w.id);
                    else next.delete(w.id);
                    setSel(next);
                  }}
                />
                <span className="crew-pick-name">
                  {workerName(w)}
                  {w.role && <span className="muted small"> · {w.role}</span>}
                </span>
                <span className={`crew-pick-status${st.warn ? ' warn' : ''}`}>{st.text}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

/** Eingeteilter Arbeiter: an diesem Tag entfernen, ab diesem Tag verschieben, Urlaub */
function ChipDialog({
  plan,
  name,
  siteId,
  day,
  onRemove,
  onMove,
  onVacation,
  onClose,
}: {
  plan: WeekPlan;
  name: string;
  siteId: string;
  day: number;
  onRemove(): void;
  onMove(to: string): void;
  onVacation(week: boolean): void;
  onClose(): void;
}) {
  const others = plan.sites.filter((s) => s.id !== siteId);
  const [to, setTo] = useState(others[0]?.id ?? '');
  return (
    <Modal title={`${name} · ${DAY_NAMES[day]}`} onClose={onClose} testId="chip-dialog">
      <div className="crew-chip-actions">
        {others.length > 0 && (
          <div className="crew-move">
            <label className="field">
              <span>Ab {DAY_NAMES[day]} auf andere Baustelle</span>
              <select value={to} onChange={(e) => setTo(e.target.value)} data-testid="chip-move-to">
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={() => onMove(to)} data-testid="chip-move">
              Verschieben
            </button>
          </div>
        )}
        <button type="button" className="btn" onClick={onRemove} data-testid="chip-remove">
          <Icon name="close" size={18} /> Nur am {DAY_NAMES[day]} entfernen
        </button>
        <button type="button" className="btn" onClick={() => onVacation(false)} data-testid="chip-vacation">
          Urlaub am {DAY_NAMES[day]}
        </button>
        <button type="button" className="btn" onClick={() => onVacation(true)} data-testid="chip-vacation-week">
          Urlaub ab {DAY_NAMES[day]} bis Wochenende
        </button>
      </div>
    </Modal>
  );
}

/** Noch nicht eingeteilter Arbeiter: auf eine Baustelle einteilen oder Urlaub eintragen */
function OpenDialog({
  plan,
  worker,
  day,
  onAssign,
  onVacation,
  onClose,
}: {
  plan: WeekPlan;
  worker: Worker;
  day: number;
  onAssign(siteId: string, rest: boolean): void;
  onVacation(rest: boolean): void;
  onClose(): void;
}) {
  const [rest, setRest] = useState(true);
  return (
    <Modal title={`${workerName(worker)} · ${DAY_NAMES[day]}`} onClose={onClose} testId="open-dialog">
      <label className="check-row">
        <input type="checkbox" checked={rest} onChange={(e) => setRest(e.target.checked)} data-testid="open-rest" />
        Ab {DAY_NAMES[day]} für die restliche Woche
      </label>
      <div className="crew-chip-actions">
        {plan.sites.map((s) => (
          <button key={s.id} type="button" className="btn" onClick={() => onAssign(s.id, rest)} data-testid="open-site" data-site={s.name}>
            <Icon name="plus" size={18} /> {s.name}
          </button>
        ))}
        {!plan.sites.length && <p className="muted">Noch keine Baustelle in dieser Woche.</p>}
        <button type="button" className="btn" onClick={() => onVacation(rest)} data-testid="open-vacation">
          Urlaub eintragen
        </button>
      </div>
    </Modal>
  );
}
