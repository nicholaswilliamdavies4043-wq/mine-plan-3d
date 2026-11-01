import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Draco-compressed meshes need the decoder. Self-host by copying three/examples/jsm/libs/draco into client/public/draco
// and setting VITE_DRACO_PATH=/draco/ if the CDN is blocked.
const DRACO_PATH = (import.meta as any).env?.VITE_DRACO_PATH || 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

function makeGltfLoader(manager?: THREE.LoadingManager) {
  const loader = new GLTFLoader(manager);
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

const cache = new Map<string, Promise<GLTF>>();

/** Load (and cache) a glTF/GLB from a URL. */
export function loadGltfUrl(url: string): Promise<GLTF> {
  if (!cache.has(url)) cache.set(url, makeGltfLoader().loadAsync(url));
  return cache.get(url)!;
}

/**
 * Load a glTF from a set of local files (before upload). External buffers/textures are resolved by
 * matching the referenced URI to the selected files by relative path or file name.
 */
export async function loadGltfFromFiles(main: File, all: File[]): Promise<{ gltf: GLTF; missing: string[] }> {
  const urls = new Map<string, string>();
  for (const f of all) urls.set(f.name, URL.createObjectURL(f));
  const missing: string[] = [];
  const manager = new THREE.LoadingManager();
  const mainUrl = urls.get(main.name)!;
  manager.setURLModifier((url) => {
    if (url === mainUrl || url.startsWith('data:') || url.startsWith('blob:')) return url;
    const name = decodeURIComponent(url.split('/').pop() ?? url);
    const hit = urls.get(name);
    if (!hit) missing.push(name);
    return hit ?? url;
  });
  const gltf = await makeGltfLoader(manager).loadAsync(mainUrl);
  return { gltf, missing };
}

/**
 * Conversion workflow for non-glTF formats: load OBJ (+MTL), FBX or STL in the browser and export
 * a GLB File, which then goes through the normal import wizard.
 */
export async function convertToGlb(main: File, all: File[]): Promise<File> {
  const ext = main.name.split('.').pop()!.toLowerCase();
  const url = URL.createObjectURL(main);
  let object: THREE.Object3D;
  if (ext === 'obj') {
    const loader = new OBJLoader();
    const mtlFile = all.find((f) => f.name.toLowerCase().endsWith('.mtl'));
    if (mtlFile) {
      const urls = new Map(all.map((f) => [f.name, URL.createObjectURL(f)]));
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((u) => urls.get(decodeURIComponent(u.split('/').pop() ?? u)) ?? u);
      const mtl = await new MTLLoader(manager).loadAsync(urls.get(mtlFile.name)!);
      mtl.preload();
      loader.setMaterials(mtl);
    }
    object = await loader.loadAsync(url);
  } else if (ext === 'fbx') {
    object = await new FBXLoader().loadAsync(url);
  } else if (ext === 'stl') {
    const geom = await new STLLoader().loadAsync(url);
    geom.computeVertexNormals();
    object = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 }));
  } else {
    throw new Error(`Cannot convert .${ext}. Supported: OBJ, FBX, STL. For other formats export glTF 2.0 from Blender.`);
  }
  const glb = await exportGlb(object);
  return new File([glb], main.name.replace(/\.[^.]+$/, '') + '.glb', { type: 'model/gltf-binary' });
}

export async function exportGlb(object: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true, onlyVisible: true });
  return result as ArrayBuffer;
}

export function downloadBlob(data: BlobPart, filename: string, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
