import { useEffect, useState } from 'react';
import { ASSET_CATEGORIES, KIT_SLOTS, type Asset, type Kit, type KitSlot } from '@mineplan/shared';
import { api } from '../api';
import { AssetImportWizard } from '../components/AssetImportWizard';
import { Icon } from '../ui/Icon';
import { InfoTip, L } from '../ui/help';
import { usePageChrome } from '../ui/shell';
import { useToast } from '../ui/toast';

const catLabel = (c: string) => ASSET_CATEGORIES.find((x) => x.value === c)?.label ?? c;
const r1 = (v: number) => Math.round(v * 10) / 10;

function KitEditor({ kit, assets, onSaved, onDeleted }: { kit: Kit; assets: Asset[]; onSaved: (k: Kit) => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState<Kit>(kit);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const toast = useToast();
  useEffect(() => { setDraft(kit); setSaved(true); }, [kit]);
  const change = (k: Kit) => { setDraft(k); setSaved(false); };

  const save = async () => {
    try {
      const k = await api.updateKit(kit.id, {
        name: draft.name, description: draft.description, slots: draft.slots,
        decorations: draft.decorations, angleToleranceDeg: draft.angleToleranceDeg,
      });
      onSaved(k);
      setSaved(true);
      setError(null);
      toast(`Kit "${k.name}" saved`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const infra = assets.filter((a) => a.category === 'infrastructure' || a.category === 'general');

  return (
    <div className="card stack">
      <div className="row">
        <input value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} style={{ fontSize: 16, width: 260 }} />
        <span className="spacer" />
        <button className="primary" disabled={saved} onClick={save}>Save kit</button>
        <button className="danger" onClick={async () => {
          if (!confirm(`Delete kit "${kit.name}"? Projects using it fall back to the built-in kit.`)) return;
          await api.deleteKit(kit.id);
          onDeleted();
        }}>Delete</button>
      </div>
      {error && <div className="error-box small">{error}</div>}
      <table className="list">
        <thead><tr><th><L k="kitSlots">Slot</L></th><th>Asset</th><th>Openings</th></tr></thead>
        <tbody>
          {KIT_SLOTS.map(({ slot, label, category, required }) => {
            const id = draft.slots[slot] ?? '';
            const sel = assets.find((a) => a.id === id);
            const options = assets.filter((a) => a.category === category);
            const others = assets.filter((a) => a.category !== category);
            return (
              <tr key={slot}>
                <td>{label}{required ? '' : <span className="muted small"> (optional)</span>}</td>
                <td>
                  <select value={id} onChange={(e) => change({ ...draft, slots: { ...draft.slots, [slot as KitSlot]: e.target.value || null } })}>
                    <option value="">Built-in piece</option>
                    {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    {others.length > 0 && <optgroup label="Other categories">{others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
                  </select>
                </td>
                <td className="small muted">{sel ? (sel.meta.connectors.map((c) => c.side).join(' ') || 'none defined') : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="stack">
        <strong className="small row">Infrastructure along drives <InfoTip k="decorations" /></strong>
        {draft.decorations.map((d, i) => (
          <div key={i} className="row">
            <select value={d.assetId} onChange={(e) => change({ ...draft, decorations: draft.decorations.map((x, j) => (j === i ? { ...x, assetId: e.target.value } : x)) })}>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label className="inline small">every
              <input type="number" min={0.5} step={0.5} value={d.spacingM} onChange={(e) => change({ ...draft, decorations: draft.decorations.map((x, j) => (j === i ? { ...x, spacingM: Math.max(0.5, Number(e.target.value)) } : x)) })} /> m
            </label>
            <button onClick={() => change({ ...draft, decorations: draft.decorations.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <div className="row">
          <button disabled={!assets.length} onClick={() => change({ ...draft, decorations: [...draft.decorations, { assetId: (infra[0] ?? assets[0]).id, spacingM: 6 }] })}>
            Add infrastructure item
          </button>
        </div>
      </div>
      <label className="field"><L k="angleTolerance">Junction angle tolerance (degrees)</L>
        <input type="number" min={1} max={45} value={draft.angleToleranceDeg} onChange={(e) => change({ ...draft, angleToleranceDeg: Number(e.target.value) })} />
      </label>
    </div>
  );
}

export function AssetLibraryPage() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [wizard, setWizard] = useState<{ existing?: Asset } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const chrome = usePageChrome([{ label: 'Asset library' }], { search: true });
  const toast = useToast();

  const load = () => {
    api.assets().then(setAssets).catch((e) => setError(e.message));
    api.kits().then(setKits).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const q = chrome.query.trim().toLowerCase();
  const shown = (assets ?? []).filter((a) => (!filter || a.category === filter) && (!q || (a.name + ' ' + a.tags.join(' ')).toLowerCase().includes(q)));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Asset library</h1>
          <p className="sub">
            Reusable 3D tunnel modules (GLB/glTF) used to assemble the mine. Group them into kits and pick a kit per project.
            Before you import, check that each file's licence allows your use. One source to look at is the "Underground Mine and Shaft Works" pack
            on 3DAssets.dev.
          </p>
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => setWizard({})}><Icon name="upload" size={16} /> Import asset</button>
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="seg" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={!filter ? 'on' : ''} onClick={() => setFilter('')}>All {assets ? `(${assets.length})` : ''}</button>
        {ASSET_CATEGORIES.map((c) => {
          const n = (assets ?? []).filter((a) => a.category === c.value).length;
          return n ? <button key={c.value} className={filter === c.value ? 'on' : ''} onClick={() => setFilter(c.value)}>{c.label} ({n})</button> : null;
        })}
      </div>
      {assets && assets.length === 0 && (
        <div className="empty">No assets yet. Import a straight drive module first; projects use the built-in parametric kit until then.</div>
      )}
      <div className="grid stagger">
        {shown.map((a) => {
          const thumb = api.assetThumbUrl(a);
          return (
            <div key={a.id} className="card hover stack" style={{ padding: 12 }}>
              {thumb ? <img className="thumb" src={thumb} alt="" /> : <div className="thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><Icon name="cube" size={40} /></div>}
              <div className="row" style={{ flexWrap: 'nowrap', padding: '0 4px' }}>
                <strong style={{ flex: 1 }}>{a.name}</strong>
                <span className="badge accent">{catLabel(a.category)}</span>
              </div>
              <div className="stats" style={{ padding: '0 4px' }}>
                <div className="stat"><div className="v">{r1(a.meta.dims.length)}</div><div className="k">length m</div></div>
                <div className="stat"><div className="v">{r1(a.meta.dims.width)}</div><div className="k">width m</div></div>
                <div className="stat"><div className="v">{r1(a.meta.dims.height)}</div><div className="k">height m</div></div>
              </div>
              <div className="small muted" style={{ padding: '0 4px' }}>
                Openings {a.meta.connectors.map((c) => c.side).join(' ') || 'none'} · {a.license || 'licence not recorded'}
              </div>
              <div className="row" style={{ padding: '0 4px 4px' }}>
                <button onClick={() => setWizard({ existing: a })}><Icon name="settings" size={15} /> Edit</button>
                <span className="spacer" />
                <button className="ghost" aria-label="Delete asset" onClick={async () => {
                  if (!confirm(`Delete "${a.name}"? It is removed from any kit that uses it.`)) return;
                  await api.deleteAsset(a.id);
                  toast('Asset deleted', 'info');
                  load();
                }}><Icon name="trash" size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="page-head" style={{ marginTop: 44 }}>
        <div><h2 style={{ margin: 0 }}>Kits</h2></div>
        <span className="spacer" />
        <button onClick={async () => {
          try {
            const k = await api.createKit({ name: `Kit ${kits.length + 1}`, slots: {}, decorations: [], angleToleranceDeg: 20 });
            setKits([...kits, k]);
            toast('Kit created');
          } catch (e: any) { setError(e.message); }
        }}><Icon name="plus" size={15} /> New kit</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        A kit maps library assets to slots. Straights are tiled along drives. T, cross and bend pieces are placed where a junction's angles match within the
        tolerance. Everything else uses fitted parametric connectors.
      </p>
      <div className="stack" style={{ gap: 16, maxWidth: 820 }}>
        {kits.map((k) => (
          <KitEditor key={k.id} kit={k} assets={assets ?? []}
            onSaved={(n) => setKits(kits.map((x) => (x.id === n.id ? n : x)))}
            onDeleted={() => setKits(kits.filter((x) => x.id !== k.id))} />
        ))}
        {!kits.length && <div className="empty">No kits yet.</div>}
      </div>

      {wizard && (
        <AssetImportWizard existing={wizard.existing} onClose={() => setWizard(null)} onSaved={(a) => { setWizard(null); load(); toast(`"${a.name}" saved to the library`); }} />
      )}
    </div>
  );
}
