import { useId } from 'react';

/**
 * "Portal" logo of the Mine Development Tool: a tunnel entrance with the drive profile used in the
 * 3D model (flat floor, straight walls, arched back), its opening set off center so the drive
 * seems to curve away into the rock. Geometry on a 512 grid; keep in sync with public/favicon.svg.
 */
export const PORTAL_OUTER = 'M128 392 V262 A128 128 0 0 1 384 262 V392 Z';
export const PORTAL_OPENING = 'M238 392 V300 A52 52 0 0 1 342 300 V392 Z';

/** The mark alone; the opening is cut out, so it works on any background. */
export function PortalMark({ size = 24, color = 'currentColor', title }: { size?: number; color?: string; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="108 114 296 296" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <mask id={`portal-${id}`}>
        <rect x="0" y="0" width="512" height="512" fill="#fff" />
        <path d={PORTAL_OPENING} fill="#000" />
      </mask>
      <path d={PORTAL_OUTER} fill={color} stroke={color} strokeWidth={28} strokeLinejoin="round" mask={`url(#portal-${id})`} />
    </svg>
  );
}

/** App icon: the mark on a rounded tile (colors follow the theme through CSS variables). */
export function PortalIcon({ size = 40, title = 'Mine Development Tool' }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="portal-icon" width={size} height={size} viewBox="0 0 512 512" role="img" aria-label={title}>
      <mask id={`portal-tile-${id}`}>
        <rect x="0" y="0" width="512" height="512" fill="#fff" />
        <path d={PORTAL_OPENING} fill="#000" />
      </mask>
      <rect x="0" y="0" width="512" height="512" rx="118" fill="var(--logo-tile)" />
      <path d={PORTAL_OUTER} fill="var(--logo-ink)" stroke="var(--logo-ink)" strokeWidth={28} strokeLinejoin="round" mask={`url(#portal-tile-${id})`} />
    </svg>
  );
}
