import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { networkLength, fitSimilarity, scaleOf, type Kit, type Plan, type TunnelProfile } from '@mineplan/shared';
import { useOnSynced } from '../offline/useSync';
import { api, type ProjectDetail, type ProjectPreview } from '../api';
import { NetworkPreview } from '../components/NetworkPreview';
import { Icon } from '../ui/Icon';
import { L } from '../ui/help';
import { usePageChrome } from '../ui/shell';
import { useToast } from '../ui/toast';

function previewOf(p: Plan): ProjectPreview {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of p.network.edges) for (const q of e.points) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  const has = isFinite(x0);
  return {
    planId: p.id, width: p.imageWidth, height: p.imageHeight,
    bbox: has ? [x0, y0, x1, y1] : [0, 0, p.imageWidth, p.imageHeight],
    edges: p.network.edges.map((e) => e.points),
    stopes: p.network.stopes.map((s) => s.polygon),
  };
}

function stepsDone(p: Plan) {
  return [p.georef.points.length >= 2, p.regions.length > 0, !!p.lastDetection || p.network.edges.length > 0, p.network.edges.length > 0];
}

export function ProjectPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [planName, setPlanName] = useState('');
  const [levelRL, setLevelRL] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();
  usePageChrome([{ label: 'Projects', to: '/' }, { label: project?.name ?? '…' }]);

  const load = () => api.project(projectId!).then(setProject).catch((e) => setError(e.message));
  useOnSynced(() => { load(); });
  useEffect(() => {
    load();
    api.kits().then(setKits).catch(() => {});
  }, [projectId]);

  const choose = (f: File | null | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { toast('Plans must be PNG or JPEG images', 'error'); return; }
    setFile(f);
    if (!planName) setPlanName(f.name.replace(/\.[^.]+$/, ''));
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await api.uploadPlan(projectId!, file, planName || file.name.replace(/\.[^.]+$/, ''), levelRL);
      toast('Plan uploaded');
      nav(`/projects/${projectId}/plans/${plan.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveTimer = useRef<number | null>(null);
  const saveProfile = (profile: TunnelProfile) => {
    setProject((p) => (p ? { ...p, profile } : p));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => api.updateProject(projectId!, { profile }).then(() => toast('Profile saved')), 500);
  };

  if (!project) return <div className="page">{error ? <div className="error-box">{error}</div> : <div className="skeleton" style={{ height: 300 }} />}</div>;
  const pr = project.profile;
  const totalLen = project.plans.reduce((s, p) => s + networkLength(p.network) * scaleOf(fitSimilarity(p.georef)), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{project.name}</h1>
          <div className="row small muted">
            <span className="badge">{project.plans.length} plan{project.plans.length === 1 ? '' : 's'}</span>
            <span className="badge accent">{totalLen >= 1000 ? `${(totalLen / 1000).toFixed(2)} km` : `${totalLen.toFixed(0)} m`} of drives</span>
          </div>
        </div>
        <span className="spacer" />
        <a className="btn" href={api.exportProjectUrl(project.id)} download title="Save the whole project (plans, edits, kit and assets) as one .mine3d file"
          onClick={() => toast('Preparing project file…', 'info')}><Icon name="download" size={16} /> Download project</a>
        <button className="danger" onClick={async () => {
          if (!confirm(`Delete project "${project.name}" and all its plans?`)) return;
          await api.deleteProject(project.id);
          toast('Project deleted', 'info');
          nav('/');
        }}><Icon name="trash" size={16} /> Delete</button>
        <button className="primary" disabled={!project.plans.some((p) => p.network.edges.length)} onClick={() => nav(`/projects/${projectId}/view`)}>
          <Icon name="play" size={16} /> Open 3D model
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="grid stagger" style={{ marginBottom: 28 }}>
        {project.plans.map((p) => {
          const done = stepsDone(p);
          const mpp = scaleOf(fitSimilarity(p.georef));
          return (
            <div key={p.id} className="card hover project-card" role="link" tabIndex={0}
              onClick={() => nav(`/projects/${projectId}/plans/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/projects/${projectId}/plans/${p.id}`)}>
              <div className="preview"><NetworkPreview preview={previewOf(p)} /><div className="shade" />
                <span className="badge" style={{ position: 'absolute', top: 12, left: 12 }}>RL {p.levelRL}</span>
              </div>
              <div className="body">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <div className="title" style={{ flex: 1 }}>{p.name}</div>
                  <button className="icon-btn" title="Delete plan" onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete plan "${p.name}"?`)) return;
                    await api.deletePlan(p.id);
                    toast('Plan deleted', 'info');
                    load();
                  }}><Icon name="trash" size={16} /></button>
                </div>
                <div className="progress-steps" title="Scale · Portion · Detect · Edit">
                  {done.map((d, i) => <div key={i} className={`s${d ? ' done' : ''}`} />)}
                </div>
                <div className="stats">
                  <div className="stat"><div className="v">{(networkLength(p.network) * mpp).toFixed(0)} m</div><div className="k">drives</div></div>
                  <div className="stat"><div className="v">{p.network.edges.length}</div><div className="k">segments</div></div>
                  <div className="stat"><div className="v">{p.network.stopes.length}</div><div className="k">stopes</div></div>
                </div>
                <div className="small muted">{p.georef.points.length >= 2 ? `${mpp.toFixed(3)} m/px · georeferenced` : 'Not georeferenced yet'}</div>
              </div>
            </div>
          );
        })}

        <div className={`card upload-card${drag ? ' drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]); }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}><Icon name="upload" /><h3 style={{ margin: 0 }}>Add a plan</h3></div>
          <button type="button" className="dropzone" onClick={() => fileInput.current?.click()}>
            <Icon name={file ? 'check' : 'upload'} />
            {file
              ? <span className="dz-name" title={file.name}>{file.name}</span>
              : <span>Drop a PNG / JPEG here or click to browse</span>}
            {file && <span className="tiny muted">{(file.size / 1024 / 1024).toFixed(1)} MB · click to choose another</span>}
          </button>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => choose(e.target.files?.[0])} />
          <div className="field-grid">
            <label className="field">Plan name<input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="445 S6S7" /></label>
            <label className="field"><L k="levelRL">Level RL (m)</L><input type="number" value={levelRL} onChange={(e) => setLevelRL(Number(e.target.value))} /></label>
          </div>
          <button className="primary block" disabled={!file || busy} onClick={upload}>
            {busy ? <span className="spinner" /> : <Icon name="arrowUp" size={16} />} Upload and open editor
          </button>
          <span className="tiny muted">200–300 dpi exports give the best detection.</span>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 1100 }}>
        <div className="row" style={{ marginBottom: 12 }}><Icon name="settings" /><h2 style={{ margin: 0 }}>3D assembly settings</h2></div>
        <div className="row" style={{ alignItems: 'flex-end', gap: 18 }}>
          <label className="field"><L k="kit">Tunnel kit</L>
            <select value={project.kitId ?? ''} onChange={async (e) => {
              const kitId = e.target.value || null;
              setProject({ ...project, kitId });
              await api.updateProject(project.id, { kitId });
              toast('Kit updated');
            }}>
              <option value="">Built-in parametric kit</option>
              {kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
          <label className="field"><L k="driveProfile">Drive width (m)</L><input type="number" step="0.1" value={pr.width} onChange={(e) => saveProfile({ ...pr, width: Number(e.target.value) || pr.width })} /></label>
          <label className="field"><L k="driveProfile">Wall height (m)</L><input type="number" step="0.1" value={pr.wallHeight} onChange={(e) => saveProfile({ ...pr, wallHeight: Number(e.target.value) || pr.wallHeight })} /></label>
          <label className="field"><L k="driveProfile">Arch rise (m)</L><input type="number" step="0.1" value={pr.archRise} onChange={(e) => saveProfile({ ...pr, archRise: Math.max(0, Number(e.target.value)) })} /></label>
          <label className="toggle"><input type="checkbox" checked={pr.useDetectedWidths} onChange={(e) => saveProfile({ ...pr, useDetectedWidths: e.target.checked })} /><span className="track" /><L k="useDetectedWidths">Use widths measured from the plan</L></label>
          <ProfileSketch profile={pr} />
        </div>
      </div>
    </div>
  );
}

/** Live cross-section sketch of the drive profile. */
function ProfileSketch({ profile }: { profile: TunnelProfile }) {
  const W = profile.width, H = profile.wallHeight + profile.archRise;
  const s = 70 / Math.max(W, H);
  const pts: string[] = [`0,${H * s}`, `0,${(H - profile.wallHeight) * s}`];
  for (let i = 1; i < 16; i++) {
    const th = Math.PI - (i / 16) * Math.PI;
    pts.push(`${(W / 2 + (W / 2) * Math.cos(th)) * s},${(profile.archRise - profile.archRise * Math.sin(th)) * s}`);
  }
  pts.push(`${W * s},${(H - profile.wallHeight) * s}`, `${W * s},${H * s}`);
  return (
    <svg width={W * s + 60} height={H * s + 24} viewBox={`-30 -6 ${W * s + 60} ${H * s + 24}`} style={{ overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.5} style={{ transition: 'all .3s' }} />
      <line x1={0} y1={H * s} x2={W * s} y2={H * s} stroke="var(--text-2)" strokeWidth={1.5} />
      <text x={(W * s) / 2} y={H * s + 14} fontSize={10} fill="var(--muted)" textAnchor="middle">{W} m</text>
      <text x={-6} y={(H * s) / 2} fontSize={10} fill="var(--muted)" textAnchor="end">{H.toFixed(1)} m</text>
    </svg>
  );
}
