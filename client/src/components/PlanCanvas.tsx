import { useCallback, useEffect, useRef, useState } from 'react';
import {
  findSnap, nearestOnPolyline, pointInPolygon, type GeoRefPoint, type PlanNetwork, type Polygon, type Vec2,
} from '@mineplan/shared';

export type Tool = 'select' | 'pan' | 'region' | 'exclude' | 'drive' | 'stope' | 'calibrate';

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'stope'; id: string }
  | { kind: 'region'; index: number }
  | { kind: 'exclude'; index: number }
  | null;

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  network: PlanNetwork;
  regions: Polygon[];
  excludes: Polygon[];
  calibration: GeoRefPoint[];
  maskUrl?: string | null;
  showMask: boolean;
  showNetwork: boolean;
  tool: Tool;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onPolygon: (tool: 'region' | 'exclude' | 'stope', poly: Polygon) => void;
  onPolyline: (pts: Vec2[]) => void;
  onMoveNode: (id: string, p: Vec2) => void;
  onCalibrate: (p: Vec2) => void;
  onDelete: () => void;
}

const COLORS = {
  drive: '#f54b00',
  node: '#101010',
  deadEnd: '#f54b00',
  select: '#1441f5',
  region: '#1441f5',
  exclude: '#eb0d0d',
  stope: '#a08c64',
  draft: '#1441f5',
};

export function PlanCanvas(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const maskRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(0);
  const view = useRef({ scale: 1, ox: 0, oy: 0, fitted: false });
  const [draft, setDraft] = useState<Vec2[]>([]);
  const draftRef = useRef<Vec2[]>([]);
  draftRef.current = draft;
  const [hover, setHover] = useState<Vec2 | null>(null);
  const drag = useRef<{ mode: 'pan' | 'node'; sx: number; sy: number; ox: number; oy: number; nodeId?: string; moved: boolean } | null>(null);
  const [dragNode, setDragNode] = useState<{ id: string; p: Vec2 } | null>(null);
  const [, force] = useState(0);
  const redraw = () => force((n) => n + 1);

  // load images
  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgReady((n) => n + 1); };
    img.src = p.imageUrl;
  }, [p.imageUrl]);
  useEffect(() => {
    if (!p.maskUrl) { maskRef.current = null; redraw(); return; }
    const img = new Image();
    img.onload = () => { maskRef.current = img; redraw(); };
    img.src = p.maskUrl;
  }, [p.maskUrl]);

  // reset draft when tool changes
  useEffect(() => setDraft([]), [p.tool]);

  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const s = Math.min(c.clientWidth / p.imageWidth, c.clientHeight / p.imageHeight) * 0.95;
    view.current = { scale: s, ox: (c.clientWidth - p.imageWidth * s) / 2, oy: (c.clientHeight - p.imageHeight * s) / 2, fitted: true };
    redraw();
  }, [p.imageWidth, p.imageHeight]);

  // resize
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const c = canvasRef.current, w = wrapRef.current;
      if (!c || !w) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = w.clientWidth * dpr;
      c.height = w.clientHeight * dpr;
      c.style.width = w.clientWidth + 'px';
      c.style.height = w.clientHeight + 'px';
      if (!view.current.fitted) fit();
      else redraw();
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [fit]);

  const toImg = (sx: number, sy: number): Vec2 => [(sx - view.current.ox) / view.current.scale, (sy - view.current.oy) / view.current.scale];
  const pxTol = (screenPx: number) => screenPx / view.current.scale;

  // ---------------------------------------------------------------- drawing
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const { scale, ox, oy } = view.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = scale < 2;
    if (imgRef.current) ctx.drawImage(imgRef.current, 0, 0);
    if (p.showMask && maskRef.current) ctx.drawImage(maskRef.current, 0, 0);
    const lw = 1 / scale;

    const path = (poly: Vec2[], close: boolean) => {
      ctx.beginPath();
      poly.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      if (close) ctx.closePath();
    };

    // regions & excludes
    p.regions.forEach((r, i) => {
      path(r, true);
      ctx.fillStyle = 'rgba(20,65,245,0.06)';
      ctx.fill();
      ctx.setLineDash([6 * lw, 4 * lw]);
      ctx.strokeStyle = COLORS.region;
      ctx.lineWidth = (p.selection?.kind === 'region' && p.selection.index === i ? 3 : 1.5) * lw;
      ctx.stroke();
      ctx.setLineDash([]);
    });
    p.excludes.forEach((r, i) => {
      path(r, true);
      ctx.fillStyle = 'rgba(235,13,13,0.10)';
      ctx.fill();
      ctx.strokeStyle = COLORS.exclude;
      ctx.lineWidth = (p.selection?.kind === 'exclude' && p.selection.index === i ? 3 : 1.5) * lw;
      ctx.stroke();
    });

    if (p.showNetwork) {
      // stopes
      for (const s of p.network.stopes) {
        path(s.polygon, true);
        ctx.fillStyle = 'rgba(160,140,100,0.30)';
        ctx.fill();
        ctx.strokeStyle = p.selection?.kind === 'stope' && p.selection.id === s.id ? COLORS.select : COLORS.stope;
        ctx.lineWidth = 2 * lw;
        ctx.stroke();
      }
      // edges
      const nodePos = new Map(p.network.nodes.map((n) => [n.id, [n.x, n.y] as Vec2]));
      if (dragNode) nodePos.set(dragNode.id, dragNode.p);
      const deg = new Map<string, number>();
      for (const e of p.network.edges) {
        deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
        deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
        const pts = e.points.slice();
        pts[0] = nodePos.get(e.a) ?? pts[0];
        pts[pts.length - 1] = nodePos.get(e.b) ?? pts[pts.length - 1];
        path(pts, false);
        const sel = p.selection?.kind === 'edge' && p.selection.id === e.id;
        ctx.strokeStyle = sel ? COLORS.select : COLORS.drive;
        ctx.lineWidth = Math.max(2 * lw, sel ? 4 * lw : 2 * lw);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      // nodes
      const r = Math.max(2.5 * lw, 0.8);
      for (const n of p.network.nodes) {
        const q = nodePos.get(n.id)!;
        const d = deg.get(n.id) ?? 0;
        const sel = p.selection?.kind === 'node' && p.selection.id === n.id;
        ctx.beginPath();
        if (d === 1) ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
        else ctx.rect(q[0] - r, q[1] - r, 2 * r, 2 * r);
        ctx.fillStyle = sel ? COLORS.select : d === 1 ? COLORS.deadEnd : COLORS.node;
        ctx.fill();
      }
    }

    // calibration points
    p.calibration.forEach((c, i) => {
      const s = 10 * lw;
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2 * lw;
      ctx.beginPath();
      ctx.moveTo(c.px[0] - s, c.px[1]); ctx.lineTo(c.px[0] + s, c.px[1]);
      ctx.moveTo(c.px[0], c.px[1] - s); ctx.lineTo(c.px[0], c.px[1] + s);
      ctx.stroke();
      ctx.font = `${12 * lw}px Arial`;
      ctx.fillStyle = COLORS.select;
      ctx.fillText(`${i + 1}: ${c.world[0]}E ${c.world[1]}N`, c.px[0] + s, c.px[1] - s);
    });

    // draft
    if (draft.length) {
      const pts = hover ? [...draft, hover] : draft;
      path(pts, p.tool !== 'drive' && pts.length > 2);
      ctx.strokeStyle = COLORS.draft;
      ctx.lineWidth = 2 * lw;
      ctx.setLineDash([4 * lw, 3 * lw]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const q of draft) {
        ctx.beginPath();
        ctx.arc(q[0], q[1], 3 * lw, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.draft;
        ctx.fill();
      }
    }
    // snap indicator for the drive tool
    if (p.tool === 'drive' && hover) {
      const snap = findSnap(p.network, hover, pxTol(10));
      if (snap.kind !== 'none') {
        ctx.beginPath();
        ctx.arc(snap.point[0], snap.point[1], 6 * lw, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.select;
        ctx.lineWidth = 2 * lw;
        ctx.stroke();
      }
    }
  });

  // ---------------------------------------------------------------- interaction
  const finishDraft = () => {
    // double-click adds the same point twice; drop near-duplicates
    const tol = pxTol(4);
    const draft = draftRef.current.filter((q, i, arr) => i === 0 || Math.hypot(q[0] - arr[i - 1][0], q[1] - arr[i - 1][1]) > tol);
    if (p.tool === 'drive') {
      if (draft.length >= 2) p.onPolyline(snapEnds(draft));
    } else if ((p.tool === 'region' || p.tool === 'exclude' || p.tool === 'stope') && draft.length >= 3) {
      p.onPolygon(p.tool, draft);
    }
    setDraft([]);
  };

  const snapEnds = (pts: Vec2[]): Vec2[] => {
    const out = pts.slice();
    for (const i of [0, out.length - 1]) {
      const s = findSnap(p.network, out[i], pxTol(10));
      if (s.kind !== 'none') out[i] = s.point;
    }
    return out;
  };

  const pick = (q: Vec2): Selection => {
    const tol = pxTol(8);
    let best: Selection = null;
    let bestD = tol;
    if (p.showNetwork) {
      for (const n of p.network.nodes) {
        const d = Math.hypot(n.x - q[0], n.y - q[1]);
        if (d < bestD) { bestD = d; best = { kind: 'node', id: n.id }; }
      }
      if (best) return best;
      for (const e of p.network.edges) {
        const r = nearestOnPolyline(q, e.points);
        if (r.d < bestD) { bestD = r.d; best = { kind: 'edge', id: e.id }; }
      }
      if (best) return best;
      for (const s of p.network.stopes) if (pointInPolygon(q, s.polygon)) return { kind: 'stope', id: s.id };
    }
    for (let i = p.excludes.length - 1; i >= 0; i--) if (pointInPolygon(q, p.excludes[i])) return { kind: 'exclude', index: i };
    for (let i = p.regions.length - 1; i >= 0; i--) if (pointInPolygon(q, p.regions[i])) return { kind: 'region', index: i };
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const q = toImg(sx, sy);
    const wantsPan = e.button === 1 || e.button === 2 || p.tool === 'pan' || (e.button === 0 && e.altKey);
    if (wantsPan) {
      drag.current = { mode: 'pan', sx, sy, ox: view.current.ox, oy: view.current.oy, moved: false };
      return;
    }
    if (e.button !== 0) return;
    if (p.tool === 'select') {
      const s = pick(q);
      p.onSelect(s);
      if (s?.kind === 'node') drag.current = { mode: 'node', sx, sy, ox: 0, oy: 0, nodeId: s.id, moved: false };
      else drag.current = { mode: 'pan', sx, sy, ox: view.current.ox, oy: view.current.oy, moved: false };
      return;
    }
    if (p.tool === 'calibrate') {
      p.onCalibrate([Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]);
      return;
    }
    // polygon / polyline tools
    if (draft.length >= 3 && p.tool !== 'drive') {
      const first = draft[0];
      if (Math.hypot(first[0] - q[0], first[1] - q[1]) < pxTol(10)) { finishDraft(); return; }
    }
    setDraft((d) => [...d, q]);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const q = toImg(sx, sy);
    const d = drag.current;
    if (d) {
      if (Math.hypot(sx - d.sx, sy - d.sy) > 3) d.moved = true;
      if (d.mode === 'pan') {
        view.current.ox = d.ox + (sx - d.sx);
        view.current.oy = d.oy + (sy - d.sy);
        redraw();
      } else if (d.mode === 'node' && d.moved) {
        setDragNode({ id: d.nodeId!, p: q });
      }
      return;
    }
    if (p.tool === 'drive' || draft.length) setHover(q);
  };

  const onMouseUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'node' && d.moved && dragNode) p.onMoveNode(dragNode.id, dragNode.p);
    setDragNode(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const v = view.current;
    const ns = Math.min(40, Math.max(0.05, v.scale * k));
    v.ox = sx - ((sx - v.ox) * ns) / v.scale;
    v.oy = sy - ((sy - v.oy) * ns) / v.scale;
    v.scale = ns;
    redraw();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') setDraft([]);
      else if (e.key === 'Enter') finishDraft();
      else if (e.key === 'Backspace' && draft.length) { e.preventDefault(); setDraft((d) => d.slice(0, -1)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && p.selection) { e.preventDefault(); p.onDelete(); }
      else if (e.key === 'f') fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { if (imgReady) redraw(); }, [imgReady]);

  const cursor = p.tool === 'pan' ? 'grab' : p.tool === 'select' ? 'default' : 'crosshair';
  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { setHover(null); onMouseUp(); }}
        onDoubleClick={(e) => { e.preventDefault(); finishDraft(); }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div style={{ position: 'absolute', right: 12, top: 12 }}>
        <button onClick={fit} title="Fit to view (F)">Fit</button>
      </div>
    </div>
  );
}
