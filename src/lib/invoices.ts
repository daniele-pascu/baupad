import { uuid } from './ids';
import type { Invoice, InvoiceKind, Plan, Project } from './types';

/** Rechnungen: Pläne und Aufmaß je Teilrechnung getrennt (Option „Nach Rechnungen aufteilen“). */

export const INVOICE_KINDS: { id: InvoiceKind; label: string; short: string }[] = [
  { id: 'r', label: 'Rechnung', short: 'R' },
  { id: 'tr', label: 'Teilrechnung', short: 'TR' },
  { id: 'str', label: 'Schlussteilrechnung', short: 'STR' },
  { id: 'sr', label: 'Schlussrechnung', short: 'SR' },
];

const kindOf = (k: InvoiceKind) => INVOICE_KINDS.find((x) => x.id === k)!;

type Named = Pick<Invoice, 'kind' | 'no'> & Partial<Pick<Invoice, 'name' | 'number'>>;
const nameOf = (i: Named) => i.name?.trim() || kindOf(i.kind).label;

/** z. B. „2. Teilrechnung“, „4. Schlussrechnung“; mit eigener Bezeichnung/Nummer „Abschnitt Nord 2026-014“ */
export const invoiceLabel = (i: Named) => (i.number?.trim() ? `${nameOf(i)} ${i.number.trim()}` : `${i.no}. ${nameOf(i)}`);

/** kurz, z. B. „TR 2“, „SR 4“ (bzw. mit eigener Nummer „TR 2026-014“) */
export const invoiceShort = (i: Named) => `${kindOf(i.kind).short} ${i.number?.trim() || i.no}`;

/** Rechnungen in Reihenfolge */
export const invoicesOf = (p: Pick<Project, 'invoices'>): Invoice[] => [...(p.invoices ?? [])].sort((a, b) => a.no - b.no);

/** Neue Rechnung mit der nächsten Nummer */
export function newInvoice(p: Pick<Project, 'invoices'>, kind: InvoiceKind, period = ''): Invoice {
  const no = Math.max(0, ...(p.invoices ?? []).map((i) => i.no)) + 1;
  return { id: uuid(), kind, no, period: period.trim(), createdAt: Date.now() };
}

/** Rechnung eines Plans (null: Projekt nicht aufgeteilt bzw. Plan ohne Rechnung) */
export function invoiceOfPlan(p: Pick<Project, 'splitByInvoice' | 'invoices'>, plan: Pick<Plan, 'invoiceId'>): Invoice | null {
  if (!p.splitByInvoice || !plan.invoiceId) return null;
  return p.invoices?.find((i) => i.id === plan.invoiceId) ?? null;
}

/**
 * Pläne, in denen eine Plannummer eindeutig sein muss: im ganzen Projekt bzw. – aufgeteilt – nur
 * innerhalb derselben Rechnung (derselbe Plan darf in jeder Teilrechnung wieder vorkommen).
 */
export function sameNumberScope(p: Pick<Project, 'splitByInvoice'>, invoiceId: string | null | undefined) {
  return (plan: Pick<Plan, 'invoiceId'>) => !p.splitByInvoice || (plan.invoiceId ?? null) === (invoiceId ?? null);
}
