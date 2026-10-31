import { useEffect, useMemo, useState, type InputHTMLAttributes } from 'react';
import { Icon } from '../components/Icon';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { WORKER_GRADES, gradeLabel, gradeRank, sortByGrade, sortWorkers, workerName } from '../lib/crew';
import { deleteWorker, getMeta, listWorkers, saveWorker, setMeta } from '../lib/db';
import { uuid } from '../lib/ids';
import { navigate, paths } from '../lib/router';
import type { Worker, WorkerGrade } from '../lib/types';
import { usePageTitle } from '../lib/page-title';

type Sort = 'name' | 'grade';

/**
 * Personalliste der Arbeitereinteilung als eigene Seite: Vorname, Nachname, Funktion (nur im Tool – nie auf
 * Ausdrucken), Zusatz, Personalnummer, Telefon. Alphabetisch oder nach Funktion sortiert.
 */
export function StaffPage() {
  usePageTitle('Personalliste – BauPad');
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [sort, setSort] = useState<Sort>('name');
  const [query, setQuery] = useState('');
  const blank = { firstName: '', lastName: '', staffNo: '', phone: '', role: '', grade: '' };
  const [edit, setEdit] = useState<Worker | null>(null);
  const [v, setV] = useState(blank);
  const [show, setShow] = useState(false);

  useEffect(() => {
    void Promise.all([listWorkers(), getMeta<Sort>('staffSort')])
      .then(([w, s]) => {
        setWorkers(w);
        if (s === 'grade' || s === 'name') setSort(s);
      })
      .catch((e) => showError(e, 'Personalliste konnte nicht geladen werden'));
  }, []);
  // Escape = zurück zur Einteilung (wie das Schließen eines Fensters)
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

  const startEdit = (w: Worker | null) => {
    setEdit(w);
    setV(w ? { firstName: w.firstName, lastName: w.lastName, staffNo: w.staffNo ?? '', phone: w.phone ?? '', role: w.role ?? '', grade: w.grade ?? '' } : blank);
    setShow(false);
    if (w) window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const persist = async (w: Worker) => {
    await saveWorker(w);
    setWorkers((prev) => [...(prev ?? []).filter((x) => x.id !== w.id), w]);
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
      grade: (v.grade || undefined) as WorkerGrade | undefined,
      updatedAt: now,
    } as Worker;
    const was = edit;
    startEdit(null);
    try {
      await persist(w);
      toast(`${workerName(w)} ${was ? 'gespeichert' : 'angelegt'}.`, 'success');
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    }
  };
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
    try {
      await deleteWorker(w.id);
      setWorkers((prev) => (prev ?? []).filter((x) => x.id !== w.id));
      startEdit(null);
      toast(`${workerName(w)} gelöscht.`, 'success');
    } catch (e) {
      showError(e, 'Löschen fehlgeschlagen');
    }
  };
  const toggleActive = (w: Worker) => persist({ ...w, active: !w.active, updatedAt: Date.now() }).catch((e) => showError(e, 'Speichern fehlgeschlagen'));
  const field = (k: keyof typeof blank, label: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} autoComplete="off" data-testid={`worker-${k}`} {...extra} />
    </label>
  );

  /** Gruppenüberschrift je Funktion (nur bei Sortierung nach Funktion) */
  const groupOf = (w: Worker) => (sort === 'grade' ? WORKER_GRADES[gradeRank(w)].label : '');

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
              <span className="muted small">
                {activeCount} aktiv · Funktion und Qualifikation nur im Tool – nie auf Ausdrucken
              </span>
            </div>
          </div>
        </header>

        <section className="crew-worker-form staff-form" data-testid="staff-form">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h3>{edit ? `${workerName(edit)} bearbeiten` : 'Neuer Mitarbeiter'}</h3>
            <div className="form-grid">
              {field('firstName', 'Vorname *', { 'aria-invalid': show && !v.firstName.trim() ? true : undefined })}
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
            </div>
            {show && !v.firstName.trim() && <p className="error small">Bitte einen Vornamen eingeben.</p>}
            <div className="row gap wrap">
              <button type="submit" className="btn btn-primary" data-testid="worker-save">
                <Icon name={edit ? 'check' : 'plus'} size={18} /> {edit ? 'Speichern' : 'Hinzufügen'}
              </button>
              {edit && (
                <>
                  <button type="button" className="btn" onClick={() => startEdit(null)} data-testid="worker-cancel">
                    Abbrechen
                  </button>
                  <button type="button" className="btn btn-danger-outline" onClick={() => void remove(edit)} data-testid="worker-delete">
                    <Icon name="trash" size={16} /> Löschen
                  </button>
                </>
              )}
            </div>
          </form>
        </section>

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
            return (
              <li key={w.id} className={w.active ? '' : 'inactive'} data-testid="worker-row" data-group={g || undefined}>
                {head && (
                  <div className="staff-group" data-testid="staff-group">
                    {g}
                  </div>
                )}
                <div className="staff-row">
                  <button type="button" className="crew-worker-main" onClick={() => startEdit(w)} data-testid="worker-open">
                    <strong>{workerName(w)}</strong>
                    <span className="muted small">
                      {[sort === 'grade' ? '' : gradeLabel(w.grade), w.role, w.staffNo && `Nr. ${w.staffNo}`, w.phone].filter(Boolean).join(' · ') || (w.active ? '' : 'inaktiv')}
                      {!w.active && ' · inaktiv'}
                    </span>
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void toggleActive(w)} data-testid="worker-active">
                    {w.active ? 'Deaktivieren' : 'Aktivieren'}
                  </button>
                </div>
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
      </div>
    </>
  );
}
