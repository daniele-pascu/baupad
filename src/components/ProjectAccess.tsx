import { useEffect, useState } from 'react';
import { ToolIcon } from './ToolIcon';
import { Modal } from './Modal';
import { showError, toast } from './ui';
import { canEditSites } from '../lib/sites';
import { useSession } from '../lib/use-session';
import { getProjectAccess, setProjectAccess, type ProjectAccessRow } from '../lib/users';

const GROUPS = [
  { role: 'polier', title: 'Poliere', all: 'Alle Poliere' },
  { role: 'arbeiter', title: 'Arbeiter', all: 'Alle Arbeiter' },
] as const;

/** Taste „Freigabe“ im Projekt (nur Admin und Büro einer Firma): wer von Polieren und Arbeitern das Projekt sieht. */
export function ProjectAccessButton({ projectId, name }: { projectId: string; name: string }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  if (!session?.companyId || !canEditSites(session)) return null;
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} data-testid="project-access">
        <ToolIcon name="workers" size={18} /> Freigabe
      </button>
      {open && <ProjectAccessDialog projectKey={`p:${projectId}`} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProjectAccessDialog({ projectKey, name, onClose }: { projectKey: string; name: string; onClose(): void }) {
  const [rows, setRows] = useState<ProjectAccessRow[] | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    getProjectAccess(projectKey)
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setOn(new Set(r.filter((x) => x.allowed).map((x) => x.id)));
      })
      .catch((e) => {
        showError(e, 'Freigabe konnte nicht geladen werden');
        onClose();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);
  const toggle = (ids: string[], value: boolean) =>
    setOn((cur) => {
      const next = new Set(cur);
      for (const id of ids) if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  const save = async () => {
    setBusy(true);
    try {
      await setProjectAccess(projectKey, [...on]);
      toast(on.size ? `„${name}“ freigegeben für ${on.size} ${on.size === 1 ? 'Person' : 'Personen'}.` : `„${name}“ ist für Poliere und Arbeiter nicht mehr sichtbar.`, 'success');
      onClose();
    } catch (e) {
      showError(e, 'Freigabe konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Freigabe – ${name}`}
      onClose={onClose}
      testId="project-access-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !rows} data-testid="project-access-save">
            Speichern
          </button>
        </>
      }
    >
      <p className="muted small">Wer darf dieses Projekt sehen? Gilt in allen Werkzeugen. Admin und Büro sehen immer alles.</p>
      {rows?.length === 0 && <p>Noch keine Poliere oder Arbeiter angelegt – unter Konto → Benutzer und Rollen.</p>}
      {GROUPS.map((g) => {
        const list = (rows ?? []).filter((r) => r.role === g.role);
        if (!list.length) return null;
        const all = list.every((r) => on.has(r.id));
        return (
          <section key={g.role} className="access-group">
            <div className="access-head">
              <strong>{g.title}</strong>
              <button type="button" className="btn btn-sm" onClick={() => toggle(list.map((r) => r.id), !all)} aria-pressed={all} data-testid={`project-access-all-${g.role}`}>
                {g.all}
              </button>
            </div>
            {list.map((r) => (
              <label key={r.id} className="check-row access-row">
                <input type="checkbox" checked={on.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} data-testid="project-access-user" data-user={r.name || r.email} />
                <strong>{r.name || r.email}</strong>
              </label>
            ))}
          </section>
        );
      })}
    </Modal>
  );
}
