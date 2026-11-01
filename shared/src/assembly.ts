/**
 * Kit assembly: turns a drive centreline network into a list of placements of reusable
 * tunnel modules. Pure maths, no rendering. The renderer instantiates the referenced
 * geometry (imported GLB modules or the built-in parametric pieces) with GPU instancing.
 *
 * Output coordinates are three.js local coordinates:
 *   x = Easting - origin.E,   y = RL - origin.RL,   z = -(Northing - origin.N)
 * A direction (dx, dz) has heading angle ang = atan2(-dz, dx); a rotation about Y by
 * `ang` maps the asset's +X (forward) axis onto that direction.
 */
import type { AssetConnector, AssetMeta, KitSlot, PlanNetwork, Side, Stope, TunnelProfile, Vec2, Vec3 } from './types';
import { dist, polylineLength, slicePolyline } from './geometry';
import { fitSimilarity, pxToWorld, scaleOf, type Similarity } from './georef';
import type { GeoRef } from './types';

export const BUILTIN_STRAIGHT_LENGTH = 4; // m, length of one built-in straight module

export interface LevelInput {
  planId: string;
  levelRL: number;
  georef: GeoRef;
  network: PlanNetwork;
}

export interface KitAsset {
  id: string;
  slot: KitSlot;
  meta: AssetMeta;
}

export interface ResolvedKit {
  straight?: KitAsset;
  deadEnd?: KitAsset;
  /** Junction-like pieces (T, X, 90° bends) matched by connector directions. */
  connectors: KitAsset[];
  decorations: { id: string; meta: AssetMeta; spacingM: number }[];
  angleToleranceDeg: number;
}

export const emptyKit = (): ResolvedKit => ({ connectors: [], decorations: [], angleToleranceDeg: 20 });

export interface Piece {
  source: 'builtin-straight' | 'builtin-cap' | 'asset';
  assetId?: string;
  slot?: KitSlot | 'decoration';
  position: Vec3;
  rotationY: number;
  scale: Vec3;
}

export interface HubBranch {
  /** Unit direction in the xz plane pointing from the hub centre into the drive. */
  dir: [number, number];
  width: number;
  trim: number;
}

/** Parametric connector generated for junctions/bends that no kit asset matches. */
export interface Hub {
  id: string;
  center: Vec3;
  branches: HubBranch[];
}

export interface StopeVolume {
  id: string;
  polygon: [number, number][]; // xz
  yBase: number;
  height: number;
  label?: string;
}

export interface CollisionSegment {
  a: [number, number];
  b: [number, number];
  r: number;
  y: number;
}

export interface Assembly {
  origin: { E: number; N: number; RL: number };
  pieces: Piece[];
  hubs: Hub[];
  stopes: StopeVolume[];
  collision: CollisionSegment[];
  spawn: { position: Vec3; dir: [number, number] } | null;
  bounds: { min: Vec3; max: Vec3 };
  stats: {
    drives: number;
    lengthM: number;
    straightModules: number;
    assetJunctions: number;
    parametricConnectors: number;
    deadEnds: number;
    decorations: number;
  };
}

export interface AssemblyOptions {
  /** Turns below this angle are treated as a continuous drive (mitred straights). */
  continuousTurnDeg: number;
  /** Polyline vertices turning more than this become bend connectors. */
  splitTurnDeg: number;
}

export const defaultAssemblyOptions = (): AssemblyOptions => ({ continuousTurnDeg: 12, splitTurnDeg: 30 });

// ---------------------------------------------------------------------------

type XZ = [number, number];

const heading = (d: XZ) => Math.atan2(-d[1], d[0]);
const unit = (d: XZ): XZ => {
  const l = Math.hypot(d[0], d[1]);
  return l > 1e-12 ? [d[0] / l, d[1] / l] : [1, 0];
};
const rotateXZ = (v: XZ, th: number): XZ => [v[0] * Math.cos(th) + v[1] * Math.sin(th), -v[0] * Math.sin(th) + v[1] * Math.cos(th)];
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export function sideDir(side: Side): XZ {
  switch (side) {
    case '+X': return [1, 0];
    case '-X': return [-1, 0];
    case '+Z': return [0, 1];
    case '-Z': return [0, -1];
  }
}

/**
 * Find a rotation about Y that maps every asset connector onto a distinct branch direction.
 * Returns the rotation and, for each connector, the index of the branch it serves.
 */
export function matchConnectors(conns: AssetConnector[], branches: XZ[], tolRad: number): { theta: number; assign: number[]; err: number } | null {
  if (conns.length !== branches.length || conns.length === 0) return null;
  let best: { theta: number; assign: number[]; err: number } | null = null;
  const c0 = sideDir(conns[0].side);
  for (let j = 0; j < branches.length; j++) {
    const theta = heading(branches[j]) - heading(c0);
    const used = new Set<number>();
    const assign: number[] = [];
    let err = 0;
    let ok = true;
    for (const c of conns) {
      const h = heading(rotateXZ(sideDir(c.side), theta));
      let bi = -1, bd = Infinity;
      for (let k = 0; k < branches.length; k++) {
        if (used.has(k)) continue;
        const d = Math.abs(wrapPi(heading(branches[k]) - h));
        if (d < bd) { bd = d; bi = k; }
      }
      if (bi < 0 || bd > tolRad) { ok = false; break; }
      used.add(bi);
      assign.push(bi);
      err = Math.max(err, bd);
    }
    if (ok && (!best || err < best.err)) best = { theta, assign, err };
  }
  return best;
}

interface WEdge {
  id: string;
  a: string;
  b: string;
  pts: XZ[];
  width: number;
  y: number;
}

interface EndInfo {
  trim: number;
  ext: number;
}

/** Convert plan networks (pixels) to local xz drive edges. */
function buildEdges(levels: LevelInput[], profile: TunnelProfile, origin: { E: number; N: number; RL: number }) {
  const edges: WEdge[] = [];
  const stopes: StopeVolume[] = [];
  const nodePos = new Map<string, XZ>();
  const nodeY = new Map<string, number>();
  for (const lv of levels) {
    const sim: Similarity = fitSimilarity(lv.georef);
    const mpp = scaleOf(sim);
    const y = lv.levelRL - origin.RL;
    const toLocal = (p: Vec2): XZ => {
      const w = pxToWorld(sim, p);
      return [w[0] - origin.E, -(w[1] - origin.N)];
    };
    const nid = (id: string) => `${lv.planId}:${id}`;
    for (const n of lv.network.nodes) {
      nodePos.set(nid(n.id), toLocal([n.x, n.y]));
      nodeY.set(nid(n.id), y);
    }
    for (const e of lv.network.edges) {
      if (e.points.length < 2) continue;
      const width = profile.useDetectedWidths && e.widthPx ? Math.max(2, e.widthPx * mpp) : profile.width;
      const pts = e.points.map(toLocal);
      // pin end points to node positions
      const pa = nodePos.get(nid(e.a));
      const pb = nodePos.get(nid(e.b));
      if (pa) pts[0] = pa;
      if (pb) pts[pts.length - 1] = pb;
      edges.push({ id: `${lv.planId}:${e.id}`, a: nid(e.a), b: nid(e.b), pts, width, y });
    }
    for (const s of lv.network.stopes as Stope[]) {
      if (s.polygon.length < 3) continue;
      stopes.push({
        id: `${lv.planId}:${s.id}`,
        polygon: s.polygon.map(toLocal),
        yBase: y + (s.baseOffsetM ?? 0),
        height: s.heightM,
        label: s.label,
      });
    }
  }
  return { edges, stopes, nodePos, nodeY };
}

function turnAngle(prev: XZ, cur: XZ, next: XZ): number {
  const d1 = unit([cur[0] - prev[0], cur[1] - prev[1]]);
  const d2 = unit([next[0] - cur[0], next[1] - cur[1]]);
  return Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
}

/** Split edges at sharp interior vertices so that each edge is nearly straight. */
function splitSharpVertices(edges: WEdge[], nodePos: Map<string, XZ>, nodeY: Map<string, number>, splitRad: number): WEdge[] {
  const out: WEdge[] = [];
  for (const e of edges) {
    let start = 0;
    let startNode = e.a;
    let k = 0;
    for (let i = 1; i < e.pts.length - 1; i++) {
      if (turnAngle(e.pts[i - 1], e.pts[i], e.pts[i + 1]) > splitRad) {
        const vid = `${e.id}:v${k++}`;
        nodePos.set(vid, e.pts[i]);
        nodeY.set(vid, e.y);
        out.push({ ...e, id: `${e.id}:${k}`, a: startNode, b: vid, pts: e.pts.slice(start, i + 1) });
        start = i;
        startNode = vid;
      }
    }
    out.push({ ...e, id: k ? `${e.id}:${k + 1}` : e.id, a: startNode, b: e.b, pts: e.pts.slice(start) });
  }
  return out;
}

/** Direction leaving a node along an edge end, sampled a short distance in. */
function branchDir(e: WEdge, end: 'a' | 'b'): XZ {
  const pts = end === 'a' ? e.pts : e.pts.slice().reverse();
  const L = polylineLength(pts as Vec2[]);
  const s = Math.min(L * 0.5, Math.max(e.width, 1));
  let acc = 0;
  let target = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++) {
    acc += dist(pts[i - 1] as Vec2, pts[i] as Vec2);
    if (acc >= s) { target = pts[i]; break; }
  }
  return unit([target[0] - pts[0][0], target[1] - pts[0][1]]);
}

export function computeOrigin(levels: LevelInput[]): { E: number; N: number; RL: number } {
  let sx = 0, sy = 0, n = 0, rl = 0;
  for (const lv of levels) {
    const sim = fitSimilarity(lv.georef);
    for (const node of lv.network.nodes) {
      const w = pxToWorld(sim, [node.x, node.y]);
      sx += w[0]; sy += w[1]; n++;
    }
    rl += lv.levelRL;
  }
  return {
    E: n ? Math.round(sx / n) : 0,
    N: n ? Math.round(sy / n) : 0,
    RL: levels.length ? Math.round(rl / levels.length) : 0,
  };
}

export function assemble(levels: LevelInput[], profile: TunnelProfile, kit: ResolvedKit = emptyKit(), opts: AssemblyOptions = defaultAssemblyOptions()): Assembly {
  const origin = computeOrigin(levels);
  const built = buildEdges(levels, profile, origin);
  const { nodePos, nodeY } = built;
  const rawEdges = built.edges;
  const edges = splitSharpVertices(rawEdges, nodePos, nodeY, (opts.splitTurnDeg * Math.PI) / 180);

  const pieces: Piece[] = [];
  const hubs: Hub[] = [];
  const stats = { drives: rawEdges.length, lengthM: 0, straightModules: 0, assetJunctions: 0, parametricConnectors: 0, deadEnds: 0, decorations: 0 };
  const endInfo = new Map<string, EndInfo>(); // key `${edgeId}|a`
  const key = (id: string, end: 'a' | 'b') => `${id}|${end}`;
  const tol = (kit.angleToleranceDeg * Math.PI) / 180;
  const contRad = (opts.continuousTurnDeg * Math.PI) / 180;

  // incident edge ends per node
  const incident = new Map<string, { e: WEdge; end: 'a' | 'b' }[]>();
  for (const e of edges) {
    for (const end of ['a', 'b'] as const) {
      const id = end === 'a' ? e.a : e.b;
      if (!incident.has(id)) incident.set(id, []);
      incident.get(id)!.push({ e, end });
    }
  }

  const fitScale = (meta: AssetMeta, width: number) => (meta.fitToDriveWidth && meta.crossSection.width > 0 ? width / meta.crossSection.width : 1);

  for (const [nodeId, inc] of incident) {
    const c = nodePos.get(nodeId);
    if (!c) continue;
    const y = nodeY.get(nodeId) ?? 0;
    const dirs = inc.map((i) => branchDir(i.e, i.end));
    const wMax = Math.max(...inc.map((i) => i.e.width));
    const deg = inc.length;

    if (deg === 1) {
      stats.deadEnds++;
      const b = dirs[0];
      if (kit.deadEnd) {
        const s = fitScale(kit.deadEnd.meta, inc[0].e.width);
        const L = kit.deadEnd.meta.dims.length * s;
        endInfo.set(key(inc[0].e.id, inc[0].end), { trim: L, ext: 0 });
        pieces.push({
          source: 'asset', assetId: kit.deadEnd.id, slot: 'deadEnd',
          position: [c[0] + b[0] * L, y, c[1] + b[1] * L],
          rotationY: heading([-b[0], -b[1]]), scale: [s, s, s],
        });
      } else {
        endInfo.set(key(inc[0].e.id, inc[0].end), { trim: 0, ext: 0 });
        pieces.push({ source: 'builtin-cap', position: [c[0], y, c[1]], rotationY: heading(b), scale: [1, 1, inc[0].e.width] });
      }
      continue;
    }

    if (deg === 2) {
      const between = Math.acos(Math.max(-1, Math.min(1, dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1])));
      const turn = Math.PI - between;
      if (turn < contRad) {
        const ext = (wMax / 2) * Math.tan(turn / 2) + 0.05;
        inc.forEach((i) => endInfo.set(key(i.e.id, i.end), { trim: 0, ext }));
        continue;
      }
    }

    // Try kit connector assets (T, X, bends)
    let placed = false;
    for (const ka of kit.connectors) {
      const m = matchConnectors(ka.meta.connectors, dirs, tol);
      if (!m) continue;
      const s = fitScale(ka.meta, wMax);
      pieces.push({ source: 'asset', assetId: ka.id, slot: ka.slot, position: [c[0], y, c[1]], rotationY: m.theta, scale: [s, s, s] });
      ka.meta.connectors.forEach((conn, ci) => {
        const i = inc[m.assign[ci]];
        endInfo.set(key(i.e.id, i.end), { trim: conn.distance * s, ext: 0 });
      });
      stats.assetJunctions++;
      placed = true;
      break;
    }
    if (placed) continue;

    // Parametric connector (hub) sized so that neighbouring openings do not overlap.
    const order = dirs.map((d, i) => ({ i, h: heading(d) })).sort((p, q) => p.h - q.h);
    let R = deg >= 3 ? wMax * 0.5 : 0.05;
    for (let k = 0; k < order.length; k++) {
      const h1 = order[k].h;
      const h2 = k + 1 < order.length ? order[k + 1].h : order[0].h + 2 * Math.PI;
      const gap = h2 - h1;
      if (gap < Math.PI - 1e-6 && gap > 1e-3) R = Math.max(R, (wMax / 2) / Math.tan(gap / 2) + 0.15 * wMax);
    }
    // Keep connectors compact: acute junctions would otherwise grow very large, and short
    // drives between two junctions must keep some straight length.
    const shortest = Math.min(...inc.map((i) => polylineLength(i.e.pts as Vec2[])));
    R = Math.min(R, wMax * 1.5, Math.max(wMax * 0.5, shortest * 0.45));
    hubs.push({
      id: nodeId,
      center: [c[0], y, c[1]],
      branches: inc.map((i, k) => ({ dir: dirs[k], width: i.e.width, trim: R })),
    });
    inc.forEach((i) => endInfo.set(key(i.e.id, i.end), { trim: R, ext: 0 }));
    stats.parametricConnectors++;
  }

  // Straight modules along each (trimmed) edge
  for (const e of edges) {
    const L = polylineLength(e.pts as Vec2[]);
    stats.lengthM += L;
    const ia = endInfo.get(key(e.id, 'a')) ?? { trim: 0, ext: 0 };
    const ib = endInfo.get(key(e.id, 'b')) ?? { trim: 0, ext: 0 };
    if (ia.trim + ib.trim >= L - 0.05) continue;
    const pts = slicePolyline(e.pts as Vec2[], ia.trim, L - ib.trim) as XZ[];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const d = unit([q[0] - p[0], q[1] - p[1]]);
      // mitre overlap at interior vertices and at continuous nodes
      const extStart = i === 1 ? ia.ext : (e.width / 2) * Math.tan(turnAngle(pts[i - 2], p, q) / 2) + 0.05;
      const extEnd = i === pts.length - 1 ? ib.ext : (e.width / 2) * Math.tan(turnAngle(p, q, pts[i + 1]) / 2) + 0.05;
      const start: XZ = [p[0] - d[0] * extStart, p[1] - d[1] * extStart];
      const segLen = dist(p as Vec2, q as Vec2) + extStart + extEnd;
      if (segLen < 0.05) continue;
      const rot = heading(d);
      if (kit.straight) {
        const s = fitScale(kit.straight.meta, e.width);
        const Lm = Math.max(0.1, kit.straight.meta.dims.length * s);
        const n = Math.max(1, Math.round(segLen / Lm));
        const stretch = segLen / (n * Lm);
        for (let j = 0; j < n; j++) {
          const t = (j * segLen) / n;
          pieces.push({
            source: 'asset', assetId: kit.straight.id, slot: 'straight',
            position: [start[0] + d[0] * t, e.y, start[1] + d[1] * t], rotationY: rot, scale: [s * stretch, s, s],
          });
        }
        stats.straightModules += n;
      } else {
        const n = Math.max(1, Math.round(segLen / BUILTIN_STRAIGHT_LENGTH));
        for (let j = 0; j < n; j++) {
          const t = (j * segLen) / n;
          pieces.push({
            source: 'builtin-straight',
            position: [start[0] + d[0] * t, e.y, start[1] + d[1] * t], rotationY: rot, scale: [segLen / n, 1, e.width],
          });
        }
        stats.straightModules += n;
      }
      for (const dec of kit.decorations) {
        if (!(dec.spacingM > 0)) continue;
        const s = fitScale(dec.meta, e.width);
        for (let t = dec.spacingM / 2; t < segLen; t += dec.spacingM) {
          pieces.push({
            source: 'asset', assetId: dec.id, slot: 'decoration',
            position: [start[0] + d[0] * t, e.y, start[1] + d[1] * t], rotationY: rot, scale: [s, s, s],
          });
          stats.decorations++;
        }
      }
    }
  }

  // collision capsules along the untrimmed centrelines
  const collision: CollisionSegment[] = [];
  for (const e of edges) {
    for (let i = 1; i < e.pts.length; i++) collision.push({ a: e.pts[i - 1], b: e.pts[i], r: e.width / 2, y: e.y });
  }

  // spawn at a dead end if possible, looking into the drive
  let spawn: Assembly['spawn'] = null;
  const deadEnd = [...incident.entries()].find(([, inc]) => inc.length === 1);
  const spawnEntry = deadEnd ?? [...incident.entries()][0];
  if (spawnEntry) {
    const [id, inc] = spawnEntry;
    const c = nodePos.get(id)!;
    const d = branchDir(inc[0].e, inc[0].end);
    const off = Math.min(inc[0].e.width, polylineLength(inc[0].e.pts as Vec2[]) * 0.3);
    spawn = { position: [c[0] + d[0] * off, (nodeY.get(id) ?? 0), c[1] + d[1] * off], dir: d };
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, z: number) => {
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  };
  const H = profile.wallHeight + profile.archRise;
  for (const e of edges) for (const p of e.pts) { grow(p[0], e.y, p[1]); grow(p[0], e.y + H, p[1]); }
  for (const s of built.stopes) for (const p of s.polygon) { grow(p[0], s.yBase, p[1]); grow(p[0], s.yBase + s.height, p[1]); }
  if (!isFinite(min[0])) { min.fill(0); max.fill(0); }

  return { origin, pieces, hubs, stopes: built.stopes, collision, spawn, bounds: { min, max }, stats };
}

/** Clamp a point (xz) to the union of drive capsules on the nearest level. Used for walk-mode collision. */
export function clampToDrives(p: XZ, y: number, segs: CollisionSegment[], margin: number): XZ {
  let best: XZ = p;
  let bestPen = Infinity;
  for (const s of segs) {
    if (Math.abs(s.y - y) > 3) continue;
    const ab: XZ = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - s.a[0]) * ab[0] + (p[1] - s.a[1]) * ab[1]) / l2)) : 0;
    const q: XZ = [s.a[0] + ab[0] * t, s.a[1] + ab[1] * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    const r = Math.max(0.2, s.r - margin);
    if (d <= r) return p; // inside a drive
    const pen = d - r;
    if (pen < bestPen) {
      bestPen = pen;
      best = [q[0] + ((p[0] - q[0]) / d) * r, q[1] + ((p[1] - q[1]) / d) * r];
    }
  }
  return best;
}
