import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  addPolyline, defaultDetectionParams, deleteEdges, deleteNode, fitSimilarity, mergeDegree2, moveNode, networkLength,
  polygonArea, polylineLength, pxToWorld, residuals, scaleOf, uid,
  type DetectionParams, type DetectionResult, type GeoRef, type Plan, type PlanNetwork, type Polygon, type Vec2,
} from '@mineplan/shared';
import { api } from '../api';
import { PlanCanvas, type Selection, type Tool } from '../components/PlanCanvas';

type Step = 'calibrate' | 'regions' | 'detect' | 'edit';

const TOOL_HINTS: Record<Tool, string> = {
  select: 'Click to select a drive, junction, stope or region. Drag junctions to move them. Delete removes the selection. Right-drag pans, wheel zooms.',
  pan: 'Drag to pan, wheel to zoom.',
  region: 'Click to outline the portion of the plan to model. Double-click, Enter or click the first point to close. Esc cancels.',
  exclude: 'Outline areas to ignore (legend, title block, notes). Double-click or Enter to close.',
  drive: 'Click along a drive centreline. Ends snap to existing drives (blue circle). Double-click or Enter to finish.',
  stope: 'Outline a stope. Double-click or Enter to close. It is extruded as a volume in 3D.',
  calibrate: 'Click a grid intersection with known coordinates (e.g. 39900E / 19400N), then type its easting and northing.',
};

export function PlanEditorPage() {
  const { projectId, planId } = useParams();
  const nav = useNavigate();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('calibrate');
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [mask, setMask] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(true);
  const [showNetwork, setShowNetwork] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [lastResult, setLastResult] = useState<Omit<DetectionResult, 'network' | 'maskPng'> | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const history = useRef<PlanNetwork[]>([]);
  const future = useRef<PlanNetwork[]>([]);
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<Partial<Plan>>({});

  useEffect(() => {
    api.plan(planId!).then((p) => {
      setPlan(p);
      setLastResult(p.lastDetection ?? null);
      if (p.georef.points.length >= 2) setStep(p.network.edges.length ? 'edit' : 'regions');
    }).catch((e) => setError(e.message));
  }, [planId]);

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
        if (history.current.length > 100) history.current.shift();
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
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || !plan) return;
    history.current.push(plan.network);
    update({ network: next });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!plan) return <div className="page">{error ? <div className="error-box">{error}</div> : 'Loading…'}</div>;

  const sim = fitSimilarity(plan.georef);
  const mpp = scaleOf(sim);
  const calibrated = plan.georef.points.length >= 2;
  const params: DetectionParams = { ...defaultDetectionParams(), ...plan.params };
  const setParam = <K extends keyof DetectionParams>(k: K, v: DetectionParams[K]) => update({ params: { ...params, [k]: v } });
  const setGeoref = (g: GeoRef) => update({ georef: g });

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
      setStep('edit');
      setTool('select');
    } catch (e: any) {
      setError(e.message);
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
  const res = residuals(plan.georef);

  const toolBtn = (t: Tool, label: string) => (
    <button className={tool === t ? 'active' : ''} onClick={() => setTool(t)}>{label}</button>
  );

  return (
    <div className="editor">
      <aside className="side">
        <div>
          <div className="row small"><Link to={`/projects/${projectId}`} className="muted">Back to project</Link><span className="spacer" />
            <span className="muted">{saveState === 'saved' ? 'All changes saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Unsaved changes'}</span>
          </div>
          <h2 style={{ margin: '8px 0' }}>{plan.name}</h2>
          <div className="steps">
            {(['calibrate', 'regions', 'detect', 'edit'] as Step[]).map((s, i) => (
              <button key={s} className={step === s ? 'active' : ''} onClick={() => {
                setStep(s);
                setTool(s === 'calibrate' ? 'calibrate' : s === 'regions' ? 'region' : 'select');
              }}>{i + 1}. {s === 'calibrate' ? 'Scale & level' : s === 'regions' ? 'Select portion' : s === 'detect' ? 'Detect' : 'Edit'}</button>
            ))}
          </div>
        </div>
        {error && <div className="error-box">{error}</div>}

        {step === 'calibrate' && (
          <div className="section stack">
            <h3>Georeference</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Click two or more grid intersections that are far apart (e.g. 39900E/19400N and 40150E/18950N) and enter their
              coordinates. Rotated sheets are handled automatically.
            </p>
            {plan.georef.points.map((pt, i) => (
              <div key={i} className="row">
                <span className="small" style={{ width: 18 }}>{i + 1}</span>
                <label className="field">Easting<input type="number" value={Number.isFinite(pt.world[0]) ? pt.world[0] : ''} onChange={(e) => {
                  const points = plan.georef.points.map((q, j) => (j === i ? { ...q, world: [Number(e.target.value), q.world[1]] as Vec2 } : q));
                  setGeoref({ ...plan.georef, points });
                }} /></label>
                <label className="field">Northing<input type="number" value={Number.isFinite(pt.world[1]) ? pt.world[1] : ''} onChange={(e) => {
                  const points = plan.georef.points.map((q, j) => (j === i ? { ...q, world: [q.world[0], Number(e.target.value)] as Vec2 } : q));
                  setGeoref({ ...plan.georef, points });
                }} /></label>
                <button onClick={() => setGeoref({ ...plan.georef, points: plan.georef.points.filter((_, j) => j !== i) })}>Remove</button>
                {res[i] !== undefined && plan.georef.points.length > 2 && <span className="small muted">±{res[i].toFixed(2)} m</span>}
              </div>
            ))}
            <div className="row">{toolBtn('calibrate', 'Pick grid point')}</div>
            {!calibrated && (
              <label className="field">Or set scale directly (m per pixel)
                <input type="number" step="0.01" value={plan.georef.metersPerPixel} onChange={(e) => setGeoref({ ...plan.georef, metersPerPixel: Math.max(0.0001, Number(e.target.value)) })} />
              </label>
            )}
            <dl className="kv">
              <dt>Scale</dt><dd>{mpp.toFixed(4)} m/px {calibrated ? '' : '(manual)'}</dd>
              <dt>Sheet size</dt><dd>{(plan.imageWidth * mpp).toFixed(0)} × {(plan.imageHeight * mpp).toFixed(0)} m</dd>
              <dt>Rotation</dt><dd>{((Math.atan2(sim.ai, sim.ar) * 180) / Math.PI).toFixed(1)}°</dd>
            </dl>
            <label className="field">Level floor RL (m)
              <input type="number" value={plan.levelRL} onChange={(e) => update({ levelRL: Number(e.target.value) })} />
            </label>
            <button className="primary" onClick={() => { setStep('regions'); setTool('region'); }}>Next: select portion</button>
          </div>
        )}

        {step === 'regions' && (
          <div className="section stack">
            <h3>Portions to model</h3>
            <p className="small muted" style={{ margin: 0 }}>
              Outline the parts of the plan you want in 3D. Without a region the whole sheet is processed. Exclude the legend,
              title block and notes.
            </p>
            <div className="row">{toolBtn('region', 'Draw region')}{toolBtn('exclude', 'Draw exclusion')}{toolBtn('select', 'Select')}</div>
            <table className="list">
              <tbody>
                {plan.regions.map((r, i) => (
                  <tr key={'r' + i}><td>Region {i + 1}</td><td>{(Math.abs(polygonArea(r)) * mpp * mpp / 1e4).toFixed(2)} ha</td>
                    <td><button onClick={() => runDetect('merge', [r])} disabled={detecting}>Detect &amp; add</button></td>
                    <td><button onClick={() => update({ regions: plan.regions.filter((_, j) => j !== i) })}>Remove</button></td></tr>
                ))}
                {plan.excludes.map((r, i) => (
                  <tr key={'x' + i}><td>Exclusion {i + 1}</td><td></td><td></td>
                    <td><button onClick={() => update({ excludes: plan.excludes.filter((_, j) => j !== i) })}>Remove</button></td></tr>
                ))}
                {!plan.regions.length && <tr><td className="muted" colSpan={4}>No region: the whole sheet will be processed.</td></tr>}
              </tbody>
            </table>
            <button className="primary" onClick={() => setStep('detect')}>Next: detect</button>
          </div>
        )}

        {step === 'detect' && (
          <div className="section stack">
            <h3>Automatic detection</h3>
            <label className="field">Drive width on the sheet (px, 0 = auto)
              <input type="number" value={params.driveWidthPx} onChange={(e) => setParam('driveWidthPx', Math.max(0, Number(e.target.value)))} /></label>
            <label className="field">Wall line contrast (higher = only darker lines)
              <input type="number" value={params.wallContrast} onChange={(e) => setParam('wallContrast', Number(e.target.value))} /></label>
            <label className="field">Max drive width factor (raise if wide drives or junctions are missed)
              <input type="number" step="0.05" value={params.wideAreaFactor} onChange={(e) => setParam('wideAreaFactor', Number(e.target.value))} /></label>
            <label className="field">Wall gap sealing (px)
              <input type="number" value={params.wallDilatePx} onChange={(e) => setParam('wallDilatePx', Math.max(0, Number(e.target.value)))} /></label>
            <label className="field">Bridge gaps up to (× drive width, 0 = off)
              <input type="number" step="0.5" value={params.bridgeGapFactor} onChange={(e) => setParam('bridgeGapFactor', Math.max(0, Number(e.target.value)))} /></label>
            <label className="inline"><input type="checkbox" checked={params.detectStopes} onChange={(e) => setParam('detectStopes', e.target.checked)} /> Detect coloured stopes</label>
            {params.detectStopes && (
              <div className="row">
                <label className="field">Stope colour threshold<input type="number" step="0.01" value={params.stopeMinSaturation} onChange={(e) => setParam('stopeMinSaturation', Number(e.target.value))} /></label>
                <label className="field">Stope height (m)<input type="number" value={params.stopeHeightM} onChange={(e) => setParam('stopeHeightM', Number(e.target.value))} /></label>
              </div>
            )}
            <div className="row">
              <button className="primary" disabled={detecting} onClick={() => runDetect('replace')}>{detecting ? 'Detecting…' : 'Detect drives'}</button>
              <button onClick={() => update({ params: defaultDetectionParams() })}>Reset</button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Detection replaces the current network. Use "Detect &amp; add" in step 2 to add one portion at a time.</p>
          </div>
        )}

        {lastResult && (step === 'detect' || step === 'edit') && (
          <div className="section">
            <h3>Last detection</h3>
            <dl className="kv">
              <dt>Drive width</dt><dd>{lastResult.driveWidthPx} px ≈ {(lastResult.driveWidthPx * mpp).toFixed(1)} m</dd>
              <dt>Junctions + ends</dt><dd>{lastResult.stats.nodes}</dd>
              <dt>Drive segments</dt><dd>{lastResult.stats.edges}</dd>
              <dt>Stopes</dt><dd>{lastResult.stats.stopes}</dd>
              <dt>Time</dt><dd>{lastResult.stats.ms} ms</dd>
            </dl>
            {lastResult.warnings.map((w) => <div key={w} className="warn-box small">{w}</div>)}
          </div>
        )}

        {step === 'edit' && (
          <div className="section stack">
            <h3>Edit network</h3>
            <div className="row">{toolBtn('select', 'Select')}{toolBtn('drive', 'Draw drive')}{toolBtn('stope', 'Draw stope')}{toolBtn('pan', 'Pan')}</div>
            <div className="row">
              <button onClick={undo} disabled={!history.current.length}>Undo</button>
              <button onClick={redo} disabled={!future.current.length}>Redo</button>
              <button onClick={() => setNetwork(mergeDegree2(plan.network))}>Tidy</button>
              <button className="danger" onClick={() => { if (confirm('Clear all drives and stopes?')) setNetwork({ nodes: [], edges: [], stopes: [] }); }}>Clear</button>
            </div>
            <dl className="kv">
              <dt>Drives</dt><dd>{plan.network.edges.length} segments · {(networkLength(plan.network) * mpp).toFixed(0)} m</dd>
              <dt>Stopes</dt><dd>{plan.network.stopes.length}</dd>
            </dl>
            {selEdge && (
              <div className="card stack">
                <strong>Drive segment</strong>
                <span className="small">Length {(polylineLength(selEdge.points) * mpp).toFixed(1)} m{selEdge.widthPx ? ` · width ≈ ${(selEdge.widthPx * mpp).toFixed(1)} m` : ''}</span>
                <button className="danger" onClick={onDelete}>Delete segment</button>
              </div>
            )}
            {selNode && (
              <div className="card stack">
                <strong>Junction / end</strong>
                <span className="small">{(() => { const w = pxToWorld(sim, [selNode.x, selNode.y]); return `${w[0].toFixed(1)} E, ${w[1].toFixed(1)} N`; })()}</span>
                <button className="danger" onClick={onDelete}>Delete with connected drives</button>
              </div>
            )}
            {selStope && (
              <div className="card stack">
                <strong>Stope</strong>
                <label className="field">Label<input value={selStope.label ?? ''} onChange={(e) => update({ network: { ...plan.network, stopes: plan.network.stopes.map((s) => (s.id === selStope.id ? { ...s, label: e.target.value } : s)) } })} /></label>
                <div className="row">
                  <label className="field">Height (m)<input type="number" value={selStope.heightM} onChange={(e) => update({ network: { ...plan.network, stopes: plan.network.stopes.map((s) => (s.id === selStope.id ? { ...s, heightM: Number(e.target.value) } : s)) } })} /></label>
                  <label className="field">Base offset (m)<input type="number" value={selStope.baseOffsetM} onChange={(e) => update({ network: { ...plan.network, stopes: plan.network.stopes.map((s) => (s.id === selStope.id ? { ...s, baseOffsetM: Number(e.target.value) } : s)) } })} /></label>
                </div>
                <span className="small muted">Area {(Math.abs(polygonArea(selStope.polygon)) * mpp * mpp).toFixed(0)} m²</span>
                <button className="danger" onClick={onDelete}>Delete stope</button>
              </div>
            )}
            <button className="primary" disabled={!plan.network.edges.length} onClick={async () => { await flush(); nav(`/projects/${projectId}/view`); }}>Build 3D model</button>
          </div>
        )}

        <div className="section stack">
          <label className="inline"><input type="checkbox" checked={showNetwork} onChange={(e) => setShowNetwork(e.target.checked)} /> Show drives and stopes</label>
          <label className="inline"><input type="checkbox" checked={showMask} disabled={!mask} onChange={(e) => setShowMask(e.target.checked)} /> Show detection mask</label>
        </div>
      </aside>
      <div className="main">
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
          onSelect={setSelection}
          onPolygon={(t, poly) => {
            if (t === 'region') update({ regions: [...plan.regions, poly] });
            else if (t === 'exclude') update({ excludes: [...plan.excludes, poly] });
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
          }}
          onDelete={onDelete}
        />
        <div className="hint">{TOOL_HINTS[tool]}</div>
      </div>
    </div>
  );
}
