"""Liest eine XLSX-Datei und gibt Werte, Datentypen und Zahlenformate als JSON aus."""
import json, sys
import openpyxl

wb = openpyxl.load_workbook(sys.argv[1])
out = {}
for ws in wb.worksheets:
    rows = []
    for row in ws.iter_rows():
        rows.append([
            None if c.value is None else {"v": c.value if not hasattr(c.value, 'isoformat') else c.value.isoformat(), "t": c.data_type, "fmt": c.number_format}
            for c in row
        ])
    out[ws.title] = rows
print(json.dumps(out, ensure_ascii=False, default=str))
