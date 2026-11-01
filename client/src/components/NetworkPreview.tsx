import type { ProjectPreview } from '../api';
import { api } from '../api';

/** Mini map of a plan: the faded sheet with detected drives drawn on top (animated). */
export function NetworkPreview({ preview, delay = 0 }: { preview: ProjectPreview | null; delay?: number }) {
  if (!preview) {
    return (
      <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.6" fill="var(--border-strong)" /></pattern>
        </defs>
        <rect width="100" height="60" fill="url(#dots)" />
      </svg>
    );
  }
  const [x0, y0, x1, y1] = preview.bbox;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.08 + 4;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  const sw = Math.max(vb[2], vb[3]) / 180;
  return (
    <svg viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid slice">
      <image href={api.planImageUrl(preview.planId)} x={0} y={0} width={preview.width} height={preview.height} opacity={0.22} style={{ filter: 'grayscale(1)' }} />
      {preview.stopes.map((s, i) => (
        <polygon key={'s' + i} points={s.map((q) => q.join(',')).join(' ')} fill="var(--gold-soft)" stroke="var(--gold)" strokeWidth={sw * 0.6} />
      ))}
      {preview.edges.map((e, i) => (
        <polyline key={i} points={e.map((q) => q.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={sw * 1.4}
          strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="draw-path" style={{ animationDelay: `${delay + (i % 30) * 0.015}s` }} />
      ))}
    </svg>
  );
}
