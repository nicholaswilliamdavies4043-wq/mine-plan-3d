import { useEffect, useState } from 'react';
import { ASSET_CATEGORIES, KIT_SLOTS, type Asset, type Kit, type KitSlot } from '@mineplan/shared';
import { api } from '../api';
import { AssetImportWizard } from '../components/AssetImportWizard';

const catLabel = (c: string) => ASSET_CATEGORIES.find((x) => x.value === c)?.label ?? c;
const r1 = (v: number) => Math.round(v * 10) / 10;

function KitEditor({ kit, assets, onSaved, onDeleted }: { kit: Kit; assets: Asset[]; onSaved: (k: Kit) => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState<Kit>(kit);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
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
        <thead><tr><th>Slot</th><th>Asset</th><th>Openings</th></tr></thead>
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
        <strong className="small">Infrastructure along drives</strong>
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
      <label className="field">Junction angle tolerance (degrees). Junctions outside it use fitted connectors.
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

  const load = () => {
    api.assets().then(setAssets).catch((e) => setError(e.message));
    api.kits().then(setKits).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const shown = (assets ?? []).filter((a) => !filter || a.category === filter);

  return (
    <div className="page">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <h1>Asset library</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setWizard({})}>Import asset</button>
      </div>
      <p className="muted" style={{ maxWidth: 720, marginTop: 0 }}>
        Reusable 3D tunnel modules (GLB/glTF) used to assemble the mine. Group them into kits and pick a kit per project.
        Before you import, check that each file's licence allows your use. One source to look at is the "Underground Mine and Shaft Works" pack
        on 3DAssets.dev.
      </p>
      {error && <div className="error-box">{error}</div>}

      <div className="row" style={{ margin: '16px 0' }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All categories</option>
          {ASSET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <span className="muted small">{assets ? `${shown.length} of ${assets.length} assets` : 'Loading…'}</span>
      </div>
      {assets && assets.length === 0 && (
        <div className="empty">No assets yet. Import a straight drive module first; projects use the built-in parametric kit until then.</div>
      )}
      <div className="grid">
        {shown.map((a) => {
          const thumb = api.assetThumbUrl(a);
          return (
            <div key={a.id} className="card stack">
              {thumb ? <img className="thumb" src={thumb} alt="" /> : <div className="thumb" />}
              <strong>{a.name}</strong>
              <div className="row small">
                <span className="badge">{catLabel(a.category)}</span>
                <span className="muted">{r1(a.meta.dims.length)} × {r1(a.meta.dims.width)} × {r1(a.meta.dims.height)} m</span>
              </div>
              <div className="small muted">
                Openings: {a.meta.connectors.map((c) => c.side).join(' ') || 'none'} · {a.license || 'licence not recorded'}
              </div>
              <div className="row">
                <button onClick={() => setWizard({ existing: a })}>Edit</button>
                <button className="danger" onClick={async () => {
                  if (!confirm(`Delete "${a.name}"? It is removed from any kit that uses it.`)) return;
                  await api.deleteAsset(a.id);
                  load();
                }}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 48, alignItems: 'flex-start' }}>
        <h2>Kits</h2>
        <span className="spacer" />
        <button onClick={async () => {
          try {
            const k = await api.createKit({ name: `Kit ${kits.length + 1}`, slots: {}, decorations: [], angleToleranceDeg: 20 });
            setKits([...kits, k]);
          } catch (e: any) { setError(e.message); }
        }}>New kit</button>
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
        <AssetImportWizard existing={wizard.existing} onClose={() => setWizard(null)} onSaved={() => { setWizard(null); load(); }} />
      )}
    </div>
  );
}
