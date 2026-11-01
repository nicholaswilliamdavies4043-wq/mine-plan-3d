import path from 'node:path';
import type { GltfValidationReport } from '@mineplan/shared';

export interface UploadedFile {
  name: string; // original file name (may include a relative path)
  data: Buffer;
}

export interface ValidationOutput {
  report: GltfValidationReport;
  mainFile?: string;
  /** stored relative path for each uploaded file (resource URIs keep their relative paths) */
  paths: Map<UploadedFile, string>;
}

const SUPPORTED_EXTENSIONS = new Set([
  'KHR_materials_emissive_strength', 'KHR_materials_transmission', 'KHR_materials_clearcoat', 'KHR_materials_ior',
  'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_unlit', 'KHR_materials_volume', 'KHR_materials_iridescence',
  'KHR_materials_anisotropy', 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_draco_mesh_compression',
  'KHR_lights_punctual', 'EXT_meshopt_compression', 'EXT_mesh_gpu_instancing', 'EXT_texture_webp', 'KHR_materials_pbrSpecularGlossiness',
]);

function parseGlb(buf: Buffer, errors: string[]): { json: any; hasBin: boolean } | null {
  if (buf.length < 20) { errors.push('GLB file is too small.'); return null; }
  if (buf.readUInt32LE(0) !== 0x46546c67) { errors.push('Not a binary glTF (bad magic).'); return null; }
  const version = buf.readUInt32LE(4);
  if (version !== 2) { errors.push(`Unsupported GLB version ${version} (only glTF 2.0 is supported).`); return null; }
  const length = buf.readUInt32LE(8);
  if (length > buf.length) { errors.push(`GLB is truncated (header says ${length} bytes, file has ${buf.length}).`); return null; }
  let offset = 12;
  let json: any = null;
  let hasBin = false;
  while (offset + 8 <= length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + chunkLen > length) { errors.push('GLB chunk extends past end of file.'); return null; }
    if (chunkType === 0x4e4f534a) {
      try { json = JSON.parse(buf.subarray(start, start + chunkLen).toString('utf8')); } catch { errors.push('GLB JSON chunk is not valid JSON.'); return null; }
    } else if (chunkType === 0x004e4942) hasBin = true;
    offset = start + chunkLen;
  }
  if (!json) { errors.push('GLB has no JSON chunk.'); return null; }
  return { json, hasBin };
}

function countTriangles(json: any): number | undefined {
  try {
    let t = 0;
    for (const m of json.meshes ?? [])
      for (const p of m.primitives ?? []) {
        const mode = p.mode ?? 4;
        if (mode !== 4) continue;
        const acc = p.indices !== undefined ? json.accessors?.[p.indices] : json.accessors?.[p.attributes?.POSITION];
        if (acc) t += Math.floor(acc.count / 3);
      }
    return t;
  } catch {
    return undefined;
  }
}

/** Validate an uploaded set of files forming one glTF asset (.glb, or .gltf + .bin + textures). */
export function validateGltf(files: UploadedFile[]): ValidationOutput {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];
  const paths = new Map<UploadedFile, string>();
  const ext = (f: UploadedFile) => path.extname(f.name).toLowerCase();
  const mains = files.filter((f) => ext(f) === '.glb' || ext(f) === '.gltf');
  const empty: GltfValidationReport = { ok: false, format: 'unknown', errors, warnings, missingResources: missing, meshes: 0, materials: 0, textures: 0 };

  if (mains.length === 0) {
    const other = files.map((f) => ext(f)).filter((e) => ['.obj', '.fbx', '.stl', '.dae', '.3ds', '.blend'].includes(e));
    errors.push(
      other.length
        ? `Found ${other.join(', ')} but no .glb/.gltf. Use the in-app converter (OBJ/FBX/STL) or export glTF 2.0 from Blender.`
        : 'No .glb or .gltf file found.'
    );
    return { report: empty, paths };
  }
  if (mains.length > 1) {
    errors.push(`Upload one model per asset (found ${mains.map((m) => m.name).join(', ')}).`);
    return { report: empty, paths };
  }
  const main = mains[0];
  const mainName = path.basename(main.name);
  paths.set(main, mainName);
  let json: any;
  let format: 'glb' | 'gltf';
  let hasBin = false;
  if (ext(main) === '.glb') {
    format = 'glb';
    const r = parseGlb(main.data, errors);
    if (!r) return { report: { ...empty, format }, paths };
    json = r.json;
    hasBin = r.hasBin;
  } else {
    format = 'gltf';
    try {
      json = JSON.parse(main.data.toString('utf8'));
    } catch {
      errors.push('.gltf file is not valid JSON.');
      return { report: { ...empty, format }, paths };
    }
  }

  const ver = json?.asset?.version;
  if (typeof ver !== 'string' || !ver.startsWith('2.')) errors.push(`glTF asset.version is "${ver}", expected 2.0.`);
  for (const e of json.extensionsRequired ?? []) {
    if (!SUPPORTED_EXTENSIONS.has(e)) errors.push(`Required extension ${e} is not supported by the viewer.`);
  }
  for (const e of json.extensionsUsed ?? []) {
    if (!SUPPORTED_EXTENSIONS.has(e) && !(json.extensionsRequired ?? []).includes(e)) warnings.push(`Extension ${e} will be ignored.`);
  }
  if (!json.meshes?.length) errors.push('The model contains no meshes.');

  // external resources
  const byName = new Map<string, UploadedFile>();
  for (const f of files) if (f !== main) {
    byName.set(f.name.replace(/\\/g, '/'), f);
    byName.set(path.basename(f.name), f);
  }
  const used = new Set<UploadedFile>();
  const resolve = (uri: string, kind: string) => {
    if (uri.startsWith('data:')) return;
    if (/^[a-z]+:\/\//i.test(uri)) { warnings.push(`${kind} references a remote URL (${uri}); it will be fetched at runtime.`); return; }
    const decoded = decodeURIComponent(uri).replace(/\\/g, '/');
    if (decoded.includes('..')) { errors.push(`${kind} URI "${uri}" points outside the asset folder.`); return; }
    const f = byName.get(decoded) ?? byName.get(path.posix.basename(decoded));
    if (!f) { missing.push(decoded); return; }
    paths.set(f, decoded);
    used.add(f);
  };
  (json.buffers ?? []).forEach((b: any, i: number) => {
    if (b.uri) resolve(b.uri, `Buffer ${i}`);
    else if (format === 'gltf') errors.push(`Buffer ${i} has no uri.`);
    else if (!hasBin) errors.push('GLB references a binary chunk that is missing.');
  });
  (json.images ?? []).forEach((im: any, i: number) => {
    if (im.uri) resolve(im.uri, `Image ${i}`);
  });
  if (missing.length) errors.push(`Missing resources: ${missing.join(', ')}. Add them to the upload.`);
  for (const f of files) {
    if (f === main || used.has(f)) continue;
    warnings.push(`${f.name} is not referenced by the model and will be stored but unused.`);
    paths.set(f, 'extra/' + path.basename(f.name));
  }

  const report: GltfValidationReport = {
    ok: errors.length === 0,
    format,
    errors,
    warnings,
    missingResources: missing,
    meshes: json.meshes?.length ?? 0,
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    triangles: countTriangles(json),
  };
  if ((report.triangles ?? 0) > 500_000) warnings.push(`High polygon count (${report.triangles} triangles). Consider decimating modular pieces for performance.`);
  return { report, mainFile: mainName, paths };
}

export function mimeFor(name: string): string {
  switch (path.extname(name).toLowerCase()) {
    case '.glb': return 'model/gltf-binary';
    case '.gltf': return 'model/gltf+json';
    case '.bin': return 'application/octet-stream';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.ktx2': return 'image/ktx2';
    default: return 'application/octet-stream';
  }
}
