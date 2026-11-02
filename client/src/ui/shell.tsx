import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { ThemeSwitch } from './theme';
import { useToast } from './toast';
import { PortalIcon } from './Logo';
import { useSyncState } from '../offline/useSync';
import { api } from '../api';

export interface Crumb { label: string; to?: string }

interface ShellState {
  crumbs: Crumb[];
  setCrumbs: (c: Crumb[]) => void;
  query: string;
  setQuery: (q: string) => void;
  searchEnabled: boolean;
  setSearchEnabled: (b: boolean) => void;
}
const Ctx = createContext<ShellState>(null as unknown as ShellState);

/** Set breadcrumbs (and optionally enable the top-bar search) for the current page. */
export function usePageChrome(crumbs: Crumb[], opts: { search?: boolean } = {}) {
  const s = useContext(Ctx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    s.setCrumbs(crumbs);
    s.setSearchEnabled(!!opts.search);
    if (!opts.search) s.setQuery('');
  }, [key, opts.search]);
  return s;
}

const NAV: { to: string; icon: IconName; label: string; end?: boolean }[] = [
  { to: '/', icon: 'grid', label: 'Projects', end: true },
  { to: '/inventory', icon: 'box', label: 'Inventory' },
  { to: '/assets', icon: 'cube', label: 'Tunnel asset library' },
  { to: '/help', icon: 'help', label: 'Info & parameters' },
  { to: '/system', icon: 'database', label: 'Data source & connection' },
];

/**
 * Connection read-out in the top bar: database name and state while online, the number of changes
 * kept on this device while offline, and a spinner while they are sent.
 */
function ConnectionBadge() {
  const s = useSyncState();
  const toast = useToast();
  const [db, setDb] = useState<{ label: string; connected: boolean } | null>(null);
  useEffect(() => {
    if (!s.online) return;
    let alive = true;
    const load = () => api.systemStatus().then((r) => alive && setDb({ label: r.dataSource.label, connected: r.dataSource.connected })).catch(() => {});
    load();
    const t = window.setInterval(load, 60000);
    return () => { alive = false; window.clearInterval(t); };
  }, [s.online]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ count: number; notes: string[] }>).detail;
      if (d.count) toast(`Back online: ${d.count} offline change${d.count === 1 ? '' : 's'} saved to the server`);
      for (const n of d.notes ?? []) toast(n, 'info');
    };
    window.addEventListener('mineplan:synced', h);
    return () => window.removeEventListener('mineplan:synced', h);
  }, []);
  let cls = 'ok', icon: IconName = 'database', text = db?.label ?? 'Online';
  if (s.syncing) { cls = 'busy'; icon = 'refresh'; text = `Syncing ${s.pending}…`; }
  else if (!s.online) { cls = 'off'; icon = 'cloudOff'; text = s.pending ? `Offline · ${s.pending} change${s.pending === 1 ? '' : 's'} on this device` : 'Offline'; }
  else if (db && !db.connected) { cls = 'err'; icon = 'database'; text = 'Database not reachable'; }
  else if (s.pending) { cls = 'busy'; icon = 'refresh'; text = `${s.pending} waiting to sync`; }
  return (
    <Link to="/system" className={`conn-badge ${cls}`} title="Data source and connection">
      <span className="dot" />
      <Icon name={icon} size={15} className={cls === 'busy' ? 'spin' : undefined} />
      <span className="txt">{text}</span>
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [query, setQuery] = useState('');
  const [searchEnabled, setSearchEnabled] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Ctx.Provider value={{ crumbs, setCrumbs, query, setQuery, searchEnabled, setSearchEnabled }}>
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <Link to="/" className="logo-slot" aria-label="Mine Development Tool, projects" title="Mine Development Tool">
            <PortalIcon size={40} />
          </Link>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `rail-btn${isActive ? ' active' : ''}`} aria-label={n.label}>
              <Icon name={n.icon} size={20} />
              <span className="tip">{n.label}</span>
            </NavLink>
          ))}
          <span className="grow" />
        </nav>
        <div className="main-col">
          <header className="topbar">
            <div className="crumbs">
              <Link to="/" className="app-name">Mine Development Tool</Link>
              {crumbs.map((c, i) => (
                <span key={i} className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
                  <Icon name="chevron" size={14} />
                  {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span className="here">{c.label}</span>}
                </span>
              ))}
            </div>
            <span className="spacer" />
            {searchEnabled && (
              <label className="search anim-in">
                <Icon name="search" size={16} />
                <input id="global-search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
                <kbd>Ctrl K</kbd>
              </label>
            )}
            <ConnectionBadge />
            <ThemeSwitch />
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
