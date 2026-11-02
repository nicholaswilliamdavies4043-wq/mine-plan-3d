import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileStorageStatus } from '@mineplan/shared';
import { config } from '../config';
import { ensureSchema, getPool } from '../db/pg';

/** Persistent object storage for uploaded plans and 3D assets. */
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  deletePrefix(prefix: string): Promise<void>;
  status(): Promise<FileStorageStatus>;
}

const safeKey = (key: string) => {
  const norm = path.posix.normalize(key.replace(/\\/g, '/'));
  if (norm.startsWith('..') || path.posix.isAbsolute(norm)) throw new Error('Invalid storage key');
  return norm;
};

export class LocalDiskStorage implements ObjectStorage {
  constructor(private dir: string) {}

  private file(key: string) {
    return path.join(this.dir, ...safeKey(key).split('/'));
  }

  async put(key: string, data: Buffer, contentType: string) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
    await fs.writeFile(f + '.meta', JSON.stringify({ contentType }));
  }

  async get(key: string) {
    const f = this.file(key);
    try {
      const data = await fs.readFile(f);
      let contentType = 'application/octet-stream';
      try {
        contentType = JSON.parse(await fs.readFile(f + '.meta', 'utf8')).contentType;
      } catch { /* no meta */ }
      return { data, contentType };
    } catch {
      return null;
    }
  }

  async deletePrefix(prefix: string) {
    await fs.rm(this.file(prefix), { recursive: true, force: true });
  }

  async status(): Promise<FileStorageStatus> {
    let objects = 0, bytes = 0;
    const walk = async (d: string) => {
      let list: import('node:fs').Dirent[] = [];
      try { list = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) await walk(f);
        else if (!e.name.endsWith('.meta')) { objects++; bytes += (await fs.stat(f)).size; }
      }
    };
    await walk(this.dir);
    // Render, Heroku and similar hosts wipe the local disk on every deploy unless a disk is mounted
    const ephemeralHost = !!(process.env.RENDER || process.env.DYNO);
    return { kind: 'local', label: 'Server disk', location: this.dir, persistent: !ephemeralHost, objects, bytes };
  }
}

/** Plan images and 3D asset files stored in PostgreSQL, so they survive redeploys with the data. */
export class PgBlobStorage implements ObjectStorage {
  private async q(sql: string, params: unknown[]) {
    await ensureSchema();
    return getPool().query(sql, params);
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.q(
      `INSERT INTO mp_blobs (key, content_type, size, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET content_type = EXCLUDED.content_type, size = EXCLUDED.size, data = EXCLUDED.data, updated_at = now()`,
      [safeKey(key), contentType, data.length, data],
    );
  }
  async get(key: string) {
    const r = await this.q('SELECT content_type, data FROM mp_blobs WHERE key = $1', [safeKey(key)]);
    if (!r.rowCount) return null;
    return { data: r.rows[0].data as Buffer, contentType: r.rows[0].content_type as string };
  }
  async deletePrefix(prefix: string) {
    const k = safeKey(prefix).replace(/\/+$/, '');
    const like = k.replace(/[\\%_]/g, (c) => '\\' + c) + '/%';
    await this.q('DELETE FROM mp_blobs WHERE key = $1 OR key LIKE $2', [k, like]);
  }
  async status(): Promise<FileStorageStatus> {
    try {
      const r = await this.q('SELECT count(*)::int AS n, COALESCE(sum(size), 0)::bigint AS b FROM mp_blobs', []);
      return { kind: 'postgres', label: 'PostgreSQL', location: 'mp_blobs table', persistent: true, objects: r.rows[0].n, bytes: Number(r.rows[0].b) };
    } catch {
      return { kind: 'postgres', label: 'PostgreSQL', location: 'mp_blobs table', persistent: true };
    }
  }
}

export class S3Storage implements ObjectStorage {
  private clientPromise: Promise<any>;
  constructor(private opts: typeof config.s3) {
    this.clientPromise = import('@aws-sdk/client-s3').then((m) => ({
      m,
      c: new m.S3Client({ region: opts.region, endpoint: opts.endpoint, forcePathStyle: opts.forcePathStyle }),
    }));
  }
  private k(key: string) {
    return this.opts.prefix + safeKey(key);
  }
  async put(key: string, data: Buffer, contentType: string) {
    const { m, c } = await this.clientPromise;
    await c.send(new m.PutObjectCommand({ Bucket: this.opts.bucket, Key: this.k(key), Body: data, ContentType: contentType }));
  }
  async get(key: string) {
    const { m, c } = await this.clientPromise;
    try {
      const r = await c.send(new m.GetObjectCommand({ Bucket: this.opts.bucket, Key: this.k(key) }));
      const data = Buffer.from(await r.Body.transformToByteArray());
      return { data, contentType: r.ContentType ?? 'application/octet-stream' };
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  async deletePrefix(prefix: string) {
    const { m, c } = await this.clientPromise;
    let token: string | undefined;
    do {
      const list = await c.send(new m.ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: this.k(prefix), ContinuationToken: token }));
      const objs = (list.Contents ?? []).map((o: any) => ({ Key: o.Key }));
      if (objs.length) await c.send(new m.DeleteObjectsCommand({ Bucket: this.opts.bucket, Delete: { Objects: objs } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
  async status(): Promise<FileStorageStatus> {
    return { kind: 's3', label: 'S3 object storage', location: `${this.opts.bucket}/${this.opts.prefix}`, persistent: true };
  }
}

export function createStorage(): ObjectStorage {
  if (config.storage === 's3') {
    if (!config.s3.bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    return new S3Storage(config.s3);
  }
  if (config.storage === 'postgres') {
    if (!config.databaseUrl) throw new Error('STORAGE_DRIVER=postgres requires DATABASE_URL');
    return new PgBlobStorage();
  }
  return new LocalDiskStorage(path.join(config.dataDir, 'storage'));
}
