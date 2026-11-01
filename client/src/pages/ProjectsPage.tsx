import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ProjectSummary } from '../api';

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    api.projects().then(setProjects).catch((e) => setError(e.message));
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const p = await api.createProject(name.trim());
      nav(`/projects/${p.id}`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <h1>Projects</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Upload a 2D underground mine plan, select the portion to model, detect drives and stopes, and assemble a
        navigable 3D model from reusable tunnel modules.
      </p>
      <div className="row" style={{ margin: '24px 0 32px' }}>
        <input placeholder="New project name, e.g. 445 level S6S7" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()} style={{ width: 340 }} />
        <button className="primary" onClick={create} disabled={!name.trim()}>Create project</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {projects && projects.length === 0 && <div className="empty">No projects yet. Create one to upload your first plan.</div>}
      <div className="grid">
        {projects?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
            <h2 style={{ marginBottom: 6 }}>{p.name}</h2>
            <div className="muted small">{p.planCount} plan{p.planCount === 1 ? '' : 's'} · updated {new Date(p.updatedAt).toLocaleDateString()}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
