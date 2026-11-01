import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export type Theme = 'dark' | 'light';
const KEY = 'mineplan-theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Read a CSS custom property of the active theme (for canvas / WebGL colours). */
export function cssVar(name: string, fallback = '#000'): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function ThemeSwitch() {
  const { theme, toggle } = useTheme();
  return (
    <button className="theme-switch" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Dark / light theme">
      <span className="knob" />
      <Icon name="moon" size={15} className={theme === 'dark' ? 'on' : ''} />
      <Icon name="sun" size={15} className={theme === 'light' ? 'on' : ''} />
    </button>
  );
}
