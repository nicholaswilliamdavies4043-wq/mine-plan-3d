import type { NetEdge, NetNode, PlanNetwork, Vec2 } from './types';
import { dist, nearestOnPolyline, polylineLength, slicePolyline, uid } from './geometry';

/** Immutable editing helpers for a plan network (image pixel space). */

export function degreeMap(net: PlanNetwork): Map<string, number> {
  const deg = new Map<string, number>();
  for (const n of net.nodes) deg.set(n.id, 0);
  for (const e of net.edges) {
    deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
    deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
  }
  return deg;
}

export function removeOrphanNodes(net: PlanNetwork): PlanNetwork {
  const deg = degreeMap(net);
  return { ...net, nodes: net.nodes.filter((n) => (deg.get(n.id) ?? 0) > 0) };
}

export function deleteEdges(net: PlanNetwork, ids: string[]): PlanNetwork {
  const s = new Set(ids);
  return removeOrphanNodes({ ...net, edges: net.edges.filter((e) => !s.has(e.id)) });
}

export function deleteNode(net: PlanNetwork, id: string): PlanNetwork {
  return removeOrphanNodes({
    ...net,
    nodes: net.nodes.filter((n) => n.id !== id),
    edges: net.edges.filter((e) => e.a !== id && e.b !== id),
  });
}

export function moveNode(net: PlanNetwork, id: string, x: number, y: number): PlanNetwork {
  return {
    ...net,
    nodes: net.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    edges: net.edges.map((e) => {
      if (e.a !== id && e.b !== id) return e;
      const pts = e.points.map((p) => [p[0], p[1]] as Vec2);
      if (e.a === id) pts[0] = [x, y];
      if (e.b === id) pts[pts.length - 1] = [x, y];
      return { ...e, points: pts };
    }),
  };
}

/** Split an edge at the point closest to p. Returns the new network and the new node id. */
export function splitEdge(net: PlanNetwork, edgeId: string, p: Vec2): { net: PlanNetwork; nodeId: string } {
  const e = net.edges.find((x) => x.id === edgeId);
  if (!e) throw new Error('edge not found');
  const L = polylineLength(e.points);
  const hit = nearestOnPolyline(p, e.points);
  const s = Math.max(1e-3, Math.min(L - 1e-3, hit.s));
  const node: NetNode = { id: uid('n'), x: hit.point[0], y: hit.point[1] };
  const p1 = slicePolyline(e.points, 0, s);
  const p2 = slicePolyline(e.points, s, L);
  p1[p1.length - 1] = [node.x, node.y];
  p2[0] = [node.x, node.y];
  const e1: NetEdge = { ...e, id: uid('e'), b: node.id, points: p1 };
  const e2: NetEdge = { ...e, id: uid('e'), a: node.id, points: p2 };
  return {
    net: { ...net, nodes: [...net.nodes, node], edges: [...net.edges.filter((x) => x.id !== edgeId), e1, e2] },
    nodeId: node.id,
  };
}

export interface SnapResult {
  kind: 'node' | 'edge' | 'none';
  id?: string;
  point: Vec2;
}

export function findSnap(net: PlanNetwork, p: Vec2, radius: number): SnapResult {
  let best: SnapResult = { kind: 'none', point: p };
  let bestD = radius;
  for (const n of net.nodes) {
    const d = dist(p, [n.x, n.y]);
    if (d <= bestD) { bestD = d; best = { kind: 'node', id: n.id, point: [n.x, n.y] }; }
  }
  if (best.kind === 'node') return best;
  for (const e of net.edges) {
    const r = nearestOnPolyline(p, e.points);
    if (r.d <= bestD) { bestD = r.d; best = { kind: 'edge', id: e.id, point: r.point }; }
  }
  return best;
}

function resolveEndpoint(net: PlanNetwork, p: Vec2, radius: number): { net: PlanNetwork; nodeId: string; point: Vec2 } {
  const snap = findSnap(net, p, radius);
  if (snap.kind === 'node') return { net, nodeId: snap.id!, point: snap.point };
  if (snap.kind === 'edge') {
    const r = splitEdge(net, snap.id!, snap.point);
    const n = r.net.nodes.find((x) => x.id === r.nodeId)!;
    return { net: r.net, nodeId: r.nodeId, point: [n.x, n.y] };
  }
  const node: NetNode = { id: uid('n'), x: p[0], y: p[1] };
  return { net: { ...net, nodes: [...net.nodes, node] }, nodeId: node.id, point: p };
}

/** Add a user-drawn drive polyline; endpoints snap to nearby nodes or split nearby edges. */
export function addPolyline(net: PlanNetwork, pts: Vec2[], snapRadius: number, widthPx?: number): PlanNetwork {
  if (pts.length < 2) return net;
  const start = resolveEndpoint(net, pts[0], snapRadius);
  const end = resolveEndpoint(start.net, pts[pts.length - 1], snapRadius);
  if (start.nodeId === end.nodeId && pts.length < 3) return start.net;
  const points: Vec2[] = [start.point, ...pts.slice(1, -1), end.point];
  const edge: NetEdge = { id: uid('e'), a: start.nodeId, b: end.nodeId, points, widthPx };
  return { ...end.net, edges: [...end.net.edges, edge] };
}

/** Join edges through nodes of degree 2 into single edges. */
export function mergeDegree2(net: PlanNetwork): PlanNetwork {
  let nodes = net.nodes.slice();
  let edges = net.edges.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const deg = degreeMap({ nodes, edges, stopes: [] });
    for (const n of nodes) {
      if (deg.get(n.id) !== 2) continue;
      const inc = edges.filter((e) => e.a === n.id || e.b === n.id);
      if (inc.length !== 2 || inc[0].id === inc[1].id) continue;
      const [e1, e2] = inc;
      const p1 = e1.b === n.id ? e1.points : e1.points.slice().reverse();
      const p2 = e2.a === n.id ? e2.points : e2.points.slice().reverse();
      const a = e1.b === n.id ? e1.a : e1.b;
      const b = e2.a === n.id ? e2.b : e2.a;
      if (a === n.id || b === n.id) continue;
      const w = e1.widthPx && e2.widthPx ? (e1.widthPx + e2.widthPx) / 2 : e1.widthPx ?? e2.widthPx;
      const merged: NetEdge = { id: uid('e'), a, b, points: [...p1, ...p2.slice(1)], widthPx: w };
      edges = edges.filter((e) => e.id !== e1.id && e.id !== e2.id);
      edges.push(merged);
      nodes = nodes.filter((x) => x.id !== n.id);
      changed = true;
      break;
    }
  }
  return { ...net, nodes, edges };
}

export function networkLength(net: PlanNetwork): number {
  return net.edges.reduce((s, e) => s + polylineLength(e.points), 0);
}

/** Keep only network parts inside the given polygon test. */
export function filterNetwork(net: PlanNetwork, keep: (p: Vec2) => boolean): PlanNetwork {
  const edges = net.edges.filter((e) => e.points.every(keep));
  const stopes = net.stopes.filter((s) => s.polygon.every(keep));
  return removeOrphanNodes({ ...net, edges, stopes });
}
