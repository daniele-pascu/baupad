import type { Point } from './geometry';

/**
 * Eingabe im Befehlsfeld (wie die Befehlszeile in AutoCAD), alle Werte in Metern:
 *  - „2,5;1“ bzw. „@2,5;1“      → Verschiebung um ΔX 2,5 m nach rechts, ΔY 1 m nach oben
 *  - „3<45“  bzw. „@3<45“       → 3 m in Richtung 45° (0° = rechts, gegen den Uhrzeigersinn, wie im CAD)
 *  - „1,25“                     → Abstand 1,25 m in der gezeigten Richtung (Maus bzw. 90°-Richtung)
 * Dezimalzeichen Komma oder Punkt; X und Y mit Strichpunkt (oder Leerzeichen) trennen.
 * Y zeigt wie im CAD nach oben – im Plan (y nach unten) wird das Vorzeichen umgedreht.
 */
export type CadInput = { kind: 'rel'; dx: number; dy: number } | { kind: 'polar'; len: number; angle: number } | { kind: 'dist'; len: number };

const num = (s: string): number | null => {
  const t = s.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function parseCadInput(raw: string): CadInput | null {
  const s = raw.trim().replace(/^@/, '').replace(/m$/i, '').replace(/°/g, '').trim();
  if (!s) return null;
  if (s.includes('<')) {
    const [a, b, ...rest] = s.split('<');
    const len = num(a);
    const angle = num(b ?? '');
    return rest.length || len === null || angle === null ? null : { kind: 'polar', len, angle };
  }
  let parts: string[] | null = null;
  if (s.includes(';')) parts = s.split(';');
  else if (/^\S+\s+\S+$/.test(s)) parts = s.split(/\s+/);
  // „2.5,1“: Punkt als Dezimalzeichen, Komma trennt X und Y
  else if (/^[-+]?\d*\.?\d+,[-+]?\d*\.?\d+$/.test(s) && s.includes('.')) parts = s.split(',');
  if (parts) {
    if (parts.length !== 2) return null;
    const dx = num(parts[0]);
    const dy = num(parts[1]);
    return dx === null || dy === null ? null : { kind: 'rel', dx, dy };
  }
  const len = num(s);
  return len === null ? null : { kind: 'dist', len };
}

/**
 * Verschiebung im Plan (Meter, y nach unten) aus der Eingabe. Bei reinem Abstand gibt `dir`
 * (z. B. Basispunkt → Maus) die Richtung vor; ohne Richtung null.
 */
export function inputVector(inp: CadInput, dir?: Point | null): Point | null {
  if (inp.kind === 'rel') return { x: inp.dx, y: -inp.dy };
  if (inp.kind === 'polar') {
    const a = (inp.angle * Math.PI) / 180;
    return { x: round(inp.len * Math.cos(a)), y: round(-inp.len * Math.sin(a)) };
  }
  if (!dir) return null;
  const l = Math.hypot(dir.x, dir.y);
  if (l < 1e-9) return null;
  return { x: round((dir.x / l) * inp.len), y: round((dir.y / l) * inp.len) };
}

const round = (v: number) => Math.round(v * 1e9) / 1e9;

/** Anzeige am Cursor: Abstand, ΔX, ΔY (nach oben positiv) und Winkel (0° = rechts, gegen den Uhrzeigersinn) */
export function vectorInfo(dxM: number, dyPlanM: number): { len: number; dx: number; dy: number; angle: number } {
  const dy = -dyPlanM;
  let angle = (Math.atan2(dy, dxM) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return { len: Math.hypot(dxM, dy), dx: dxM, dy, angle: Math.round(angle * 10) / 10 % 360 };
}
