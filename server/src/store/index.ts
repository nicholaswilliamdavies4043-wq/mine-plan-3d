import fs from 'node:fs';
import path from 'node:path';
import type { Asset, DataSourceStatus, Kit, Plan, Project } from '@mineplan/shared';
import { config } from '../config';
import { describeUrl, ensureSchema, getPool, usingSsl } from '../db/pg';

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
  kind: 'file' | 'prisma' | 'postgres';
  /** Connection state for the data source page. */
  status(): Promise<DataSourceStatus>;
}

// ---------------------------------------------------------------------------
// File store: JSON document on disk. Zero setup, single process. Good for local use and demos.
// ---------------------------------------------------------------------------

type Collections = { projects: Project[]; plans: Plan[]; assets: Asset[]; kits: Kit[] };

class FileDb {
  data: Collections = { projects: [], plans: [], assets: [], kits: [] };
  lastSavedAt: string | null = null;
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
    this.lastSavedAt = new Date().toISOString();
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
  const file = path.join(config.dataDir, 'db.json');
  return {
    kind: 'file',
    async status() {
      let last = db.lastSavedAt;
      if (!last && fs.existsSync(file)) last = fs.statSync(file).mtime.toISOString();
      return {
        kind: 'file', label: 'JSON file', connected: true, message: 'Working normally',
        configuredBy: 'No DATABASE_URL set, so the server uses a JSON file', location: file, lastSavedAt: last,
        counts: Object.fromEntries(Object.entries(db.data).map(([k, v]) => [k, (v as unknown[]).length])),
      };
    },
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
  const info = describeUrl(config.databaseUrl);
  return {
    kind: 'prisma',
    async status() {
      const t0 = Date.now();
      try {
        await prisma.$queryRawUnsafe('SELECT 1');
        return { kind: 'prisma', label: 'PostgreSQL (Prisma)', connected: true, message: 'Working normally', database: info.database, host: info.host, configuredBy: 'DATABASE_URL', location: 'PostgreSQL', latencyMs: Date.now() - t0 };
      } catch (e: any) {
        return { kind: 'prisma', label: 'PostgreSQL (Prisma)', connected: false, message: e.message, database: info.database, host: info.host, configuredBy: 'DATABASE_URL', location: 'PostgreSQL' };
      }
    },
    projects: new PrismaRepo<Project>(prisma.project),
    plans: new PrismaRepo<Plan>(prisma.plan),
    assets: new PrismaRepo<Asset>(prisma.asset),
    kits: new PrismaRepo<Kit>(prisma.kit),
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL store (node-postgres). One JSONB document per record; the tables are created on
// start-up, so attaching a database and setting DATABASE_URL is all that is needed.
// ---------------------------------------------------------------------------

/** Errors that mean the database cannot be reached (answered with 503 so clients retry later). */
export function isDbUnavailable(e: any): boolean {
  const code = e?.code as string | undefined;
  if (code && ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', '57P01', '57P03', '08000', '08001', '08003', '08006'].includes(code)) return true;
  return /Connection terminated|connection timeout|timeout exceeded when trying to connect/i.test(e?.message ?? '');
}

class PgRepo<T extends { id: string; createdAt?: string }> implements Repo<T> {
  constructor(private collection: string, private onWrite: () => void) {}
  private async q(sql: string, params: unknown[]) {
    await ensureSchema();
    return getPool().query(sql, params);
  }
  async list(filter?: Partial<T>) {
    const where = ['collection = $1'];
    const params: unknown[] = [this.collection];
    for (const [k, v] of Object.entries(filter ?? {})) {
      if (v === undefined) continue;
      // keys come from code, not from requests; inline them so the projectId index is used
      if (typeof v === 'string' && /^\w+$/.test(k)) { params.push(v); where.push(`data->>'${k}' = $${params.length}`); }
      else { params.push(JSON.stringify({ [k]: v })); where.push(`data @> $${params.length}::jsonb`); }
    }
    const r = await this.q(`SELECT data FROM mp_docs WHERE ${where.join(' AND ')} ORDER BY created_at, id`, params);
    return r.rows.map((x) => x.data as T);
  }
  async get(id: string) {
    const r = await this.q('SELECT data FROM mp_docs WHERE collection = $1 AND id = $2', [this.collection, id]);
    return (r.rows[0]?.data as T) ?? null;
  }
  async create(item: T) {
    const created = item.createdAt && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : new Date().toISOString();
    await this.q('INSERT INTO mp_docs (collection, id, data, created_at) VALUES ($1, $2, $3::jsonb, $4)', [this.collection, item.id, JSON.stringify(item), created]);
    this.onWrite();
    return item;
  }
  async update(id: string, patch: Partial<T>) {
    const p = { ...patch, id, updatedAt: new Date().toISOString() };
    // jsonb || merges the top-level keys, the same semantics as the file store's object spread
    const r = await this.q(
      'UPDATE mp_docs SET data = data || $3::jsonb, updated_at = now() WHERE collection = $1 AND id = $2 RETURNING data',
      [this.collection, id, JSON.stringify(p)],
    );
    if (!r.rowCount) return null;
    this.onWrite();
    return r.rows[0].data as T;
  }
  async delete(id: string) {
    await this.q('DELETE FROM mp_docs WHERE collection = $1 AND id = $2', [this.collection, id]);
    this.onWrite();
  }
}

async function createPostgresStore(): Promise<Store> {
  if (!config.databaseUrl) throw new Error('DATA_STORE=postgres requires DATABASE_URL');
  const info = describeUrl(config.databaseUrl);
  let lastWrite: string | null = null;
  const onWrite = () => { lastWrite = new Date().toISOString(); };
  try {
    await ensureSchema(6);
    console.log(`[db] connected to PostgreSQL ${info.database} @ ${info.host}${usingSsl() ? ' (TLS)' : ''}`);
  } catch (e: any) {
    // start anyway: the data source page shows the error and requests answer 503 until it is back
    console.error(`[db] PostgreSQL ${info.database} @ ${info.host} is not reachable: ${e.message}`);
  }
  return {
    kind: 'postgres',
    async status() {
      const base = {
        kind: 'postgres', label: 'PostgreSQL', database: info.database, host: info.host,
        configuredBy: 'DATABASE_URL', location: 'PostgreSQL',
      };
      const t0 = Date.now();
      try {
        await ensureSchema();
        const pool = getPool();
        const v = await pool.query("SELECT current_setting('server_version') AS v");
        const latencyMs = Date.now() - t0;
        const counts = await pool.query('SELECT collection, count(*)::int AS n FROM mp_docs GROUP BY collection');
        const blobs = await pool.query('SELECT count(*)::int AS n FROM mp_blobs');
        const last = await pool.query('SELECT GREATEST((SELECT max(updated_at) FROM mp_docs), (SELECT max(updated_at) FROM mp_blobs)) AS t');
        const c: Record<string, number> = { projects: 0, plans: 0, assets: 0, kits: 0 };
        for (const row of counts.rows) c[row.collection] = row.n;
        c.files = blobs.rows[0].n;
        const t = last.rows[0].t as Date | null;
        return {
          ...base, connected: true, message: 'Working normally', latencyMs, serverVersion: v.rows[0].v,
          lastSavedAt: t ? t.toISOString() : lastWrite, counts: c,
        };
      } catch (e: any) {
        return { ...base, connected: false, message: e.message || 'Cannot connect', lastSavedAt: lastWrite };
      }
    },
    projects: new PgRepo<Project>('projects', onWrite),
    plans: new PgRepo<Plan>('plans', onWrite),
    assets: new PgRepo<Asset>('assets', onWrite),
    kits: new PgRepo<Kit>('kits', onWrite),
  };
}

export async function createStore(): Promise<Store> {
  if (config.dataStore === 'prisma') return createPrismaStore();
  if (config.dataStore === 'postgres') return createPostgresStore();
  return createFileStore();
}
