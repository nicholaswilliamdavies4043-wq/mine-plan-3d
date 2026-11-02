/**
 * Lays a measured polyline onto the drive walls of the assembled model, so a measurement can be
 * read on the wall while walking through (like a tape measure fixed to the rib).
 *
 * The line is sampled along its length. Where a sample lies inside a drive that runs roughly in
 * the same direction as the measurement, it is moved sideways onto that drive's left wall (left
 * as seen looking from the first point to the last). Elsewhere (across pillars, straight across
 * a drive) the sample stays on the measured line. Coordinates are three.js local (x, y, z) with y
 * the floor level; the renderer adds the tape height.
 */
import type { Vec3 } from './types';
import type { CollisionSegment } from './assembly';

type XZ = [number, number];

export interface WallSample {
  /** Floor-level position of the tape (on the wall when `wall` is set). */
  p: Vec3;
  /** Distance along the measured line from its first point (metres, 3D). */
  s: number;
  wall: boolean;
  /** Unit normal (xz) pointing from the wall into the drive, for wall-mounted labels. */
  n: XZ | null;
}

export interface WallLayout {
  samples: WallSample[];
  total: number;
  /** Distance along the line at each input vertex. */
  vertexS: number[];
}

const ALIGN_COS = Math.cos((32 * Math.PI) / 180);

/** Drive capsule containing p whose axis is best aligned with direction d (on the level nearest y). */
function alignedDrive(p: XZ, y: number, d: XZ, segs: CollisionSegment[]): { c: XZ; axis: XZ; r: number } | null {
  let best: { c: XZ; axis: XZ; r: number; score: number } | null = null;
  for (const s of segs) {
    if (Math.abs(s.y - y) > 3) continue;
    const ab: XZ = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    const L = Math.hypot(ab[0], ab[1]);
    if (L < 1e-6) continue;
    const u: XZ = [ab[0] / L, ab[1] / L];
    const t = Math.max(0, Math.min(L, (p[0] - s.a[0]) * u[0] + (p[1] - s.a[1]) * u[1]));
    const c: XZ = [s.a[0] + u[0] * t, s.a[1] + u[1] * t];
    const dist = Math.hypot(p[0] - c[0], p[1] - c[1]);
    if (dist > s.r * 1.05) continue;
    const align = Math.abs(u[0] * d[0] + u[1] * d[1]);
    if (align < ALIGN_COS) continue;
    const score = align - dist / (s.r * 4);
    if (!best || score > best.score) best = { c, axis: u, r: s.r, score };
  }
  return best;
}

export function layoutOnWalls(pts: Vec3[], segs: CollisionSegment[], opts: { inset?: number; step?: number } = {}): WallLayout {
  const inset = opts.inset ?? 0.05;
  const samples: WallSample[] = [];
  const vertexS: number[] = [0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    const Lh = Math.hypot(dx, dz);
    if (L < 1e-6) { vertexS.push(acc); continue; }
    const d: XZ = Lh > 1e-6 ? [dx / Lh, dz / Lh] : [1, 0];
    const left: XZ = [d[1], -d[0]]; // left of the direction of travel, seen from above (x east, z south)
    const step = opts.step ?? Math.max(0.5, Math.min(2, L / 40));
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const q: Vec3 = [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
      const drive = alignedDrive([q[0], q[2]], q[1], d, segs);
      let sample: WallSample = { p: q, s: acc + L * t, wall: false, n: null };
      if (drive) {
        // wall normal on the left side, pointing outwards from the axis
        let nx = -drive.axis[1], nz = drive.axis[0];
        if (nx * left[0] + nz * left[1] < 0) { nx = -nx; nz = -nz; }
        const off = (q[0] - drive.c[0]) * nx + (q[2] - drive.c[1]) * nz;
        const move = drive.r - inset - off;
        sample = { p: [q[0] + nx * move, q[1], q[2] + nz * move], s: sample.s, wall: true, n: [-nx, -nz] };
      }
      samples.push(sample);
    }
    acc += L;
    vertexS.push(acc);
  }
  return { samples, total: acc, vertexS };
}

/** Sample of the layout at distance s (interpolated between neighbouring samples). */
export function layoutAt(layout: WallLayout, s: number): WallSample {
  const S = layout.samples;
  if (!S.length) return { p: [0, 0, 0], s: 0, wall: false, n: null };
  if (s <= S[0].s) return S[0];
  for (let i = 1; i < S.length; i++) {
    if (S[i].s >= s) {
      const a = S[i - 1], b = S[i];
      const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
      const near = t < 0.5 ? a : b;
      return {
        p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
        s, wall: a.wall && b.wall, n: near.n ?? a.n ?? b.n,
      };
    }
  }
  return S[S.length - 1];
}

/** A readable tick interval (1, 2, 5 × 10^n metres) giving about `target` ticks over `total`. */
export function tickInterval(total: number, target = 10): number {
  const raw = total / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
  return Math.max(1, 10 * p);
}
