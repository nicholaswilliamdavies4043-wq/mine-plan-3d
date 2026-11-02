/**
 * Three-way merge used to reconcile edits made offline with changes made on the server in the
 * meantime. `base` is the server copy the offline edit started from, `local` is the offline
 * result and `server` is the current server copy.
 *
 *  - A field changed on one side only takes that side's value.
 *  - Arrays of records with an `id` (drive segments, junctions, stopes, items, measurements) are
 *    merged record by record: additions and deletions from both sides are kept, and a record
 *    edited on both sides is merged field by field.
 *  - Plain objects are merged key by key.
 *  - Anything else edited on both sides is a conflict; the offline (local) value wins and the
 *    conflict is reported.
 */
import type { PlanNetwork } from './types';

export interface MergeConflict {
  path: string;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  // missing, undefined and null are treated alike
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (ao[k] === undefined && bo[k] === undefined) continue;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isIdArray = (v: unknown): v is { id: string }[] =>
  Array.isArray(v) && v.every((x) => isRecord(x) && typeof x.id === 'string');

export function merge3<T>(base: T, local: T, server: T, path = '', conflicts: MergeConflict[] = []): T {
  if (deepEqual(local, server)) return local;
  if (deepEqual(server, base)) return local;
  if (deepEqual(local, base)) return server;
  // both sides changed
  const idArrays = (isIdArray(local) || local == null) && (isIdArray(server) || server == null) && (isIdArray(base) || base == null);
  if (idArrays && (Array.isArray(local) || Array.isArray(server))) {
    return mergeById((base ?? []) as { id: string }[], (local ?? []) as { id: string }[], (server ?? []) as { id: string }[], path, conflicts) as T;
  }
  if (isRecord(local) && isRecord(server)) {
    const b: Record<string, unknown> = isRecord(base) ? base : {};
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(server), ...Object.keys(b)])) {
      const v = merge3(b[k], local[k], server[k], path ? `${path}.${k}` : k, conflicts);
      if (v !== undefined) out[k] = v;
    }
    return out as T;
  }
  conflicts.push({ path: path || '(value)' });
  return local;
}

function mergeById(base: { id: string }[], local: { id: string }[], server: { id: string }[], path: string, conflicts: MergeConflict[]) {
  const B = new Map(base.map((x) => [x.id, x]));
  const Lm = new Map(local.map((x) => [x.id, x]));
  const S = new Map(server.map((x) => [x.id, x]));
  const out: { id: string }[] = [];
  for (const s of server) {
    const b = B.get(s.id), l = Lm.get(s.id);
    if (!l) {
      // missing locally: deleted offline (if it existed before) or added on the server
      if (b && deepEqual(b, s)) continue; // deleted offline, untouched on the server
      if (b) { conflicts.push({ path: `${path}[${s.id}] deleted offline but edited on the server` }); continue; }
      out.push(s);
      continue;
    }
    out.push(b ? merge3(b, l, s, `${path}[${s.id}]`, conflicts) : merge3<{ id: string }>({ id: s.id }, l, s, `${path}[${s.id}]`, conflicts));
  }
  for (const l of local) {
    if (S.has(l.id)) continue;
    const b = B.get(l.id);
    if (!b) { out.push(l); continue; } // added offline
    // deleted on the server: keep it only if it was edited offline
    if (!deepEqual(b, l)) { out.push(l); conflicts.push({ path: `${path}[${l.id}] deleted on the server but edited offline (kept)` }); }
  }
  return out;
}

/**
 * After a merge, make sure every drive segment points at existing junctions and its end points sit
 * on them. Junctions referenced by a segment are recovered from `fallback` (usually the offline copy).
 */
export function repairNetwork(net: PlanNetwork, fallback?: PlanNetwork): PlanNetwork {
  const nodes = new Map(net.nodes.map((n) => [n.id, n]));
  const extra = new Map((fallback?.nodes ?? []).map((n) => [n.id, n]));
  const edges = [];
  for (const e of net.edges) {
    for (const id of [e.a, e.b]) if (!nodes.has(id) && extra.has(id)) nodes.set(id, extra.get(id)!);
    const a = nodes.get(e.a), b = nodes.get(e.b);
    if (!a || !b || e.points.length < 2) continue;
    const pts = e.points.slice();
    pts[0] = [a.x, a.y];
    pts[pts.length - 1] = [b.x, b.y];
    edges.push({ ...e, points: pts });
  }
  const used = new Set(edges.flatMap((e) => [e.a, e.b]));
  return { nodes: [...nodes.values()].filter((n) => used.has(n.id)), edges, stopes: net.stopes ?? [] };
}

/**
 * Merge an offline patch onto the current server record. `base` holds the server values of the
 * patched fields at the moment the offline edit started.
 */
export function mergePatch<T extends Record<string, unknown>>(base: Partial<T>, patch: Partial<T>, server: T): { patch: Partial<T>; conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = [];
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    let v = merge3((base as any)[k], (patch as any)[k], (server as any)[k], k, conflicts);
    if (k === 'network' && v && typeof v === 'object') v = repairNetwork(v as PlanNetwork, (patch as any)[k]);
    out[k] = v;
  }
  return { patch: out as Partial<T>, conflicts };
}
