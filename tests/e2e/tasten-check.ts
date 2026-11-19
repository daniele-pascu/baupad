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
        // sichtbarer Teil: ein Feld, das beim Scrollen unter die feste Fußleiste eines Fensters rutscht, endet an deren Rand
        const gap = a.vr.b <= b.vr.t + 1 ? b.vr.t - a.vr.b : b.vr.b <= a.vr.t + 1 ? a.vr.t - b.vr.b : null;
        if (gap !== null && gap < 4) out.push(`kleben: ${name(a.el)} und ${name(b.el)} (Abstand ${Math.round(gap)} px)`);
      }
    return [...new Set(out)];
  });
}

/**
 * Kontrast-Prüfung (vor allem für den Dunkelmodus): Jede sichtbare Schrift muss sich vom Hintergrund abheben
 * (Kontrast mindestens 3 : 1 nach WCAG – darunter ist sie schlecht lesbar, z. B. hell auf hell), und Tasten mit eigener
 * Fläche dürfen nicht in ihrem Untergrund verschwinden (z. B. schwarze Taste auf Schwarz ohne Rand).
 * Übersprungen: Website (eigenes Design), Text in Grafiken (SVG, Plan), über Bildern und gesperrte Elemente.
 */
export async function kontrastBefunde(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    if (document.querySelector('.ps-site')) return [];
    type C = { r: number; g: number; b: number; a: number };
    const parse = (s: string): C | null => {
      let m = s.match(/^rgba?\(([^)]+)\)$/);
      if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      m = s.match(/^color\(srgb ([^)]+)\)$/);
      if (m) {
        const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
      }
      return null;
    };
    const over = (top: C, bottom: C): C => {
      const a = top.a + bottom.a * (1 - top.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
      return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
    };
    const lum = (c: C) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: C, b: C) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    /** Hintergrund hinter einem Element (Schichten von innen nach außen gemischt); null = Bild dahinter, unbekannt */
    const backdrop = (el: Element | null): C | null => {
      const layers: C[] = [];
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage.includes('url(')) return null;
        const bg = parse(cs.backgroundColor);
        let c = bg && bg.a > 0 ? bg : null;
        if (!c && cs.backgroundImage.includes('gradient')) {
          const first = cs.backgroundImage.match(/(rgba?\([^)]+\)|color\(srgb [^)]+\))/);
          const g = first ? parse(first[1]) : null;
          if (g && g.a >= 0.6) c = g;
        }
        if (c) {
          layers.push(c);
          if (c.a >= 0.99) break;
        }
      }
      let acc: C = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    };
    const faded = (el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (Number(getComputedStyle(n).opacity) < 0.6) return true;
        if ((n as HTMLButtonElement).disabled || n.getAttribute('aria-disabled') === 'true') return true;
      }
      return false;
    };
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      return !el.closest('[aria-hidden="true"], [inert], .sr-only, svg, canvas, .viewer, video');
    };
    const name = (el: Element) => {
      const t = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 36);
      const id = el.closest('[data-testid]')?.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''}${id ? `[${id}]` : ''} „${t}“`;
    };
    const modals = [...document.querySelectorAll('.modal, [role="dialog"]')].filter((m) => (m as HTMLElement).offsetParent !== null || getComputedStyle(m).position === 'fixed');
    const root: ParentNode = modals.length ? modals[modals.length - 1] : document;
    const out: string[] = [];
    const seen = new Set<string>();
    // 1) Schrift auf ihrem Hintergrund
    for (const el of root.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      const field = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), textarea, select');
      if (!own && !(field && (el as HTMLInputElement).value)) continue;
      if (!visible(el) || faded(el)) continue;
      const fg = parse(getComputedStyle(el).color);
      const bg = backdrop(el);
      if (!fg || !bg) continue;
      const r = ratio(over(fg, bg), bg);
      if (r < 3) {
        const msg = `Schrift kaum lesbar (Kontrast ${r.toFixed(1)} : 1): ${name(el)}`;
        if (!seen.has(msg)) out.push(msg);
        seen.add(msg);
      }
    }
    // 2) Tasten mit eigener Fläche heben sich vom Untergrund ab (Fläche oder Rand)
    for (const el of root.querySelectorAll('.btn, .chip, .tools-quick, .tool-card, .tools-grid > a, .seg-btn')) {
      if (!visible(el) || faded(el)) continue;
      const cs = getComputedStyle(el);
      const own = parse(cs.backgroundColor);
      if (!own || own.a < 0.5) continue;
      const under = backdrop(el.parentElement);
      if (!under) continue;
      const fill = over(own, under);
      const border = parse(cs.borderTopColor);
      const borderW = parseFloat(cs.borderTopWidth) || 0;
      const edge = border && borderW > 0 ? ratio(over(border, under), under) : 1;
      const shadowRing = /(^|,)\s*(rgba?\([^)]+\)\s+)?0px 0px 0px [1-9]/.test(cs.boxShadow);
      if (ratio(fill, under) < 1.15 && edge < 1.3 && !shadowRing) {
        const msg = `Taste hebt sich nicht vom Hintergrund ab: ${name(el)}`;
        if (!seen.has(msg)) out.push(msg);
        seen.add(msg);
      }
    }
    return out.slice(0, 20);
  });
}
