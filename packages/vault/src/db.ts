import { DatabaseSync, StatementSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'zlib';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { RequestPayload, SessionMeta, SnapshotMap } from '@atm/shared';

const DB_DIR = path.join(os.homedir(), '.api-time-machine');
const DB_PATH = path.join(DB_DIR, 'vault.db');
const COMPRESS_THRESHOLD = 500 * 1024;

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    tab_url TEXT,
    state TEXT NOT NULL DEFAULT 'recording',
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    request_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    method TEXT NOT NULL,
    request_headers TEXT,
    request_body TEXT,
    status INTEGER,
    response_headers TEXT,
    response_body BLOB,
    response_compressed INTEGER DEFAULT 0,
    duration INTEGER,
    timestamp INTEGER NOT NULL,
    streaming INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
  CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(session_id, timestamp);
`);

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): SessionMeta {
  return {
    id: row.id as string,
    name: row.name as string,
    tabUrl: row.tab_url as string,
    state: row.state as SessionMeta['state'],
    startedAt: row.started_at as number,
    endedAt: (row.ended_at ?? null) as number | null,
    requestCount: row.request_count as number,
  };
}

function decodeBody(data: unknown, compressed: unknown): string {
  if (data === null || data === undefined) return '';
  if (compressed) {
    const buf = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data as string, 'binary');
    return gunzipSync(buf).toString('utf8');
  }
  if (data instanceof Uint8Array) return Buffer.from(data).toString('utf8');
  return typeof data === 'string' ? data : String(data);
}

function encodeBody(body: string): { data: Buffer | string; compressed: 0 | 1 } {
  if (Buffer.byteLength(body, 'utf8') > COMPRESS_THRESHOLD) {
    return { data: gzipSync(Buffer.from(body, 'utf8')), compressed: 1 };
  }
  return { data: body, compressed: 0 };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function createSession(params: { id: string; name: string; tabUrl: string }): SessionMeta {
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, name, tab_url, state, started_at, request_count)
     VALUES (?, ?, ?, 'recording', ?, 0)`
  ).run(params.id, params.name, params.tabUrl, now);
  return { id: params.id, name: params.name, tabUrl: params.tabUrl, state: 'recording', startedAt: now, endedAt: null, requestCount: 0 };
}

export function listSessions(page = 0, limit = 50): { sessions: SessionMeta[]; total: number } {
  const offset = page * limit;
  const { count } = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
  const rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?').all(limit, offset) as Record<string, unknown>[];
  return { sessions: rows.map(rowToSession), total: count };
}

export function getSession(id: string): SessionMeta | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function updateSession(id: string, updates: { name?: string; state?: string }): SessionMeta | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.state !== undefined) {
    sets.push('state = ?');
    values.push(updates.state);
    if (updates.state === 'completed') { sets.push('ended_at = ?'); values.push(Date.now()); }
  }
  if (sets.length === 0) return getSession(id);
  values.push(id);
  (db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`) as any).run(...values);
  return getSession(id);
}

export function deleteSession(id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// ─── Requests ────────────────────────────────────────────────────────────────

export interface RequestListItem extends Omit<RequestPayload, 'responseBody'> {
  responseSize: number;
}

export function insertRequest(sessionId: string, req: RequestPayload): void {
  const { data, compressed } = encodeBody(req.responseBody);
  db.prepare(`
    INSERT OR REPLACE INTO requests
      (id, session_id, url, method, request_headers, request_body,
       status, response_headers, response_body, response_compressed,
       duration, timestamp, streaming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.id, sessionId, req.url, req.method,
    JSON.stringify(req.requestHeaders), req.requestBody,
    req.status, JSON.stringify(req.responseHeaders),
    data, compressed, req.duration, req.timestamp, req.streaming ? 1 : 0
  );
  db.prepare('UPDATE sessions SET request_count = request_count + 1 WHERE id = ?').run(sessionId);
}

export function batchInsertRequests(sessionId: string, requests: RequestPayload[]): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO requests
      (id, session_id, url, method, request_headers, request_body,
       status, response_headers, response_body, response_compressed,
       duration, timestamp, streaming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // node:sqlite doesn't expose .transaction(); use explicit BEGIN/COMMIT
  db.exec('BEGIN');
  try {
    for (const req of requests) {
      const { data, compressed } = encodeBody(req.responseBody);
      insert.run(
        req.id, sessionId, req.url, req.method,
        JSON.stringify(req.requestHeaders), req.requestBody,
        req.status, JSON.stringify(req.responseHeaders),
        data, compressed, req.duration, req.timestamp, req.streaming ? 1 : 0
      );
    }
    db.prepare('UPDATE sessions SET request_count = request_count + ? WHERE id = ?').run(requests.length, sessionId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function endSession(sessionId: string): void {
  db.prepare("UPDATE sessions SET state = 'completed', ended_at = ? WHERE id = ?").run(Date.now(), sessionId);
}

export function getRequests(
  sessionId: string,
  filters: { url?: string; method?: string; status?: number; from?: number; to?: number; page?: number; limit?: number }
): { requests: (RequestListItem)[]; total: number } {
  const conds = ['session_id = ?'];
  const params: (string | number | null)[] = [sessionId];
  if (filters.url) { conds.push('url LIKE ?'); params.push(`%${filters.url}%`); }
  if (filters.method) { conds.push('method = ?'); params.push(filters.method.toUpperCase()); }
  if (filters.status !== undefined) { conds.push('status = ?'); params.push(filters.status); }
  if (filters.from !== undefined) { conds.push('timestamp >= ?'); params.push(filters.from); }
  if (filters.to !== undefined) { conds.push('timestamp <= ?'); params.push(filters.to); }
  const where = conds.join(' AND ');
  const page = filters.page ?? 0;
  const limit = Math.min(filters.limit ?? 200, 500);
  const offset = page * limit;
  const { count } = (db.prepare(`SELECT COUNT(*) as count FROM requests WHERE ${where}`) as any).get(...params) as { count: number };
  const rows = (db.prepare(
    `SELECT id, session_id, url, method, request_headers, request_body, status,
            response_headers, response_compressed, duration, timestamp, streaming,
            LENGTH(response_body) as response_size
     FROM requests WHERE ${where} ORDER BY timestamp ASC LIMIT ? OFFSET ?`
  ) as any).all(...params, limit, offset) as Record<string, unknown>[];
  return {
    requests: rows.map(r => ({
      id: r.id as string,
      url: r.url as string,
      method: r.method as string,
      requestHeaders: JSON.parse((r.request_headers as string) || '{}'),
      requestBody: (r.request_body as string | null),
      status: r.status as number,
      responseHeaders: JSON.parse((r.response_headers as string) || '{}'),
      duration: r.duration as number,
      timestamp: r.timestamp as number,
      streaming: !!(r.streaming),
      responseSize: (r.response_size as number) ?? 0,
    })),
    total: count,
  };
}

export function getRequest(sessionId: string, requestId: string): RequestPayload | null {
  const row = db.prepare('SELECT * FROM requests WHERE id = ? AND session_id = ?').get(requestId, sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    url: row.url as string,
    method: row.method as string,
    requestHeaders: JSON.parse((row.request_headers as string) || '{}'),
    requestBody: (row.request_body as string | null),
    status: row.status as number,
    responseHeaders: JSON.parse((row.response_headers as string) || '{}'),
    responseBody: decodeBody(row.response_body, row.response_compressed),
    duration: row.duration as number,
    timestamp: row.timestamp as number,
    streaming: !!(row.streaming),
  };
}

export function getSnapshot(sessionId: string, timestamp: number): SnapshotMap {
  const rows = db.prepare(`
    SELECT r.*
    FROM requests r
    INNER JOIN (
      SELECT url, MAX(timestamp) AS max_ts
      FROM requests
      WHERE session_id = ? AND timestamp <= ?
      GROUP BY url
    ) latest ON r.url = latest.url AND r.timestamp = latest.max_ts AND r.session_id = ?
  `).all(sessionId, timestamp, sessionId) as Record<string, unknown>[];
  const snapshot: SnapshotMap = {};
  for (const row of rows) {
    snapshot[row.url as string] = {
      status: row.status as number,
      headers: JSON.parse((row.response_headers as string) || '{}'),
      body: decodeBody(row.response_body, row.response_compressed),
    };
  }
  return snapshot;
}
