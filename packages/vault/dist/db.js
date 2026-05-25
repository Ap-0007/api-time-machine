"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.createSession = createSession;
exports.listSessions = listSessions;
exports.getSession = getSession;
exports.updateSession = updateSession;
exports.deleteSession = deleteSession;
exports.insertRequest = insertRequest;
exports.batchInsertRequests = batchInsertRequests;
exports.endSession = endSession;
exports.getRequests = getRequests;
exports.getRequest = getRequest;
exports.getSnapshot = getSnapshot;
const node_sqlite_1 = require("node:sqlite");
const zlib_1 = require("zlib");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const DB_DIR = path_1.default.join(os_1.default.homedir(), '.api-time-machine');
const DB_PATH = path_1.default.join(DB_DIR, 'vault.db');
const COMPRESS_THRESHOLD = 500 * 1024;
if (!fs_1.default.existsSync(DB_DIR)) {
    fs_1.default.mkdirSync(DB_DIR, { recursive: true });
}
exports.db = new node_sqlite_1.DatabaseSync(DB_PATH);
exports.db.exec('PRAGMA journal_mode = WAL');
exports.db.exec('PRAGMA foreign_keys = ON');
exports.db.exec(`
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
function rowToSession(row) {
    return {
        id: row.id,
        name: row.name,
        tabUrl: row.tab_url,
        state: row.state,
        startedAt: row.started_at,
        endedAt: (row.ended_at ?? null),
        requestCount: row.request_count,
    };
}
function decodeBody(data, compressed) {
    if (data === null || data === undefined)
        return '';
    if (compressed) {
        const buf = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data, 'binary');
        return (0, zlib_1.gunzipSync)(buf).toString('utf8');
    }
    if (data instanceof Uint8Array)
        return Buffer.from(data).toString('utf8');
    return typeof data === 'string' ? data : String(data);
}
function encodeBody(body) {
    if (Buffer.byteLength(body, 'utf8') > COMPRESS_THRESHOLD) {
        return { data: (0, zlib_1.gzipSync)(Buffer.from(body, 'utf8')), compressed: 1 };
    }
    return { data: body, compressed: 0 };
}
// ─── Sessions ────────────────────────────────────────────────────────────────
function createSession(params) {
    const now = Date.now();
    exports.db.prepare(`INSERT INTO sessions (id, name, tab_url, state, started_at, request_count)
     VALUES (?, ?, ?, 'recording', ?, 0)`).run(params.id, params.name, params.tabUrl, now);
    return { id: params.id, name: params.name, tabUrl: params.tabUrl, state: 'recording', startedAt: now, endedAt: null, requestCount: 0 };
}
function listSessions(page = 0, limit = 50) {
    const offset = page * limit;
    const { count } = exports.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    const rows = exports.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    return { sessions: rows.map(rowToSession), total: count };
}
function getSession(id) {
    const row = exports.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return row ? rowToSession(row) : null;
}
function updateSession(id, updates) {
    const sets = [];
    const values = [];
    if (updates.name !== undefined) {
        sets.push('name = ?');
        values.push(updates.name);
    }
    if (updates.state !== undefined) {
        sets.push('state = ?');
        values.push(updates.state);
        if (updates.state === 'completed') {
            sets.push('ended_at = ?');
            values.push(Date.now());
        }
    }
    if (sets.length === 0)
        return getSession(id);
    values.push(id);
    exports.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return getSession(id);
}
function deleteSession(id) {
    exports.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}
function insertRequest(sessionId, req) {
    const { data, compressed } = encodeBody(req.responseBody);
    exports.db.prepare(`
    INSERT OR REPLACE INTO requests
      (id, session_id, url, method, request_headers, request_body,
       status, response_headers, response_body, response_compressed,
       duration, timestamp, streaming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.id, sessionId, req.url, req.method, JSON.stringify(req.requestHeaders), req.requestBody, req.status, JSON.stringify(req.responseHeaders), data, compressed, req.duration, req.timestamp, req.streaming ? 1 : 0);
    exports.db.prepare('UPDATE sessions SET request_count = request_count + 1 WHERE id = ?').run(sessionId);
}
function batchInsertRequests(sessionId, requests) {
    const insert = exports.db.prepare(`
    INSERT OR REPLACE INTO requests
      (id, session_id, url, method, request_headers, request_body,
       status, response_headers, response_body, response_compressed,
       duration, timestamp, streaming)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    // node:sqlite doesn't expose .transaction(); use explicit BEGIN/COMMIT
    exports.db.exec('BEGIN');
    try {
        for (const req of requests) {
            const { data, compressed } = encodeBody(req.responseBody);
            insert.run(req.id, sessionId, req.url, req.method, JSON.stringify(req.requestHeaders), req.requestBody, req.status, JSON.stringify(req.responseHeaders), data, compressed, req.duration, req.timestamp, req.streaming ? 1 : 0);
        }
        exports.db.prepare('UPDATE sessions SET request_count = request_count + ? WHERE id = ?').run(requests.length, sessionId);
        exports.db.exec('COMMIT');
    }
    catch (err) {
        exports.db.exec('ROLLBACK');
        throw err;
    }
}
function endSession(sessionId) {
    exports.db.prepare("UPDATE sessions SET state = 'completed', ended_at = ? WHERE id = ?").run(Date.now(), sessionId);
}
function getRequests(sessionId, filters) {
    const conds = ['session_id = ?'];
    const params = [sessionId];
    if (filters.url) {
        conds.push('url LIKE ?');
        params.push(`%${filters.url}%`);
    }
    if (filters.method) {
        conds.push('method = ?');
        params.push(filters.method.toUpperCase());
    }
    if (filters.status !== undefined) {
        conds.push('status = ?');
        params.push(filters.status);
    }
    if (filters.from !== undefined) {
        conds.push('timestamp >= ?');
        params.push(filters.from);
    }
    if (filters.to !== undefined) {
        conds.push('timestamp <= ?');
        params.push(filters.to);
    }
    const where = conds.join(' AND ');
    const page = filters.page ?? 0;
    const limit = Math.min(filters.limit ?? 200, 500);
    const offset = page * limit;
    const { count } = exports.db.prepare(`SELECT COUNT(*) as count FROM requests WHERE ${where}`).get(...params);
    const rows = exports.db.prepare(`SELECT id, session_id, url, method, request_headers, request_body, status,
            response_headers, response_compressed, duration, timestamp, streaming,
            LENGTH(response_body) as response_size
     FROM requests WHERE ${where} ORDER BY timestamp ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return {
        requests: rows.map(r => ({
            id: r.id,
            url: r.url,
            method: r.method,
            requestHeaders: JSON.parse(r.request_headers || '{}'),
            requestBody: r.request_body,
            status: r.status,
            responseHeaders: JSON.parse(r.response_headers || '{}'),
            duration: r.duration,
            timestamp: r.timestamp,
            streaming: !!(r.streaming),
            responseSize: r.response_size ?? 0,
        })),
        total: count,
    };
}
function getRequest(sessionId, requestId) {
    const row = exports.db.prepare('SELECT * FROM requests WHERE id = ? AND session_id = ?').get(requestId, sessionId);
    if (!row)
        return null;
    return {
        id: row.id,
        url: row.url,
        method: row.method,
        requestHeaders: JSON.parse(row.request_headers || '{}'),
        requestBody: row.request_body,
        status: row.status,
        responseHeaders: JSON.parse(row.response_headers || '{}'),
        responseBody: decodeBody(row.response_body, row.response_compressed),
        duration: row.duration,
        timestamp: row.timestamp,
        streaming: !!(row.streaming),
    };
}
function getSnapshot(sessionId, timestamp) {
    const rows = exports.db.prepare(`
    SELECT r.*
    FROM requests r
    INNER JOIN (
      SELECT url, MAX(timestamp) AS max_ts
      FROM requests
      WHERE session_id = ? AND timestamp <= ?
      GROUP BY url
    ) latest ON r.url = latest.url AND r.timestamp = latest.max_ts AND r.session_id = ?
  `).all(sessionId, timestamp, sessionId);
    const snapshot = {};
    for (const row of rows) {
        snapshot[row.url] = {
            status: row.status,
            headers: JSON.parse(row.response_headers || '{}'),
            body: decodeBody(row.response_body, row.response_compressed),
        };
    }
    return snapshot;
}
