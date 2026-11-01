import { Router } from 'express';
import { z } from 'zod';
import {
  defaultDetectionParams, defaultProfile, emptyNetwork, fitSimilarity, networkLength, scaleOf, uid, type DetectionParams, type Plan, type PlanNetwork, type Project,
} from '@mineplan/shared';
import type { Store } from '../store';
import type { ObjectStorage } from '../storage';
import { decodeImage, sniffMime, type RGBAImage } from '../processing/raster';
import { detectNetwork } from '../processing/detect';
import { ah, fixName, HttpError, now, upload } from './util';

const vec2 = z.tuple([z.number(), z.number()]);
const polygon = z.array(vec2);
const profileSchema = z.object({
  width: z.number().positive().max(50),
  wallHeight: z.number().positive().max(50),
  archRise: z.number().min(0).max(30),
  useDetectedWidths: z.boolean(),
});
const projectPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  kitId: z.string().nullable().optional(),
  profile: profileSchema.optional(),
});
const networkSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })),
  edges: z.array(z.object({ id: z.string(), a: z.string(), b: z.string(), points: z.array(vec2).min(2), widthPx: z.number().optional() })),
  stopes: z.array(z.object({
    id: z.string(), polygon, heightM: z.number(), baseOffsetM: z.number(), label: z.string().optional(),
  })),
});
const planPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  levelRL: z.number().optional(),
  georef: z.object({
    metersPerPixel: z.number().positive(),
    points: z.array(z.object({ px: vec2, world: vec2 })).max(10),
  }).optional(),
  regions: z.array(polygon).optional(),
  excludes: z.array(polygon).optional(),
  params: z.record(z.any()).optional(),
  network: networkSchema.optional(),
});

/** Small LRU of decoded plan images (decoding large JPEGs is the slowest part of detection). */
const imageCache = new Map<string, RGBAImage>();
async function loadImage(storage: ObjectStorage, plan: Plan): Promise<RGBAImage> {
  const hit = imageCache.get(plan.imageKey);
  if (hit) {
    imageCache.delete(plan.imageKey);
    imageCache.set(plan.imageKey, hit);
    return hit;
  }
  const obj = await storage.get(plan.imageKey);
  if (!obj) throw new HttpError(404, 'Plan image missing from storage');
  const img = decodeImage(obj.data);
  imageCache.set(plan.imageKey, img);
  while (imageCache.size > 3) imageCache.delete(imageCache.keys().next().value!);
  return img;
}

function networkBBox(plan: Plan): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of plan.network.edges) for (const q of e.points) {
    x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, plan.imageWidth, plan.imageHeight];
}

function mergeNetworks(a: PlanNetwork, b: PlanNetwork): PlanNetwork {
  return { nodes: [...a.nodes, ...b.nodes], edges: [...a.edges, ...b.edges], stopes: [...a.stopes, ...b.stopes] };
}

export function projectRoutes(store: Store, storage: ObjectStorage): Router {
  const r = Router();

  // ---- projects -------------------------------------------------------------------
  r.get('/projects', ah(async (_req, res) => {
    const projects = await store.projects.list();
    const plans = await store.plans.list();
    res.json(projects.map((p) => {
      const mine = plans.filter((x) => x.projectId === p.id);
      let lengthM = 0, stopes = 0, junctions = 0;
      for (const pl of mine) {
        const mpp = scaleOf(fitSimilarity(pl.georef));
        lengthM += networkLength(pl.network) * mpp;
        stopes += pl.network.stopes.length;
        junctions += pl.network.nodes.length;
      }
      // light-weight preview of the first plan that has drives (rounded centrelines only)
      const first = mine.find((x) => x.network.edges.length) ?? mine[0];
      const preview = first ? {
        planId: first.id, width: first.imageWidth, height: first.imageHeight,
        bbox: networkBBox(first),
        edges: first.network.edges.map((e) => e.points.map((q) => [Math.round(q[0]), Math.round(q[1])])),
        stopes: first.network.stopes.map((s) => s.polygon.map((q) => [Math.round(q[0]), Math.round(q[1])])),
      } : null;
      return {
        ...p, planCount: mine.length, lengthM: Math.round(lengthM), stopes, junctions,
        levels: mine.map((x) => x.levelRL), preview,
      };
    }));
  }));

  r.post('/projects', ah(async (req, res) => {
    const body = z.object({ name: z.string().min(1).max(200), description: z.string().max(5000).optional() }).parse(req.body);
    const p: Project = { id: uid('p'), name: body.name, description: body.description, kitId: null, profile: defaultProfile(), createdAt: now(), updatedAt: now() };
    res.status(201).json(await store.projects.create(p));
  }));

  r.get('/projects/:id', ah(async (req, res) => {
    const p = await store.projects.get(req.params.id);
    if (!p) throw new HttpError(404, 'Project not found');
    const plans = await store.plans.list({ projectId: p.id } as Partial<Plan>);
    res.json({ ...p, plans });
  }));

  r.patch('/projects/:id', ah(async (req, res) => {
    const patch = projectPatch.parse(req.body);
    const p = await store.projects.update(req.params.id, patch as Partial<Project>);
    if (!p) throw new HttpError(404, 'Project not found');
    res.json(p);
  }));

  r.delete('/projects/:id', ah(async (req, res) => {
    const plans = await store.plans.list({ projectId: req.params.id } as Partial<Plan>);
    for (const pl of plans) {
      await storage.deletePrefix(`plans/${pl.id}`);
      await store.plans.delete(pl.id);
    }
    await store.projects.delete(req.params.id);
    res.status(204).end();
  }));

  // ---- plans ------------------------------------------------------------------------
  r.post('/projects/:id/plans', upload.single('image'), ah(async (req, res) => {
    const project = await store.projects.get(req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    const file = req.file;
    if (!file) throw new HttpError(400, 'Attach the plan image as "image"');
    const mime = sniffMime(file.buffer);
    if (!mime) throw new HttpError(400, 'Plan must be a PNG or JPEG image. Export PDF/DWG plans to an image first (300 dpi recommended).');
    let img: RGBAImage;
    try {
      img = decodeImage(file.buffer);
    } catch (e: any) {
      throw new HttpError(400, `Could not read image: ${e.message}`);
    }
    const id = uid('pl');
    const name = (req.body.name as string) || fixName(file.originalname).replace(/\.[^.]+$/, '');
    const key = `plans/${id}/plan${mime === 'image/png' ? '.png' : '.jpg'}`;
    await storage.put(key, file.buffer, mime);
    imageCache.set(key, img);
    const levelRL = Number(req.body.levelRL);
    const plan: Plan = {
      id, projectId: project.id, name, imageKey: key, imageMime: mime, imageWidth: img.width, imageHeight: img.height,
      levelRL: Number.isFinite(levelRL) ? levelRL : 0,
      georef: { metersPerPixel: 1, points: [] },
      regions: [], excludes: [], params: defaultDetectionParams(), network: emptyNetwork(), lastDetection: null,
      createdAt: now(), updatedAt: now(),
    };
    res.status(201).json(await store.plans.create(plan));
  }));

  r.get('/plans/:id', ah(async (req, res) => {
    const p = await store.plans.get(req.params.id);
    if (!p) throw new HttpError(404, 'Plan not found');
    res.json(p);
  }));

  r.patch('/plans/:id', ah(async (req, res) => {
    const patch = planPatch.parse(req.body) as Partial<Plan>;
    if (patch.params) patch.params = { ...defaultDetectionParams(), ...(patch.params as DetectionParams) };
    const p = await store.plans.update(req.params.id, patch);
    if (!p) throw new HttpError(404, 'Plan not found');
    res.json(p);
  }));

  r.delete('/plans/:id', ah(async (req, res) => {
    await storage.deletePrefix(`plans/${req.params.id}`);
    await store.plans.delete(req.params.id);
    res.status(204).end();
  }));

  r.get('/plans/:id/image', ah(async (req, res) => {
    const p = await store.plans.get(req.params.id);
    if (!p) throw new HttpError(404, 'Plan not found');
    const obj = await storage.get(p.imageKey);
    if (!obj) throw new HttpError(404, 'Image not found');
    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(obj.data);
  }));

  /**
   * Run automatic detection. Body: { regions?, excludes?, params?, mode?: 'replace' | 'merge' }
   * 'merge' appends the result to the existing network (model the plan portion by portion).
   */
  r.post('/plans/:id/detect', ah(async (req, res) => {
    const body = z.object({
      regions: z.array(polygon).optional(),
      excludes: z.array(polygon).optional(),
      params: z.record(z.any()).optional(),
      mode: z.enum(['replace', 'merge']).optional(),
    }).parse(req.body ?? {});
    const plan = await store.plans.get(req.params.id);
    if (!plan) throw new HttpError(404, 'Plan not found');
    const image = await loadImage(storage, plan);
    const params = { ...defaultDetectionParams(), ...plan.params, ...(body.params ?? {}) } as DetectionParams;
    const regions = body.regions ?? plan.regions;
    const excludes = body.excludes ?? plan.excludes;
    let result;
    try {
      result = detectNetwork({ image, regions, excludes, params, withMask: true });
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
    const network = body.mode === 'merge' ? mergeNetworks(plan.network, result.network) : result.network;
    const { maskPng, network: _n, ...summary } = result;
    await store.plans.update(plan.id, {
      network, params, excludes, lastDetection: summary,
      regions: body.mode === 'merge' ? plan.regions : regions,
    });
    res.json({ ...result, network });
  }));

  return r;
}
