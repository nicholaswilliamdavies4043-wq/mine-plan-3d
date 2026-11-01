import type { Asset, DetectionParams, DetectionResult, GltfValidationReport, Kit, Plan, Polygon, Project } from '@mineplan/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const r = await fetch('/api' + url, init);
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error ?? r.statusText, data.details);
  return data as T;
}

export type ProjectSummary = Project & { planCount: number };
export type ProjectDetail = Project & { plans: Plan[] };

export const api = {
  projects: () => req<ProjectSummary[]>('GET', '/projects'),
  project: (id: string) => req<ProjectDetail>('GET', `/projects/${id}`),
  createProject: (name: string, description?: string) => req<Project>('POST', '/projects', { name, description }),
  updateProject: (id: string, patch: Partial<Project>) => req<Project>('PATCH', `/projects/${id}`, patch),
  deleteProject: (id: string) => req<void>('DELETE', `/projects/${id}`),

  uploadPlan: (projectId: string, file: File, name: string, levelRL: number) => {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('name', name);
    fd.append('levelRL', String(levelRL));
    return req<Plan>('POST', `/projects/${projectId}/plans`, fd);
  },
  plan: (id: string) => req<Plan>('GET', `/plans/${id}`),
  updatePlan: (id: string, patch: Partial<Plan>) => req<Plan>('PATCH', `/plans/${id}`, patch),
  deletePlan: (id: string) => req<void>('DELETE', `/plans/${id}`),
  planImageUrl: (id: string) => `/api/plans/${id}/image`,
  detect: (id: string, body: { regions?: Polygon[]; excludes?: Polygon[]; params?: Partial<DetectionParams>; mode?: 'replace' | 'merge' }) =>
    req<DetectionResult>('POST', `/plans/${id}/detect`, body),

  assets: () => req<Asset[]>('GET', '/assets'),
  validateAsset: (files: File[], paths: string[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('paths', JSON.stringify(paths));
    return req<GltfValidationReport>('POST', '/assets/validate', fd);
  },
  createAsset: (files: File[], paths: string[], metadata: unknown, thumbnail?: Blob | null) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('paths', JSON.stringify(paths));
    fd.append('metadata', JSON.stringify(metadata));
    if (thumbnail) fd.append('thumbnail', thumbnail, 'thumbnail.png');
    return req<{ asset: Asset; report: GltfValidationReport }>('POST', '/assets', fd);
  },
  updateAsset: (id: string, patch: Partial<Asset>) => req<Asset>('PATCH', `/assets/${id}`, patch),
  deleteAsset: (id: string) => req<void>('DELETE', `/assets/${id}`),
  assetFileUrl: (a: Asset, name = a.mainFile) => `/api/assets/${a.id}/files/${name.split('/').map(encodeURIComponent).join('/')}`,
  assetThumbUrl: (a: Asset) => (a.thumbnailKey ? `/api/assets/${a.id}/thumbnail?v=${encodeURIComponent(a.updatedAt)}` : null),

  kits: () => req<Kit[]>('GET', '/kits'),
  createKit: (k: Partial<Kit>) => req<Kit>('POST', '/kits', k),
  updateKit: (id: string, k: Partial<Kit>) => req<Kit>('PATCH', `/kits/${id}`, k),
  deleteKit: (id: string) => req<void>('DELETE', `/kits/${id}`),
};
