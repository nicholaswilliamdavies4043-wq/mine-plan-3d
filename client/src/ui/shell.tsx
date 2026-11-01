import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { ThemeSwitch } from './theme';

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
  { to: '/assets', icon: 'cube', label: 'Asset library' },
  { to: '/help', icon: 'help', label: 'Info & parameters' },
];

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
          {/* Logo position: insert the official logo file here (do not redraw it). */}
          <div className="logo-slot" title="Logo placeholder">LOGO</div>
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
              <Link to="/">Mine plan 3D</Link>
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
            <ThemeSwitch />
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
