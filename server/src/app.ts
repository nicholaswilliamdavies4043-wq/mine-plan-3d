import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { config } from './config';
import type { Store } from './store';
import type { ObjectStorage } from './storage';
import { projectRoutes } from './routes/projects';
import { assetRoutes } from './routes/assets';
import { HttpError } from './routes/util';

export function createApp(store: Store, storage: ObjectStorage) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, store: store.kind, storage: config.storage }));
  app.use('/api', projectRoutes(store, storage));
  app.use('/api', assetRoutes(store, storage));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built client in production
  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.get('*', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: err.issues });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (max ${config.maxUploadMB} MB)` });
    console.error(err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  });
  return app;
}
