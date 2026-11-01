import { chaikin, polylineLength, simplifyRDP, uid, type PlanNetwork, type Vec2 } from '@mineplan/shared';
import type { Mask } from './raster';
import { NEIGHBOURS } from './skeleton';

const { DX, DY } = NEIGHBOURS;

interface GNode { id: string; x: number; y: number }
interface GEdge { id: string; a: string; b: string; pts: Vec2[]; widths: number[] }
interface Graph { nodes: Map<string, GNode>; edges: Map<string, GEdge> }

/** Trace a 1-px skeleton into a graph of nodes (ends/junctions) and polyline edges. */
export function skeletonToGraph(sk: Mask, dist: Float32Array): Graph {
  const { w, h, d } = sk;
  const count = new Uint8Array(w * h);
  const pixels: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!d[p]) continue;
      let c = 0;
      for (let k = 0; k < 8; k++) c += d[p + DY[k] * w + DX[k]];
      count[p] = c;
      pixels.push(p);
    }

  // cluster node pixels (ends and junctions)
  const nodeOf = new Int32Array(w * h).fill(-1);
  const nodes: GNode[] = [];
  const isNodePx = (p: number) => d[p] === 1 && count[p] !== 2;
  for (const p of pixels) {
    if (!isNodePx(p) || nodeOf[p] !== -1) continue;
    const id = nodes.length;
    const stack = [p];
    nodeOf[p] = id;
    let sx = 0, sy = 0, n = 0;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % w, qy = (q - qx) / w;
      sx += qx; sy += qy; n++;
      for (let k = 0; k < 8; k++) {
        const r = q + DY[k] * w + DX[k];
        if (nodeOf[r] === -1 && isNodePx(r) && count[q] > 2 && count[r] > 2) {
          nodeOf[r] = id;
          stack.push(r);
        }
      }
    }
    nodes.push({ id: 'n' + id, x: sx / n + 0.5, y: sy / n + 0.5 });
  }

  const visited = new Uint8Array(w * h);
  const edges: GEdge[] = [];
  const seenPairs = new Set<string>();
  const px = (p: number): Vec2 => [(p % w) + 0.5, Math.floor(p / w) + 0.5];

  const trace = (startNode: number, startPx: number, first: number) => {
    const pts: Vec2[] = [[nodes[startNode].x, nodes[startNode].y]];
    const widths: number[] = [];
    let prev = startPx;
    let cur = first;
    let endNode = -1;
    for (let guard = 0; guard < w * h; guard++) {
      if (nodeOf[cur] !== -1) { endNode = nodeOf[cur]; break; }
      visited[cur] = 1;
      pts.push(px(cur));
      widths.push(dist[cur]);
      let next = -1;
      // prefer node pixels, then unvisited path pixels
      for (let k = 0; k < 8; k++) {
        const r = cur + DY[k] * w + DX[k];
        if (r === prev || !d[r]) continue;
        if (nodeOf[r] !== -1 && !(nodeOf[r] === startNode && pts.length < 3)) { next = r; break; }
      }
      if (next === -1) {
        for (let k = 0; k < 8; k++) {
          const r = cur + DY[k] * w + DX[k];
          if (r === prev || !d[r] || visited[r] || nodeOf[r] !== -1) continue;
          next = r;
          break;
        }
      }
      if (next === -1) break;
      prev = cur;
      cur = next;
    }
    if (endNode === -1) {
      // dead stop without a node (rare): create an end node at the last pixel
      const last = pts[pts.length - 1];
      endNode = nodes.length;
      nodes.push({ id: 'n' + endNode, x: last[0], y: last[1] });
    }
    pts.push([nodes[endNode].x, nodes[endNode].y]);
    const pair = `${Math.min(startNode, endNode)}-${Math.max(startNode, endNode)}-${pts.length}`;
    if (pts.length === 2 && seenPairs.has(pair)) return;
    seenPairs.add(pair);
    edges.push({ id: 'e' + edges.length, a: 'n' + startNode, b: 'n' + endNode, pts, widths });
  };

  for (const p of pixels) {
    if (nodeOf[p] === -1) continue;
    const nid = nodeOf[p];
    for (let k = 0; k < 8; k++) {
      const r = p + DY[k] * w + DX[k];
      if (!d[r]) continue;
      if (nodeOf[r] === nid) continue;
      if (nodeOf[r] !== -1) {
        // directly adjacent node clusters
        const a = Math.min(nid, nodeOf[r]), b = Math.max(nid, nodeOf[r]);
        const key = `${a}-${b}-2`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          edges.push({ id: 'e' + edges.length, a: 'n' + a, b: 'n' + b, pts: [[nodes[a].x, nodes[a].y], [nodes[b].x, nodes[b].y]], widths: [dist[p]] });
        }
        continue;
      }
      if (visited[r]) continue;
      trace(nid, p, r);
    }
  }
  // closed loops with no node pixels
  for (const p of pixels) {
    if (visited[p] || nodeOf[p] !== -1) continue;
    const id = nodes.length;
    const [x, y] = px(p);
    nodes.push({ id: 'n' + id, x, y });
    nodeOf[p] = id;
    for (let k = 0; k < 8; k++) {
      const r = p + DY[k] * w + DX[k];
      if (d[r] && !visited[r] && nodeOf[r] === -1) { trace(id, p, r); break; }
    }
  }

  const g: Graph = { nodes: new Map(), edges: new Map() };
  for (const n of nodes) g.nodes.set(n.id, n);
  for (const e of edges) g.edges.set(e.id, e);
  return g;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function degrees(g: Graph): Map<string, string[]> {
  const inc = new Map<string, string[]>();
  for (const n of g.nodes.keys()) inc.set(n, []);
  for (const e of g.edges.values()) {
    inc.get(e.a)?.push(e.id);
    inc.get(e.b)?.push(e.id);
  }
  return inc;
}

const edgeLen = (e: GEdge) => polylineLength(e.pts);

function removeEdge(g: Graph, id: string) {
  g.edges.delete(id);
}

function dropIsolatedNodes(g: Graph) {
  const inc = degrees(g);
  for (const [id, list] of inc) if (list.length === 0) g.nodes.delete(id);
}

function mergeDeg2(g: Graph) {
  let changed = true;
  while (changed) {
    changed = false;
    const inc = degrees(g);
    for (const [nid, list] of inc) {
      if (list.length !== 2 || list[0] === list[1]) continue;
      const e1 = g.edges.get(list[0])!, e2 = g.edges.get(list[1])!;
      const p1 = e1.b === nid ? e1.pts : e1.pts.slice().reverse();
      const w1 = e1.b === nid ? e1.widths : e1.widths.slice().reverse();
      const p2 = e2.a === nid ? e2.pts : e2.pts.slice().reverse();
      const w2 = e2.a === nid ? e2.widths : e2.widths.slice().reverse();
      const a = e1.b === nid ? e1.a : e1.b;
      const b = e2.a === nid ? e2.b : e2.a;
      if (a === nid || b === nid) continue;
      g.edges.delete(e1.id);
      g.edges.delete(e2.id);
      g.nodes.delete(nid);
      const id = e1.id + '+';
      g.edges.set(id, { id, a, b, pts: [...p1, ...p2.slice(1)], widths: [...w1, ...w2] });
      changed = true;
      break;
    }
  }
}

function collapseEdge(g: Graph, e: GEdge) {
  const na = g.nodes.get(e.a)!, nb = g.nodes.get(e.b)!;
  na.x = (na.x + nb.x) / 2;
  na.y = (na.y + nb.y) / 2;
  g.edges.delete(e.id);
  for (const o of g.edges.values()) {
    if (o.a === e.b) o.a = e.a;
    if (o.b === e.b) o.b = e.a;
    if (o.a === e.a) o.pts[0] = [na.x, na.y];
    if (o.b === e.a) o.pts[o.pts.length - 1] = [na.x, na.y];
  }
  g.nodes.delete(e.b);
}

export interface CleanupOptions {
  driveWidth: number;
  spurLength: number;
  mergeDistance: number;
  minComponentLength: number;
  minMeanHalfWidth: number;
  simplifyTolerance: number;
}

export function cleanupGraph(g: Graph, o: CleanupOptions): void {
  for (let iter = 0; iter < 6; iter++) {
    let changed = false;
    const inc = degrees(g);
    // spurs
    for (const e of [...g.edges.values()]) {
      const da = inc.get(e.a)?.length ?? 0, db = inc.get(e.b)?.length ?? 0;
      const L = edgeLen(e);
      const spur = (da === 1 && db >= 3) || (db === 1 && da >= 3);
      if (spur && L < o.spurLength) { removeEdge(g, e.id); changed = true; }
    }
    // self loops that are tiny
    for (const e of [...g.edges.values()]) {
      if (e.a === e.b && edgeLen(e) < o.driveWidth * 4) { removeEdge(g, e.id); changed = true; }
    }
    dropIsolatedNodes(g);
    mergeDeg2(g);
    // collapse very short edges between junctions
    for (const e of [...g.edges.values()]) {
      if (!g.edges.has(e.id) || e.a === e.b) continue;
      if (edgeLen(e) < o.mergeDistance) {
        const d2 = degrees(g);
        if ((d2.get(e.a)?.length ?? 0) >= 2 && (d2.get(e.b)?.length ?? 0) >= 2) { collapseEdge(g, e); changed = true; }
      }
    }
    // parallel duplicate edges between the same nodes: keep the longest... no, keep shortest
    const pairs = new Map<string, GEdge>();
    for (const e of [...g.edges.values()]) {
      if (e.a === e.b) continue;
      const k = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
      const prev = pairs.get(k);
      if (prev && Math.abs(edgeLen(prev) - edgeLen(e)) < o.driveWidth * 1.5) {
        removeEdge(g, edgeLen(prev) > edgeLen(e) ? prev.id : e.id);
        if (edgeLen(prev) > edgeLen(e)) pairs.set(k, e);
        changed = true;
      } else if (!prev) pairs.set(k, e);
    }
    dropIsolatedNodes(g);
    mergeDeg2(g);
    if (!changed) break;
  }
  // slivers: edges that are much narrower than a drive
  for (const e of [...g.edges.values()]) {
    const mean = e.widths.length ? e.widths.reduce((s, v) => s + v, 0) / e.widths.length : o.driveWidth / 2;
    if (mean < o.minMeanHalfWidth) removeEdge(g, e.id);
  }
  dropIsolatedNodes(g);
  mergeDeg2(g);
  // small isolated components
  const inc = degrees(g);
  const seen = new Set<string>();
  for (const start of g.nodes.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const edgesInComp = new Set<string>();
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const eid of inc.get(n) ?? []) {
        const e = g.edges.get(eid);
        if (!e) continue;
        edgesInComp.add(eid);
        const o2 = e.a === n ? e.b : e.a;
        if (!seen.has(o2)) { seen.add(o2); stack.push(o2); }
      }
    }
    let total = 0;
    for (const eid of edgesInComp) total += edgeLen(g.edges.get(eid)!);
    if (total < o.minComponentLength) {
      for (const eid of edgesInComp) g.edges.delete(eid);
      for (const n of comp) g.nodes.delete(n);
    }
  }
}

export function graphToNetwork(g: Graph, simplifyTol: number): PlanNetwork {
  const idMap = new Map<string, string>();
  const nodes = [...g.nodes.values()].map((n) => {
    const id = uid('n');
    idMap.set(n.id, id);
    return { id, x: round(n.x), y: round(n.y) };
  });
  const edges = [...g.edges.values()].map((e) => {
    const sorted = e.widths.slice().sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const smooth = chaikin(e.pts, 1);
    const pts = simplifyRDP(smooth, simplifyTol).map((p) => [round(p[0]), round(p[1])] as Vec2);
    const a = g.nodes.get(e.a)!, b = g.nodes.get(e.b)!;
    pts[0] = [round(a.x), round(a.y)];
    pts[pts.length - 1] = [round(b.x), round(b.y)];
    return { id: uid('e'), a: idMap.get(e.a)!, b: idMap.get(e.b)!, points: pts, widthPx: round(median * 2) };
  });
  return { nodes, edges, stopes: [] };
}

const round = (v: number) => Math.round(v * 10) / 10;

export type { Graph };
