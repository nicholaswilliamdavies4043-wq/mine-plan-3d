import { useCallback, useEffect, useRef, useState } from 'react';
import {
  findSnap, nearestOnPolyline, pointInPolygon, type GeoRefPoint, type PlanNetwork, type Polygon, type Vec2,
} from '@mineplan/shared';
import { cssVar, useTheme } from '../ui/theme';

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
  snapEnabled: boolean;
  loupeEnabled: boolean;
  /** metres per pixel, for live measurements */
  mpp: number;
  /** rotation of image +x from grid east (radians), for bearings */
  rotation: number;
  fitSignal: number;
  /** zoom command from toolbar buttons; `seq` changes on every click */
  zoomCmd?: { seq: number; kind: 'in' | 'out' | 'actual' };
  onSelect: (s: Selection) => void;
  onPolygon: (tool: 'region' | 'exclude' | 'stope', poly: Polygon) => void;
  onPolyline: (pts: Vec2[]) => void;
  onMoveNode: (id: string, p: Vec2) => void;
  onCalibrate: (p: Vec2) => void;
  onDelete: () => void;
  onHover?: (p: Vec2 | null) => void;
  onZoom?: (scale: number) => void;
}

const DRAW_TOOLS: Tool[] = ['region', 'exclude', 'drive', 'stope', 'calibrate'];
const LOUPE = 168; // css px
const LOUPE_MAG = 4;

export function PlanCanvas(p: Props) {
  const { theme } = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const maskRef = useRef<HTMLImageElement | null>(null);
  const view = useRef({ scale: 1, ox: 0, oy: 0, fitted: false });
  const [draft, setDraft] = useState<Vec2[]>([]);
  const draftRef = useRef<Vec2[]>([]);
  draftRef.current = draft;
  const freeIdx = useRef<Set<number>>(new Set()); // draft points placed with Ctrl (no snapping)
  const [hover, setHover] = useState<{ img: Vec2; sx: number; sy: number; shift: boolean; ctrl: boolean } | null>(null);
  const [hoverSel, setHoverSel] = useState<Selection>(null);
  const drag = useRef<{ mode: 'pan' | 'node'; sx: number; sy: number; ox: number; oy: number; nodeId?: string; moved: boolean } | null>(null);
  const [dragNode, setDragNode] = useState<{ id: string; p: Vec2 } | null>(null);
  const [tick, setTick] = useState(0);
  const redraw = () => setTick((n) => n + 1);
  const anim = useRef<number | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; redraw(); };
    img.src = p.imageUrl;
  }, [p.imageUrl]);
  useEffect(() => {
    if (!p.maskUrl) { maskRef.current = null; redraw(); return; }
    const img = new Image();
    img.onload = () => { maskRef.current = img; redraw(); };
    img.src = p.maskUrl;
  }, [p.maskUrl]);
  useEffect(() => { setDraft([]); freeIdx.current.clear(); }, [p.tool]);

  /** Smoothly animate the view to a target. */
  const animateTo = useCallback((target: { scale: number; ox: number; oy: number }, ms = 320) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = { ...view.current };
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      view.current.scale = from.scale + (target.scale - from.scale) * e;
      view.current.ox = from.ox + (target.ox - from.ox) * e;
      view.current.oy = from.oy + (target.oy - from.oy) * e;
      p.onZoom?.(view.current.scale);
      redraw();
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [p.onZoom]);

  const fitTarget = useCallback(() => {
    const c = canvasRef.current!;
    const s = Math.min(c.clientWidth / p.imageWidth, c.clientHeight / p.imageHeight) * 0.94;
    return { scale: s, ox: (c.clientWidth - p.imageWidth * s) / 2, oy: (c.clientHeight - p.imageHeight * s) / 2 };
  }, [p.imageWidth, p.imageHeight]);

  useEffect(() => { if (view.current.fitted) animateTo(fitTarget()); }, [p.fitSignal]);

  // zoom buttons: zoom around the centre of the viewport
  useEffect(() => {
    const cmd = p.zoomCmd;
    const c = canvasRef.current;
    if (!cmd || !cmd.seq || !c) return;
    const v = view.current;
    const ns = cmd.kind === 'actual' ? 1 : Math.min(60, Math.max(0.03, v.scale * (cmd.kind === 'in' ? 1.5 : 1 / 1.5)));
    const cx = c.clientWidth / 2, cy = c.clientHeight / 2;
    animateTo({ scale: ns, ox: cx - ((cx - v.ox) * ns) / v.scale, oy: cy - ((cy - v.oy) * ns) / v.scale }, 220);
  }, [p.zoomCmd?.seq]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const c = canvasRef.current, w = wrapRef.current;
      if (!c || !w) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w.clientWidth * dpr);
      c.height = Math.round(w.clientHeight * dpr);
      c.style.width = w.clientWidth + 'px';
      c.style.height = w.clientHeight + 'px';
      if (!view.current.fitted) {
        Object.assign(view.current, fitTarget(), { fitted: true });
        p.onZoom?.(view.current.scale);
      }
      redraw();
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [fitTarget]);

  const toImg = (sx: number, sy: number): Vec2 => [(sx - view.current.ox) / view.current.scale, (sy - view.current.oy) / view.current.scale];
  const toScreen = (q: Vec2): Vec2 => [q[0] * view.current.scale + view.current.ox, q[1] * view.current.scale + view.current.oy];
  const pxTol = (screenPx: number) => screenPx / view.current.scale;

  /** Apply angle lock (Shift) relative to the last draft point. */
  const constrained = (q: Vec2, shift: boolean): Vec2 => {
    const d = draftRef.current;
    if (!shift || !d.length) return q;
    const last = d[d.length - 1];
    const dx = q[0] - last[0], dy = q[1] - last[1];
    const L = Math.hypot(dx, dy);
    const step = Math.PI / 12;
    const a = Math.round(Math.atan2(dy, dx) / step) * step;
    return [last[0] + Math.cos(a) * L, last[1] + Math.sin(a) * L];
  };

  const snapPoint = (q: Vec2, ctrl: boolean): { point: Vec2; snapped: boolean } => {
    if (!p.snapEnabled || ctrl || p.tool !== 'drive') return { point: q, snapped: false };
    const s = findSnap(p.network, q, pxTol(12));
    return s.kind === 'none' ? { point: q, snapped: false } : { point: s.point, snapped: true };
  };

  /** Where the next click would land. */
  const cursorTarget = (): { point: Vec2; snapped: boolean } | null => {
    if (!hover) return null;
    const q = constrained(hover.img, hover.shift);
    // only the first point of a drive snaps while drawing; the last is snapped on finish (preview it too)
    return snapPoint(q, hover.ctrl);
  };

  // ------------------------------------------------------------------ drawing
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const { scale, ox, oy } = view.current;
    const col = {
      bg: cssVar('--canvas-bg', '#141210'), accent: cssVar('--accent', '#f54b00'), select: cssVar('--select', '#327dff'),
      gold: cssVar('--gold', '#a08c64'), text: cssVar('--text', '#fff'), error: cssVar('--error', '#ff5a4f'),
      node: theme === 'dark' ? '#f4efe9' : '#101010',
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = scale < 3;
    // sheet shadow + image
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 24 / scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, p.imageWidth, p.imageHeight);
    ctx.restore();
    if (imgRef.current) {
      if (theme === 'dark') ctx.globalAlpha = 0.92;
      ctx.drawImage(imgRef.current, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (p.showMask && maskRef.current) ctx.drawImage(maskRef.current, 0, 0);
    const lw = 1 / scale;
    const path = (poly: Vec2[], close: boolean) => {
      ctx.beginPath();
      poly.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      if (close) ctx.closePath();
    };
    const isSel = (s: Selection, kind: string, idOrIdx: string | number) =>
      !!s && s.kind === kind && ('id' in s ? s.id === idOrIdx : s.index === idOrIdx);

    p.regions.forEach((r, i) => {
      path(r, true);
      ctx.fillStyle = 'rgba(50,125,255,0.06)';
      ctx.fill();
      ctx.setLineDash([7 * lw, 5 * lw]);
      ctx.strokeStyle = col.select;
      ctx.lineWidth = (isSel(p.selection, 'region', i) ? 3 : isSel(hoverSel, 'region', i) ? 2.2 : 1.5) * lw;
      ctx.stroke();
      ctx.setLineDash([]);
    });
    p.excludes.forEach((r, i) => {
      path(r, true);
      ctx.fillStyle = 'rgba(235,13,13,0.10)';
      ctx.fill();
      ctx.strokeStyle = col.error;
      ctx.lineWidth = (isSel(p.selection, 'exclude', i) ? 3 : 1.5) * lw;
      ctx.stroke();
    });

    if (p.showNetwork) {
      for (const s of p.network.stopes) {
        path(s.polygon, true);
        ctx.fillStyle = 'rgba(160,140,100,0.32)';
        ctx.fill();
        ctx.strokeStyle = isSel(p.selection, 'stope', s.id) ? col.select : col.gold;
        ctx.lineWidth = (isSel(p.selection, 'stope', s.id) || isSel(hoverSel, 'stope', s.id) ? 3 : 2) * lw;
        ctx.stroke();
      }
      const nodePos = new Map(p.network.nodes.map((n) => [n.id, [n.x, n.y] as Vec2]));
      if (dragNode) nodePos.set(dragNode.id, dragNode.p);
      const deg = new Map<string, number>();
      // halo pass for readability on busy plans
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const pass of [0, 1]) {
        for (const e of p.network.edges) {
          if (pass === 0) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
          const pts = e.points.slice();
          pts[0] = nodePos.get(e.a) ?? pts[0];
          pts[pts.length - 1] = nodePos.get(e.b) ?? pts[pts.length - 1];
          path(pts, false);
          const sel = isSel(p.selection, 'edge', e.id);
          const hov = isSel(hoverSel, 'edge', e.id);
          if (pass === 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.75)';
            ctx.lineWidth = Math.max(4.5 * lw, sel || hov ? 7 * lw : 4.5 * lw);
          } else {
            ctx.strokeStyle = sel ? col.select : hov ? cssVar('--accent-2', '#ff824b') : col.accent;
            ctx.lineWidth = sel || hov ? 4 * lw : 2.2 * lw;
          }
          ctx.stroke();
        }
      }
      const r = 3.2 * lw;
      for (const n of p.network.nodes) {
        const q = nodePos.get(n.id)!;
        const d = deg.get(n.id) ?? 0;
        const sel = isSel(p.selection, 'node', n.id);
        const hov = isSel(hoverSel, 'node', n.id);
        ctx.beginPath();
        const rr = sel || hov ? r * 1.6 : r;
        if (d === 1) ctx.arc(q[0], q[1], rr, 0, Math.PI * 2);
        else ctx.rect(q[0] - rr, q[1] - rr, 2 * rr, 2 * rr);
        ctx.fillStyle = sel ? col.select : d === 1 ? col.accent : col.node;
        ctx.fill();
        ctx.lineWidth = 1.2 * lw;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    }

    p.calibration.forEach((cp, i) => {
      const s = 12 * lw;
      ctx.strokeStyle = col.select;
      ctx.lineWidth = 2 * lw;
      ctx.beginPath();
      ctx.arc(cp.px[0], cp.px[1], s * 0.6, 0, Math.PI * 2);
      ctx.moveTo(cp.px[0] - s, cp.px[1]); ctx.lineTo(cp.px[0] + s, cp.px[1]);
      ctx.moveTo(cp.px[0], cp.px[1] - s); ctx.lineTo(cp.px[0], cp.px[1] + s);
      ctx.stroke();
      const label = `${i + 1}  ${cp.world[0]}E  ${cp.world[1]}N`;
      ctx.font = `${12 * lw}px Arial`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = col.select;
      ctx.fillRect(cp.px[0] + s, cp.px[1] - s - 16 * lw, tw + 10 * lw, 18 * lw);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, cp.px[0] + s + 5 * lw, cp.px[1] - s - 3 * lw);
    });

    // draft shape
    const target = cursorTarget();
    if (draft.length) {
      const pts = target && DRAW_TOOLS.includes(p.tool) ? [...draft, target.point] : draft;
      path(pts, p.tool !== 'drive' && pts.length > 2);
      if (p.tool !== 'drive' && pts.length > 2) {
        ctx.fillStyle = p.tool === 'exclude' ? 'rgba(235,13,13,0.08)' : p.tool === 'stope' ? 'rgba(160,140,100,0.2)' : 'rgba(50,125,255,0.08)';
        ctx.fill();
      }
      ctx.strokeStyle = col.select;
      ctx.lineWidth = 2 * lw;
      ctx.setLineDash([6 * lw, 4 * lw]);
      ctx.stroke();
      ctx.setLineDash([]);
      draft.forEach((q, i) => {
        ctx.beginPath();
        ctx.arc(q[0], q[1], (i === 0 ? 4.5 : 3.2) * lw, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#fff' : col.select;
        ctx.fill();
        ctx.strokeStyle = col.select;
        ctx.lineWidth = 1.5 * lw;
        ctx.stroke();
      });
    }
    // snap ring
    if (target?.snapped) {
      ctx.beginPath();
      ctx.arc(target.point[0], target.point[1], 8 * lw, 0, Math.PI * 2);
      ctx.strokeStyle = col.select;
      ctx.lineWidth = 2.2 * lw;
      ctx.stroke();
    }

    // precision crosshair (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (hover && DRAW_TOOLS.includes(p.tool) && target) {
      const [sx, sy] = toScreen(target.point);
      const W = c.width / dpr, H = c.height / dpr;
      ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(16,16,16,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, sy + 0.5); ctx.lineTo(sx - 14, sy + 0.5); ctx.moveTo(sx + 14, sy + 0.5); ctx.lineTo(W, sy + 0.5);
      ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, sy - 14); ctx.moveTo(sx + 0.5, sy + 14); ctx.lineTo(sx + 0.5, H);
      ctx.stroke();
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy + 0.5); ctx.lineTo(sx - 3, sy + 0.5); ctx.moveTo(sx + 3, sy + 0.5); ctx.lineTo(sx + 9, sy + 0.5);
      ctx.moveTo(sx + 0.5, sy - 9); ctx.lineTo(sx + 0.5, sy - 3); ctx.moveTo(sx + 0.5, sy + 3); ctx.lineTo(sx + 0.5, sy + 9);
      ctx.stroke();
      ctx.fillStyle = col.accent;
      ctx.fillRect(sx, sy, 1, 1);
    }

    // magnifier
    const lc = loupeRef.current;
    if (lc && hover && p.loupeEnabled && (DRAW_TOOLS.includes(p.tool) || drag.current?.mode === 'node')) {
      const lctx = lc.getContext('2d')!;
      const size = LOUPE * dpr;
      if (lc.width !== size) { lc.width = size; lc.height = size; }
      const pt = target?.point ?? hover.img;
      const [sx, sy] = toScreen(pt);
      const src = size / LOUPE_MAG;
      lctx.imageSmoothingEnabled = false;
      lctx.fillStyle = col.bg;
      lctx.fillRect(0, 0, size, size);
      lctx.drawImage(c, sx * dpr - src / 2, sy * dpr - src / 2, src, src, 0, 0, size, size);
      lctx.strokeStyle = col.accent;
      lctx.lineWidth = 1.5 * dpr;
      lctx.beginPath();
      const m = size / 2;
      lctx.moveTo(m - 22 * dpr, m); lctx.lineTo(m - 5 * dpr, m); lctx.moveTo(m + 5 * dpr, m); lctx.lineTo(m + 22 * dpr, m);
      lctx.moveTo(m, m - 22 * dpr); lctx.lineTo(m, m - 5 * dpr); lctx.moveTo(m, m + 5 * dpr); lctx.lineTo(m, m + 22 * dpr);
      lctx.stroke();
    }
  });

  // ------------------------------------------------------------------ picking
  const pick = (q: Vec2): Selection => {
    const tol = pxTol(9);
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

  // ------------------------------------------------------------------ interaction
  const finishDraft = () => {
    const tol = pxTol(3);
    const raw = draftRef.current;
    const keep: number[] = [];
    raw.forEach((q, i) => { if (i === 0 || Math.hypot(q[0] - raw[i - 1][0], q[1] - raw[i - 1][1]) > tol) keep.push(i); });
    let pts = keep.map((i) => raw[i]);
    if (p.tool === 'drive') {
      if (pts.length >= 2) {
        const last = pts.length - 1;
        const lastFree = freeIdx.current.has(keep[keep.length - 1]);
        if (p.snapEnabled && !lastFree) pts[last] = snapPoint(pts[last], false).point;
        p.onPolyline(pts);
      }
    } else if ((p.tool === 'region' || p.tool === 'exclude' || p.tool === 'stope') && pts.length >= 3) {
      p.onPolygon(p.tool, pts);
    }
    pts = [];
    setDraft([]);
    freeIdx.current.clear();
  };

  const localXY = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const [sx, sy] = localXY(e);
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
    const placed = constrained(q, e.shiftKey);
    if (p.tool === 'calibrate') {
      p.onCalibrate([Math.round(placed[0] * 10) / 10, Math.round(placed[1] * 10) / 10]);
      return;
    }
    if (draftRef.current.length >= 3 && p.tool !== 'drive') {
      const first = draftRef.current[0];
      if (Math.hypot(first[0] - q[0], first[1] - q[1]) < pxTol(10)) { finishDraft(); return; }
    }
    // the first point of a drive snaps immediately (so you can see what it joins)
    const isFirst = draftRef.current.length === 0;
    const pt = p.tool === 'drive' && isFirst ? snapPoint(placed, e.ctrlKey).point : placed;
    if (e.ctrlKey) freeIdx.current.add(draftRef.current.length);
    setDraft((d) => [...d, pt]);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const [sx, sy] = localXY(e);
    const q = toImg(sx, sy);
    p.onHover?.(q);
    const d = drag.current;
    if (d) {
      if (Math.hypot(sx - d.sx, sy - d.sy) > 3) d.moved = true;
      if (d.mode === 'pan') {
        view.current.ox = d.ox + (sx - d.sx);
        view.current.oy = d.oy + (sy - d.sy);
        redraw();
      } else if (d.mode === 'node' && d.moved) {
        setDragNode({ id: d.nodeId!, p: q });
        setHover({ img: q, sx, sy, shift: e.shiftKey, ctrl: e.ctrlKey });
      }
      return;
    }
    setHover({ img: q, sx, sy, shift: e.shiftKey, ctrl: e.ctrlKey });
    if (p.tool === 'select') {
      const s = pick(q);
      if (JSON.stringify(s) !== JSON.stringify(hoverSel)) setHoverSel(s);
    } else if (hoverSel) setHoverSel(null);
  };

  const onMouseUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'node' && d.moved && dragNode) p.onMoveNode(dragNode.id, [Math.round(dragNode.p[0] * 10) / 10, Math.round(dragNode.p[1] * 10) / 10]);
    setDragNode(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const [sx, sy] = localXY(e);
    const k = Math.exp(-e.deltaY * 0.0015);
    const v = view.current;
    const ns = Math.min(60, Math.max(0.03, v.scale * k));
    v.ox = sx - ((sx - v.ox) * ns) / v.scale;
    v.oy = sy - ((sy - v.oy) * ns) / v.scale;
    v.scale = ns;
    p.onZoom?.(ns);
    redraw();
  };

  // keyboard: finish/cancel drafts, delete, nudge, modifier tracking
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Shift' || e.key === 'Control') { setHover((h) => (h ? { ...h, shift: e.shiftKey, ctrl: e.ctrlKey } : h)); return; }
      if (e.key === 'Escape') { setDraft([]); freeIdx.current.clear(); }
      else if (e.key === 'Enter') finishDraft();
      else if (e.key === 'Backspace' && draftRef.current.length) { e.preventDefault(); setDraft((d) => d.slice(0, -1)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && p.selection) { e.preventDefault(); p.onDelete(); }
      else if (e.key.startsWith('Arrow') && p.selection?.kind === 'node') {
        e.preventDefault();
        const sel = p.selection;
        const n = p.network.nodes.find((x) => x.id === sel.id);
        if (!n) return;
        const st = e.shiftKey ? 5 : 0.5;
        const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0;
        const dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
        p.onMoveNode(n.id, [n.x + dx, n.y + dy]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control') setHover((h) => (h ? { ...h, shift: e.shiftKey, ctrl: e.ctrlKey } : h));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  });

  // live measurement tag
  let measure: string | null = null;
  const target = cursorTarget();
  if (hover && target && draft.length && (p.tool === 'drive' || p.tool === 'region' || p.tool === 'exclude' || p.tool === 'stope')) {
    const last = draft[draft.length - 1];
    const dx = target.point[0] - last[0], dy = target.point[1] - last[1];
    const seg = Math.hypot(dx, dy) * p.mpp;
    // bearing from grid north: image vector -> world vector via rotation
    const wx = dx * Math.cos(p.rotation) + dy * Math.sin(p.rotation);
    const wy = dx * Math.sin(p.rotation) - dy * Math.cos(p.rotation);
    const brg = ((Math.atan2(wx, wy) * 180) / Math.PI + 360) % 360;
    let total = 0;
    for (let i = 1; i < draft.length; i++) total += Math.hypot(draft[i][0] - draft[i - 1][0], draft[i][1] - draft[i - 1][1]);
    total = (total + Math.hypot(dx, dy)) * p.mpp;
    measure = `${seg.toFixed(1)} m · ${brg.toFixed(0).padStart(3, '0')}°${draft.length > 1 ? ` · total ${total.toFixed(1)} m` : ''}${hover.shift ? ' · 15° lock' : ''}${target.snapped ? ' · snap' : ''}`;
  }

  const drawing = DRAW_TOOLS.includes(p.tool);
  const cursor = p.tool === 'pan' ? (drag.current ? 'grabbing' : 'grab') : drawing ? 'none' : hoverSel ? 'pointer' : 'default';
  const showLoupe = !!hover && p.loupeEnabled && (drawing || !!dragNode);
  const loupePos = hover ? (() => {
    const W = wrapRef.current?.clientWidth ?? 0;
    let x = hover.sx + 28, y = hover.sy - LOUPE - 28;
    if (x + LOUPE > W - 8) x = hover.sx - LOUPE - 28;
    if (y < 8) y = hover.sy + 28;
    return { left: x, top: y };
  })() : { left: 0, top: 0 };

  void tick;
  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { setHover(null); setHoverSel(null); p.onHover?.(null); onMouseUp(); }}
        onDoubleClick={(e) => { e.preventDefault(); finishDraft(); }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas ref={loupeRef} className="loupe" style={{ ...loupePos, display: showLoupe ? 'block' : 'none', width: LOUPE, height: LOUPE }} />
      {measure && hover && <div className="measure-tag" style={{ left: hover.sx, top: hover.sy }}>{measure}</div>}
    </div>
  );
}
