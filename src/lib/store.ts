import { useRef, useSyncExternalStore } from 'react';
import {
  ConflictError,
  loadProjectData,
  setMeta,
  writeRecords,
  type PendingWrite,
} from './db';
import { getDeviceId, uuid } from './ids';
import type { CostCenter, Damage, EntityMap, EntityStore, Plan, Project, SourceFile } from './types';

/**
 * Zentraler Zustand des geöffneten Projekts mit automatischer Speicherung.
 *
 * Jede Änderung wird sofort im Speicher übernommen (Plan und Tabelle aktualisieren sich
 * unmittelbar) und kurz danach in IndexedDB geschrieben. Der Speicherstatus ist jederzeit
 * sichtbar.
 */

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

export interface ProjectState {
  project: Project;
  costCenters: Record<string, CostCenter>;
  files: Record<string, SourceFile>;
  plans: Record<string, Plan>;
  damages: Record<string, Damage>;
}

interface AppState {
  projectId: string | null;
  data: ProjectState | null;
  loading: boolean;
  loadError: string | null;
  save: { status: SaveStatus; error: string | null; lastSaved: number | null };
}

let state: AppState = {
  projectId: null,
  data: null,
  loading: false,
  loadError: null,
  save: { status: 'saved', error: null, lastSaved: null },
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState(): AppState {
  return state;
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Liest einen Ausschnitt des Zustands; Neuzeichnen nur bei (flacher) Änderung. */
export function useAppState<T>(selector: (s: AppState) => T): T {
  const cache = useRef<{ s: AppState; sel: unknown; v: T } | null>(null);
  const get = () => {
    const c = cache.current;
    if (c && c.s === state && c.sel === selector) return c.v;
    const v = selector(state);
    const stable = c && shallowEqual(c.v, v) ? c.v : v;
    cache.current = { s: state, sel: selector, v: stable };
    return stable;
  };
  return useSyncExternalStore(subscribe, get);
}

// ---------------------------------------------------------------------------
// Speicherwarteschlange

const queue = new Map<string, PendingWrite>();
/** Revision je Datensatz, die zuletzt erfolgreich in der Datenbank stand */
const baseRevs = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let lastEditMarked = 0;

const keyOf = (store: EntityStore, id: string) => `${store}:${id}`;

function setSave(patch: Partial<AppState['save']>) {
  setState({ save: { ...state.save, ...patch } });
}

function scheduleFlush(delay = 250) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
}

/** Schreibt alle ausstehenden Änderungen sofort. */
export async function flush(): Promise<void> {
  if (flushing) {
    await flushing;
    if (queue.size) return flush();
    return;
  }
  if (!queue.size) return;
  if (state.save.status === 'conflict') return;
  const batch = [...queue.values()];
  queue.clear();
  setSave({ status: 'saving' });
  flushing = (async () => {
    try {
      await writeRecords(batch);
      for (const w of batch) baseRevs.set(keyOf(w.store, w.record.id), w.record.rev);
      const projectId = state.projectId;
      if (projectId && Date.now() - lastEditMarked > 2000) {
        lastEditMarked = Date.now();
        await setMeta(`lastEdit:${projectId}`, Date.now());
      }
      setSave({ status: queue.size ? 'pending' : 'saved', error: null, lastSaved: Date.now() });
    } catch (e) {
      // Nicht gespeicherte Änderungen zurück in die Warteschlange (neuere behalten Vorrang)
      for (const w of batch) {
        const k = keyOf(w.store, w.record.id);
        if (!queue.has(k)) queue.set(k, w);
      }
      if (e instanceof ConflictError) {
        setSave({
          status: 'conflict',
          error:
            'Dieses Projekt wurde in einem anderen Fenster oder Tab geändert. Ihre letzten Änderungen wurden nicht ' +
            'überschrieben. Bitte laden Sie die Seite neu, um den aktuellen Stand zu sehen.',
        });
      } else {
        console.error(e);
        setSave({ status: 'error', error: describeStorageError(e) });
        scheduleFlush(3000); // erneuter Versuch
      }
    }
  })();
  await flushing;
  flushing = null;
}

export function hasUnsavedChanges(): boolean {
  return queue.size > 0 || !!flushing;
}

function describeStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') return 'Der Gerätespeicher ist voll. Bitte Speicherplatz freigeben.';
  return `Speichern fehlgeschlagen: ${(e as Error)?.message ?? String(e)}`;
}

if (typeof window !== 'undefined') {
  const flushNow = () => void flush();
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges()) {
      void flush();
      e.preventDefault();
    }
  });
}

// ---------------------------------------------------------------------------
// Laden

export async function openProject(projectId: string): Promise<void> {
  if (state.projectId === projectId && state.data) return;
  await flush();
  setState({ projectId, loading: true, loadError: null, data: null });
  try {
    const data = await loadProjectData(projectId);
    if (state.projectId !== projectId) return;
    if (!data) {
      setState({ loading: false, loadError: 'Projekt nicht gefunden.' });
      return;
    }
    baseRevs.clear();
    const toRecord = <T extends { id: string }>(arr: T[], store: EntityStore) =>
      Object.fromEntries(
        arr.map((x) => {
          baseRevs.set(keyOf(store, x.id), (x as unknown as { rev: number }).rev);
          return [x.id, x];
        }),
      ) as Record<string, T>;
    baseRevs.set(keyOf('projects', data.project.id), data.project.rev);
    setState({
      loading: false,
      data: {
        project: data.project,
        costCenters: toRecord(data.costCenters, 'costCenters'),
        files: toRecord(data.files, 'files'),
        plans: toRecord(data.plans, 'plans'),
        damages: toRecord(data.damages, 'damages'),
      },
      save: { status: 'saved', error: null, lastSaved: null },
    });
  } catch (e) {
    console.error(e);
    setState({ loading: false, loadError: `Projekt konnte nicht geladen werden: ${(e as Error).message}` });
  }
}

export async function closeProject(): Promise<void> {
  await flush();
  setState({ projectId: null, data: null, loadError: null });
}

/** Erzwingt das Neuladen aus der Datenbank (z. B. nach einem Konflikt). */
export async function reloadProject(): Promise<void> {
  const id = state.projectId;
  queue.clear();
  setState({ projectId: null, data: null, save: { status: 'saved', error: null, lastSaved: null } });
  if (id) await openProject(id);
}

// ---------------------------------------------------------------------------
// Änderungen

const collection = {
  costCenters: 'costCenters',
  files: 'files',
  plans: 'plans',
  damages: 'damages',
} as const;

type ChildStore = keyof typeof collection;

export function newMeta() {
  const now = Date.now();
  return { id: uuid(), createdAt: now, updatedAt: now, rev: 0, deviceId: getDeviceId(), deletedAt: null };
}

function bump<T extends { rev: number }>(rec: T): T {
  return { ...rec, rev: rec.rev + 1, updatedAt: Date.now(), deviceId: getDeviceId() };
}

function enqueue<S extends EntityStore>(store: S, record: EntityMap[S]) {
  const k = keyOf(store, record.id);
  queue.set(k, { store, record, baseRev: baseRevs.get(k) ?? 0 });
  if (state.save.status !== 'conflict') setSave({ status: 'pending' });
  scheduleFlush();
}

/** Legt mehrere Datensätze an bzw. aktualisiert sie (Revision wird erhöht). */
export function putRecords(items: { [S in ChildStore]?: EntityMap[S][] }): void {
  const data = state.data;
  if (!data) throw new Error('Kein Projekt geöffnet');
  const next: ProjectState = { ...data };
  for (const store of Object.keys(items) as ChildStore[]) {
    const recs = items[store] as EntityMap[ChildStore][];
    if (!recs?.length) continue;
    const map = { ...(next[store] as Record<string, EntityMap[ChildStore]>) };
    for (const rec of recs) {
      const bumped = bump(rec);
      map[rec.id] = bumped;
      enqueue(store, bumped);
    }
    (next as unknown as Record<string, unknown>)[store] = map;
  }
  setState({ data: next });
}

export function putRecord<S extends ChildStore>(store: S, rec: EntityMap[S]): EntityMap[S] {
  putRecords({ [store]: [rec] } as { [K in ChildStore]?: EntityMap[K][] });
  return state.data![store][rec.id] as EntityMap[S];
}

/** Markiert Datensätze als gelöscht (Grabstein für spätere Synchronisierung). */
export function softDelete(items: { [S in ChildStore]?: EntityMap[S][] }): void {
  const now = Date.now();
  const marked: { [S in ChildStore]?: EntityMap[S][] } = {};
  for (const store of Object.keys(items) as ChildStore[]) {
    (marked as Record<string, unknown[]>)[store] = (items[store] ?? []).map((r) => ({ ...r, deletedAt: now }));
  }
  putRecords(marked);
}

export function updateProject(patch: Partial<Project>): void {
  const data = state.data;
  if (!data) return;
  const project = bump({ ...data.project, ...patch });
  enqueue('projects', project);
  setState({ data: { ...data, project } });
}

/** Für frisch erzeugte Projekte vor dem Öffnen. */
export async function createProjectRecord(fields: Omit<Project, keyof ReturnType<typeof newMeta>>): Promise<Project> {
  const project: Project = { ...newMeta(), ...fields, rev: 1 };
  await writeRecords([{ store: 'projects', record: project, baseRev: 0 }]);
  return project;
}

// ---------------------------------------------------------------------------
// Abfragen

export function alive<T extends { deletedAt: number | null }>(rec: Record<string, T>): T[] {
  return Object.values(rec).filter((x) => !x.deletedAt);
}
