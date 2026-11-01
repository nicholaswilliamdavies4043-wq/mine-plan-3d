import type { Mask } from './raster';

// neighbour offsets in clockwise order starting north: P2..P9
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

/** Zhang-Suen thinning. Returns a new 1-pixel-wide 8-connected skeleton mask. */
export function zhangSuen(m: Mask): Mask {
  const { w, h } = m;
  const img = m.d.slice();
  // clear border to simplify neighbour access
  for (let x = 0; x < w; x++) { img[x] = 0; img[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { img[y * w] = 0; img[y * w + w - 1] = 0; }

  let candidates: number[] = [];
  for (let i = 0; i < w * h; i++) if (img[i]) candidates.push(i);
  const nb = new Uint8Array(8);
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const del: number[] = [];
      const next: number[] = [];
      for (const p of candidates) {
        if (!img[p]) continue;
        next.push(p);
        let B = 0;
        for (let k = 0; k < 8; k++) {
          nb[k] = img[p + DY[k] * w + DX[k]];
          B += nb[k];
        }
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let k = 0; k < 8; k++) if (nb[k] === 0 && nb[(k + 1) % 8] === 1) A++;
        if (A !== 1) continue;
        // P2=nb0 P4=nb2 P6=nb4 P8=nb6
        if (step === 0) {
          if (nb[0] * nb[2] * nb[4] !== 0) continue;
          if (nb[2] * nb[4] * nb[6] !== 0) continue;
        } else {
          if (nb[0] * nb[2] * nb[6] !== 0) continue;
          if (nb[0] * nb[4] * nb[6] !== 0) continue;
        }
        del.push(p);
      }
      for (const p of del) img[p] = 0;
      if (del.length) changed = true;
      candidates = next;
    }
  }
  // remove staircase corners: a pixel whose only two neighbours are orthogonal and adjacent
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!img[p]) continue;
      let B = 0;
      for (let k = 0; k < 8; k++) { nb[k] = img[p + DY[k] * w + DX[k]]; B += nb[k]; }
      if (B !== 2) continue;
      if ((nb[0] && nb[2]) || (nb[2] && nb[4]) || (nb[4] && nb[6]) || (nb[6] && nb[0])) img[p] = 0;
    }
  }
  return { w, h, d: img };
}

export const NEIGHBOURS = { DX, DY };
