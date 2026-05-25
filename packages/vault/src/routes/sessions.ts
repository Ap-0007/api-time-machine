import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db';
import type { ATMFile } from '@atm/shared';

export const sessionsRouter = Router();

function jsonDiff(a: unknown, b: unknown): unknown {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null) return { type: 'changed', from: a, to: b };
  if (typeof a !== 'object') return { type: 'changed', from: a, to: b };
  if (Array.isArray(a) !== Array.isArray(b)) return { type: 'changed', from: a, to: b };
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  const result: Record<string, unknown> = {};
  let hasDiff = false;
  for (const key of allKeys) {
    if (!(key in objA)) { result[key] = { type: 'added', value: objB[key] }; hasDiff = true; }
    else if (!(key in objB)) { result[key] = { type: 'removed', value: objA[key] }; hasDiff = true; }
    else {
      const child = jsonDiff(objA[key], objB[key]);
      if (child !== null) { result[key] = child; hasDiff = true; }
    }
  }
  return hasDiff ? result : null;
}

sessionsRouter.post('/import', (req: Request, res: Response) => {
  const atm = req.body as ATMFile;
  if (!atm || atm.version !== '1.0') return void res.status(400).json({ error: 'Invalid .atm file' });
  const newId = uuidv4();
  db.createSession({ id: newId, name: `[Imported] ${atm.session.name}`, tabUrl: atm.session.tabUrl });
  const remapped = atm.requests.map(r => ({ ...r, id: uuidv4() }));
  db.batchInsertRequests(newId, remapped);
  db.updateSession(newId, { state: 'completed' });
  res.status(201).json({ id: newId });
});

sessionsRouter.post('/', (req: Request, res: Response) => {
  const { name, tabUrl } = req.body;
  const id = uuidv4();
  const session = db.createSession({ id, name: name || `Session ${new Date().toLocaleString()}`, tabUrl: tabUrl || '' });
  res.status(201).json(session);
});

sessionsRouter.get('/', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 0;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  res.json(db.listSessions(page, limit));
});

sessionsRouter.get('/:id/snapshot', (req: Request, res: Response) => {
  const session = db.getSession(req.params.id);
  if (!session) return void res.status(404).json({ error: 'Not found' });
  const ts = parseInt(req.query.timestamp as string) || Date.now();
  res.json(db.getSnapshot(req.params.id, ts));
});

sessionsRouter.get('/:id/export', (req: Request, res: Response) => {
  const session = db.getSession(req.params.id);
  if (!session) return void res.status(404).json({ error: 'Not found' });
  const { requests: meta } = db.getRequests(req.params.id, { limit: 10000 });
  const full = meta.map(r => db.getRequest(req.params.id, r.id)).filter(Boolean);
  const atm: ATMFile = { version: '1.0', exportedAt: Date.now(), session, requests: full as any };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.id}.atm"`);
  res.json(atm);
});

sessionsRouter.get('/:id/diff/:otherId', (req: Request, res: Response) => {
  const sessionA = db.getSession(req.params.id);
  const sessionB = db.getSession(req.params.otherId);
  if (!sessionA || !sessionB) return void res.status(404).json({ error: 'Session not found' });

  const { requests: metaA } = db.getRequests(req.params.id, { limit: 10000 });
  const { requests: metaB } = db.getRequests(req.params.otherId, { limit: 10000 });

  const mapA = new Map<string, { status: number; body: unknown }>();
  const mapB = new Map<string, { status: number; body: unknown }>();

  for (const r of metaA) {
    const full = db.getRequest(req.params.id, r.id);
    if (!full) continue;
    let body: unknown = full.responseBody;
    try { body = JSON.parse(full.responseBody); } catch {}
    mapA.set(r.url, { status: full.status, body });
  }
  for (const r of metaB) {
    const full = db.getRequest(req.params.otherId, r.id);
    if (!full) continue;
    let body: unknown = full.responseBody;
    try { body = JSON.parse(full.responseBody); } catch {}
    mapB.set(r.url, { status: full.status, body });
  }

  const allUrls = new Set([...mapA.keys(), ...mapB.keys()]);
  const diffs: unknown[] = [];

  for (const url of allUrls) {
    const a = mapA.get(url);
    const b = mapB.get(url);
    if (!a) { diffs.push({ url, type: 'added' }); }
    else if (!b) { diffs.push({ url, type: 'removed' }); }
    else {
      const changes = jsonDiff(a.body, b.body);
      const statusChanged = a.status !== b.status;
      if (changes !== null || statusChanged) {
        diffs.push({ url, type: 'changed', statusA: a.status, statusB: b.status, changes });
      }
    }
  }

  res.json({ diffs });
});

sessionsRouter.get('/:id', (req: Request, res: Response) => {
  const session = db.getSession(req.params.id);
  if (!session) return void res.status(404).json({ error: 'Not found' });
  res.json(session);
});

sessionsRouter.patch('/:id', (req: Request, res: Response) => {
  const { name, state } = req.body;
  const session = db.updateSession(req.params.id, { name, state });
  if (!session) return void res.status(404).json({ error: 'Not found' });
  res.json(session);
});

sessionsRouter.delete('/:id', (req: Request, res: Response) => {
  if (!db.getSession(req.params.id)) return void res.status(404).json({ error: 'Not found' });
  db.deleteSession(req.params.id);
  res.status(204).end();
});
