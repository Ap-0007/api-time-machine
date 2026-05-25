import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import * as db from './db';
import type { RequestPayload } from '@atm/shared';

type InboundMsg =
  | { type: 'RECORD_REQUEST'; sessionId: string; payload: RequestPayload }
  | { type: 'SESSION_END'; sessionId: string }
  | { type: 'PING' };

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    send(ws, { type: 'VAULT_READY' });

    ws.on('message', (raw: Buffer) => {
      let msg: InboundMsg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'RECORD_REQUEST':
          try {
            db.insertRequest(msg.sessionId, msg.payload);
            send(ws, { type: 'ACK', id: msg.payload.id });
          } catch (err) {
            console.error('[vault/ws] insert failed', err);
          }
          break;

        case 'SESSION_END':
          db.endSession(msg.sessionId);
          break;

        case 'PING':
          send(ws, { type: 'PONG' });
          break;
      }
    });

    ws.on('error', (err) => console.error('[vault/ws] error', err));
  });

  return wss;
}

function send(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
