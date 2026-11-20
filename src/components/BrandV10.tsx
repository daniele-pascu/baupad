/**
 * Marke V10: kleine Zeile „PAD SOFTWARE“ mit PAD-Zeichen über einer feinen Linie, darunter „BauPad“.
 * Gleich wie im Plan-Export (Option „BauPad-Logo“). Farben folgen hell/dunkel (currentColor, --muted).
 */
export function BrandV10({ testId }: { testId?: string }) {
  return (
    <span className="brand-v10" aria-label="Ein Produkt von PAD Software" role="img" data-testid={testId}>
      <span className="brand-v10-top" aria-hidden="true">
        <svg viewBox="-4 0 859 830" fill="currentColor">
          <path d="M242.85 0.63 L546.82 0.63 C710.14 0.63 854.78 131.35 854.78 311.97 L854.78 356.97 C854.78 539.70 711.66 701.02 541.2 701.02 L286.70 701.02 L363.07 529.84 L562.68 529.84 C610.05 529.84 690.17 455.80 690.17 372.06 L690.17 327.06 C690.17 212.94 600.07 165.81 527.98 165.81 L151.52 165.81 Z" />
          <path d="M253.11 245.14 L480.25 245.14 L379.32 422.68 L185.01 829.9 L-3.54 829.9 Z" />
          <path d="M480.25 245.14 L626.37 499.85 C604.63 518.57 581.16 529.84 562.68 529.84 L436.83 529.84 L379.32 422.68 Z" opacity="0.55" />
        </svg>
        PAD SOFTWARE
      </span>
      <span className="brand-v10-rule" aria-hidden="true" />
      <span className="brand-v10-word" aria-hidden="true">
        BauPad
      </span>
    </span>
  );
}
