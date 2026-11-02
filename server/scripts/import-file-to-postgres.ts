/**
 * Copy the local JSON store (data/db.json) and its files (data/storage) into the PostgreSQL
 * database in DATABASE_URL. Records that already exist there are left alone, so it is safe to
 * run twice.
 *
 *   DATABASE_URL=postgresql://... npx tsx server/scripts/import-file-to-postgres.ts [data-dir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { ensureSchema, getPool } from '../src/db/pg';

const dir = path.resolve(process.argv[2] ?? config.dataDir);
if (!config.databaseUrl) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const dbFile = path.join(dir, 'db.json');
if (!fs.existsSync(dbFile)) { console.error(`No ${dbFile}`); process.exit(1); }

await ensureSchema(3);
const pool = getPool();
const data = JSON.parse(fs.readFileSync(dbFile, 'utf8')) as Record<string, { id: string; createdAt?: string }[]>;
let docs = 0, files = 0;
for (const [collection, rows] of Object.entries(data)) {
  for (const r of rows ?? []) {
    const res = await pool.query(
      'INSERT INTO mp_docs (collection, id, data, created_at) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT DO NOTHING',
      [collection, r.id, JSON.stringify(r), r.createdAt ?? new Date().toISOString()],
    );
    docs += res.rowCount ?? 0;
  }
}
const storage = path.join(dir, 'storage');
const walk = async (d: string) => {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { await walk(f); continue; }
    if (e.name.endsWith('.meta')) continue;
    const key = path.relative(storage, f).split(path.sep).join('/');
    let type = 'application/octet-stream';
    try { type = JSON.parse(fs.readFileSync(f + '.meta', 'utf8')).contentType; } catch { /* no meta */ }
    const buf = fs.readFileSync(f);
    const res = await pool.query('INSERT INTO mp_blobs (key, content_type, size, data) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [key, type, buf.length, buf]);
    files += res.rowCount ?? 0;
  }
};
await walk(storage);
console.log(`Imported ${docs} records and ${files} files into PostgreSQL.`);
await pool.end();
