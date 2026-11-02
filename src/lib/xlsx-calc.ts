import { strFromU8, strToU8 } from 'fflate';

/**
 * Kleiner Formelrechner für die Firmenvorlage „Zeitaufzeichnung“: rechnet alle Formeln einer .xlsx aus und schreibt
 * die Ergebnisse als zwischengespeicherte Werte in die Zellen – wie Excel beim Speichern. Ohne diese Werte zeigen
 * Excel in der geschützten Ansicht, Handy- und Mail-Vorschauen nur leere Felder.
 * Unterstützt genau das, was die Vorlage braucht: + − * / & Vergleiche, Bezüge (auch auf andere Blätter und
 * Namen), Bereiche und IF, OR, AND, SUM, VLOOKUP, WEEKDAY, DATE, YEAR, MONTH, DAY, ISNUMBER, TEXT, COUNTIF, TODAY.
 */

type Err = { err: string };
type Scalar = number | string | boolean | null | Err;
type RangeVal = { range: Scalar[][] };
type Val = Scalar | RangeVal;

const isErr = (v: unknown): v is Err => typeof v === 'object' && v !== null && 'err' in v;
const isRange = (v: unknown): v is RangeVal => typeof v === 'object' && v !== null && 'range' in v;
const NA: Err = { err: '#N/A' };
const VALUE: Err = { err: '#VALUE!' };
const REF: Err = { err: '#REF!' };
const NAME: Err = { err: '#NAME?' };
const DIV0: Err = { err: '#DIV/0!' };

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------- Zellbezüge

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function parseRef(ref: string): { col: number; row: number } {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bezug ${ref}`);
  return { col: colNum(m[1]), row: Number(m[2]) };
}
const key = (col: number, row: number) => `${col}:${row}`;

// ---------------------------------------------------------------------------- Formeln zerlegen

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; sheet: string | null; a: string; b?: string } | { t: 'name'; v: string } | { t: 'fn'; v: string } | { t: 'op'; v: string };

function tokenize(f: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < f.length) {
    const c = f[i];
    if (c === ' ') {
      i++;
      continue;
    }
    if (c === '"') {
      let s = '';
      i++;
      for (;;) {
        if (f[i] === '"' && f[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (f[i] === '"') {
          i++;
          break;
        } else s += f[i++];
      }
      out.push({ t: 'str', v: s });
      continue;
    }
    const num = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(f.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const two = f.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/&=<>(),:'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    // Blattname in Anführungszeichen
    let sheet: string | null = null;
    let rest = f.slice(i);
    const q = /^'((?:[^']|'')+)'!/.exec(rest);
    if (q) {
      sheet = q[1].replace(/''/g, "'");
      i += q[0].length;
      rest = f.slice(i);
    }
    const w = /^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_.]*/.exec(rest);
    const r = /^\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?(?![A-Za-z0-9_(])/.exec(rest);
    if (r) {
      const [a, b] = r[0].split(':');
      out.push({ t: 'ref', sheet, a, b });
      i += r[0].length;
      continue;
    }
    if (w) {
      const word = w[0];
      i += word.length;
      if (f[i] === '!') {
        // Blatt!Bezug
        i++;
        const r2 = /^\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/.exec(f.slice(i));
        if (!r2) throw new Error(`Formel: ${f}`);
        const [a, b] = r2[0].split(':');
        out.push({ t: 'ref', sheet: word, a, b });
        i += r2[0].length;
      } else if (f[i] === '(') out.push({ t: 'fn', v: word.toUpperCase() });
      else out.push({ t: 'name', v: word });
      continue;
    }
    throw new Error(`Formel nicht lesbar: ${f}`);
  }
  return out;
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; sheet: string | null; a: string; b?: string }
  | { k: 'name'; v: string }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'neg'; e: Node };

function parse(f: string): Node {
  const toks = tokenize(f);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => toks[p]?.t === 'op' && (toks[p] as { v: string }).v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Formel: ${v} erwartet in ${f}`);
    p++;
  };
  const level = (ops: string[], next: () => Node) => (): Node => {
    let l = next();
    while (toks[p]?.t === 'op' && ops.includes((toks[p] as { v: string }).v)) {
      const op = (toks[p++] as { v: string }).v;
      l = { k: 'bin', op, l, r: next() };
    }
    return l;
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new Error(`Formel unvollständig: ${f}`);
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      p++;
      const e = primary();
      return t.v === '-' ? { k: 'neg', e } : e;
    }
    p++;
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'ref') return { k: 'ref', sheet: t.sheet, a: t.a, b: t.b };
    if (t.t === 'name') return { k: 'name', v: t.v };
    if (t.t === 'fn') {
      expect('(');
      const args: Node[] = [];
      if (!isOp(')')) {
        for (;;) {
          args.push(cmp());
          if (isOp(',')) {
            p++;
            continue;
          }
          break;
        }
      }
      expect(')');
      return { k: 'fn', name: t.v, args };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = cmp();
      expect(')');
      return e;
    }
    throw new Error(`Formel: unerwartet in ${f}`);
  };
  const mul = level(['*', '/'], primary);
  const add = level(['+', '-'], mul);
  const cat = level(['&'], add);
  const cmp = level(['=', '<>', '<', '>', '<=', '>='], cat);
  const n = cmp();
  if (p !== toks.length) throw new Error(`Formel: Rest in ${f}`);
  return n;
}

// ---------------------------------------------------------------------------- Werte

function num(v: Scalar): number | Err {
  if (isErr(v)) return v;
  if (v === null) return 0;
  if (v === '') return VALUE;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) && v.trim() !== '' ? n : VALUE;
}
function bool(v: Scalar): boolean | Err {
  if (isErr(v)) return v;
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v.toUpperCase() === 'TRUE') return true;
  if (v.toUpperCase() === 'FALSE') return false;
  return VALUE;
}
const text = (v: Scalar): string | Err => (isErr(v) ? v : v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(v) : v);

/** Vergleich wie Excel: leer = 0 bzw. "", Text > Zahl, Text ohne Groß/Klein */
function compare(a: Scalar, b: Scalar): number {
  const norm = (x: Scalar, other: Scalar): number | string | boolean => (x === null ? (typeof other === 'string' ? '' : typeof other === 'boolean' ? false : 0) : (x as number | string | boolean));
  const x = norm(a, b);
  const y = norm(b, a);
  const rank = (v: unknown) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  if (rank(x) !== rank(y)) return rank(x) - rank(y);
  if (typeof x === 'string') return x.toLowerCase() < (y as string).toLowerCase() ? -1 : x.toLowerCase() > (y as string).toLowerCase() ? 1 : 0;
  const nx = Number(x);
  const ny = Number(y);
  return nx < ny ? -1 : nx > ny ? 1 : 0;
}

const DAY_MS = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);
const toDate = (serial: number) => new Date(EPOCH + Math.floor(serial) * DAY_MS);
const fromYmd = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS);

/** TEXT(Wert; "[h]:mm") – die Vorlage braucht nur dieses Format */
function formatHM(v: number): string {
  const sign = v < 0 ? '-' : '';
  const sec = Math.round(Math.abs(v) * 86400);
  const min = Math.floor(sec / 60);
  return `${sign}${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------- Arbeitsmappe

interface Cell {
  f?: Node;
  v: Scalar;
}
interface Sheet {
  name: string;
  path: string;
  cells: Map<string, Cell>;
}

export function calcWorkbook(files: Record<string, Uint8Array>, today = new Date()): void {
  const read = (p: string) => strFromU8(files[p]);
  const shared = files['xl/sharedStrings.xml']
    ? [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join('')))
    : [];
  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  const target = new Map([...rels.matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets: Sheet[] = [...wb.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({ name: unxml(m[1]), path: `xl/${(target.get(m[2]) ?? '').replace(/^\/?xl\//, '')}`, cells: new Map() }));
  const byName = new Map(sheets.map((s) => [s.name.toLowerCase(), s]));
  const names = new Map<string, string>();
  for (const m of wb.matchAll(/<definedName name="([^"]+)"(?: [^>]*)?>([^<]*)<\/definedName>/g)) if (!m[0].includes('localSheetId')) names.set(m[1].toLowerCase(), unxml(m[2]));

  for (const s of sheets) {
    const x = read(s.path);
    for (const m of x.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const { col, row } = parseRef(m[1]);
      const attrs = m[2];
      const body = m[3] ?? '';
      const fm = /<f[^>]*>([^<]*)<\/f>/.exec(body);
      const t = /t="(\w+)"/.exec(attrs)?.[1];
      const raw = /<v>([^<]*)<\/v>/.exec(body)?.[1];
      let v: Scalar = null;
      if (t === 's' && raw != null) v = shared[Number(raw)] ?? '';
      else if (t === 'inlineStr') v = unxml([...body.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((y) => y[1]).join(''));
      else if (t === 'str' && raw != null) v = unxml(raw);
      else if (t === 'b' && raw != null) v = raw === '1';
      else if (raw != null && raw !== '') v = Number(raw);
      s.cells.set(key(col, row), { f: fm ? parse(unxml(fm[1])) : undefined, v });
    }
  }

  const todaySerial = fromYmd(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const done = new Map<string, Scalar>();
  const busy = new Set<string>();

  const cellValue = (s: Sheet, col: number, row: number): Scalar => {
    const id = `${s.name}!${key(col, row)}`;
    if (done.has(id)) return done.get(id)!;
    const c = s.cells.get(key(col, row));
    if (!c) return null;
    if (!c.f) return c.v;
    if (busy.has(id)) return REF; // Zirkelbezug
    busy.add(id);
    let v = evaluate(c.f, s);
    if (isRange(v)) v = v.range[0]?.[0] ?? null;
    busy.delete(id);
    done.set(id, v as Scalar);
    return v as Scalar;
  };

  const refVal = (sheetName: string | null, a: string, b: string | undefined, here: Sheet): Val => {
    const s = sheetName ? byName.get(sheetName.toLowerCase()) : here;
    if (!s) return REF;
    const p1 = parseRef(a);
    if (!b) return cellValue(s, p1.col, p1.row);
    const p2 = parseRef(b);
    const range: Scalar[][] = [];
    for (let r = Math.min(p1.row, p2.row); r <= Math.max(p1.row, p2.row); r++) {
      const line: Scalar[] = [];
      for (let c = Math.min(p1.col, p2.col); c <= Math.max(p1.col, p2.col); c++) line.push(cellValue(s, c, r));
      range.push(line);
    }
    return { range };
  };

  const scalar = (v: Val): Scalar => (isRange(v) ? (v.range[0]?.[0] ?? null) : v);
  const flat = (v: Val): Scalar[] => (isRange(v) ? v.range.flat() : [v]);

  function evaluate(n: Node, here: Sheet): Val {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'str':
        return n.v;
      case 'ref':
        return refVal(n.sheet, n.a, n.b, here);
      case 'name': {
        const up = n.v.toUpperCase();
        if (up === 'TRUE') return true;
        if (up === 'FALSE') return false;
        const def = names.get(n.v.toLowerCase());
        if (!def) return NAME;
        const m = /^'?(.+?)'?!(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?$/.exec(def);
        if (!m) return NAME;
        return refVal(m[1].replace(/''/g, "'"), m[2], m[3], here);
      }
      case 'neg': {
        const v = num(scalar(evaluate(n.e, here)));
        return isErr(v) ? v : -v;
      }
      case 'bin': {
        const l = scalar(evaluate(n.l, here));
        const r = scalar(evaluate(n.r, here));
        if (isErr(l)) return l;
        if (isErr(r)) return r;
        if (n.op === '&') {
          const a = text(l);
          const b = text(r);
          return isErr(a) ? a : isErr(b) ? b : a + b;
        }
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
          const c = compare(l, r);
          return n.op === '=' ? c === 0 : n.op === '<>' ? c !== 0 : n.op === '<' ? c < 0 : n.op === '>' ? c > 0 : n.op === '<=' ? c <= 0 : c >= 0;
        }
        const a = num(l);
        const b = num(r);
        if (isErr(a)) return a;
        if (isErr(b)) return b;
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        return b === 0 ? DIV0 : a / b;
      }
      case 'fn':
        return call(n.name, n.args, here);
    }
  }

  function call(name: string, args: Node[], here: Sheet): Val {
    const arg = (i: number) => (args[i] ? evaluate(args[i], here) : null);
    const sc = (i: number) => scalar(arg(i));
    const n1 = (i: number) => num(sc(i));
    switch (name) {
      case 'IF': {
        const c = bool(sc(0));
        if (isErr(c)) return c;
        if (c) return args.length > 1 ? sc(1) : true;
        return args.length > 2 ? sc(2) : false;
      }
      case 'OR':
      case 'AND': {
        let any = false;
        let all = true;
        for (let i = 0; i < args.length; i++) {
          const v = arg(i);
          for (const x of flat(v)) {
            if (isRange(v) && (typeof x === 'string' || x === null)) continue;
            const b = bool(x);
            if (isErr(b)) return b;
            any ||= b;
            all &&= b;
          }
        }
        return name === 'OR' ? any : all;
      }
      case 'SUM': {
        let s = 0;
        for (let i = 0; i < args.length; i++) {
          const v = arg(i);
          if (isRange(v)) {
            for (const x of v.range.flat()) {
              if (isErr(x)) return x;
              if (typeof x === 'number') s += x;
            }
          } else {
            const x = num(v);
            if (isErr(x)) return x;
            s += x;
          }
        }
        return s;
      }
      case 'ISNUMBER':
        return typeof sc(0) === 'number';
      case 'WEEKDAY': {
        const d = n1(0);
        if (isErr(d)) return d;
        const type = args.length > 1 ? n1(1) : 1;
        const wd = toDate(d).getUTCDay(); // 0 = So
        return type === 2 ? ((wd + 6) % 7) + 1 : wd + 1;
      }
      case 'DATE': {
        const y = n1(0);
        const m = n1(1);
        const d = n1(2);
        if (isErr(y)) return y;
        if (isErr(m)) return m;
        if (isErr(d)) return d;
        return fromYmd(Math.trunc(y), Math.trunc(m), Math.trunc(d));
      }
      case 'YEAR':
      case 'MONTH':
      case 'DAY': {
        const d = n1(0);
        if (isErr(d)) return d;
        const dt = toDate(d);
        return name === 'YEAR' ? dt.getUTCFullYear() : name === 'MONTH' ? dt.getUTCMonth() + 1 : dt.getUTCDate();
      }
      case 'TODAY':
        return todaySerial;
      case 'TEXT': {
        const v = n1(0);
        if (isErr(v)) return v;
        return formatHM(v);
      }
      case 'COUNTIF': {
        const range = arg(0);
        const crit = sc(1);
        let c = 0;
        for (const x of flat(range)) if (x !== null && !isErr(x) && compare(x, crit) === 0 && typeof x === typeof crit) c++;
        return c;
      }
      case 'VLOOKUP': {
        const x = sc(0);
        if (isErr(x)) return x;
        const table = arg(1);
        if (!isRange(table)) return NA;
        const col = n1(2);
        if (isErr(col)) return col;
        const approx = args.length > 3 ? bool(sc(3)) : true;
        if (isErr(approx)) return approx;
        const rows = table.range;
        if (!approx) {
          const hit = rows.find((r) => r[0] !== null && !isErr(r[0]) && typeof r[0] === typeof x && compare(r[0], x) === 0);
          return hit ? (hit[col - 1] ?? null) : NA;
        }
        let best: Scalar[] | null = null;
        for (const r of rows) {
          if (r[0] === null || isErr(r[0]) || typeof r[0] !== typeof x) continue;
          if (compare(r[0], x) <= 0) best = r;
          else break;
        }
        return best ? (best[col - 1] ?? null) : NA;
      }
      default:
        return NAME;
    }
  }

  // alle Formeln ausrechnen und als zwischengespeicherte Werte in die Blätter schreiben
  for (const s of sheets) {
    let x = read(s.path);
    x = x.replace(/<c r="([A-Z]+\d+)"((?: s="\d+")?)(?: t="\w+")?>(<f[^>]*>[^<]*<\/f>)(?:<v>[^<]*<\/v>|<v\/>)?<\/c>/g, (_all, ref: string, style: string, f: string) => {
      const { col, row } = parseRef(ref);
      const v = cellValue(s, col, row);
      if (v === null) return `<c r="${ref}"${style}>${f}<v>0</v></c>`;
      if (isErr(v)) return `<c r="${ref}"${style} t="e">${f}<v>${v.err}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}"${style} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
      if (typeof v === 'string') return `<c r="${ref}"${style} t="str">${f}<v>${xml(v)}</v></c>`;
      return `<c r="${ref}"${style}>${f}<v>${v}</v></c>`;
    });
    files[s.path] = strToU8(x);
  }
}
