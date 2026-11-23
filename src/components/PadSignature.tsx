/**
 * Unterschrift ganz unten auf der Tools-Seite: über einer Linie nur klein „PAD SOFTWARE“ mit PAD-Zeichen –
 * „PAD“ immer kräftiger als „Software“ (wie im Logo der Website und im Plan-Export).
 * BauPad steht schon oben in der Leiste – unten soll nichts den Blick auf die Tools lenken.
 * (Im Plan-Export gibt es die volle Marke V10 mit „BauPad“, siehe export-pdf.ts.)
 */
export function PadSignature({ testId }: { testId?: string }) {
  return (
    <span className="pad-signature" aria-label="Ein Produkt von PAD Software" role="img" data-testid={testId}>
      <svg viewBox="-4 0 859 830" fill="currentColor" aria-hidden="true">
        <path d="M242.85 0.63 L546.82 0.63 C710.14 0.63 854.78 131.35 854.78 311.97 L854.78 356.97 C854.78 539.70 711.66 701.02 541.2 701.02 L286.70 701.02 L363.07 529.84 L562.68 529.84 C610.05 529.84 690.17 455.80 690.17 372.06 L690.17 327.06 C690.17 212.94 600.07 165.81 527.98 165.81 L151.52 165.81 Z" />
        <path d="M253.11 245.14 L480.25 245.14 L379.32 422.68 L185.01 829.9 L-3.54 829.9 Z" />
        <path d="M480.25 245.14 L626.37 499.85 C604.63 518.57 581.16 529.84 562.68 529.84 L436.83 529.84 L379.32 422.68 Z" opacity="0.55" />
      </svg>
      <span aria-hidden="true">
        <b>PAD</b> SOFTWARE
      </span>
    </span>
  );
}
