#!/usr/bin/env node
// Verschlüsselte Sicherungsdatei (…ndjson.gz.enc aus backups/<Datum>/) lokal lesbar machen – z. B. um Firmen oder
// Benutzer-Zuordnungen von Hand einzuspielen. Der Schlüssel ist das Secret BACKUP_KEY der Funktion „backup“.
//
//   BACKUP_KEY='…' node scripts/sicherung-entschluesseln.mjs records.ndjson.gz.enc [records.ndjson]
//
// Ergebnis: eine Zeile JSON je Datensatz (ohne Zielangabe: <Datei ohne .gz.enc>).
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [src, dest] = process.argv.slice(2);
const b64 = process.env.BACKUP_KEY ?? '';
if (!src || !b64) {
  console.error("Aufruf: BACKUP_KEY='…' node scripts/sicherung-entschluesseln.mjs <datei.ndjson.gz.enc> [ziel.ndjson]");
  process.exit(1);
}
const raw = Buffer.from(b64.trim(), 'base64');
if (raw.length !== 32) {
  console.error('BACKUP_KEY muss 32 Byte (Base64) sein.');
  process.exit(1);
}
const data = new Uint8Array(readFileSync(src));
const magic = new TextEncoder().encode('BPK1');
if (data.length < 32 || magic.some((b, i) => data[i] !== b)) {
  console.error('Keine verschlüsselte BauPad-Sicherung (Kennung BPK1 fehlt).');
  process.exit(1);
}
const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
let plain;
try {
  plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(4, 16), additionalData: magic }, key, data.slice(16)));
} catch {
  console.error('Entschlüsseln fehlgeschlagen – falscher Schlüssel oder beschädigte Datei.');
  process.exit(1);
}
const out = dest ?? src.replace(/\.gz\.enc$/, '').replace(/\.enc$/, '');
writeFileSync(out, gunzipSync(plain));
console.log(`Entschlüsselt: ${out}`);
