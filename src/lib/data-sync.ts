import { useEffect, useState } from 'react';
import { cloudCall, CloudError, type FetchLike } from './cloud';
import { notifyDataChanged } from './data-events';
import {
  applyRemoteRecord,
  clearOutbox,
  deleteDefectPlanCompletely,
  deleteProjectCompletely,
  enqueueAll,
  getMeta,
  listOutbox,
  readSyncFile,
  readSyncRecord,
  setMeta,
  setSyncChangeHook,
  setSyncFileFetcher,
  writeSyncFile,
  type OutboxEntry,
  type SyncFileStore,
  type SyncStore,
} from './db';
import { getState, hasUnsavedChanges, flush as flushStore, reloadProject } from './store';

/**
 * Abgleich aller Daten mit der zentralen Ablage (Projekte, Kostenstellen, Pläne, Messungen, Zeichnungen, LV,
 * Arbeiter, Wochen, Berichte, Mängelpläne mit Markierungen, Firmenformulare, Firmeneinstellungen) sowie der
 * Dateien dazu (Originalpläne, Planbilder, Formular-PDFs). Fotos gleicht photo-cloud.ts ab.
 *
 *   Gerät bleibt Zwischenspeicher: jede Änderung landet zuerst lokal und in der Warteschlange (outbox).
 *   push: Dateien zuerst (signierte Links zu Hetzner), dann Datensätze als JSON in die Tabelle `records`.
 *   pull: Änderungen anderer Geräte seit dem letzten Stand (Cursor: Zeit + Kennung), Dateien werden beim Öffnen nachgeladen.
 *   Lokale, noch nicht übertragene Änderungen gewinnen gegenüber dem Abgleich; sonst gilt der Stand des Servers
 *   (die zuletzt übertragene Änderung).
 */

const CURSOR = 'dataSyncCursor';
const ADOPTED = 'dataSyncWorkspace';
const PULL_EVERY = 5 * 60_000;
const PAGE = 500;
const BATCH = 200;
const KICK_DELAY = 1500;

const FILE_STORES: SyncFileStore[] = ['blobs', 'defectPlanImages', 'formTemplateFiles'];
const PROJECT_STORES: SyncStore[] = ['projects', 'costCenters', 'files', 'plans', 'damages', 'components', 'elements', 'lvDocs'];
/** Dateiteile je Ablage; „pdf.pdf“ der Planbilder ist optional */
const FILE_PARTS: Record<SyncFileStore, { name: string; type: string; optional?: boolean }[]> = {
  blobs: [{ name: 'data.bin', type: 'application/octet-stream' }],
  defectPlanImages: [
    { name: 'data.jpg', type: 'image/jpeg' },
    { name: 'thumb.jpg', type: 'image/jpeg' },
    { name: 'pdf.pdf', type: 'application/pdf', optional: true },
  ],
  formTemplateFiles: [{ name: 'pdf.pdf', type: 'application/pdf' }],
};
const fileKey = (id: string, part: string) => `files/${id}/${part}`;
const isFileStore = (s: string): s is SyncFileStore => (FILE_STORES as string[]).includes(s);

interface RemoteRow {
  store: SyncStore;
  id: string;
  data: Record<string, unknown>;
  rev: number;
  updated_at: string;
  deleted_at: string | null;
}
interface Cursor {
  at: string;
  id: string;
}

export interface DataSyncState {
  status: 'off' | 'ready' | 'error';
  /** Datensätze und Dateien, die noch nicht übertragen sind */
  pending: number;
  busy: boolean;
  lastSyncAt: number | null;
  message: string | null;
}
let state: DataSyncState = { status: 'off', pending: 0, busy: false, lastSyncAt: null, message: null };
const listeners = new Set<(s: DataSyncState) => void>();
function setState(patch: Partial<DataSyncState>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb(state);
}
export const dataSyncState = () => state;
export function useDataSyncState(): DataSyncState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export class DataSync {
  private flushing: Promise<void> | null = null;
  private again = false;
  private kickTimer: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopFns: (() => void)[] = [];
  /** Abgleich hat das geöffnete Projekt verändert, während dort ungespeicherte Änderungen waren */
  private reloadPending = false;

  constructor(
    readonly companyId: string,
    private fetchFn?: FetchLike,
  ) {}

  private call<T>(action: string, body: Record<string, unknown> = {}) {
    return cloudCall<T>(action, body, this.fetchFn);
  }

  start() {
    const onOnline = () => void this.sync().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.sync().catch(() => {});
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    this.timer = setInterval(() => void this.sync().catch(() => {}), PULL_EVERY);
    setSyncChangeHook(() => this.kick());
    setSyncFileFetcher((store, id) => this.fetchFile(store, id));
    this.stopFns.push(
      () => window.removeEventListener('online', onOnline),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => clearInterval(this.timer),
      () => clearTimeout(this.kickTimer),
      () => setSyncChangeHook(null),
      () => setSyncFileFetcher(null),
    );
  }
  stop() {
    for (const f of this.stopFns) f();
    this.stopFns = [];
  }

  /** nach einer lokalen Änderung: kurz sammeln, dann Warteschlange übertragen */
  kick() {
    clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => void this.push().catch(() => {}), KICK_DELAY);
  }

  /** Erste Anbindung dieses Geräts: alles Vorhandene vormerken (einmal je Arbeitsbereich) */
  async adoptLocal(): Promise<void> {
    const adopted = await getMeta<string>(ADOPTED);
    if (adopted === this.companyId) return;
    // Daten eines anderen Arbeitsbereichs auf diesem Gerät werden nicht übernommen – nur neue Änderungen
    if (!adopted) await enqueueAll();
    await setMeta(ADOPTED, this.companyId);
  }

  /** Abgleich in beide Richtungen */
  async sync(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    await this.push();
    await this.pull();
  }

  /** Warteschlange übertragen – läuft nie doppelt; ein Aufruf währenddessen hängt einen weiteren Durchlauf an */
  push(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      try {
        do {
          this.again = false;
          await this.pushOnce();
        } while (this.again);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private async pushOnce(): Promise<void> {
    await flushStore(); // ausstehende Änderungen des Aufmaßes zuerst in die lokale Datenbank
    const all = await listOutbox();
    setState({ pending: all.length });
    if (!all.length) return;
    setState({ busy: true });
    try {
      // Dateien zuerst: wenn der Datensatz bei den anderen Geräten ankommt, ist die Datei schon da
      for (const e of all.filter((e) => isFileStore(e.store))) await this.pushFile(e);
      const records = all.filter((e) => !isFileStore(e.store));
      for (let i = 0; i < records.length; i += BATCH) await this.pushRecords(records.slice(i, i + BATCH));
      setState({ status: 'ready', message: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: e instanceof CloudError && e.offline ? state.status : 'error', message: msg });
      throw e;
    } finally {
      setState({ busy: false, pending: (await listOutbox()).length });
    }
  }

  private async pushFile(e: OutboxEntry): Promise<void> {
    const store = e.store as SyncFileStore;
    const parts = await readSyncFile(store, e.recordId);
    if (parts && !e.deleted) {
      const items = FILE_PARTS[store].filter((p) => parts[p.name]).map((p) => ({ key: fileKey(e.recordId, p.name), method: 'PUT', contentType: p.type }));
      const { urls } = await this.call<{ urls: Record<string, string> }>('presign', { items });
      for (const it of items) {
        let r: Response;
        try {
          r = await fetch(urls[`PUT ${it.key}`], { method: 'PUT', headers: { 'content-type': it.contentType }, body: parts[it.key.split('/').pop()!] });
        } catch {
          throw new CloudError(0, 'offline', 'Upload abgebrochen – keine Verbindung.');
        }
        if (!r.ok) throw new Error(`Upload fehlgeschlagen (${r.status}).`);
      }
    }
    await clearOutbox([e]);
  }

  private async pushRecords(entries: OutboxEntry[]): Promise<void> {
    const rows: Record<string, unknown>[] = [];
    for (const e of entries) {
      const data = e.deleted ? undefined : await readSyncRecord(e.store as SyncStore, e.recordId);
      rows.push({ store: e.store, id: e.recordId, data: data ?? {}, rev: e.rev, deleted_at: e.deleted || !data ? e.updatedAt || Date.now() : null });
    }
    await this.call('records-upsert', { records: rows });
    await clearOutbox(entries);
  }

  /** Änderungen anderer Geräte seit dem letzten Stand übernehmen */
  async pull(): Promise<void> {
    let cursor = (await getMeta<Cursor>(CURSOR)) ?? { at: '', id: '' };
    const touchedProjects = new Set<string>();
    let changed = false;
    for (;;) {
      const { records } = await this.call<{ records: RemoteRow[] }>('records-pull', { since: cursor.at || null, after: cursor.id });
      if (!records.length) break;
      const pending = new Set((await listOutbox()).map((e) => e.id));
      for (const row of records) {
        if (pending.has(`${row.store}:${row.id}`)) continue; // lokale Änderung wartet noch – sie gewinnt
        await this.applyRow(row);
        changed = true;
        if (PROJECT_STORES.includes(row.store)) touchedProjects.add(row.store === 'projects' ? row.id : String(row.data.projectId ?? ''));
      }
      const last = records[records.length - 1];
      cursor = { at: last.updated_at, id: last.id };
      await setMeta(CURSOR, cursor);
      if (records.length < PAGE) break;
    }
    setState({ status: 'ready', message: null, lastSyncAt: Date.now() });
    if (!changed) return;
    const open = getState().projectId;
    if (open && touchedProjects.has(open)) {
      if (hasUnsavedChanges()) {
        // nicht mitten in eine Eingabe hinein neu laden – nach der nächsten Speicherung
        if (!this.reloadPending) {
          this.reloadPending = true;
          setTimeout(() => {
            this.reloadPending = false;
            void this.pull().catch(() => {});
          }, 3000);
        }
      } else await reloadProject();
    }
    notifyDataChanged();
  }

  private async applyRow(row: RemoteRow): Promise<void> {
    if (row.deleted_at) {
      if (row.store === 'projects') await deleteProjectCompletely(row.id, { tombstone: false });
      else if (row.store === 'defectPlans') await deleteDefectPlanCompletely(row.id, { tombstone: false });
      else if (row.store !== 'meta') await applyRemoteRecord(row.store, row.id, null);
      return;
    }
    await applyRemoteRecord(row.store, row.id, row.data);
  }

  /** fehlende Datei aus der Ablage holen und auf dem Gerät behalten */
  async fetchFile(store: SyncFileStore, id: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    try {
      const defs = FILE_PARTS[store];
      const { urls } = await this.call<{ urls: Record<string, string> }>('presign', { items: defs.map((p) => ({ key: fileKey(id, p.name), method: 'GET' })) });
      const parts: Record<string, ArrayBuffer> = {};
      for (const p of defs) {
        const r = await fetch(urls[`GET ${fileKey(id, p.name)}`]);
        if (!r.ok) {
          if (p.optional) continue;
          return false;
        }
        parts[p.name] = await r.arrayBuffer();
      }
      await writeSyncFile(store, id, parts);
      return true;
    } catch {
      return false;
    }
  }
}

let active: DataSync | null = null;

/** Abgleich anbinden (ruft photo-cloud.ts, sobald die Ablage für den Arbeitsbereich steht) */
export async function connectDataSync(companyId: string, fetchFn?: FetchLike): Promise<void> {
  if (active?.companyId === companyId) return;
  disconnectDataSync();
  const s = new DataSync(companyId, fetchFn);
  active = s;
  s.start();
  await s.adoptLocal();
  setState({ status: 'ready', message: null, pending: (await listOutbox()).length });
  void s.sync().catch(() => {});
}

export function disconnectDataSync() {
  if (active) {
    active.stop();
    active = null;
  }
  setState({ status: 'off', pending: 0, busy: false, message: null });
}

/** „Jetzt abgleichen“ (Konto) */
export async function syncData(): Promise<void> {
  if (!active) return;
  await active.sync();
}
