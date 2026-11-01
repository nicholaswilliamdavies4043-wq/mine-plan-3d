import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { config } from '../config';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 200 },
});

export const now = () => new Date().toISOString();

/** Multer decodes multipart filenames as latin1; restore UTF-8 names. */
export const fixName = (name: string) => Buffer.from(name, 'latin1').toString('utf8');

export function parseJsonField<T>(value: unknown, field: string): T {
  if (typeof value !== 'string') throw new HttpError(400, `Missing field "${field}"`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new HttpError(400, `Field "${field}" is not valid JSON`);
  }
}
