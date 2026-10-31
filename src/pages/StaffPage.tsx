import { useEffect, useMemo, useState, type InputHTMLAttributes } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { WORKER_GRADES, gradeLabel, gradeRank, isoDate, sortByGrade, sortWorkers, workerName } from '../lib/crew';
import { absenceRange } from '../lib/crew-absence';
import { deleteWorker, getMeta, listWorkers, saveWorker, setMeta } from '../lib/db';
import { uuid } from '../lib/ids';
import { navigate, paths } from '../lib/router';
import type { Absence, Worker, WorkerGrade } from '../lib/types';
import { usePageTitle } from '../lib/page-title';
import { AbsenceDialog } from './WorkersPage';

type Sort = 'name' | 'grade';
type Form = { firstName: string; lastName: string; staffNo: string; phone: string; role: string; grade: string };
const BLANK: Form = { firstName: '', lastName: '', staffNo: '', phone: '', role: '', grade: '' };

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

  useEffect(() => {
    void Promise.all([listWorkers(), getMeta<Sort>('staffSort'), getMeta<Absence[]>('absences')])
      .then(([w, s, a]) => {
        setWorkers(w);
        setAbsences(a ?? []);
        if (s === 'grade' || s === 'name') setSort(s);
      })
      .catch((e) => showError(e, 'Personalliste konnte nicht geladen werden'));
  }, []);
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
      toast(`${workerName(w)}: ${grade ? gradeLabel(grade as WorkerGrade) : 'keine Funktion'}.`, 'success');
    }, 'Speichern fehlgeschlagen');
  const toggleActive = (w: Worker) => run(() => persist({ ...w, active: !w.active, updatedAt: Date.now() }), 'Speichern fehlgeschlagen');
  const remove = async (w: Worker) => {
    const ok = await confirmDialog({
      title: `${workerName(w)} löschen?`,
      message: (
        <>
          <p>Der Mitarbeiter wird aus der Personalliste und aus allen Wochen der Einteilung entfernt. Das lässt sich nicht rückgängig machen.</p>
          <p>Bereits erstellte Berichte behalten den Namen.</p>
        </>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await deleteWorker(w.id);
      setWorkers((prev) => (prev ?? []).filter((x) => x.id !== w.id));
      setAbsences((prev) => prev.filter((a) => a.workerId !== w.id));
      setOpen(null);
      toast(`${workerName(w)} gelöscht.`, 'success');
    }, 'Löschen fehlgeschlagen');
  };
  const saveAbsences = async (next: Absence[]) => {
    await setMeta('absences', next);
    setAbsences(next);
  };
  const addAbsence = (a: Absence) =>
    run(async () => {
      await saveAbsences([...absences, a]);
      toast(`${a.kind === 'urlaub' ? 'Urlaub' : 'Krank'} eingetragen: ${nameOf(a.workerId)}, ${absenceRange(a)}`, 'success');
      setDialog(null);
    }, 'Speichern fehlgeschlagen');
  const deleteAbsence = (a: Absence) =>
    run(async () => {
      await saveAbsences(absences.filter((x) => x.id !== a.id));
      toast(`${a.kind === 'urlaub' ? 'Urlaub' : 'Krankmeldung'} gelöscht.`, 'success');
    }, 'Löschen fehlgeschlagen');

  /** Gruppenüberschrift je Funktion (nur bei Sortierung nach Funktion) */
  const groupOf = (w: Worker) => (sort === 'grade' ? WORKER_GRADES[gradeRank(w)].label : '');
  const today = isoDate(new Date());
  const upcoming = (w: Worker) => absences.filter((a) => a.workerId === w.id && a.to >= today).sort((a, b) => a.from.localeCompare(b.from));

  return (
    <>
      <SiteNav />
      <div className="page staff-page" data-testid="staff-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.workers()} className="icon-link" aria-label="Zurück zur Arbeitereinteilung" title="Zurück zur Arbeitereinteilung" data-testid="staff-back">
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="staff-title">Personalliste</h1>
              <span className="muted small">{activeCount} aktiv · Funktion und Qualifikation nur im Tool – nie auf Ausdrucken</span>
            </div>
          </div>
        </header>

        <button type="button" className="account-tile staff-new" onClick={() => setDialog({ kind: 'new' })} data-testid="staff-new">
          <div>
            <strong>+ Neuer Mitarbeiter</strong>
            <span className="muted">Vorname, Nachname, Funktion, Qualifikation, Personalnummer, Telefon</span>
          </div>
          <Icon name="next" size={18} />
        </button>

        <div className="staff-tools">
          <label className="crew-search">
            <Icon name="select" size={18} />
            <span className="sr-only">Suchen</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, Funktion oder Personalnummer suchen" data-testid="staff-search" />
          </label>
          <div className="segmented" role="radiogroup" aria-label="Sortierung">
            <button type="button" role="radio" aria-checked={sort === 'name'} onClick={() => changeSort('name')} data-testid="staff-sort-name">
              A–Z
            </button>
            <button type="button" role="radio" aria-checked={sort === 'grade'} onClick={() => changeSort('grade')} data-testid="staff-sort-grade">
              Nach Funktion
            </button>
          </div>
        </div>

        <ul className="crew-worker-list staff-list" data-testid="worker-list">
          {list.map((w, i) => {
            const g = groupOf(w);
            const head = g && (i === 0 || groupOf(list[i - 1]) !== g);
            const isOpen = open === w.id;
            const abs = upcoming(w);
            return (
              <li key={w.id} className={`${w.active ? '' : 'inactive'}${isOpen ? ' open' : ''}`} data-testid="worker-row" data-group={g || undefined}>
                {head && (
                  <div className="staff-group" data-testid="staff-group">
                    {g}
                  </div>
                )}
                <div className="staff-row">
                  <button type="button" className="crew-worker-main" onClick={() => setOpen(isOpen ? null : w.id)} aria-expanded={isOpen} data-testid="worker-open">
                    <strong>{workerName(w)}</strong>
                    <span className="muted small">
                      {[sort === 'grade' ? '' : gradeLabel(w.grade), w.role, w.staffNo && `Nr. ${w.staffNo}`, w.phone].filter(Boolean).join(' · ')}
                      {!w.active && ' · inaktiv'}
                      {abs.length > 0 && ` · ${abs.map((a) => `${a.kind === 'urlaub' ? 'Urlaub' : 'Krank'} ${absenceRange(a)}`).join(', ')}`}
                    </span>
                  </button>
                  <Icon name="next" size={18} className={`staff-chevron${isOpen ? ' open' : ''}`} />
                </div>
                {isOpen && (
                  <div className="staff-options" data-testid="worker-options">
                    <label className="field">
                      <span>Funktion</span>
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

        <div className="row gap wrap staff-foot">
          <a href={paths.workers()} className="btn">
            <Icon name="back" /> Zurück zur Arbeitereinteilung
          </a>
        </div>

      {(dialog?.kind === 'new' || dialog?.kind === 'edit') && (
        <WorkerDialog
          worker={dialog.kind === 'edit' ? dialog.worker : null}
          onClose={() => setDialog(null)}
          onSave={async (w) => {
            await persist(w);
            toast(`${workerName(w)} ${dialog.kind === 'edit' ? 'gespeichert' : 'angelegt'}.`, 'success');
            setDialog(null);
          }}
        />
      )}
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

/** Fenster: Mitarbeiter anlegen oder bearbeiten */
function WorkerDialog({ worker, onClose, onSave }: { worker: Worker | null; onClose(): void; onSave(w: Worker): Promise<void> }) {
  const [v, setV] = useState<Form>(
    worker ? { firstName: worker.firstName, lastName: worker.lastName, staffNo: worker.staffNo ?? '', phone: worker.phone ?? '', role: worker.role ?? '', grade: worker.grade ?? '' } : BLANK,
  );
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setShow(true);
    if (!v.firstName.trim()) return;
    const now = Date.now();
    const w: Worker = {
      ...(worker ?? { id: uuid(), active: true, createdAt: now }),
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      staffNo: v.staffNo.trim(),
      phone: v.phone.trim(),
      role: v.role.trim(),
      grade: (v.grade || undefined) as WorkerGrade | undefined,
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
        <label className="field">
          <span>Funktion</span>
          <select value={v.grade} onChange={(e) => setV({ ...v, grade: e.target.value })} data-testid="worker-grade">
            <option value="">– bitte wählen –</option>
            {WORKER_GRADES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        {field('role', 'Qualifikation / Zusatz (optional)', { placeholder: 'z. B. Maurer, Kranführer' })}
        {field('staffNo', 'Personalnummer (optional)')}
        {field('phone', 'Telefon (optional)', { type: 'tel', inputMode: 'tel' })}
        {show && !v.firstName.trim() && <p className="error small">Bitte einen Vornamen eingeben.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
