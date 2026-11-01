import { describe, expect, it } from 'vitest';
import {
  addPolyline, assemble, defaultProfile, emptyNetwork, fitSimilarity, matchConnectors, mergeDegree2, nearestDrive, normalisationMatrix, straightRun,
  pxToWorld, transformPoint, worldToPx, type AssetMeta, type GeoRef, type PlanNetwork,
} from '../src';

describe('georef', () => {
  it('fits a rotated plan (north to the left, as on the 445 S6S7 sheet)', () => {
    // Sheet rotated 90deg: image +x = north, image +y = east
    const g: GeoRef = {
      metersPerPixel: 1,
      points: [
        { px: [100, 200], world: [39900, 19400] },
        { px: [300, 400], world: [40100, 19600] },
      ],
    };
    const t = fitSimilarity(g);
    const w = pxToWorld(t, [100, 400]);
    expect(w[0]).toBeCloseTo(40100, 6);
    expect(w[1]).toBeCloseTo(19400, 6);
    const back = worldToPx(t, w);
    expect(back[0]).toBeCloseTo(100, 6);
    expect(back[1]).toBeCloseTo(400, 6);
  });
});

describe('network editing', () => {
  it('snaps new drives onto existing ones and creates a junction', () => {
    let net: PlanNetwork = emptyNetwork();
    net = addPolyline(net, [[0, 0], [100, 0]], 5);
    net = addPolyline(net, [[50, 2], [50, 80]], 5);
    expect(net.edges.length).toBe(3);
    expect(net.nodes.length).toBe(4);
    const merged = mergeDegree2(net);
    expect(merged.edges.length).toBe(3);
  });
});

describe('connector matching', () => {
  const T = [
    { side: '-X' as const, distance: 3, connectionType: 'd' },
    { side: '+X' as const, distance: 3, connectionType: 'd' },
    { side: '-Z' as const, distance: 3, connectionType: 'd' },
  ];
  it('matches a rotated T', () => {
    const th = 0.3;
    const dirs: [number, number][] = [
      [Math.cos(th), Math.sin(th)], [-Math.cos(th), -Math.sin(th)], [Math.sin(th), -Math.cos(th)],
    ];
    expect(matchConnectors(T, dirs, 0.2)).not.toBeNull();
  });
  it('rejects a Y junction', () => {
    const dirs: [number, number][] = [[1, 0], [-0.5, 0.866], [-0.5, -0.866]];
    expect(matchConnectors(T, dirs, 0.2)).toBeNull();
  });
});

describe('assembly', () => {
  const georef: GeoRef = { metersPerPixel: 0.5, points: [] };
  let net: PlanNetwork = emptyNetwork();
  net = addPolyline(net, [[0, 0], [200, 0]], 3);
  net = addPolyline(net, [[100, 0], [100, 150]], 3);

  it('uses built-in modules and parametric hubs without a kit', () => {
    const a = assemble([{ planId: 'p', levelRL: 445, georef, network: net }], defaultProfile());
    expect(a.hubs.length).toBe(1);
    expect(a.pieces.filter((p) => p.source === 'builtin-cap').length).toBe(3);
    expect(a.stats.straightModules).toBeGreaterThan(30);
    expect(a.stats.lengthM).toBeCloseTo(175, 3);
  });

  it('places a kit T-junction when one matches', () => {
    const meta: AssetMeta = {
      unitScale: 1, upAxis: 'Y', forward: '+X', pivot: [0, 0, 0],
      dims: { length: 8, height: 5, width: 8 }, crossSection: { width: 5.5, height: 5 }, connectionType: 'd',
      connectors: [
        { side: '-X', distance: 4, connectionType: 'd' },
        { side: '+X', distance: 4, connectionType: 'd' },
        { side: '+Z', distance: 4, connectionType: 'd' },
      ],
      fitToDriveWidth: true,
    };
    const a = assemble([{ planId: 'p', levelRL: 0, georef, network: net }], defaultProfile(), {
      connectors: [{ id: 'T1', slot: 'junctionT', meta }], decorations: [], angleToleranceDeg: 15,
    });
    expect(a.hubs.length).toBe(0);
    expect(a.stats.assetJunctions).toBe(1);
  });
});

describe('drive naming', () => {
  it('follows the straight run through a junction and labels named drives', () => {
    let net: PlanNetwork = emptyNetwork();
    net = addPolyline(net, [[0, 0], [200, 0]], 3);
    net = addPolyline(net, [[100, 0], [100, 150]], 3); // splits the main drive at x=100
    const main = net.edges.find((e) => e.points.some((p) => p[0] === 0))!;
    const run = straightRun(net, main.id);
    expect(run.length).toBe(2); // both halves of the main drive, not the crosscut
    net = { ...net, edges: net.edges.map((e) => (run.includes(e.id) ? { ...e, name: 'Main drive', kind: 'drive' as const } : { ...e, name: 'XC 1', kind: 'crosscut' as const })) };
    const a = assemble([{ planId: 'p', levelRL: 0, georef: { metersPerPixel: 1, points: [] }, network: net }], defaultProfile());
    expect(a.labels.some((l) => l.text === 'Main drive')).toBe(true);
    expect(a.labels.some((l) => l.text === 'XC 1' && l.kind === 'crosscut')).toBe(true);
    const seg = a.collision.find((c) => c.name === 'XC 1')!;
    const mid: [number, number] = [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2];
    expect(nearestDrive(mid, 0, a.collision)?.seg.name).toBe('XC 1');
  });
});

describe('asset normalisation', () => {
  it('maps a Z-up, +Y-forward... model into canonical frame', () => {
    const m = normalisationMatrix({ unitScale: 0.01, upAxis: 'Z', forward: '+Z', pivot: [0, 0, 0] });
    // after Z-up correction, model +Z(up) -> +Y
    const up = transformPoint(m, [0, 0, 100]);
    expect(up[1]).toBeCloseTo(1, 6);
  });
});
