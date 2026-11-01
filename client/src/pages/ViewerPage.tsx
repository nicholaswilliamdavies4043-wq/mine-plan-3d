import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { InfoTip, L } from '../ui/help';
import { usePageChrome } from '../ui/shell';
import { useTheme } from '../ui/theme';
import { useToast } from '../ui/toast';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  assemble, emptyKit, KIT_SLOTS, type Asset, type Assembly, type Kit, type ResolvedKit,
} from '@mineplan/shared';
import { api, type ProjectDetail } from '../api';
import { MineModel } from '../three/MineModel';
import { WalkControls } from '../three/WalkControls';
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

export function ViewerPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [assets, setAssets] = useState<Map<string, Asset>>(new Map());
  const [kits, setKits] = useState<Kit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assetErrors, setAssetErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<'orbit' | 'walk'>('orbit');
  const [showStopes, setShowStopes] = useState(true);
  const [underlay, setUnderlay] = useState(0.55);
  const [collide, setCollide] = useState(true);
  const [speed, setSpeed] = useState(6);
  const [planIds, setPlanIds] = useState<Set<string> | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { theme } = useTheme();
  const nav = useNavigate();
  const toast = useToast();
  usePageChrome([{ label: 'Projects', to: '/' }, { label: project?.name ?? '…', to: `/projects/${projectId}` }, { label: '3D model' }]);

  useEffect(() => {
    Promise.all([api.project(projectId!), api.assets(), api.kits()])
      .then(([p, a, k]) => {
        setProject(p);
        setAssets(new Map(a.map((x) => [x.id, x])));
        setKits(k);
        setPlanIds(new Set(p.plans.map((x) => x.id)));
      })
      .catch((e) => setError(e.message));
  }, [projectId]);

  const built = useMemo(() => {
    if (!project || !planIds) return null;
    const kit = kits.find((k) => k.id === project.kitId);
    const { kit: resolved, warnings } = resolveKit(kit, assets);
    const plans = project.plans.filter((p) => planIds.has(p.id) && p.network.edges.length);
    const assembly = assemble(plans.map((p) => ({ planId: p.id, levelRL: p.levelRL, georef: p.georef, network: p.network })), project.profile, resolved);
    const uncalibrated = plans.filter((p) => p.georef.points.length < 2).map((p) => p.name);
    if (uncalibrated.length) warnings.push(`Not georeferenced (using manual scale): ${uncalibrated.join(', ')}`);
    return { assembly, warnings, plans, kitName: kit?.name ?? 'Built-in parametric kit' };
  }, [project, assets, kits, planIds]);

  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!project || !built) return <div className="page"><div className="skeleton" style={{ height: 500 }} /></div>;
  const { assembly } = built;
  const s = assembly.stats;

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

  return (
    <div className="viewer">
      <Canvas camera={{ fov: 60, near: 0.1, far: 20000 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, mode === 'walk' ? 25 : 2000, mode === 'walk' ? 160 : 8000]} />
        <hemisphereLight args={['#d8d4cc', '#2a2622', mode === 'walk' ? 0.25 : 1.1]} />
        <directionalLight position={[200, 400, 150]} intensity={mode === 'walk' ? 0.1 : 1.2} />
        {mode === 'walk' && <Headlamp />}
        <Suspense fallback={null}>
          <group ref={groupRef}>
            <MineModel assembly={assembly} profile={project.profile} assets={assets} plans={built.plans}
              showStopes={showStopes} underlayOpacity={mode === 'walk' ? 0 : underlay}
              onAssetError={(m) => setAssetErrors((x) => (x.includes(m) ? x : [...x, m]))} />
          </group>
        </Suspense>
        {mode === 'orbit' ? (<><OrbitControls makeDefault enableDamping /><FitCamera assembly={assembly} /></>) : <WalkControls assembly={assembly} collide={collide} speed={speed} />}
      </Canvas>
      {mode === 'walk' && <div className="crosshair" />}
      {mode === 'walk' && <div className="hint">Click to look around · <kbd>W A S D</kbd> move · <kbd>Shift</kbd> run · <kbd>Esc</kbd> release mouse</div>}
      <div className="panel3d stack">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <h2 style={{ margin: 0, flex: 1 }}>{project.name}</h2>
          <button className="icon-btn" title="Back to project" onClick={() => nav(`/projects/${projectId}`)}><Icon name="x" size={16} /></button>
        </div>
        <div className="seg" role="tablist">
          <button className={mode === 'orbit' ? 'on' : ''} onClick={() => setMode('orbit')}><Icon name="orbit" size={15} /> Overview</button>
          <button className={mode === 'walk' ? 'on' : ''} onClick={() => setMode('walk')} disabled={!assembly.spawn}><Icon name="walk" size={15} /> Walk through</button>
          <InfoTip k={mode === 'walk' ? 'viewWalk' : 'viewOverview'} />
        </div>
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
        {[...built.warnings, ...assetErrors].map((w) => <div key={w} className="warn-box small">{w}</div>)}
      </div>
    </div>
  );
}
