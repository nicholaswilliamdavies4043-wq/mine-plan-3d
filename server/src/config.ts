import dotenv from 'dotenv';
import path from 'node:path';

const root = path.resolve(process.cwd(), path.basename(process.cwd()) === 'server' ? '..' : '.');
dotenv.config({ path: path.join(root, '.env') });

/** Render, Heroku and most hosts provide DATABASE_URL when a PostgreSQL database is attached. */
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const dataStore = (process.env.DATA_STORE || (databaseUrl ? 'postgres' : 'file')) as 'file' | 'postgres' | 'prisma';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /**
   * 'file' (JSON on disk, zero setup), 'postgres' (PostgreSQL through node-postgres, tables are
   * created automatically) or 'prisma' (PostgreSQL through Prisma, needs generate + migrate).
   */
  dataStore,
  databaseUrl,
  /** 'true' forces TLS, 'false' disables it; unset = automatic (on for remote hosts that ask for it). */
  databaseSsl: process.env.DATABASE_SSL as 'true' | 'false' | undefined,
  dataDir: path.resolve(root, process.env.DATA_DIR ?? 'data'),
  /** 'local', 's3' or 'postgres' (files kept in the database, so they survive redeploys). */
  storage: (process.env.STORAGE_DRIVER || (dataStore === 'postgres' ? 'postgres' : 'local')) as 'local' | 's3' | 'postgres',
  s3: {
    bucket: process.env.S3_BUCKET ?? '',
    region: process.env.S3_REGION ?? 'eu-north-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    prefix: process.env.S3_PREFIX ?? 'mine-plan-3d/',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },
  maxUploadMB: Number(process.env.MAX_UPLOAD_MB ?? 200),
  clientDist: path.resolve(root, 'client', 'dist'),
  version: process.env.npm_package_version || process.env.RENDER_GIT_COMMIT?.slice(0, 7) || '0.2.0',
};
