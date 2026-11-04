import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ActionMenu } from '../components/ActionMenu';
import { Icon } from '../components/Icon';
import { ProjectEditDialog } from '../components/ProjectEditDialog';
import { ProjectPicker } from '../components/ProjectPicker';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { confirmDialog, showError, toast } from '../components/ui';
import { deleteDefectPlanCompletely, listDefectMarks, listDefectPlans } from '../lib/db';
import { defectSiteKey, KINDS, summarize, type DefectSiteSummary } from '../lib/defects';
import { getPhotoStorage } from '../lib/photo-storage';
import { navigate, paths } from '../lib/router';
import type { PhotoSite } from '../lib/types';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from '../lib/page-title';
import { useAccess } from '../lib/access';
import { useCanCreateProjects } from '../lib/sites';
import { photoSiteKey } from '../lib/photos';
import { ProjectHeading } from '../components/ProjectHeading';
import { dropProjectFromTool, usedIn } from '../lib/crew-link';
import { useDataChanged } from '../lib/data-events';

export const DEFECT_ACCENT = { '--tool': '#d6242b' } as CSSProperties;

/** Mängelplan – Übersicht: Projekte mit Plänen und Markierungen; Plan hochladen erst im Projekt */
export function DefectsPage() {
  const mayCreate = useCanCreateProjects();
  usePageTitle('Mängelplan – BauPad');
  const access = useAccess();
  const [allSummaries, setAllSummaries] = useState<DefectSiteSummary[] | null>(null);
  const [allSites, setAllSites] = useState<PhotoSite[]>([]);
  const summaries = useMemo(() => (allSummaries ? access.filterSites(allSummaries, (x) => x.key) : null), [allSummaries, access.session]);
  const sites = useMemo(() => access.filterSites(allSites, (s) => (s.projectId ? `p:${s.projectId}` : `n:${s.name.trim().toLowerCase()}`)), [allSites, access.session]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PhotoSite | null>(null);

  /** Projekt im Mängelplan: bearbeiten (Projektdaten für alle Tools) oder samt Mängelplänen aus dem Mängelplan löschen */
  const menu = (site: PhotoSite, plans: { id: string }[]) => (
    <ActionMenu
      label={`Aktionen für ${site.name}`}
      testId="defect-site-actions"
      actions={[
        ...(site.projectId && mayCreate ? [{ label: 'Projekt bearbeiten', icon: 'edit' as const, onSelect: () => setEditing(site), testId: 'defect-site-edit' }] : []),
        {
          label: 'Aus Mängelplan löschen',
          icon: 'trash' as const,
          danger: true,
          testId: 'defect-site-delete',
          onSelect: () =>
            void confirmDialog({
              title: 'Aus Mängelplan löschen?',
              message: (
                <>
                  <p>
                    „{site.name}“ wird aus dem Mängelplan entfernt
                    {plans.length ? ` – mit ${plans.length} ${plans.length === 1 ? 'Plan' : 'Plänen'} und allen Markierungen` : ''}.
                  </p>
                  <p className="muted small">Fotos bleiben in der Fotodokumentation, das Projekt bleibt im Register und in den anderen Tools.</p>
                </>
              ),
              confirmLabel: 'Löschen',
              danger: true,
            }).then(async (ok) => {
              if (!ok) return;
              try {
                for (const pl of plans) await deleteDefectPlanCompletely(pl.id);
                if (site.projectId) await dropProjectFromTool(site.projectId, 'defects');
                toast(`„${site.name}“ aus dem Mängelplan gelöscht.`, 'success');
                await reload();
              } catch (e) {
                showError(e, 'Löschen fehlgeschlagen');
              }
            }),
        },
      ]}
    />
  );

  const reload = async () => {
    try {
      const [plans, marks, photos] = await Promise.all([listDefectPlans(), listDefectMarks(), getPhotoStorage().list()]);
      setAllSummaries(summarize(plans, marks));
      setAllSites(await loadPhotoSites(photos));
    } catch (e) {
      showError(e, 'Mängelpläne konnten nicht geladen werden');
    }
  };
  useEffect(() => {
    if (access.ready) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.ready, access.session]);
  useDataChanged(() => void reload());

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (summaries ?? []).filter((s) => !q || [s.site.name, s.site.number, s.site.address, ...s.plans.map((p) => p.title)].join(' ').toLowerCase().includes(q));
  }, [summaries, query]);
  /** im Mängelplan angelegte oder übernommene Projekte, die noch keinen Plan haben */
  const empty = useMemo(() => {
    const q = query.trim().toLowerCase();
    const have = new Set((summaries ?? []).map((s) => s.key));
    return sites.filter((f) => (!f.projectId || usedIn(f, 'defects')) && !have.has(photoSiteKey({ projectId: f.projectId, siteName: f.name })) && (!q || [f.name, f.number, f.address].join(' ').toLowerCase().includes(q)));
  }, [sites, summaries, query]);

  return (
    <>
      <SiteNav />
      <div className="page defects-page" style={DEFECT_ACCENT}>
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zu den Tools" title="Zu den Tools" data-testid="to-tools">
              <Icon name="back" />
            </a>
            <h1 data-testid="defects-title">Mängelplan</h1>
          </div>
          <div className="row gap">
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} title="Projekt aus dem Register übernehmen oder neu anlegen" data-testid="defect-new-site">
              <Icon name="plus" size={16} /> <span className="lbl">{mayCreate ? 'Neues Projekt' : 'Projekt übernehmen'}</span>
            </button>
          </div>
        </header>

        {creating && (
          <ProjectPicker
            tool="defects"
            onClose={() => setCreating(false)}
            onPick={(p) => {
              setCreating(false);
              void reload().then(() => navigate(paths.defectSite(defectSiteKey({ projectId: p.id, siteName: p.site || p.name }))));
            }}
          />
        )}

        {summaries && summaries.length === 0 && empty.length === 0 && (
          <div className="crew-setup" data-testid="defects-empty">
            <span className="tile-icon">
              <ToolIcon name="defects" size={22} />
            </span>
            <div>
              <strong>Noch kein Projekt</strong>
              <p className="muted small">Projekt anlegen oder aus dem Register übernehmen – im Projekt dann den Plan hochladen (PDF oder Foto) und Mängel, Ausbesserungen und Hinweise mit Pins, Formen und Fotos markieren. Am Ende ein PDF fürs Angebot.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {mayCreate ? 'Neues Projekt' : 'Projekt übernehmen'}
            </button>
          </div>
        )}

        {summaries && (summaries.length > 0 || empty.length > 0) && (
          <div className="reports-tools">
            <label className="crew-search reports-search">
              <Icon name="select" size={18} />
              <span className="sr-only">Suchen</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Baustelle, Nummer, Adresse, Plan" data-testid="defect-search" />
            </label>
          </div>
        )}

        <div className="report-sites" data-testid="defect-sites">
          {shown.map((s) => {
            const total = KINDS.reduce((n, k) => n + s.counts[k.id], 0);
            return (
              <div key={s.key} className="defect-row">
              <a href={paths.defectSite(s.key)} className="report-site" data-testid="defect-site" data-site={s.site.name}>
                <div className="report-site-main">
                  <ProjectHeading info={sites.find((x) => photoSiteKey({ projectId: x.projectId, siteName: x.name }) === s.key) ?? s.site} />
                  <span className="small">
                    {s.plans.length} {s.plans.length === 1 ? 'Plan' : 'Pläne'} · {total} {total === 1 ? 'Markierung' : 'Markierungen'} · {s.photos} Fotos
                  </span>
                </div>
                <div className="report-site-counts">
                  {KINDS.map((k) => (
                    <span key={k.id} className={`report-count${s.counts[k.id] ? '' : ' empty'}`} title={k.label}>
                      <span className="defect-kind-dot" style={{ background: k.color }} />
                      <span>{s.counts[k.id]}</span>
                    </span>
                  ))}
                </div>
                <Icon name="next" size={18} />
              </a>
              {menu(sites.find((x) => photoSiteKey({ projectId: x.projectId, siteName: x.name }) === s.key) ?? s.site, s.plans)}
              </div>
            );
          })}
          {empty.map((f) => (
            <div key={`empty:${f.projectId ?? f.name}`} className="defect-row">
            <a href={paths.defectSite(photoSiteKey({ projectId: f.projectId, siteName: f.name }))} className="report-site report-site-empty" data-testid="defect-site-empty" data-site={f.name}>
              <div className="report-site-main">
                <ProjectHeading info={f} />
                <span className="small muted">Noch kein Mängelplan</span>
              </div>
              <Icon name="next" size={18} />
            </a>
            {menu(f, [])}
            </div>
          ))}
        </div>
      </div>
      {editing && (
        <ProjectEditDialog
          site={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Projekt gespeichert – in allen Tools übernommen.', 'success');
            void reload();
          }}
        />
      )}
    </>
  );
}
