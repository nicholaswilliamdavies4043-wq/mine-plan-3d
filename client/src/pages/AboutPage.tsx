import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SystemStatus } from '@mineplan/shared';
import { api } from '../api';
import { APP } from '../about';
import { useSyncState } from '../offline/useSync';
import { Icon, type IconName } from '../ui/Icon';
import { PortalIcon } from '../ui/Logo';
import { usePageChrome } from '../ui/shell';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'wand', title: 'Plan to model', text: 'Georeference a scanned plan, detect the drives and stopes, and correct them in the editor.' },
  { icon: 'cube', title: 'Reusable tunnel modules', text: 'The 3D model is assembled from a kit of straights, junctions and dead ends, imported or built in.' },
  { icon: 'walk', title: 'Walk-through', text: 'Fly over the mine or walk the drives at eye height, with drive names and your position.' },
  { icon: 'ruler', title: 'Measure', text: 'Measure distances on the plan or in 3D. Measurements appear on the drive walls.' },
  { icon: 'cloudOff', title: 'Works offline', text: 'Keep working without a connection; changes are merged with the server when you are back.' },
  { icon: 'database', title: 'Shared data', text: 'Projects are stored in PostgreSQL, so the whole team works on the same plans.' },
];

const BUILT_WITH = ['React', 'Three.js', 'React Three Fiber', 'Vite', 'Node.js', 'Express', 'PostgreSQL', 'TypeScript'];

export function AboutPage() {
  usePageChrome([{ label: 'About' }]);
  const [st, setSt] = useState<SystemStatus | null>(null);
  const sync = useSyncState();
  useEffect(() => { api.systemStatus().then(setSt).catch(() => setSt(null)); }, [sync.online]);
  const built = new Date(APP.builtAt);

  return (
    <div className="page about-page">
      <section className="about-hero">
        <PortalIcon size={112} />
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <span className="kicker">About</span>
          <h1>{APP.name}</h1>
          <div className="row small"><span className="badge">{APP.short}</span><span className="badge">Version {APP.version}</span></div>
          <p className="sub">{APP.tagline} A companion to {APP.companion}.</p>
        </div>
      </section>

      <div className="about-grid">
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <div className="card about-dev">
            <span className="kicker">Developed by</span>
            <div className="dev-name">{APP.developer}</div>
            <span className="small muted">Design, development and maintenance of {APP.name}.</span>
          </div>

          <div className="card stack" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>What it does</h2>
            <div className="about-features">
              {FEATURES.map((f) => (
                <div key={f.title} className="feat">
                  <span className="feat-icon"><Icon name={f.icon} size={18} /></span>
                  <div><strong>{f.title}</strong><p>{f.text}</p></div>
                </div>
              ))}
            </div>
          </div>

          <div className="card stack" style={{ gap: 10 }}>
            <h2 style={{ margin: 0 }}>The name and logo</h2>
            <p className="small" style={{ margin: 0, maxWidth: '68ch', color: 'var(--text-2)' }}>
              In mining, development means the drives, crosscuts and declines that give access to the orebody, which is what this tool models.
              The Portal logo is a tunnel entrance with the drive profile used in the 3D model: flat floor, straight walls and an arched back.
              Its opening is set off center, so the drive seems to curve away into the rock.
            </p>
          </div>
        </div>

        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <div className="card stack" style={{ gap: 10 }}>
            <h2 style={{ margin: 0 }}>This installation</h2>
            <dl className="kv">
              <dt>App version</dt><dd>{APP.version}</dd>
              <dt>Built</dt><dd>{Number.isNaN(built.getTime()) ? '–' : built.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</dd>
              <dt>Server</dt><dd>{st ? `${st.host} · ${st.version}` : sync.online ? '…' : 'Not reachable (offline)'}</dd>
              <dt>Data source</dt><dd>{st ? `${st.dataSource.label}${st.dataSource.connected ? '' : ' (disconnected)'}` : '–'}</dd>
              <dt>Files</dt><dd>{st?.storage.label ?? '–'}</dd>
              <dt>This device</dt><dd>{sync.online ? 'Online' : 'Offline'}{sync.pending ? ` · ${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting` : ''}</dd>
            </dl>
            <Link to="/system" className="small">Data source and connection details</Link>
          </div>

          <div className="card stack" style={{ gap: 10 }}>
            <h2 style={{ margin: 0 }}>Built with</h2>
            <div className="row" style={{ gap: 6 }}>{BUILT_WITH.map((b) => <span key={b} className="badge">{b}</span>)}</div>
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>Data handling</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Mine plans are site data and can be confidential. Keep projects in approved storage and share <code>.mine3d</code> files only with people who may see them.
            </p>
            <Link to="/help" className="small">Info and parameters</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
