import type { ToolIconName } from '../components/ToolIcon';
import type { Lang } from '../lib/router';
import { paths, PRODUCT_SLUG_OF, type ProductId } from '../lib/router';
import type { Dict } from './i18n/de';

/**
 * Zentrales Produktregister von PAD Software.
 * Ein verfügbares Produkt hat eine eigene Seite und Werkzeuge; geplante Produkte haben weder Namen noch Termin
 * (sie erscheinen nur als gekennzeichnete Vorschau). Neue Produkte werden hier ergänzt – Übersicht,
 * Startseite, Fußzeile und Sitemap lesen alle aus dieser Liste.
 */
export interface ProductEntry {
  id: 'baupad';
  status: 'available';
  /** Adresse der Produktseite je Sprache */
  path: (lang: Lang) => string;
  /** Farbe des Produkts (nur Akzent, nie für das Logo) */
  color: string;
  /** Werkzeuge des Produkts in Anzeigereihenfolge */
  tools: ToolEntry[];
}

export interface ToolEntry {
  id: ProductId;
  icon: ToolIconName;
  color: string;
  slug: string;
}

export const TOOL_ENTRIES: ToolEntry[] = [
  { id: 'projects', icon: 'projects', color: '#ff6a13', slug: PRODUCT_SLUG_OF.projects },
  { id: 'workers', icon: 'workers', color: '#2f80ed', slug: PRODUCT_SLUG_OF.workers },
  { id: 'reports', icon: 'reports', color: '#a259ff', slug: PRODUCT_SLUG_OF.reports },
  { id: 'photos', icon: 'photos', color: '#193B63', slug: PRODUCT_SLUG_OF.photos },
  { id: 'defects', icon: 'defects', color: '#d6242b', slug: PRODUCT_SLUG_OF.defects },
];

export const PRODUCTS: ProductEntry[] = [{ id: 'baupad', status: 'available', path: (lang) => paths.baupad(lang), color: '#193B63', tools: TOOL_ENTRIES }];

/** Anzahl geplanter Produkte als Vorschau (ohne Namen – siehe futurePage.items in den Texten) */
export const PLANNED_COUNT = 3;

/** Texte eines Werkzeugs in der gewünschten Sprache */
export function toolText(t: Dict, id: ProductId) {
  return t.tools[id];
}

/** Adresse der Werkzeug-Seite */
export function toolPath(id: ProductId, lang: Lang): string {
  return paths.product(PRODUCT_SLUG_OF[id], lang);
}
