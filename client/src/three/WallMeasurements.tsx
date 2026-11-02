import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { formatLength, layoutAt, layoutOnWalls, tickInterval, type CollisionSegment, type LengthUnit, type Vec3 } from '@mineplan/shared';
import { Sign, signTexture } from './Signs';

export interface WallMeasureItem {
  id: string;
  label: string;
  color: string;
  /** three.js local points at floor level */
  points: Vec3[];
  source: 'plan' | 'model';
}

const TAPE_H = 1.5; // tape height above the floor (shoulder height)
const SIGN_H = 2.35; // centre of the wall sign

/** A text panel fixed flat on a wall, facing into the drive along `n`. */
function WallLabel({ p, n, text, sub, accent, height }: { p: Vec3; n: [number, number]; text: string; sub?: string; accent: string; height: number }) {
  const { tex, aspect } = useMemo(() => signTexture(text, sub, accent), [text, sub, accent]);
  const rotY = Math.atan2(n[0], n[1]);
  return (
    <mesh position={[p[0] + n[0] * 0.03, p[1], p[2] + n[1] * 0.03]} rotation={[0, rotY, 0]} renderOrder={6}>
      <planeGeometry args={[height * aspect, height]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

function Measurement({ m, segs, unit, overview, selected, signScale }: { m: WallMeasureItem; segs: CollisionSegment[]; unit: LengthUnit; overview: boolean; selected: boolean; signScale: number }) {
  const layout = useMemo(() => layoutOnWalls(m.points, segs), [m.points, segs]);
  const up = (p: Vec3, h: number): Vec3 => [p[0], p[1] + h, p[2]];
  const tape = useMemo(() => layout.samples.map((s) => up(s.p, TAPE_H)), [layout]);
  const interval = tickInterval(layout.total, 10);
  const ticks = useMemo(() => {
    const out: { s: number; major: boolean }[] = [];
    for (let s = interval; s < layout.total - interval * 0.25; s += interval) out.push({ s, major: false });
    for (const s of layout.vertexS) out.push({ s, major: true });
    return out;
  }, [layout, interval]);
  if (tape.length < 2) return null;
  const mid = layoutAt(layout, layout.total / 2);
  const f = (v: number) => formatLength(v, unit, v >= 100 ? 1 : undefined);
  const segCount = m.points.length - 1;

  return (
    <group name={`measure-${m.id}`}>
      <Line points={tape} color={m.color} lineWidth={selected ? 5 : 3} depthTest={!overview} transparent opacity={0.95} renderOrder={5} />
      {ticks.map(({ s, major }, i) => {
        const q = layoutAt(layout, s);
        const h0 = major ? 0.25 : TAPE_H - 0.18, h1 = major ? TAPE_H + 0.45 : TAPE_H + 0.18;
        return (
          <group key={i}>
            <Line points={[up(q.p, h0), up(q.p, h1)]} color={m.color} lineWidth={major ? 3 : 2} depthTest={!overview} />
            {!overview && (q.wall && q.n
              ? <WallLabel p={up(q.p, (major ? TAPE_H + 0.62 : TAPE_H + 0.32))} n={q.n} text={f(s)} accent={m.color} height={major ? 0.26 : 0.18} />
              : <Sign position={up(q.p, TAPE_H + 0.45)} text={f(s)} height={0.22} accent={m.color} />)}
          </group>
        );
      })}
      {/* main sign: on the wall in the walk-through, floating above the model in the overview */}
      {overview
        ? <Sign position={up(mid.p, 6 + signScale)} text={`${m.label} · ${f(layout.total)}`} height={signScale} accent={m.color} />
        : mid.wall && mid.n
          ? <WallLabel p={up(mid.p, SIGN_H)} n={mid.n} text={m.label} sub={`${f(layout.total)}${segCount > 1 ? ` · ${segCount} segments` : ''}`} accent={m.color} height={0.62} />
          : <Sign position={up(mid.p, SIGN_H)} text={m.label} sub={f(layout.total)} height={0.62} accent={m.color} />}
      {!overview && segCount > 1 && layout.vertexS.slice(1).map((s1, i) => {
        const s0 = layout.vertexS[i];
        if (s1 - s0 < 12) return null;
        const q = layoutAt(layout, (s0 + s1) / 2);
        const text = `Segment ${i + 1}`, sub = f(s1 - s0);
        return q.wall && q.n
          ? <WallLabel key={i} p={up(q.p, SIGN_H - 0.05)} n={q.n} text={text} sub={sub} accent={m.color} height={0.42} />
          : <Sign key={i} position={up(q.p, SIGN_H)} text={text} sub={sub} height={0.42} accent={m.color} />;
      })}
    </group>
  );
}

/** Measured distances shown on the drive walls (tape, distance ticks and signs). */
export function WallMeasurements({ items, segs, unit, overview, selectedId, modelSize = 200 }: {
  items: WallMeasureItem[]; segs: CollisionSegment[]; unit: LengthUnit; overview: boolean; selectedId?: string | null;
  /** largest horizontal extent of the model (m), to size the overview signs */
  modelSize?: number;
}) {
  // overview signs grow with the mine so they stay readable from the default camera distance
  const signScale = Math.max(4, Math.min(40, modelSize / 45));
  return (
    <group name="measurements">
      {items.map((m) => <Measurement key={m.id} m={m} segs={segs} unit={unit} overview={overview} selected={m.id === selectedId} signScale={signScale} />)}
    </group>
  );
}

/** Live preview while measuring in the 3D model. */
export function MeasureDraft({ points, cursor, overview }: { points: Vec3[]; cursor?: Vec3 | null; overview: boolean }) {
  const pts = cursor && points.length ? [...points, cursor] : points;
  const lifted = pts.map((p) => [p[0], p[1] + TAPE_H, p[2]] as Vec3);
  return (
    <group name="measure-draft">
      {lifted.length >= 2 && <Line points={lifted} color="#22c55e" lineWidth={3} dashed={!!cursor} dashSize={0.6} gapSize={0.3} depthTest={!overview} />}
      {points.map((p, i) => (
        <mesh key={i} position={[p[0], p[1] + TAPE_H, p[2]]}>
          <sphereGeometry args={[overview ? 0.9 : 0.12, 16, 12]} />
          <meshBasicMaterial color={i === 0 ? '#ffffff' : '#22c55e'} depthTest={!overview} />
        </mesh>
      ))}
      {points.map((p, i) => (
        <Line key={'v' + i} points={[[p[0], p[1], p[2]], [p[0], p[1] + TAPE_H + 0.4, p[2]]]} color="#22c55e" lineWidth={2} depthTest={!overview} />
      ))}
    </group>
  );
}

/** Convenience: unit vector type guard used by the viewer. */
export const toVec3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
