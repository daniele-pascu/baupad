// Statischer Server, der GitHub Pages nachbildet: dist/ wird unter /<repo>/ ausgeliefert,
// mit den MIME-Typen von GitHub Pages; alle anderen Pfade liefern 404.
// Aufruf: node scripts/serve-pages.mjs [port] [basis]   (Standard: 4174 /schadstellen-aufmass/)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? 4174);
const base = process.argv[3] ?? '/schadstellen-aufmass/';
const root = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/vnd.iccprofile',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === base.slice(0, -1)) {
    res.writeHead(301, { Location: base });
    return res.end();
  }
  if (!url.pathname.startsWith(base)) {
    res.writeHead(404);
    return res.end('404 – nicht unter dem Veröffentlichungspfad');
  }
  let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('404');
  }
}).listen(port, () => console.log(`GitHub-Pages-Nachbildung: http://localhost:${port}${base}`));
