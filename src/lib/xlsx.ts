import { strToU8, zipSync } from 'fflate';

/**
 * Minimaler, abhängigkeitsfreier XLSX-Schreiber (Office Open XML).
 *
 * Zahlen werden als echte numerische Zellen mit Zahlenformat geschrieben – Excel zeigt sie
 * dann je nach Ländereinstellung mit Dezimalkomma an, und man kann direkt weiterrechnen.
 */

export type CellStyle =
  | 'header'
  | 'text'
  | 'measure'
  | 'area'
  | 'int'
  | 'boldText'
  | 'boldArea'
  | 'title'
  | 'label'
  | 'money'
  | 'boldMoney'
  | 'wrap'
  | 'note'
  /** Tabellenkopf mit Rahmen, zentriert (Aufmaßblatt nach Vorlage) */
  | 'tableHead'
  /** zentrierter Text (z. B. Plannummer) */
  | 'center'
  /** ohne Rahmen und Format */
  | 'plain'
  // Aufmaßblatt (Vorlage): Gitter mit feinem Rahmen, Summen- und Preisfelder
  | 'blockTitle'
  | 'gridHead'
  | 'gridText'
  | 'gridInt'
  | 'gridMeasure'
  | 'gridArea'
  | 'sumLabel'
  | 'sumValue'
  | 'kvLabel'
  | 'kvMoney'
  | 'kvMoneyBold'
  | 'subtitle'
  /** Summe mit bis zu 3 Nachkommastellen (z. B. m³) */
  | 'sumMeasure'
  /** Gitter: Text linksbündig mit Umbruch, Betrag, Hinweis (kursiv grau) */
  | 'gridLeft'
  | 'gridMoney'
  | 'gridNote'
  // Aufmaßblatt (Firmenvorlage AMB): Aptos Narrow, Buchhaltungsformat, schlichte Linien
  | 'amTitle'
  | 'amLabel'
  | 'amText'
  | 'amDoc'
  | 'amColHead'
  | 'amColHeadR'
  | 'amPos'
  | 'amNum'
  | 'amNumBold'
  | 'amBold'
  | 'amTh'
  | 'amThNote'
  | 'amCenter'
  | 'amCenterLast'
  | 'amNumLast'
  | 'amBox'
  | 'amTotal'
  | 'amTotalNum'
  | 'amRule'
  | 'amNote';

export type Cell =
  | null
  | { t: 'str'; v: string; s?: CellStyle }
  | { t: 'num'; v: number; s?: CellStyle }
  | { t: 'formula'; f: string; v: number; s?: CellStyle }
  /** leere Zelle, nur mit Formatierung (z. B. Rahmen) */
  | { t: 'blank'; s?: CellStyle };

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Spaltenbreiten in Zeichen */
  widths: number[];
  /** Erste Zeile fixieren und als Drucktitel wiederholen */
  freezeHeader?: boolean;
  /** Autofilter-Bereich, z. B. "A1:F20" */
  autoFilter?: string;
  /** Anzahl fixierter Kopfzeilen (überschreibt freezeHeader), die auch auf jeder Druckseite wiederholt werden */
  headerRows?: number;
  /** Druck: Querformat */
  landscape?: boolean;
  /** Druck: Tabellenbreite auf eine Seite anpassen; Druckbereich = genutzte Zellen; Seitenzahlen */
  print?: boolean;
  /** Kopfzeile (nur mit print): links z. B. Projekt / Kostenstelle; Mitte: Seitenzahl; rechts: Firmenlogo */
  headerLeft?: string;
  /** Öffnen in der Seitenlayout-Ansicht (Kopfzeile mit Logo sichtbar), ohne fixierte Zeilen */
  pageLayout?: boolean;
  /** Druck: alles auf eine Seite (Breite und Höhe) */
  onePage?: boolean;
  /** Verbundene Zellen, z. B. ["A40:H40"] */
  merges?: string[];
  /** Zeilenhöhen in Punkt (Zeile 1-basiert) */
  rowHeights?: Record<number, number>;
  /** Kopfzeile wie in der Firmenvorlage: Logo links, „Seite von Seiten“ rechts (statt Text links, Logo rechts) */
  logoLeft?: boolean;
}

/** Bild für die Kopfzeile rechts (Firmenlogo), Größe in Punkt */
export interface HeaderImage {
  bytes: Uint8Array;
  type: 'png' | 'jpeg';
  width: number;
  height: number;
}

/** Text für Excel-Kopfzeilen: „&“ ist dort ein Steuerzeichen und wird verdoppelt */
const hfText = (s: string) => s.replace(/&/g, '&&').slice(0, 200);

const STYLE_INDEX: Record<CellStyle, number> = {
  header: 1,
  text: 2,
  measure: 3,
  area: 4,
  int: 5,
  boldText: 6,
  boldArea: 7,
  title: 8,
  label: 9,
  money: 10,
  boldMoney: 11,
  wrap: 12,
  note: 13,
  tableHead: 14,
  center: 15,
  plain: 0,
  blockTitle: 16,
  gridHead: 17,
  gridText: 18,
  gridInt: 19,
  gridMeasure: 20,
  gridArea: 21,
  sumLabel: 22,
  sumValue: 23,
  kvLabel: 24,
  kvMoney: 25,
  kvMoneyBold: 26,
  subtitle: 27,
  sumMeasure: 28,
  gridLeft: 29,
  gridMoney: 30,
  gridNote: 31,
  amTitle: 32,
  amLabel: 33,
  amText: 34,
  amDoc: 35,
  amColHead: 36,
  amColHeadR: 37,
  amPos: 38,
  amNum: 39,
  amNumBold: 40,
  amBold: 41,
  amTh: 42,
  amThNote: 43,
  amCenter: 44,
  amCenterLast: 45,
  amNumLast: 46,
  amBox: 47,
  amTotal: 48,
  amTotalNum: 49,
  amRule: 50,
  amNote: 51,
};

export const str = (v: string, s: CellStyle = 'text'): Cell => ({ t: 'str', v, s });
export const num = (v: number, s: CellStyle): Cell => ({ t: 'num', v, s });
export const blank = (s: CellStyle = 'text'): Cell => ({ t: 'blank', s });

export function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function esc(s: string): string {
  return s
    // in XML 1.0 unzulässige Steuerzeichen entfernen
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Gültiger, eindeutiger Tabellenblattname (max. 31 Zeichen, ohne []:*?/\). */
export function sheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim() || 'Tabelle').slice(0, 31);
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function numberToXml(v: number): string {
  if (!Number.isFinite(v)) return '0';
  // Kürzeste exakte Darstellung mit Punkt (XML-Format ist immer sprachunabhängig)
  return String(v);
}

function sheetXml(sheet: Sheet, logo?: HeaderImage): string {
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (!cell) return '';
          const ref = `${colName(c)}${r + 1}`;
          const s = STYLE_INDEX[cell.s ?? 'text'];
          if (cell.t === 'str') return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
          if (cell.t === 'blank') return `<c r="${ref}" s="${s}"/>`;
          if (cell.t === 'num') return `<c r="${ref}" s="${s}"><v>${numberToXml(cell.v)}</v></c>`;
          return `<c r="${ref}" s="${s}"><f>${esc(cell.f)}</f><v>${numberToXml(cell.v)}</v></c>`;
        })
        .join('');
      const h = sheet.rowHeights?.[r + 1];
      return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    })
    .join('');
  const maxCols = Math.max(1, sheet.widths.length, ...sheet.rows.map((r) => r.length));
  const dim = `A1:${colName(maxCols - 1)}${Math.max(1, sheet.rows.length)}`;
  // Seitenlayout-Ansicht verträgt keine fixierten Zeilen (Drucktitel bleiben)
  const frozen = sheet.pageLayout ? 0 : (sheet.headerRows ?? (sheet.freezeHeader ? 1 : 0));
  const pane = frozen
    ? `<pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${frozen + 1}" sqref="A${frozen + 1}"/>`
    : '';
  const cols = sheet.widths.length
    ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    (sheet.print ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '') +
    `<dimension ref="${dim}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${sheet.pageLayout ? ' view="pageLayout"' : ''}>${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${rows}</sheetData>` +
    (sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : '') +
    (sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
    (sheet.print && sheet.logoLeft
      ? // Firmenvorlage: Ränder wie dort, auf Seitenbreite; Kopfzeile Logo links, „1 von 2“ rechts
        `<pageMargins left="0.7" right="0.7" top="${logo ? Math.max(0.787, 0.3 + logo.height / 72 + 0.15).toFixed(3) : '0.787'}" bottom="0.787" header="0.3" footer="0.3"/>` +
        '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' +
        `<headerFooter><oddHeader>${esc(`${logo ? '&L&G' : ''}&R&P von &N`)}</oddHeader></headerFooter>` +
        (logo ? '<legacyDrawingHF r:id="rIdHF"/>' : '')
      : sheet.print
      ? // A4, schmale Ränder (cm → Zoll), auf Seitenbreite skaliert, Höhe beliebig; Kopfzeile: links
        // Projekt/Kostenstelle, Mitte Seitenzahl, rechts Firmenlogo (Platz oben passend zur Logohöhe)
        '<printOptions horizontalCentered="1"/>' +
        `<pageMargins left="0.59" right="0.59" top="${logo ? Math.max(0.71, 0.3 + logo.height / 72 + 0.2).toFixed(2) : '0.71'}" bottom="0.71" header="0.3" footer="0.3"/>` +
        `<pageSetup paperSize="9" orientation="${sheet.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="${sheet.onePage ? 1 : 0}"/>` +
        `<headerFooter><oddHeader>${esc(`${sheet.headerLeft ? `&L&9${hfText(sheet.headerLeft)}` : ''}&C&9Seite &P von &N${logo ? '&R&G' : ''}`)}</oddHeader></headerFooter>` +
        (logo ? '<legacyDrawingHF r:id="rIdHF"/>' : '')
      : '<pageMargins left="0.7" right="0.7" top="0.78740157499999996" bottom="0.78740157499999996" header="0.3" footer="0.3"/>' +
        '<pageSetup paperSize="9" orientation="portrait"/>') +
    '</worksheet>'
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.00#"/><numFmt numFmtId="165" formatCode="#,##0.00\\ &quot;€&quot;"/>' +
  // Buchhaltungsformat der Firmenvorlage: 1.234,50 · negative mit Minus · 0 als „-“
  '<numFmt numFmtId="166" formatCode="_-* #,##0.00_-;\\-* #,##0.00_-;_-* &quot;-&quot;??_-;_-@_-"/></numFmts>' +
  '<fonts count="11">' +
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
  '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
  '<font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
  '<font><i/><sz val="10"/><color rgb="FF7A7A7A"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
  // 4–10: Aptos Narrow wie in der Firmenvorlage (11, 11 fett, 14 fett, 10, 12 fett, 9 kursiv, 11 kursiv)
  '<font><sz val="11"/><color theme="1"/><name val="Aptos Narrow"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><color theme="1"/><name val="Aptos Narrow"/><family val="2"/></font>' +
  '<font><b/><sz val="14"/><color theme="1"/><name val="Aptos Narrow"/><family val="2"/></font>' +
  '<font><sz val="10"/><color theme="1"/><name val="Aptos Narrow"/><family val="2"/></font>' +
  '<font><b/><sz val="12"/><color theme="1"/><name val="Aptos Narrow"/><family val="2"/></font>' +
  '<font><i/><sz val="9"/><color theme="1"/><name val="Aptos Narrow"/><family val="2"/></font>' +
  '<font><i/><sz val="11"/><color theme="1"/><name val="Aptos Narrow"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="4">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>' + // 3 hellgrau
  '</fills>' +
  '<borders count="6">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>' +
  '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9DEE5"/></bottom><diagonal/></border>' + // 3 dezente Zeilenlinie
  '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>' + // 4 Rahmen
  '<border><left style="thin"><color rgb="FFB4B4B4"/></left><right style="thin"><color rgb="FFB4B4B4"/></right><top style="thin"><color rgb="FFB4B4B4"/></top><bottom style="thin"><color rgb="FFB4B4B4"/></bottom><diagonal/></border>' + // 5 feines Gitter
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="52">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + // 0 Standard
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' + // 1 Kopf
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 2 Text
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 3 Maß
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 4 Fläche
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>' + // 5 Ganzzahl
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>' + // 6 Summe Text
  '<xf numFmtId="4" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 7 Summe Fläche
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 8 Titel
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 9 Beschriftung
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 10 Betrag
  '<xf numFmtId="165" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 11 Summe Betrag
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' + // 12 Text mit Umbruch
  '<xf numFmtId="49" fontId="3" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' + // 13 Hinweis
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // 14 Tabellenkopf mit Rahmen
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' + // 15 zentriert
  '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' + // 16 Blocktitel
  '<xf numFmtId="0" fontId="1" fillId="3" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // 17 Gitter Kopf
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' + // 18 Gitter Text
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' + // 19 Gitter Ganzzahl
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 20 Gitter Maß
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 21 Gitter Menge
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf>' + // 22 Summe Text
  '<xf numFmtId="4" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 23 Summe Wert
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>' + // 24 Beschriftung rechts
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' + // 25 Betrag
  '<xf numFmtId="165" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 26 Betrag fett
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 27 Untertitel
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 28 Summe Maß
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' + // 29 Gitter Text links
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // 30 Gitter Betrag
  '<xf numFmtId="49" fontId="3" fillId="0" borderId="5" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' + // 31 Gitter Hinweis
  // 32–51 Aufmaßblatt (Firmenvorlage)
  '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 32 Titel 14 fett
  '<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 33 Beschriftung 10
  '<xf numFmtId="49" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' + // 34 Text 11
  '<xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 35 LV/MFK 12 fett
  '<xf numFmtId="0" fontId="9" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' + // 36 Spaltenkopf 9 kursiv, Linie unten
  '<xf numFmtId="0" fontId="9" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' + // 37 dto. rechts
  '<xf numFmtId="49" fontId="5" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' + // 38 Position fett
  '<xf numFmtId="166" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' + // 39 Zahl
  '<xf numFmtId="166" fontId="5" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' + // 40 Zahl fett
  '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 41 fett (Einheit, €)
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' + // 42 Tabellenkopf mit Rahmen
  '<xf numFmtId="0" fontId="10" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>' + // 43 Kopf „Bemerkung“ kursiv
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>' + // 44 zentriert (Plan, Nr.)
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' + // 45 zentriert, letzte Zeile
  '<xf numFmtId="166" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 46 Zahl, letzte Zeile
  '<xf numFmtId="0" fontId="8" fillId="0" borderId="4" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' + // 47 Kasten „Zusammenstellung“
  '<xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 48 Gesamt 12 fett
  '<xf numFmtId="166" fontId="8" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' + // 49 Gesamt Zahl
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' + // 50 Linie unten
  '<xf numFmtId="49" fontId="10" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' + // 51 Bemerkung kursiv
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** VML-Zeichnung für ein Kopfzeilenbild (rechts „RH“ bzw. links „LH“) – so legt Excel Kopfzeilenbilder ab */
function headerVml(logo: HeaderImage, pos: 'LH' | 'RH' = 'RH'): string {
  return (
    '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
    '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">' +
    '<v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/>' +
    '<v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/>' +
    '<v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/>' +
    '<v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>' +
    '<o:lock v:ext="edit" aspectratio="t"/></v:shapetype>' +
    `<v:shape id="${pos}" o:spid="_x0000_s1025" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${logo.width}pt;height:${logo.height}pt;z-index:1">` +
    '<v:imagedata o:relid="rId1" o:title="Firmenlogo"/><o:lock v:ext="edit" rotation="t"/></v:shape></xml>'
  );
}

export function buildXlsx(sheets: Sheet[], opts: { logo?: HeaderImage | null } = {}): Uint8Array {
  if (!sheets.length) throw new Error('Keine Tabellenblätter');
  const logo = opts.logo ?? undefined;
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (logo
        ? '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' +
          (logo.type === 'png' ? '<Default Extension="png" ContentType="image/png"/>' : '<Default Extension="jpeg" ContentType="image/jpeg"/>')
        : '') +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
  );
  files['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  );
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>Aufmaß</dc:title><dc:creator>BauPad</dc:creator>' +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      '</cp:coreProperties>',
  );
  files['docProps/app.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>BauPad</Application></Properties>',
  );
  const definedNames: string[] = [];
  sheets.forEach((s, i) => {
    const quoted = `'${s.name.replace(/'/g, "''")}'`;
    if (s.autoFilter) {
      const [a, b] = s.autoFilter.split(':');
      const abs = (ref: string) => ref.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
      definedNames.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(`${quoted}!${abs(a)}:${abs(b)}`)}</definedName>`,
      );
    }
    const titleRows = s.headerRows ?? (s.freezeHeader ? 1 : 0);
    if (titleRows) definedNames.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(`${quoted}!$1:$${titleRows}`)}</definedName>`);
    if (s.print) {
      const cols = Math.max(1, s.widths.length, ...s.rows.map((r) => r.length));
      definedNames.push(
        `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${esc(`${quoted}!$A$1:$${colName(cols - 1)}$${Math.max(1, s.rows.length)}`)}</definedName>`,
      );
    }
  });
  files['xl/workbook.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="0"/></bookViews>' +
      `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      (definedNames.length ? `<definedNames>${definedNames.join('')}</definedNames>` : '') +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
      '</workbook>',
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  files['xl/styles.xml'] = strToU8(STYLES_XML);
  sheets.forEach((s, i) => {
    const withLogo = logo && s.print ? logo : undefined;
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s, withLogo));
    if (!withLogo) return;
    // Kopfzeilenbild: Blatt → VML-Zeichnung → Bild (ein Bild für alle Blätter)
    files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdHF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawingHF${i + 1}.vml"/>` +
        '</Relationships>',
    );
    files[`xl/drawings/vmlDrawingHF${i + 1}.vml`] = strToU8(headerVml(withLogo, s.logoLeft ? 'LH' : 'RH'));
    files[`xl/drawings/_rels/vmlDrawingHF${i + 1}.vml.rels`] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.${withLogo.type}"/>` +
        '</Relationships>',
    );
  });
  if (logo && sheets.some((s) => s.print)) files[`xl/media/logo.${logo.type}`] = logo.bytes;
  return zipSync(files, { level: 6 });
}
