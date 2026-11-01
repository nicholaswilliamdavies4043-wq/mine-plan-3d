import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  addPolyline, defaultDetectionParams, deleteEdges, deleteNode, fitSimilarity, mergeDegree2, moveNode, networkLength,
  polygonArea, polylineLength, pxToWorld, residuals, rotationOf, scaleOf, straightRun, uid, DRIVE_KINDS,
  type DriveKind, type DetectionParams, type DetectionResult, type GeoRef, type Plan, type PlanNetwork, type Polygon, type Vec2,
} from '@mineplan/shared';
import { api } from '../api';
import { PlanCanvas, type Selection, type Tool } from '../components/PlanCanvas';
import { Icon, type IconName } from '../ui/Icon';
import { HelpBrowser, InfoTip, L } from '../ui/help';
import { usePageChrome } from '../ui/shell';
import { useToast } from '../ui/toast';

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'select', icon: 'cursor', label: 'Select & move', key: 'V' },
  { tool: 'pan', icon: 'hand', label: 'Pan', key: 'H' },
  { tool: 'calibrate', icon: 'target', label: 'Pick grid point', key: 'C' },
  { tool: 'region', icon: 'region', label: 'Draw region', key: 'R' },
  { tool: 'exclude', icon: 'exclude', label: 'Draw exclusion', key: 'X' },
  { tool: 'drive', icon: 'pen', label: 'Draw drive', key: 'D' },
  { tool: 'stope', icon: 'stope', label: 'Draw stope', key: 'S' },
];

const TOOL_HINTS: Record<Tool, string> = {
  select: 'Click to select · drag junctions to move · arrows nudge · Delete removes · right-drag pans · wheel zooms',
  pan: 'Drag to pan · wheel to zoom',
  region: 'Click to outline the portion to model · double-click / Enter / first point closes · Esc cancels',
  exclude: 'Outline the legend, title block or notes to ignore · double-click or Enter closes',
  drive: 'Click along the drive centreline · Shift locks 15° steps · Ctrl places without snapping · double-click / Enter finishes',
  stope: 'Outline a stope · double-click or Enter closes',
  calibrate: 'Click a grid intersection with known coordinates, then type its easting and northing on the right',
};

type Tab = 'props' | 'info';

interface TipState { label: string; k?: string; top: number; left: number }

/** Tool rail button. Its tooltip is rendered fixed-position so the scrollable rail never clips it. */
function RailButton({ icon, label, k, on, disabled, onClick, setTip }: {
  icon: IconName; label: string; k?: string; on?: boolean; disabled?: boolean; onClick: () => void; setTip: (t: TipState | null) => void;
}) {
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ label, k, top: r.top + r.height / 2, left: r.right + 10 });
  };
  return (
    <button className={`tool-btn${on ? ' on' : ''}`} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={on}
      onMouseEnter={(e) => show(e.currentTarget)} onFocus={(e) => show(e.currentTarget)} onBlur={() => setTip(null)}>
      <Icon name={icon} size={19} />
      {k && k.length === 1 && <span className="k">{k}</span>}
    </button>
  );
}

/** Collapsible, Blender-style property section with a workflow step indicator. */
function Section({ n, title, done, children, open }: { n: number; title: string; done?: boolean; open?: boolean; children: React.ReactNode }) {
  // open state is only suggested on first render; afterwards the user controls it
  const initial = useRef(open);
  return (
    <details className="panel" open={initial.current}>
      <summary>
        <Icon name="chevron" size={14} className="chev" />
        <span className={`step-dot${done ? ' done' : ''}`}>{done ? <Icon name="check" size={12} /> : n}</span>
        {title}
      </summary>
      <div className="inner">{children}</div>
    </details>
  );
}

export function PlanEditorPage() {
  const { projectId, planId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [projectName, setProjectName] = useState('…');
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [tab, setTab] = useState<Tab>('props');
  const [selection, setSelection] = useState<Selection>(null);
  const [mask, setMask] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(true);
  const [showNetwork, setShowNetwork] = useState(true);
  const [snap, setSnap] = useState(true);
  const [loupe, setLoupe] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [zoomCmd, setZoomCmd] = useState<{ seq: number; kind: 'in' | 'out' | 'actual' }>({ seq: 0, kind: 'in' });
  const zoomBy = (kind: 'in' | 'out' | 'actual') => setZoomCmd((z) => ({ seq: z.seq + 1, kind }));
  const [panelOpen, setPanelOpenState] = useState(() => { try { return localStorage.getItem('mineplan-panel') !== 'closed'; } catch { return true; } });
  const setPanelOpen = (v: boolean) => {
    setPanelOpenState(v);
    try { localStorage.setItem('mineplan-panel', v ? 'open' : 'closed'); } catch { /* ignore */ }
  };
  const [fullscreen, setFullscreen] = useState(false);
  const [tip, setTip] = useState<TipState | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else editorRef.current?.requestFullscreen?.().catch(() => toast('Full screen is not available here', 'error'));
  };
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [zoom, setZoom] = useState(1);
  const [detecting, setDetecting] = useState(false);
  const [lastResult, setLastResult] = useState<Omit<DetectionResult, 'network' | 'maskPng'> | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const history = useRef<PlanNetwork[]>([]);
  const future = useRef<PlanNetwork[]>([]);
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<Partial<Plan>>({});
  usePageChrome([{ label: 'Projects', to: '/' }, { label: projectName, to: `/projects/${projectId}` }, { label: plan?.name ?? '…' }]);

  useEffect(() => {
    api.plan(planId!).then((p) => {
      setPlan(p);
      setLastResult(p.lastDetection ?? null);
      if (p.georef.points.length < 2) setTool('calibrate');
    }).catch((e) => setError(e.message));
    api.project(projectId!).then((p) => setProjectName(p.name)).catch(() => {});
  }, [planId, projectId]);

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setSaveState('saving');
    try {
      await api.updatePlan(planId!, patch);
      setSaveState(Object.keys(pending.current).length ? 'dirty' : 'saved');
    } catch (e: any) {
      setSaveState('error');
      setError(e.message);
    }
  }, [planId]);

  const update = useCallback((patch: Partial<Plan>, opts: { recordHistory?: boolean } = {}) => {
    setPlan((cur) => {
      if (!cur) return cur;
      if (opts.recordHistory && patch.network) {
        history.current.push(cur.network);
        if (history.current.length > 150) history.current.shift();
        future.current = [];
      }
      return { ...cur, ...patch };
    });
    pending.current = { ...pending.current, ...patch };
    setSaveState('dirty');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 600);
  }, [flush]);

  useEffect(() => () => { if (saveTimer.current) { window.clearTimeout(saveTimer.current); flush(); } }, [flush]);

  const setNetwork = (n: PlanNetwork) => update({ network: n }, { recordHistory: true });
  const undo = () => {
    const prev = history.current.pop();
    if (!prev || !plan) return;
    future.current.push(plan.network);
    update({ network: prev });
    toast('Undone', 'info');
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || !plan) return;
    history.current.push(plan.network);
    update({ network: next });
  };

  // keyboard shortcuts for tools and toggles
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (e.key === 'F' && e.shiftKey) { toggleFullscreen(); return; }
      if (t) { setTool(t.tool); return; }
      const k = e.key.toLowerCase();
      if (k === 'f') setFitSignal((n) => n + 1);
      else if (k === 'm') setLoupe((v) => !v);
      else if (k === 'n') setSnap((v) => !v);
      else if (k === 'e') setShowNetwork((v) => !v);
      else if (k === 'p') setPanelOpen(!panelOpen);
      else if (k === '+' || k === '=') zoomBy('in');
      else if (k === '-' || k === '_') zoomBy('out');
      else if (k === '0') zoomBy('actual');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!plan) return <div className="page">{error ? <div className="error-box">{error}</div> : <div className="skeleton" style={{ height: 500 }} />}</div>;

  const sim = fitSimilarity(plan.georef);
  const mpp = scaleOf(sim);
  const calibrated = plan.georef.points.length >= 2;
  const params: DetectionParams = { ...defaultDetectionParams(), ...plan.params };
  const setParam = <K extends keyof DetectionParams>(k: K, v: DetectionParams[K]) => update({ params: { ...params, [k]: v } });
  const setGeoref = (g: GeoRef) => update({ georef: g });
  const res = residuals(plan.georef);
  const steps = [calibrated, plan.regions.length > 0, !!lastResult || plan.network.edges.length > 0, plan.network.edges.length > 0];

  const runDetect = async (mode: 'replace' | 'merge', regions?: Polygon[]) => {
    await flush();
    setDetecting(true);
    setError(null);
    try {
      const r = await api.detect(plan.id, { params, regions: regions ?? plan.regions, excludes: plan.excludes, mode });
      history.current.push(plan.network);
      setPlan((cur) => (cur ? { ...cur, network: r.network } : cur));
      setMask(r.maskPng ?? null);
      const { network: _n, maskPng: _m, ...summary } = r;
      setLastResult(summary);
      setShowMask(true);
      setTool('select');
      toast(`Detected ${r.stats.edges} drive segments and ${r.stats.stopes} stopes in ${(r.stats.ms / 1000).toFixed(1)} s`);
    } catch (e: any) {
      setError(e.message);
      toast('Detection failed', 'error');
    } finally {
      setDetecting(false);
    }
  };

  const onDelete = () => {
    if (!selection) return;
    if (selection.kind === 'edge') setNetwork(deleteEdges(plan.network, [selection.id]));
    else if (selection.kind === 'node') setNetwork(deleteNode(plan.network, selection.id));
    else if (selection.kind === 'stope') setNetwork({ ...plan.network, stopes: plan.network.stopes.filter((s) => s.id !== selection.id) });
    else if (selection.kind === 'region') update({ regions: plan.regions.filter((_, i) => i !== selection.index) });
    else if (selection.kind === 'exclude') update({ excludes: plan.excludes.filter((_, i) => i !== selection.index) });
    setSelection(null);
  };

  const selEdge = selection?.kind === 'edge' ? plan.network.edges.find((e) => e.id === selection.id) : undefined;
  const selStope = selection?.kind === 'stope' ? plan.network.stopes.find((s) => s.id === selection.id) : undefined;
  const selNode = selection?.kind === 'node' ? plan.network.nodes.find((n) => n.id === selection.id) : undefined;
  /** Rename edges; typing goes through without an undo step per keystroke, bulk renames are undoable. */
  const renameEdges = (ids: string[], name: string, kind: DriveKind | undefined, recordHistory = false) => {
    const set = new Set(ids);
    const edges = plan.network.edges.map((e) => {
      if (!set.has(e.id)) return e;
      const n = { ...e, name: name || undefined, kind };
      if (!n.name) delete n.name;
      if (!n.kind) delete n.kind;
      return n;
    });
    update({ network: { ...plan.network, edges } }, { recordHistory });
  };
  const namedDrives = (() => {
    const m = new Map<string, { count: number; first: string; kind?: DriveKind; len: number }>();
    for (const e of plan.network.edges) {
      if (!e.name) continue;
      const cur = m.get(e.name) ?? { count: 0, first: e.id, kind: e.kind, len: 0 };
      cur.count++;
      cur.len += polylineLength(e.points) * mpp;
      m.set(e.name, cur);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  })();
  const setStope = (id: string, patch: Record<string, unknown>) =>
    update({ network: { ...plan.network, stopes: plan.network.stopes.map((s) => (s.id === id ? { ...s, ...patch } : s)) } });
  const cursorWorld = cursor ? pxToWorld(sim, cursor) : null;

  return (
    <div className={`editor${panelOpen ? '' : ' collapsed'}`} ref={editorRef}>
      {/* ---------------- tool rail ---------------- */}
      <div className="toolbar-v" role="toolbar" aria-label="Tools" onMouseLeave={() => setTip(null)}>
        {TOOLS.map((t, i) => (
          <span key={t.tool} style={{ display: 'contents' }}>
            {(i === 2 || i === 5) && <div className="divider" style={{ width: 28 }} />}
            <RailButton icon={t.icon} label={t.label} k={t.key} on={tool === t.tool} onClick={() => setTool(t.tool)} setTip={setTip} />
          </span>
        ))}
        <div className="divider" style={{ width: 28 }} />
        <RailButton icon="zoomIn" label="Zoom in" k="+" onClick={() => zoomBy('in')} setTip={setTip} />
        <RailButton icon="zoomOut" label="Zoom out" k="−" onClick={() => zoomBy('out')} setTip={setTip} />
        <RailButton icon="fit" label="Fit plan to view" k="F" onClick={() => setFitSignal((n) => n + 1)} setTip={setTip} />
        <div className="divider" style={{ width: 28 }} />
        <RailButton icon="magnet" label={`Snapping ${snap ? 'on' : 'off'}`} k="N" on={snap} onClick={() => setSnap(!snap)} setTip={setTip} />
        <RailButton icon="loupe" label={`Magnifier ${loupe ? 'on' : 'off'}`} k="M" on={loupe} onClick={() => setLoupe(!loupe)} setTip={setTip} />
        <RailButton icon="eye" label={`Drives & stopes ${showNetwork ? 'shown' : 'hidden'}`} k="E" on={showNetwork} onClick={() => setShowNetwork(!showNetwork)} setTip={setTip} />
        <RailButton icon="layers" label={mask ? `Detection mask ${showMask ? 'shown' : 'hidden'}` : 'Detection mask (run detection first)'} on={!!mask && showMask} disabled={!mask} onClick={() => setShowMask(!showMask)} setTip={setTip} />
        <div className="divider" style={{ width: 28 }} />
        <RailButton icon="undo" label="Undo" k="Ctrl Z" disabled={!history.current.length} onClick={undo} setTip={setTip} />
        <RailButton icon="redo" label="Redo" k="Ctrl Y" disabled={!future.current.length} onClick={redo} setTip={setTip} />
        <div className="divider" style={{ width: 28 }} />
        <RailButton icon="panel" label={panelOpen ? 'Hide properties (bigger plan)' : 'Show properties'} k="P" on={panelOpen} onClick={() => setPanelOpen(!panelOpen)} setTip={setTip} />
        <RailButton icon={fullscreen ? 'shrink' : 'expand'} label={fullscreen ? 'Exit full screen' : 'Full screen'} k="Shift F" onClick={toggleFullscreen} setTip={setTip} />
      </div>
      {tip && (
        <div className="tool-tip-fixed" style={{ top: tip.top, left: tip.left }}>
          {tip.label}{tip.k && <kbd>{tip.k}</kbd>}
        </div>
      )}

      {/* ---------------- viewport ---------------- */}
      <div className="viewport">
        <PlanCanvas
          imageUrl={api.planImageUrl(plan.id)}
          imageWidth={plan.imageWidth}
          imageHeight={plan.imageHeight}
          network={plan.network}
          regions={plan.regions}
          excludes={plan.excludes}
          calibration={plan.georef.points}
          maskUrl={mask}
          showMask={showMask}
          showNetwork={showNetwork}
          tool={tool}
          selection={selection}
          snapEnabled={snap}
          loupeEnabled={loupe}
          mpp={mpp}
          rotation={rotationOf(sim)}
          fitSignal={fitSignal}
          zoomCmd={zoomCmd}
          onSelect={setSelection}
          onHover={setCursor}
          onZoom={setZoom}
          onPolygon={(t, poly) => {
            if (t === 'region') { update({ regions: [...plan.regions, poly] }); toast('Region added'); }
            else if (t === 'exclude') { update({ excludes: [...plan.excludes, poly] }); toast('Exclusion added'); }
            else setNetwork({ ...plan.network, stopes: [...plan.network.stopes, { id: uid('s'), polygon: poly, heightM: params.stopeHeightM, baseOffsetM: 0, label: `Stope ${plan.network.stopes.length + 1}` }] });
          }}
          onPolyline={(pts) => {
            const snapPx = Math.max(4, (lastResult?.driveWidthPx ?? 8) * 0.8);
            setNetwork(addPolyline(plan.network, pts, snapPx, lastResult?.driveWidthPx));
          }}
          onMoveNode={(id, q) => setNetwork(moveNode(plan.network, id, q[0], q[1]))}
          onCalibrate={(q) => {
            const last = plan.georef.points[plan.georef.points.length - 1];
            setGeoref({ ...plan.georef, points: [...plan.georef.points, { px: q, world: last ? [...last.world] as Vec2 : [0, 0] }] });
            setTab('props');
            toast(`Point ${plan.georef.points.length + 1} placed. Enter its coordinates.`, 'info');
          }}
          onDelete={onDelete}
        />
        <div className="overlay-tl">
          <span className="chip"><Icon name={TOOLS.find((t) => t.tool === tool)!.icon} size={14} /> {TOOLS.find((t) => t.tool === tool)!.label}</span>
        </div>
        {!panelOpen && (
          <div className="overlay-tr">
            <button className="chip btn" onClick={() => setPanelOpen(true)} title="Show properties (P)"><Icon name="panel" size={14} /> Properties</button>
          </div>
        )}
        <div className="zoom-ctl" role="group" aria-label="Zoom">
          <button onClick={() => zoomBy('out')} aria-label="Zoom out" title="Zoom out (−)"><Icon name="minus" size={16} /></button>
          <span className="pct" role="button" tabIndex={0} title="Actual size (0)" onClick={() => zoomBy('actual')}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => zoomBy('in')} aria-label="Zoom in" title="Zoom in (+)"><Icon name="plus" size={16} /></button>
          <button onClick={() => setFitSignal((n) => n + 1)} aria-label="Fit to view" title="Fit (F)"><Icon name="fit" size={16} /></button>
        </div>
        {detecting && (
          <div className="hint" style={{ bottom: 'auto', top: 60 }}><span className="spinner" /> Detecting drives…</div>
        )}
      </div>

      {/* ---------------- properties ---------------- */}
      <aside className="props">
        <div className="tabs">
          <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')}><Icon name="settings" size={15} /> Properties</button>
          <button className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}><Icon name="info" size={15} /> Info</button>
          <button className="ghost" style={{ flex: 'none', padding: '9px 10px' }} onClick={() => setPanelOpen(false)} aria-label="Hide properties" title="Hide properties for a bigger plan (P)"><Icon name="x" size={15} /></button>
        </div>
        <div className="scroll">
          {tab === 'info' ? (
            <HelpBrowser compact groups={['Workflow', 'Scale & level', 'Select portion', 'Detection', 'Editing tools']} />
          ) : (
            <>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row small"><strong style={{ fontSize: 15 }}>{plan.name}</strong><span className="spacer" />
                  <span className="muted">{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Editing…'}</span>
                </div>
                <div className="progress-steps">{steps.map((d, i) => <div key={i} className={`s${d ? ' done' : ''}`} />)}</div>
              </div>
              {error && <div className="error-box">{error}</div>}

              {/* selection */}
              {(selEdge || selNode || selStope) && (
                <div className="panel anim-in" style={{ borderColor: 'var(--select)' }}>
                  <div className="inner" style={{ paddingTop: 12 }}>
                    {selEdge && (<>
                      <strong>Drive segment</strong>
                      <label className="field"><L k="driveName">Name</L>
                        <input value={selEdge.name ?? ''} placeholder="e.g. XC 3, 445 S6S7 ore drive" onChange={(e) => renameEdges([selEdge.id], e.target.value, selEdge.kind)} />
                      </label>
                      <label className="field"><L k="driveKind">Type</L>
                        <select value={selEdge.kind ?? ''} onChange={(e) => renameEdges([selEdge.id], selEdge.name ?? '', (e.target.value || undefined) as DriveKind | undefined)}>
                          <option value="">Not set</option>
                          {DRIVE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                        </select>
                      </label>
                      <button disabled={!selEdge.name} onClick={() => {
                        const ids = straightRun(plan.network, selEdge.id);
                        renameEdges(ids, selEdge.name ?? '', selEdge.kind, true);
                        toast(`Named ${ids.length} segment${ids.length === 1 ? '' : 's'} "${selEdge.name}"`);
                      }}><Icon name="ruler" size={15} /> Apply name to the whole straight run</button>
                      <dl className="kv">
                        <dt>Length</dt><dd>{(polylineLength(selEdge.points) * mpp).toFixed(1)} m</dd>
                        {selEdge.widthPx ? (<><dt>Width (plan)</dt><dd>{(selEdge.widthPx * mpp).toFixed(1)} m</dd></>) : null}
                        <dt>Vertices</dt><dd>{selEdge.points.length}</dd>
                      </dl>
                      <button className="danger" onClick={onDelete}><Icon name="trash" size={15} /> Delete segment</button>
                    </>)}
                    {selNode && (<>
                      <strong>Junction / end</strong>
                      <dl className="kv">
                        <dt>Position</dt><dd>{(() => { const w = pxToWorld(sim, [selNode.x, selNode.y]); return `${w[0].toFixed(1)} E · ${w[1].toFixed(1)} N`; })()}</dd>
                        <dt>Pixel</dt><dd>{selNode.x.toFixed(1)}, {selNode.y.toFixed(1)}</dd>
                      </dl>
                      <span className="tiny muted">Arrow keys nudge 0.5 px, Shift + arrow 5 px.</span>
                      <button className="danger" onClick={onDelete}><Icon name="trash" size={15} /> Delete with connected drives</button>
                    </>)}
                    {selStope && (<>
                      <strong>Stope</strong>
                      <label className="field">Label<input value={selStope.label ?? ''} onChange={(e) => setStope(selStope.id, { label: e.target.value })} /></label>
                      <div className="prop-row"><L k="stopeHeightM">Height (m)</L><input type="number" value={selStope.heightM} onChange={(e) => setStope(selStope.id, { heightM: Number(e.target.value) })} /></div>
                      <div className="prop-row"><L k="stopeBase">Base offset (m)</L><input type="number" value={selStope.baseOffsetM} onChange={(e) => setStope(selStope.id, { baseOffsetM: Number(e.target.value) })} /></div>
                      <span className="small muted">Area {(Math.abs(polygonArea(selStope.polygon)) * mpp * mpp).toFixed(0)} m²</span>
                      <button className="danger" onClick={onDelete}><Icon name="trash" size={15} /> Delete stope</button>
                    </>)}
                  </div>
                </div>
              )}

              <Section n={1} title="Scale & level" done={steps[0]} open={!steps[0]}>
                <span className="small muted">Pick two or more grid intersections far apart. <L k="georefPoints">{''}</L></span>
                {plan.georef.points.map((pt, i) => (
                  <div key={i} className="row anim-in" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <span className="badge">{i + 1}</span>
                    <input type="number" aria-label="Easting" placeholder="E" style={{ width: '100%' }} value={Number.isFinite(pt.world[0]) ? pt.world[0] : ''}
                      onChange={(e) => setGeoref({ ...plan.georef, points: plan.georef.points.map((q, j) => (j === i ? { ...q, world: [Number(e.target.value), q.world[1]] as Vec2 } : q)) })} />
                    <input type="number" aria-label="Northing" placeholder="N" style={{ width: '100%' }} value={Number.isFinite(pt.world[1]) ? pt.world[1] : ''}
                      onChange={(e) => setGeoref({ ...plan.georef, points: plan.georef.points.map((q, j) => (j === i ? { ...q, world: [q.world[0], Number(e.target.value)] as Vec2 } : q)) })} />
                    <button className="ghost sm" aria-label="Remove point" onClick={() => setGeoref({ ...plan.georef, points: plan.georef.points.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
                    {plan.georef.points.length > 2 && res[i] !== undefined && <span className="tiny muted">±{res[i].toFixed(1)}</span>}
                  </div>
                ))}
                <button className={tool === 'calibrate' ? 'active' : ''} onClick={() => setTool('calibrate')}><Icon name="target" size={15} /> Pick grid point</button>
                {!calibrated && (
                  <div className="prop-row"><L k="metersPerPixel">Metres per pixel</L>
                    <input type="number" step="0.01" value={plan.georef.metersPerPixel} onChange={(e) => setGeoref({ ...plan.georef, metersPerPixel: Math.max(0.0001, Number(e.target.value)) })} /></div>
                )}
                <div className="prop-row"><L k="levelRL">Level floor RL (m)</L><input type="number" value={plan.levelRL} onChange={(e) => update({ levelRL: Number(e.target.value) })} /></div>
                <dl className="kv">
                  <dt>Scale</dt><dd>{mpp.toFixed(4)} m/px {calibrated ? '' : '(manual)'}</dd>
                  <dt>Sheet covers</dt><dd>{(plan.imageWidth * mpp).toFixed(0)} × {(plan.imageHeight * mpp).toFixed(0)} m</dd>
                  <dt><L k="rotation">Rotation</L></dt><dd>{((rotationOf(sim) * 180) / Math.PI).toFixed(1)}°</dd>
                </dl>
              </Section>

              <Section n={2} title="Select portion" done={steps[1]} open={steps[0] && !steps[1]}>
                <div className="row">
                  <button className={tool === 'region' ? 'active' : ''} onClick={() => setTool('region')}><Icon name="region" size={15} /> Region</button>
                  <button className={tool === 'exclude' ? 'active' : ''} onClick={() => setTool('exclude')}><Icon name="exclude" size={15} /> Exclusion</button>
                  <L k="regions">{''}</L>
                </div>
                {plan.regions.map((r, i) => (
                  <div key={'r' + i} className="row anim-in small" style={{ flexWrap: 'nowrap' }}>
                    <span className="badge accent">Region {i + 1}</span>
                    <span className="muted">{(Math.abs(polygonArea(r)) * mpp * mpp / 1e4).toFixed(2)} ha</span>
                    <span className="spacer" />
                    <button className="sm" onClick={() => runDetect('merge', [r])} disabled={detecting}><Icon name="wand" size={14} /> Detect &amp; add</button>
                    <button className="ghost sm" aria-label="Remove region" onClick={() => update({ regions: plan.regions.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
                  </div>
                ))}
                {plan.excludes.map((_, i) => (
                  <div key={'x' + i} className="row anim-in small">
                    <span className="badge" style={{ color: 'var(--error)' }}>Exclusion {i + 1}</span><span className="spacer" />
                    <button className="ghost sm" aria-label="Remove exclusion" onClick={() => update({ excludes: plan.excludes.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
                  </div>
                ))}
                {!plan.regions.length && <span className="small muted">No region yet: the whole sheet will be processed.</span>}
              </Section>

              <Section n={3} title="Detect" done={steps[2]} open={steps[1] && !steps[2]}>
                <div className="prop-row"><L k="driveWidthPx">Drive width (px, 0 = auto)</L><input type="number" value={params.driveWidthPx} onChange={(e) => setParam('driveWidthPx', Math.max(0, Number(e.target.value)))} /></div>
                <div className="prop-row"><L k="wallContrast">Wall contrast</L><input type="number" value={params.wallContrast} onChange={(e) => setParam('wallContrast', Number(e.target.value))} /></div>
                <div className="prop-row"><L k="wideAreaFactor">Max width factor</L><input type="number" step="0.05" value={params.wideAreaFactor} onChange={(e) => setParam('wideAreaFactor', Number(e.target.value))} /></div>
                <div className="prop-row"><L k="wallDilatePx">Gap sealing (px)</L><input type="number" value={params.wallDilatePx} onChange={(e) => setParam('wallDilatePx', Math.max(0, Number(e.target.value)))} /></div>
                <div className="prop-row"><L k="bridgeGapFactor">Bridge gaps (× width)</L><input type="number" step="0.5" value={params.bridgeGapFactor} onChange={(e) => setParam('bridgeGapFactor', Math.max(0, Number(e.target.value)))} /></div>
                <details>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>Advanced</summary>
                  <div className="stack" style={{ marginTop: 8 }}>
                    <div className="prop-row"><L k="maxWallSaturation">Max wall saturation</L><input type="number" step="0.01" value={params.maxWallSaturation} onChange={(e) => setParam('maxWallSaturation', Number(e.target.value))} /></div>
                    <div className="prop-row"><L k="holeFillFactor">Label hole filling</L><input type="number" step="0.5" value={params.holeFillFactor} onChange={(e) => setParam('holeFillFactor', Number(e.target.value))} /></div>
                    <div className="prop-row"><L k="minBlobFactor">Minimum blob size</L><input type="number" value={params.minBlobFactor} onChange={(e) => setParam('minBlobFactor', Number(e.target.value))} /></div>
                    <div className="prop-row"><L k="spurFactor">Spur removal</L><input type="number" step="0.1" value={params.spurFactor} onChange={(e) => setParam('spurFactor', Number(e.target.value))} /></div>
                    <div className="prop-row"><L k="simplifyFactor">Simplification</L><input type="number" step="0.05" value={params.simplifyFactor} onChange={(e) => setParam('simplifyFactor', Number(e.target.value))} /></div>
                  </div>
                </details>
                <label className="toggle"><input type="checkbox" checked={params.detectStopes} onChange={(e) => setParam('detectStopes', e.target.checked)} /><span className="track" /><L k="detectStopes">Detect coloured stopes</L></label>
                {params.detectStopes && (<>
                  <div className="prop-row"><L k="stopeMinSaturation">Stope colour threshold</L><input type="number" step="0.01" value={params.stopeMinSaturation} onChange={(e) => setParam('stopeMinSaturation', Number(e.target.value))} /></div>
                  <div className="prop-row"><L k="stopeHeightM">Stope height (m)</L><input type="number" value={params.stopeHeightM} onChange={(e) => setParam('stopeHeightM', Number(e.target.value))} /></div>
                </>)}
                <div className="row">
                  <button className="primary" disabled={detecting} onClick={() => runDetect('replace')} style={{ flex: 1, justifyContent: 'center' }}>
                    {detecting ? <span className="spinner" /> : <Icon name="wand" size={16} />} {detecting ? 'Detecting…' : 'Detect drives'}
                  </button>
                  <button className="ghost" onClick={() => { update({ params: defaultDetectionParams() }); toast('Parameters reset', 'info'); }}>Reset</button>
                </div>
                {lastResult && (
                  <div className="card anim-in" style={{ padding: 12 }}>
                    <dl className="kv">
                      <dt>Drive width</dt><dd>{lastResult.driveWidthPx} px ≈ {(lastResult.driveWidthPx * mpp).toFixed(1)} m</dd>
                      <dt>Segments</dt><dd>{lastResult.stats.edges}</dd>
                      <dt>Junctions + ends</dt><dd>{lastResult.stats.nodes}</dd>
                      <dt>Stopes</dt><dd>{lastResult.stats.stopes}</dd>
                      <dt>Time</dt><dd>{(lastResult.stats.ms / 1000).toFixed(2)} s</dd>
                    </dl>
                    {lastResult.warnings.map((w) => <div key={w} className="warn-box small">{w}</div>)}
                  </div>
                )}
              </Section>

              <Section n={4} title="Edit & build" done={steps[3]} open={steps[2]}>
                <div className="row">
                  <button className={tool === 'drive' ? 'active' : ''} onClick={() => setTool('drive')}><Icon name="pen" size={15} /> Drive</button>
                  <button className={tool === 'stope' ? 'active' : ''} onClick={() => setTool('stope')}><Icon name="stope" size={15} /> Stope</button>
                  <button onClick={() => { setNetwork(mergeDegree2(plan.network)); toast('Network tidied'); }}><Icon name="sparkle" size={15} /> Tidy</button>
                  <L k="toolDrive">{''}</L>
                </div>
                <dl className="kv">
                  <dt>Drives</dt><dd>{plan.network.edges.length} segments · {(networkLength(plan.network) * mpp).toFixed(0)} m</dd>
                  <dt>Stopes</dt><dd>{plan.network.stopes.length}</dd>
                </dl>
                <div className="stack" style={{ gap: 6 }}>
                  <strong className="small row">Named drives &amp; crosscuts <InfoTip k="driveName" /></strong>
                  {!namedDrives.length && <span className="small muted">None yet. Select a drive and give it a name; the names appear as signs in the walk-through.</span>}
                  {namedDrives.map(([name, info]) => (
                    <button key={name} className="ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => { setTool('select'); setSelection({ kind: 'edge', id: info.first }); }}>
                      <span className="badge accent">{DRIVE_KINDS.find((k) => k.value === info.kind)?.label ?? 'Drive'}</span>
                      <span style={{ flex: 1, textAlign: 'left' }}>{name}</span>
                      <span className="muted tiny">{info.len.toFixed(0)} m</span>
                    </button>
                  ))}
                </div>
                <div className="row">
                  <button className="primary" disabled={!plan.network.edges.length} style={{ flex: 1, justifyContent: 'center' }}
                    onClick={async () => { await flush(); nav(`/projects/${projectId}/view`); }}><Icon name="play" size={16} /> Build 3D model</button>
                  <button className="danger" onClick={() => { if (confirm('Clear all drives and stopes?')) setNetwork({ nodes: [], edges: [], stopes: [] }); }}>Clear</button>
                </div>
              </Section>
            </>
          )}
        </div>
      </aside>

      {/* ---------------- status bar ---------------- */}
      <div className="statusbar">
        <span>{TOOL_HINTS[tool]}</span>
        <span className="spacer" />
        {cursor && <span>px <b>{cursor[0].toFixed(1)}, {cursor[1].toFixed(1)}</b></span>}
        {cursorWorld && <span><b>{cursorWorld[0].toFixed(1)} E · {cursorWorld[1].toFixed(1)} N</b></span>}
        <span>zoom <b>{Math.round(zoom * 100)}%</b></span>
        <span>{snap ? 'snap on' : 'snap off'}</span>
      </div>
    </div>
  );
}
