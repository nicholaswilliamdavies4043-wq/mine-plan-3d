import type { Mask } from './raster';

const INF = 1e20;

/** 1D squared distance transform (Felzenszwalb & Huttenlocher). */
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Euclidean distance from every pixel to the nearest pixel where `isFeature` is true.
 * Returns distances (not squared) as Float32Array.
 */
export function edt(w: number, h: number, isFeature: (i: number) => boolean): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = isFeature(i) ? 0 : INF;
  // columns
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  // rows
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** Dilate mask by a disk of radius r. */
export function dilate(m: Mask, r: number): Mask {
  if (r <= 0) return { ...m, d: m.d.slice() };
  const dist = edt(m.w, m.h, (i) => m.d[i] === 1);
  const d = new Uint8Array(m.w * m.h);
  for (let i = 0; i < d.length; i++) d[i] = dist[i] <= r ? 1 : 0;
  return { w: m.w, h: m.h, d };
}

/** Erode mask by a disk of radius r (pixels outside the image count as background). */
export function erode(m: Mask, r: number): Mask {
  if (r <= 0) return { ...m, d: m.d.slice() };
  const dist = edt(m.w, m.h, (i) => m.d[i] === 0);
  const d = new Uint8Array(m.w * m.h);
  for (let i = 0; i < d.length; i++) d[i] = dist[i] > r ? 1 : 0;
  return { w: m.w, h: m.h, d };
}

export interface Components {
  labels: Int32Array; // -1 = not part of the set
  sizes: number[];
  touchesBorder: boolean[];
  bbox: [number, number, number, number][]; // minX, minY, maxX, maxY
}

/** Connected components of pixels where pred(i) is true. */
export function components(w: number, h: number, pred: (i: number) => boolean, eight = true): Components {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const touches: boolean[] = [];
  const bbox: [number, number, number, number][] = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (labels[s] !== -1 || !pred(s)) continue;
    const id = sizes.length;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = id;
    let size = 0;
    let border = false;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (!eight && dx && dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (labels[q] === -1 && pred(q)) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    sizes.push(size);
    touches.push(border);
    bbox.push([x0, y0, x1, y1]);
  }
  return { labels, sizes, touchesBorder: touches, bbox };
}

/** Box mean filter (integral image). */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const s = I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa];
      out[y * w + x] = s / ((yb - ya) * (xb - xa));
    }
  }
  return out;
}
