/**
 * Automatic drive (tunnel) and stope detection from a scanned 2D mine plan.
 *
 * Pipeline
 *  1. Wall mask: pixels clearly darker than the local paper background and not strongly
 *     coloured (coloured ink = stopes, hatching, symbols).
 *  2. Free space = selected regions minus excluded areas minus walls.
 *  3. Distance transform of free space. Drive width is estimated from the most common
 *     ridge (medial axis) distance.
 *  4. Wide-area removal: a morphological opening with a disk slightly larger than a drive
 *     intersection removes open paper, pillars and the outside of the mine. What is left
 *     is the thin, corridor-like free space between parallel wall lines = drives.
 *  5. Hole filling (text labels inside drives) and small-blob removal.
 *  6. Zhang-Suen skeleton -> graph -> spur pruning, junction merging, simplification.
 *  7. Optional stope detection from coloured outlines / hatching.
 */
import { defaultDetectionParams, polylineLength, type DetectionParams, type DetectionResult, type Polygon, type Vec2 } from '@mineplan/shared';
import { encodePng, fillPolygons, newMask, type Mask, type RGBAImage } from './raster';
import { boxMean, components, edt } from './morph';
import { zhangSuen } from './skeleton';
import { cleanupGraph, graphToNetwork, skeletonToGraph } from './graph';
import { detectStopes } from './stopes';
import { bridgeGaps } from './bridge';

export interface DetectInput {
  image: RGBAImage;
  regions: Polygon[];
  excludes: Polygon[];
  params?: Partial<DetectionParams>;
  /** Include a PNG overlay of the detected drive mask. */
  withMask?: boolean;
}

export function detectNetwork(input: DetectInput): DetectionResult {
  const t0 = Date.now();
  const params: DetectionParams = { ...defaultDetectionParams(), ...(input.params ?? {}) };
  const warnings: string[] = [];
  const { image } = input;

  // --- crop to the bounding box of selected regions -------------------------------
  const regions = input.regions.filter((r) => r.length >= 3);
  let x0 = 0, y0 = 0, x1 = image.width, y1 = image.height;
  if (regions.length) {
    x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
    for (const r of regions) for (const p of r) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    const pad = 4;
    x0 = Math.max(0, Math.floor(x0) - pad); y0 = Math.max(0, Math.floor(y0) - pad);
    x1 = Math.min(image.width, Math.ceil(x1) + pad); y1 = Math.min(image.height, Math.ceil(y1) + pad);
  }
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 || h < 8) throw new Error('Selected region is too small.');
  const shift = (polys: Polygon[]): Polygon[] => polys.map((poly) => poly.map((p) => [p[0] - x0, p[1] - y0] as Vec2));

  // --- region mask ----------------------------------------------------------------
  const region = newMask(w, h);
  if (regions.length) fillPolygons(region, shift(regions), 1);
  else region.d.fill(1);
  if (input.excludes.length) fillPolygons(region, shift(input.excludes), 0);

  // --- luminance, saturation, wall mask ---------------------------------------------
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + y0) * image.width + (x + x0)) * 4;
      const r = image.data[si], g = image.data[si + 1], b = image.data[si + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const i = y * w + x;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      sat[i] = mx > 0 ? (mx - mn) / mx : 0;
    }
  }
  const bg = boxMean(lum, w, h, 12);
  const wall = newMask(w, h);
  let wallPixels = 0;
  for (let i = 0; i < w * h; i++) {
    // background estimate is pulled down by dense ink; use the brighter of local mean and a paper floor
    const ref = Math.max(bg[i], 215);
    if (ref - lum[i] > params.wallContrast && sat[i] <= params.maxWallSaturation) {
      wall.d[i] = 1;
      wallPixels++;
    }
  }
  const wallInk: Mask = { w, h, d: wall.d.slice() };

  // --- free space + distance transform ------------------------------------------------
  const free = newMask(w, h);
  for (let i = 0; i < w * h; i++) free.d[i] = region.d[i] && !wall.d[i] ? 1 : 0;
  let D = edt(w, h, (i) => free.d[i] === 0);

  // --- drive width estimate (on the undilated walls) ------------------------------------
  let driveWidth = params.driveWidthPx;
  if (!(driveWidth > 0)) {
    driveWidth = estimateDriveWidth(D, free, w, h);
    if (!(driveWidth > 0)) {
      driveWidth = 10;
      warnings.push('Could not estimate drive width; using 10 px. Set it manually.');
    }
  }
  const half = driveWidth / 2;

  // --- seal small gaps in faint wall lines -----------------------------------------------
  if (params.wallDilatePx > 0) {
    for (let i = 0; i < w * h; i++) {
      if (free.d[i] && D[i] <= params.wallDilatePx) { free.d[i] = 0; wall.d[i] = 1; }
    }
    D = edt(w, h, (i) => free.d[i] === 0);
  }

  // --- wide-area removal (opening residue) ----------------------------------------------
  const r = Math.max(1.5, params.wideAreaFactor * driveWidth - params.wallDilatePx);
  const E = edt(w, h, (i) => D[i] > r);
  const drive = newMask(w, h);
  for (let i = 0; i < w * h; i++) drive.d[i] = free.d[i] && !(E[i] <= r + 0.5) ? 1 : 0;

  // --- fill small holes (labels inside drives) and drop tiny blobs ------------------------
  const holeMax = params.holeFillFactor * driveWidth * driveWidth;
  const holes = components(w, h, (i) => drive.d[i] === 0 && region.d[i] === 1, false);
  for (let i = 0; i < w * h; i++) {
    const l = holes.labels[i];
    if (l >= 0 && holes.sizes[l] < holeMax && !holes.touchesBorder[l]) drive.d[i] = 1;
  }
  // 4-connectivity so diagonal leaks through broken wall lines do not join pillars to drives
  const blobs = components(w, h, (i) => drive.d[i] === 1, false);
  const blobMin = driveWidth * driveWidth * params.minBlobFactor;
  let drivePixels = 0;
  for (let i = 0; i < w * h; i++) {
    const l = blobs.labels[i];
    if (l >= 0 && blobs.sizes[l] < blobMin) drive.d[i] = 0;
    if (drive.d[i]) drivePixels++;
  }
  if (drivePixels === 0) warnings.push('No drives detected. Check the selected region, wall contrast and drive width.');

  // --- skeleton -> graph ---------------------------------------------------------------
  const D2 = edt(w, h, (i) => drive.d[i] === 0); // half-width inside the cleaned drive mask
  const sk = zhangSuen(drive);
  const graph = skeletonToGraph(sk, D2);
  cleanupGraph(graph, {
    driveWidth,
    spurLength: params.spurFactor * driveWidth,
    mergeDistance: driveWidth * 1.6,
    minComponentLength: driveWidth * 3,
    minMeanHalfWidth: half * 0.35,
    simplifyTolerance: Math.max(0.75, params.simplifyFactor * driveWidth),
  });
  let network = graphToNetwork(graph, Math.max(0.75, params.simplifyFactor * driveWidth));
  if (params.bridgeGapFactor > 0) {
    const b = bridgeGaps(network, wallInk, region, driveWidth, params.bridgeGapFactor);
    network = b.net;
  }
  // shift back to full-image coordinates
  for (const n of network.nodes) { n.x += x0; n.y += y0; }
  for (const e of network.edges) e.points = e.points.map((p) => [p[0] + x0, p[1] + y0] as Vec2);

  // --- stopes ---------------------------------------------------------------------------
  if (params.detectStopes) {
    network.stopes = detectStopes({ image, x0, y0, w, h, region, sat, lum, driveWidth, params }).map((s) => ({
      ...s,
      polygon: s.polygon.map((p) => [p[0] + x0, p[1] + y0] as Vec2),
    }));
  }

  // --- overlay ----------------------------------------------------------------------------
  let maskPng: string | undefined;
  if (input.withMask) {
    const rgba = new Uint8Array(image.width * image.height * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = ((y + y0) * image.width + (x + x0)) * 4;
        if (sk.d[i]) { rgba[o] = 230; rgba[o + 1] = 40; rgba[o + 2] = 40; rgba[o + 3] = 230; }
        else if (drive.d[i]) { rgba[o] = 0; rgba[o + 1] = 170; rgba[o + 2] = 255; rgba[o + 3] = 95; }
        else if (wall.d[i] && region.d[i]) { rgba[o] = 40; rgba[o + 1] = 40; rgba[o + 2] = 120; rgba[o + 3] = 70; }
      }
    maskPng = 'data:image/png;base64,' + encodePng(image.width, image.height, rgba).toString('base64');
  }

  const totalLengthPx = network.edges.reduce((s, e) => s + polylineLength(e.points), 0);
  return {
    network,
    driveWidthPx: Math.round(driveWidth * 10) / 10,
    maskPng,
    stats: {
      wallPixels,
      drivePixels,
      nodes: network.nodes.length,
      edges: network.edges.length,
      stopes: network.stopes.length,
      totalLengthPx: Math.round(totalLengthPx),
      ms: Date.now() - t0,
    },
    warnings,
  };
}

/** Most common medial-axis distance among free-space ridge pixels = drive half-width. */
export function estimateDriveWidth(D: Float32Array, free: Mask, w: number, h: number): number {
  const bins = new Float64Array(160); // 0.5 px bins up to 80 px half-width
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!free.d[i]) continue;
      const v = D[i];
      if (v < 1.5) continue;
      if (v < D[i - 1] || v < D[i + 1] || v < D[i - w] || v < D[i + w]) continue;
      const b = Math.min(bins.length - 1, Math.floor(v * 2));
      bins[b] += 1;
    }
  // smooth histogram and take the first strong peak
  const sm = new Float64Array(bins.length);
  for (let i = 0; i < bins.length; i++) sm[i] = (bins[i - 1] ?? 0) * 0.25 + bins[i] * 0.5 + (bins[i + 1] ?? 0) * 0.25;
  let best = -1, bestV = 0;
  for (let i = 3; i < sm.length - 1; i++) if (sm[i] > bestV) { bestV = sm[i]; best = i; }
  if (best < 0) return 0;
  const halfWidth = (best + 0.5) / 2;
  return halfWidth * 2;
}
