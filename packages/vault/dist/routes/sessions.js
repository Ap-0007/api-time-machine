"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionsRouter = void 0;
const express_1 = require("express");
const uuid_1 = require("uuid");
const db = __importStar(require("../db"));
exports.sessionsRouter = (0, express_1.Router)();
function jsonDiff(a, b) {
    if (a === b)
        return null;
    if (typeof a !== typeof b || a === null || b === null)
        return { type: 'changed', from: a, to: b };
    if (typeof a !== 'object')
        return { type: 'changed', from: a, to: b };
    if (Array.isArray(a) !== Array.isArray(b))
        return { type: 'changed', from: a, to: b };
    const objA = a;
    const objB = b;
    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    const result = {};
    let hasDiff = false;
    for (const key of allKeys) {
        if (!(key in objA)) {
            result[key] = { type: 'added', value: objB[key] };
            hasDiff = true;
        }
        else if (!(key in objB)) {
            result[key] = { type: 'removed', value: objA[key] };
            hasDiff = true;
        }
        else {
            const child = jsonDiff(objA[key], objB[key]);
            if (child !== null) {
                result[key] = child;
                hasDiff = true;
            }
        }
    }
    return hasDiff ? result : null;
}
exports.sessionsRouter.post('/import', (req, res) => {
    const atm = req.body;
    if (!atm || atm.version !== '1.0')
        return void res.status(400).json({ error: 'Invalid .atm file' });
    const newId = (0, uuid_1.v4)();
    db.createSession({ id: newId, name: `[Imported] ${atm.session.name}`, tabUrl: atm.session.tabUrl });
    const remapped = atm.requests.map(r => ({ ...r, id: (0, uuid_1.v4)() }));
    db.batchInsertRequests(newId, remapped);
    db.updateSession(newId, { state: 'completed' });
    res.status(201).json({ id: newId });
});
exports.sessionsRouter.post('/', (req, res) => {
    const { name, tabUrl } = req.body;
    const id = (0, uuid_1.v4)();
    const session = db.createSession({ id, name: name || `Session ${new Date().toLocaleString()}`, tabUrl: tabUrl || '' });
    res.status(201).json(session);
});
exports.sessionsRouter.get('/', (req, res) => {
    const page = parseInt(req.query.page) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(db.listSessions(page, limit));
});
exports.sessionsRouter.get('/:id/snapshot', (req, res) => {
    const session = db.getSession(req.params.id);
    if (!session)
        return void res.status(404).json({ error: 'Not found' });
    const ts = parseInt(req.query.timestamp) || Date.now();
    res.json(db.getSnapshot(req.params.id, ts));
});
exports.sessionsRouter.get('/:id/export', (req, res) => {
    const session = db.getSession(req.params.id);
    if (!session)
        return void res.status(404).json({ error: 'Not found' });
    const { requests: meta } = db.getRequests(req.params.id, { limit: 10000 });
    const full = meta.map(r => db.getRequest(req.params.id, r.id)).filter(Boolean);
    const atm = { version: '1.0', exportedAt: Date.now(), session, requests: full };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.id}.atm"`);
    res.json(atm);
});
exports.sessionsRouter.get('/:id/diff/:otherId', (req, res) => {
    const sessionA = db.getSession(req.params.id);
    const sessionB = db.getSession(req.params.otherId);
    if (!sessionA || !sessionB)
        return void res.status(404).json({ error: 'Session not found' });
    const { requests: metaA } = db.getRequests(req.params.id, { limit: 10000 });
    const { requests: metaB } = db.getRequests(req.params.otherId, { limit: 10000 });
    const mapA = new Map();
    const mapB = new Map();
    for (const r of metaA) {
        const full = db.getRequest(req.params.id, r.id);
        if (!full)
            continue;
        let body = full.responseBody;
        try {
            body = JSON.parse(full.responseBody);
        }
        catch { }
        mapA.set(r.url, { status: full.status, body });
    }
    for (const r of metaB) {
        const full = db.getRequest(req.params.otherId, r.id);
        if (!full)
            continue;
        let body = full.responseBody;
        try {
            body = JSON.parse(full.responseBody);
        }
        catch { }
        mapB.set(r.url, { status: full.status, body });
    }
    const allUrls = new Set([...mapA.keys(), ...mapB.keys()]);
    const diffs = [];
    for (const url of allUrls) {
        const a = mapA.get(url);
        const b = mapB.get(url);
        if (!a) {
            diffs.push({ url, type: 'added' });
        }
        else if (!b) {
            diffs.push({ url, type: 'removed' });
        }
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
exports.sessionsRouter.get('/:id', (req, res) => {
    const session = db.getSession(req.params.id);
    if (!session)
        return void res.status(404).json({ error: 'Not found' });
    res.json(session);
});
exports.sessionsRouter.patch('/:id', (req, res) => {
    const { name, state } = req.body;
    const session = db.updateSession(req.params.id, { name, state });
    if (!session)
        return void res.status(404).json({ error: 'Not found' });
    res.json(session);
});
exports.sessionsRouter.delete('/:id', (req, res) => {
    if (!db.getSession(req.params.id))
        return void res.status(404).json({ error: 'Not found' });
    db.deleteSession(req.params.id);
    res.status(204).end();
});
