import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';

/** Persistent object storage for uploaded plans and 3D assets. */
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  deletePrefix(prefix: string): Promise<void>;
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
}

export function createStorage(): ObjectStorage {
  if (config.storage === 's3') {
    if (!config.s3.bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    return new S3Storage(config.s3);
  }
  return new LocalDiskStorage(path.join(config.dataDir, 'storage'));
}
