import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { Polygon } from '@mineplan/shared';

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

export function sniffMime(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

export function decodeImage(buf: Buffer): RGBAImage {
  const mime = sniffMime(buf);
  if (mime === 'image/png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length) };
  }
  if (mime === 'image/jpeg') {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 4096, maxResolutionInMP: 400 });
    return { width: img.width, height: img.height, data: img.data as Uint8Array };
  }
  throw new Error('Unsupported image format. Upload a PNG or JPEG plan (export PDF/DWG plans to PNG first).');
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  return PNG.sync.write(png, { colorType: 6 });
}

/** Binary mask helper type: 1 byte per pixel, 0/1. */
export interface Mask {
  w: number;
  h: number;
  d: Uint8Array;
}

export const newMask = (w: number, h: number): Mask => ({ w, h, d: new Uint8Array(w * h) });

/** Rasterise polygons (union, even-odd per polygon) into a mask. Coordinates relative to the mask origin. */
export function fillPolygons(mask: Mask, polys: Polygon[], value = 1): void {
  const { w, h, d } = mask;
  for (const poly of polys) {
    if (poly.length < 3) continue;
    let minY = Infinity, maxY = -Infinity;
    for (const p of poly) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if ((yi > sy) !== (yj > sy)) xs.push(xi + ((sy - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) d[y * w + x] = value;
      }
    }
  }
}
