import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  ASSET_CATEGORIES, UNIT_OPTIONS, normalisationMatrix, sideDir,
  type Asset, type AssetCategory, type AssetConnector, type AssetMeta, type ForwardAxis, type GltfValidationReport, type Side, type UpAxis, type Vec3,
} from '@mineplan/shared';
import { api } from '../api';
import { convertToGlb, loadGltfFromFiles, loadGltfUrl } from '../three/loaders';
import { InfoTip, L } from '../ui/help';
import { Icon } from '../ui/Icon';
import { autoPivot, bboxOf, connectorsFor, defaultMeta, detectOpenings, orientedWrapper, suggestFromOpenings, type FrameInfo } from './assetAnalysis';

interface Props {
  existing?: Asset;
  onClose: () => void;
  onSaved: (a: Asset) => void;
  /** Pre-select a category, e.g. 'item' when adding from the Inventory page. */
  presetCategory?: AssetCategory;
}

const SIDES: Side[] = ['+X', '-X', '+Z', '-Z'];

function Preview({ object, meta, box, onReady }: { object: THREE.Object3D | null; meta: AssetMeta; box: FrameInfo | null; onReady: (gl: THREE.WebGLRenderer) => void }) {
  const wrapper = useMemo(() => {
    if (!object) return null;
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.fromArray(normalisationMatrix(meta));
    g.add(object);
    return g;
  }, [object, meta.unitScale, meta.upAxis, meta.forward, meta.pivot[0], meta.pivot[1], meta.pivot[2]]);
  const size = box ? Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2], 1) : 10;
  const markers = meta.connectors.map((c) => {
    const d = sideDir(c.side);
    return { key: c.side, pos: [d[0] * c.distance, meta.crossSection.height / 2 || size / 4, d[1] * c.distance] as Vec3, rotY: Math.atan2(-d[1], d[0]) };
  });
  return (
    <Canvas camera={{ position: [size * 1.2, size * 0.9, size * 1.4], fov: 50, near: size / 1000, far: size * 100 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }} onCreated={({ gl }) => { gl.setClearColor(getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() || '#141210'); onReady(gl); }}>
      <hemisphereLight args={['#ffffff', '#444444', 1.4]} />
      <directionalLight position={[5, 10, 7]} intensity={1.5} />
      {wrapper && <primitive object={wrapper} />}
      <gridHelper args={[size * 3, 30, '#575757', '#343434']} />
      <axesHelper args={[size * 0.6]} />
      {markers.map((m) => (
        <mesh key={m.key} position={m.pos} rotation={[0, m.rotY, 0]}>
          <boxGeometry args={[0.02 * size, meta.crossSection.height || size / 2, meta.crossSection.width || size / 2]} />
          <meshBasicMaterial color="#327dff" transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <OrbitControls makeDefault target={[0, (box ? (box.max[1] - box.min[1]) / 2 : 0), 0]} />
    </Canvas>
  );
}

export function AssetImportWizard({ existing, onClose, onSaved, presetCategory }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [report, setReport] = useState<GltfValidationReport | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<AssetCategory>(existing?.category ?? presetCategory ?? 'straight');
  const [meta, setMeta] = useState<AssetMeta>(existing?.meta ?? { ...defaultMeta(), fitToDriveWidth: presetCategory !== 'item', connectionType: presetCategory === 'item' ? 'item' : 'drive' });
  const [pivotOffset, setPivotOffset] = useState<Vec3>([0, 0, 0]);
  const [sourceUrl, setSourceUrl] = useState(existing?.sourceUrl ?? '');
  const [license, setLicense] = useState(existing?.license ?? '');
  const [licenseConfirmed, setLicenseConfirmed] = useState(existing?.licenseConfirmed ?? false);
  const [tags, setTags] = useState((existing?.tags ?? []).join(', '));
  const [customUnit, setCustomUnit] = useState(false);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const [orientedBox, setOrientedBox] = useState<FrameInfo | null>(null);

  // load an existing asset for editing
  useEffect(() => {
    if (!existing) return;
    loadGltfUrl(api.assetFileUrl(existing)).then((g) => setObject(g.scene.clone(true))).catch((e) => setLoadErr(e.message));
  }, [existing]);

  // bounding box in the oriented (pre-pivot) frame
  useEffect(() => {
    if (!object) { setOrientedBox(null); return; }
    const w = orientedWrapper(object, meta);
    setOrientedBox(bboxOf(w));
    w.remove(object);
  }, [object, meta.unitScale, meta.upAxis, meta.forward]);

  // derived dims / pivot whenever the frame or category changes
  useEffect(() => {
    if (!orientedBox) return;
    const base = autoPivot(category, orientedBox);
    const pivot: Vec3 = [base[0] + pivotOffset[0], base[1] + pivotOffset[1], base[2] + pivotOffset[2]];
    const dims = {
      length: orientedBox.max[0] - orientedBox.min[0],
      height: orientedBox.max[1] - orientedBox.min[1],
      width: orientedBox.max[2] - orientedBox.min[2],
    };
    setMeta((m) => ({
      ...m, pivot, dims,
      crossSection: m.crossSection.width > 0 && existing ? m.crossSection : { width: round(category === 'straight' || category === 'deadEnd' ? dims.width : Math.min(dims.width, dims.length)), height: round(dims.height) },
      connectors: m.connectors.map((c) => ({ ...c, distance: connectorsFor([c.side], orientedBox, pivot, c.connectionType)[0].distance })),
    }));
  }, [orientedBox, category, pivotOffset[0], pivotOffset[1], pivotOffset[2]]);

  const pickFiles = async (list: FileList | null) => {
    if (!list || !list.length) return;
    setLoadErr(null);
    setReport(null);
    setObject(null);
    let all = Array.from(list);
    let main = all.find((f) => /\.(glb|gltf)$/i.test(f.name));
    try {
      if (!main) {
        const convertible = all.find((f) => /\.(obj|fbx|stl)$/i.test(f.name));
        if (!convertible) throw new Error('Select a .glb, or a .gltf with its .bin and textures. OBJ, FBX and STL are converted to GLB automatically.');
        setBusy(true);
        main = await convertToGlb(convertible, all);
        all = [main];
      }
      setFiles(all);
      if (!name) setName(main.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      const [{ gltf, missing }, rep] = await Promise.all([
        loadGltfFromFiles(main, all),
        api.validateAsset(all, all.map((f) => f.name)),
      ]);
      setReport(rep);
      if (missing.length) setLoadErr(`Missing resources: ${missing.join(', ')}`);
      setObject(gltf.scene);
    } catch (e: any) {
      setLoadErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const autoDetect = () => {
    if (!object) return;
    // 1) openings in the up-corrected frame with +X forward, to choose the forward axis and category
    const upOnly = orientedWrapper(object, { ...meta, forward: '+X' });
    const open0 = detectOpenings(upOnly, bboxOf(upOnly));
    upOnly.remove(object);
    const s = suggestFromOpenings(open0);
    const forward = s?.forward ?? meta.forward;
    const cat = s?.category ?? category;
    // 2) openings in the final frame become connectors
    const w = orientedWrapper(object, { ...meta, forward });
    const box = bboxOf(w);
    const open = detectOpenings(w, box);
    w.remove(object);
    const pivot = autoPivot(cat, box);
    setPivotOffset([0, 0, 0]);
    setCategory(cat);
    setMeta((m) => ({ ...m, forward, connectors: connectorsFor(open, box, pivot, m.connectionType) }));
    if (!s) setLoadErr('No tunnel openings detected automatically. Set the category, forward axis and openings by hand.');
    else setLoadErr(null);
  };

  const toggleConnector = (side: Side, on: boolean) => {
    if (!orientedBox) return;
    setMeta((m) => {
      const rest = m.connectors.filter((c) => c.side !== side);
      const conns: AssetConnector[] = on ? [...rest, ...connectorsFor([side], orientedBox, m.pivot, m.connectionType)] : rest;
      return { ...m, connectors: conns };
    });
  };

  const save = async () => {
    setBusy(true);
    setLoadErr(null);
    try {
      let thumb: Blob | null = null;
      if (glRef.current) {
        const url = glRef.current.domElement.toDataURL('image/png');
        thumb = await (await fetch(url)).blob();
      }
      const metadata = {
        name: name.trim(), category, meta, sourceUrl: sourceUrl || undefined, license: license || undefined, licenseConfirmed,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (existing) {
        const a = await api.updateAsset(existing.id, metadata as Partial<Asset>);
        onSaved(a);
      } else {
        const { asset } = await api.createAsset(files, files.map((f) => f.name), metadata, thumb);
        onSaved(asset);
      }
    } catch (e: any) {
      const details = e.details?.errors ? ` ${e.details.errors.join(' ')}` : '';
      setLoadErr(e.message + details);
    } finally {
      setBusy(false);
    }
  };

  const needsConnectors = category === 'junctionT' || category === 'junctionX' || category === 'curve';
  const canSave = !!object && !!name.trim() && licenseConfirmed && (existing || (report?.ok ?? false)) && !busy &&
    (!needsConnectors || meta.connectors.length >= 2) && (category !== 'straight' || meta.dims.length > 0);

  return (
    <div className="modal-back">
      <div className="modal">
        <header>
          <h2 style={{ margin: 0 }}>{existing ? `Edit ${existing.name}` : presetCategory === 'item' ? 'Add inventory item' : 'Import tunnel asset'}</h2>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </header>
        <div className="body">
          <div className="form">
            {!existing && (
              <div className="stack">
                <h3>1. Model files</h3>
                <input type="file" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.obj,.mtl,.fbx,.stl" onChange={(e) => pickFiles(e.target.files)} />
                <span className="small muted">GLB, or glTF with its .bin and texture files. OBJ (+MTL), FBX and STL are converted to GLB in the browser.</span>
                {busy && <span className="small">Working…</span>}
                {report && (
                  <div className={report.ok ? 'ok-box small' : 'error-box small'}>
                    {report.ok ? `Valid ${report.format.toUpperCase()}: ${report.meshes} meshes, ${report.materials} materials, ${report.textures} textures${report.triangles ? `, ${report.triangles.toLocaleString()} triangles` : ''}.` : 'Validation failed.'}
                    {report.errors.map((x) => <div key={x}>{x}</div>)}
                    {report.warnings.map((x) => <div key={x} className="muted">{x}</div>)}
                  </div>
                )}
              </div>
            )}
            {loadErr && <div className="error-box small">{loadErr}</div>}

            <div className="stack">
              <h3>{existing ? '1' : '2'}. Units and orientation</h3>
              <div className="row">
                <label className="field"><L k="assetUnits">Model units</L>
                  <select value={customUnit ? 'custom' : String(meta.unitScale)} onChange={(e) => {
                    if (e.target.value === 'custom') { setCustomUnit(true); return; }
                    setCustomUnit(false);
                    setMeta({ ...meta, unitScale: Number(e.target.value) });
                  }}>
                    {UNIT_OPTIONS.map((u) => <option key={u.label} value={u.value}>{u.label}</option>)}
                    {!UNIT_OPTIONS.some((u) => u.value === meta.unitScale) && !customUnit && <option value={meta.unitScale}>×{meta.unitScale}</option>}
                    <option value="custom">Custom factor…</option>
                  </select>
                </label>
                {customUnit && <label className="field">Metres per unit<input type="number" step="any" value={meta.unitScale} onChange={(e) => setMeta({ ...meta, unitScale: Math.max(1e-6, Number(e.target.value)) })} /></label>}
                <label className="field"><L k="assetUp">Up axis</L>
                  <select value={meta.upAxis} onChange={(e) => setMeta({ ...meta, upAxis: e.target.value as UpAxis })}>
                    <option value="Y">Y up (glTF)</option><option value="Z">Z up (CAD)</option>
                  </select>
                </label>
                <label className="field"><L k="assetForward">Forward (drive axis)</L>
                  <select value={meta.forward} onChange={(e) => setMeta({ ...meta, forward: e.target.value as ForwardAxis })}>
                    {(['+X', '-X', '+Z', '-Z'] as ForwardAxis[]).map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              </div>
              <button onClick={autoDetect} disabled={!object}><Icon name="wand" size={15} /> Auto-detect openings, category and forward axis</button>
              {orientedBox && (
                <span className="small muted">Size: {round(meta.dims.length)} m long (X) × {round(meta.dims.width)} m wide (Z) × {round(meta.dims.height)} m high. Red axis = forward, green = up.</span>
              )}
            </div>

            <div className="stack">
              <h3>{existing ? '2' : '3'}. Category and connections</h3>
              <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field">Category
                <select value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
                  {ASSET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <div className="small muted row">Openings (blue in the preview) <InfoTip k="assetOpenings" /></div>
              <div className="row">
                {SIDES.map((s) => (
                  <label key={s} className="inline small">
                    <input type="checkbox" checked={meta.connectors.some((c) => c.side === s)} onChange={(e) => toggleConnector(s, e.target.checked)} disabled={!orientedBox} /> {s}
                  </label>
                ))}
              </div>
              {meta.connectors.map((c) => (
                <div key={c.side} className="row small">
                  <span style={{ width: 28 }}>{c.side}</span>
                  <label className="field">Distance from pivot (m)
                    <input type="number" step="0.01" value={c.distance} onChange={(e) => setMeta({ ...meta, connectors: meta.connectors.map((x) => (x.side === c.side ? { ...x, distance: Number(e.target.value) } : x)) })} />
                  </label>
                </div>
              ))}
              <div className="row">
                <label className="field"><L k="assetCrossSection">Opening width (m)</L><input type="number" step="0.1" value={meta.crossSection.width} onChange={(e) => setMeta({ ...meta, crossSection: { ...meta.crossSection, width: Number(e.target.value) } })} /></label>
                <label className="field">Opening height (m)<input type="number" step="0.1" value={meta.crossSection.height} onChange={(e) => setMeta({ ...meta, crossSection: { ...meta.crossSection, height: Number(e.target.value) } })} /></label>
              </div>
              <label className="field"><L k="connectionType">Connection type</L>
                <input value={meta.connectionType} onChange={(e) => setMeta({ ...meta, connectionType: e.target.value, connectors: meta.connectors.map((c) => ({ ...c, connectionType: e.target.value })) })} /></label>
              <label className="inline small"><input type="checkbox" checked={meta.fitToDriveWidth} onChange={(e) => setMeta({ ...meta, fitToDriveWidth: e.target.checked })} /> Scale to the drive width of the plan <InfoTip k="fitToDriveWidth" /></label>
              <div className="small muted row"><InfoTip k="assetPivot" /> Pivot offset (m) from the automatic pivot ({category === 'straight' || category === 'deadEnd' || category === 'entrance' ? 'floor centre of the start opening' : 'floor centre'})</div>
              <div className="row">
                {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                  <label key={ax} className="field">{ax}<input type="number" step="0.05" value={pivotOffset[i]} onChange={(e) => {
                    const v = [...pivotOffset] as Vec3;
                    v[i] = Number(e.target.value);
                    setPivotOffset(v);
                  }} /></label>
                ))}
              </div>
            </div>

            <div className="stack">
              <h3>{existing ? '3' : '4'}. Source and licence <InfoTip k="assetLicence" /></h3>
              <label className="field">Source URL<input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://3dassets.dev/packs/underground-mine-and-shaft-works" /></label>
              <label className="field">Licence<input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="e.g. CC0, CC-BY 4.0, commercial seat licence" /></label>
              <label className="inline small"><input type="checkbox" checked={licenseConfirmed} onChange={(e) => setLicenseConfirmed(e.target.checked)} /> I have checked the licence and it permits this use</label>
              <label className="field">Tags (comma separated)<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
            </div>
          </div>
          <div className="preview">
            <Preview object={object} meta={meta} box={orientedBox && { min: [orientedBox.min[0] - meta.pivot[0], orientedBox.min[1] - meta.pivot[1], orientedBox.min[2] - meta.pivot[2]], max: [orientedBox.max[0] - meta.pivot[0], orientedBox.max[1] - meta.pivot[1], orientedBox.max[2] - meta.pivot[2]] }}
              onReady={(gl) => { glRef.current = gl; }} />
            {!object && <div className="hint">{existing ? 'Loading model…' : 'Select model files to preview them here.'}</div>}
          </div>
        </div>
        <footer>
          <span className="small muted">The preview is saved as the library thumbnail.</span>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!canSave} onClick={save}>{existing ? 'Save changes' : 'Add to library'}</button>
        </footer>
      </div>
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
