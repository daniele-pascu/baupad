import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { confirmDialog, showError, toast } from './ui';
import { deleteMaterial, saveMaterial, saveMaterialItem } from '../lib/db';
import { uuid } from '../lib/ids';
import { canOrder, equipmentInStock, equipmentOut, fmtQty, markOrdered, matchesMaterial, nextOrderNo, openBySupplier, orderText, ordersInTransit, overdue, overviewCounts, placeEquipment, setStatus } from '../lib/materials';
import { navigate, paths } from '../lib/router';
import type { Session } from '../lib/auth';
import type { Material, MaterialItem, Project, Supplier } from '../lib/types';

/**
 * Materialverwaltung – Übersicht, Bestellungen und Geräte.
 *  Übersicht:    was ist zu tun (offener Bedarf, unterwegs, überfällig, Geräte auf Baustellen) und die häufigsten Handgriffe als Tasten
 *  Bestellungen: offener Bedarf aller Baustellen je Lieferant → eine Bestellung mit Nummer (Text für E-Mail), danach Wareneingang
 *  Geräte:       je Gerät die Stückzahl und wo die Stücke sind (Lager oder Baustelle) – ohne Einzelnummern
 * Bestellen dürfen Admin, Büro und Polier; Bedarf melden kann jeder mit Zugriff auf die Baustelle.
 */

const fmtDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const fmtAt = (ms: number) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
export const LAGER = 'Lager';

export interface HubData {
  /** Positionen aller freigegebenen Baustellen */
  items: MaterialItem[];
  equipment: Material[];
  /** Materialstamm (ohne Geräte) – für Artikelnummern im Bestelltext */
  materials: Material[];
  suppliers: Supplier[];
  /** freigegebene Baustellen */
  projects: Project[];
  session: Session | null | undefined;
  today: string;
  reload(): void;
}

const siteLabel = (p: Project | undefined) => (p ? p.site || p.name : '');
const useLookups = (d: HubData) =>
  useMemo(() => {
    const proj = new Map(d.projects.map((p) => [p.id, p]));
    const sup = new Map(d.suppliers.map((s) => [s.id, s]));
    return { proj, sup, site: (id: string | null | undefined) => (id ? siteLabel(proj.get(id)) || 'Baustelle' : LAGER) };
  }, [d.projects, d.suppliers]);

/** Baustelle wählen und dort gleich „Material hinzufügen“ öffnen */
function SitePicker({ projects, onClose }: { projects: Project[]; onClose(): void }) {
  const [q, setQ] = useState('');
  const k = q.trim().toLowerCase();
  const list = projects.filter((p) => !k || [p.name, p.site, p.number, p.address].some((v) => (v ?? '').toLowerCase().includes(k))).sort((a, b) => siteLabel(a).localeCompare(siteLabel(b), 'de'));
  const go = (id: string) => {
    try {
      sessionStorage.setItem('mat-new', '1');
    } catch {
      /* ohne sessionStorage öffnet nur die Baustelle */
    }
    navigate(paths.materialSite(id));
  };
  return (
    <Modal title="Bedarf melden – welche Baustelle?" onClose={onClose} testId="need-dialog">
      {projects.length > 6 && (
        <label className="field">
          <span className="sr-only">Baustelle suchen</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Baustelle suchen" data-testid="need-search" />
        </label>
      )}
      {!list.length ? (
        <p className="muted">Keine Baustelle gefunden. Projekte kommen aus dem Projektregister.</p>
      ) : (
        <ul className="hub-pick" data-testid="need-sites">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => go(p.id)} data-testid="need-site">
                <strong>{siteLabel(p)}</strong>
                <span className="muted small">{[p.number, p.address].filter(Boolean).join(' · ')}</span>
                <Icon name="next" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ───────────────────────────── Übersicht ─────────────────────────────

export function HubOverview({ d, onTab, onNewDevice }: { d: HubData; onTab(t: 'orders' | 'equipment' | 'sites'): void; onNewDevice(): void }) {
  const { site } = useLookups(d);
  const [picking, setPicking] = useState(false);
  const c = overviewCounts(d.items, d.equipment, d.today);
  // Als Nächstes: überfällige Lieferungen, dann Lieferungen der nächsten 3 Tage
  const soon = useMemo(() => {
    const t = new Date(`${d.today}T00:00:00`);
    t.setDate(t.getDate() + 3);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }, [d.today]);
  const next = [
    ...d.items
      .filter((x) => x.status !== 'geliefert' && x.deliveryDate && x.deliveryDate <= soon)
      .sort((a, b) => a.deliveryDate!.localeCompare(b.deliveryDate!))
      .map((x) => ({
        key: x.id,
        href: paths.materialSite(x.projectId),
        title: `${fmtQty(x.qty)} ${x.unit} ${x.name}`,
        sub: `${site(x.projectId)} · ${x.status === 'offen' ? 'noch nicht bestellt' : 'bestellt'}`,
        tag: overdue(x, d.today) ? `überfällig seit ${fmtDay(x.deliveryDate!)}` : x.deliveryDate === d.today ? 'heute' : fmtDay(x.deliveryDate!),
        kind: overdue(x, d.today) ? 'late' : 'due',
      })),
  ];
  const tiles: { n: number; label: string; tone: string; tab: 'orders' | 'equipment'; id: string }[] = [
    { n: c.open, label: 'Bedarf offen', tone: 'b', tab: 'orders', id: 'open' },
    { n: c.ordered, label: 'bestellt, unterwegs', tone: 'o', tab: 'orders', id: 'ordered' },
    { n: c.late, label: 'überfällig', tone: 'r', tab: 'orders', id: 'late' },
    { n: c.out, label: 'Geräte auf Baustellen', tone: 'g', tab: 'equipment', id: 'out' },
  ];
  return (
    <div className="hub" data-testid="hub-overview">
      <div className="hub-kpis">
        {tiles.map((t) => (
          <button key={t.id} type="button" className={`hub-kpi tone-${t.tone}${t.n ? ' has' : ''}`} onClick={() => onTab(t.tab)} data-testid={`hub-kpi-${t.id}`}>
            <i aria-hidden="true" />
            <strong>{t.n}</strong>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="hub-quick">
        <button type="button" className="btn btn-primary" onClick={() => setPicking(true)} data-testid="hub-need">
          <Icon name="plus" size={16} /> Bedarf melden
        </button>
        {canOrder(d.session) && (
          <button type="button" className="btn" onClick={() => onTab('orders')} data-testid="hub-order">
            <Icon name="check" size={16} /> Bestellen{c.open ? ` (${c.open})` : ''}
          </button>
        )}
        <button type="button" className="btn" onClick={onNewDevice} data-testid="hub-device">
          <Icon name="plus" size={16} /> Gerät
        </button>
        <button type="button" className="btn" onClick={() => onTab('sites')} data-testid="hub-sites">
          <Icon name="folder" size={16} /> Baustellen
        </button>
      </div>
      <section className="card hub-card">
        <h2>Als Nächstes</h2>
        {!next.length ? (
          <p className="muted" data-testid="hub-next-empty">
            Nichts fällig. Lieferungen der nächsten drei Tage und überfällige Positionen erscheinen hier.
          </p>
        ) : (
          <ul className="hub-list" data-testid="hub-next">
            {next.map((n) => (
              <li key={n.key}>
                <a href={n.href} data-testid="hub-next-row">
                  <span>
                    <strong>{n.title}</strong>
                    <span className="muted small">{n.sub}</span>
                  </span>
                  <span className={`hub-tag ${n.kind}`}>{n.tag}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      {picking && <SitePicker projects={d.projects} onClose={() => setPicking(false)} />}
    </div>
  );
}

// ───────────────────────────── Bestellungen ─────────────────────────────

export function HubOrders({ d }: { d: HubData }) {
  const { site, sup, proj } = useLookups(d);
  const [ordering, setOrdering] = useState<{ supplierId: string; items: MaterialItem[] } | null>(null);
  const may = canOrder(d.session);
  const by = d.session?.name || 'Unbekannt';
  const open = useMemo(() => openBySupplier(d.items, (id) => sup.get(id)?.name ?? ''), [d.items, sup]);
  const transit = useMemo(() => ordersInTransit(d.items), [d.items]);

  const deliver = async (list: MaterialItem[]) => {
    try {
      for (const x of list) await saveMaterialItem(setStatus(x, 'geliefert', by));
      toast(list.length === 1 ? `${list[0].name}: geliefert.` : `${list.length} Positionen geliefert.`, 'success', 2000);
      d.reload();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
    }
  };

  const line = (x: MaterialItem) => (
    <li key={x.id} data-testid="order-line" data-name={x.name}>
      <a href={paths.materialSite(x.projectId)}>
        <strong>
          {fmtQty(x.qty)} {x.unit} {x.name}
        </strong>
        <span className={`small ${overdue(x, d.today) ? 'warn-text' : 'muted'}`}>{[site(x.projectId), x.deliveryDate && `${overdue(x, d.today) ? 'überfällig: ' : 'Liefertermin '}${fmtDay(x.deliveryDate)}`, x.note].filter(Boolean).join(' · ')}</span>
      </a>
    </li>
  );

  return (
    <div className="hub" data-testid="hub-orders">
      <section className="hub-section">
        <h2>
          Zu bestellen <span className="hub-count">{open.reduce((n, g) => n + g.items.length, 0)}</span>
        </h2>
        {!open.length ? (
          <p className="muted" data-testid="orders-open-empty">
            Kein offener Bedarf. Bedarf entsteht auf der Materialliste einer Baustelle („Material hinzufügen“).
          </p>
        ) : (
          open.map((g) => {
            const s = sup.get(g.supplierId);
            return (
              <article key={g.supplierId || 'ohne'} className="card hub-card" data-testid="order-open-group" data-supplier={s?.name ?? ''}>
                <header>
                  <div>
                    <strong>{s?.name ?? 'Ohne Lieferant'}</strong>
                    <span className="muted small">{s ? [s.contact, s.phone, s.email].filter(Boolean).join(' · ') : 'Lieferant auf der Materialliste der Baustelle eintragen'}</span>
                  </div>
                  {may && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setOrdering(g)} data-testid="order-create">
                      Bestellen ({g.items.length})
                    </button>
                  )}
                </header>
                <ul className="hub-list">{g.items.map(line)}</ul>
              </article>
            );
          })
        )}
        {!may && !!open.length && (
          <p className="muted small" data-testid="orders-no-right">
            Bestellen dürfen Admin, Büro und Polier.
          </p>
        )}
      </section>

      <section className="hub-section">
        <h2>
          Unterwegs <span className="hub-count">{transit.reduce((n, g) => n + g.items.length, 0)}</span>
        </h2>
        {!transit.length ? (
          <p className="muted" data-testid="orders-transit-empty">
            Keine Bestellung unterwegs.
          </p>
        ) : (
          transit.map((g) => (
            <article key={g.orderNo || `s:${g.supplierId}`} className="card hub-card" data-testid="order-transit-group" data-order={g.orderNo}>
              <header>
                <div>
                  <strong>{[g.orderNo, sup.get(g.supplierId)?.name ?? (g.orderNo ? '' : 'Ohne Lieferant')].filter(Boolean).join(' · ')}</strong>
                  <span className="muted small">
                    {g.items.length} {g.items.length === 1 ? 'Position' : 'Positionen'}
                    {g.items[0].orderedAt ? ` · bestellt ${fmtAt(g.items[0].orderedAt)}` : ''}
                  </span>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => void deliver(g.items)} data-testid="order-delivered-all">
                  <Icon name="check" size={16} /> Alles geliefert
                </button>
              </header>
              <ul className="hub-list">
                {g.items.map((x) => (
                  <li key={x.id} className="with-action" data-testid="order-line" data-name={x.name}>
                    <a href={paths.materialSite(x.projectId)}>
                      <strong>
                        {fmtQty(x.qty)} {x.unit} {x.name}
                      </strong>
                      <span className={`small ${overdue(x, d.today) ? 'warn-text' : 'muted'}`}>{[site(x.projectId), x.deliveryDate && `${overdue(x, d.today) ? 'überfällig: ' : 'Liefertermin '}${fmtDay(x.deliveryDate)}`].filter(Boolean).join(' · ')}</span>
                    </a>
                    {g.items.length > 1 && (
                      <button type="button" className="btn btn-sm" onClick={() => void deliver([x])} data-testid="order-delivered">
                        Geliefert
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </section>

      {ordering && (
        <OrderDialog
          group={ordering}
          supplier={sup.get(ordering.supplierId) ?? null}
          orderNo={nextOrderNo(d.items, Number(d.today.slice(0, 4)))}
          text={(no) =>
            orderText({
              orderNo: no,
              company: d.session?.companyName ?? '',
              by,
              items: ordering.items,
              articleNo: (id) => d.materials.find((m) => m.id === id)?.articleNo ?? '',
              site: (id) => ({ name: siteLabel(proj.get(id)) || 'Baustelle', address: proj.get(id)?.address ?? '' }),
            })
          }
          by={by}
          onClose={() => setOrdering(null)}
          onDone={() => {
            setOrdering(null);
            d.reload();
          }}
        />
      )}
    </div>
  );
}

function OrderDialog({ group, supplier, orderNo, text, by, onClose, onDone }: { group: { items: MaterialItem[] }; supplier: Supplier | null; orderNo: string; text(no: string): string; by: string; onClose(): void; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const body = text(orderNo);
  const mail = supplier?.email ? `mailto:${encodeURIComponent(supplier.email)}?subject=${encodeURIComponent(`Bestellung ${orderNo}`)}&body=${encodeURIComponent(body)}` : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast('Bestelltext kopiert.', 'success', 1800);
    } catch {
      toast('Kopieren nicht möglich – Text bitte markieren und kopieren.', 'error');
    }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      for (const x of markOrdered(group.items, orderNo, by)) await saveMaterialItem(x);
      toast(`Bestellung ${orderNo}: ${group.items.length} ${group.items.length === 1 ? 'Position' : 'Positionen'} bestellt.`, 'success');
      onDone();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Bestellung ${orderNo}${supplier ? ` – ${supplier.name}` : ''}`}
      onClose={onClose}
      wide
      testId="order-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy} data-testid="order-confirm">
            Als bestellt markieren
          </button>
        </>
      }
    >
      <p className="muted small">Text an den Lieferanten schicken (E-Mail oder kopieren), dann „Als bestellt markieren“. Die Positionen stehen danach unter „Unterwegs“.</p>
      <label className="field">
        <span>Bestelltext</span>
        <textarea readOnly rows={12} value={body} data-testid="order-text" />
      </label>
      <div className="hub-quick">
        {mail ? (
          <a className="btn" href={mail} data-testid="order-mail">
            <Icon name="file" size={16} /> E-Mail an {supplier!.email}
          </a>
        ) : (
          <span className="muted small">{supplier ? 'Beim Lieferanten ist keine E-Mail-Adresse hinterlegt.' : 'Ohne Lieferant – Text kopieren und selbst verschicken.'}</span>
        )}
        <button type="button" className="btn" onClick={() => void copy()} data-testid="order-copy">
          <Icon name="copy" size={16} /> Text kopieren
        </button>
      </div>
    </Modal>
  );
}

// ───────────────────────────── Geräte ─────────────────────────────

export function HubEquipment({ d, edit, setEdit }: { d: HubData; edit: Material | 'new' | null; setEdit(m: Material | 'new' | null): void }) {
  const { site } = useLookups(d);
  const [q, setQ] = useState('');
  const where = (m: Material) => [`${LAGER} ${equipmentInStock(m)}`, ...(m.places ?? []).filter((p) => p.qty > 0).map((p) => `${site(p.siteId)} ${p.qty}`)];
  const list = useMemo(
    () => d.equipment.filter((m) => matchesMaterial(m, q, (m.places ?? []).map((p) => site(p.siteId)).join(' '))).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [d.equipment, q, site],
  );
  const total = d.equipment.reduce((n, m) => n + (m.total ?? 0), 0);
  const out = d.equipment.reduce((n, m) => n + equipmentOut(m), 0);
  return (
    <div className="hub" data-testid="hub-equipment">
      <button type="button" className="account-tile staff-new" onClick={() => setEdit('new')} data-testid="device-new">
        <div>
          <strong>+ Neues Gerät</strong>
          <span className="muted">Name, Stückzahl und wo die Stücke sind</span>
        </div>
        <Icon name="next" size={18} />
      </button>
      <div className="staff-tools">
        <label className="crew-search">
          <Icon name="select" size={18} />
          <span className="sr-only">Gerät suchen</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gerät oder Baustelle suchen" data-testid="device-search" />
        </label>
      </div>
      {!d.equipment.length ? (
        <p className="muted" data-testid="devices-empty">
          Noch keine Geräte. Lege oben das erste Gerät an – danach siehst du jederzeit, wie viele Stück wo sind.
        </p>
      ) : (
        <>
          <p className="muted small" data-testid="devices-summary">
            {d.equipment.length} Geräte · {total} Stück · {out} auf Baustellen · {Math.max(0, total - out)} im Lager
          </p>
          <ul className="crew-worker-list staff-list" data-testid="device-list">
            {list.map((m) => (
              <li key={m.id} data-testid="device-row" data-name={m.name}>
                <div className="staff-row">
                  <button type="button" className="crew-worker-main" onClick={() => setEdit(m)} data-testid="device-open">
                    <strong>
                      {m.name} <span className="muted">· {m.total ?? 0} Stk</span>
                    </strong>
                    <span className="muted small" data-testid="device-where">
                      {where(m).join(' · ')}
                    </span>
                  </button>
                  <Icon name="next" size={18} className="staff-chevron" />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {edit && (
        <DeviceDialog
          device={edit === 'new' ? null : edit}
          d={d}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            d.reload();
          }}
        />
      )}
    </div>
  );
}

function DeviceDialog({ device, d, onClose, onSaved }: { device: Material | null; d: HubData; onClose(): void; onSaved(): void }) {
  const { site } = useLookups(d);
  const by = d.session?.name || 'Unbekannt';
  const [v, setV] = useState({ name: device?.name ?? '', total: device ? String(device.total ?? 0) : '1', category: device?.category ?? '', note: device?.note ?? '' });
  /** Stück je Baustelle (nur Baustellen mit Stück bzw. gerade hinzugefügte) */
  const [places, setPlaces] = useState<{ siteId: string; qty: number }[]>(() => (device?.places ?? []).filter((p) => p.qty > 0));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = /^\d{1,5}$/.test(v.total.trim()) ? Number(v.total.trim()) : NaN;
  const out = places.reduce((n, p) => n + p.qty, 0);
  const free = Number.isNaN(total) ? 0 : total - out;
  const others = [...d.projects].filter((p) => !places.some((x) => x.siteId === p.id)).sort((a, b) => siteLabel(a).localeCompare(siteLabel(b), 'de'));
  const dup = v.name.trim() ? d.equipment.find((m) => m.id !== device?.id && m.name.trim().toLowerCase() === v.name.trim().toLowerCase()) : undefined;
  const setQty = (siteId: string, qty: number) => setPlaces(places.map((p) => (p.siteId === siteId ? { ...p, qty: Math.max(0, qty) } : p)));

  const submit = async () => {
    setShow(true);
    if (!v.name.trim() || Number.isNaN(total) || free < 0 || dup) return;
    setBusy(true);
    try {
      const now = Date.now();
      let next: Material = {
        ...(device ?? { id: uuid(), createdAt: now }),
        name: v.name.trim(),
        unit: 'Stk',
        kind: 'geraet',
        total,
        category: v.category.trim() || undefined,
        note: v.note.trim() || undefined,
        places: device?.places ?? [],
        log: device?.log,
        updatedAt: now,
      };
      if (device && (device.total ?? 0) !== total) next = { ...next, log: [...(next.log ?? []), { at: now, by, text: `Stück gesamt: ${device.total ?? 0} → ${total}` }].slice(-40) };
      // Standorte: jede Baustelle mit geänderter Stückzahl (auch auf 0) bekommt einen Verlaufseintrag
      const ids = new Set([...(device?.places ?? []).map((p) => p.siteId), ...places.map((p) => p.siteId)]);
      for (const id of ids) next = placeEquipment(next, id, places.find((p) => p.siteId === id)?.qty ?? 0, site(id), by, now);
      await saveMaterial(next);
      toast(device ? 'Gerät gespeichert.' : 'Gerät angelegt.', 'success', 1800);
      onSaved();
    } catch (e) {
      showError(e, 'Speichern fehlgeschlagen');
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!device) return;
    if (!(await confirmDialog({ title: 'Gerät löschen', message: <p>{device.name} wirklich löschen? Der Verlauf geht verloren.</p>, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await deleteMaterial(device.id);
      toast('Gerät gelöscht.', 'success', 1800);
      onSaved();
    } catch (e) {
      showError(e, 'Löschen fehlgeschlagen');
    }
  };

  return (
    <Modal
      title={device ? 'Gerät' : 'Neues Gerät'}
      onClose={onClose}
      testId="device-dialog"
      footer={
        <>
          {device && (
            <button type="button" className="btn btn-danger-text" onClick={() => void remove()} data-testid="device-delete">
              Löschen
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} data-testid="device-save">
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>Bezeichnung *</span>
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="z. B. Betonfräse" autoFocus data-testid="device-name" />
        </label>
        <label className="field">
          <span>Stück gesamt *</span>
          <input value={v.total} onChange={(e) => setV({ ...v, total: e.target.value })} inputMode="numeric" data-testid="device-total" />
        </label>
      </div>
      {show && !v.name.trim() && <p className="error small">Bitte eine Bezeichnung eingeben.</p>}
      {dup && (
        <p className="error small" data-testid="device-duplicate">
          „{dup.name}“ gibt es schon – dort die Stückzahl erhöhen.
        </p>
      )}
      {show && Number.isNaN(total) && <p className="error small">Stückzahl bitte als ganze Zahl, z. B. 3.</p>}

      <h3 className="hub-sub">Wo sind sie?</h3>
      <ul className="hub-places" data-testid="device-places">
        <li>
          <span>{LAGER}</span>
          <strong className={free < 0 ? 'warn-text' : ''} data-testid="device-stock">
            {Number.isNaN(total) ? '–' : free} Stk
          </strong>
        </li>
        {places.map((p) => (
          <li key={p.siteId} data-testid="device-place" data-site={site(p.siteId)}>
            <span>{site(p.siteId)}</span>
            <span className="hub-stepper">
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setQty(p.siteId, p.qty - 1)} disabled={p.qty <= 0} aria-label={`Ein Stück weniger auf ${site(p.siteId)}`} data-testid="device-minus">
                <Icon name="minus" size={16} />
              </button>
              <strong data-testid="device-qty">{p.qty}</strong>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setQty(p.siteId, p.qty + 1)} disabled={free <= 0} aria-label={`Ein Stück mehr auf ${site(p.siteId)}`} data-testid="device-plus">
                <Icon name="plus" size={16} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {free < 0 && (
        <p className="error small" data-testid="device-over">
          Es sind mehr Stück verteilt als vorhanden ({out} von {total}).
        </p>
      )}
      {!!others.length && (
        <label className="field">
          <span>Auf weitere Baustelle geben</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setPlaces([...places, { siteId: e.target.value, qty: free > 0 ? 1 : 0 }]);
            }}
            data-testid="device-add-site"
          >
            <option value="">Baustelle wählen …</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {siteLabel(p)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Notiz</span>
        <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} data-testid="device-note" />
      </label>
      {!!device?.log?.length && (
        <details className="hub-log" data-testid="device-log">
          <summary>Verlauf ({device.log.length})</summary>
          <ul>
            {[...device.log].reverse().map((l, i) => (
              <li key={i}>
                <span className="muted small">
                  {fmtAt(l.at)} · {l.by}
                </span>
                {l.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Modal>
  );
}
