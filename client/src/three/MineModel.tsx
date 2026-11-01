import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  fitSimilarity, multiply, normalisationMatrix, placementMatrix, pxToWorld,
  type Asset, type Assembly, type Piece, type Plan, type TunnelProfile,
} from '@mineplan/shared';
import { capGeometry, hubsGeometry, rockTexture, straightGeometry } from './builtinKit';
import { loadGltfUrl } from './loaders';
import { api } from '../api';

const tmp = new THREE.Matrix4();

function useRockMaterials() {
  return useMemo(() => {
    const wallTex = rockTexture(3, [128, 118, 104]);
    const floorTex = rockTexture(7, [92, 86, 78]);
    const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, metalness: 0, side: THREE.FrontSide });
    const floor = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1, metalness: 0, side: THREE.FrontSide });
    return { wall, floor };
  }, []);
}

/** Instanced built-in modules (straights and end walls). */
function BuiltinPieces({ pieces, profile, materials }: { pieces: Piece[]; profile: TunnelProfile; materials: { wall: THREE.Material; floor: THREE.Material } }) {
  const straights = useMemo(() => pieces.filter((p) => p.source === 'builtin-straight'), [pieces]);
  const caps = useMemo(() => pieces.filter((p) => p.source === 'builtin-cap'), [pieces]);
  const straightGeom = useMemo(() => straightGeometry(profile), [profile.wallHeight, profile.archRise]);
  const capGeom = useMemo(() => capGeometry(profile), [profile.wallHeight, profile.archRise]);

  const straightMesh = useMemo(() => {
    if (!straights.length) return null;
    const m = new THREE.InstancedMesh(straightGeom, [materials.wall, materials.floor], straights.length);
    straights.forEach((p, i) => m.setMatrixAt(i, tmp.fromArray(placementMatrix(p.position, p.rotationY, p.scale))));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.name = 'drives';
    return m;
  }, [straights, straightGeom, materials]);

  const capMesh = useMemo(() => {
    if (!caps.length) return null;
    const m = new THREE.InstancedMesh(capGeom, materials.wall, caps.length);
    caps.forEach((p, i) => m.setMatrixAt(i, tmp.fromArray(placementMatrix(p.position, p.rotationY, p.scale))));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.name = 'faces';
    return m;
  }, [caps, capGeom, materials]);

  return (
    <>
      {straightMesh && <primitive object={straightMesh} />}
      {capMesh && <primitive object={capMesh} />}
    </>
  );
}

/** One imported asset, instanced for every placement that uses it (one InstancedMesh per sub-mesh). */
function AssetPieces({ asset, pieces, onError }: { asset: Asset; pieces: Piece[]; onError: (msg: string) => void }) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    loadGltfUrl(api.assetFileUrl(asset)).then((gltf) => {
      if (!alive) return;
      const g = new THREE.Group();
      g.name = asset.name;
      const norm = normalisationMatrix(asset.meta);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const local = multiply(norm, mesh.matrixWorld.toArray());
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, pieces.length);
        pieces.forEach((p, i) => inst.setMatrixAt(i, tmp.fromArray(multiply(placementMatrix(p.position, p.rotationY, p.scale), local))));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.castShadow = inst.receiveShadow = false;
        g.add(inst);
      });
      setGroup(g);
    }).catch((e) => onError(`${asset.name}: ${e.message ?? e}`));
    return () => { alive = false; };
  }, [asset, pieces]);
  return group ? <primitive object={group} /> : null;
}

function Hubs({ assembly, profile, materials }: { assembly: Assembly; profile: TunnelProfile; materials: { wall: THREE.Material; floor: THREE.Material } }) {
  const geom = useMemo(() => hubsGeometry(assembly.hubs, profile), [assembly.hubs, profile]);
  if (!assembly.hubs.length) return null;
  return <mesh geometry={geom} material={[materials.wall, materials.floor]} name="connectors" />;
}

function Stopes({ assembly }: { assembly: Assembly }) {
  const meshes = useMemo(() => assembly.stopes.map((s) => {
    const shape = new THREE.Shape(s.polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.1, s.height), bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, s.yBase, 0);
    return { id: s.id, g, edges: new THREE.EdgesGeometry(g, 20) };
  }), [assembly.stopes]);
  return (
    <group name="stopes">
      {meshes.map((m) => (
        <group key={m.id}>
          <mesh geometry={m.g}>
            <meshStandardMaterial color="#a08c64" transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <lineSegments geometry={m.edges}>
            <lineBasicMaterial color="#beaf93" />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

/** The original plan image draped on the level floor for reference. */
function PlanUnderlay({ plan, origin, opacity }: { plan: Plan; origin: Assembly['origin']; opacity: number }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    new THREE.TextureLoader().load(api.planImageUrl(plan.id), (t) => { t.colorSpace = THREE.SRGBColorSpace; setTex(t); });
  }, [plan.id]);
  const geom = useMemo(() => {
    const sim = fitSimilarity(plan.georef);
    const corners: [number, number][] = [[0, 0], [plan.imageWidth, 0], [plan.imageWidth, plan.imageHeight], [0, plan.imageHeight]];
    const y = plan.levelRL - origin.RL - 0.08;
    const pts = corners.map((c) => {
      const w = pxToWorld(sim, c);
      return [w[0] - origin.E, y, -(w[1] - origin.N)];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  }, [plan, origin]);
  if (!tex) return null;
  return (
    <mesh geometry={geom} renderOrder={-1}>
      <meshBasicMaterial map={tex} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

export function MineModel(props: {
  assembly: Assembly;
  profile: TunnelProfile;
  assets: Map<string, Asset>;
  plans: Plan[];
  showStopes: boolean;
  underlayOpacity: number;
  onAssetError: (msg: string) => void;
}) {
  const { assembly, profile, assets } = props;
  const materials = useRockMaterials();
  const byAsset = useMemo(() => {
    const m = new Map<string, Piece[]>();
    for (const p of assembly.pieces) {
      if (p.source !== 'asset' || !p.assetId) continue;
      if (!m.has(p.assetId)) m.set(p.assetId, []);
      m.get(p.assetId)!.push(p);
    }
    return m;
  }, [assembly]);

  return (
    <group name="mine">
      <BuiltinPieces pieces={assembly.pieces} profile={profile} materials={materials} />
      <Hubs assembly={assembly} profile={profile} materials={materials} />
      {[...byAsset.entries()].map(([id, pieces]) => {
        const a = assets.get(id);
        return a ? <AssetPieces key={id} asset={a} pieces={pieces} onError={props.onAssetError} /> : null;
      })}
      {props.showStopes && <Stopes assembly={assembly} />}
      {props.underlayOpacity > 0 && props.plans.map((p) => <PlanUnderlay key={p.id} plan={p} origin={assembly.origin} opacity={props.underlayOpacity} />)}
    </group>
  );
}
