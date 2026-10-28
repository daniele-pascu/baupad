// PDFs/Excel rendern und alle Bilder für die Website verkleinern → public/site/
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAW = join('test-results', 'site-shots', 'raw');
const EXP = join('tests', 'output', 'site-shots');
const OUT = join('public', 'site');
mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

// Excel → PDF (LibreOffice), dann wie die anderen PDFs
if (existsSync(join(EXP, 'aufmass.xlsx'))) execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', EXP, join(EXP, 'aufmass.xlsx')], { stdio: 'ignore' });
// PDFs → PNG (erste Seite)
// welche Seite gezeigt wird (Foto-PDF: Seite 2 mit vier Fotos)
const PAGE = { 'fotos.pdf': '2' };
for (const f of readdirSync(EXP).filter((x) => x.endsWith('.pdf'))) {
  const p = PAGE[f] ?? '1';
  execFileSync('pdftoppm', ['-png', '-r', '110', '-f', p, '-l', p, '-singlefile', join(EXP, f), join(RAW, `export-${f.replace('.pdf', '')}`)]);
}
// Verkleinern + JPEG (Python/PIL)
execFileSync('python3', ['-c', `
from PIL import Image
import os
raw='${RAW}'; out='${OUT}'
for f in sorted(os.listdir(raw)):
    if not f.endswith('.png'): continue
    im=Image.open(os.path.join(raw,f)).convert('RGB')
    maxw = 1400 if 'iphone' not in f else 600
    if im.width>maxw: im=im.resize((maxw,round(im.height*maxw/im.width)),Image.LANCZOS)
    im.save(os.path.join(out,f[:-4]+'.jpg'),quality=82,optimize=True)
    print(f, im.size, os.path.getsize(os.path.join(out,f[:-4]+'.jpg'))//1024,'KB')
`], { stdio: 'inherit' });
