import {
  defaultDetectionParams, defaultProfile, emptyNetwork, uid,
  type Asset, type DetectionParams, type DetectionResult, type GltfValidationReport, type Kit, type Plan, type Polygon, type Project, type SystemStatus,
} from '@mineplan/shared';
import {
  cachedGet, createProjectRecord, deleteRecord, onlineRequest, patchRecord, pendingPlanImage, uploadPlanRecord,
} from './offline/sync';

export { ApiError } from './offline/sync';

const OFFLINE_DETECT = 'Detection runs on the server. Your edits are kept on this device; run detection again when you are back online.';
const OFFLINE_ASSETS = 'Importing and deleting assets needs a connection to the server.';

/** Image size of a plan file (used for plans uploaded while offline). */
async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface ProjectPreview {
  planId: string;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  edges: [number, number][][];
  stopes: [number, number][][];
}
export type ProjectSummary = Project & {
  planCount: number;
  lengthM: number;
  stopes: number;
  junctions: number;
  itemCount: Record<string, number>;
  levels: number[];
  preview: ProjectPreview | null;
};
export type ProjectDetail = Project & { plans: Plan[] };

export const api = {
  projects: () => cachedGet<ProjectSummary[]>('/projects'),
  project: (id: string) => cachedGet<ProjectDetail>(`/projects/${id}`),
  createProject: (name: string, description?: string) => {
    const t = new Date().toISOString();
    return createProjectRecord({ id: uid('p'), name, description, kitId: null, profile: defaultProfile(), createdAt: t, updatedAt: t });
  },
  updateProject: (id: string, patch: Partial<Project>, label?: string) => patchRecord<Project>('project', id, patch as Record<string, unknown>, label),
  deleteProject: (id: string) => deleteRecord('project', id),
  exportProjectUrl: (id: string) => `/api/projects/${id}/export`,
  importProject: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return onlineRequest<Project>('POST', '/projects/import', fd, 'Opening a project file needs a connection to the server.');
  },

  uploadPlan: async (projectId: string, file: File, name: string, levelRL: number) => {
    const id = uid('pl');
    const form = () => {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('name', name);
      fd.append('levelRL', String(levelRL));
      fd.append('id', id);
      return fd;
    };
    const t = new Date().toISOString();
    const size = await imageSize(file).catch(() => ({ width: 1000, height: 1000 }));
    const local: Plan = {
      id, projectId, name, imageKey: '', imageMime: file.type, imageWidth: size.width, imageHeight: size.height,
      levelRL: Number.isFinite(levelRL) ? levelRL : 0, georef: { metersPerPixel: 1, points: [] }, regions: [], excludes: [],
      params: defaultDetectionParams(), network: emptyNetwork(), lastDetection: null, createdAt: t, updatedAt: t,
    };
    return uploadPlanRecord(local, file, form);
  },
  plan: (id: string) => cachedGet<Plan>(`/plans/${id}`),
  updatePlan: (id: string, patch: Partial<Plan>, label?: string) => patchRecord<Plan>('plan', id, patch as Record<string, unknown>, label),
  deletePlan: (id: string) => deleteRecord('plan', id),
  /** Plan images are cached by the service worker; plans added offline show the local file. */
  planImageUrl: (id: string) => pendingPlanImage(id) ?? `/api/plans/${id}/image`,
  detect: (id: string, body: { regions?: Polygon[]; excludes?: Polygon[]; params?: Partial<DetectionParams>; mode?: 'replace' | 'merge' }) =>
    onlineRequest<DetectionResult>('POST', `/plans/${id}/detect`, body, OFFLINE_DETECT),

  assets: () => cachedGet<Asset[]>('/assets'),
  validateAsset: (files: File[], paths: string[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('paths', JSON.stringify(paths));
    return onlineRequest<GltfValidationReport>('POST', '/assets/validate', fd, OFFLINE_ASSETS);
  },
  createAsset: (files: File[], paths: string[], metadata: unknown, thumbnail?: Blob | null) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('paths', JSON.stringify(paths));
    fd.append('metadata', JSON.stringify(metadata));
    if (thumbnail) fd.append('thumbnail', thumbnail, 'thumbnail.png');
    return onlineRequest<{ asset: Asset; report: GltfValidationReport }>('POST', '/assets', fd, OFFLINE_ASSETS);
  },
  updateAsset: (id: string, patch: Partial<Asset>) => onlineRequest<Asset>('PATCH', `/assets/${id}`, patch, OFFLINE_ASSETS),
  deleteAsset: (id: string) => onlineRequest<void>('DELETE', `/assets/${id}`, undefined, OFFLINE_ASSETS),
  assetFileUrl: (a: Asset, name = a.mainFile) => `/api/assets/${a.id}/files/${name.split('/').map(encodeURIComponent).join('/')}`,
  assetThumbUrl: (a: Asset) => (a.thumbnailKey ? `/api/assets/${a.id}/thumbnail?v=${encodeURIComponent(a.updatedAt)}` : null),

  kits: () => cachedGet<Kit[]>('/kits'),
  createKit: (k: Partial<Kit>) => onlineRequest<Kit>('POST', '/kits', k, 'Creating a kit needs a connection to the server.'),
  updateKit: (id: string, k: Partial<Kit>) => patchRecord<Kit>('kit', id, k as Record<string, unknown>, `kit "${k.name ?? ''}"`),
  deleteKit: (id: string) => onlineRequest<void>('DELETE', `/kits/${id}`, undefined, 'Deleting a kit needs a connection to the server.'),

  systemStatus: () => onlineRequest<SystemStatus>('GET', '/system/status', undefined, 'The server cannot be reached from this device right now.'),
};
