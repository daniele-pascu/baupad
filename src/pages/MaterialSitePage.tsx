import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { canSite } from '../lib/access';
import { isoDate } from '../lib/crew';
import { useDataChanged } from '../lib/data-events';
import { deleteMaterialItem, deleteMaterialUse, listMaterialItems, listMaterialPlans, listMaterials, listMaterialUses, listProjects, listSuppliers, loadProjectData, saveMaterialItem, saveMaterialPlan, saveMaterialUse } from '../lib/db';
import { uuid } from '../lib/ids';
import { aufmassSources, stateOf, type QtySource } from '../lib/material-sources';
import {
  BASES,
  calcBasis,
  equipmentAt,
  fmtPrice,
  fmtQty,
  isEquipment,
  itemValue,
  listSummary,
  materialKey,
  matchesMaterial,
  normBasis,
  normUnit,
  overdue,
  packText,
  palletText,
  parsePrice,
  parseQty,
  pendingDuplicate,
  planId,
  RATE_SOURCE_TEXT,
  rateText,
  setStatus,
  siteCalc,
  siteStock,
  sortMaterials,
  sortSuppliers,
  STATUS,
  statusLabel,
  UNITS,
  withHistory,
  type SiteCalc,
  type SiteStock,
  type UseAverage,
} from '../lib/materials';
import { usePageTitle } from '../lib/page-title';
import { paths } from '../lib/router';
import type { Material, MaterialItem, MaterialPlan, MaterialStatus, MaterialUse, Project, Supplier } from '../lib/types';
import { useSession } from '../lib/use-session';
import { ToolMark } from '../components/ToolIcon';

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtAt = (ms: number) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Status beim Hinzufügen: auch schon bestellt bzw. schon auf der Baustelle */
const STATUS_ADD: Record<MaterialStatus, string> = { offen: 'Offen (noch zu bestellen)', bestellt: 'Bestellt (unterwegs)', geliefert: 'Geliefert (auf der Baustelle)' };

/**
 * Materialverwaltung: Materialliste einer Baustelle.
 *  Bestand und Bedarf: je Material bestellt, geliefert, verbraucht, vorhanden – Verbrauch eintragen (optional mit
 *    „dabei geschafft“, daraus der Durchschnitt je m²) und rechnen: Gesamtmenge der Baustelle (Aufmaß, LV oder
 *    eingetippt) × Verbrauch → was fehlt, aufgerundet (ganze Paletten) als Bedarf eintragen.
 *  Bestellpositionen: aus dem Materialstamm (oder frei), Menge, Liefertermin, Lieferant, Status
 *    offen → bestellt → geliefert mit Verlauf (wer, wann). Dasselbe noch nicht gelieferte Material wird nicht doppelt
 *    angelegt (Rückfrage: Menge dazurechnen).
 */
export function MaterialSitePage({ projectId }: { projectId: string }) {
  const session = useSession();
  const by = session?.name || 'Unbekannt';
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [edit, setEdit] = useState<MaterialItem | 'new' | null>(null);
  const [devices, setDevices] = useState<Material[]>([]);
  /** Verbrauch aller Baustellen (Durchschnitt über alle Baustellen); die dieser Baustelle daraus gefiltert */
  const [allUses, setAllUses] = useState<MaterialUse[]>([]);
  const [plans, setPlans] = useState<MaterialPlan[]>([]);
  const [sources, setSources] = useState<QtySource[]>([]);
  const [useEdit, setUseEdit] = useState<{ use: MaterialUse | null; key?: string } | null>(null);
  const [calcKey, setCalcKey] = useState<string | null>(null);
  // aus der Übersicht („Bedarf melden“): gleich das Fenster „Material hinzufügen“ öffnen
  useEffect(() => {
    try {
      if (sessionStorage.getItem('mat-new')) {
        sessionStorage.removeItem('mat-new');
        setEdit('new');
      }
    } catch {
      /* ohne sessionStorage */
    }
  }, []);
  const today = isoDate(new Date());
  const name = project ? [project.number, project.site || project.name].filter(Boolean).join(' · ') : '';
  usePageTitle(project ? `${project.site || project.name} – Material – BauPad` : 'Material – BauPad');

  const reload = () =>
    Promise.all([listProjects(), listMaterialItems(projectId), listMaterials(), listSuppliers(), listMaterialUses(), listMaterialPlans(projectId), loadProjectData(projectId).catch(() => null)])
      .then(([ps, i, m, s, u, pl, pd]) => {
        setProject(ps.find((p) => p.id === projectId) ?? null);
        setItems(i);
        setMaterials(sortMaterials(m.filter((x) => !isEquipment(x))));
        setDevices(m.filter((x) => isEquipment(x) && equipmentAt(x, projectId) > 0).sort((a, b) => a.name.localeCompare(b.name, 'de')));
        setSuppliers(sortSuppliers(s));
        setAllUses(u);
        setPlans(pl);
        setSources(pd ? aufmassSources(stateOf(pd)) : []);
      })
      .catch((e) => showError(e, 'Materialliste konnte nicht geladen werden'));
  useEffect(() => void reload(), [projectId]);
  useDataChanged(() => void reload());

  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const uses = useMemo(() => allUses.filter((u) => u.projectId === projectId), [allUses, projectId]);
  const stock = useMemo(() => siteStock(items, uses, plans), [items, uses, plans]);
  const planOf = (s: Pick<SiteStock, 'materialId' | 'name' | 'unit'>) => plans.find((p) => p.id === planId(projectId, s)) ?? null;
  const materialOf = (s: Pick<SiteStock, 'materialId'>) => (s.materialId ? (matById.get(s.materialId) ?? null) : null);
  const calcOf = (s: SiteStock) => siteCalc({ projectId, stock: s, plan: planOf(s), material: materialOf(s), uses: allUses, sources });
  const sum = listSummary(items);
  const groups = STATUS.map((st) => ({
    st,
    list: items.filter((x) => x.status === st.id).sort((a, b) => (a.deliveryDate || '9999').localeCompare(b.deliveryDate || '9999') || a.name.localeCompare(b.name, 'de')),
  }));

  const advance = (x: MaterialItem, to: MaterialStatus) =>
    void saveMaterialItem(setStatus(x, to, by))
      .then(() => {
        toast(`${x.name}: ${statusLabel(to)}.`, 'success', 1800);
        void reload();
      })
      .catch((e) => showError(e, 'Speichern fehlgeschlagen'));

  if (project === undefined) return <SiteNav />;
  if (project === null || !canSite(session, `p:${projectId}`, 'materials'))
    return (
      <>
        <SiteNav />
        <div className="page">
          <p className="muted" data-testid="material-site-missing">
            Diese Baustelle gibt es nicht (mehr) oder sie ist für dich nicht freigegeben. <a href={paths.materials('baustellen')}>Zu Material</a>
          </p>
        </div>
      </>
    );

  const calcStock = calcKey ? stock.find((s) => s.key === calcKey) : undefined;

  return (
    <>
      <SiteNav />
      <div className="page staff-page materials-page" data-testid="material-site-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.materials('baustellen')} className="icon-link" aria-label="Zu Material" title="Zu Material" data-testid="material-site-back">
              <Icon name="back" />
            </a>
            <ToolMark name="materials" />
            <div>
              <h1 data-testid="material-site-title">{name}</h1>
              <span className="muted small" data-testid="material-site-summary">
                {sum.count.offen} offen · {sum.count.bestellt} bestellt · {sum.count.geliefert} geliefert{sum.value ? ` · ${fmtPrice(sum.value)} netto` : ''}
              </span>
            </div>
          </div>
        </header>

        <div className="mat-site-actions">
          <button type="button" className="account-tile staff-new" onClick={() => setEdit('new')} data-testid="item-new">
            <div>
              <strong>+ Material hinzufügen</strong>
              <span className="muted">bestellt, schon geliefert oder Bedarf – Menge, Liefertermin, Lieferant</span>
            </div>
            <Icon name="next" size={18} />
          </button>
          <button type="button" className="account-tile staff-new" onClick={() => setUseEdit({ use: null })} data-testid="use-new">
            <div>
              <strong>− Verbrauch eintragen</strong>
              <span className="muted">was verbraucht wurde, optional wie viel dabei geschafft wurde (m², m …)</span>
            </div>
            <Icon name="next" size={18} />
          </button>
        </div>

        {!items.length && !stock.length && (
          <p className="muted" data-testid="items-empty">
            Noch kein Material für diese Baustelle.
          </p>
        )}

        {!!stock.length && (
          <section className="material-group" data-testid="stock-section">
            <div className="staff-group">Bestand und Bedarf ({stock.length})</div>
            <ul className="crew-worker-list staff-list">
              {stock.map((s) => {
                const c = calcOf(s);
                return (
                  <li key={s.key} data-testid="stock-row" data-name={s.name}>
                    <div className="staff-row">
                      <button type="button" className="crew-worker-main" onClick={() => setCalcKey(s.key)} data-testid="stock-open">
                        <strong>{s.name}</strong>
                        <span className="muted small" data-testid="stock-numbers">
                          {stockLine(s)}
                        </span>
                        <StockState s={s} c={c} plan={planOf(s)} material={materialOf(s)} />
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setUseEdit({ use: null, key: s.key })} data-testid="stock-use" title={`Verbrauch von ${s.name} eintragen`}>
                        <Icon name="minus" size={16} /> Verbrauch
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {groups
          .filter((g) => g.list.length)
          .map((g) => (
            <section key={g.st.id} className="material-group" data-testid="item-group" data-status={g.st.id}>
              <div className="staff-group">
                {g.st.label} ({g.list.length})
              </div>
              <ul className="crew-worker-list staff-list">
                {g.list.map((x) => (
                  <li key={x.id} data-testid="item-row" data-name={x.name} data-status={x.status}>
                    <div className="staff-row">
                      <button type="button" className="crew-worker-main" onClick={() => setEdit(x)} data-testid="item-open">
                        <strong>
                          {fmtQty(x.qty)} {x.unit} {x.name}
                        </strong>
                        <span className={`small ${overdue(x, today) ? 'warn-text' : 'muted'}`}>
                          {[
                            supName.get(x.supplierId ?? ''),
                            x.deliveryDate && `${overdue(x, today) ? 'überfällig: ' : 'Liefertermin '}${fmtDay(x.deliveryDate)}`,
                            itemValue(x) !== null && fmtPrice(itemValue(x)),
                            x.note,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                      {g.st.next && (
                        <button type="button" className="btn btn-sm" onClick={() => advance(x, g.st.next!)} data-testid="item-advance" title={`Als ${statusLabel(g.st.next)} markieren`}>
                          <Icon name="check" size={16} /> {g.st.action}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {!!devices.length && (
          <section className="material-group" data-testid="site-devices">
            <div className="staff-group">Geräte auf dieser Baustelle ({devices.reduce((n, m) => n + equipmentAt(m, projectId), 0)} Stk)</div>
            <ul className="crew-worker-list staff-list">
              {devices.map((m) => (
                <li key={m.id} data-testid="site-device" data-name={m.name}>
                  <div className="staff-row">
                    <a href={paths.materials('geraete')} className="crew-worker-main">
                      <strong>
                        {equipmentAt(m, projectId)} Stk {m.name}
                      </strong>
                      <span className="muted small">Stückzahl ändern unter „Geräte“</span>
                    </a>
                    <Icon name="next" size={18} className="staff-chevron" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {edit && (
        <ItemDialog
          item={edit === 'new' ? null : edit}
          projectId={projectId}
          items={items}
          materials={materials}
          suppliers={suppliers}
          by={by}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void reload();
          }}
        />
      )}
      {calcStock && (
        <CalcDialog
          s={calcStock}
          calc={(plan) => siteCalc({ projectId, stock: calcStock, plan, material: materialOf(calcStock), uses: allUses, sources })}
          plan={planOf(calcStock)}
          material={materialOf(calcStock)}
          projectId={projectId}
          sources={sources}
          uses={uses.filter((u) => materialKey(u) === calcStock.key).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)}
          items={items}
          by={by}
          onUse={(use) => setUseEdit({ use, key: calcStock.key })}
          onClose={() => setCalcKey(null)}
          onSaved={() => void reload()}
        />
      )}
      {useEdit && (
        <UseDialog
          use={useEdit.use}
          presetKey={useEdit.key}
          stock={stock}
          materials={materials}
          projectId={projectId}
          today={today}
          by={by}
          basisOf={(s) => calcBasis(planOf(s), materialOf(s))}
          onClose={() => setUseEdit(null)}
          onSaved={() => {
            setUseEdit(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

/** „vorhanden 28 Sack · verbraucht 52 · unterwegs 40 · gemeldet 10“ (Nullen außer „vorhanden“ weggelassen) */
function stockLine(s: SiteStock): string {
  return [`vorhanden ${fmtQty(s.onSite)} ${s.unit}`, s.used > 0 && `verbraucht ${fmtQty(s.used)}`, s.ordered > 0 && `unterwegs ${fmtQty(s.ordered)}`, s.open > 0 && `gemeldet ${fmtQty(s.open)}`].filter(Boolean).join(' · ');
}

/** Ergebnis der Bedarfsrechnung in der Zeile: nachbestellen, reicht oder was noch fehlt */
function StockState({ s, c, plan, material }: { s: SiteStock; c: SiteCalc; plan: MaterialPlan | null; material: Material | null }) {
  if (!plan) return null;
  if (!c.total) return <span className="muted small">Rechnen: Gesamtmenge der Baustelle fehlt</span>;
  if (!c.result)
    return (
      <span className="muted small" data-testid="stock-state">
        Rechnen: Verbrauch je {c.basis} fehlt
      </span>
    );
  if (c.result.reorder > 0) {
    const pal = palletText(c.result.reorder, material?.perPallet, s.unit);
    return (
      <span className="small warn-text" data-testid="stock-state" data-state="reorder">
        {fmtQty(c.result.reorder)} {s.unit} nachbestellen{pal ? ` (${pal})` : ''}
      </span>
    );
  }
  return (
    <span className="small ok-text" data-testid="stock-state" data-state="ok">
      reicht für {fmtQty(c.total)} {c.basis}
    </span>
  );
}

const avgText = (a: UseAverage, unit: string, basis: string) => `${rateText(a.rate, unit, basis)} (${fmtQty(a.qty)} ${unit} auf ${fmtQty(a.done)} ${basis})`;

/**
 * Bestand eines Materials auf der Baustelle und Bedarfsrechnung: Gesamtmenge × Verbrauch je Bezugsgröße
 * (automatisch erkannt oder eigener Wert) → was fehlt; als Bedarf (offene Position) eintragen. Darunter die Verbrauchseinträge.
 */
function CalcDialog({
  s,
  calc,
  plan,
  material,
  projectId,
  sources,
  uses,
  items,
  by,
  onUse,
  onClose,
  onSaved,
}: {
  s: SiteStock;
  calc(plan: MaterialPlan | null): SiteCalc;
  plan: MaterialPlan | null;
  material: Material | null;
  projectId: string;
  sources: QtySource[];
  uses: MaterialUse[];
  items: MaterialItem[];
  by: string;
  onUse(use: MaterialUse | null): void;
  onClose(): void;
  onSaved(): void;
}) {
  const base = calc(plan);
  const [v, setV] = useState({
    basis: base.basis,
    total: plan?.total ? fmtQty(plan.total) : '',
    source: plan?.source ?? '',
    mode: plan?.rateMode ?? ('auto' as 'auto' | 'own'),
    rate: plan?.rate ? fmtQty(plan.rate) : '',
    rateUnit: plan?.rateUnit ?? s.unit,
    pallets: plan?.pallets ?? false,
  });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const fitting = sources.filter((x) => normBasis(x.unit) === normBasis(v.basis));
  const source = fitting.find((x) => x.id === v.source) ?? null;
  const total = source ? source.value : parseQty(v.total);
  const rate = v.mode === 'own' ? parseQty(v.rate) : null;
  const rateUnits = [...new Set([s.unit, ...(material?.packSize && material.packUnit ? [material.packUnit] : [])])];
  /** Bedarfsrechnung, wie sie gespeichert würde */
  const draft = (): MaterialPlan => {
    const now = Date.now();
    return {
      ...(plan ?? { id: planId(projectId, s), projectId, createdAt: now }),
      materialId: s.materialId,
      name: s.name,
      unit: s.unit,
      basis: v.basis,
      total: total ?? null,
      source: source?.id ?? null,
      rateMode: v.mode,
      rate: v.mode === 'own' ? (rate ?? null) : (plan?.rate ?? null),
      rateUnit: v.rateUnit,
      pallets: v.pallets,
      updatedAt: now,
    };
  };
  const c = calc(draft());
  const r = c.result;
  const invalid = (!source && total === undefined) || (v.mode === 'own' && rate === undefined);

  const savePlan = async () => {
    setShow(true);
    if (invalid) return false;
    const p = draft();
    // nichts eingetragen und noch keine Rechnung → nichts speichern
    if (!plan && p.total === null && !(v.mode === 'own' && rate)) return true;
    await saveMaterialPlan(p);
    return true;
  };
  const save = async () => {
    setBusy(true);
    try {
      if (await savePlan()) {
        toast('Gespeichert.', 'success', 1500);
        onSaved();
        onClose();
      }
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  /** fehlende Menge als offene Position (Bedarf) eintragen – zu einer schon offenen Position desselben Materials dazu */
  const order = async () => {
    if (!r || r.reorder <= 0) return;
    setBusy(true);
    try {
      if (!(await savePlan())) return;
      const now = Date.now();
      const open = items.find((i) => i.status === 'offen' && materialKey(i) === s.key);
      const last = [...items].filter((i) => materialKey(i) === s.key).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const why = `Nachbestellung aus der Bedarfsrechnung (${fmtQty(c.total)} ${c.basis})`;
      if (open) {
        const qty = (open.qty ?? 0) + r.reorder;
        await saveMaterialItem(withHistory({ ...open, qty }, by, `${why}: +${fmtQty(r.reorder)} → ${fmtQty(qty)} ${open.unit}`, now));
      } else {
        await saveMaterialItem({
          id: uuid(),
          projectId,
          materialId: s.materialId,
          name: s.name,
          unit: s.unit,
          price: material?.price ?? last?.price ?? null,
          qty: r.reorder,
          supplierId: material?.supplierId ?? last?.supplierId ?? null,
          status: 'offen',
          note: 'Nachbestellung',
          history: [{ at: now, by, text: why }],
          createdAt: now,
          updatedAt: now,
        });
      }
      toast(`${fmtQty(r.reorder)} ${s.unit} ${s.name} als Bedarf eingetragen – zu bestellen unter „Bestellungen“.`, 'success');
      onSaved();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const kpis: { n: number; label: string; id: string }[] = [
    { n: s.onSite, label: 'vorhanden', id: 'onSite' },
    { n: s.used, label: 'verbraucht', id: 'used' },
    { n: s.ordered, label: 'unterwegs', id: 'ordered' },
    { n: s.open, label: 'gemeldet', id: 'open' },
  ];
  const known = [
    c.site && `Baustelle: ${avgText(c.site, s.unit, c.basis)}`,
    c.company && (!c.site || c.company.n > c.site.n) && `Alle Baustellen: ${avgText(c.company, s.unit, c.basis)}`,
    c.guide && `Richtwert: ${rateText(c.guide, s.unit, c.basis)}`,
  ].filter(Boolean) as string[];

  return (
    <Modal
      title={s.name}
      onClose={onClose}
      testId="stock-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="calc-close">
            Schließen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy} data-testid="calc-save">
            <Icon name="check" size={18} /> Speichern
          </button>
        </>
      }
    >
      <div className="stock-kpis" data-testid="stock-kpis">
        {kpis.map((k) => (
          <div key={k.id} className="stock-kpi" data-testid={`stock-kpi-${k.id}`}>
            <strong>{fmtQty(k.n)}</strong>
            <span>
              {s.unit} {k.label}
            </span>
          </div>
        ))}
      </div>
      {packText(s.onSite, material) && <p className="muted small">vorhanden = {packText(s.onSite, material)}{palletText(s.onSite, material?.perPallet, s.unit) ? ` · ${palletText(s.onSite, material?.perPallet, s.unit)}` : ''}</p>}

      <h3 className="hub-sub">Was brauche ich noch?</h3>
      <div className="stack-fields">
        <div className="form-grid">
          <label className="field">
            <span>Gesamtmenge der Baustelle</span>
            <input
              value={source ? fmtQty(source.value) : v.total}
              onChange={(e) => setV({ ...v, total: e.target.value, source: '' })}
              inputMode="decimal"
              placeholder="z. B. 500"
              aria-invalid={show && !source && total === undefined ? true : undefined}
              data-testid="calc-total"
            />
          </label>
          <label className="field">
            <span>Bezug</span>
            <select value={v.basis} onChange={(e) => setV({ ...v, basis: e.target.value, source: '' })} data-testid="calc-basis">
              {BASES.map((b) => (
                <option key={b} value={b}>
                  je {b}
                </option>
              ))}
            </select>
          </label>
        </div>
        {fitting.length > 0 ? (
          <label className="field">
            <span>Automatisch aus Aufmaß oder LV</span>
            <select value={source?.id ?? ''} onChange={(e) => setV({ ...v, source: e.target.value, total: e.target.value ? '' : v.total })} data-testid="calc-source">
              <option value="">– selbst eintippen –</option>
              {fitting.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}: {fmtQty(x.value)} {x.unit}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted small" data-testid="calc-no-source">
            Im Aufmaß dieser Baustelle gibt es noch keine Mengen in {v.basis} – Gesamtmenge bitte eintippen.
          </p>
        )}
        <label className="field">
          <span>Verbrauch je {v.basis}</span>
          <select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as 'auto' | 'own' })} data-testid="calc-mode">
            <option value="auto">Automatisch erkennen (Durchschnitt)</option>
            <option value="own">Eigener Wert</option>
          </select>
        </label>
        {v.mode === 'own' && (
          <div className="form-grid">
            <label className="field">
              <span>Menge je {v.basis}</span>
              <input value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} inputMode="decimal" placeholder="z. B. 0,3" aria-invalid={show && rate === undefined ? true : undefined} data-testid="calc-rate" />
            </label>
            <label className="field">
              <span>Einheit</span>
              <select value={rateUnits.includes(v.rateUnit) ? v.rateUnit : s.unit} onChange={(e) => setV({ ...v, rateUnit: e.target.value })} data-testid="calc-rate-unit">
                {rateUnits.map((u) => (
                  <option key={u} value={u}>
                    {u} je {v.basis}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="calc-rate-info small" data-testid="calc-rate-info">
          {c.rate ? (
            <strong>
              {RATE_SOURCE_TEXT[c.rate.source]}: {rateText(c.rate.rate, s.unit, c.basis)}
            </strong>
          ) : v.mode === 'auto' ? (
            <span className="muted">Noch kein Durchschnitt: beim Verbrauch eintragen, wie viel {v.basis} dabei geschafft wurden – oder einen eigenen Wert angeben.</span>
          ) : null}
          {v.mode === 'auto' && known.length > 1 && (
            <ul className="muted">
              {known.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
        {!!material?.perPallet && normUnit(s.unit) !== 'palette' && (
          <label className="check">
            <input type="checkbox" checked={v.pallets} onChange={(e) => setV({ ...v, pallets: e.target.checked })} data-testid="calc-pallets" /> auf ganze Paletten aufrunden ({fmtQty(material.perPallet)} {s.unit})
          </label>
        )}
        {show && !source && total === undefined && <p className="error small">Gesamtmenge bitte als Zahl, z. B. 500 oder 12,5.</p>}
        {show && v.mode === 'own' && rate === undefined && <p className="error small">Verbrauch bitte als Zahl, z. B. 0,3.</p>}
      </div>

      {r && (
        <div className="calc-result" data-testid="calc-result">
          <div>
            <span>Bedarf für {fmtQty(c.total)} {c.basis}</span>
            <strong data-testid="calc-need">
              {fmtQty(r.need)} {s.unit}
            </strong>
          </div>
          <div>
            <span>davon verbraucht</span>
            <strong>{fmtQty(s.used)}</strong>
          </div>
          <div>
            <span>noch nötig</span>
            <strong>{fmtQty(r.remaining)}</strong>
          </div>
          <div>
            <span>vorhanden, unterwegs, gemeldet</span>
            <strong>{fmtQty(r.covered)}</strong>
          </div>
          {r.reorder > 0 ? (
            <div className="calc-total warn">
              <span>Nachbestellen</span>
              <strong data-testid="calc-reorder">
                {fmtQty(r.reorder)} {s.unit}
                {palletText(r.reorder, material?.perPallet, s.unit) ? ` = ${palletText(r.reorder, material?.perPallet, s.unit)}` : ''}
              </strong>
            </div>
          ) : (
            <div className="calc-total ok">
              <span>Reicht</span>
              <strong data-testid="calc-reorder">{r.surplus > 0 ? `${fmtQty(r.surplus)} ${s.unit} bleiben übrig` : 'genau'}</strong>
            </div>
          )}
        </div>
      )}
      {r && r.reorder > 0 && (
        <button type="button" className="btn btn-primary calc-order" onClick={() => void order()} disabled={busy} data-testid="calc-order">
          <Icon name="plus" size={18} /> {fmtQty(r.reorder)} {s.unit} als Bedarf eintragen
        </button>
      )}

      <h3 className="hub-sub">Verbrauch ({uses.length})</h3>
      <button type="button" className="btn" onClick={() => onUse(null)} data-testid="stock-use-add">
        <Icon name="minus" size={16} /> Verbrauch eintragen
      </button>
      {uses.length > 0 && (
        <ul className="hub-list use-list" data-testid="use-list">
          {uses.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => onUse(u)} data-testid="use-row">
                <strong>
                  {fmtQty(u.qty)} {u.unit}
                  {u.done ? ` für ${fmtQty(u.done)} ${u.doneUnit ?? ''}` : ''}
                </strong>
                <span className="muted small">{[fmtDay(u.date), u.by, u.note].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Verbrauch eintragen bzw. ändern: Material, Menge, Tag, optional dabei geschafft (m², m …) */
function UseDialog({
  use,
  presetKey,
  stock,
  materials,
  projectId,
  today,
  by,
  basisOf,
  onClose,
  onSaved,
}: {
  use: MaterialUse | null;
  presetKey?: string;
  stock: SiteStock[];
  materials: Material[];
  projectId: string;
  today: string;
  by: string;
  basisOf(s: Pick<SiteStock, 'materialId' | 'name' | 'unit'>): string;
  onClose(): void;
  onSaved(): void;
}) {
  const keys = new Set(stock.map((s) => s.key));
  const others = materials.filter((m) => !keys.has(m.id));
  const initialKey = use ? materialKey(use) : (presetKey ?? (stock.length === 1 ? stock[0].key : ''));
  const [key, setKey] = useState(initialKey);
  const chosen = (k: string) => {
    const s = stock.find((x) => x.key === k);
    if (s) return { key: s.key, materialId: s.materialId, name: s.name, unit: s.unit, onSite: s.onSite as number | null };
    const m = materials.find((x) => x.id === k);
    return m ? { key: m.id, materialId: m.id, name: m.name, unit: m.unit, onSite: null } : null;
  };
  const sel = chosen(key);
  const [v, setV] = useState({
    qty: use ? fmtQty(use.qty) : '',
    date: use?.date ?? today,
    done: use?.done ? fmtQty(use.done) : '',
    doneUnit: use?.doneUnit ?? (sel ? basisOf(sel) : 'm²'),
    note: use?.note ?? '',
  });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const qty = parseQty(v.qty);
  const done = parseQty(v.done);
  const fixed = !!use || !!presetKey;
  const pick = (k: string) => {
    setKey(k);
    const s = chosen(k);
    if (s && !v.done) setV({ ...v, doneUnit: basisOf(s) });
  };

  const submit = async () => {
    setShow(true);
    if (!sel || !qty || done === undefined || !v.date) return;
    const now = Date.now();
    const next: MaterialUse = {
      ...(use ?? { id: uuid(), projectId, createdAt: now }),
      materialId: sel.materialId,
      name: sel.name,
      unit: sel.unit,
      date: v.date,
      qty,
      done,
      doneUnit: done ? v.doneUnit : undefined,
      note: v.note.trim(),
      by: use?.by ?? by,
      updatedAt: now,
    };
    setBusy(true);
    try {
      await saveMaterialUse(next);
      toast(use ? 'Verbrauch gespeichert.' : `Verbrauch eingetragen: ${fmtQty(qty)} ${sel.unit} ${sel.name}.`, 'success', 2000);
      onSaved();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!use) return;
    if (!(await confirmDialog({ title: 'Verbrauch löschen?', message: <p>{`${fmtQty(use.qty)} ${use.unit} ${use.name} vom ${fmtDay(use.date)}`} wird gelöscht.</p>, confirmLabel: 'Löschen', danger: true }))) return;
    await deleteMaterialUse(use.id);
    onSaved();
  };
  /** mehr als laut BauPad vorhanden (beim Bearbeiten zählt der bisherige Eintrag schon im Verbrauch) */
  const over = sel?.onSite !== null && sel?.onSite !== undefined && qty ? qty - (use?.qty ?? 0) > sel.onSite : false;

  return (
    <Modal
      title={use ? 'Verbrauch bearbeiten' : 'Verbrauch eintragen'}
      onClose={onClose}
      testId="use-dialog"
      footer={
        <>
          {use && (
            <button type="button" className="btn btn-danger-text" onClick={() => void remove()} disabled={busy} data-testid="use-delete">
              <Icon name="trash" size={18} /> Löschen
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || (!stock.length && !materials.length)} data-testid="use-save">
            <Icon name="check" size={18} /> Speichern
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
        {!stock.length && !materials.length ? (
          <p className="muted" data-testid="use-no-material">
            Noch kein Material auf dieser Baustelle. Zuerst „Material hinzufügen“ oder im Materialstamm anlegen.
          </p>
        ) : fixed && sel ? (
          <p className="use-material" data-testid="use-material-fixed">
            <strong>{sel.name}</strong>
            {sel.onSite !== null && (
              <span className="muted small">
                {' '}
                · vorhanden {fmtQty(sel.onSite)} {sel.unit}
              </span>
            )}
          </p>
        ) : (
          <label className="field">
            <span>Material *</span>
            <select value={key} onChange={(e) => pick(e.target.value)} aria-invalid={show && !sel ? true : undefined} data-testid="use-material">
              <option value="">– Material wählen –</option>
              {stock.length > 0 && (
                <optgroup label="Auf dieser Baustelle">
                  {stock.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name} – vorhanden {fmtQty(s.onSite)} {s.unit}
                    </option>
                  ))}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Aus dem Materialstamm">
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.unit})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        )}
        <div className="form-grid">
          <label className="field">
            <span>Verbraucht{sel ? ` (${sel.unit})` : ''} *</span>
            <input value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} inputMode="decimal" placeholder="z. B. 12" aria-invalid={show && !qty ? true : undefined} data-autofocus data-testid="use-qty" />
          </label>
          <label className="field">
            <span>Tag</span>
            <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} data-testid="use-date" />
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Dabei geschafft (optional)</span>
            <input value={v.done} onChange={(e) => setV({ ...v, done: e.target.value })} inputMode="decimal" placeholder="z. B. 40" aria-invalid={show && done === undefined ? true : undefined} data-testid="use-done" />
          </label>
          <label className="field">
            <span>Bezug</span>
            <select value={v.doneUnit} onChange={(e) => setV({ ...v, doneUnit: e.target.value })} data-testid="use-done-unit">
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">Mit „dabei geschafft“ erkennt BauPad den Durchschnitt je {v.doneUnit} und rechnet aus, was noch nachbestellt werden muss.</p>
        <label className="field">
          <span>Notiz</span>
          <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="z. B. Achse A–C, 2. Lage" data-testid="use-note" />
        </label>
        {over && (
          <p className="small warn-text" data-testid="use-over">
            Mehr als laut BauPad vorhanden ({fmtQty(sel!.onSite!)} {sel!.unit}) – speichern geht trotzdem.
          </p>
        )}
        {show && !sel && <p className="error small">Bitte ein Material wählen.</p>}
        {show && !qty && <p className="error small">Menge bitte als Zahl, z. B. 12 oder 2,5.</p>}
        {show && done === undefined && <p className="error small">„Dabei geschafft“ bitte als Zahl, z. B. 40.</p>}
        {use && <p className="muted small">Eingetragen von {use.by} am {fmtAt(use.createdAt)}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function ItemDialog({ item, projectId, items, materials, suppliers, by, onClose, onSaved }: { item: MaterialItem | null; projectId: string; items: MaterialItem[]; materials: Material[]; suppliers: Supplier[]; by: string; onClose(): void; onSaved(): void }) {
  const [materialId, setMaterialId] = useState(item?.materialId ?? '');
  const [search, setSearch] = useState('');
  const [v, setV] = useState({
    name: item?.name ?? '',
    unit: item?.unit ?? 'Stk',
    qty: item ? fmtQty(item.qty) : '',
    price: item?.price !== null && item?.price !== undefined ? String(item.price).replace('.', ',') : '',
    supplierId: item?.supplierId ?? '',
    deliveryDate: item?.deliveryDate ?? '',
    status: item?.status ?? ('offen' as MaterialStatus),
    note: item?.note ?? '',
  });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const supName = new Map(suppliers.map((s) => [s.id, s.name]));
  const found = materials.filter((m) => matchesMaterial(m, search, supName.get(m.supplierId ?? '') ?? '')).slice(0, 50);
  const qty = parseQty(v.qty);
  const price = parsePrice(v.price);
  const units = UNITS.includes(v.unit) || !v.unit ? UNITS : [v.unit, ...UNITS];

  /** Material aus dem Stamm gewählt: Bezeichnung, Einheit, Preis und Lieferant übernehmen */
  const pick = (id: string) => {
    setMaterialId(id);
    const m = materials.find((x) => x.id === id);
    if (m) setV({ ...v, name: m.name, unit: m.unit, price: m.price !== null && m.price !== undefined ? String(m.price).replace('.', ',') : '', supplierId: m.supplierId ?? v.supplierId });
  };

  const submit = async () => {
    setShow(true);
    if (!v.name.trim() || qty === undefined || price === undefined) return;
    const now = Date.now();
    // dasselbe Material ist auf dieser Baustelle schon offen/bestellt → Menge dazurechnen statt doppelt anlegen
    if (!item && v.status === 'offen') {
      const dup = pendingDuplicate(items, { materialId: materialId || null, name: v.name, unit: v.unit });
      if (dup) {
        const ok = await confirmDialog({
          title: 'Schon auf der Materialliste',
          message: (
            <p>
              {dup.name} steht schon auf der Liste ({statusLabel(dup.status)}, {fmtQty(dup.qty)} {dup.unit}). Menge {fmtQty(qty)} {v.unit} dazurechnen?
            </p>
          ),
          confirmLabel: 'Dazurechnen',
        });
        if (!ok) return;
        const total = (dup.qty ?? 0) + (qty ?? 0);
        await saveMaterialItem(withHistory({ ...dup, qty: total || null }, by, `Menge +${fmtQty(qty)} → ${fmtQty(total)} ${dup.unit}`, now));
        toast(`${dup.name}: Menge auf ${fmtQty(total)} ${dup.unit} erhöht.`, 'success');
        onSaved();
        return;
      }
    }
    const base: MaterialItem = item ?? { id: uuid(), projectId, status: 'offen', history: [{ at: now, by, text: 'Angelegt' }], createdAt: now, updatedAt: now, name: '', unit: '', qty: null };
    let next: MaterialItem = {
      ...base,
      materialId: materialId || null,
      name: v.name.trim(),
      unit: v.unit.trim(),
      qty,
      price,
      supplierId: v.supplierId || null,
      deliveryDate: v.deliveryDate,
      note: v.note.trim(),
      updatedAt: now,
    };
    if (item) {
      const changes = [
        item.qty !== qty && `Menge ${fmtQty(item.qty) || '–'} → ${fmtQty(qty) || '–'}`,
        (item.deliveryDate ?? '') !== v.deliveryDate && `Liefertermin ${v.deliveryDate ? fmtDay(v.deliveryDate) : 'entfernt'}`,
      ].filter(Boolean) as string[];
      if (changes.length) next = withHistory(next, by, changes.join(', '), now);
    }
    next = setStatus(next, v.status, by, now);
    setBusy(true);
    try {
      await saveMaterialItem(next);
      toast(item ? 'Gespeichert.' : `${next.name} hinzugefügt.`, 'success', 1800);
      onSaved();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!item) return;
    if (!(await confirmDialog({ title: 'Position löschen?', message: <p>{item.name} wird von der Materialliste dieser Baustelle gelöscht.</p>, confirmLabel: 'Löschen', danger: true }))) return;
    await deleteMaterialItem(item.id);
    onSaved();
  };

  return (
    <Modal
      title={item ? item.name : 'Material hinzufügen'}
      onClose={onClose}
      testId="item-dialog"
      footer={
        <>
          {item && (
            <button type="button" className="btn btn-danger-text" onClick={() => void remove()} disabled={busy} data-testid="item-delete">
              <Icon name="trash" size={18} /> Löschen
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} data-testid="item-save">
            <Icon name={item ? 'check' : 'plus'} size={18} /> {item ? 'Speichern' : 'Hinzufügen'}
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
        {!item && materials.length > 0 && (
          <div className="field">
            <span>Aus dem Materialstamm</span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Material oder Artikelnummer suchen" data-testid="item-search" />
            <select value={materialId} onChange={(e) => pick(e.target.value)} size={Math.min(6, Math.max(2, found.length + 1))} data-testid="item-material">
              <option value="">– frei eingeben –</option>
              {found.map((m) => (
                <option key={m.id} value={m.id}>
                  {[m.name, m.articleNo && `Nr. ${m.articleNo}`, m.unit, m.price !== null && m.price !== undefined ? fmtPrice(m.price) : ''].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </div>
        )}
        <label className="field">
          <span>Bezeichnung *</span>
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-invalid={show && !v.name.trim() ? true : undefined} data-testid="item-name" />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Menge</span>
            <input inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} aria-invalid={show && qty === undefined ? true : undefined} placeholder="z. B. 20" data-testid="item-qty" />
          </label>
          <label className="field">
            <span>Einheit</span>
            <select value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} data-testid="item-unit">
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Status</span>
          <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as MaterialStatus })} data-testid="item-status">
            {STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {item ? s.label : STATUS_ADD[s.id]}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Liefertermin</span>
            <input type="date" value={v.deliveryDate} onChange={(e) => setV({ ...v, deliveryDate: e.target.value })} data-testid="item-date" />
          </label>
          <label className="field">
            <span>Preis je Einheit (€)</span>
            <input inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} aria-invalid={show && price === undefined ? true : undefined} data-testid="item-price" />
          </label>
        </div>
        <label className="field">
          <span>Lieferant</span>
          <select value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })} data-testid="item-supplier">
            <option value="">– keiner –</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Notiz</span>
          <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="z. B. Abladestelle, Ansprechpartner vor Ort" data-testid="item-note" />
        </label>
        {show && !v.name.trim() && <p className="error small">Bitte eine Bezeichnung eingeben oder ein Material wählen.</p>}
        {show && qty === undefined && <p className="error small">Menge bitte als Zahl, z. B. 20 oder 2,5.</p>}
        {show && price === undefined && <p className="error small">Preis bitte als Zahl, z. B. 12,50.</p>}
        {item && item.history?.length > 0 && (
          <div className="field">
            <span>Verlauf</span>
            <ul className="material-history small muted" data-testid="item-history">
              {[...item.history].reverse().map((h, i) => (
                <li key={i}>
                  {fmtAt(h.at)} · {h.by}: {h.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
