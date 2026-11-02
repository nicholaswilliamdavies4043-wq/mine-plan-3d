import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnSynced } from '../offline/useSync';
import { api, type ProjectSummary } from '../api';
import { NetworkPreview } from '../components/NetworkPreview';
import { Icon } from '../ui/Icon';
import { usePageChrome } from '../ui/shell';
import { useToast } from '../ui/toast';

const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectsPage() {
  const chrome = usePageChrome([{ label: 'Projects' }], { search: true });
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const openInput = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();

  useOnSynced(() => { api.projects().then(setProjects).catch(() => {}); });
  useEffect(() => {
    api.projects().then(setProjects).catch((e) => setError(e.message));
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const p = await api.createProject(name.trim());
      toast(`Project "${p.name}" created`);
      nav(`/projects/${p.id}`);
    } catch (e: any) {
      setError(e.message);
      setCreating(false);
    }
  };

  const q = chrome.query.trim().toLowerCase();
  const shown = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  const totalLen = (projects ?? []).reduce((s, p) => s + p.lengthM, 0);
  const totalPlans = (projects ?? []).reduce((s, p) => s + p.planCount, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="sub">Turn 2D underground plans into navigable 3D mine models assembled from reusable tunnel modules.</p>
        </div>
        <span className="spacer" />
        <button onClick={() => openInput.current?.click()} disabled={importing} title="Open a .mine3d file downloaded from this app">
          {importing ? <span className="spinner" /> : <Icon name="folder" size={16} />} Open project file
        </button>
        <input ref={openInput} type="file" accept=".mine3d,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setImporting(true);
          try {
            const p = await api.importProject(f);
            toast(`Opened "${p.name}"`);
            nav(`/projects/${p.id}`);
          } catch (err: any) {
            toast(err.message, 'error');
          } finally {
            setImporting(false);
          }
        }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.1fr) repeat(3, minmax(150px, 0.6fr))', gap: 16, marginBottom: 28 }} className="stagger">
        <div className="hero-card">
          <h2>Start a new model</h2>
          <p style={{ margin: '0 0 16px', opacity: 0.85, fontSize: 13.5 }}>Name the project, then upload a plan for each level.</p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input placeholder="e.g. 445 level S6S7" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()}
              style={{ flex: 1, background: 'rgba(255,255,255,0.92)', color: '#101010', border: 0, height: 42 }} />
            <button className="light" onClick={create} disabled={!name.trim() || creating} style={{ height: 42 }}>
              {creating ? <span className="spinner" /> : <Icon name="plus" size={16} />} Create
            </button>
          </div>
        </div>
        <div className="card"><div className="muted small">Projects</div><div style={{ fontSize: 30, marginTop: 6 }} className="num">{projects?.length ?? '–'}</div></div>
        <div className="card"><div className="muted small">Plans / levels</div><div style={{ fontSize: 30, marginTop: 6 }} className="num">{projects ? totalPlans : '–'}</div></div>
        <div className="card"><div className="muted small">Drives mapped</div><div style={{ fontSize: 30, marginTop: 6 }} className="num">{projects ? fmtLen(totalLen) : '–'}</div></div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!projects && (
        <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 300 }} />)}</div>
      )}
      {projects && projects.length === 0 && <div className="empty">No projects yet. Create one above to upload your first plan.</div>}
      {projects && projects.length > 0 && !shown.length && <div className="empty">No project matches "{chrome.query}".</div>}

      <div className="grid stagger">
        {shown.map((p, i) => (
          <div key={p.id} className="card hover project-card" role="link" tabIndex={0}
            onClick={() => nav(`/projects/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/projects/${p.id}`)}>
            <div className="preview">
              <NetworkPreview preview={p.preview} delay={0.2 + i * 0.05} />
              <div className="shade" />
              <div style={{ position: 'absolute', top: 12, left: 12 }} className="row">
                {p.levels.slice(0, 3).map((l, j) => <span key={j} className="badge">RL {l}</span>)}
                {p.levels.length > 3 && <span className="badge">+{p.levels.length - 3}</span>}
              </div>
            </div>
            <div className="body">
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <div className="title" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <button className="icon-btn" title="Open 3D model" disabled={!p.lengthM}
                  onClick={(e) => { e.stopPropagation(); nav(`/projects/${p.id}/view`); }}><Icon name="play" size={16} /></button>
              </div>
              <div className="stats">
                <div className="stat"><div className="v">{fmtLen(p.lengthM)}</div><div className="k">drives</div></div>
                <div className="stat"><div className="v">{p.junctions}</div><div className="k">junctions + ends</div></div>
                <div className="stat"><div className="v">{p.stopes}</div><div className="k">stopes</div></div>
              </div>
              <div className="row small muted">
                <Icon name="layers" size={14} /> {p.planCount} plan{p.planCount === 1 ? '' : 's'}
                <span className="spacer" />
                updated {timeAgo(p.updatedAt)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
