/** Minimale Node-Typen für Tests, die PDFs mit pdftotext/pdfinfo prüfen (ohne @types/node). */
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], opts: { encoding: 'utf8' }): string;
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: Uint8Array | string): void;
  export function readFileSync(path: string): Uint8Array;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
