import type { GeoRef, Vec2 } from './types';

/**
 * Similarity transform (uniform scale + rotation + translation) from image pixels to
 * world [E, N]. Image y points down, northing points up, so the image y axis is flipped
 * before fitting. Fitted with least squares when more than two control points exist.
 */
export interface Similarity {
  /** Complex multiplier a = s * e^{i theta} */
  ar: number;
  ai: number;
  /** Translation */
  bx: number;
  by: number;
}

export function fitSimilarity(georef: GeoRef): Similarity {
  const pts = georef.points.filter((p) => isFinite(p.px[0]) && isFinite(p.world[0]));
  const s = georef.metersPerPixel > 0 ? georef.metersPerPixel : 1;
  if (pts.length === 0) return { ar: s, ai: 0, bx: 0, by: 0 };
  if (pts.length === 1) {
    const p = pts[0];
    // world = s * (x, -y) + b
    return { ar: s, ai: 0, bx: p.world[0] - s * p.px[0], by: p.world[1] + s * p.px[1] };
  }
  // complex least squares: w = a z + b with z = x - i y
  const n = pts.length;
  let zx = 0, zy = 0, wx = 0, wy = 0;
  for (const p of pts) {
    zx += p.px[0]; zy += -p.px[1]; wx += p.world[0]; wy += p.world[1];
  }
  zx /= n; zy /= n; wx /= n; wy /= n;
  let numR = 0, numI = 0, den = 0;
  for (const p of pts) {
    const dzx = p.px[0] - zx, dzy = -p.px[1] - zy;
    const dwx = p.world[0] - wx, dwy = p.world[1] - wy;
    // (dw) * conj(dz)
    numR += dwx * dzx + dwy * dzy;
    numI += dwy * dzx - dwx * dzy;
    den += dzx * dzx + dzy * dzy;
  }
  if (den < 1e-9) return { ar: s, ai: 0, bx: wx - s * zx, by: wy - s * zy };
  const ar = numR / den, ai = numI / den;
  return { ar, ai, bx: wx - (ar * zx - ai * zy), by: wy - (ar * zy + ai * zx) };
}

export function pxToWorld(t: Similarity, p: Vec2): Vec2 {
  const zx = p[0], zy = -p[1];
  return [t.ar * zx - t.ai * zy + t.bx, t.ar * zy + t.ai * zx + t.by];
}

export function worldToPx(t: Similarity, w: Vec2): Vec2 {
  const dx = w[0] - t.bx, dy = w[1] - t.by;
  const d = t.ar * t.ar + t.ai * t.ai;
  // z = (w - b) / a
  const zx = (dx * t.ar + dy * t.ai) / d;
  const zy = (dy * t.ar - dx * t.ai) / d;
  return [zx, -zy];
}

/** Metres per pixel of the transform. */
export function scaleOf(t: Similarity): number {
  return Math.hypot(t.ar, t.ai);
}

/** Rotation (radians) of image +x axis in world (E,N) frame. */
export function rotationOf(t: Similarity): number {
  return Math.atan2(t.ai, t.ar);
}

/** Residual error (m) of each control point, useful for showing calibration quality. */
export function residuals(georef: GeoRef): number[] {
  const t = fitSimilarity(georef);
  return georef.points.map((p) => {
    const w = pxToWorld(t, p.px);
    return Math.hypot(w[0] - p.world[0], w[1] - p.world[1]);
  });
}
