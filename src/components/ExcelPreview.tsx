import { useEffect, useState } from 'react';
import { showError } from './ui';
import type { ExportFile } from '../lib/aufmass';
import type { Cell, HeaderImage, Sheet } from '../lib/xlsx';
import { FilePreview } from './PdfPreview';

const money = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Formate ohne Nachkommastellen (Plan, Nr.) bzw. rechts/mittig – deren Text läuft nicht in die Nachbarzellen */
const PLAIN = /^amTC/;
const FIXED = /^(amTC|amTHead|amColHeadR)/;

/** CSS-Klassen eines Zellformats: Messtabelle = Art + getönt + letzte Zeile, sonst der Name des Formats */
function classOf(s = ''): string {
  const m = /^amT(C|N|Q|DQ|D)(b?)(l?)$/.exec(s);
  return m ? `xt xt-${m[1]}${m[2] ? ' band' : ''}${m[3] ? ' last' : ''}` : `x-${s}`;
}
const textOf = (c: Exclude<Cell, null>): string => (c.t === 'str' ? c.v : c.t === 'blank' ? '' : PLAIN.test(c.s ?? '') ? String(c.v) : money(c.v));

/**
 * Das Aufmaßblatt so, wie es in Excel aussieht: dieselben Zeilen, Spaltenbreiten und Formate wie die Datei
 * (Zahlen = berechnete Werte der Formeln). Text läuft wie in Excel in leere Nachbarzellen weiter.
 */
export function SheetView({ sheet, logo }: { sheet: Sheet; logo?: HeaderImage | null }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!logo) return;
    const url = URL.createObjectURL(new Blob([logo.bytes as BlobPart], { type: `image/${logo.type}` }));
    setLogoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);
  const breaks = new Set(sheet.rowBreaks);
  const cols = sheet.widths.length;
  const total = sheet.widths.reduce((a, b) => a + b, 0);
  /** verbundene Zellen in einer Zeile: Zeile → [erste Spalte, letzte Spalte] */
  const merged = new Map<number, [number, number]>();
  for (const m of sheet.merges ?? []) {
    const r = /^([A-Z])(\d+):([A-Z])\2$/.exec(m);
    if (r) merged.set(Number(r[2]), [r[1].charCodeAt(0) - 65, r[3].charCodeAt(0) - 65]);
  }
  return (
    <div className="sheet-page" data-testid="sheet-preview">
      <div className="sheet-view">
        {(logoUrl || sheet.headerCenter) && (
          <div className="sheet-head">
            {logoUrl && logo && <img src={logoUrl} alt="Firmenlogo" style={{ height: `${logo.height / 11}em` }} />}
            <span>{sheet.headerCenter}</span>
          </div>
        )}
        <table>
          <colgroup>
            {sheet.widths.map((w, i) => (
              <col key={i} style={{ width: `${(w / total) * 100}%` }} />
            ))}
          </colgroup>
          <tbody>
            {sheet.rows.map((row, r) => {
              const cells: React.ReactNode[] = [];
              for (let i = 0; i < cols; i++) {
                const c = row[i] ?? null;
                let span = 1;
                const m = merged.get(r + 1);
                if (m && m[0] === i) span = m[1] - i + 1;
                // linksbündiger Text läuft in die leeren Zellen rechts davon (wie in Excel)
                else if (c?.t === 'str' && !FIXED.test(c.s ?? '')) while (i + span < cols && !row[i + span]) span++;
                cells.push(
                  <td key={i} colSpan={span > 1 ? span : undefined} className={c ? classOf(c.s) : undefined}>
                    {c ? textOf(c) : null}
                  </td>,
                );
                i += span - 1;
              }
              // Seitenumbruch der Datei: gestrichelte Linie über der ersten Zeile der neuen Seite
              return (
                <tr key={r} className={breaks.has(r + 1) ? 'page-break' : undefined}>
                  {cells}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Ansicht des Aufmaßblatts vor dem Speichern: als Excel oder als PDF, gespeichert wird wie beim Plan-PDF
 * (Ordner wählen, teilen, herunterladen).
 */
export function ExcelPreview({ file, logo, onBack, onClose, onSaved }: { file: ExportFile & { sheet: Sheet }; logo?: HeaderImage | null; onBack(): void; onClose(): void; onSaved(): void }) {
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('xlsx');
  /** das PDF entsteht beim Umschalten – so ist die Datei beim Antippen von „Speichern“ schon fertig (iPhone/iPad) */
  const [pdf, setPdf] = useState<ExportFile | null>(null);
  useEffect(() => {
    if (format !== 'pdf' || pdf) return;
    let off = false;
    void import('../lib/aufmassblatt-pdf')
      .then((m) => m.aufmassblattPdf(file.sheet, file.name, logo))
      .then((f) => !off && setPdf(f))
      .catch((e) => {
        if (off) return;
        showError(e, 'PDF konnte nicht erstellt werden');
        setFormat('xlsx');
      });
    return () => {
      off = true;
    };
  }, [format, pdf, file, logo]);
  const formats = [
    ['xlsx', 'Excel'],
    ['pdf', 'PDF'],
  ] as const;
  return (
    <FilePreview
      file={format === 'pdf' && pdf ? pdf : file}
      title="Aufmaßblatt"
      testId="excel-preview"
      onBack={onBack}
      onClose={onClose}
      onSaved={onSaved}
      wait={format === 'pdf' && !pdf}
      extra={
        <div className="field preview-format">
          <span>Speichern als</span>
          <div className="segmented" role="tablist" aria-label="Dateiformat">
            {formats.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={format === id} onClick={() => setFormat(id)} data-testid={`format-${id}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="preview-pages">
        <SheetView sheet={file.sheet} logo={logo} />
      </div>
    </FilePreview>
  );
}
