"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = require("http");
const sessions_1 = require("./routes/sessions");
const requests_1 = require("./routes/requests");
const ws_1 = require("./ws");
const PORT = 7842;
const HOST = '127.0.0.1';
const app = (0, express_1.default)();
const ALLOWED_ORIGINS = /^(chrome-extension:\/\/|http:\/\/localhost|http:\/\/127\.0\.0\.1)/;
app.use((0, cors_1.default)({
    origin(origin, cb) {
        if (!origin || ALLOWED_ORIGINS.test(origin))
            cb(null, true);
        else
            cb(new Error(`CORS: ${origin} not allowed`));
    },
    credentials: true,
}));
app.use(express_1.default.json({ limit: '64mb' }));
app.use('/sessions', sessions_1.sessionsRouter);
app.use('/sessions/:id/requests', requests_1.requestsRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));
const server = (0, http_1.createServer)(app);
(0, ws_1.setupWebSocket)(server);
server.listen(PORT, HOST, () => {
    console.log(`Vault running on :${PORT}`);
});
exports.default = app;
