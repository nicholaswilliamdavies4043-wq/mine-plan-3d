/**
 * Run drive detection on a plan image and write a debug overlay.
 *   npx tsx server/scripts/detect-sample.ts <plan.jpg> [out.png] [x0,y0,x1,y1 region] [exclude x0,y0,x1,y1;...]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Polygon } from '@mineplan/shared';
import { decodeImage, encodePng } from '../src/processing/raster';
import { detectNetwork } from '../src/processing/detect';

const [, , inPath, outArg, regionArg, excludeArg] = process.argv;
if (!inPath) {
  console.error('usage: detect-sample <plan.jpg> [out.png] [x0,y0,x1,y1] [x0,y0,x1,y1;...]');
  process.exit(1);
}
const rect = (s: string): Polygon => {
  const [a, b, c, d] = s.split(',').map(Number);
  return [[a, b], [c, b], [c, d], [a, d]];
};
const img = decodeImage(fs.readFileSync(inPath));
const regions = regionArg ? [rect(regionArg)] : [];
const excludes = excludeArg ? excludeArg.split(';').filter(Boolean).map(rect) : [];
const res = detectNetwork({ image: img, regions, excludes, withMask: false });
console.log(JSON.stringify({ driveWidthPx: res.driveWidthPx, stats: res.stats, warnings: res.warnings }, null, 2));

// overlay: faded plan + network
const out = new Uint8Array(img.data.length);
for (let i = 0; i < img.data.length; i += 4) {
  out[i] = 255 - (255 - img.data[i]) * 0.45;
  out[i + 1] = 255 - (255 - img.data[i + 1]) * 0.45;
  out[i + 2] = 255 - (255 - img.data[i + 2]) * 0.45;
  out[i + 3] = 255;
}
const put = (x: number, y: number, c: number[]) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
};
const line = (a: number[], b: number[], c: number[]) => {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2) + 1;
  for (let k = 0; k <= n; k++) put(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, c);
};
for (const s of res.network.stopes) for (let i = 0; i < s.polygon.length; i++) line(s.polygon[i], s.polygon[(i + 1) % s.polygon.length], [200, 0, 200]);
for (const e of res.network.edges) for (let i = 1; i < e.points.length; i++) line(e.points[i - 1], e.points[i], [230, 30, 30]);
const deg = new Map<string, number>();
for (const e of res.network.edges) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
for (const n of res.network.nodes) {
  const c = (deg.get(n.id) ?? 0) === 1 ? [0, 160, 0] : [0, 0, 230];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(n.x + dx, n.y + dy, c);
}
const outPath = outArg || path.join('debug', 'detect-overlay.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, encodePng(img.width, img.height, out));
console.log('overlay ->', outPath);
