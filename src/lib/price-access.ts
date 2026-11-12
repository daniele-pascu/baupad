import type { Session } from './auth';
import { useSession } from './use-session';

/** Freigabe „Preise und Summen“ (bei den Freigaben des Benutzers gespeichert) */
export const PRICES_PERM = 'perm:prices' as const;

/**
 * Darf die Person Einheits-/Positionspreise und Summen der LV bzw. MFK sehen?
 * Admin und Büro immer (ebenso Betreiber und ohne Firma bzw. ohne Anmeldung); Polier und Arbeiter nur mit der
 * Freigabe „Preise und Summen“ unter Benutzer und Rollen. Gilt für die Anzeige und die Excel-Ausgabe.
 */
export function canSeePrices(s: Session | null | undefined): boolean {
  if (!s || !s.companyId || s.operator || s.role === 'admin' || s.role === 'buero') return true;
  return (s.toolSites?.[PRICES_PERM]?.length ?? 0) > 0;
}

/** Hook: Preise sichtbar? (während die Anmeldung lädt: nein – nichts kurz aufblitzen lassen) */
export function usePricesVisible(): boolean {
  const s = useSession();
  return s === undefined ? false : canSeePrices(s);
}
