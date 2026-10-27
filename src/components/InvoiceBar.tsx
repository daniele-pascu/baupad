import { useState } from 'react';
import { INVOICE_KINDS, invoiceLabel, invoiceShort, newInvoice } from '../lib/invoices';
import type { Invoice, InvoiceKind, Project } from '../lib/types';
import { ActionMenu } from './ActionMenu';
import { Icon } from './Icon';
import { Modal } from './Modal';

/**
 * Option „Nach Rechnungen aufteilen“ (vor den Plänen) bzw. – wenn aufgeteilt – die Rechnungen des
 * Projekts zum Auswählen, „+ Rechnung“ und je Rechnung ein Menü.
 */
export function InvoiceBar({
  project,
  invoices,
  selected,
  planCount,
  canSplit,
  onSelect,
  onSave,
  onToggleSettled,
  onDelete,
}: {
  project: Project;
  invoices: Invoice[];
  selected: Invoice | null;
  /** Pläne je Rechnung (zum Löschen nur leerer Rechnungen) */
  planCount(id: string): number;
  /** Aufteilen nur bei Projekten ohne Pläne */
  canSplit: boolean;
  onSelect(id: string): void;
  /** neue bzw. geänderte Rechnung; `split` = Projekt dabei auf „aufgeteilt“ umstellen */
  onSave(inv: Invoice, split: boolean): void;
  onToggleSettled(inv: Invoice): void;
  onDelete(inv: Invoice): void;
}) {
  const [dialog, setDialog] = useState<{ inv: Invoice | null; split: boolean } | null>(null);
  const split = !!project.splitByInvoice;
  if (!split && !canSplit) return null;
  return (
    <section className="invoice-bar" data-testid="invoice-bar">
      {!split ? (
        <div className="invoice-split">
          <button type="button" className="btn" onClick={() => setDialog({ inv: null, split: true })} data-testid="split-invoices">
            <Icon name="layers" size={18} /> Nach Rechnungen aufteilen
          </button>
          <span className="muted small">Jede Teilrechnung bekommt eigene Pläne und ein gemeinsames Aufmaß mit allen Positionen.</span>
        </div>
      ) : (
        <>
          <h2 className="section-title">Rechnungen</h2>
          <div className="invoice-tabs" role="tablist" aria-label="Rechnungen">
            {invoices.map((inv) => (
              <div key={inv.id} className={`invoice-tab${selected?.id === inv.id ? ' active' : ''}${inv.settled ? ' settled' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected?.id === inv.id}
                  onClick={() => onSelect(inv.id)}
                  title={`${invoiceLabel(inv)}${inv.period ? ` · ${inv.period}` : ''}${inv.settled ? ' · abgerechnet' : ''}`}
                  data-testid="invoice-tab"
                >
                  <strong>{invoiceShort(inv)}</strong>
                  <span className="small">{invoiceLabel(inv).replace(/^\d+\.\s*/, '')}</span>
                  {inv.settled && <Icon name="check" size={14} />}
                </button>
                {selected?.id === inv.id && (
                  <ActionMenu
                    label={`Aktionen für ${invoiceLabel(inv)}`}
                    testId="invoice-actions"
                    actions={[
                      { label: 'Bearbeiten', icon: 'edit', onSelect: () => setDialog({ inv, split: false }), testId: 'invoice-edit' },
                      {
                        label: inv.settled ? 'Wieder als offen markieren' : 'Als abgerechnet markieren',
                        icon: 'check',
                        onSelect: () => onToggleSettled(inv),
                        testId: 'invoice-settle',
                      },
                      ...(planCount(inv.id) === 0 ? [{ label: 'Rechnung löschen', icon: 'trash', danger: true, onSelect: () => onDelete(inv), testId: 'invoice-delete' }] : []),
                    ]}
                  />
                )}
              </div>
            ))}
            <button type="button" className="btn btn-sm invoice-add" onClick={() => setDialog({ inv: null, split: false })} data-testid="invoice-add">
              <Icon name="plus" size={18} /> Rechnung
            </button>
          </div>
        </>
      )}
      {dialog && (
        <InvoiceDialog
          project={project}
          invoice={dialog.inv}
          onClose={() => setDialog(null)}
          onSave={(inv) => {
            onSave(inv, dialog.split);
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

/** Rechnung anlegen bzw. bearbeiten: Art (Teilrechnung, Schlussteilrechnung, Schlussrechnung) und Leistungszeitraum */
function InvoiceDialog({ project, invoice, onClose, onSave }: { project: Project; invoice: Invoice | null; onClose(): void; onSave(inv: Invoice): void }) {
  const [kind, setKind] = useState<InvoiceKind>(invoice?.kind ?? 'tr');
  const [period, setPeriod] = useState(invoice?.period ?? '');
  const preview = invoice ? { ...invoice, kind } : { ...newInvoice(project, kind), kind };
  const save = () => onSave(invoice ? { ...invoice, kind, period: period.trim() } : newInvoice(project, kind, period));
  return (
    <Modal
      title={invoice ? `${invoiceLabel(invoice)} bearbeiten` : 'Rechnung anlegen'}
      onClose={onClose}
      testId="invoice-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-primary" onClick={save} data-testid="invoice-save">
            {invoice ? 'Speichern' : `${invoiceLabel(preview)} anlegen`}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="segmented invoice-kinds" role="radiogroup" aria-label="Art der Rechnung">
          {INVOICE_KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} aria-selected={kind === k.id} onClick={() => setKind(k.id)} data-testid={`invoice-kind-${k.id}`}>
              {k.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          {kind === 'sr' ? 'Die Schlussrechnung ist die letzte Teilrechnung – sie wird nur als solche gekennzeichnet.' : kind === 'str' ? 'Schlussteilrechnung: letzte Teilrechnung eines Abschnitts.' : 'Teilrechnung mit eigenen Plänen und eigenem Aufmaß.'}
        </p>
        <label className="field">
          <span>Leistungszeitraum (optional)</span>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="z. B. 01.10.2026 – 31.10.2026" autoComplete="off" data-testid="invoice-period" />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
