import type { Polygon, Vec2 } from './types';

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [1, 0];
};
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Unsigned angle between two vectors in radians [0, PI]. */
export function angleBetween(a: Vec2, b: Vec2): number {
  const c = dot(norm(a), norm(b));
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

export function polylineLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** Point at arc-length s along a polyline (clamped). */
export function pointAt(pts: Vec2[], s: number): Vec2 {
  if (s <= 0) return pts[0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= s) return lerp(pts[i - 1], pts[i], d > 0 ? (s - acc) / d : 0);
    acc += d;
  }
  return pts[pts.length - 1];
}

/** Sub-polyline between arc lengths s0 < s1. */
export function slicePolyline(pts: Vec2[], s0: number, s1: number): Vec2[] {
  const out: Vec2[] = [pointAt(pts, s0)];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += dist(pts[i - 1], pts[i]);
    if (acc > s0 + 1e-9 && acc < s1 - 1e-9) out.push(pts[i]);
  }
  out.push(pointAt(pts, s1));
  return out;
}

export function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  const point = add(a, mul(ab, t));
  return { point, t, d: dist(p, point) };
}

export function nearestOnPolyline(p: Vec2, pts: Vec2[]): { point: Vec2; seg: number; t: number; d: number; s: number } {
  let best = { point: pts[0], seg: 0, t: 0, d: Infinity, s: 0 };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const r = nearestOnSegment(p, pts[i - 1], pts[i]);
    const segLen = dist(pts[i - 1], pts[i]);
    if (r.d < best.d) best = { point: r.point, seg: i - 1, t: r.t, d: r.d, s: acc + r.t * segLen };
    acc += segLen;
  }
  return best;
}

/** Ramer-Douglas-Peucker simplification. */
export function simplifyRDP(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let maxD = -1, idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = nearestOnSegment(pts[i], pts[i0], pts[i1]).d;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Chaikin smoothing keeping end points fixed. */
export function chaikin(pts: Vec2[], iterations = 1): Vec2[] {
  let cur = pts;
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 3) return cur;
    const out: Vec2[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      if (i > 0) out.push(lerp(a, b, 0.25));
      if (i < cur.length - 2) out.push(lerp(a, b, 0.75));
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

export function convexHull(points: Vec2[]): Vec2[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 1])) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 1])) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

let counter = 0;
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1e6;
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}
