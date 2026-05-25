import type { RequestPayload, SnapshotMap } from '@atm/shared';

const VAULT_HTTP = 'http://127.0.0.1:7842';
const VAULT_WS = 'ws://127.0.0.1:7842';
const MAX_BUFFER = 50;
const WS_RECONNECT_MS = 2000;

interface ATMState {
  activeSessionId: string | null;
  recordingState: 'idle' | 'recording' | 'paused' | 'replaying';
  pendingBuffer: RequestPayload[];
  vaultOnline: boolean;
}

let state: ATMState = {
  activeSessionId: null,
  recordingState: 'idle',
  pendingBuffer: [],
  vaultOnline: false,
};

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ─── State persistence ────────────────────────────────────────────────────────

async function loadState(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get('atmState');
    if (stored.atmState) {
      state = { ...state, ...stored.atmState, vaultOnline: false };
    }
  } catch {}
}

function saveState(): void {
  chrome.storage.session.set({ atmState: state }).catch(() => {});
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

function connectWS(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(VAULT_WS);

    ws.onopen = () => {
      state.vaultOnline = true;
      saveState();
      flushBuffer();
    };

    ws.onmessage = (_ev) => {
      // ACK / PONG — no-op for now
    };

    ws.onclose = () => {
      state.vaultOnline = false;
      ws = null;
      saveState();
      scheduleReconnect();
    };

    ws.onerror = () => ws?.close();
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectWS, WS_RECONNECT_MS);
}

function wsSend(msg: object): boolean {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function flushBuffer(): void {
  if (state.pendingBuffer.length === 0) return;
  const toFlush = [...state.pendingBuffer];
  state.pendingBuffer = [];
  saveState();
  // Batch flush in a single logical block (vault uses per-message ACKs).
  for (const req of toFlush) {
    if (!wsSend({ type: 'RECORD_REQUEST', sessionId: state.activeSessionId, payload: req })) {
      // WS dropped again — put back what we haven't sent yet.
      state.pendingBuffer.unshift(req);
      state.pendingBuffer = state.pendingBuffer.slice(0, MAX_BUFFER);
      saveState();
      break;
    }
  }
}

// ─── Message handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg, sendResponse);
  return true;
});

async function handleMessage(msg: any, reply: (r: any) => void): Promise<void> {
  switch (msg.type) {

    case 'START_RECORDING': {
      const tabUrl: string = msg.tabUrl ?? '';
      const name: string = msg.name ?? `Recording ${new Date().toLocaleString()}`;
      try {
        const res = await fetch(`${VAULT_HTTP}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, tabUrl }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const session = await res.json();
        state.activeSessionId = session.id;
        state.recordingState = 'recording';
        saveState();
        reply({ ok: true, sessionId: session.id });
      } catch (err) {
        reply({ ok: false, error: String(err) });
      }
      break;
    }

    case 'PAUSE_RECORDING':
      state.recordingState = 'paused';
      saveState();
      reply({ ok: true });
      break;

    case 'RESUME_RECORDING':
      state.recordingState = 'recording';
      saveState();
      reply({ ok: true });
      break;

    case 'STOP_RECORDING':
      if (state.activeSessionId) {
        wsSend({ type: 'SESSION_END', sessionId: state.activeSessionId });
      }
      state.recordingState = 'idle';
      saveState();
      reply({ ok: true });
      break;

    case 'FETCH_CAPTURED': {
      if (state.recordingState !== 'recording' || !state.activeSessionId) {
        reply({ ok: true });
        break;
      }
      const payload: RequestPayload = {
        id: crypto.randomUUID(),
        url: msg.payload.url,
        method: msg.payload.method,
        requestHeaders: msg.payload.requestHeaders,
        requestBody: msg.payload.requestBody,
        status: msg.payload.status,
        responseHeaders: msg.payload.responseHeaders,
        responseBody: msg.payload.responseBody,
        duration: msg.payload.duration,
        timestamp: msg.payload.timestamp,
        streaming: !!msg.payload.streaming,
      };
      const sent = wsSend({ type: 'RECORD_REQUEST', sessionId: state.activeSessionId, payload });
      if (!sent && state.pendingBuffer.length < MAX_BUFFER) {
        // Keep payload but drop response body to stay memory-safe.
        state.pendingBuffer.push({ ...payload, responseBody: '' });
        saveState();
      }
      reply({ ok: true });
      break;
    }

    case 'START_REPLAY': {
      const { sessionId, timestamp, strict } = msg;
      try {
        const ts = timestamp ?? Date.now();
        const res = await fetch(`${VAULT_HTTP}/sessions/${sessionId}/snapshot?timestamp=${ts}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const snapshot: SnapshotMap = await res.json();

        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'REPLAY_INJECT', snapshot, strict: !!strict }).catch(() => {});
          }
        }

        await setupReplayBlocking(Object.keys(snapshot));
        state.recordingState = 'replaying';
        state.activeSessionId = sessionId;
        saveState();
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, error: String(err) });
      }
      break;
    }

    case 'STOP_REPLAY': {
      await clearReplayBlocking();
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'REPLAY_CLEAR' }).catch(() => {});
        }
      }
      state.recordingState = 'idle';
      saveState();
      reply({ ok: true });
      break;
    }

    case 'GET_STATE':
      reply({ state });
      break;

    case 'CHECK_VAULT':
      try {
        const r = await fetch(`${VAULT_HTTP}/health`);
        state.vaultOnline = r.ok;
        saveState();
        reply({ online: r.ok });
      } catch {
        state.vaultOnline = false;
        saveState();
        reply({ online: false });
      }
      break;

    case 'REDACT_SESSION': {
      const { sessionId: sid, paths } = msg as { sessionId: string; paths: string[] };
      try {
        const res = await fetch(`${VAULT_HTTP}/sessions/${sid}/requests?limit=500`);
        const { requests } = await res.json();
        for (const r of requests) {
          const full = await fetch(`${VAULT_HTTP}/sessions/${sid}/requests/${r.id}`).then(x => x.json());
          let body = full.responseBody;
          try {
            const parsed = JSON.parse(body);
            redactPaths(parsed, paths);
            body = JSON.stringify(parsed);
          } catch {}
          // Patch via PATCH if endpoint existed; for now we just note the limitation.
          // Full redaction requires a PATCH /requests/:id endpoint or re-import flow.
          void body;
        }
        reply({ ok: true, note: 'Use Export → re-import to persist redactions.' });
      } catch (err) {
        reply({ ok: false, error: String(err) });
      }
      break;
    }

    default:
      reply({ ok: false, error: 'Unknown message type' });
  }
}

function redactPaths(obj: any, paths: string[]): void {
  for (const path of paths) {
    const parts = path.replace(/^\$\./, '').split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur == null || typeof cur !== 'object') break;
      cur = cur[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (cur != null && typeof cur === 'object' && last in cur) {
      cur[last] = '[REDACTED]';
    }
  }
}

// ─── declarativeNetRequest helpers ───────────────────────────────────────────

async function setupReplayBlocking(urls: string[]): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(r => r.id),
    addRules: urls.slice(0, 100).map((url, i) => ({
      id: i + 1,
      priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
      condition: {
        urlFilter: url,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
          'fetch' as chrome.declarativeNetRequest.ResourceType,
        ],
      },
    })),
  });
}

async function clearReplayBlocking(): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (existing.length === 0) return;
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(r => r.id) });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

loadState().then(() => connectWS());
