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
exports.requestsRouter = void 0;
const express_1 = require("express");
const db = __importStar(require("../db"));
exports.requestsRouter = (0, express_1.Router)({ mergeParams: true });
exports.requestsRouter.get('/', (req, res) => {
    const { url, method, status, from, to, page, limit } = req.query;
    const result = db.getRequests(req.params.id, {
        url: url,
        method: method,
        status: status !== undefined ? parseInt(status) : undefined,
        from: from !== undefined ? parseInt(from) : undefined,
        to: to !== undefined ? parseInt(to) : undefined,
        page: page !== undefined ? parseInt(page) : 0,
        limit: limit !== undefined ? Math.min(parseInt(limit), 500) : 200,
    });
    res.json(result);
});
exports.requestsRouter.get('/:reqId', (req, res) => {
    const full = db.getRequest(req.params.id, req.params.reqId);
    if (!full)
        return void res.status(404).json({ error: 'Not found' });
    res.json(full);
});
