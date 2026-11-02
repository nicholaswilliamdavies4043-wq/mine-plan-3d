import { describe, expect, it } from 'vitest';
import { deepEqual, mergePatch, formatLength, scaleFromLine, measurementsCsv, polylineLength3, type PlanNetwork } from '../src';

const net = (): PlanNetwork => ({
  nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 10, y: 10 }],
  edges: [
    { id: 'e1', a: 'a', b: 'b', points: [[0, 0], [10, 0]] },
    { id: 'e2', a: 'b', b: 'c', points: [[10, 0], [10, 10]] },
  ],
  stopes: [],
});

describe('offline merge', () => {
  it('treats key order and missing/undefined as equal', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('keeps edits from both sides of the drive network', () => {
    const base = net();
    // offline: rename e1 and add a new drive from c
    const local = net();
    local.edges[0].name = 'XC 1';
    local.nodes.push({ id: 'd', x: 20, y: 10 });
    local.edges.push({ id: 'e3', a: 'c', b: 'd', points: [[10, 10], [20, 10]] });
    // server meanwhile: kind on e1, delete e2 is NOT done, add a stope
    const server = net();
    server.edges[0].kind = 'crosscut';
    server.stopes.push({ id: 's1', polygon: [[0, 0], [1, 0], [1, 1]], heightM: 20, baseOffsetM: 0 });
    const { patch, conflicts } = mergePatch({ network: base }, { network: local }, { network: server });
    const n = patch.network!;
    expect(conflicts).toEqual([]);
    expect(n.edges.find((e) => e.id === 'e1')).toMatchObject({ name: 'XC 1', kind: 'crosscut' });
    expect(n.edges.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(n.nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(n.stopes).toHaveLength(1);
  });

  it('applies offline deletions and repairs dangling segments', () => {
    const base = net();
    const local = { ...net(), edges: net().edges.filter((e) => e.id !== 'e2'), nodes: net().nodes.filter((x) => x.id !== 'c') };
    const server = net();
    server.nodes = server.nodes.map((x) => (x.id === 'b' ? { ...x, x: 12 } : x)); // moved b on the server
    server.edges = server.edges.map((e) => (e.id === 'e1' ? { ...e, points: [[0, 0], [12, 0]] } : e));
    const { patch } = mergePatch({ network: base }, { network: local }, { network: server });
    const n = patch.network!;
    expect(n.edges.map((e) => e.id)).toEqual(['e1']);
    expect(n.edges[0].points[1]).toEqual([12, 0]);
    expect(n.nodes.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('reports a conflict on a scalar edited on both sides and keeps the offline value', () => {
    const { patch, conflicts } = mergePatch<{ levelRL: number }>({ levelRL: 0 }, { levelRL: 445 }, { levelRL: 440 });
    expect(patch.levelRL).toBe(445);
    expect(conflicts.map((c) => c.path)).toEqual(['levelRL']);
  });

  it('takes the server value when the field was not really changed offline', () => {
    const { patch } = mergePatch<{ name: string }>({ name: 'A' }, { name: 'A' }, { name: 'B' });
    expect(patch.name).toBe('B');
  });
});

describe('measurement helpers', () => {
  it('formats lengths and computes scale from a known distance', () => {
    expect(formatLength(1234.6, 'km')).toBe('1.235 km');
    expect(formatLength(10, 'ft')).toBe('32.8 ft');
    expect(scaleFromLine([0, 0], [200, 0], 50)).toBeCloseTo(0.25);
    expect(scaleFromLine([0, 0], [0, 0], 50)).toBeNull();
    expect(polylineLength3([[0, 0, 0], [3, 4, 0], [3, 4, 12]])).toBe(17);
    expect(measurementsCsv([{ label: 'Line, 1', type: 'line', source: 'Plan', segments: 1, lengthM: 2, pixels: 8 }], 'cm'))
      .toBe('Label,Type,Source,Segments,Pixels,Distance (cm)\n"Line, 1",line,Plan,1,8.00,200.0000');
  });
});

import { layoutOnWalls, layoutAt, tickInterval, type CollisionSegment } from '../src';

describe('measurements on the walls', () => {
  // one east-west drive 6 m wide along z = 0 from x = 0 to 100
  const segs: CollisionSegment[] = [{ a: [0, 0], b: [100, 0], r: 3, y: 0 }];
  it('moves a measurement along the drive onto its left wall', () => {
    const L = layoutOnWalls([[10, 0, 0], [60, 0, 0]], segs);
    expect(L.total).toBe(50);
    expect(L.samples.every((s) => s.wall)).toBe(true);
    // heading east, left is north = -z; the tape sits just inside the wall at z = -(3 - inset)
    expect(L.samples[0].p[2]).toBeCloseTo(-2.95);
    // the label normal points back into the drive (+z)
    expect(L.samples[0].n![1]).toBeCloseTo(1);
    expect(layoutAt(L, 25).p[0]).toBeCloseTo(35);
  });
  it('keeps a line across the drive (or outside drives) on the measured line', () => {
    const L = layoutOnWalls([[50, 0, -20], [50, 0, 20]], segs);
    expect(L.samples.some((s) => s.wall)).toBe(false);
    expect(L.total).toBe(40);
  });
  it('picks readable tick intervals', () => {
    expect(tickInterval(48)).toBe(5);
    expect(tickInterval(430)).toBe(50);
    expect(tickInterval(3)).toBe(1);
  });
});
