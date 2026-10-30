import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/** Bewegung nur, wenn das System sie nicht reduziert haben will */
export const motionOk = () => typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Einblenden beim Scrollen: Elemente mit data-reveal bekommen die Klasse „is-in“, sobald sie sichtbar werden.
 * Mit reduzierter Bewegung sind alle sofort sichtbar.
 */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    // Kopfbereich: sofort sichtbar (kurz versetzt), nicht erst beim Scrollen
    els.filter((e) => e.hasAttribute('data-immediate')).forEach((e, i) => window.setTimeout(() => e.classList.add('is-in'), 350 + i * 90));
    if (!motionOk() || !('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            (en.target as HTMLElement).classList.add('is-in');
            io.unobserve(en.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Dezente Parallaxe für Hintergrundformen: verschiebt data-parallax-Elemente mit dem Scrollen (Faktor 0.05–0.3) */
export function useParallax() {
  useEffect(() => {
    if (!motionOk()) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]'));
    if (!els.length) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      for (const el of els) {
        const f = Number(el.dataset.parallax ?? '0.1');
        el.style.transform = `translate3d(0, ${(-y * f).toFixed(1)}px, 0)`;
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}

/** Wrapper mit Einblend-Animation; `delay` versetzt Gruppen (Staffelung) */
export function Reveal({ children, delay = 0, className = '', as: Tag = 'div', style, ...rest }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'section' | 'li' | 'article' | 'figure' | 'p'; style?: CSSProperties; [k: string]: unknown }) {
  const ref = useRef<HTMLElement>(null);
  const T = Tag as 'div';
  return (
    <T ref={ref as never} data-reveal="" className={`ps-reveal ${className}`} style={{ ...style, '--d': `${delay}ms` } as CSSProperties} {...rest}>
      {children}
    </T>
  );
}
