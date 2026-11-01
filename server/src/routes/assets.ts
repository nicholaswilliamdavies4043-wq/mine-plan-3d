import { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { ASSET_CATEGORIES, uid, type Asset, type AssetFile, type AssetMeta, type Kit } from '@mineplan/shared';
import type { Store } from '../store';
import type { ObjectStorage } from '../storage';
import { mimeFor, validateGltf, type UploadedFile } from '../gltf/validate';
import { ah, fixName, HttpError, now, parseJsonField, upload } from './util';

const side = z.enum(['+X', '-X', '+Z', '-Z']);
const metaSchema = z.object({
  unitScale: z.number().positive(),
  upAxis: z.enum(['Y', 'Z']),
  forward: side,
  pivot: z.tuple([z.number(), z.number(), z.number()]),
  dims: z.object({ length: z.number().nonnegative(), height: z.number().nonnegative(), width: z.number().nonnegative() }),
  crossSection: z.object({ width: z.number().nonnegative(), height: z.number().nonnegative() }),
  connectionType: z.string().max(100),
  connectors: z.array(z.object({ side, distance: z.number(), connectionType: z.string().max(100) })).max(8),
  bendAngleDeg: z.number().optional(),
  stemSide: z.enum(['+Z', '-Z']).optional(),
  fitToDriveWidth: z.boolean(),
});
const categories = ASSET_CATEGORIES.map((c) => c.value) as [string, ...string[]];
const assetFields = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(categories),
  meta: metaSchema,
  sourceUrl: z.string().max(2000).optional(),
  license: z.string().max(500).optional(),
  licenseConfirmed: z.boolean(),
  tags: z.array(z.string().max(50)).max(30).default([]),
});

function collectFiles(req: any): UploadedFile[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  let relPaths: string[] = [];
  try { relPaths = req.body.paths ? JSON.parse(req.body.paths) : []; } catch { /* ignore */ }
  return files
    .filter((f) => f.fieldname === 'files')
    .map((f, i) => ({ name: relPaths[i] || fixName(f.originalname), data: f.buffer }));
}

export function assetRoutes(store: Store, storage: ObjectStorage): Router {
  const r = Router();

  r.get('/assets', ah(async (_req, res) => {
    res.json(await store.assets.list());
  }));

  r.get('/assets/:id', ah(async (req, res) => {
    const a = await store.assets.get(req.params.id);
    if (!a) throw new HttpError(404, 'Asset not found');
    res.json(a);
  }));

  /** Validate a set of files without storing them. */
  r.post('/assets/validate', upload.any(), ah(async (req, res) => {
    const { report } = validateGltf(collectFiles(req));
    res.json(report);
  }));

  /** Import: files[] (model + resources), metadata (JSON), thumbnail (optional PNG). */
  r.post('/assets', upload.any(), ah(async (req, res) => {
    const fields = assetFields.parse(parseJsonField(req.body.metadata, 'metadata'));
    if (!fields.licenseConfirmed) throw new HttpError(400, 'Confirm that the asset licence permits this use before importing.');
    const files = collectFiles(req);
    const { report, mainFile, paths } = validateGltf(files);
    if (!report.ok || !mainFile) throw new HttpError(400, 'Model failed validation', report);
    const id = uid('a');
    const stored: AssetFile[] = [];
    for (const f of files) {
      const rel = paths.get(f) ?? path.basename(f.name);
      const key = `assets/${id}/files/${rel}`;
      await storage.put(key, f.data, mimeFor(rel));
      stored.push({ name: rel, key, size: f.data.length, mime: mimeFor(rel) });
    }
    let thumbnailKey: string | null = null;
    const thumb = ((req.files as Express.Multer.File[]) ?? []).find((f) => f.fieldname === 'thumbnail');
    if (thumb) {
      thumbnailKey = `assets/${id}/thumbnail.png`;
      await storage.put(thumbnailKey, thumb.buffer, 'image/png');
    }
    const asset: Asset = {
      id, ...fields, category: fields.category as Asset['category'], meta: fields.meta as AssetMeta,
      files: stored, mainFile, thumbnailKey, createdAt: now(), updatedAt: now(),
    };
    res.status(201).json({ asset: await store.assets.create(asset), report });
  }));

  r.patch('/assets/:id', upload.single('thumbnail'), ah(async (req, res) => {
    const body = req.is('multipart/form-data') ? parseJsonField<any>(req.body.metadata, 'metadata') : req.body;
    const patch = assetFields.partial().parse(body) as Partial<Asset>;
    if (req.file) {
      patch.thumbnailKey = `assets/${req.params.id}/thumbnail.png`;
      await storage.put(patch.thumbnailKey, req.file.buffer, 'image/png');
    }
    const a = await store.assets.update(req.params.id, patch);
    if (!a) throw new HttpError(404, 'Asset not found');
    res.json(a);
  }));

  r.delete('/assets/:id', ah(async (req, res) => {
    // detach from kits
    for (const k of await store.kits.list()) {
      const slots = { ...k.slots };
      let changed = false;
      for (const key of Object.keys(slots) as (keyof Kit['slots'])[]) if (slots[key] === req.params.id) { slots[key] = null; changed = true; }
      const decorations = (k.decorations ?? []).filter((d) => d.assetId !== req.params.id);
      if (changed || decorations.length !== (k.decorations ?? []).length) await store.kits.update(k.id, { slots, decorations });
    }
    await storage.deletePrefix(`assets/${req.params.id}`);
    await store.assets.delete(req.params.id);
    res.status(204).end();
  }));

  r.get('/assets/:id/thumbnail', ah(async (req, res) => {
    const obj = await storage.get(`assets/${req.params.id}/thumbnail.png`);
    if (!obj) throw new HttpError(404, 'No thumbnail');
    res.setHeader('Content-Type', 'image/png');
    res.end(obj.data);
  }));

  // Model files keep their relative layout so glTF URIs (e.g. textures/rock.png) resolve.
  r.get(/^\/assets\/([^/]+)\/files\/(.+)$/, ah(async (req, res) => {
    const id = (req.params as any)[0] as string;
    const rel = decodeURIComponent((req.params as any)[1] as string);
    if (rel.includes('..')) throw new HttpError(400, 'Invalid path');
    const obj = await storage.get(`assets/${id}/files/${rel}`);
    if (!obj) throw new HttpError(404, 'File not found');
    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(obj.data);
  }));

  // ---- kits -------------------------------------------------------------------------
  const kitSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    slots: z.record(z.string().nullable()),
    decorations: z.array(z.object({ assetId: z.string(), spacingM: z.number().positive().max(1000) })).max(20).default([]),
    angleToleranceDeg: z.number().min(1).max(45).default(20),
  });

  r.get('/kits', ah(async (_req, res) => res.json(await store.kits.list())));

  r.post('/kits', ah(async (req, res) => {
    const body = kitSchema.parse(req.body);
    const kit: Kit = { id: uid('k'), ...body, createdAt: now(), updatedAt: now() };
    res.status(201).json(await store.kits.create(kit));
  }));

  r.patch('/kits/:id', ah(async (req, res) => {
    const k = await store.kits.update(req.params.id, kitSchema.partial().parse(req.body) as Partial<Kit>);
    if (!k) throw new HttpError(404, 'Kit not found');
    res.json(k);
  }));

  r.delete('/kits/:id', ah(async (req, res) => {
    for (const p of await store.projects.list()) if (p.kitId === req.params.id) await store.projects.update(p.id, { kitId: null });
    await store.kits.delete(req.params.id);
    res.status(204).end();
  }));

  return r;
}
