import {
  addPolyline, angleBetween, degreeMap, dist, mergeDegree2, nearestOnPolyline, norm, pointAt, polylineLength, sub,
  type PlanNetwork, type Vec2,
} from '@mineplan/shared';
import type { Mask } from './raster';

/**
 * Bridge short gaps where a drive is interrupted by annotation (brow markers, labels,
 * hatching). A dead end is connected to another dead end or to a drive ahead of it when
 * the target lies roughly straight ahead and the straight line between them does not
 * cross wall ink.
 */
export function bridgeGaps(net: PlanNetwork, wall: Mask, region: Mask, driveWidth: number, maxGapFactor = 4.5): { net: PlanNetwork; bridges: number } {
  const maxGap = driveWidth * maxGapFactor;
  const coneNode = (40 * Math.PI) / 180;
  const coneEdge = (28 * Math.PI) / 180;
  let bridges = 0;
  let cur = net;

  const lineIsClear = (a: Vec2, b: Vec2) => {
    const n = Math.max(2, Math.ceil(dist(a, b)));
    let wallHits = 0, samples = 0;
    // skip the first/last drive half-width: endpoints sit next to walls
    const skip = driveWidth * 0.5;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const along = t * dist(a, b);
      if (along < skip || along > dist(a, b) - skip) continue;
      const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
      if (x < 0 || y < 0 || x >= wall.w || y >= wall.h) return false;
      const i = y * wall.w + x;
      if (!region.d[i]) return false;
      samples++;
      if (wall.d[i]) wallHits++;
    }
    return samples === 0 || wallHits / samples <= 0.12;
  };

  const outward = (nodeId: string, net2: PlanNetwork): Vec2 | null => {
    const e = net2.edges.find((x) => x.a === nodeId || x.b === nodeId);
    if (!e) return null;
    const pts = e.a === nodeId ? e.points : e.points.slice().reverse();
    const L = polylineLength(pts);
    const q = pointAt(pts, Math.min(L, driveWidth * 2));
    return norm(sub(pts[0], q));
  };

  for (let pass = 0; pass < 2; pass++) {
    const deg = degreeMap(cur);
    const ends = cur.nodes.filter((n) => deg.get(n.id) === 1);
    for (const n of ends) {
      const deg2 = degreeMap(cur);
      if (deg2.get(n.id) !== 1) continue;
      const p: Vec2 = [n.x, n.y];
      const dir = outward(n.id, cur);
      if (!dir) continue;
      const own = cur.edges.find((x) => x.a === n.id || x.b === n.id)!;
      let best: { target: Vec2; score: number } | null = null;
      for (const m of cur.nodes) {
        if (m.id === n.id || deg2.get(m.id) !== 1) continue;
        if (own.a === m.id || own.b === m.id) continue;
        const q: Vec2 = [m.x, m.y];
        const d = dist(p, q);
        if (d > maxGap || d < 1) continue;
        if (angleBetween(dir, sub(q, p)) > coneNode) continue;
        const mdir = outward(m.id, cur);
        if (mdir && angleBetween(mdir, sub(p, q)) > Math.PI / 2) continue;
        if (!lineIsClear(p, q)) continue;
        if (!best || d < best.score) best = { target: q, score: d };
      }
      for (const e of cur.edges) {
        if (e.id === own.id) continue;
        const r = nearestOnPolyline(p, e.points);
        if (r.d > maxGap * 0.7 || r.d < 1) continue;
        if (angleBetween(dir, sub(r.point, p)) > coneEdge) continue;
        if (!lineIsClear(p, r.point)) continue;
        const score = r.d * 1.25;
        if (!best || score < best.score) best = { target: r.point, score };
      }
      if (best) {
        cur = addPolyline(cur, [p, best.target], 1.5);
        bridges++;
      }
    }
  }
  return { net: mergeDegree2(cur), bridges };
}
