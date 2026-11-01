import { convexHull, polygonArea, simplifyRDP, uid, type DetectionParams, type Stope, type Vec2 } from '@mineplan/shared';
import type { Mask, RGBAImage } from './raster';
import { components, edt } from './morph';

interface StopeInput {
  image: RGBAImage;
  x0: number;
  y0: number;
  w: number;
  h: number;
  region: Mask;
  sat: Float32Array;
  lum: Float32Array;
  driveWidth: number;
  params: DetectionParams;
}

/**
 * Stopes on plans are drawn with coloured outlines and hatching (magenta, pink, cyan...).
 * Coloured ink is grouped with a morphological closing, holes are filled and each
 * sufficiently large and compact blob becomes a stope polygon (convex hull, simplified).
 */
export function detectStopes(s: StopeInput): Stope[] {
  const { w, h, region, sat, lum, driveWidth, params } = s;
  const N = w * h;
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) ink[i] = region.d[i] && sat[i] >= params.stopeMinSaturation && lum[i] < 235 ? 1 : 0;

  // closing: dilate by c, erode by c
  const c = Math.max(2, Math.round(driveWidth * 0.6));
  const dOut = edt(w, h, (i) => ink[i] === 1);
  const dil = new Uint8Array(N);
  for (let i = 0; i < N; i++) dil[i] = dOut[i] <= c ? 1 : 0;
  const dIn = edt(w, h, (i) => dil[i] === 0);
  const closed = new Uint8Array(N);
  for (let i = 0; i < N; i++) closed[i] = dIn[i] > c ? 1 : 0;

  // fill enclosed holes
  const holes = components(w, h, (i) => closed[i] === 0, false);
  for (let i = 0; i < N; i++) {
    const l = holes.labels[i];
    if (l >= 0 && !holes.touchesBorder[l] && holes.sizes[l] < driveWidth * driveWidth * 60) closed[i] = 1;
  }

  const comps = components(w, h, (i) => closed[i] === 1, true);
  const minArea = driveWidth * driveWidth * 6;
  const result: Stope[] = [];
  const boundary: Vec2[][] = comps.sizes.map(() => []);
  const inkCount = new Array(comps.sizes.length).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = comps.labels[i];
      if (l < 0) continue;
      if (ink[i]) inkCount[l]++;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        comps.labels[i - 1] !== l || comps.labels[i + 1] !== l || comps.labels[i - w] !== l || comps.labels[i + w] !== l;
      if (edge) boundary[l].push([x + 0.5, y + 0.5]);
    }
  for (let l = 0; l < comps.sizes.length; l++) {
    if (comps.sizes[l] < minArea) continue;
    const hull = convexHull(boundary[l]);
    if (hull.length < 3) continue;
    const hullArea = Math.abs(polygonArea(hull));
    // reject sparse, line-like features (e.g. dotted lines, leader lines)
    if (comps.sizes[l] / hullArea < 0.55) continue;
    if (inkCount[l] / comps.sizes[l] < 0.06) continue;
    const bw = comps.bbox[l][2] - comps.bbox[l][0], bh = comps.bbox[l][3] - comps.bbox[l][1];
    if (Math.min(bw, bh) < driveWidth * 1.2) continue;
    const poly = simplifyRDP([...hull, hull[0]], driveWidth * 0.4).slice(0, -1);
    result.push({
      id: uid('s'),
      polygon: poly.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as Vec2),
      heightM: params.stopeHeightM,
      baseOffsetM: 0,
      label: `Stope ${result.length + 1}`,
    });
  }
  return result;
}
