import type { Page } from '@playwright/test';

/**
 * Tasten-Prüfung (PC, Handy, Tablet): Auf der aktuellen Ansicht werden alle sichtbaren Bedienelemente
 * (Knöpfe, Links, Eingabefelder, Auswahlen) gesucht und geprüft:
 *  - überlappen sich zwei Tasten (z. B. zwei Knöpfe übereinander bzw. ineinander)?
 *  - ist eine Taste von etwas anderem verdeckt (Mitte nicht antippbar)?
 *  - ragt eine Taste über den Bildschirmrand hinaus (abgeschnitten, ohne dass man dorthin scrollen kann)?
 *  - ragt der Text aus einer Taste heraus (Taste zu schmal für ihre Beschriftung, ohne „…“)?
 * Ist ein Dialog offen, wird nur der Dialog geprüft. Liefert eine Liste lesbarer Befunde (leer = alles gut).
 */
export async function tastenBefunde(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const SEL = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"]';
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const name = (el: Element) => {
      const t = (el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const id = el.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${t ? ` „${t}“` : ''}`;
    };
    // offener Dialog: nur dessen Inhalt prüfen
    const modals = [...document.querySelectorAll('.modal, [role="dialog"]')].filter((m) => (m as HTMLElement).offsetParent !== null || getComputedStyle(m).position === 'fixed');
    const scope: ParentNode = modals.length ? modals[modals.length - 1] : document;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none') return false;
      if (el.closest('[aria-hidden="true"], [inert], .sr-only')) return false;
      // Eingabefelder, die bewusst unsichtbar über einem Knopf liegen (Datei-Auswahl, Checkbox im Schalter)
      if (el instanceof HTMLInputElement && ['file', 'checkbox', 'radio'].includes(el.type) && Number(cs.opacity) < 0.05) return false;
      return true;
    };
    // sichtbarer Teil (innerhalb aller scrollenden/abschneidenden Vorfahren und des Bildschirms)
    const visibleRect = (el: Element) => {
      const r = el.getBoundingClientRect();
      let l = r.left, t = r.top, rt = r.right, b = r.bottom;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) {
          const pr = p.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { l = Math.max(l, pr.left); rt = Math.min(rt, pr.right); }
          if (/(auto|scroll|hidden|clip)/.test(cs.overflowY)) { t = Math.max(t, pr.top); b = Math.min(b, pr.bottom); }
        }
      }
      return { l: Math.max(l, 0), t: Math.max(t, 0), r: Math.min(rt, vw), b: Math.min(b, vh) };
    };
    const hScroll = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    const all = [...scope.querySelectorAll(SEL)].filter(shown);
    // nur Tasten, die man auch sieht (sichtbarer Teil > 6×6 px)
    const items = all
      .map((el) => ({ el, vr: visibleRect(el), r: el.getBoundingClientRect() }))
      .filter((x) => x.vr.r - x.vr.l > 6 && x.vr.b - x.vr.t > 6);
    const out: string[] = [];
    // in einer festen bzw. klebenden Leiste (Kopfzeile, Werkzeugleiste)? Inhalt, der beim Scrollen darunter rutscht, ist kein Fehler
    const pinnedOf = (el: Element): Element | null => {
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        const pos = getComputedStyle(p).position;
        if (pos === 'fixed' || pos === 'sticky') return p;
      }
      return null;
    };
    const related = (a: Element, b: Element) => a.contains(b) || b.contains(a) || (a.tagName === 'LABEL' && (a as HTMLLabelElement).control === b) || (b.tagName === 'LABEL' && (b as HTMLLabelElement).control === a);
    for (const x of items) {
      // verdeckt: an der Mitte des sichtbaren Teils liegt etwas anderes obenauf
      const cx = (x.vr.l + x.vr.r) / 2;
      const cy = (x.vr.t + x.vr.b) / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top && !x.el.contains(top) && !top.contains(x.el) && !(x.el instanceof HTMLInputElement && top.tagName === 'LABEL') && !(pinnedOf(top) && pinnedOf(top) !== pinnedOf(x.el))) {
        const label = top.closest('label');
        if (!(label && (label.contains(x.el) || label.control === x.el))) {
          // nur melden, wenn die Taste selbst nicht nur teilweise im Bild ist (Scroll-Listen)
          out.push(`verdeckt: ${name(x.el)} – darüber liegt ${name(top.closest(SEL) ?? top)}`);
        }
      }
      // abgeschnitten am Bildschirmrand (ohne waagrechtes Scrollen dorthin)
      if ((x.r.left < -1 || x.r.right > vw + 1) && !hScroll(x.el)) out.push(`abgeschnitten: ${name(x.el)} (links ${Math.round(x.r.left)}, rechts ${Math.round(x.r.right)}, Breite ${vw})`);
      // Text ragt aus der Taste (Inhalt breiter als die Taste und nicht absichtlich gekürzt)
      if (x.el.matches('button, a.btn') && getComputedStyle(x.el).overflowX === 'visible') {
        const h = x.el as HTMLElement;
        if (h.scrollWidth > h.clientWidth + 2) out.push(`Text ragt heraus: ${name(x.el)} (Inhalt ${h.scrollWidth} px, Taste ${h.clientWidth} px)`);
      }
    }
    // Überlappung zweier Tasten (sichtbare Teile, mehr als 3 px in beide Richtungen)
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (related(a.el, b.el)) continue;
        if (pinnedOf(a.el) !== pinnedOf(b.el) && (!pinnedOf(a.el) || !pinnedOf(b.el))) continue;
        const w = Math.min(a.vr.r, b.vr.r) - Math.max(a.vr.l, b.vr.l);
        const h = Math.min(a.vr.b, b.vr.b) - Math.max(a.vr.t, b.vr.t);
        if (w > 3 && h > 3) out.push(`überlappen: ${name(a.el)} und ${name(b.el)} (${Math.round(w)}×${Math.round(h)} px)`);
      }
    // Kleben: Eingabefeld und Taste direkt übereinander ohne Abstand (unter 4 px) – z. B. Passwortfeld und „Anmelden“
    const isField = (el: Element) => el.matches('input:not([type="checkbox"]):not([type="radio"]), select, textarea');
    const isButton = (el: Element) => el.matches('button, a[href], [role="button"]');
    for (let i = 0; i < items.length; i++)
      for (let j = 0; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (i === j || !isField(a.el) || !isButton(b.el) || related(a.el, b.el)) continue;
        if (pinnedOf(a.el) !== pinnedOf(b.el)) continue; // Inhalt unter fester Kopf- bzw. Werkzeugleiste
        const overlapX = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        if (overlapX < Math.min(a.r.width, b.r.width) * 0.5) continue;
        const gap = a.r.bottom <= b.r.top + 1 ? b.r.top - a.r.bottom : b.r.bottom <= a.r.top + 1 ? a.r.top - b.r.bottom : null;
        if (gap !== null && gap < 4) out.push(`kleben: ${name(a.el)} und ${name(b.el)} (Abstand ${Math.round(gap)} px)`);
      }
    return [...new Set(out)];
  });
}
