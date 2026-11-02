/**
 * Portable project files (.mine3d): a single JSON document containing the project, its plans
 * (with the plan images), the selected kit and every 3D asset that kit uses. Download it from one
 * installation and open it on any other PC running the app.
 */
import { Router } from 'express';
import { uid, type Asset, type Kit, type Plan, type Project } from '@mineplan/shared';
import type { Store } from '../store';
import type { ObjectStorage } from '../storage';
import { ah, HttpError, now, upload } from './util';

const FORMAT = 'mine-plan-3d';
const VERSION = 1;

interface PortableFile { name: string; mime: string; data: string }
interface PortableAsset { asset: Asset; files: PortableFile[]; thumbnail?: string | null }
interface PortableProject {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  project: Project;
  plans: { plan: Plan; image: PortableFile }[];
  kit: Kit | null;
  assets: PortableAsset[];
}

export function portableRoutes(store: Store, storage: ObjectStorage): Router {
  const r = Router();

  r.get('/projects/:id/export', ah(async (req, res) => {
    const project = await store.projects.get(req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    const plans = await store.plans.list({ projectId: project.id } as Partial<Plan>);
    const out: PortableProject = { format: FORMAT, version: VERSION, exportedAt: now(), project, plans: [], kit: null, assets: [] };
    for (const plan of plans) {
      const img = await storage.get(plan.imageKey);
      if (!img) throw new HttpError(500, `Image for plan "${plan.name}" is missing`);
      out.plans.push({ plan, image: { name: plan.imageKey.split('/').pop()!, mime: img.contentType, data: img.data.toString('base64') } });
    }
    // assets used by the kit and by placed inventory items
    const ids = new Set<string>((project.items ?? []).map((i) => i.assetId));
    if (project.kitId) {
      const kit = await store.kits.get(project.kitId);
      if (kit) {
        out.kit = kit;
        for (const id of [...Object.values(kit.slots).filter((x): x is string => !!x), ...(kit.decorations ?? []).map((d) => d.assetId)]) ids.add(id);
      }
    }
    for (const id of ids) {
      const asset = await store.assets.get(id);
      if (!asset) continue;
      const files: PortableFile[] = [];
      for (const f of asset.files) {
        const obj = await storage.get(f.key);
        if (obj) files.push({ name: f.name, mime: f.mime, data: obj.data.toString('base64') });
      }
      const thumb = asset.thumbnailKey ? await storage.get(asset.thumbnailKey) : null;
      out.assets.push({ asset, files, thumbnail: thumb ? thumb.data.toString('base64') : null });
    }
    const fname = `${project.name.replace(/[^\w.-]+/g, '_') || 'project'}.mine3d`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.end(JSON.stringify(out));
  }));

  r.post('/projects/import', upload.single('file'), ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach a .mine3d file as "file"');
    let doc: PortableProject;
    try {
      doc = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      throw new HttpError(400, 'This is not a valid project file.');
    }
    if (doc?.format !== FORMAT || !doc.project || !Array.isArray(doc.plans)) throw new HttpError(400, 'This is not a Mine Development Tool project file (.mine3d).');
    if (doc.version > VERSION) throw new HttpError(400, 'This project was saved by a newer version of the app. Update the app first.');

    // assets: reuse an identical id if it already exists in this library, otherwise create it
    for (const pa of doc.assets ?? []) {
      if (await store.assets.get(pa.asset.id)) continue;
      const id = pa.asset.id;
      const files = [];
      for (const f of pa.files) {
        const key = `assets/${id}/files/${f.name}`;
        if (f.name.includes('..')) throw new HttpError(400, 'Invalid asset file name in project');
        const data = Buffer.from(f.data, 'base64');
        await storage.put(key, data, f.mime);
        files.push({ name: f.name, key, size: data.length, mime: f.mime });
      }
      let thumbnailKey: string | null = null;
      if (pa.thumbnail) {
        thumbnailKey = `assets/${id}/thumbnail.png`;
        await storage.put(thumbnailKey, Buffer.from(pa.thumbnail, 'base64'), 'image/png');
      }
      await store.assets.create({ ...pa.asset, files, thumbnailKey, updatedAt: now() });
    }
    let kitId: string | null = null;
    if (doc.kit) {
      kitId = (await store.kits.get(doc.kit.id)) ? doc.kit.id : (await store.kits.create({ ...doc.kit, updatedAt: now() })).id;
    }

    // project and plans always get new ids, so the same file can be opened twice
    const existing = await store.projects.list();
    const taken = new Set(existing.map((p) => p.name));
    let name = doc.project.name;
    if (taken.has(name)) name = `${name} (imported)`;
    const project: Project = { ...doc.project, id: uid('p'), name, kitId, createdAt: now(), updatedAt: now() };
    await store.projects.create(project);
    for (const { plan, image } of doc.plans) {
      const id = uid('pl');
      const ext = image.mime === 'image/png' ? 'png' : 'jpg';
      const key = `plans/${id}/plan.${ext}`;
      await storage.put(key, Buffer.from(image.data, 'base64'), image.mime);
      await store.plans.create({ ...plan, id, projectId: project.id, imageKey: key, createdAt: now(), updatedAt: now() });
    }
    res.status(201).json(project);
  }));

  return r;
}
