import { useEffect, useMemo, useState, type InputHTMLAttributes } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { SiteNav } from '../components/SiteNav';
import { confirmDialog, showError, toast } from '../components/ui';
import { useDataChanged } from '../lib/data-events';
import { deleteMaterial, deleteSupplier, listMaterialItems, listMaterials, listProjects, listSuppliers, saveMaterial, saveSupplier } from '../lib/db';
import { canSite } from '../lib/access';
import { useSession } from '../lib/use-session';
import { listSummary } from '../lib/materials';
import { uuid } from '../lib/ids';
import { fmtPrice, materialDuplicates, matchesMaterial, normKey, parsePrice, sortMaterials, sortSuppliers, supplierDuplicates, UNITS, type MaterialDuplicate } from '../lib/materials';
import { usePageTitle } from '../lib/page-title';
import { navigate, paths } from '../lib/router';
import type { Material, MaterialItem, Project, Supplier } from '../lib/types';
import { pcStyle, useProjectColors } from '../lib/project-colors';

type Tab = 'sites' | 'materials' | 'suppliers';

/**
 * Materialverwaltung (Teil 1): Materialstamm und Lieferanten der Firma – einmal angelegt, auf allen Geräten
 * verfügbar (Abgleich wie alle Werkzeuge). Doppelte Einträge werden beim Anlegen gemeldet.
 */
export function MaterialsPage({ tab }: { tab: Tab }) {
  usePageTitle('Materialverwaltung – BauPad');
  const colorOf = useProjectColors();
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery] = useState('');
  const [editMat, setEditMat] = useState<Material | 'new' | null>(null);
  const [editSup, setEditSup] = useState<Supplier | 'new' | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const session = useSession();

  const reload = () =>
    Promise.all([listMaterials(), listSuppliers(), listProjects(), listMaterialItems()])
      .then(([m, s, p, i]) => {
        setMaterials(m);
        setSuppliers(s);
        setProjects(p);
        setItems(i);
      })
      .catch((e) => showError(e, 'Materialien konnten nicht geladen werden'));
  useEffect(() => void reload(), []);
  useDataChanged(() => void reload());

  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const matList = useMemo(() => sortMaterials((materials ?? []).filter((m) => matchesMaterial(m, query, supName.get(m.supplierId ?? '') ?? ''))), [materials, query, supName]);
  const supList = useMemo(() => {
    const k = normKey(query);
    return sortSuppliers(suppliers.filter((s) => !k || [s.name, s.contact, s.address].some((v) => normKey(v).includes(k))));
  }, [suppliers, query]);
  const countBySupplier = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of materials ?? []) if (m.supplierId) c.set(m.supplierId, (c.get(m.supplierId) ?? 0) + 1);
    return c;
  }, [materials]);

  const switchTab = (t: Tab) => {
    setQuery('');
    navigate(paths.materials(t === 'suppliers' ? 'lieferanten' : t === 'materials' ? 'material' : undefined));
  };
  /** Baustellen (Projekte aus dem Register, nur freigegebene): mit Materialliste zuerst, dann A–Z */
  const siteList = useMemo(() => {
    const k = normKey(query);
    return projects
      .filter((p) => canSite(session, `p:${p.id}`, 'materials') && (!k || [p.name, p.site, p.number, p.address].some((v) => normKey(v).includes(k))))
      .map((p) => ({ p, sum: listSummary(items.filter((x) => x.projectId === p.id)) }))
      .sort((a, b) => Number(b.sum.total > 0) - Number(a.sum.total > 0) || (a.p.site || a.p.name).localeCompare(b.p.site || b.p.name, 'de'));
  }, [projects, items, query, session]);

  return (
    <>
      <SiteNav />
      <div className="page staff-page materials-page" data-testid="materials-page">
        <header className="page-head page-head-row">
          <div className="page-head-title">
            <a href={paths.tools()} className="icon-link" aria-label="Zurück zu den Tools" title="Zurück zu den Tools" data-testid="materials-back">
              <Icon name="back" />
            </a>
            <div>
              <h1 data-testid="materials-title">Materialverwaltung</h1>
              <span className="muted small">
                {materials?.length ?? 0} Materialien · {suppliers.length} Lieferanten
              </span>
            </div>
          </div>
        </header>

        <div className="segmented materials-tabs" role="tablist" aria-label="Bereich">
          <button type="button" role="tab" aria-selected={tab === 'sites'} aria-checked={tab === 'sites'} onClick={() => switchTab('sites')} data-testid="mat-tab-sites">
            Baustellen
          </button>
          <button type="button" role="tab" aria-selected={tab === 'materials'} aria-checked={tab === 'materials'} onClick={() => switchTab('materials')} data-testid="mat-tab-materials">
            Materialien
          </button>
          <button type="button" role="tab" aria-selected={tab === 'suppliers'} aria-checked={tab === 'suppliers'} onClick={() => switchTab('suppliers')} data-testid="mat-tab-suppliers">
            Lieferanten
          </button>
        </div>

        {tab !== 'sites' && (
        <button type="button" className="account-tile staff-new" onClick={() => (tab === 'materials' ? setEditMat('new') : setEditSup('new'))} data-testid={tab === 'materials' ? 'material-new' : 'supplier-new'}>
          <div>
            <strong>{tab === 'materials' ? '+ Neues Material' : '+ Neuer Lieferant'}</strong>
            <span className="muted">{tab === 'materials' ? 'Name, Artikelnummer, Einheit, Preis, Lieferant' : 'Name, Ansprechpartner, Telefon, E-Mail, Adresse'}</span>
          </div>
          <Icon name="next" size={18} />
        </button>
        )}

        <div className="staff-tools">
          <label className="crew-search">
            <Icon name="select" size={18} />
            <span className="sr-only">Suchen</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'sites' ? 'Baustelle suchen' : tab === 'materials' ? 'Material, Artikelnummer oder Lieferant suchen' : 'Lieferant suchen'}
              data-testid="materials-search"
            />
          </label>
        </div>

        {tab === 'sites' ? (
          !siteList.length ? (
            <p className="muted" data-testid="material-sites-empty">
              Noch keine Baustellen. Projekte kommen aus dem Projektregister – sie stehen in allen Tools gleich zur Verfügung.
            </p>
          ) : (
            <ul className="crew-worker-list staff-list" data-testid="material-site-list">
              {siteList.map(({ p, sum }) => (
                <li key={p.id} data-testid="material-site" data-name={p.site || p.name}>
                  <div className="staff-row">
                    <a href={paths.materialSite(p.id)} className="crew-worker-main" data-testid="material-site-open">
                      <strong>
                        <span className="pc-dot" style={pcStyle(colorOf(p.id))} aria-hidden="true" />
                        {[p.number, p.site || p.name].filter(Boolean).join(' · ')}
                      </strong>
                      <span className="muted small">
                        {sum.total ? [sum.count.offen && `${sum.count.offen} offen`, sum.count.bestellt && `${sum.count.bestellt} bestellt`, sum.count.geliefert && `${sum.count.geliefert} geliefert`].filter(Boolean).join(' · ') : 'Noch keine Materialliste'}
                      </span>
                    </a>
                    <Icon name="next" size={18} className="staff-chevron" />
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'materials' ? (
          materials && !materials.length ? (
            <p className="muted" data-testid="materials-empty">
              Noch keine Materialien. Lege oben das erste Material an – es steht danach auf allen Geräten der Firma zur Verfügung.
            </p>
          ) : (
            <ul className="crew-worker-list staff-list" data-testid="material-list">
              {matList.map((m) => (
                <li key={m.id} data-testid="material-row" data-name={m.name}>
                  <div className="staff-row">
                    <button type="button" className="crew-worker-main" onClick={() => setEditMat(m)} data-testid="material-open">
                      <strong>{m.name}</strong>
                      <span className="muted small">
                        {[m.articleNo && `Art.-Nr. ${m.articleNo}`, m.unit, m.price !== null && m.price !== undefined ? `${fmtPrice(m.price)} / ${m.unit}` : '', supName.get(m.supplierId ?? ''), m.category].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                    <Icon name="next" size={18} className="staff-chevron" />
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : !suppliers.length ? (
          <p className="muted" data-testid="suppliers-empty">
            Noch keine Lieferanten. Lege oben den ersten Lieferanten an – danach kannst du ihn bei jedem Material auswählen.
          </p>
        ) : (
          <ul className="crew-worker-list staff-list" data-testid="supplier-list">
            {supList.map((s) => (
              <li key={s.id} data-testid="supplier-row" data-name={s.name}>
                <div className="staff-row">
                  <button type="button" className="crew-worker-main" onClick={() => setEditSup(s)} data-testid="supplier-open">
                    <strong>{s.name}</strong>
                    <span className="muted small">{[s.contact, s.phone, s.email, `${countBySupplier.get(s.id) ?? 0} Materialien`].filter(Boolean).join(' · ')}</span>
                  </button>
                  <Icon name="next" size={18} className="staff-chevron" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editMat && (
        <MaterialDialog
          material={editMat === 'new' ? null : editMat}
          all={materials ?? []}
          suppliers={sortSuppliers(suppliers)}
          onClose={() => setEditMat(null)}
          onSaved={() => {
            setEditMat(null);
            void reload();
          }}
        />
      )}
      {editSup && (
        <SupplierDialog
          supplier={editSup === 'new' ? null : editSup}
          all={suppliers}
          materialCount={editSup === 'new' ? 0 : (countBySupplier.get(editSup.id) ?? 0)}
          onClose={() => setEditSup(null)}
          onSaved={() => {
            setEditSup(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

const dupText = (d: MaterialDuplicate) =>
  d.reason === 'articleNo' ? `Artikelnummer ${d.material.articleNo} ist schon hinterlegt: ${d.material.name}` : `„${d.material.name}“ (${d.material.unit}) ist schon hinterlegt`;

function MaterialDialog({ material, all, suppliers, onClose, onSaved }: { material: Material | null; all: Material[]; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    name: material?.name ?? '',
    articleNo: material?.articleNo ?? '',
    unit: material?.unit ?? 'Stk',
    price: material?.price !== null && material?.price !== undefined ? String(material.price).replace('.', ',') : '',
    supplierId: material?.supplierId ?? '',
    category: material?.category ?? '',
    note: material?.note ?? '',
  });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const price = parsePrice(v.price);
  const dups = v.name.trim() || v.articleNo.trim() ? materialDuplicates({ id: material?.id, name: v.name, articleNo: v.articleNo, unit: v.unit, supplierId: v.supplierId || null }, all) : [];
  const units = UNITS.includes(v.unit) || !v.unit ? UNITS : [v.unit, ...UNITS];

  const submit = async () => {
    setShow(true);
    if (!v.name.trim() || !v.unit.trim() || price === undefined) return;
    if (dups.length) {
      const ok = await confirmDialog({
        title: 'Material schon hinterlegt',
        message: (
          <>
            {dups.map((d) => (
              <p key={d.material.id}>{dupText(d)}.</p>
            ))}
            <p>Trotzdem {material ? 'speichern' : 'als weiteres Material anlegen'}?</p>
          </>
        ),
        confirmLabel: material ? 'Trotzdem speichern' : 'Trotzdem anlegen',
      });
      if (!ok) return;
    }
    const now = Date.now();
    const m: Material = {
      ...(material ?? { id: uuid(), createdAt: now }),
      name: v.name.trim(),
      articleNo: v.articleNo.trim(),
      unit: v.unit.trim(),
      price,
      supplierId: v.supplierId || null,
      category: v.category.trim(),
      note: v.note.trim(),
      updatedAt: now,
    } as Material;
    setBusy(true);
    try {
      await saveMaterial(m);
      toast(material ? 'Material gespeichert.' : `${m.name} angelegt.`, 'success', 2000);
      onSaved();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!material) return;
    const ok = await confirmDialog({ title: 'Material löschen?', message: <p>{material.name} wird auf allen Geräten aus dem Materialstamm gelöscht.</p>, confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    await deleteMaterial(material.id);
    toast('Material gelöscht.', 'success', 2000);
    onSaved();
  };
  const field = (k: 'name' | 'articleNo' | 'price' | 'category' | 'note', label: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} autoComplete="off" data-testid={`material-${k}`} {...extra} />
    </label>
  );
  return (
    <Modal
      title={material ? `${material.name} bearbeiten` : 'Neues Material'}
      onClose={onClose}
      testId="material-dialog"
      footer={
        <>
          {material && (
            <button type="button" className="btn btn-danger-text" onClick={() => void remove()} disabled={busy} data-testid="material-delete">
              <Icon name="trash" size={18} /> Löschen
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} data-testid="material-save">
            <Icon name={material ? 'check' : 'plus'} size={18} /> {material ? 'Speichern' : 'Anlegen'}
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
        {field('name', 'Bezeichnung *', { 'aria-invalid': show && !v.name.trim() ? true : undefined, 'data-autofocus': '', placeholder: 'z. B. Zementestrich CT-C25-F4' } as Partial<InputHTMLAttributes<HTMLInputElement>>)}
        {dups.length > 0 && (
          <div className="worker-dup" role="status" data-testid="material-duplicate">
            <Icon name="info" size={18} />
            <span>
              {dups.map((d) => (
                <span key={d.material.id} className="worker-dup-line">
                  {dupText(d)}.
                </span>
              ))}
            </span>
          </div>
        )}
        {field('articleNo', 'Artikelnummer')}
        <div className="form-grid">
          <label className="field">
            <span>Einheit *</span>
            <select value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} data-testid="material-unit">
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          {field('price', 'Preis je Einheit (€, netto)', { inputMode: 'decimal', placeholder: 'z. B. 12,50', 'aria-invalid': show && price === undefined ? true : undefined } as Partial<InputHTMLAttributes<HTMLInputElement>>)}
        </div>
        <label className="field">
          <span>Lieferant</span>
          <select value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })} data-testid="material-supplier">
            <option value="">– keiner –</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {field('category', 'Kategorie', { placeholder: 'z. B. Beton, Dämmung, Kleinmaterial' })}
        {field('note', 'Notiz')}
        {show && !v.name.trim() && <p className="error small">Bitte eine Bezeichnung eingeben.</p>}
        {show && price === undefined && <p className="error small">Preis bitte als Zahl, z. B. 12,50.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function SupplierDialog({ supplier, all, materialCount, onClose, onSaved }: { supplier: Supplier | null; all: Supplier[]; materialCount: number; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    name: supplier?.name ?? '',
    contact: supplier?.contact ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    note: supplier?.note ?? '',
  });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const dups = supplierDuplicates({ id: supplier?.id, name: v.name }, all);

  const submit = async () => {
    setShow(true);
    if (!v.name.trim()) return;
    if (dups.length) {
      const ok = await confirmDialog({
        title: 'Lieferant schon hinterlegt',
        message: (
          <>
            <p>{dups.map((d) => d.name).join(', ')} ist schon hinterlegt.</p>
            <p>Trotzdem {supplier ? 'speichern' : 'als weiteren Lieferanten anlegen'}?</p>
          </>
        ),
        confirmLabel: supplier ? 'Trotzdem speichern' : 'Trotzdem anlegen',
      });
      if (!ok) return;
    }
    const now = Date.now();
    const s: Supplier = {
      ...(supplier ?? { id: uuid(), createdAt: now }),
      name: v.name.trim(),
      contact: v.contact.trim(),
      phone: v.phone.trim(),
      email: v.email.trim(),
      address: v.address.trim(),
      note: v.note.trim(),
      updatedAt: now,
    } as Supplier;
    setBusy(true);
    try {
      await saveSupplier(s);
      toast(supplier ? 'Lieferant gespeichert.' : `${s.name} angelegt.`, 'success', 2000);
      onSaved();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!supplier) return;
    const ok = await confirmDialog({
      title: 'Lieferant löschen?',
      message: <p>{supplier.name} wird auf allen Geräten gelöscht.{materialCount ? ` ${materialCount} Material(ien) bleiben erhalten, nur ohne Lieferant.` : ''}</p>,
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    await deleteSupplier(supplier.id);
    toast('Lieferant gelöscht.', 'success', 2000);
    onSaved();
  };
  const field = (k: keyof typeof v, label: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} autoComplete="off" data-testid={`supplier-${k}`} {...extra} />
    </label>
  );
  return (
    <Modal
      title={supplier ? `${supplier.name} bearbeiten` : 'Neuer Lieferant'}
      onClose={onClose}
      testId="supplier-dialog"
      footer={
        <>
          {supplier && (
            <button type="button" className="btn btn-danger-text" onClick={() => void remove()} disabled={busy} data-testid="supplier-delete">
              <Icon name="trash" size={18} /> Löschen
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} data-testid="supplier-save">
            <Icon name={supplier ? 'check' : 'plus'} size={18} /> {supplier ? 'Speichern' : 'Anlegen'}
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
        {field('name', 'Firmenname *', { 'aria-invalid': show && !v.name.trim() ? true : undefined, 'data-autofocus': '' } as Partial<InputHTMLAttributes<HTMLInputElement>>)}
        {dups.length > 0 && (
          <div className="worker-dup" role="status" data-testid="supplier-duplicate">
            <Icon name="info" size={18} />
            <span>{dups.map((d) => d.name).join(', ')} ist schon hinterlegt.</span>
          </div>
        )}
        {field('contact', 'Ansprechpartner')}
        <div className="form-grid">
          {field('phone', 'Telefon', { type: 'tel', inputMode: 'tel' })}
          {field('email', 'E-Mail', { type: 'email', inputMode: 'email' })}
        </div>
        {field('address', 'Adresse')}
        {field('note', 'Notiz', { placeholder: 'z. B. Kundennummer, Lieferzeiten' })}
        {show && !v.name.trim() && <p className="error small">Bitte einen Firmennamen eingeben.</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
