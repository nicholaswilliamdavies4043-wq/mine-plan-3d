import { useEffect, useMemo, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { clampToDrives, itemEuler, normalisationMatrix, type Asset, type Assembly, type PlacedItem, type Vec3 } from '@mineplan/shared';
import { api } from '../api';
import { loadGltfUrl } from './loaders';
import { Sign } from './Signs';

export type GizmoMode = 'translate' | 'rotate' | 'scale';
type Origin = Assembly['origin'];

/** World [E, N, RL] -> three.js local coordinates of the assembled model. */
export const worldToLocal = (o: Origin, p: Vec3): Vec3 => [p[0] - o.E, p[2] - o.RL, -(p[1] - o.N)];
/** three.js local -> world [E, N, RL]. */
export const localToWorld = (o: Origin, p: Vec3): Vec3 => [p[0] + o.E, -p[2] + o.N, p[1] + o.RL];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function ItemObject({ item, asset, origin, selected, onSelect, onRef }: {
  item: PlacedItem; asset: Asset; origin: Origin; selected: boolean;
  onSelect: (id: string) => void; onRef: (o: THREE.Object3D | null) => void;
}) {
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadGltfUrl(api.assetFileUrl(asset))
      .then((g) => { if (alive) setScene(g.scene.clone(true)); })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [asset.id]);
  const norm = useMemo(() => new THREE.Matrix4().fromArray(normalisationMatrix(asset.meta)), [asset.meta]);
  const local = worldToLocal(origin, item.position);
  const d = asset.meta.dims;
  const box = useMemo(() => {
    const g = new THREE.BoxGeometry(Math.max(d.length, 0.2), Math.max(d.height, 0.2), Math.max(d.width, 0.2));
    g.translate(0, Math.max(d.height, 0.2) / 2, 0);
    return new THREE.EdgesGeometry(g);
  }, [d.length, d.height, d.width]);

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // it was a drag, not a click
    e.stopPropagation();
    onSelect(item.id);
  };

  return (
    <group ref={onRef} position={local} rotation={itemEuler(item)} scale={item.scale} onClick={click}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      {scene && <group matrixAutoUpdate={false} matrix={norm}><primitive object={scene} /></group>}
      {(!scene || failed) && (
        <mesh position={[0, 0.75, 0]}>
          <boxGeometry args={[1.5, 1.5, 1.5]} />
          <meshStandardMaterial color={failed ? '#eb0d0d' : '#a08c64'} wireframe={!failed} />
        </mesh>
      )}
      {selected && (
        <lineSegments geometry={box}>
          <lineBasicMaterial color="#327dff" />
        </lineSegments>
      )}
    </group>
  );
}

export function PlacedItems({ items, assets, assembly, selectedId, mode, keepInDrive, onSelect, onChange }: {
  items: PlacedItem[];
  assets: Map<string, Asset>;
  assembly: Assembly;
  selectedId: string | null;
  mode: GizmoMode | null;
  keepInDrive: boolean;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<PlacedItem>) => void;
}) {
  const [objects] = useState(() => new Map<string, THREE.Object3D>());
  const [selectedObj, setSelectedObj] = useState<THREE.Object3D | null>(null);
  const origin = assembly.origin;

  useEffect(() => {
    setSelectedObj(selectedId ? objects.get(selectedId) ?? null : null);
  }, [selectedId, items.length]);

  const commit = () => {
    if (!selectedId || !selectedObj) return;
    const o = selectedObj;
    let x = o.position.x, z = o.position.z;
    if (keepInDrive && assembly.collision.length) {
      [x, z] = clampToDrives([x, z], o.position.y, assembly.collision, 0.3);
      o.position.x = x;
      o.position.z = z;
    }
    const w = localToWorld(origin, [x, o.position.y, z]);
    // heading, pitch and roll in the same order the item is drawn with (YZX): heading keeps its full
    // ±180° range, pitch is ±90°, roll ±180°
    const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'YZX');
    const deg = (rad: number) => Math.round(((rad * 180) / Math.PI) * 10) / 10;
    onChange(selectedId, {
      position: [r3(w[0]), r3(w[1]), r3(w[2])],
      rotationDeg: deg(e.y),
      pitchDeg: deg(e.z),
      rollDeg: deg(e.x),
      scale: [r3(Math.max(0.01, o.scale.x)), r3(Math.max(0.01, o.scale.y)), r3(Math.max(0.01, o.scale.z))],
    });
  };

  return (
    <group name="inventory">
      {items.map((it) => {
        const a = assets.get(it.assetId);
        if (!a) return null;
        const local = worldToLocal(origin, it.position);
        const top = Math.max(a.meta.dims.height, 1) * it.scale[1];
        return (
          <group key={it.id}>
            <ItemObject item={it} asset={a} origin={origin} selected={it.id === selectedId} onSelect={onSelect}
              onRef={(o) => {
                if (o) objects.set(it.id, o); else objects.delete(it.id);
                if (o && it.id === selectedId && selectedObj !== o) setSelectedObj(o);
              }} />
            {it.label && <Sign position={[local[0], local[1] + top + 0.6, local[2]]} text={it.label} height={0.55} accent="#327dff" />}
          </group>
        );
      })}
      {selectedObj && mode && (
        <TransformControls object={selectedObj} mode={mode} size={0.8}
          space={mode === 'translate' ? 'world' : 'local'} showX showY showZ onMouseUp={commit} />
      )}
    </group>
  );
}
