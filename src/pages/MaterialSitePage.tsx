import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { canSite } from '../lib/access';
import { isoDate } from '../lib/crew';
import { useDataChanged } from '../lib/data-events';
import { deleteMaterialItem, listMaterialItems, listMaterials, listProjects, listSuppliers, saveMaterialItem } from '../lib/db';
import { uuid } from '../lib/ids';
import { equipmentAt, isEquipment, fmtPrice, fmtQty, itemValue, listSummary, matchesMaterial, overdue, parsePrice, parseQty, pendingDuplicate, setStatus, sortMaterials, sortSuppliers, STATUS, statusLabel, UNITS, withHistory } from '../lib/materials';
import { usePageTitle } from '../lib/page-title';
import { paths } from '../lib/router';
import type { Material, MaterialItem, MaterialStatus, Project, Supplier } from '../lib/types';
import { useSession } from '../lib/use-session';
import { ToolMark } from '../components/ToolIcon';

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtAt = (ms: number) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Materialverwaltung (Teil 2): Materialliste einer Baustelle – Material aus dem Materialstamm (oder frei), Menge,
 * Liefertermin, Lieferant, Status offen → bestellt → geliefert mit Verlauf (wer, wann). Dasselbe noch nicht gelieferte
 * Material wird nicht doppelt angelegt (Rückfrage: Menge dazurechnen).
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
    Promise.all([listProjects(), listMaterialItems(projectId), listMaterials(), listSuppliers()])
      .then(([ps, i, m, s]) => {
        setProject(ps.find((p) => p.id === projectId) ?? null);
        setItems(i);
        setMaterials(sortMaterials(m.filter((x) => !isEquipment(x))));
        setDevices(m.filter((x) => isEquipment(x) && equipmentAt(x, projectId) > 0).sort((a, b) => a.name.localeCompare(b.name, 'de')));
        setSuppliers(sortSuppliers(s));
      })
      .catch((e) => showError(e, 'Materialliste konnte nicht geladen werden'));
  useEffect(() => void reload(), [projectId]);
  useDataChanged(() => void reload());

  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
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
            Diese Baustelle gibt es nicht (mehr) oder sie ist für dich nicht freigegeben. <a href={paths.materials('baustellen')}>Zur Materialverwaltung</a>
          </p>
        </div>
      </>
    );

  return (
    <>
      <SiteNav />
      <div className="page staff-page materials-page" data-testid="material-site-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.materials('baustellen')} className="icon-link" aria-label="Zur Materialverwaltung" title="Zur Materialverwaltung" data-testid="material-site-back">
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

        <button type="button" className="account-tile staff-new" onClick={() => setEdit('new')} data-testid="item-new">
          <div>
            <strong>+ Material hinzufügen</strong>
            <span className="muted">aus dem Materialstamm oder frei – Menge, Liefertermin, Lieferant</span>
          </div>
          <Icon name="next" size={18} />
        </button>

        {!items.length && (
          <p className="muted" data-testid="items-empty">
            Noch kein Material für diese Baustelle.
          </p>
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
    </>
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
    if (!item) {
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
      next = setStatus(next, v.status, by, now);
    }
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
        {item && (
          <label className="field">
            <span>Status</span>
            <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as MaterialStatus })} data-testid="item-status">
              {STATUS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
