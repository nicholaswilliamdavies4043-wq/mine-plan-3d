import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Asset } from '@mineplan/shared';
import { api, type ProjectSummary } from '../api';
import { AssetImportWizard } from '../components/AssetImportWizard';
import { Icon } from '../ui/Icon';
import { InfoTip } from '../ui/help';
import { usePageChrome } from '../ui/shell';
import { useToast } from '../ui/toast';

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Library of equipment and other items (with their 3D models) that can be placed anywhere in a model. */
export function InventoryPage() {
  const chrome = usePageChrome([{ label: 'Inventory' }], { search: true });
  const [items, setItems] = useState<Asset[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [wizard, setWizard] = useState<{ existing?: Asset } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = () => {
    api.assets().then((a) => setItems(a.filter((x) => x.category === 'item'))).catch((e) => setError(e.message));
    api.projects().then(setProjects).catch(() => {});
  };
  useEffect(load, []);

  const q = chrome.query.trim().toLowerCase();
  const shown = (items ?? []).filter((a) => !q || (a.name + ' ' + a.tags.join(' ')).toLowerCase().includes(q));
  const placedCount = (id: string) => projects.reduce((n, p) => n + (p.itemCount?.[id] ?? 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="sub">
            Equipment and other objects, each with its own 3D model: loaders, trucks, refuge chambers, pumps, fans, substations, signage.
            Add them here, then open a project's 3D model and use the Inventory tab to place, move, rotate and scale them anywhere in the drives.
            <InfoTip k="inventory" />
          </p>
        </div>
        <span className="spacer" />
        <button className="primary" onClick={() => setWizard({})}><Icon name="plus" size={16} /> Add item</button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {!items && <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 260 }} />)}</div>}
      {items && !items.length && (
        <div className="empty">
          No inventory items yet. Click <strong>Add item</strong> and choose a GLB/glTF model (OBJ, FBX and STL are converted automatically).
        </div>
      )}
      <div className="grid stagger">
        {shown.map((a) => {
          const thumb = api.assetThumbUrl(a);
          const placed = placedCount(a.id);
          return (
            <div key={a.id} className="card hover stack" style={{ padding: 12 }}>
              {thumb ? <img className="thumb" src={thumb} alt="" /> : <div className="thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><Icon name="box" size={40} /></div>}
              <div className="row" style={{ flexWrap: 'nowrap', padding: '0 4px' }}>
                <strong style={{ flex: 1 }}>{a.name}</strong>
                {placed > 0 && <span className="badge ok">{placed} placed</span>}
              </div>
              <div className="stats" style={{ padding: '0 4px' }}>
                <div className="stat"><div className="v">{r1(a.meta.dims.length)}</div><div className="k">length m</div></div>
                <div className="stat"><div className="v">{r1(a.meta.dims.width)}</div><div className="k">width m</div></div>
                <div className="stat"><div className="v">{r1(a.meta.dims.height)}</div><div className="k">height m</div></div>
              </div>
              {a.tags.length > 0 && <div className="row" style={{ padding: '0 4px' }}>{a.tags.map((t) => <span key={t} className="badge">{t}</span>)}</div>}
              <div className="row" style={{ padding: '0 4px 4px' }}>
                <button onClick={() => setWizard({ existing: a })}><Icon name="settings" size={15} /> Edit</button>
                <span className="spacer" />
                <button className="ghost" aria-label="Delete item" onClick={async () => {
                  if (!confirm(`Delete "${a.name}"? Every placed copy in every project is removed too.`)) return;
                  await api.deleteAsset(a.id);
                  toast('Item deleted', 'info');
                  load();
                }}><Icon name="trash" size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>
      {items && items.length > 0 && (
        <p className="small muted" style={{ marginTop: 24 }}>
          To place items, open a project from <Link to="/">Projects</Link>, choose <strong>Open 3D model</strong>, then the <strong>Inventory</strong> tab.
        </p>
      )}
      {wizard && (
        <AssetImportWizard existing={wizard.existing} presetCategory="item" onClose={() => setWizard(null)}
          onSaved={(a) => { setWizard(null); load(); toast(`"${a.name}" saved to the inventory`); }} />
      )}
    </div>
  );
}
