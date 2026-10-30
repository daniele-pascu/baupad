/**
 * Abstrakte Bildwelt: Raster, Lichtakzente und geometrische Ebenen im Hintergrund eines Abschnitts.
 * Rein dekorativ (aria-hidden), mit leichter Parallaxe – keine Fotos.
 */
export function Backdrop({ variant = 'hero' }: { variant?: 'hero' | 'dark' | 'light' | 'contact' }) {
  return (
    <div className={`ps-backdrop v-${variant}`} aria-hidden="true">
      <span className="bd-grid" />
      <span className="bd-glow g1" data-parallax="0.08" />
      <span className="bd-glow g2" data-parallax="0.14" />
      <span className="bd-shape s1" data-parallax="0.2" />
      <span className="bd-shape s2" data-parallax="0.12" />
      <span className="bd-shape s3" data-parallax="0.26" />
    </div>
  );
}
