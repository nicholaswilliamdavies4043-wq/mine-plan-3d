import dotenv from 'dotenv';
import path from 'node:path';

const root = path.resolve(process.cwd(), path.basename(process.cwd()) === 'server' ? '..' : '.');
dotenv.config({ path: path.join(root, '.env') });

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** 'file' (JSON on disk, zero setup) or 'prisma' (PostgreSQL via Prisma). */
  dataStore: (process.env.DATA_STORE ?? (process.env.DATABASE_URL ? 'prisma' : 'file')) as 'file' | 'prisma',
  dataDir: path.resolve(root, process.env.DATA_DIR ?? 'data'),
  /** 'local' or 's3' */
  storage: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
  s3: {
    bucket: process.env.S3_BUCKET ?? '',
    region: process.env.S3_REGION ?? 'eu-north-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    prefix: process.env.S3_PREFIX ?? 'mine-plan-3d/',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },
  maxUploadMB: Number(process.env.MAX_UPLOAD_MB ?? 200),
  clientDist: path.resolve(root, 'client', 'dist'),
};
