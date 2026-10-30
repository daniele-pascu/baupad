import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { DefectPlanDialog } from '../components/DefectPlanDialog';
import { Icon } from '../components/Icon';
import { PhotoSiteDialog } from '../components/PhotoSitePicker';
import { SiteNav } from '../components/SiteNav';
import { ToolIcon } from '../components/ToolIcon';
import { showError } from '../components/ui';
import { listDefectMarks, listDefectPlans } from '../lib/db';
import { defectSiteKey, KINDS, summarize, type DefectSiteSummary } from '../lib/defects';
import { getPhotoStorage } from '../lib/photo-storage';
import { navigate, paths } from '../lib/router';
import type { PhotoSite } from '../lib/types';
import { loadPhotoSites } from './PhotosPage';
import { usePageTitle } from '../lib/page-title';
import { useAccess } from '../lib/access';

export const DEFECT_ACCENT = { '--tool': '#d6242b' } as CSSProperties;

/** Mängelplan – Übersicht: Baustellen mit Plänen und Markierungen, Plan hochladen, neue Baustelle */
export function DefectsPage() {
  usePageTitle('Mängelplan – BauPad');
  const [summaries, setSummaries] = useState<DefectSiteSummary[] | null>(null);
  const [sites, setSites] = useState<PhotoSite[]>([]);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const access = useAccess();

  const reload = async () => {
    try {
      const [plans, marks, photos] = await Promise.all([listDefectPlans(), listDefectMarks(), getPhotoStorage().list()]);
      setSummaries(access.filterSites(summarize(plans, marks), (x) => x.key));
      setSites(access.filterSites(await loadPhotoSites(photos), (s) => (s.projectId ? `p:${s.projectId}` : `n:${s.name.trim().toLowerCase()}`)));
    } catch (e) {
      showError(e, 'Mängelpläne konnten nicht geladen werden');
    }
  };
  useEffect(() => {
    if (access.ready) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.ready, access.session]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (summaries ?? []).filter((s) => !q || [s.site.name, s.site.number, s.site.address, ...s.plans.map((p) => p.title)].join(' ').toLowerCase().includes(q));
  }, [summaries, query]);

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
            <button type="button" className="btn btn-sm" onClick={() => setCreating(true)} data-testid="defect-new-site">
              <Icon name="plus" size={16} /> <span className="lbl">Neues Projekt</span>
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setUploading(true)} data-testid="defect-upload">
              <Icon name="upload" size={16} /> Plan hochladen
            </button>
          </div>
        </header>

        {creating && (
          <PhotoSiteDialog
            hint="Die Baustelle steht danach auch in der Fotodokumentation zur Verfügung."
            onClose={() => setCreating(false)}
            onSaved={(s) => {
              setCreating(false);
              void reload().then(() => navigate(paths.defectSite(defectSiteKey({ projectId: null, siteName: s.name }))));
            }}
          />
        )}
        {uploading && (
          <DefectPlanDialog
            sites={sites}
            onClose={() => setUploading(false)}
            onCreated={(p) => {
              setUploading(false);
              navigate(paths.defectPlan(p.id));
            }}
          />
        )}

        {summaries && summaries.length === 0 && (
          <div className="crew-setup" data-testid="defects-empty">
            <span className="tile-icon">
              <ToolIcon name="defects" size={22} />
            </span>
            <div>
              <strong>Noch kein Mängelplan</strong>
              <p className="muted small">Plan hochladen (PDF oder Foto), dann Mängel, Ausbesserungen und Hinweise mit Pins, Formen und Fotos markieren. Am Ende ein PDF fürs Angebot.</p>
            </div>
          </div>
        )}

        {summaries && summaries.length > 0 && (
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
              <a key={s.key} href={paths.defectSite(s.key)} className="report-site" data-testid="defect-site" data-site={s.site.name}>
                <div className="report-site-main">
                  <strong>{s.site.name}</strong>
                  <span className="muted small">{[s.site.number, s.site.address].filter(Boolean).join(' · ')}</span>
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
            );
          })}
        </div>
      </div>
    </>
  );
}
