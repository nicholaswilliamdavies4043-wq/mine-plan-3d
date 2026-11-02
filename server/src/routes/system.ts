import { Router } from 'express';
import os from 'node:os';
import type { SystemStatus } from '@mineplan/shared';
import { config } from '../config';
import type { Store } from '../store';
import type { ObjectStorage } from '../storage';
import { ah } from './util';
import { keepAliveStatus } from '../keepAlive';

const startedAt = new Date().toISOString();

export function systemRoutes(store: Store, storage: ObjectStorage): Router {
  const r = Router();

  /** Cheap liveness check, also used by clients to detect that the server is reachable again. */
  r.get('/health', ah(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, store: store.kind, storage: config.storage, version: config.version });
  }));

  /** Data source and storage status for the "Data source" page. */
  r.get('/system/status', ah(async (_req, res) => {
    const [dataSource, files] = await Promise.all([store.status(), storage.status()]);
    const warnings: string[] = [];
    if (store.kind === 'file' && (process.env.RENDER || process.env.DYNO)) {
      warnings.push('This server stores data in a JSON file on its own disk, which the host wipes on every deploy. Attach a PostgreSQL database and set DATABASE_URL to keep your data.');
    }
    if (!files.persistent) warnings.push('Plan images and 3D asset files are on the server disk, which the host wipes on every deploy. Use STORAGE_DRIVER=postgres or s3.');
    if (!dataSource.connected) warnings.push('The server cannot reach the database. Changes are kept on each device and are sent when it is back.');
    const out: SystemStatus = {
      ok: dataSource.connected, version: config.version, startedAt, serverTime: new Date().toISOString(),
      host: process.env.RENDER_SERVICE_NAME || os.hostname(), dataSource, storage: files, keepAlive: keepAliveStatus(), warnings,
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(out);
  }));

  return r;
}
