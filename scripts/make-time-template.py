"""
Firmenvorlage „Zeitaufzeichnung“ (Excel) für BauPad bereinigen – einmalig, Ergebnis wird eingecheckt:
  python3 -I scripts/make-time-template.py <vorlage.xlsx> src/lib/time-template.ts
- Formeln, Formate, bedingte Formatierung, Kommentare, Druckeinstellungen bleiben unverändert.
- Entfernt: Makro-Knöpfe/Steuerelemente (Start, Grundlagen), Verweis auf eine fremde Datei (Basisjahr),
  Berechnungskette (Excel rechnet beim Öffnen neu), Beispieldaten (Zeiten, U/K, Kommentare, Name, Urlaub).
- Ergebnis als Base64-Modul, damit die Vorlage auch offline in der App verfügbar ist.
"""
import base64, io, re, sys, zipfile

src, out = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
files = {n: zin.read(n) for n in zin.namelist()}

drop = set()
def text(n): return files[n].decode('utf-8')
def put(n, s): files[n] = s.encode('utf-8')

# --- Arbeitsmappe: fremde Datei, Basisjahr, Berechnungskette
wb = text('xl/workbook.xml')
wb = re.sub(r'<externalReferences>.*?</externalReferences>', '', wb, flags=re.S)
wb = re.sub(r'<definedName name="Basisjahr">[^<]*</definedName>', '', wb)
wb = re.sub(r'<calcPr [^>]*/>', '<calcPr calcId="191029" fullCalcOnLoad="1"/>', wb)
put('xl/workbook.xml', wb)
rels = text('xl/_rels/workbook.xml.rels')
rels = re.sub(r'<Relationship [^>]*Target="(externalLinks/[^"]*|calcChain\.xml)"[^>]*/>', '', rels)
put('xl/_rels/workbook.xml.rels', rels)
drop |= {n for n in files if n.startswith('xl/externalLinks/') or n == 'xl/calcChain.xml'}

# --- Steuerelemente (Knöpfe mit Makros, Drehfelder) auf Start (sheet1) und Grundlagen (sheet14)
for sheet, keep_vml in (('sheet1', False), ('sheet14', True)):
    p = f'xl/worksheets/{sheet}.xml'
    s = text(p)
    s = re.sub(r'<mc:AlternateContent[^>]*><mc:Choice Requires="x14"><controls>.*?</controls></mc:Choice>.*?</mc:AlternateContent>', '', s, flags=re.S)
    s = re.sub(r'<controls>.*?</controls>', '', s, flags=re.S)
    s = re.sub(r'<drawing r:id="[^"]*"/>', '', s)
    if not keep_vml:
        s = re.sub(r'<legacyDrawing r:id="[^"]*"/>', '', s)
    put(p, s)
    rp = f'xl/worksheets/_rels/{sheet}.xml.rels'
    r = text(rp)
    pat = r'<Relationship [^>]*Target="\.\./(ctrlProps/[^"]*|activeX/[^"]*|drawings/drawing\d+\.xml|media/[^"]*' + ('' if keep_vml else r'|drawings/vmlDrawing\d+\.vml') + r')"[^>]*/>'
    put(rp, re.sub(pat, '', r))
# VML der Grundlagen: nur die Notiz behalten, Drehfelder raus
v = text('xl/drawings/vmlDrawing14.vml')
v = re.sub(r'<v:shape [^>]*type="#_x0000_t201".*?</v:shape>', '', v, flags=re.S)
put('xl/drawings/vmlDrawing14.vml', v)
drop |= {n for n in files if n.startswith(('xl/ctrlProps/', 'xl/activeX/', 'xl/media/')) or n in ('xl/drawings/drawing1.xml', 'xl/drawings/drawing2.xml', 'xl/drawings/_rels/drawing1.xml.rels', 'xl/drawings/_rels/drawing2.xml.rels', 'xl/drawings/vmlDrawing1.vml')}

# --- Beispieldaten leeren: Monatsblätter (sheet2..sheet13) Zeilen 3–33 Spalten C–H, K, P; Urlaub/Übertrag
def clear_cell(s, ref):
    return re.sub(r'<c r="' + ref + r'"( s="\d+")?( t="\w+")?>(?:(?!</c>).)*</c>', lambda m: f'<c r="{ref}"{m.group(1) or ""}/>', s, flags=re.S)
for i in range(2, 14):
    p = f'xl/worksheets/sheet{i}.xml'
    s = text(p)
    for row in range(3, 34):
        for col in 'CDEFGHKP':
            s = clear_cell(s, f'{col}{row}')
    if i == 2:  # Januar: Jahresurlaub und Übertrag vom Vorjahr trägt die Firma selbst ein
        s = clear_cell(s, 'I35')
        s = clear_cell(s, 'M35')
    put(p, s)
s = text('xl/worksheets/sheet1.xml')
for ref in ['C7', 'E7', 'B16', 'C16', 'D16', 'E16', 'F16', 'G16', 'H16', 'I16']:
    s = clear_cell(s, ref)
put('xl/worksheets/sheet1.xml', s)
ss = text('xl/sharedStrings.xml').replace('Pascu Andrea', '')
put('xl/sharedStrings.xml', ss)

# --- geteilte Formeln ausschreiben (gleicher Inhalt je Zeile), damit einzelne Zellen ersetzt werden können
def col_row(ref):
    m = re.match(r'([A-Z]+)(\d+)$', ref)
    return m.group(1), int(m.group(2))
def shift(formula, drow):
    # relative Zeilen verschieben; Text in Anführungszeichen bleibt
    parts = re.split(r'("[^"]*")', formula)
    def one(m):
        if m.group(4):  # $ vor der Zeile: fest
            return m.group(0)
        return f'{m.group(1)}{m.group(2)}{m.group(3)}{int(m.group(5)) + drow}'
    pat = re.compile(r'(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})()(\$?)(\d+)(?![\d(A-Za-z_])')
    return ''.join(p if p.startswith('"') else pat.sub(one, p) for p in parts)
for n in [k for k in files if k.startswith('xl/worksheets/sheet') and k.endswith('.xml')]:
    s = text(n)
    masters = {}
    for m in re.finditer(r'<c r="([A-Z]+\d+)"[^>]*><f t="shared" ref="[^"]*" si="(\d+)">([^<]*)</f>', s):
        masters[m.group(2)] = (m.group(1), m.group(3))
    def child(m):
        ref, si = m.group(1), m.group(3)
        mref, f = masters[si]
        (mc, mr), (cc, cr) = col_row(mref), col_row(ref)
        assert mc == cc, (n, ref, mref)
        return f'<c r="{ref}"{m.group(2)}><f>{shift(f, cr - mr)}</f>'
    s = re.sub(r'<c r="([A-Z]+\d+)"((?: [a-z]+="[^"]*")*)><f t="shared" si="(\d+)"/>', child, s)
    s = re.sub(r'<f t="shared" ref="[^"]*" si="\d+">', '<f>', s)
    assert 't="shared"' not in s, n
    put(n, s)

# --- zwischengespeicherte Formelergebnisse entfernen: jede Formel wird beim Öffnen neu berechnet
for n in [k for k in files if k.startswith('xl/worksheets/sheet') and k.endswith('.xml')]:
    s = text(n)
    s = re.sub(r'<c r="([A-Z]+\d+)"( s="\d+")?(?: t="(?:str|e|b|n)")?>(<f[^>]*/>|<f[^>]*>[^<]*</f>)<v>[^<]*</v></c>', r'<c r="\1"\2>\3</c>', s)
    put(n, s)

# --- Inhaltstypen ohne entfernte Teile
ct = text('[Content_Types].xml')
for n in drop:
    ct = ct.replace(f'<Override PartName="/{n}" ContentType="', '\x00').split('\x00')
    ct = ct[0] + (re.sub(r'^[^"]*"/>', '', ct[1], count=1) if len(ct) > 1 else '')
put('[Content_Types].xml', ct)
for n in drop:
    files.pop(n, None)

buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in zin.namelist():
        if n in files:
            z.writestr(n, files[n])
data = buf.getvalue()
b64 = base64.b64encode(data).decode()
with open(out, 'w') as f:
    f.write('/** Firmenvorlage „Zeitaufzeichnung“ (bereinigt, siehe scripts/make-time-template.py) – Base64 der .xlsx */\n')
    f.write(f"export const TIME_TEMPLATE_B64 =\n  '{b64}';\n")
print('ok', len(data), 'bytes;', len(drop), 'Teile entfernt')
