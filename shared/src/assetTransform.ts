import type { AssetMeta, ForwardAxis, UpAxis, Vec3 } from './types';

/** Column-major 4x4 matrix (same layout as THREE.Matrix4.elements). */
export type Mat4 = number[];

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = s;
    }
  return r;
}

export const scaleM = (x: number, y: number, z: number): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
export const translateM = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export function rotYM(th: number): Mat4 {
  const c = Math.cos(th), s = Math.sin(th);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
export function rotXM(th: number): Mat4 {
  const c = Math.cos(th), s = Math.sin(th);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

export function upRotation(up: UpAxis): Mat4 {
  return up === 'Z' ? rotXM(-Math.PI / 2) : identity();
}

export function forwardRotation(f: ForwardAxis): Mat4 {
  switch (f) {
    case '+X': return identity();
    case '-X': return rotYM(Math.PI);
    case '+Z': return rotYM(Math.PI / 2);
    case '-Z': return rotYM(-Math.PI / 2);
  }
}

/** Orientation + unit scale only (no pivot). */
export function orientationMatrix(meta: Pick<AssetMeta, 'unitScale' | 'upAxis' | 'forward'>): Mat4 {
  return multiply(forwardRotation(meta.forward), multiply(upRotation(meta.upAxis), scaleM(meta.unitScale, meta.unitScale, meta.unitScale)));
}

/** Full normalisation: model space -> canonical asset frame (+X forward, +Y up, origin at pivot). */
export function normalisationMatrix(meta: Pick<AssetMeta, 'unitScale' | 'upAxis' | 'forward' | 'pivot'>): Mat4 {
  const p: Vec3 = meta.pivot;
  return multiply(translateM(-p[0], -p[1], -p[2]), orientationMatrix(meta));
}

/**
 * Item orientation as three.js Euler angles (radians, order 'YZX'): heading about the vertical
 * axis first, then pitch about the item's width axis (Z), then roll about its length axis (X).
 */
export function itemEuler(item: { rotationDeg: number; pitchDeg?: number; rollDeg?: number }): [number, number, number, 'YZX'] {
  const r = Math.PI / 180;
  return [(item.rollDeg ?? 0) * r, item.rotationDeg * r, (item.pitchDeg ?? 0) * r, 'YZX'];
}

/** Placement matrix T(position) * Ry(rot) * S(scale). */
export function placementMatrix(position: Vec3, rotationY: number, scale: Vec3): Mat4 {
  return multiply(translateM(position[0], position[1], position[2]), multiply(rotYM(rotationY), scaleM(scale[0], scale[1], scale[2])));
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export const UNIT_OPTIONS: { label: string; value: number }[] = [
  { label: 'Metres', value: 1 },
  { label: 'Centimetres', value: 0.01 },
  { label: 'Millimetres', value: 0.001 },
  { label: 'Feet', value: 0.3048 },
  { label: 'Inches', value: 0.0254 },
];
