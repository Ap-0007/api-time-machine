import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { sessionsRouter } from './routes/sessions';
import { requestsRouter } from './routes/requests';
import { setupWebSocket } from './ws';

const PORT = 7842;
const HOST = '127.0.0.1';

const app = express();

const ALLOWED_ORIGINS = /^(chrome-extension:\/\/|http:\/\/localhost|http:\/\/127\.0\.0\.1)/;

app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.test(origin)) cb(null, true);
    else cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '64mb' }));

app.use('/sessions', sessionsRouter);
app.use('/sessions/:id/requests', requestsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

const server = createServer(app);
setupWebSocket(server);

server.listen(PORT, HOST, () => {
  console.log(`Vault running on :${PORT}`);
});

export default app;
