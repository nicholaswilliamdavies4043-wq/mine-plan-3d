/**
 * Built-in tunnel kit: one straight module and one end-wall module, generated once per tunnel
 * profile and drawn with GPU instancing; plus parametric connectors ("hubs") for junctions and
 * bends that no imported kit asset matches. All faces point into the tunnel, so from outside you
 * look straight into the drives (cut-away view), and from inside it is a closed tunnel.
 */
import * as THREE from 'three';
import type { Hub, TunnelProfile } from '@mineplan/shared';

const ARCH_SEGMENTS = 10;

/** Cross-section for unit width: points (z, y) from right floor corner, up, over the back, down to left floor corner. */
export function profilePoints(profile: TunnelProfile): [number, number][] {
  const pts: [number, number][] = [[0.5, 0], [0.5, profile.wallHeight]];
  for (let i = 1; i < ARCH_SEGMENTS; i++) {
    const th = (i / ARCH_SEGMENTS) * Math.PI;
    pts.push([0.5 * Math.cos(th), profile.wallHeight + profile.archRise * Math.sin(th)]);
  }
  pts.push([-0.5, profile.wallHeight], [-0.5, 0]);
  return pts;
}

class TriBuilder {
  pos: number[] = [];
  uv: number[] = [];
  groups: { start: number; count: number; mat: number }[] = [];
  private cur = -1;
  private start = 0;
  setMaterial(m: number) {
    if (m === this.cur) return;
    this.closeGroup();
    this.cur = m;
    this.start = this.pos.length / 3;
  }
  closeGroup() {
    const n = this.pos.length / 3;
    if (this.cur >= 0 && n > this.start) this.groups.push({ start: this.start, count: n - this.start, mat: this.cur });
  }
  /** Add a triangle, flipped if needed so its front face points towards `inside`. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: number[], ub: number[], uc: number[], inside: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const centroid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(new THREE.Vector3().subVectors(inside, centroid)) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.uv.push(...ua, ...ub, ...uc);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: number[], ub: number[], uc: number[], ud: number[], inside: THREE.Vector3) {
    this.tri(a, b, c, ua, ub, uc, inside);
    this.tri(a, c, d, ua, uc, ud, inside);
  }
  build(): THREE.BufferGeometry {
    this.closeGroup();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const gr of this.groups) g.addGroup(gr.start, gr.count, gr.mat);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Straight module: x in [0,1] (scaled to length), z in [-0.5,0.5] (scaled to width), real heights. Group 0 = walls/back, 1 = floor. */
export function straightGeometry(profile: TunnelProfile, metresPerTexture = 4): THREE.BufferGeometry {
  const b = new TriBuilder();
  const prof = profilePoints(profile);
  const inside = V(0.5, profile.wallHeight * 0.6, 0);
  // walls + back
  b.setMaterial(0);
  let s = 0;
  for (let i = 0; i < prof.length - 1; i++) {
    const [z0, y0] = prof[i], [z1, y1] = prof[i + 1];
    const s1 = s + Math.hypot(z1 - z0, (y1 - y0) / 5.5) ; // approximate arc length in unit-width space
    b.quad(V(0, y0, z0), V(1, y0, z0), V(1, y1, z1), V(0, y1, z1), [0, s / 3], [1, s / 3], [1, s1 / 3], [0, s1 / 3], inside);
    s = s1;
  }
  // floor
  b.setMaterial(1);
  b.quad(V(0, 0, -0.5), V(1, 0, -0.5), V(1, 0, 0.5), V(0, 0, 0.5), [0, 0], [1, 0], [1, 1], [0, 1], inside);
  void metresPerTexture;
  return b.build();
}

/** End wall (face) at x = 0 facing +X, unit width. */
export function capGeometry(profile: TunnelProfile): THREE.BufferGeometry {
  const prof = profilePoints(profile);
  const shape = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ShapeGeometry(shape);
  // ShapeGeometry is in XY; map shape (x=z, y=y) to (0, y, z)
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getX(i), y = pos.getY(i);
    pos.setXYZ(i, 0, y, z);
  }
  // ensure front faces point +X
  const idx = g.getIndex()!;
  const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3();
  a.fromBufferAttribute(pos, idx.getX(0)); bb.fromBufferAttribute(pos, idx.getX(1)); c.fromBufferAttribute(pos, idx.getX(2));
  const n = new THREE.Vector3().subVectors(bb, a).cross(new THREE.Vector3().subVectors(c, a));
  if (n.x < 0) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Parametric connector for one or more hubs, merged into a single geometry (group 0 walls/back, 1 floor).
 * The flat back sits at the apex of the drive arch; spandrels close the gap above each opening.
 */
export function hubsGeometry(hubs: Hub[], profile: TunnelProfile): THREE.BufferGeometry {
  const b = new TriBuilder();
  const H = profile.wallHeight + profile.archRise;
  for (const hub of hubs) {
    const [cx, cy, cz] = hub.center;
    const br = hub.branches
      .map((x) => ({ ...x, ang: Math.atan2(x.dir[1], x.dir[0]) }))
      .sort((p, q) => p.ang - q.ang);
    const inside = V(cx, cy + H * 0.5, cz);
    const corner = (i: number, side: 1 | -1) => {
      const x = br[i];
      const perp = [-x.dir[1], x.dir[0]];
      return V(cx + x.dir[0] * x.trim + side * perp[0] * x.width / 2, cy, cz + x.dir[1] * x.trim + side * perp[1] * x.width / 2);
    };
    // floor polygon (B0, A0, B1, A1, ...) where A = +perp side (towards next branch)
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < br.length; i++) ring.push(corner(i, -1), corner(i, 1));
    // Floor/back: the ring can self-intersect at acute junctions, so cover its convex hull instead.
    const hull = convexHullXZ(ring);
    const tris = hull.slice(1, -1).map((_, i) => [hull[0], hull[i + 1], hull[i + 2]]);
    b.setMaterial(1);
    for (const [i, j, k] of tris) {
      const a = ring[i], c = ring[j], d = ring[k];
      b.tri(a, c, d, [a.x / 4, a.z / 4], [c.x / 4, c.z / 4], [d.x / 4, d.z / 4], inside);
    }
    b.setMaterial(0);
    // back (roof)
    for (const [i, j, k] of tris) {
      const a = ring[i].clone().setY(cy + H), c = ring[j].clone().setY(cy + H), d = ring[k].clone().setY(cy + H);
      b.tri(a, c, d, [a.x / 4, a.z / 4], [c.x / 4, c.z / 4], [d.x / 4, d.z / 4], inside);
    }
    // walls between consecutive openings
    for (let i = 0; i < br.length; i++) {
      const from = corner(i, 1);
      const to = corner((i + 1) % br.length, -1);
      const L = from.distanceTo(to);
      if (L < 1e-3) continue;
      b.quad(from, to, to.clone().setY(cy + H), from.clone().setY(cy + H), [0, 0], [L / 4, 0], [L / 4, H / 4], [0, H / 4], inside);
    }
    // spandrels above each opening (between the drive arch and the flat back)
    if (profile.archRise > 0.01) {
      for (let i = 0; i < br.length; i++) {
        const x = br[i];
        const perp = [-x.dir[1], x.dir[0]];
        const base = [cx + x.dir[0] * x.trim, cz + x.dir[1] * x.trim];
        const archPt = (th: number) => {
          const s = Math.cos(th) * x.width / 2; // +perp side at th = 0
          return V(base[0] + perp[0] * s, cy + profile.wallHeight + profile.archRise * Math.sin(th), base[1] + perp[1] * s);
        };
        for (let k = 0; k < ARCH_SEGMENTS; k++) {
          const p0 = archPt((k / ARCH_SEGMENTS) * Math.PI), p1 = archPt(((k + 1) / ARCH_SEGMENTS) * Math.PI);
          b.quad(p0, p1, p1.clone().setY(cy + H), p0.clone().setY(cy + H), [0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2], inside);
        }
      }
    }
  }
  return b.build();
}

/** Indices of the convex hull of points in the xz plane (monotone chain). */
function convexHullXZ(pts: THREE.Vector3[]): number[] {
  const idx = pts.map((_, i) => i).sort((a, b) => pts[a].x - pts[b].x || pts[a].z - pts[b].z);
  if (idx.length < 3) return idx;
  const cross = (o: number, a: number, b: number) =>
    (pts[a].x - pts[o].x) * (pts[b].z - pts[o].z) - (pts[a].z - pts[o].z) * (pts[b].x - pts[o].x);
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Procedural rock texture (no external image files needed). */
export function rockTexture(seed = 1, base = [118, 110, 100]): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const img = ctx.createImageData(size, size);
  // value noise at a few octaves
  const grid = (n: number) => Array.from({ length: (n + 1) * (n + 1) }, rnd);
  const octaves = [4, 8, 16, 32, 64].map((n) => ({ n, g: grid(n) }));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5;
      for (const { n, g } of octaves) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const at = (a: number, b: number) => g[(b % n) * (n + 1) + (a % n)];
        const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
        const bot = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
        v += (top * (1 - ty) + bot * ty) * amp;
        amp *= 0.55;
      }
      const k = 0.6 + v * 0.8;
      const o = (y * size + x) * 4;
      img.data[o] = Math.min(255, base[0] * k);
      img.data[o + 1] = Math.min(255, base[1] * k);
      img.data[o + 2] = Math.min(255, base[2] * k);
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
