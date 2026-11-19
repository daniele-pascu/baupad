import { useEffect, useMemo, useState, type InputHTMLAttributes } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { WORKER_GRADES, cleanSvNumber, gradeLabel, gradeRank, isoDate, sortByGrade, sortWorkers, workerName } from '../lib/crew';
import { absenceRange, cleanAbsences, withAbsence } from '../lib/crew-absence';
import { getMeta, listWorkers, saveWorker, setMeta } from '../lib/db';
import { deleteWorkerEverywhere } from '../lib/sites';
import { SelectBox, SelectionBar, SelectToggle, useSelection } from '../components/Selection';
import { uuid } from '../lib/ids';
import { navigate, paths } from '../lib/router';
import type { Absence, Worker, WorkerGrade } from '../lib/types';
import { usePageTitle } from '../lib/page-title';
import { isOfficeUser } from '../lib/access';
import { useSession } from '../lib/use-session';
import { AbsenceDialog } from './WorkersPage';
import { useDataChanged } from '../lib/data-events';
import { ToolMark } from '../components/ToolIcon';

type Sort = 'name' | 'grade';
type Form = { firstName: string; lastName: string; staffNo: string; svNumber: string; phone: string; role: string; grade: string; userEmail: string };
const BLANK: Form = { firstName: '', lastName: '', staffNo: '', svNumber: '', phone: '', role: '', grade: '', userEmail: '' };

/**
 * Personalliste der Arbeitereinteilung: oben „Neuer Mitarbeiter“ (Fenster), darunter die Liste. Ein Mitarbeiter
 * klappt beim Antippen auf: Funktion ändern, Bearbeiten, Urlaub, Krank, Deaktivieren, Löschen.
 * Funktion und Qualifikation bleiben im Tool – nie auf Ausdrucken.
 */
export function StaffPage() {
  usePageTitle('Personalliste – BauPad');
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [sort, setSort] = useState<Sort>('name');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'edit'; worker: Worker } | { kind: 'absence'; worker: Worker; type: Absence['kind'] } | null>(null);

  const load = () =>
    Promise.all([listWorkers(), getMeta<Sort>('staffSort'), getMeta<Absence[]>('absences')])
      .then(([w, s, a]) => {
        setWorkers(w);
        setAbsences(cleanAbsences(a ?? []));
        if (s === 'grade' || s === 'name') setSort(s);
      })
      .catch((e) => showError(e, 'Personalliste konnte nicht geladen werden'));
  useEffect(() => {
    void load();
  }, []);
  useDataChanged(() => void load());
  // Escape = zurück zur Einteilung (wenn kein Fenster offen ist)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) navigate(paths.workers());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeSort = (s: Sort) => {
    setSort(s);
    void setMeta('staffSort', s).catch(() => {});
  };
  const list = useMemo(() => {
    const all = workers ?? [];
    const q = query.trim().toLowerCase();
    const hit = q ? all.filter((w) => [workerName(w), w.role ?? '', w.staffNo ?? '', gradeLabel(w.grade)].join(' ').toLowerCase().includes(q)) : all;
    return sort === 'grade' ? sortByGrade(hit) : sortWorkers(hit);
  }, [workers, sort, query]);
  const activeCount = (workers ?? []).filter((w) => w.active).length;
  /** Mehrfachauswahl: mehrere löschen oder gemeinsam ändern (Qualifikation, aktiv, Urlaub/Krank) */
  const sel = useSelection(list.map((w) => w.id));
  const [bulk, setBulk] = useState(false);
  const picked = () => list.filter((w) => sel.ids.includes(w.id));
  const nameOf = (id: string) => {
    const w = (workers ?? []).find((x) => x.id === id);
    return w ? workerName(w) : 'Unbekannt';
  };

  const persist = async (w: Worker) => {
    await saveWorker(w);
    setWorkers((prev) => [...(prev ?? []).filter((x) => x.id !== w.id), w]);
  };
  const run = (fn: () => Promise<void>, fail: string) => fn().catch((e) => showError(e, fail));
  const setGrade = (w: Worker, grade: string) =>
    run(async () => {
      await persist({ ...w, grade: (grade || undefined) as WorkerGrade | undefined, updatedAt: Date.now() });
      toast(`${workerName(w)}: ${grade ? gradeLabel(grade as WorkerGrade) : 'keine Qualifikation'}.`, 'success');
    }, 'Speichern fehlgeschlagen');
  const toggleActive = (w: Worker) => run(() => persist({ ...w, active: !w.active, updatedAt: Date.now() }), 'Speichern fehlgeschlagen');
  /** einen oder mehrere Mitarbeiter löschen – auch als Bauleitung/Projektleiter aus den Projekten */
  const removeMany = async (list: Worker[]) => {
    if (!list.length) return;
    const one = list.length === 1;
    const ok = await confirmDialog({
      title: one ? `${workerName(list[0])} löschen?` : `${list.length} Mitarbeiter löschen?`,
      message: (
        <>
          {!one && <p>{list.map(workerName).join(', ')}</p>}
          <p>
            {one ? 'Der Mitarbeiter wird' : 'Die Mitarbeiter werden'} aus der Personalliste und aus allen Wochen der Einteilung entfernt. Ist{' '}
            {one ? 'er' : 'einer davon'} bei einem Projekt als Bauleitung bzw. Projektleiter eingetragen, wird {one ? 'er' : 'er'} dort ausgetragen. Das lässt sich nicht rückgängig machen.
          </p>
          <p>Bereits erstellte Berichte behalten den Namen.</p>
        </>
      ),
      confirmLabel: one ? 'Löschen' : `${list.length} löschen`,
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      let projects = 0;
      for (const w of list) projects += (await deleteWorkerEverywhere(w)).length;
      const ids = new Set(list.map((w) => w.id));
      setWorkers((prev) => (prev ?? []).filter((x) => !ids.has(x.id)));
      setAbsences((prev) => prev.filter((a) => !ids.has(a.workerId)));
      setOpen(null);
      sel.stop();
      toast(`${one ? workerName(list[0]) : `${list.length} Mitarbeiter`} gelöscht.${projects ? ` Aus der Bauleitung von ${projects} ${projects === 1 ? 'Projekt' : 'Projekten'} ausgetragen.` : ''}`, 'success', 4000);
    }, 'Löschen fehlgeschlagen');
  };
  const remove = (w: Worker) => removeMany([w]);
  /** gemeinsam ändern: Qualifikation, aktiv/inaktiv, Urlaub bzw. Krank für alle gewählten */
  const applyBulk = (list: Worker[], c: { grade?: string; active?: boolean; absence?: { kind: Absence['kind']; from: string; to: string } }) =>
    run(async () => {
      const now = Date.now();
      for (const w of list) {
        const next: Worker = { ...w, ...(c.grade !== undefined ? { grade: (c.grade || undefined) as WorkerGrade | undefined } : {}), ...(c.active !== undefined ? { active: c.active } : {}), updatedAt: now };
        if (JSON.stringify(next) !== JSON.stringify({ ...w, updatedAt: now })) await saveWorker(next);
      }
      if (c.absence) {
        let next = absences;
        for (const w of list) next = withAbsence(next, { id: uuid(), workerId: w.id, kind: c.absence.kind, from: c.absence.from, to: c.absence.to, createdAt: now });
        await saveAbsences(next);
      }
      await load();
      setBulk(false);
      sel.stop();
      toast(`${list.length} Mitarbeiter geändert.`, 'success');
    }, 'Speichern fehlgeschlagen');
  const saveAbsences = async (next: Absence[]) => {
    await setMeta('absences', next);
    setAbsences(next);
  };
  const addAbsence = (a: Absence) =>
    run(async () => {
      await saveAbsences(withAbsence(absences, a));
      toast(`${a.kind === 'urlaub' ? 'Urlaub' : 'Krank'} eingetragen: ${nameOf(a.workerId)}, ${absenceRange(a)}`, 'success');
      setDialog(null);
    }, 'Speichern fehlgeschlagen');
  const deleteAbsence = (a: Absence) =>
    run(async () => {
      await saveAbsences(absences.filter((x) => x.id !== a.id));
      toast(`${a.kind === 'urlaub' ? 'Urlaub' : 'Krankmeldung'} gelöscht.`, 'success');
    }, 'Löschen fehlgeschlagen');

  /** Gruppenüberschrift je Funktion (nur bei Sortierung nach Funktion) */
  const groupOf = (w: Worker) => (sort === 'grade' ? (WORKER_GRADES[gradeRank(w)]?.label ?? 'Ohne Qualifikation') : '');
  const today = isoDate(new Date());
  const upcoming = (w: Worker) => absences.filter((a) => a.workerId === w.id && a.to >= today).sort((a, b) => a.from.localeCompare(b.from));

  return (
    <>
      <SiteNav />
      <div className="page staff-page" data-testid="staff-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.workers()} className="icon-link" aria-label="Zurück zu Team" title="Zurück zu Team" data-testid="staff-back">
              <Icon name="back" />
            </a>
            <ToolMark name="workers" />
            <div>
              <h1 data-testid="staff-title">Personalliste</h1>
              <span className="muted small">{activeCount} aktiv</span>
            </div>
          </div>
        </header>

        <button type="button" className="account-tile staff-new" onClick={() => setDialog({ kind: 'new' })} data-testid="staff-new">
          <div>
            <strong>+ Neuer Mitarbeiter</strong>
            <span className="muted">Vorname, Nachname, Qualifikation, Tätigkeit, Personalnummer, Telefon</span>
          </div>
          <Icon name="next" size={18} />
        </button>

        <div className="staff-tools">
          <label className="crew-search">
            <Icon name="select" size={18} />
            <span className="sr-only">Suchen</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, Qualifikation oder Personalnummer suchen" data-testid="staff-search" />
          </label>
          <SelectToggle sel={sel} testId="staff-select" onStart={() => setOpen(null)} />
          <div className="segmented" role="radiogroup" aria-label="Sortierung">
            <button type="button" role="radio" aria-checked={sort === 'name'} onClick={() => changeSort('name')} data-testid="staff-sort-name">
              A–Z
            </button>
            <button type="button" role="radio" aria-checked={sort === 'grade'} onClick={() => changeSort('grade')} data-testid="staff-sort-grade">
              Nach Qualifikation
            </button>
          </div>
        </div>

        <ul className={`crew-worker-list staff-list${sel.active ? ' selecting' : ''}`} data-testid="worker-list">
          {list.map((w, i) => {
            const g = groupOf(w);
            const head = g && (i === 0 || groupOf(list[i - 1]) !== g);
            const isOpen = open === w.id;
            const abs = upcoming(w);
            return (
              <li key={w.id} className={`${w.active ? '' : 'inactive'}${isOpen ? ' open' : ''}`} data-testid="worker-row" data-group={g || undefined} data-selected={sel.active ? sel.has(w.id) : undefined}>
                {head && (
                  <div className="staff-group" data-testid="staff-group">
                    {g}
                  </div>
                )}
                <div className="staff-row">
                  {sel.active ? (
                    <span className="staff-no">
                      <SelectBox sel={sel} id={w.id} label={workerName(w)} testId="worker-select" />
                    </span>
                  ) : (
                    sort === 'name' && (
                      <span className="staff-no" data-testid="worker-no">
                        {i + 1}.
                      </span>
                    )
                  )}
                  <button type="button" className="crew-worker-main" onClick={() => (sel.active ? sel.toggle(w.id) : setOpen(isOpen ? null : w.id))} aria-expanded={sel.active ? undefined : isOpen} data-testid="worker-open">
                    <strong>{workerName(w)}</strong>
                    <span className="muted small">
                      {[sort === 'grade' ? '' : gradeLabel(w.grade), w.role, w.staffNo && `Nr. ${w.staffNo}`, w.phone].filter(Boolean).join(' · ')}
                      {!w.active && ' · inaktiv'}
                      {abs.length > 0 && ` · ${abs.map((a) => `${a.kind === 'urlaub' ? 'Urlaub' : 'Krank'} ${absenceRange(a)}`).join(', ')}`}
                    </span>
                  </button>
                  <Icon name="next" size={18} className={`staff-chevron${isOpen ? ' open' : ''}`} />
                </div>
                {isOpen && !sel.active && (
                  <div className="staff-options" data-testid="worker-options">
                    <label className="field">
                      <span>Qualifikation</span>
                      <select value={w.grade ?? ''} onChange={(e) => void setGrade(w, e.target.value)} data-testid="worker-grade-inline">
                        <option value="">– keine –</option>
                        {WORKER_GRADES.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="row gap wrap">
                      <button type="button" className="btn btn-sm" onClick={() => setDialog({ kind: 'edit', worker: w })} data-testid="worker-edit">
                        <Icon name="edit" size={16} /> Bearbeiten
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setDialog({ kind: 'absence', worker: w, type: 'urlaub' })} data-testid="worker-urlaub">
                        <Icon name="calendar" size={16} /> Urlaub
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setDialog({ kind: 'absence', worker: w, type: 'krank' })} data-testid="worker-krank">
                        <Icon name="calendar" size={16} /> Krank
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => void toggleActive(w)} data-testid="worker-active">
                        {w.active ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                      <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => void remove(w)} data-testid="worker-delete">
                        <Icon name="trash" size={16} /> Löschen
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {workers && !list.length && <li className="muted">{query ? 'Niemand gefunden.' : 'Noch niemand angelegt.'}</li>}
        </ul>

        <SelectionBar
          sel={sel}
          noun={['Mitarbeiter', 'Mitarbeiter']}
          testId="staff-select-bar"
          actions={[
            { label: 'Löschen', icon: 'trash', primary: true, danger: true, onSelect: () => void removeMany(picked()), testId: 'staff-bulk-delete' },
            { label: 'Ändern', icon: 'edit', primary: true, onSelect: () => setBulk(true), testId: 'staff-bulk-edit' },
            { label: 'Deaktivieren', icon: 'pause', onSelect: () => void applyBulk(picked(), { active: false }), testId: 'staff-bulk-off' },
            { label: 'Aktivieren', icon: 'play', onSelect: () => void applyBulk(picked(), { active: true }), testId: 'staff-bulk-on' },
          ]}
        />

        <div className="row gap wrap staff-foot">
          <a href={paths.workers()} className="btn">
            <Icon name="back" /> Zurück zu Team
          </a>
        </div>

      {(dialog?.kind === 'new' || dialog?.kind === 'edit') && (
        <WorkerDialog
          worker={dialog.kind === 'edit' ? dialog.worker : null}
          others={(workers ?? []).filter((x) => dialog.kind !== 'edit' || x.id !== dialog.worker.id)}
          onClose={() => setDialog(null)}
          onSave={async (w) => {
            await persist(w);
            toast(`${workerName(w)} ${dialog.kind === 'edit' ? 'gespeichert' : 'angelegt'}.`, 'success');
            setDialog(null);
          }}
        />
      )}
      {bulk && <BulkStaffDialog workers={picked()} today={today} onClose={() => setBulk(false)} onSave={(c) => void applyBulk(picked(), c)} />}
      {dialog?.kind === 'absence' && (
        <AbsenceDialog
          workers={(workers ?? []).filter((w) => w.active || w.id === dialog.worker.id)}
          absences={absences}
          nameOf={nameOf}
          workerId={dialog.worker.id}
          kind={dialog.type}
          from={today}
          to={today}
          onAdd={(a) => void addAbsence(a)}
          onDelete={(a) => void deleteAbsence(a)}
          onClose={() => setDialog(null)}
        />
      )}
      </div>
    </>
  );
}

/** Mehrere Mitarbeiter gemeinsam ändern: Qualifikation, aktiv/inaktiv, Urlaub bzw. Krank von–bis */
function BulkStaffDialog({ workers, today, onClose, onSave }: { workers: Worker[]; today: string; onClose(): void; onSave(c: { grade?: string; active?: boolean; absence?: { kind: Absence['kind']; from: string; to: string } }): void }) {
  const [grade, setGrade] = useState('=');
  const [active, setActive] = useState('=');
  const [absence, setAbsence] = useState<'' | Absence['kind']>('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const bad = !!absence && (!from || !to || to < from);
  const save = () => {
    if (bad) return;
    onSave({ ...(grade !== '=' ? { grade } : {}), ...(active !== '=' ? { active: active === 'on' } : {}), ...(absence ? { absence: { kind: absence, from, to } } : {}) });
  };
  return (
    <Modal
      title={`${workers.length} Mitarbeiter ändern`}
      onClose={onClose}
      testId="staff-bulk-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={bad} data-testid="staff-bulk-save">
            <Icon name="check" size={18} /> Übernehmen
          </button>
        </>
      }
    >
      <div className="stack-fields">
        <p className="muted small">{workers.map(workerName).join(', ')}</p>
        <label className="field">
          <span>Qualifikation</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value)} data-testid="staff-bulk-grade">
            <option value="=">– unverändert –</option>
            <option value="">keine</option>
            {WORKER_GRADES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={active} onChange={(e) => setActive(e.target.value)} data-testid="staff-bulk-active">
            <option value="=">– unverändert –</option>
            <option value="on">aktiv</option>
            <option value="off">inaktiv (wird nicht mehr eingeteilt)</option>
          </select>
        </label>
        <label className="field">
          <span>Urlaub / Krank eintragen</span>
          <select value={absence} onChange={(e) => setAbsence(e.target.value as '' | Absence['kind'])} data-testid="staff-bulk-absence">
            <option value="">– nichts eintragen –</option>
            <option value="urlaub">Urlaub</option>
            <option value="krank">Krank</option>
          </select>
        </label>
        {absence && (
          <div className="form-grid">
            <label className="field">
              <span>von</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="staff-bulk-from" />
            </label>
            <label className="field">
              <span>bis</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="staff-bulk-to" />
            </label>
          </div>
        )}
        {bad && <p className="error small">„bis“ darf nicht vor „von“ liegen.</p>}
      </div>
    </Modal>
  );
}

/** Fenster: Mitarbeiter anlegen oder bearbeiten */
/** schon hinterlegt? gleicher Vor- und Nachname (ohne Groß-/Kleinschreibung) oder gleiche Personalnummer */
export function workerDuplicates(v: { firstName: string; lastName: string; staffNo: string }, others: Worker[]): { worker: Worker; reason: 'name' | 'staffNo' }[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const name = norm(`${v.firstName} ${v.lastName}`);
  const no = v.staffNo.trim();
  const out: { worker: Worker; reason: 'name' | 'staffNo' }[] = [];
  for (const w of others) {
    if (no && (w.staffNo ?? '').trim() === no) out.push({ worker: w, reason: 'staffNo' });
    else if (v.firstName.trim() && norm(`${w.firstName} ${w.lastName}`) === name) out.push({ worker: w, reason: 'name' });
  }
  return out;
}

function WorkerDialog({ worker, others, onClose, onSave }: { worker: Worker | null; others: Worker[]; onClose(): void; onSave(w: Worker): Promise<void> }) {
  const [v, setV] = useState<Form>(
    worker ? { firstName: worker.firstName, lastName: worker.lastName, staffNo: worker.staffNo ?? '', svNumber: worker.svNumber ?? '', phone: worker.phone ?? '', role: worker.role ?? '', grade: worker.grade ?? '', userEmail: worker.userEmail ?? '' } : BLANK,
  );
  // SV-Nummer: nur Admin und Büro (Polier/Arbeiter bekommen sie vom Server nicht, beim Speichern bleibt sie erhalten)
  const office = isOfficeUser(useSession());
  const sv = cleanSvNumber(v.svNumber);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const dups = workerDuplicates(v, others);
  const dupText = (d: { worker: Worker; reason: 'name' | 'staffNo' }) =>
    `${workerName(d.worker)}${d.worker.staffNo ? ` (Personalnr. ${d.worker.staffNo})` : ''}${d.worker.active ? '' : ' – inaktiv'}${d.reason === 'staffNo' ? ' hat dieselbe Personalnummer' : ' ist schon hinterlegt'}`;
  const submit = async () => {
    setShow(true);
    if (!v.firstName.trim() || (office && sv === null)) return;
    // doppelt? nur nach Rückfrage speichern
    if (dups.length) {
      const ok = await confirmDialog({
        title: dups.some((d) => d.reason === 'name') ? 'Mitarbeiter schon hinterlegt' : 'Personalnummer schon vergeben',
        message: (
          <>
            {dups.map((d) => (
              <p key={d.worker.id}>{dupText(d)}.</p>
            ))}
            <p>Trotzdem {worker ? 'speichern' : 'als weiteren Mitarbeiter anlegen'}?</p>
          </>
        ),
        confirmLabel: worker ? 'Trotzdem speichern' : 'Trotzdem anlegen',
      });
      if (!ok) return;
    }
    const now = Date.now();
    const w: Worker = {
      ...(worker ?? { id: uuid(), active: true, createdAt: now }),
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      staffNo: v.staffNo.trim(),
      ...(office ? { svNumber: sv || undefined } : {}),
      phone: v.phone.trim(),
      role: v.role.trim(),
      grade: (v.grade || undefined) as WorkerGrade | undefined,
      userEmail: v.userEmail.trim().toLowerCase() || undefined,
      updatedAt: now,
    } as Worker;
    setBusy(true);
    try {
      await onSave(w);
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof Form, label: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} autoComplete="off" data-testid={`worker-${k}`} {...extra} />
    </label>
  );
  return (
    <Modal
      title={worker ? `${workerName(worker)} bearbeiten` : 'Neuer Mitarbeiter'}
      onClose={onClose}
      testId="worker-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="worker-cancel">
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} data-testid="worker-save">
            <Icon name={worker ? 'check' : 'plus'} size={18} /> {worker ? 'Speichern' : 'Hinzufügen'}
          </button>
        </>
      }
    >
      <form
        className="stack-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {field('firstName', 'Vorname *', { 'aria-invalid': show && !v.firstName.trim() ? true : undefined, 'data-autofocus': '' } as Partial<InputHTMLAttributes<HTMLInputElement>>)}
        {field('lastName', 'Nachname')}
        {dups.length > 0 && (
          <div className="worker-dup" role="status" data-testid="worker-duplicate">
            <Icon name="info" size={18} />
            <span>
              {dups.map((d) => (
                <span key={d.worker.id} className="worker-dup-line">
                  {dupText(d)}.
                </span>
              ))}
            </span>
          </div>
        )}
        <label className="field">
          <span>Qualifikation</span>
          <select value={v.grade} onChange={(e) => setV({ ...v, grade: e.target.value })} data-testid="worker-grade">
            <option value="">– bitte wählen –</option>
            {WORKER_GRADES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        {field('role', 'Tätigkeit / Zusatz', { placeholder: 'z. B. Maurer, Kranführer' })}
        {field('staffNo', 'Personalnummer')}
        {office && field('svNumber', 'SV-Nummer (nur Admin und Büro)', { inputMode: 'numeric', placeholder: '10 Ziffern, z. B. 1234 010180', 'aria-invalid': show && sv === null ? true : undefined } as Partial<InputHTMLAttributes<HTMLInputElement>>)}
        {office && show && sv === null && <p className="error small" data-testid="worker-sv-error">Die SV-Nummer hat 10 Ziffern.</p>}
        {field('phone', 'Telefon', { type: 'tel', inputMode: 'tel' })}
        {field('userEmail', 'BauPad-Konto (E-Mail) – trägt damit seine eigenen Stunden ein', { type: 'email', inputMode: 'email', placeholder: 'leer = kein Zugang zu eigenen Stunden' })}
        {show && !v.firstName.trim() && <p className="error small">Bitte einen Vornamen eingeben.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
