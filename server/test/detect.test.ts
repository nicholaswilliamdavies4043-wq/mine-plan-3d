import { describe, expect, it } from 'vitest';
import { degreeMap } from '@mineplan/shared';
import { detectNetwork } from '../src/processing/detect';
import type { RGBAImage } from '../src/processing/raster';

/** Draw a synthetic plan: a T-shaped drive outlined with 2px grey-blue walls on white paper. */
function syntheticT(): RGBAImage {
  const W = 400, H = 300;
  const data = new Uint8Array(W * H * 4).fill(255);
  const inside = (x: number, y: number) =>
    (y >= 100 && y < 112 && x >= 40 && x < 360) || // horizontal drive, 12 px wide
    (x >= 194 && x < 206 && y >= 100 && y < 260); // vertical drive
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (inside(x, y)) continue;
      let nearInside = false;
      for (let dy = -2; dy <= 2 && !nearInside; dy++)
        for (let dx = -2; dx <= 2; dx++) if (inside(x + dx, y + dy)) { nearInside = true; break; }
      if (nearInside) {
        const o = (y * W + x) * 4;
        data[o] = 150; data[o + 1] = 155; data[o + 2] = 165;
      }
    }
  // a text label inside the vertical drive
  for (let y = 180; y < 186; y++) for (let x = 198; x < 202; x++) { const o = (y * W + x) * 4; data[o] = data[o + 1] = data[o + 2] = 20; }
  return { width: W, height: H, data };
}

describe('drive detection', () => {
  it('extracts a T junction with three dead ends from a synthetic plan', () => {
    const res = detectNetwork({ image: syntheticT(), regions: [], excludes: [] });
    const deg = degreeMap(res.network);
    const degs = [...deg.values()].sort();
    expect(degs.filter((d) => d === 1).length).toBe(3);
    expect(degs.filter((d) => d === 3).length).toBe(1);
    expect(res.driveWidthPx).toBeGreaterThan(9);
    expect(res.driveWidthPx).toBeLessThan(17);
    // total centreline length ~ 320 + 150
    expect(res.stats.totalLengthPx).toBeGreaterThan(400);
    expect(res.stats.totalLengthPx).toBeLessThan(500);
  });

  it('only models the selected portion of the plan', () => {
    const res = detectNetwork({ image: syntheticT(), regions: [[[30, 90], [150, 90], [150, 125], [30, 125]]], excludes: [] });
    expect(res.network.edges.length).toBe(1);
    for (const n of res.network.nodes) expect(n.x).toBeLessThan(152);
  });
});
