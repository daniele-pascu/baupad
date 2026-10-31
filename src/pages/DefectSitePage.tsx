import { useEffect, useMemo, useState } from 'react';
import { DefectPlanDialog } from '../components/DefectPlanDialog';
import { PhotoSiteDialog } from '../components/PhotoSitePicker';
import { canEditSites, siteKeyOfSite, updateSiteEverywhere } from '../lib/sites';
import { useSession } from '../lib/use-session';
import { Icon } from '../components/Icon';
import { confirmDialog, promptDialog, showError, toast } from '../components/ui';
import { deleteDefectPlanCompletely, listDefectMarks } from '../lib/db';
import { KINDS, planImage, plansOfSite, renameDefectPlan } from '../lib/defects';
import { getPhotoStorage } from '../lib/photo-storage';
import { navigate, paths } from '../lib/router';
import type { DefectMark, DefectPlan, PhotoSite } from '../lib/types';
import { DEFECT_ACCENT } from './DefectsPage';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from '../lib/page-title';

/** Vorschaubild eines Plans (aus der Datenbank, als Objekt-URL) */
export function usePlanThumb(id: string, kind: 'thumb' | 'data' = 'thumb'): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void planImage(id).then((img) => {
      if (!img) return;
      u = URL.createObjectURL(new Blob([kind === 'thumb' ? img.thumb : img.data], { type: 'image/jpeg' }));
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, kind]);
  return url;
}

function PlanCard({ plan, marks, onRename, onDelete }: { plan: DefectPlan; marks: DefectMark[]; onRename(): void; onDelete(): void }) {
  const url = usePlanThumb(plan.id);
  const counts = KINDS.map((k) => ({ ...k, n: marks.filter((m) => m.kind === k.id).length })).filter((k) => k.n > 0);
  return (
    <div className="defect-plan-card" data-testid="defect-plan" data-title={plan.title}>
      <a href={paths.defectPlan(plan.id)} className="defect-plan-thumb" aria-label={`Plan ${plan.title} öffnen`}>
        {url ? <img src={url} alt="" /> : <span className="muted small">…</span>}
      </a>
      <div className="defect-plan-body">
        <a href={paths.defectPlan(plan.id)} className="defect-plan-title">
          <strong>{plan.title}</strong>
        </a>
        <span className="small muted">
          {marks.length} {marks.length === 1 ? 'Markierung' : 'Markierungen'}
          {counts.map((k) => (
            <span key={k.id} className="defect-count">
              <span className="defect-kind-dot" style={{ background: k.color }} /> {k.n}
            </span>
          ))}
        </span>
        <div className="row gap">
          <a href={paths.defectPlan(plan.id)} className="btn btn-sm btn-primary" data-testid="defect-plan-open">
            Öffnen
          </a>
          <button type="button" className="icon-btn icon-btn-sm" onClick={onRename} aria-label="Umbenennen" title="Umbenennen">
            <Icon name="edit" size={16} />
          </button>
          <button type="button" className="icon-btn icon-btn-sm danger" onClick={onDelete} aria-label="Plan löschen" title="Plan löschen" data-testid="defect-plan-delete">
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Baustelle im Mängelplan: alle Pläne mit Vorschau und Zählern, weiteren Plan hochladen */
export function DefectSitePage({ siteKey }: { siteKey: string }) {
  const [plans, setPlans] = useState<DefectPlan[] | null>(null);
  const [marks, setMarks] = useState<DefectMark[]>([]);
  const [site, setSite] = useState<PhotoSite | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const session = useSession();
  usePageTitle(`${site?.name ?? 'Baustelle'} – Mängelplan`);

  const reload = async () => {
    try {
      const list = await plansOfSite(siteKey);
      setPlans(list);
      const all = await listDefectMarks();
      setMarks(all.filter((m) => list.some((p) => p.id === m.planId)));
      if (list[0]) setSite({ projectId: list[0].projectId, name: list[0].siteName, number: list[0].siteNumber, address: list[0].siteAddress });
      else {
        // Baustelle ohne Plan (gerade angelegt): Angaben aus der Baustellenliste
        const sites = await loadPhotoSites(await getPhotoStorage().list());
        const found = sites.find((s) => (s.projectId ? `p:${s.projectId}` : `n:${s.name.trim().toLowerCase()}`) === siteKey) ?? null;
        setSite(found);
      }
    } catch (e) {
      showError(e, 'Baustelle konnte nicht geladen werden');
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  const byPlan = useMemo(() => {
    const m = new Map<string, DefectMark[]>();
    for (const x of marks) m.set(x.planId, [...(m.get(x.planId) ?? []), x]);
    return m;
  }, [marks]);

  const rename = async (p: DefectPlan) => {
    const t = await promptDialog({ title: 'Plan umbenennen', label: 'Bezeichnung', value: p.title });
    if (t === null) return;
    await renameDefectPlan(p.id, t);
    void reload();
  };
  const remove = async (p: DefectPlan) => {
    const n = byPlan.get(p.id)?.length ?? 0;
    const ok = await confirmDialog({
      title: 'Plan löschen?',
      message: (
        <p>
          „{p.title}“ mit {n} {n === 1 ? 'Markierung' : 'Markierungen'} wird gelöscht. Fotos bleiben in der Fotodokumentation.
        </p>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    await deleteDefectPlanCompletely(p.id);
    toast('Plan gelöscht.', 'success');
    void reload();
  };

  return (
    <>
      <div className="page defects-page" style={DEFECT_ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.defects()} className="icon-link" aria-label="Zur Übersicht" title="Zur Übersicht" data-testid="to-defects">
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="defect-site-title">{site?.name ?? '…'}</h1>
              {site && <p className="muted small page-sub">{[site.number, site.address].filter(Boolean).join(' · ') || 'Mängelplan'}</p>}
            </div>
          </div>
          <div className="row gap">
            {canEditSites(session) && (
              <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} disabled={!site} title="Baustelle bearbeiten – gilt in allen Werkzeugen" aria-label="Baustelle bearbeiten" data-testid="defect-site-edit">
                <Icon name="edit" size={16} /> <span className="lbl">Bearbeiten</span>
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setUploading(true)} data-testid="defect-upload">
              <Icon name="upload" size={16} /> Plan hochladen
            </button>
          </div>
        </header>
        {editing && site && (
          <PhotoSiteDialog
            initial={site}
            hint="Name, Nummer und Adresse werden in allen Werkzeugen übernommen – Projekt, Fotos, Berichte, Einteilung und Mängelplan."
            onSave={(v) => updateSiteEverywhere(site, v)}
            onClose={() => setEditing(false)}
            onSaved={(next) => {
              setEditing(false);
              toast('Baustelle gespeichert – in allen Werkzeugen übernommen.', 'success');
              const nk = siteKeyOfSite(next);
              if (nk !== siteKey) navigate(paths.defectSite(nk), true);
              else void reload();
            }}
          />
        )}
        {uploading && site && (
          <DefectPlanDialog
            sites={[site]}
            site={site}
            onClose={() => setUploading(false)}
            onCreated={(p) => {
              setUploading(false);
              navigate(paths.defectPlan(p.id));
            }}
          />
        )}
        {plans && plans.length === 0 && <p className="muted">Noch kein Plan auf dieser Baustelle. „Plan hochladen“ – PDF oder Foto.</p>}
        <div className="defect-plan-grid" data-testid="defect-plans">
          {(plans ?? []).map((p) => (
            <PlanCard key={p.id} plan={p} marks={byPlan.get(p.id) ?? []} onRename={() => void rename(p)} onDelete={() => void remove(p)} />
          ))}
        </div>
      </div>
    </>
  );
}
