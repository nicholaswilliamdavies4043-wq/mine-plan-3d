import * as THREE from 'three';
import { orientationMatrix, type AssetCategory, type AssetConnector, type AssetMeta, type ForwardAxis, type Side, type UpAxis, type Vec3 } from '@mineplan/shared';

export interface FrameInfo {
  min: Vec3;
  max: Vec3;
}

/** Wrap a model so that it is shown in the corrected frame (unit scale, up axis and forward applied). */
export function orientedWrapper(scene: THREE.Object3D, meta: Pick<AssetMeta, 'unitScale' | 'upAxis' | 'forward'>): THREE.Group {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.fromArray(orientationMatrix(meta));
  g.add(scene);
  g.updateMatrixWorld(true);
  return g;
}

export function bboxOf(obj: THREE.Object3D): FrameInfo {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj, true);
  if (b.isEmpty()) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 };
}

const SIDES: Side[] = ['+X', '-X', '+Z', '-Z'];

/**
 * Detect which bounding-box sides are tunnel openings by casting rays inward through the
 * expected opening area. An opening lets rays travel deep into the model; a closed side stops
 * them at the surface.
 */
export function detectOpenings(obj: THREE.Object3D, box: FrameInfo): Side[] {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
  obj.updateMatrixWorld(true);
  const lx = x1 - x0, ly = y1 - y0, lz = z1 - z0;
  if (lx <= 0 || ly <= 0 || lz <= 0) return [];
  const meshes: THREE.Object3D[] = [];
  const restore: [THREE.Material, THREE.Side][] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes.push(o);
    // single-sided tunnel walls usually face inwards; rays from outside must hit them too
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { restore.push([mat, mat.side]); mat.side = THREE.DoubleSide; }
  });
  try {
    return castOpenings(meshes, box, lx, ly, lz);
  } finally {
    for (const [mat, side] of restore) mat.side = side;
  }
}

function castOpenings(meshes: THREE.Object3D[], box: FrameInfo, lx: number, ly: number, lz: number): Side[] {
  const [x0, y0, z0] = box.min, [x1, , z1] = box.max;
  const ray = new THREE.Raycaster();
  const open: Side[] = [];
  for (const side of SIDES) {
    const alongX = side.endsWith('X');
    const sign = side.startsWith('+') ? 1 : -1;
    const depth = alongX ? lx : lz;
    const lateral = alongX ? [z0, z1] : [x0, x1];
    let deep = 0, total = 0;
    for (let i = 1; i <= 4; i++) {
      for (let j = 1; j <= 3; j++) {
        const t = 0.3 + (0.4 * i) / 5; // central 40% of the width
        const lat = lateral[0] + (lateral[1] - lateral[0]) * t;
        const y = y0 + ly * (0.15 + 0.15 * j);
        const origin = alongX ? new THREE.Vector3(sign > 0 ? x1 + 1 : x0 - 1, y, lat) : new THREE.Vector3(lat, y, sign > 0 ? z1 + 1 : z0 - 1);
        const dir = alongX ? new THREE.Vector3(-sign, 0, 0) : new THREE.Vector3(0, 0, -sign);
        ray.set(origin, dir);
        ray.far = depth + 2;
        const hit = ray.intersectObjects(meshes, true)[0];
        total++;
        if (!hit || hit.distance - 1 > depth * 0.3) deep++;
      }
    }
    if (deep / total >= 0.6) open.push(side);
  }
  return open;
}

/** Suggest forward axis and category from openings found in the up-corrected (+X forward) frame. */
export function suggestFromOpenings(open: Side[]): { forward: ForwardAxis; category: AssetCategory } | null {
  const has = (s: Side) => open.includes(s);
  const xPair = has('+X') && has('-X');
  const zPair = has('+Z') && has('-Z');
  if (open.length === 4) return { forward: '+X', category: 'junctionX' };
  if (open.length === 3) {
    if (xPair) return { forward: '+X', category: 'junctionT' };
    if (zPair) return { forward: '+Z', category: 'junctionT' };
  }
  if (open.length === 2) {
    if (xPair) return { forward: '+X', category: 'straight' };
    if (zPair) return { forward: '+Z', category: 'straight' };
    return { forward: has('-X') || has('+X') ? '+X' : '+Z', category: 'curve' };
  }
  if (open.length === 1) {
    // dead end: canonical frame has the opening at -X (start) and the face at +X
    const map: Record<Side, ForwardAxis> = { '-X': '+X', '+X': '-X', '-Z': '+Z', '+Z': '-Z' };
    return { forward: map[open[0]], category: 'deadEnd' };
  }
  return null;
}

export function autoPivot(category: AssetCategory, box: FrameInfo): Vec3 {
  const [x0, y0, z0] = box.min, [x1, , z1] = box.max;
  const startAnchored = category === 'straight' || category === 'deadEnd' || category === 'entrance';
  return [startAnchored ? x0 : (x0 + x1) / 2, y0, (z0 + z1) / 2];
}

export function connectorsFor(open: Side[], box: FrameInfo, pivot: Vec3, connectionType: string): AssetConnector[] {
  return open.map((side) => {
    const d =
      side === '+X' ? box.max[0] - pivot[0] :
      side === '-X' ? pivot[0] - box.min[0] :
      side === '+Z' ? box.max[2] - pivot[2] : pivot[2] - box.min[2];
    return { side, distance: Math.round(d * 1000) / 1000, connectionType };
  });
}

export const defaultMeta = (): AssetMeta => ({
  unitScale: 1,
  upAxis: 'Y' as UpAxis,
  forward: '+X',
  pivot: [0, 0, 0],
  dims: { length: 0, height: 0, width: 0 },
  crossSection: { width: 0, height: 0 },
  connectionType: 'drive',
  connectors: [],
  fitToDriveWidth: true,
});
