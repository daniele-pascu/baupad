/**
 * App-Zeichen von BauPad als echter Text (schwarzes Quadrat, weißes „BauPad“) statt als Bild –
 * damit sich jede Schrift auf der Website markieren lässt. Größe kommt vom umgebenden CSS (Breite).
 */
export function BauPadIcon({ className = '' }: { className?: string }) {
  return (
    <span className={`bp-icon ${className}`.trim()} aria-hidden="true">
      <span>BauPad</span>
    </span>
  );
}
