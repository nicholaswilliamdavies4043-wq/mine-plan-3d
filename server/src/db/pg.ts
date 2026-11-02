import pg from 'pg';
import { config } from '../config';

export interface PgInfo {
  host: string;
  database: string;
  user: string;
  port: number;
  ssl: boolean;
}

/** Host, database and user of a connection string (never the password). */
export const usingSsl = () => !sslRefused && (() => { try { return wantsSsl(new URL(config.databaseUrl)); } catch { return false; } })();

export function describeUrl(url: string): PgInfo {
  try {
    const u = new URL(url);
    return {
      host: u.hostname, database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
      user: decodeURIComponent(u.username), port: Number(u.port || 5432), ssl: wantsSsl(u),
    };
  } catch {
    return { host: '(invalid DATABASE_URL)', database: '', user: '', port: 0, ssl: false };
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function wantsSsl(u: URL): boolean {
  if (config.databaseSsl === 'true') return true;
  if (config.databaseSsl === 'false') return false;
  const mode = u.searchParams.get('sslmode');
  if (mode) return mode !== 'disable';
  // Render external URLs (…render.com) need TLS. Internal Render hosts (dpg-…-a) and local servers do not.
  return /\.render\.com$/i.test(u.hostname) || (!LOCAL_HOSTS.has(u.hostname) && u.hostname.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname));
}

let pool: pg.Pool | null = null;
/** Set when a server refused TLS, so the next pool connects without it. */
let sslRefused = false;

/** Shared connection pool for DATABASE_URL. */
export function getPool(): pg.Pool {
  if (pool) return pool;
  const u = new URL(config.databaseUrl);
  const ssl = wantsSsl(u) && !sslRefused;
  // sslmode in the URL would override the ssl option below; strip it and decide here.
  u.searchParams.delete('sslmode');
  pool = new pg.Pool({
    connectionString: u.toString(),
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  // an idle client losing its connection must not crash the server
  pool.on('error', (e) => console.warn('[db] idle connection error:', e.message));
  return pool;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mp_docs (
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS mp_docs_project ON mp_docs ((data->>'projectId')) WHERE collection = 'plans';
CREATE TABLE IF NOT EXISTS mp_blobs (
  key text PRIMARY KEY,
  content_type text NOT NULL,
  size integer NOT NULL,
  data bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

let schemaReady: Promise<void> | null = null;

/**
 * Create the tables on first use (idempotent). Start-up retries while the database boots;
 * requests try once so that they fail fast (503) while the database is down.
 */
export function ensureSchema(attempts = 1): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      let delay = 1000;
      for (let attempt = 1; ; attempt++) {
        try {
          await getPool().query(SCHEMA_SQL);
          return;
        } catch (e: any) {
          if (/does not support SSL/i.test(e.message) && !sslRefused) {
            sslRefused = true;
            const old = pool;
            pool = null;
            old?.end().catch(() => {});
            continue;
          }
          if (attempt >= attempts) { schemaReady = null; throw e; }
          console.warn(`[db] cannot reach PostgreSQL (${e.message}); retrying in ${delay / 1000}s`);
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 10000);
        }
      }
    })();
  }
  return schemaReady;
}
