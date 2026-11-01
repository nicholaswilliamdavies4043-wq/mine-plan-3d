import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { InfoTip, L } from '../ui/help';
import { usePageChrome } from '../ui/shell';
import { useTheme } from '../ui/theme';
import { useToast } from '../ui/toast';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  assemble, clampToDrives, emptyKit, nearestDrive, uid, DRIVE_KINDS, KIT_SLOTS,
  type Asset, type Assembly, type CollisionSegment, type Kit, type PlacedItem, type ResolvedKit, type Vec3,
} from '@mineplan/shared';
import { api, type ProjectDetail } from '../api';
import { MineModel } from '../three/MineModel';
import { WalkControls } from '../three/WalkControls';
import { DriveSigns } from '../three/Signs';
import { PlacedItems, localToWorld, worldToLocal, type GizmoMode } from '../three/Items';
import { downloadBlob, exportGlb } from '../three/loaders';

function resolveKit(kit: Kit | undefined, assets: Map<string, Asset>): { kit: ResolvedKit; warnings: string[] } {
  const r = emptyKit();
  const warnings: string[] = [];
  if (!kit) return { kit: r, warnings };
  r.angleToleranceDeg = kit.angleToleranceDeg;
  for (const { slot, label } of KIT_SLOTS) {
    const id = kit.slots[slot];
    if (!id) continue;
    const a = assets.get(id);
    if (!a) { warnings.push(`${label}: asset missing from the library`); continue; }
    if (slot === 'straight') {
      if (!(a.meta.dims.length > 0)) { warnings.push(`${a.name}: straight module has no length`); continue; }
      r.straight = { id, slot, meta: a.meta };
    } else if (slot === 'deadEnd') r.deadEnd = { id, slot, meta: a.meta };
    else if (a.meta.connectors.length < 2) warnings.push(`${a.name}: define its openings (connectors) to use it as a ${label}`);
    else r.connectors.push({ id, slot, meta: a.meta });
  }
  for (const d of kit.decorations ?? []) {
    const a = assets.get(d.assetId);
    if (a) r.decorations.push({ id: a.id, meta: a.meta, spacingM: d.spacingM });
  }
  return { kit: r, warnings };
}

function Headlamp() {
  const { camera, scene } = useThree();
  const light = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => { scene.add(target); return () => { scene.remove(target); }; }, [scene, target]);
  useFrame(() => {
    if (!light.current) return;
    light.current.position.copy(camera.position);
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    target.position.copy(camera.position).add(d.multiplyScalar(10));
    light.current.target = target;
  });
  return <spotLight ref={light} intensity={120} distance={70} angle={0.75} penumbra={0.6} decay={1.6} color="#fff4e0" />;
}

function FitCamera({ assembly }: { assembly: Assembly }) {
  const { camera, controls } = useThree() as any;
  useEffect(() => {
    const { min, max } = assembly.bounds;
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const size = Math.max(max[0] - min[0], max[2] - min[2], 20);
    camera.position.set(c.x + size * 0.35, c.y + size * 0.7, c.z + size * 0.6);
    camera.near = 0.1;
    camera.far = size * 20;
    camera.updateProjectionMatrix();
    if (controls?.target) { controls.target.copy(c); controls.update(); }
    else camera.lookAt(c);
  }, [assembly, controls]);
  return null;
}

/** Exposes the active camera to the page (for "place in front of me"). */
function CameraGrabber({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const { camera } = useThree();
  useEffect(() => { cameraRef.current = camera; }, [camera]);
  return null;
}

/** Smoothly re-target the orbit camera on a point. */
function FlyTo({ target }: { target: { p: Vec3; seq: number } | null }) {
  const { camera, controls } = useThree() as any;
  useEffect(() => {
    if (!target || !controls?.target) return;
    const to = new THREE.Vector3(...target.p);
    const fromT = controls.target.clone();
    const fromC = camera.position.clone();
    const offset = new THREE.Vector3(18, 22, 18);
    const toC = to.clone().add(offset);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      const e = 1 - Math.pow(1 - k, 3);
      controls.target.lerpVectors(fromT, to, e);
      camera.position.lerpVectors(fromC, toC, e);
      controls.update();
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target?.seq]);
  return null;
}

type PanelTab = 'model' | 'inventory';

export function ViewerPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [assets, setAssets] = useState<Map<string, Asset>>(new Map());
  const [kits, setKits] = useState<Kit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assetErrors, setAssetErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<'orbit' | 'walk'>('orbit');
  const [tab, setTab] = useState<PanelTab>('model');
  const [showStopes, setShowStopes] = useState(true);
  const [showSigns, setShowSigns] = useState(true);
  const [underlay, setUnderlay] = useState(0.55);
  const [collide, setCollide] = useState(true);
  const [speed, setSpeed] = useState(6);
  const [planIds, setPlanIds] = useState<Set<string> | null>(null);
  // inventory
  const [items, setItems] = useState<PlacedItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null); // asset id being placed
  const [gizmo, setGizmo] = useState<GizmoMode>('translate');
  const [keepInDrive, setKeepInDrive] = useState(true);
  const [flyTarget, setFlyTarget] = useState<{ p: Vec3; seq: number } | null>(null);
  const [location, setLocation] = useState<{ seg: CollisionSegment | null; p: { x: number; y: number; z: number } } | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const saveTimer = useRef<number | null>(null);
  const { theme } = useTheme();
  const nav = useNavigate();
  const toast = useToast();
  usePageChrome([{ label: 'Projects', to: '/' }, { label: project?.name ?? '…', to: `/projects/${projectId}` }, { label: '3D model' }]);

  useEffect(() => {
    Promise.all([api.project(projectId!), api.assets(), api.kits()])
      .then(([p, a, k]) => {
        setProject(p);
        setItems(p.items ?? []);
        setAssets(new Map(a.map((x) => [x.id, x])));
        setKits(k);
        setPlanIds(new Set(p.plans.map((x) => x.id)));
      })
      .catch((e) => setError(e.message));
  }, [projectId]);

  // the assembly depends only on plans, profile and kit, so editing items never rebuilds the tunnels
  const built = useMemo(() => {
    if (!project || !planIds) return null;
    const kit = kits.find((k) => k.id === project.kitId);
    const { kit: resolved, warnings } = resolveKit(kit, assets);
    const plans = project.plans.filter((p) => planIds.has(p.id) && p.network.edges.length);
    const assembly = assemble(plans.map((p) => ({ planId: p.id, levelRL: p.levelRL, georef: p.georef, network: p.network })), project.profile, resolved);
    const uncalibrated = plans.filter((p) => p.georef.points.length < 2).map((p) => p.name);
    if (uncalibrated.length) warnings.push(`Not georeferenced (using manual scale): ${uncalibrated.join(', ')}`);
    return { assembly, warnings, plans, kitName: kit?.name ?? 'Built-in parametric kit' };
  }, [project?.plans, project?.profile, project?.kitId, assets, kits, planIds]);

  // Esc cancels placing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') setPlacing(null);
      if (!selectedItem || mode !== 'orbit') return;
      if (e.key === 'g' || e.key === 'G') setGizmo('translate');
      if (e.key === 'r' || e.key === 'R') setGizmo('rotate');
      if (e.key === 's' || e.key === 'S') setGizmo('scale');
      if (e.key === 'Delete') removeItem(selectedItem);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!project || !built) return <div className="page"><div className="skeleton" style={{ height: 500 }} /></div>;
  const { assembly } = built;
  const s = assembly.stats;
  const inventory = [...assets.values()].filter((a) => a.category === 'item');

  const saveItems = (next: PlacedItem[]) => {
    setItems(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.updateProject(project.id, { items: next }).catch((e) => toast(`Could not save items: ${e.message}`, 'error'));
    }, 400);
  };
  const changeItem = (id: string, patch: Partial<PlacedItem>) => saveItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const removeItem = (id: string) => {
    saveItems(items.filter((i) => i.id !== id));
    setSelectedItem(null);
    toast('Item removed', 'info');
  };

  /** Snap a local point onto the floor of the nearest drive. */
  const onDriveFloor = (x: number, z: number, y: number): Vec3 => {
    let px = x, pz = z, py = y;
    if (assembly.collision.length) {
      const hit = nearestDrive([x, z], y, assembly.collision);
      if (hit) py = hit.seg.y;
      if (keepInDrive) [px, pz] = clampToDrives([x, z], py, assembly.collision, 0.5);
    }
    return [px, py, pz];
  };

  const addItemAt = (assetId: string, local: Vec3, headingDeg = 0) => {
    const a = assets.get(assetId);
    const w = localToWorld(assembly.origin, local);
    const it: PlacedItem = {
      id: uid('i'), assetId, label: a?.name,
      position: [Math.round(w[0] * 1000) / 1000, Math.round(w[1] * 1000) / 1000, Math.round(w[2] * 1000) / 1000],
      rotationDeg: Math.round(headingDeg), scale: [1, 1, 1],
    };
    saveItems([...items, it]);
    setSelectedItem(it.id);
    toast(`Placed ${a?.name ?? 'item'}`);
  };

  const placeInFront = (assetId: string) => {
    const cam = cameraRef.current;
    if (!cam) return;
    const d = new THREE.Vector3();
    cam.getWorldDirection(d);
    d.y = 0;
    d.normalize();
    const p = cam.position.clone().add(d.multiplyScalar(4));
    const local = onDriveFloor(p.x, p.z, cam.position.y - 1.7);
    addItemAt(assetId, local, (Math.atan2(-d.z, d.x) * 180) / Math.PI);
  };

  const exportModel = async () => {
    if (!groupRef.current) return;
    try {
      const glb = await exportGlb(groupRef.current);
      downloadBlob(glb, `${project.name.replace(/[^\w.-]+/g, '_')}.glb`, 'model/gltf-binary');
      toast('GLB exported');
    } catch (e: any) {
      setError(`Export failed: ${e.message}`);
    }
  };

  const bg = mode === 'walk' ? '#0b0908' : theme === 'dark' ? '#141210' : '#e9e5df';
  const sel = items.find((i) => i.id === selectedItem) ?? null;
  const selAsset = sel ? assets.get(sel.assetId) : undefined;
  const locWorld = location ? localToWorld(assembly.origin, [location.p.x, location.p.y, location.p.z]) : null;
  const kindLabel = (k?: string) => DRIVE_KINDS.find((x) => x.value === k)?.label;

  return (
    <div className="viewer" style={{ cursor: placing ? 'crosshair' : undefined }}>
      <Canvas camera={{ fov: 60, near: 0.1, far: 20000 }} gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => { if (!placing) setSelectedItem(null); }}>
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, mode === 'walk' ? 25 : 2000, mode === 'walk' ? 160 : 8000]} />
        <hemisphereLight args={['#d8d4cc', '#2a2622', mode === 'walk' ? 0.25 : 1.1]} />
        <directionalLight position={[200, 400, 150]} intensity={mode === 'walk' ? 0.1 : 1.2} />
        {mode === 'walk' && <Headlamp />}
        <CameraGrabber cameraRef={cameraRef} />
        <Suspense fallback={null}>
          <group ref={groupRef}>
            <group onClick={(e) => {
              if (!placing || e.delta > 4) return;
              e.stopPropagation();
              addItemAt(placing, onDriveFloor(e.point.x, e.point.z, e.point.y));
              setPlacing(null);
              setGizmo('translate');
            }}>
              <MineModel assembly={assembly} profile={project.profile} assets={assets} plans={built.plans}
                showStopes={showStopes} underlayOpacity={mode === 'walk' ? 0 : underlay}
                onAssetError={(m) => setAssetErrors((x) => (x.includes(m) ? x : [...x, m]))} />
            </group>
            {showSigns && <DriveSigns labels={assembly.labels} overview={mode === 'orbit'} />}
            <PlacedItems items={items} assets={assets} assembly={assembly} selectedId={selectedItem}
              mode={mode === 'orbit' && !placing ? gizmo : null} keepInDrive={keepInDrive}
              onSelect={(id) => { setSelectedItem(id); if (id) setTab('inventory'); }} onChange={changeItem} />
          </group>
        </Suspense>
        {mode === 'orbit'
          ? (<><OrbitControls makeDefault enableDamping /><FitCamera assembly={assembly} /><FlyTo target={flyTarget} /></>)
          : <WalkControls assembly={assembly} collide={collide} speed={speed} onLocate={(p, seg) => setLocation({ p, seg })} />}
      </Canvas>

      {mode === 'walk' && <div className="crosshair" />}
      {mode === 'walk' && (
        <div className="location-hud anim-in">
          <Icon name="pin" size={16} />
          {location?.seg?.name
            ? <><strong>{location.seg.name}</strong>{kindLabel(location.seg.kind) && <span className="badge">{kindLabel(location.seg.kind)}</span>}</>
            : <span className="muted">{location?.seg ? 'Unnamed drive' : 'Outside the drives'}</span>}
          {locWorld && <span className="muted num">{locWorld[0].toFixed(0)} E · {locWorld[1].toFixed(0)} N · RL {locWorld[2].toFixed(0)}</span>}
          <InfoTip k="locationHud" />
        </div>
      )}
      {mode === 'walk' && <div className="hint">Click to look around · <kbd>W A S D</kbd> move · <kbd>Shift</kbd> run · <kbd>Esc</kbd> release mouse</div>}
      {placing && (
        <div className="hint" style={{ top: 14, bottom: 'auto' }}>
          <Icon name="pin" size={14} /> Click a point in a drive to place <strong>{assets.get(placing)?.name}</strong> · <kbd>Esc</kbd> cancels
        </div>
      )}

      <div className="panel3d stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <h2 style={{ margin: 0, flex: 1 }}>{project.name}</h2>
          <button className="icon-btn" title="Back to project" onClick={() => nav(`/projects/${projectId}`)}><Icon name="x" size={16} /></button>
        </div>
        <div className="seg" role="tablist">
          <button className={mode === 'orbit' ? 'on' : ''} onClick={() => setMode('orbit')}><Icon name="orbit" size={15} /> Overview</button>
          <button className={mode === 'walk' ? 'on' : ''} onClick={() => { setMode('walk'); setPlacing(null); }} disabled={!assembly.spawn}><Icon name="walk" size={15} /> Walk</button>
          <InfoTip k={mode === 'walk' ? 'viewWalk' : 'viewOverview'} />
        </div>
        <div className="seg" role="tablist" style={{ width: '100%' }}>
          <button style={{ flex: 1, justifyContent: 'center' }} className={tab === 'model' ? 'on' : ''} onClick={() => setTab('model')}><Icon name="layers" size={15} /> Model</button>
          <button style={{ flex: 1, justifyContent: 'center' }} className={tab === 'inventory' ? 'on' : ''} onClick={() => setTab('inventory')}>
            <Icon name="box" size={15} /> Inventory {items.length > 0 && <span className="badge">{items.length}</span>}
          </button>
        </div>

        {tab === 'model' && (<>
          <div className="stats">
            <div className="stat"><div className="v">{s.lengthM >= 1000 ? `${(s.lengthM / 1000).toFixed(2)} km` : `${s.lengthM.toFixed(0)} m`}</div><div className="k">drives</div></div>
            <div className="stat"><div className="v">{s.straightModules}</div><div className="k">modules</div></div>
            <div className="stat"><div className="v">{assembly.stopes.length}</div><div className="k">stopes</div></div>
          </div>
          <dl className="kv">
            <dt>Kit</dt><dd>{built.kitName}</dd>
            <dt>Kit junctions</dt><dd>{s.assetJunctions}</dd>
            <dt>Fitted connectors</dt><dd>{s.parametricConnectors}</dd>
            <dt>Dead ends</dt><dd>{s.deadEnds}</dd>
            <dt>Named signs</dt><dd>{assembly.labels.length}</dd>
            {s.decorations > 0 && (<><dt>Infrastructure</dt><dd>{s.decorations}</dd></>)}
          </dl>
          {project.plans.length > 1 && (
            <div className="stack" style={{ gap: 6 }}>
              <strong className="small">Levels</strong>
              {project.plans.map((p) => (
                <label key={p.id} className="toggle">
                  <input type="checkbox" checked={planIds!.has(p.id)} onChange={(e) => {
                    const n = new Set(planIds);
                    e.target.checked ? n.add(p.id) : n.delete(p.id);
                    setPlanIds(n);
                  }} /><span className="track" /> {p.name} · RL {p.levelRL}
                </label>
              ))}
            </div>
          )}
          <div className="divider" />
          <label className="toggle"><input type="checkbox" checked={showStopes} onChange={(e) => setShowStopes(e.target.checked)} /><span className="track" /> Show stopes</label>
          <label className="toggle"><input type="checkbox" checked={showSigns} onChange={(e) => setShowSigns(e.target.checked)} /><span className="track" /><L k="driveName">Show drive names</L></label>
          {mode === 'orbit' && (
            <label className="field"><L k="underlay">Plan underlay {Math.round(underlay * 100)}%</L>
              <input type="range" min={0} max={1} step={0.05} value={underlay} onChange={(e) => setUnderlay(Number(e.target.value))} /></label>
          )}
          {mode === 'walk' && (
            <>
              <label className="toggle"><input type="checkbox" checked={collide} onChange={(e) => setCollide(e.target.checked)} /><span className="track" /><L k="collision">Stay inside drives</L></label>
              <label className="field">Walking speed {speed} m/s
                <input type="range" min={1} max={20} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></label>
            </>
          )}
          <button onClick={exportModel} style={{ justifyContent: 'center' }}><Icon name="download" size={16} /> Export GLB <InfoTip k="exportGlb" /></button>
        </>)}

        {tab === 'inventory' && (<>
          <div className="row small" style={{ flexWrap: 'nowrap' }}>
            <strong>Add from inventory</strong><InfoTip k="itemPlace" /><span className="spacer" />
            <Link to="/inventory" className="small">Manage</Link>
          </div>
          {!inventory.length && (
            <div className="small muted">No items yet. Add equipment and their 3D models on the <Link to="/inventory">Inventory</Link> page.</div>
          )}
          <div className="stack" style={{ gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {inventory.map((a) => {
              const thumb = api.assetThumbUrl(a);
              return (
                <div key={a.id} className="row" style={{ flexWrap: 'nowrap', padding: 6, borderRadius: 12, background: placing === a.id ? 'var(--accent-soft)' : 'var(--surface-2)' }}>
                  {thumb ? <img src={thumb} alt="" style={{ width: 40, height: 32, objectFit: 'cover', borderRadius: 6 }} /> : <Icon name="box" size={22} />}
                  <span className="small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  {mode === 'orbit'
                    ? <button className={`sm${placing === a.id ? ' primary' : ''}`} onClick={() => setPlacing(placing === a.id ? null : a.id)}>{placing === a.id ? 'Click map…' : 'Place'}</button>
                    : <button className="sm" onClick={() => placeInFront(a.id)} title="Place 4 m in front of you">Place here</button>}
                </div>
              );
            })}
          </div>
          <div className="divider" />
          <div className="row small"><strong>Placed in this model ({items.length})</strong></div>
          <div className="stack" style={{ gap: 4, maxHeight: 180, overflowY: 'auto' }}>
            {items.map((it) => (
              <button key={it.id} className={`ghost sm${it.id === selectedItem ? ' active' : ''}`} style={{ justifyContent: 'flex-start' }}
                onClick={() => {
                  setSelectedItem(it.id);
                  if (mode === 'orbit') setFlyTarget({ p: worldToLocal(assembly.origin, it.position), seq: (flyTarget?.seq ?? 0) + 1 });
                }}>
                <Icon name="box" size={14} /> {it.label || assets.get(it.assetId)?.name || 'Item'}
              </button>
            ))}
            {!items.length && <span className="small muted">Nothing placed yet.</span>}
          </div>

          {sel && (
            <div className="card anim-in stack" style={{ padding: 12, borderColor: 'var(--select)' }}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <strong style={{ flex: 1 }}>{selAsset?.name ?? 'Item'}</strong>
                <InfoTip k="itemTransform" />
              </div>
              {mode === 'orbit' && (
                <div className="seg" style={{ width: '100%' }}>
                  <button style={{ flex: 1, justifyContent: 'center' }} className={gizmo === 'translate' ? 'on' : ''} onClick={() => setGizmo('translate')} title="Move (G)"><Icon name="move" size={14} /> Move</button>
                  <button style={{ flex: 1, justifyContent: 'center' }} className={gizmo === 'rotate' ? 'on' : ''} onClick={() => setGizmo('rotate')} title="Rotate (R)"><Icon name="rotate" size={14} /> Rotate</button>
                  <button style={{ flex: 1, justifyContent: 'center' }} className={gizmo === 'scale' ? 'on' : ''} onClick={() => setGizmo('scale')} title="Scale (S)"><Icon name="scale" size={14} /> Scale</button>
                </div>
              )}
              <label className="field">Label (shown above the item)
                <input value={sel.label ?? ''} onChange={(e) => changeItem(sel.id, { label: e.target.value || undefined })} /></label>
              <div className="prop-row"><span>Easting (m)</span><input type="number" step="0.1" value={sel.position[0]} onChange={(e) => changeItem(sel.id, { position: [Number(e.target.value), sel.position[1], sel.position[2]] })} /></div>
              <div className="prop-row"><span>Northing (m)</span><input type="number" step="0.1" value={sel.position[1]} onChange={(e) => changeItem(sel.id, { position: [sel.position[0], Number(e.target.value), sel.position[2]] })} /></div>
              <div className="prop-row"><span>RL (m)</span><input type="number" step="0.1" value={sel.position[2]} onChange={(e) => changeItem(sel.id, { position: [sel.position[0], sel.position[1], Number(e.target.value)] })} /></div>
              <div className="prop-row"><span>Heading (°)</span><input type="number" step="5" value={sel.rotationDeg} onChange={(e) => changeItem(sel.id, { rotationDeg: Number(e.target.value) })} /></div>
              <label className="field">Size ×{((sel.scale[0] + sel.scale[1] + sel.scale[2]) / 3).toFixed(2)}
                <input type="range" min={0.1} max={5} step={0.05} value={(sel.scale[0] + sel.scale[1] + sel.scale[2]) / 3}
                  onChange={(e) => { const v = Number(e.target.value); changeItem(sel.id, { scale: [v, v, v] }); }} /></label>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                {(['L', 'H', 'W'] as const).map((ax, i) => (
                  <label key={ax} className="field" style={{ flex: 1 }}>{ax}
                    <input type="number" step="0.05" min={0.01} style={{ width: '100%' }} value={sel.scale[i]} onChange={(e) => {
                      const sc = [...sel.scale] as Vec3;
                      sc[i] = Math.max(0.01, Number(e.target.value));
                      changeItem(sel.id, { scale: sc });
                    }} /></label>
                ))}
              </div>
              <label className="toggle"><input type="checkbox" checked={keepInDrive} onChange={(e) => setKeepInDrive(e.target.checked)} /><span className="track" /> Keep in drive</label>
              <div className="row">
                <button className="sm" onClick={() => {
                  const copy: PlacedItem = { ...sel, id: uid('i'), position: [sel.position[0] + 3, sel.position[1], sel.position[2]] };
                  saveItems([...items, copy]);
                  setSelectedItem(copy.id);
                  toast('Item duplicated');
                }}><Icon name="copy" size={14} /> Duplicate</button>
                <span className="spacer" />
                <button className="danger sm" onClick={() => removeItem(sel.id)}><Icon name="trash" size={14} /> Remove</button>
              </div>
            </div>
          )}
        </>)}

        {[...built.warnings, ...assetErrors].map((w) => <div key={w} className="warn-box small">{w}</div>)}
      </div>
    </div>
  );
}
