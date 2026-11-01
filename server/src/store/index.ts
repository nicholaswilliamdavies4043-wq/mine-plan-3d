import fs from 'node:fs';
import path from 'node:path';
import type { Asset, Kit, Plan, Project } from '@mineplan/shared';
import { config } from '../config';

export interface Repo<T extends { id: string }> {
  list(filter?: Partial<T>): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(item: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<void>;
}

export interface Store {
  projects: Repo<Project>;
  plans: Repo<Plan>;
  assets: Repo<Asset>;
  kits: Repo<Kit>;
  kind: 'file' | 'prisma';
}

// ---------------------------------------------------------------------------
// File store: JSON document on disk. Zero setup, single process. Good for local use and demos.
// ---------------------------------------------------------------------------

type Collections = { projects: Project[]; plans: Plan[]; assets: Asset[]; kits: Kit[] };

class FileDb {
  data: Collections = { projects: [], plans: [], assets: [], kits: [] };
  private timer: NodeJS.Timeout | null = null;
  constructor(private file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = { ...this.data, ...this.read() };
  }
  /** Load the database; an empty or damaged file (e.g. the process was killed mid-write) never stops start-up. */
  private read(): Partial<Collections> {
    for (const f of [this.file, this.file + '.tmp']) {
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (!text.trim()) continue;
      try {
        return JSON.parse(text);
      } catch {
        const backup = `${f}.corrupt-${Date.now()}`;
        fs.copyFileSync(f, backup);
        console.warn(`[store] ${f} could not be parsed; kept a copy at ${backup} and continued.`);
      }
    }
    return {};
  }
  private write() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, 50);
  }
  flush() {
    if (!this.timer) return; // nothing pending
    clearTimeout(this.timer);
    this.timer = null;
    this.write();
  }
}

class FileRepo<T extends { id: string; updatedAt?: string }> implements Repo<T> {
  constructor(private db: FileDb, private name: keyof Collections) {}
  private get rows(): T[] {
    return this.db.data[this.name] as unknown as T[];
  }
  async list(filter?: Partial<T>) {
    const rows = this.rows.filter((r) => !filter || Object.entries(filter).every(([k, v]) => (r as any)[k] === v));
    return structuredClone(rows);
  }
  async get(id: string) {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async create(item: T) {
    this.rows.push(structuredClone(item));
    this.db.save();
    return item;
  }
  async update(id: string, patch: Partial<T>) {
    const i = this.rows.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const next = { ...this.rows[i], ...structuredClone(patch), id, updatedAt: new Date().toISOString() } as T;
    this.rows[i] = next;
    this.db.save();
    return structuredClone(next);
  }
  async delete(id: string) {
    const rows = this.rows;
    const i = rows.findIndex((x) => x.id === id);
    if (i >= 0) rows.splice(i, 1);
    this.db.save();
  }
}

function createFileStore(): Store {
  const db = new FileDb(path.join(config.dataDir, 'db.json'));
  process.on('exit', () => db.flush());
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { db.flush(); process.exit(0); });
  return {
    kind: 'file',
    projects: new FileRepo<Project>(db, 'projects'),
    plans: new FileRepo<Plan>(db, 'plans'),
    assets: new FileRepo<Asset>(db, 'assets'),
    kits: new FileRepo<Kit>(db, 'kits'),
  };
}

// ---------------------------------------------------------------------------
// Prisma store: PostgreSQL. Nested structures are stored in Json columns.
// ---------------------------------------------------------------------------

const toIso = (row: any) => {
  if (!row) return row;
  const out: any = { ...row };
  for (const k of ['createdAt', 'updatedAt']) if (out[k] instanceof Date) out[k] = out[k].toISOString();
  for (const k of Object.keys(out)) if (out[k] === null && k !== 'kitId' && k !== 'thumbnailKey' && k !== 'lastDetection') delete out[k];
  return out;
};
const fromIso = (row: any) => {
  const out: any = { ...row };
  for (const k of ['createdAt', 'updatedAt']) if (typeof out[k] === 'string') out[k] = new Date(out[k]);
  delete out.updatedAt; // managed by @updatedAt
  return out;
};

class PrismaRepo<T extends { id: string }> implements Repo<T> {
  constructor(private model: any) {}
  async list(filter?: Partial<T>) {
    return (await this.model.findMany({ where: filter ?? {}, orderBy: { createdAt: 'asc' } })).map(toIso);
  }
  async get(id: string) {
    return toIso(await this.model.findUnique({ where: { id } }));
  }
  async create(item: T) {
    return toIso(await this.model.create({ data: fromIso(item) }));
  }
  async update(id: string, patch: Partial<T>) {
    try {
      const data = fromIso(patch);
      delete data.id;
      delete data.createdAt;
      return toIso(await this.model.update({ where: { id }, data }));
    } catch (e: any) {
      if (e?.code === 'P2025') return null;
      throw e;
    }
  }
  async delete(id: string) {
    await this.model.deleteMany({ where: { id } });
  }
}

async function createPrismaStore(): Promise<Store> {
  let mod: any;
  try {
    mod = await import('@prisma/client');
  } catch (e) {
    throw new Error('Prisma client not available. Run `npm run prisma:generate -w server` (and set DATABASE_URL).');
  }
  const prisma = new mod.PrismaClient();
  await prisma.$connect();
  return {
    kind: 'prisma',
    projects: new PrismaRepo<Project>(prisma.project),
    plans: new PrismaRepo<Plan>(prisma.plan),
    assets: new PrismaRepo<Asset>(prisma.asset),
    kits: new PrismaRepo<Kit>(prisma.kit),
  };
}

export async function createStore(): Promise<Store> {
  return config.dataStore === 'prisma' ? createPrismaStore() : createFileStore();
}
