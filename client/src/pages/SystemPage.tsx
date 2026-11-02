import { useEffect, useState } from 'react';
import type { SystemStatus } from '@mineplan/shared';
import { api } from '../api';
import { pendingChanges, syncNow } from '../offline/sync';
import { useSyncState } from '../offline/useSync';
import { Icon } from '../ui/Icon';
import { usePageChrome } from '../ui/shell';
import { useToast } from '../ui/toast';

export function timeAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const plural = (n: number | undefined, w: string) => (n === undefined ? '–' : `${n} ${w}${n === 1 ? '' : 's'}`);
const fmtBytes = (b?: number) => (b === undefined ? '–' : b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`);

/** Data source page: where the data lives, whether the server reaches it, and this device's offline queue. */
export function SystemPage() {
  usePageChrome([{ label: 'Data source' }]);
  const [st, setSt] = useState<SystemStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const sync = useSyncState();
  const toast = useToast();
  const [, tick] = useState(0);

  const load = async () => {
    setChecking(true);
    try {
      setSt(await api.systemStatus());
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    const t2 = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => { window.clearInterval(t); window.clearInterval(t2); };
  }, []);
  useEffect(() => { if (sync.online && !st) load(); }, [sync.online]);

  const ds = st?.dataSource;
  const reachable = !err && !!st;
  const connected = reachable && !!ds?.connected;
  const pending = pendingChanges();
  const isPg = ds?.kind === 'postgres' || ds?.kind === 'prisma';

  return (
    <div className="page system-page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><Icon name="database" size={26} /> Data source</h1>
          <div className="muted small">Where the app keeps its data, and whether this device can reach it.</div>
        </div>
        <span className="spacer" />
        <button onClick={load} disabled={checking}>{checking ? <span className="spinner" /> : <Icon name="refresh" size={16} />} Check now</button>
      </div>

      <div className="status-cards stagger">
        <div className="status-card">
          <div className="k"><Icon name="database" size={15} /> Data source</div>
          <div className="v">{ds?.label ?? (reachable ? '…' : 'Unknown')}</div>
          <div className="d">{ds ? (isPg ? `${ds.database} @ ${ds.host}` : ds.location) : 'The server is not reachable from this device'}</div>
        </div>
        <div className={`status-card accent-${connected ? 'ok' : reachable ? 'err' : 'off'}`}>
          <div className="k"><Icon name={connected ? 'cloud' : 'cloudOff'} size={15} /> Connection</div>
          <div className="v">{connected ? 'Connected' : reachable ? 'Disconnected' : 'Offline'}</div>
          <div className="d">{connected
            ? `${ds?.message ?? 'Working normally'}${ds?.latencyMs !== undefined ? ` · ${ds.latencyMs} ms` : ''}`
            : reachable ? ds?.message : 'Changes are saved on this device and sent when the connection is back.'}</div>
        </div>
        <div className="status-card">
          <div className="k"><Icon name="check" size={15} /> Last saved</div>
          <div className="v">{timeAgo(ds?.lastSavedAt)}</div>
          <div className="d">{isPg ? 'to the database' : ds ? 'to the data file' : '–'}</div>
        </div>
      </div>

      {ds && (
        <div className="status-note">
          {isPg ? (<>
            All data is stored in the PostgreSQL database set by <code>DATABASE_URL</code> in the server environment, so it survives
            restarts and redeploys. Plan images and 3D asset files are kept {st?.storage.kind === 'postgres' ? <>in the same database (<code>mp_blobs</code>)</> : <>in {st?.storage.label} (<code>{st?.storage.location}</code>)</>}.
            To change the database, change <code>DATABASE_URL</code> where the server is hosted.
          </>) : (<>
            Data is stored in a JSON file on the server: <code>{ds.location}</code>. That is fine on one PC. On a hosted server
            (for example Render), attach a PostgreSQL database and set <code>DATABASE_URL</code> in the server environment; the app
            creates its tables on start-up and shows the connection here.
          </>)}
        </div>
      )}
      {err && <div className="warn-box">{err}</div>}
      {st?.warnings.map((w) => <div key={w} className="warn-box">{w}</div>)}

      <div className="status-cards">
        <div className="status-card">
          <div className="k"><Icon name="folder" size={15} /> File storage</div>
          <div className="v">{st?.storage.label ?? '–'}</div>
          <div className="d">{st ? `${plural(st.storage.objects, 'file')} · ${fmtBytes(st.storage.bytes)}${st.storage.persistent ? '' : ' · not kept across deploys'}` : '–'}</div>
        </div>
        <div className={`status-card accent-${sync.online ? (sync.pending ? 'busy' : 'ok') : 'off'}`}>
          <div className="k"><Icon name="cloud" size={15} /> This device</div>
          <div className="v">{sync.syncing ? 'Syncing…' : sync.online ? 'Online' : 'Offline'}</div>
          <div className="d">{sync.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to be sent` : 'Everything is saved to the server'}
            {sync.lastSyncAt ? ` · last sync ${timeAgo(sync.lastSyncAt)}` : ''}</div>
        </div>
        <div className="status-card">
          <div className="k"><Icon name="grid" size={15} /> Records</div>
          <div className="v num">{ds?.counts ? plural(ds.counts.projects, 'project') : '–'}</div>
          <div className="d">{ds?.counts ? `${plural(ds.counts.plans, 'plan')} · ${plural(ds.counts.assets, 'asset')} · ${plural(ds.counts.kits, 'kit')}` : '–'}</div>
        </div>
      </div>

      <div className="card stack" style={{ maxWidth: 1100 }}>
        <div className="row"><strong>Changes kept on this device</strong><span className="spacer" />
          <button className="sm" disabled={!sync.pending || sync.syncing} onClick={async () => { await syncNow(); toast(sync.online ? 'Sync finished' : 'Still offline', 'info'); }}>
            <Icon name="refresh" size={14} /> Sync now</button>
        </div>
        {!pending.length && <span className="small muted">None. Edits made while offline appear here until they reach the server.</span>}
        {pending.map((p) => (
          <div key={p.id} className="row small" style={{ flexWrap: 'nowrap' }}>
            <span className="badge">{new Date(p.at).toLocaleString()}</span><span>{p.text}</span>
          </div>
        ))}
        {sync.notes.length > 0 && (<>
          <strong className="small">Last sync</strong>
          {sync.notes.map((n) => <div key={n} className="small muted">{n}</div>)}
        </>)}
      </div>

      <details className="card" style={{ maxWidth: 1100 }}>
        <summary style={{ cursor: 'pointer' }}><strong>Connecting a PostgreSQL database on Render</strong></summary>
        <ol className="small" style={{ lineHeight: 1.7, marginTop: 10 }}>
          <li>In Render, create a PostgreSQL database (or deploy <code>render.yaml</code> from this repository, which creates both).</li>
          <li>Open the web service → <em>Environment</em> and add <code>DATABASE_URL</code> = the database's <em>Internal Database URL</em>.</li>
          <li>Redeploy. The server creates its tables on start-up; this page then shows <strong>PostgreSQL · Connected</strong>.</li>
          <li>Using the <em>External Database URL</em> from your PC also works; TLS is switched on automatically for <code>*.render.com</code> hosts.</li>
        </ol>
        <div className="tiny muted">Server {st?.host ?? '–'} · version {st?.version ?? '–'} · started {timeAgo(st?.startedAt)}{ds?.serverVersion ? ` · PostgreSQL ${ds.serverVersion.split(' ')[0]}` : ''}</div>
      </details>
    </div>
  );
}
