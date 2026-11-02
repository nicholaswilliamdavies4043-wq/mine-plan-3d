import type { ModelMeasurement, PlanMeasurement, Vec2, Vec3 } from './types';
import { polylineLength } from './geometry';

export type LengthUnit = 'm' | 'km' | 'ft' | 'cm';

export const LENGTH_UNITS: { value: LengthUnit; label: string; perMetre: number; digits: number }[] = [
  { value: 'm', label: 'metres', perMetre: 1, digits: 2 },
  { value: 'km', label: 'kilometres', perMetre: 0.001, digits: 3 },
  { value: 'ft', label: 'feet', perMetre: 1 / 0.3048, digits: 1 },
  { value: 'cm', label: 'centimetres', perMetre: 100, digits: 0 },
];

/** Convert metres to a unit. */
export function toUnit(m: number, unit: LengthUnit): number {
  return m * (LENGTH_UNITS.find((u) => u.value === unit)?.perMetre ?? 1);
}

/** Convert a value in a unit to metres. */
export function fromUnit(v: number, unit: LengthUnit): number {
  return v / (LENGTH_UNITS.find((u) => u.value === unit)?.perMetre ?? 1);
}

export function formatLength(m: number, unit: LengthUnit = 'm', digits?: number): string {
  const u = LENGTH_UNITS.find((x) => x.value === unit) ?? LENGTH_UNITS[0];
  return `${(m * u.perMetre).toFixed(digits ?? u.digits)} ${u.value}`;
}

/** 3D polyline length (metres). */
export function polylineLength3(pts: Vec3[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  return L;
}

/** Length in metres of a plan measurement, given the plan scale (metres per pixel). */
export function planMeasurementLength(m: Pick<PlanMeasurement, 'points'>, metersPerPixel: number): number {
  return polylineLength(m.points) * metersPerPixel;
}

/** Segment lengths in metres. */
export function segmentLengths2(pts: Vec2[], metersPerPixel: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) out.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * metersPerPixel);
  return out;
}

export function modelMeasurementLength(m: Pick<ModelMeasurement, 'points'>): number {
  return polylineLength3(m.points);
}

/** Scale from a known-distance calibration line, or null when the line is too short. */
export function scaleFromLine(a: Vec2, b: Vec2, distanceM: number): number | null {
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(px > 0.5) || !(distanceM > 0)) return null;
  return distanceM / px;
}

/** Palette for new measurements (same order as the plan calculator). */
export const MEASURE_COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#9F3FBA', '#BA7517', '#E24B4A', '#0F6E56', '#712B13'];

export interface MeasurementRow {
  label: string;
  type: string;
  source: string;
  segments: number;
  lengthM: number;
  pixels?: number;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV export of measurements, lengths in the chosen unit. */
export function measurementsCsv(rows: MeasurementRow[], unit: LengthUnit = 'm'): string {
  const lines = [['Label', 'Type', 'Source', 'Segments', 'Pixels', `Distance (${unit})`].join(',')];
  for (const r of rows) {
    lines.push([r.label, r.type, r.source, r.segments, r.pixels !== undefined ? r.pixels.toFixed(2) : '', toUnit(r.lengthM, unit).toFixed(4)].map(csvCell).join(','));
  }
  return lines.join('\n');
}
