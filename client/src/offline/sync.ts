/**
 * Offline support for the API.
 *
 *  - Every successful GET is kept in IndexedDB, so pages that were opened once still load offline.
 *  - Changes made while the server cannot be reached are queued on the device (plan edits,
 *    project settings, placed items, measurements, kits, new projects and plan uploads, deletes)
 *    and shown straight away.
 *  - When the server is reachable again the queue is replayed in order. Each queued edit is merged
 *    with the server's current copy (three-way merge in @mineplan/shared), so edits made by others
 *    in the meantime are kept.
 *
 * The plan images and 3D asset files are cached by the service worker (public/sw.js).
 */
import { mergePatch, type Kit, type MergeConflict, type Plan, type Project } from '@mineplan/shared';
import { idbDelete, idbEntries, idbGet, idbSet } from './idb';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

/** The request never reached a working server (no network, server down, or database down). */
export class NetworkError extends Error {}

export type Entity = 'plan' | 'project' | 'kit';

export type QueuedOp =
  | { id: string; at: string; type: 'createProject'; project: Project }
  | { id: string; at: string; type: 'uploadPlan'; plan: Plan; fileName: string; fileType: string }
  | { id: string; at: string; type: 'patch'; entity: Entity; target: string; label?: string; patch: Record<string, unknown>; base: Record<string, unknown> }
  | { id: string; at: string; type: 'delete'; entity: 'plan' | 'project'; target: string };

export interface SyncState {
  /** The server answered the last request or probe. */
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Messages from the last sync about conflicts or discarded changes. */
  notes: string[];
}

const OFFLINE_MSG = 'You are offline and this page has not been opened on this device before. It will load when the connection is back.';

// ------------------------------------------------------------------------------- state

let state: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false, pending: 0, lastSyncAt: null, lastError: null, notes: [],
};
const listeners = new Set<(s: SyncState) => void>();
const emit = () => { for (const l of listeners) l(state); };
const setState = (p: Partial<SyncState>) => { state = { ...state, ...p }; emit(); };

export const getSyncState = () => state;
export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

let cache = new Map<string, unknown>(); // raw server responses by API path
let queue: QueuedOp[] = [];
const fileUrls = new Map<string, string>(); // plan id -> object URL of a plan image waiting to upload

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mineplan-sync') : null;

async function loadQueue() {
  queue = (await idbGet<QueuedOp[]>('kv', 'queue')) ?? [];
  setState({ pending: queue.length });
}
async function saveQueue() {
  await idbSet('kv', 'queue', queue);
  setState({ pending: queue.length });
  channel?.postMessage({ type: 'queue' });
}

const ready: Promise<void> = (async () => {
  try {
    const entries = await idbEntries<unknown>('kv', 'cache:');
    cache = new Map(entries.map(([k, v]) => [k.slice(6), v]));
    await loadQueue();
    for (const op of queue) if (op.type === 'uploadPlan') await restoreFileUrl(op.plan.id);
  } catch { /* storage unavailable: memory only */ }
})();

channel?.addEventListener('message', (e) => {
  if (e.data?.type === 'queue') loadQueue();
  if (e.data?.type === 'synced') window.dispatchEvent(new CustomEvent('mineplan:synced', { detail: e.data.detail }));
});

async function restoreFileUrl(planId: string) {
  const blob = await idbGet<Blob>('files', planId);
  if (blob && !fileUrls.has(planId)) fileUrls.set(planId, URL.createObjectURL(blob));
}

function putCache(path: string, data: unknown) {
  cache.set(path, data);
  idbSet('kv', 'cache:' + path, data);
}
function dropCache(path: string) {
  cache.delete(path);
  idbDelete('kv', 'cache:' + path);
}

/** Serialise queue changes across tabs. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as any).locks;
  if (locks?.request) return locks.request('mineplan-queue', fn);
  return fn();
}

// ------------------------------------------------------------------------------- network

async function network<T>(method: string, path: string, body?: unknown, timeoutMs = method === 'GET' ? 20000 : 0): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const ctl = timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  if (ctl) init.signal = ctl.signal;
  let r: Response;
  try {
    r = await fetch('/api' + path, init);
  } catch {
    throw new NetworkError('No connection to the server');
  } finally {
    if (timer) clearTimeout(timer);
  }
  // 502-504: the host or the database is down; treat like being offline
  if (r.status === 502 || r.status === 503 || r.status === 504) throw new NetworkError(`Server unavailable (${r.status})`);
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (data as any).error ?? r.statusText, (data as any).details);
  return data as T;
}

function markOnline(online: boolean) {
  if (state.online !== online) setState({ online });
  if (online) { stopProbe(); if (queue.length) scheduleSync(); }
  else startProbe();
}

let probeTimer: number | null = null;
function startProbe() {
  if (probeTimer != null || typeof window === 'undefined') return;
  probeTimer = window.setInterval(probe, 10000);
}
function stopProbe() {
  if (probeTimer != null) { clearInterval(probeTimer); probeTimer = null; }
}
async function probe() {
  try {
    await network('GET', '/health', undefined, 5000);
    markOnline(true);
  } catch { /* still offline */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => probe());
  window.addEventListener('offline', () => markOnline(false));
  if (!state.online) startProbe();
  // retry anything left from a previous session once the page has loaded
  ready.then(() => { if (queue.length) probe(); });
}

// ------------------------------------------------------------------------------- overlays

const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));

function summaryOf(p: Project) {
  return { ...p, planCount: 0, lengthM: 0, stopes: 0, junctions: 0, itemCount: {}, levels: [], preview: null, offline: true };
}

/** Apply queued (not yet synced) changes to a server response, so pages show them. */
function overlay(path: string, raw: unknown): unknown {
  let data = clone(raw) as any;
  for (const op of queue) {
    if (op.type === 'createProject') {
      if (path === '/projects') {
        data = data ?? [];
        if (!data.some((p: any) => p.id === op.project.id)) data.push(summaryOf(op.project));
      } else if (path === `/projects/${op.project.id}` && data === undefined) data = { ...op.project, plans: [] };
    } else if (op.type === 'uploadPlan') {
      if (path === `/projects/${op.plan.projectId}` && data && !data.plans.some((p: any) => p.id === op.plan.id)) data.plans.push(clone(op.plan));
      else if (path === `/plans/${op.plan.id}` && data === undefined) data = clone(op.plan);
      else if (path === '/projects' && Array.isArray(data)) {
        const s = data.find((p: any) => p.id === op.plan.projectId);
        if (s) { s.planCount = (s.planCount ?? 0) + 1; s.levels = [...(s.levels ?? []), op.plan.levelRL]; }
      }
    } else if (op.type === 'patch') {
      if (op.entity === 'plan') {
        if (path === `/plans/${op.target}` && data) data = { ...data, ...clone(op.patch) };
        else if (path.startsWith('/projects/') && data?.plans) data.plans = data.plans.map((p: any) => (p.id === op.target ? { ...p, ...clone(op.patch) } : p));
      } else if (op.entity === 'project') {
        if (path === `/projects/${op.target}` && data) data = { ...data, ...clone(op.patch) };
        else if (path === '/projects' && Array.isArray(data)) data = data.map((p: any) => (p.id === op.target ? { ...p, ...clone(op.patch) } : p));
      } else if (op.entity === 'kit' && path === '/kits' && Array.isArray(data)) {
        data = data.map((k: any) => (k.id === op.target ? { ...k, ...clone(op.patch) } : k));
      }
    } else if (op.type === 'delete') {
      if (op.entity === 'plan') {
        if (path === `/plans/${op.target}`) data = null;
        else if (path.startsWith('/projects/') && data?.plans) data.plans = data.plans.filter((p: any) => p.id !== op.target);
      } else {
        if (path === `/projects/${op.target}`) data = null;
        else if (path === '/projects' && Array.isArray(data)) data = data.filter((p: any) => p.id !== op.target);
      }
    }
  }
  return data;
}

/** Find a raw plan in the cache (its own entry, or inside a cached project). */
function rawPlan(id: string): Plan | undefined {
  const own = cache.get(`/plans/${id}`) as Plan | undefined;
  if (own) return own;
  for (const [k, v] of cache) if (k.startsWith('/projects/') && (v as any)?.plans) {
    const p = (v as any).plans.find((x: Plan) => x.id === id);
    if (p) return p;
  }
  return undefined;
}

/** Server copy of a record before any queued change, used as the merge base. */
function rawRecord(entity: Entity, id: string): Record<string, unknown> | undefined {
  // records created on this device: their base is the record as it will be created
  for (const op of queue) {
    if (op.type === 'createProject' && entity === 'project' && op.project.id === id) return op.project as any;
    if (op.type === 'uploadPlan' && entity === 'plan' && op.plan.id === id) return op.plan as any;
  }
  if (entity === 'plan') return rawPlan(id) as any;
  if (entity === 'project') {
    const d = cache.get(`/projects/${id}`) as any;
    if (d) { const { plans: _p, ...rest } = d; return rest; }
    return (cache.get('/projects') as any[] | undefined)?.find((p) => p.id === id);
  }
  return (cache.get('/kits') as Kit[] | undefined)?.find((k) => k.id === id) as any;
}

/** Fold a fresh server record into every cached response that contains it. */
function updateCaches(entity: Entity, rec: any) {
  if (!rec?.id) return;
  if (entity === 'plan') {
    putCache(`/plans/${rec.id}`, rec);
    const pk = `/projects/${rec.projectId}`;
    const d = cache.get(pk) as any;
    if (d?.plans) putCache(pk, { ...d, plans: d.plans.some((p: any) => p.id === rec.id) ? d.plans.map((p: any) => (p.id === rec.id ? rec : p)) : [...d.plans, rec] });
  } else if (entity === 'project') {
    const pk = `/projects/${rec.id}`;
    const d = cache.get(pk) as any;
    putCache(pk, { ...(d ?? { plans: [] }), ...rec });
    const list = cache.get('/projects') as any[] | undefined;
    if (list) putCache('/projects', list.some((p) => p.id === rec.id) ? list.map((p) => (p.id === rec.id ? { ...p, ...rec } : p)) : [...list, summaryOf(rec)]);
  } else {
    const list = cache.get('/kits') as Kit[] | undefined;
    if (list) putCache('/kits', list.map((k) => (k.id === rec.id ? rec : k)));
  }
}

// ------------------------------------------------------------------------------- public API

/** GET through the cache: fresh from the server when it answers, otherwise the last copy kept on this device. */
export async function cachedGet<T>(path: string): Promise<T> {
  await ready;
  if (state.online || (typeof navigator !== 'undefined' && navigator.onLine)) {
    try {
      const data = await network<T>('GET', path);
      putCache(path, data);
      markOnline(true);
      const out = overlay(path, data);
      if (out === null) throw new ApiError(404, 'Not found');
      return out as T;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      markOnline(false);
    }
  }
  const out = overlay(path, cache.get(path) ?? (path.startsWith('/plans/') ? rawPlan(path.slice(7)) : undefined));
  if (out === null) throw new ApiError(404, 'Not found');
  if (out === undefined) throw new ApiError(0, OFFLINE_MSG);
  return out as T;
}

/** Plain request without offline fallback (detection, asset import...). */
export async function onlineRequest<T>(method: string, path: string, body?: unknown, offlineMessage?: string): Promise<T> {
  await ready;
  try {
    const r = await network<T>(method, path, body);
    markOnline(true);
    return r;
  } catch (e) {
    if (e instanceof NetworkError) {
      markOnline(false);
      throw new ApiError(0, offlineMessage ?? 'This needs a connection to the server. Try again when you are back online.');
    }
    throw e;
  }
}

const opId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function enqueue(mutate: () => void | Promise<void>) {
  await withLock(async () => {
    queue = (await idbGet<QueuedOp[]>('kv', 'queue')) ?? queue;
    await mutate();
    await saveQueue();
  });
  markOnline(false);
}

/**
 * PATCH a plan, project or kit. Goes straight to the server when possible; otherwise (or while
 * older changes are still waiting) the change is queued and merged when the connection is back.
 */
export async function patchRecord<T>(entity: Entity, id: string, patch: Record<string, unknown>, label?: string): Promise<T> {
  await ready;
  const path = entity === 'plan' ? `/plans/${id}` : entity === 'project' ? `/projects/${id}` : `/kits/${id}`;
  if (!queue.length && state.online) {
    try {
      const rec = await network<T>('PATCH', path, patch);
      updateCaches(entity, rec);
      markOnline(true);
      return rec;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    }
  }
  await enqueue(() => {
    const existing = queue.find((o): o is Extract<QueuedOp, { type: 'patch' }> => o.type === 'patch' && o.entity === entity && o.target === id);
    const raw = rawRecord(entity, id) ?? {};
    if (existing) {
      for (const k of Object.keys(patch)) if (!(k in existing.base)) existing.base[k] = clone(raw[k]);
      existing.patch = { ...existing.patch, ...clone(patch) };
      existing.at = new Date().toISOString();
    } else {
      const base: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) base[k] = clone(raw[k]);
      queue.push({ id: opId(), at: new Date().toISOString(), type: 'patch', entity, target: id, label, patch: clone(patch), base });
    }
  });
  if (entity === 'kit') return { ...(rawRecord('kit', id) ?? {}), ...queue.filter((o) => o.type === 'patch' && o.entity === 'kit' && o.target === id).reduce((a, o: any) => ({ ...a, ...o.patch }), {}) } as T;
  return overlay(entity === 'plan' ? `/plans/${id}` : `/projects/${id}`, entity === 'plan' ? rawPlan(id) : cache.get(`/projects/${id}`)) as T;
}

/** Create a project, offline if needed (the id is made here so later edits can refer to it). */
export async function createProjectRecord(project: Project): Promise<Project> {
  await ready;
  const body = { id: project.id, name: project.name, description: project.description, createdAt: project.createdAt };
  if (!queue.length && state.online) {
    try {
      const rec = await network<Project>('POST', '/projects', body);
      updateCaches('project', rec);
      return rec;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    }
  }
  await enqueue(() => { queue.push({ id: opId(), at: new Date().toISOString(), type: 'createProject', project }); });
  return project;
}

/** Upload a plan image, keeping it on the device until the server can take it. */
export async function uploadPlanRecord(plan: Plan, file: File, form: () => FormData): Promise<Plan> {
  await ready;
  if (!queue.length && state.online) {
    try {
      const rec = await network<Plan>('POST', `/projects/${plan.projectId}/plans`, form());
      updateCaches('plan', rec);
      return rec;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    }
  }
  await idbSet('files', plan.id, file);
  fileUrls.set(plan.id, URL.createObjectURL(file));
  await enqueue(() => { queue.push({ id: opId(), at: new Date().toISOString(), type: 'uploadPlan', plan, fileName: file.name, fileType: file.type }); });
  return plan;
}

/** Delete a plan or project; records that never reached the server are simply dropped. */
export async function deleteRecord(entity: 'plan' | 'project', id: string): Promise<void> {
  await ready;
  const path = entity === 'plan' ? `/plans/${id}` : `/projects/${id}`;
  if (!queue.length && state.online) {
    try {
      await network('DELETE', path);
      dropCache(path);
      return;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
    }
  }
  await enqueue(async () => {
    const created = queue.some((o) => (o.type === 'createProject' && entity === 'project' && o.project.id === id) || (o.type === 'uploadPlan' && entity === 'plan' && o.plan.id === id));
    const planIds = entity === 'project' ? queue.filter((o) => o.type === 'uploadPlan' && o.plan.projectId === id).map((o: any) => o.plan.id as string) : [id];
    queue = queue.filter((o) => {
      if (o.type === 'createProject') return !(entity === 'project' && o.project.id === id);
      if (o.type === 'uploadPlan') return !planIds.includes(o.plan.id) && !(entity === 'project' && o.plan.projectId === id);
      if (o.type === 'patch') return !(o.target === id || (o.entity === 'plan' && planIds.includes(o.target)));
      return true;
    });
    for (const p of planIds) await idbDelete('files', p);
    if (!created) queue.push({ id: opId(), at: new Date().toISOString(), type: 'delete', entity, target: id });
  });
}

/** Object URL of a plan image that is still waiting to upload. */
export const pendingPlanImage = (planId: string) => fileUrls.get(planId);

// ------------------------------------------------------------------------------- sync

let syncTimer: number | null = null;
function scheduleSync(delay = 300) {
  if (syncTimer != null) return;
  syncTimer = window.setTimeout(() => { syncTimer = null; syncNow(); }, delay);
}

let running: Promise<void> | null = null;

/** Replay queued changes. Safe to call at any time; concurrent calls share one run. */
export function syncNow(): Promise<void> {
  if (!running) running = runSync().finally(() => { running = null; });
  return running;
}

async function runSync() {
  await ready;
  if (!queue.length) return;
  setState({ syncing: true, lastError: null });
  const notes: string[] = [];
  let done = 0;
  try {
    await withLock(async () => {
      queue = (await idbGet<QueuedOp[]>('kv', 'queue')) ?? queue;
      while (queue.length) {
        const op = queue[0];
        try {
          await replay(op, notes);
        } catch (e) {
          if (e instanceof NetworkError) throw e;
          // the server rejected the change (validation, missing record): drop it and say so
          notes.push(`${describe(op)} could not be saved: ${(e as Error).message}`);
        }
        queue.shift();
        done++;
        await saveQueue();
      }
    });
    setState({ syncing: false, online: true, lastSyncAt: new Date().toISOString(), notes });
    const detail = { count: done, notes };
    window.dispatchEvent(new CustomEvent('mineplan:synced', { detail }));
    channel?.postMessage({ type: 'synced', detail });
  } catch (e) {
    setState({ syncing: false, lastError: (e as Error).message, notes });
    markOnline(false);
  }
}

function describe(op: QueuedOp): string {
  if (op.type === 'createProject') return `New project "${op.project.name}"`;
  if (op.type === 'uploadPlan') return `Plan "${op.plan.name}"`;
  if (op.type === 'delete') return `Deleting the ${op.entity}`;
  return op.label ? `Changes to ${op.label}` : `Changes to the ${op.entity}`;
}

const conflictText = (c: MergeConflict[]) => c.map((x) => x.path).join(', ');

async function replay(op: QueuedOp, notes: string[]) {
  if (op.type === 'createProject') {
    const rec = await network<Project>('POST', '/projects', { id: op.project.id, name: op.project.name, description: op.project.description, createdAt: op.project.createdAt });
    updateCaches('project', rec);
    return;
  }
  if (op.type === 'uploadPlan') {
    const blob = await idbGet<Blob>('files', op.plan.id);
    if (!blob) throw new ApiError(400, 'the plan image is no longer on this device');
    const fd = new FormData();
    fd.append('image', new File([blob], op.fileName, { type: op.fileType }));
    fd.append('name', op.plan.name);
    fd.append('levelRL', String(op.plan.levelRL));
    fd.append('id', op.plan.id);
    const rec = await network<Plan>('POST', `/projects/${op.plan.projectId}/plans`, fd);
    updateCaches('plan', rec);
    await idbDelete('files', op.plan.id);
    return;
  }
  if (op.type === 'delete') {
    const path = op.entity === 'plan' ? `/plans/${op.target}` : `/projects/${op.target}`;
    try { await network('DELETE', path); } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
    dropCache(path);
    return;
  }
  // patch: merge with the current server copy
  let server: any;
  try {
    if (op.entity === 'kit') {
      server = (await network<Kit[]>('GET', '/kits')).find((k) => k.id === op.target);
      if (!server) throw new ApiError(404, 'Not found');
    } else server = await network('GET', op.entity === 'plan' ? `/plans/${op.target}` : `/projects/${op.target}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notes.push(`${describe(op)} were discarded: it was deleted on the server.`);
      return;
    }
    throw e;
  }
  const { patch, conflicts } = mergePatch(op.base, op.patch, server);
  if (conflicts.length) notes.push(`${describe(op)}: changed on the server and on this device (${conflictText(conflicts)}). Your offline version was kept.`);
  const path = op.entity === 'plan' ? `/plans/${op.target}` : op.entity === 'project' ? `/projects/${op.target}` : `/kits/${op.target}`;
  const rec = await network('PATCH', path, patch);
  updateCaches(op.entity, rec);
}

/** Pending changes, for the data source page. */
export const pendingChanges = () => queue.map((o) => ({ id: o.id, at: o.at, text: describe(o) }));
