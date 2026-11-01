import { HelpBrowser, HELP } from '../ui/help';
import { usePageChrome } from '../ui/shell';
import { Icon } from '../ui/Icon';

const SHORTCUTS: [string, string][] = [
  ['V', 'Select'], ['H', 'Pan'], ['R', 'Draw region'], ['X', 'Draw exclusion'], ['D', 'Draw drive'], ['S', 'Draw stope'], ['C', 'Pick grid point'],
  ['+ / −', 'Zoom in / out'], ['0', 'Actual size (100%)'], ['F', 'Fit plan to view'], ['P', 'Hide / show properties panel'], ['Shift F', 'Full screen editor'],
  ['M', 'Toggle magnifier'], ['N', 'Toggle snapping'], ['E', 'Show / hide drives and stopes'], ['Shift (drawing)', 'Lock angle to 15° steps'], ['Ctrl + click', 'Place a point without snapping'],
  ['Enter / double-click', 'Finish shape'], ['Backspace', 'Remove last point'], ['Esc', 'Cancel drawing'], ['Delete', 'Delete selection'],
  ['Arrow keys', 'Nudge selected junction 0.5 px (Shift: 5 px)'], ['Ctrl Z / Ctrl Y', 'Undo / redo'], ['Ctrl K', 'Search'],
];

export function HelpPage() {
  usePageChrome([{ label: 'Info & parameters' }]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Info and parameters</h1>
          <p className="sub">What each input does, and how the 2D plan becomes a 3D model. The same explanations appear next to each field as (i) tips.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card"><HelpBrowser /></div>
        <div className="stack" style={{ position: 'sticky', top: 0 }}>
          <div className="hero-card">
            <div className="row" style={{ marginBottom: 8 }}><Icon name="sparkle" /><strong>{HELP.workflow.title}</strong></div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{HELP.workflow.text}</div>
          </div>
          <div className="card">
            <h3>Keyboard shortcuts</h3>
            <table className="list">
              <tbody>
                {SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
