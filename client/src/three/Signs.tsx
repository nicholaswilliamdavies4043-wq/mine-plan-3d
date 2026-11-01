import { useMemo } from 'react';
import * as THREE from 'three';
import { DRIVE_KINDS, type DriveLabel } from '@mineplan/shared';

const texCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();

/** Canvas-rendered sign texture (no font files needed). */
export function signTexture(text: string, sub?: string, accent = '#f54b00'): { tex: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${sub ?? ''}|${accent}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const pad = 22, h = sub ? 112 : 84;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 46px Arial';
  const w1 = ctx.measureText(text).width;
  ctx.font = '26px Arial';
  const w2 = sub ? ctx.measureText(sub).width : 0;
  c.width = Math.ceil(Math.max(w1, w2) + pad * 2 + 12);
  c.height = h;
  ctx.fillStyle = 'rgba(16,16,16,0.88)';
  ctx.beginPath();
  ctx.roundRect?.(0, 0, c.width, c.height, 14);
  if (!ctx.roundRect) ctx.rect(0, 0, c.width, c.height);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 10, c.height);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 46px Arial';
  ctx.fillText(text, pad + 6, sub ? 12 : 18);
  if (sub) {
    ctx.font = '26px Arial';
    ctx.fillStyle = '#c9c0b6';
    ctx.fillText(sub, pad + 6, 68);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const out = { tex, aspect: c.width / c.height };
  texCache.set(key, out);
  return out;
}

export function Sign({ position, text, sub, height, accent }: { position: [number, number, number]; text: string; sub?: string; height: number; accent?: string }) {
  const { tex, aspect } = useMemo(() => signTexture(text, sub, accent), [text, sub, accent]);
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={5}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

const kindLabel = (k?: string) => DRIVE_KINDS.find((x) => x.value === k)?.label;

/** Name signs along named drives and crosscuts. */
export function DriveSigns({ labels, overview }: { labels: DriveLabel[]; overview: boolean }) {
  // in the overview signs are larger and lifted above the back so they read from far away
  const h = overview ? 5 : 0.75;
  const lift = overview ? 6 : 0;
  return (
    <group name="drive-signs">
      {labels.map((l, i) => (
        <Sign key={i} position={[l.position[0], l.position[1] + lift, l.position[2]]} text={l.text}
          sub={kindLabel(l.kind)} height={h} accent={l.kind === 'crosscut' ? '#a08c64' : '#f54b00'} />
      ))}
    </group>
  );
}
