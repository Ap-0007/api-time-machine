import { Router, Request, Response } from 'express';
import * as db from '../db';

export const requestsRouter = Router({ mergeParams: true });

requestsRouter.get('/', (req: Request, res: Response) => {
  const { url, method, status, from, to, page, limit } = req.query;
  const result = db.getRequests((req.params as any).id, {
    url: url as string | undefined,
    method: method as string | undefined,
    status: status !== undefined ? parseInt(status as string) : undefined,
    from: from !== undefined ? parseInt(from as string) : undefined,
    to: to !== undefined ? parseInt(to as string) : undefined,
    page: page !== undefined ? parseInt(page as string) : 0,
    limit: limit !== undefined ? Math.min(parseInt(limit as string), 500) : 200,
  });
  res.json(result);
});

requestsRouter.get('/:reqId', (req: Request, res: Response) => {
  const full = db.getRequest((req.params as any).id, req.params.reqId);
  if (!full) return void res.status(404).json({ error: 'Not found' });
  res.json(full);
});
