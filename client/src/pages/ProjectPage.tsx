import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { networkLength, fitSimilarity, scaleOf, type Kit, type TunnelProfile } from '@mineplan/shared';
import { api, type ProjectDetail } from '../api';

export function ProjectPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [planName, setPlanName] = useState('');
  const [levelRL, setLevelRL] = useState(0);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const load = () => api.project(projectId!).then(setProject).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api.kits().then(setKits).catch(() => {});
  }, [projectId]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const plan = await api.uploadPlan(projectId!, file, planName || file.name.replace(/\.[^.]+$/, ''), levelRL);
      nav(`/projects/${projectId}/plans/${plan.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (profile: TunnelProfile) => {
    setProject((p) => (p ? { ...p, profile } : p));
    await api.updateProject(projectId!, { profile });
  };

  if (!project) return <div className="page">{error ? <div className="error-box">{error}</div> : 'Loading…'}</div>;
  const pr = project.profile;

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 8 }}>
        <Link to="/" className="muted small">Projects</Link>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <h1>{project.name}</h1>
        <span className="spacer" />
        <button className="primary" disabled={!project.plans.some((p) => p.network.edges.length)} onClick={() => nav(`/projects/${projectId}/view`)}>
          Open 3D model
        </button>
        <button className="danger" onClick={async () => {
          if (!confirm(`Delete project "${project.name}" and all its plans?`)) return;
          await api.deleteProject(project.id);
          nav('/');
        }}>Delete</button>
      </div>
      {error && <div className="error-box">{error}</div>}

      <h2 style={{ marginTop: 24 }}>Plans</h2>
      <table className="list" style={{ marginBottom: 16 }}>
        <thead>
          <tr><th>Name</th><th>Level RL (m)</th><th>Scale</th><th>Drives</th><th>Stopes</th><th></th></tr>
        </thead>
        <tbody>
          {project.plans.map((p) => {
            const sim = fitSimilarity(p.georef);
            const calibrated = p.georef.points.length >= 2;
            return (
              <tr key={p.id}>
                <td><Link to={`/projects/${projectId}/plans/${p.id}`}>{p.name}</Link></td>
                <td>{p.levelRL}</td>
                <td>{calibrated ? `${scaleOf(sim).toFixed(3)} m/px` : <span className="muted">not calibrated</span>}</td>
                <td>{p.network.edges.length ? `${p.network.edges.length} · ${(networkLength(p.network) * scaleOf(sim)).toFixed(0)} m` : '–'}</td>
                <td>{p.network.stopes.length || '–'}</td>
                <td style={{ textAlign: 'left' }}>
                  <button onClick={async () => {
                    if (!confirm(`Delete plan "${p.name}"?`)) return;
                    await api.deletePlan(p.id);
                    load();
                  }}>Delete</button>
                </td>
              </tr>
            );
          })}
          {project.plans.length === 0 && <tr><td colSpan={6} className="muted">No plans yet.</td></tr>}
        </tbody>
      </table>

      <div className="card" style={{ maxWidth: 760 }}>
        <h3>Upload a plan</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          PNG or JPEG scan/export of a level plan (e.g. a tele-remote bogging plan). Higher resolution gives better
          detection; 200–300 dpi exports work well. Each plan is one level; add several plans for multi-level models.
        </p>
        <div className="row">
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <label className="field">Plan name<input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="445 S6S7" /></label>
          <label className="field">Level RL (m)<input type="number" value={levelRL} onChange={(e) => setLevelRL(Number(e.target.value))} /></label>
          <button className="primary" disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>3D assembly settings</h2>
      <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
        <label className="field">Tunnel kit
          <select value={project.kitId ?? ''} onChange={async (e) => {
            const kitId = e.target.value || null;
            setProject({ ...project, kitId });
            await api.updateProject(project.id, { kitId });
          }}>
            <option value="">Built-in parametric kit</option>
            {kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </label>
        <label className="field">Drive width (m)<input type="number" step="0.1" value={pr.width} onChange={(e) => saveProfile({ ...pr, width: Number(e.target.value) || pr.width })} /></label>
        <label className="field">Wall height (m)<input type="number" step="0.1" value={pr.wallHeight} onChange={(e) => saveProfile({ ...pr, wallHeight: Number(e.target.value) || pr.wallHeight })} /></label>
        <label className="field">Arch rise (m)<input type="number" step="0.1" value={pr.archRise} onChange={(e) => saveProfile({ ...pr, archRise: Math.max(0, Number(e.target.value)) })} /></label>
        <label className="inline"><input type="checkbox" checked={pr.useDetectedWidths} onChange={(e) => saveProfile({ ...pr, useDetectedWidths: e.target.checked })} /> Use widths measured from the plan</label>
      </div>
      <p className="muted small">Kits are built in the <Link to="/assets">asset library</Link>. Slots without an asset fall back to built-in pieces.</p>
    </div>
  );
}
