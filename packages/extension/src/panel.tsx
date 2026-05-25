import './styles.css';
import React, {
  useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense,
} from 'react';
import { createRoot } from 'react-dom/client';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import type { SessionMeta, RequestPayload } from '@atm/shared';

const VAULT = 'http://127.0.0.1:7842';
const ROW_H = 28;

// ─── Types ─────────────────────────────────────────────────────────────────────

type RecState = 'idle' | 'recording' | 'paused' | 'replaying';

type RequestMeta = Omit<RequestPayload, 'responseBody'> & { responseSize?: number };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function api(path: string) { return fetch(`${VAULT}${path}`).then(r => r.json()); }

function bgMsg(type: string, extra?: object): Promise<any> {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtSize(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-700 text-blue-100',
  POST: 'bg-green-700 text-green-100',
  PUT: 'bg-amber-700 text-amber-100',
  DELETE: 'bg-red-700 text-red-100',
  PATCH: 'bg-purple-700 text-purple-100',
};

function statusColor(s: number) {
  if (s >= 500) return 'text-red-400';
  if (s >= 400) return 'text-amber-400';
  if (s >= 300) return 'text-blue-400';
  return 'text-green-400';
}

function tryJson(str: string) {
  try { return JSON.parse(str); } catch { return null; }
}

// ─── JSON Tree (lazy) ──────────────────────────────────────────────────────────

function JsonNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (data === null) return <span className="text-gray-500">null</span>;
  if (typeof data === 'boolean') return <span className="text-purple-400">{String(data)}</span>;
  if (typeof data === 'number') return <span className="text-blue-400">{String(data)}</span>;
  if (typeof data === 'string') return <span className="text-green-400">"{data}"</span>;
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-gray-400">[]</span>;
    return (
      <span>
        <button className="text-gray-400 hover:text-white" onClick={() => setOpen(o => !o)}>
          {open ? '▾' : '▸'} [{data.length}]
        </button>
        {open && (
          <div className="ml-4 border-l border-gray-700 pl-2">
            {data.map((v, i) => (
              <div key={i}><span className="text-gray-500">{i}: </span><JsonNode data={v} depth={depth + 1} /></div>
            ))}
          </div>
        )}
      </span>
    );
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data as object);
    if (keys.length === 0) return <span className="text-gray-400">{'{}'}</span>;
    return (
      <span>
        <button className="text-gray-400 hover:text-white" onClick={() => setOpen(o => !o)}>
          {open ? '▾' : '▸'} {'{'}…{'}'}
        </button>
        {open && (
          <div className="ml-4 border-l border-gray-700 pl-2">
            {keys.map(k => (
              <div key={k}>
                <span className="text-amber-300">"{k}"</span>
                <span className="text-gray-400">: </span>
                <JsonNode data={(data as any)[k]} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }
  return <span>{String(data)}</span>;
}

// ─── Diff Modal (lazy-imported) ────────────────────────────────────────────────

type DiffEntry = { url: string; type: 'added' | 'removed' | 'changed'; statusA?: number; statusB?: number; changes?: unknown };

function DiffNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (!data || typeof data !== 'object') return <span className="text-gray-400">{String(data)}</span>;
  const d = data as any;
  if ('type' in d && typeof d.type === 'string') {
    if (d.type === 'added') return <span className="text-green-400">+ {JSON.stringify(d.value)}</span>;
    if (d.type === 'removed') return <span className="text-red-400">- {JSON.stringify(d.value)}</span>;
    if (d.type === 'changed') return (
      <span>
        <span className="text-red-400">- {JSON.stringify(d.from)}</span>{' '}
        <span className="text-green-400">+ {JSON.stringify(d.to)}</span>
      </span>
    );
  }
  const keys = Object.keys(d);
  return (
    <span>
      <button className="text-gray-400 hover:text-white" onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} {'{'}…{'}'}
      </button>
      {open && (
        <div className="ml-4 border-l border-gray-700 pl-2">
          {keys.map(k => (
            <div key={k}>
              <span className="text-amber-300">"{k}"</span>: <DiffNode data={d[k]} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function DiffModal({ sessions, onClose }: { sessions: SessionMeta[]; onClose: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [diffs, setDiffs] = useState<DiffEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function runDiff() {
    if (!a || !b) return;
    setLoading(true);
    try {
      const res: { diffs: DiffEntry[] } = await api(`/sessions/${a}/diff/${b}`);
      setDiffs(res.diffs);
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[800px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="font-semibold">Compare Sessions</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">✕</button>
        </div>
        <div className="flex gap-3 px-4 py-3 border-b border-gray-700">
          <select value={a} onChange={e => setA(e.target.value)} className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs">
            <option value="">Session A…</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={b} onChange={e => setB(e.target.value)} className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs">
            <option value="">Session B…</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={runDiff} disabled={!a || !b || loading}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-xs font-bold">
            {loading ? '…' : 'Diff'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2 text-xs font-mono space-y-2">
          {diffs === null && <p className="text-gray-500">Select two sessions and click Diff.</p>}
          {diffs?.length === 0 && <p className="text-green-400">No differences found.</p>}
          {diffs?.map((d, i) => (
            <div key={i} className="border border-gray-700 rounded p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1 rounded text-[10px] font-bold ${d.type === 'added' ? 'bg-green-900 text-green-300' : d.type === 'removed' ? 'bg-red-900 text-red-300' : 'bg-amber-900 text-amber-300'}`}>
                  {d.type.toUpperCase()}
                </span>
                <span className="text-gray-300 truncate flex-1">{d.url}</span>
                {d.type === 'changed' && d.statusA !== d.statusB && (
                  <span className="text-gray-500">{d.statusA} → {d.statusB}</span>
                )}
              </div>
              {d.changes != null ? <DiffNode data={d.changes} /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Request detail inspector ──────────────────────────────────────────────────

function HeaderTable({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="text-gray-500 text-xs">No headers</p>;
  return (
    <table className="w-full text-xs border-collapse">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-b border-gray-800">
            <td className="py-1 pr-3 text-amber-300 align-top w-1/3 break-all">{k}</td>
            <td className="py-1 text-gray-300 break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type InspectorTab = 'headers' | 'body' | 'response' | 'timing';

function Inspector({ req }: { req: RequestMeta }) {
  const [tab, setTab] = useState<InspectorTab>('response');
  const [full, setFull] = useState<RequestPayload | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const isLarge = (req.responseSize ?? 0) > 500 * 1024;

  useEffect(() => {
    setFull(null);
    setBodyLoaded(false);
    if (!isLarge) loadFull();
  }, [req.id]);

  async function loadFull() {
    setLoadingBody(true);
    try {
      const data: RequestPayload = await api(`/sessions/${(req as any).sessionId ?? ''}/requests/${req.id}`);
      setFull(data);
      setBodyLoaded(true);
    } finally { setLoadingBody(false); }
  }

  const TABS: InspectorTab[] = ['response', 'headers', 'body', 'timing'];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-gray-800 shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs capitalize ${tab === t ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
        {tab === 'headers' && (
          <div className="space-y-4">
            <section>
              <h3 className="text-gray-500 uppercase text-[10px] font-bold mb-1">Request Headers</h3>
              <HeaderTable data={req.requestHeaders ?? {}} />
            </section>
            <section>
              <h3 className="text-gray-500 uppercase text-[10px] font-bold mb-1">Response Headers</h3>
              <HeaderTable data={req.responseHeaders ?? {}} />
            </section>
          </div>
        )}

        {tab === 'body' && (
          <div>
            <h3 className="text-gray-500 uppercase text-[10px] font-bold mb-1">Request Body</h3>
            {req.requestBody ? (
              (() => {
                const parsed = tryJson(req.requestBody);
                return parsed
                  ? <div className="leading-5"><JsonNode data={parsed} /></div>
                  : <pre className="text-gray-300 whitespace-pre-wrap break-all">{req.requestBody}</pre>;
              })()
            ) : <p className="text-gray-500">No request body</p>}
          </div>
        )}

        {tab === 'response' && (
          <div>
            {isLarge && !bodyLoaded && (
              <div className="mb-2 p-2 bg-yellow-950 border border-yellow-700 rounded text-yellow-300">
                Response is large ({fmtSize(req.responseSize ?? 0)}).{' '}
                <button onClick={loadFull} disabled={loadingBody}
                  className="underline hover:no-underline">
                  {loadingBody ? 'Loading…' : 'Load body'}
                </button>
              </div>
            )}
            {full ? (
              (() => {
                const body = full.responseBody;
                const ct = Object.entries(full.responseHeaders).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
                if (body.startsWith('[base64]')) {
                  const b64 = body.slice(8);
                  if (ct.startsWith('image/')) {
                    return <img src={`data:${ct};base64,${b64}`} className="max-w-full" alt="response" />;
                  }
                  return <pre className="text-gray-400">[Binary — {fmtSize(req.responseSize ?? 0)}]</pre>;
                }
                const parsed = tryJson(body);
                return parsed
                  ? <div className="leading-5"><JsonNode data={parsed} /></div>
                  : <pre className="text-gray-300 whitespace-pre-wrap break-all text-xs">{body}</pre>;
              })()
            ) : (!isLarge && loadingBody ? <p className="text-gray-500">Loading…</p> : null)}
          </div>
        )}

        {tab === 'timing' && (
          <div className="space-y-2">
            <p className="text-gray-400">Total Duration: <span className="text-white">{fmtDuration(req.duration)}</span></p>
            <div className="mt-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-500 w-24">Download</span>
                <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                  <div className="h-full bg-blue-500 rounded"
                    style={{ width: `${Math.min(100, (req.duration / 5000) * 100)}%` }} />
                </div>
                <span className="text-gray-300 w-20 text-right">{fmtDuration(req.duration)}</span>
              </div>
            </div>
            <p className="text-gray-600 text-[10px]">Detailed waterfall requires browser performance API access.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Timeline row ─────────────────────────────────────────────────────────────

interface RowData {
  items: (RequestMeta & { sessionId: string; ghost?: boolean })[];
  selected: string | null;
  onSelect: (r: RequestMeta & { sessionId: string }) => void;
}

function TimelineRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const { items, selected, onSelect } = data;
  const r = items[index];
  const isSelected = r.id === selected;
  const methodColor = METHOD_COLORS[r.method] ?? 'bg-gray-700 text-gray-200';
  return (
    <div
      style={style}
      onClick={() => onSelect(r)}
      className={`flex items-center gap-2 px-2 cursor-pointer select-none text-xs
        ${isSelected ? 'bg-blue-900/60' : 'hover:bg-gray-800'}
        ${r.ghost ? 'opacity-30' : ''}
        border-b border-gray-800/50`}
    >
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${methodColor}`}>{r.method}</span>
      <span className="flex-1 truncate-url text-gray-300" title={r.url}>{r.url}</span>
      <span className={`shrink-0 w-10 text-right font-bold ${statusColor(r.status)}`}>{r.status}</span>
      <span className="shrink-0 w-16 text-right text-gray-500">{fmtSize(r.responseSize ?? 0)}</span>
      <span className="shrink-0 w-16 text-right text-gray-500">{fmtDuration(r.duration)}</span>
      {r.streaming && <span title="Streaming" className="shrink-0 text-blue-400">〜</span>}
    </div>
  );
}

// ─── Panel root ───────────────────────────────────────────────────────────────

function Panel() {
  const [vaultOnline, setVaultOnline] = useState(false);
  const [recState, setRecState] = useState<RecState>('idle');
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [requests, setRequests] = useState<(RequestMeta & { sessionId: string })[]>([]);
  const [selected, setSelected] = useState<(RequestMeta & { sessionId: string }) | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [scrubber, setScrubber] = useState<number | null>(null);
  const [replayMode, setReplayMode] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [strictMode, setStrictMode] = useState(false);
  const [importRef] = useState(() => React.createRef<HTMLInputElement>());
  const listRef = useRef<FixedSizeList>(null);
  const [listHeight, setListHeight] = useState(600);
  const leftPanelRef = useRef<HTMLDivElement>(null);

  // Measure left panel height for react-window
  useEffect(() => {
    if (!leftPanelRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setListHeight(entry.contentRect.height - ROW_H * 1.5); // minus toolbar
    });
    ro.observe(leftPanelRef.current);
    return () => ro.disconnect();
  }, []);

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

  // Filtered requests for scrubber
  const visibleRequests = useMemo(() => {
    if (!scrubber || !replayMode) return requests;
    return requests.map(r => ({ ...r, ghost: r.timestamp > scrubber }));
  }, [requests, scrubber, replayMode]);

  // Poll vault + background state
  const pollVault = useCallback(async () => {
    try {
      const r = await fetch(`${VAULT}/health`);
      setVaultOnline(r.ok);
    } catch { setVaultOnline(false); }

    try {
      const { state } = await bgMsg('GET_STATE');
      setRecState(state.recordingState);
      if (state.activeSessionId) setActiveSessionId(state.activeSessionId);
    } catch {}
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const { sessions: s }: { sessions: SessionMeta[] } = await api('/sessions?limit=100');
      setSessions(s);
    } catch {}
  }, []);

  const loadRequests = useCallback(async (sid: string) => {
    try {
      const { requests: r }: { requests: (RequestMeta & { sessionId?: string })[] } = await api(`/sessions/${sid}/requests?limit=500`);
      setRequests(r.map(x => ({ ...x, sessionId: sid })));
    } catch {}
  }, []);

  useEffect(() => {
    pollVault();
    loadSessions();
    const id = setInterval(() => {
      pollVault();
      loadSessions();
      if (activeSessionId && recState === 'recording') loadRequests(activeSessionId);
    }, 1500);
    return () => clearInterval(id);
  }, [pollVault, loadSessions, loadRequests, activeSessionId, recState]);

  useEffect(() => {
    if (activeSessionId) {
      loadRequests(activeSessionId);
      const s = sessions.find(x => x.id === activeSessionId);
      if (s) setSessionName(s.name);
    }
  }, [activeSessionId]);

  // Auto-scroll to bottom during recording
  useEffect(() => {
    if (recState === 'recording' && visibleRequests.length > 0) {
      listRef.current?.scrollToItem(visibleRequests.length - 1);
    }
  }, [visibleRequests.length, recState]);

  // ── Recording controls ────────────────────────────────────────────────────

  async function startRecording() {
    const name = sessionName || `Session ${new Date().toLocaleTimeString()}`;
    const res = await bgMsg('START_RECORDING', { name, tabUrl: '' });
    if (res.ok) { setActiveSessionId(res.sessionId); setRequests([]); setSelected(null); await loadSessions(); }
  }

  async function stopRecording() {
    await bgMsg('STOP_RECORDING');
    setRecState('idle');
    if (activeSessionId) await loadRequests(activeSessionId);
    await loadSessions();
  }

  async function pauseRecording() { await bgMsg(recState === 'paused' ? 'RESUME_RECORDING' : 'PAUSE_RECORDING'); }

  async function renameSession() {
    if (!activeSessionId || !sessionName) return;
    await fetch(`${VAULT}/sessions/${activeSessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: sessionName }) });
    await loadSessions();
  }

  // ── Replay controls ───────────────────────────────────────────────────────

  async function startReplay() {
    if (!activeSessionId) return;
    const ts = scrubber ?? activeSession?.endedAt ?? Date.now();
    await bgMsg('START_REPLAY', { sessionId: activeSessionId, timestamp: ts, strict: strictMode });
    setRecState('replaying');
  }

  async function stopReplay() {
    await bgMsg('STOP_REPLAY');
    setRecState('idle');
  }

  // ── Export / Import ────────────────────────────────────────────────────────

  function exportSession() {
    if (!activeSessionId) return;
    const a = document.createElement('a');
    a.href = `${VAULT}/sessions/${activeSessionId}/export`;
    a.download = `session-${activeSessionId}.atm`;
    a.click();
  }

  async function importSession(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const body = JSON.parse(text);
    const r = await fetch(`${VAULT}/sessions/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { const { id } = await r.json(); setActiveSessionId(id); await loadSessions(); await loadRequests(id); }
    if (importRef.current) importRef.current.value = '';
  }

  // ─────────────────────────────────────────────────────────────────────────

  const sessionOpts = sessions.filter(s => s.state === 'completed');

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 text-xs font-mono overflow-hidden">

      {/* Security banner */}
      <div className="shrink-0 bg-yellow-950 border-b border-yellow-800 px-3 py-1 text-yellow-400 text-[10px]">
        ⚠ Recordings may contain auth tokens and secrets. Handle .atm files like credentials.
      </div>

      {/* Vault offline strip */}
      {!vaultOnline && (
        <div className="shrink-0 bg-red-950 border-b border-red-800 px-3 py-1.5 text-red-300 flex items-center gap-3">
          <span className="font-bold">Vault offline</span>
          <code className="bg-gray-900 px-2 py-0.5 rounded">npx api-time-machine</code>
          <span className="text-red-500">Requests will buffer locally (max 50).</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-gray-800 bg-gray-900">
        {/* Record / Stop */}
        {recState === 'idle' && (
          <button onClick={startRecording} disabled={!vaultOnline}
            className="px-2 py-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded font-bold flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-white inline-block" /> REC
          </button>
        )}
        {(recState === 'recording' || recState === 'paused') && (<>
          <button onClick={pauseRecording}
            className={`px-2 py-1 rounded font-bold ${recState === 'paused' ? 'bg-green-600 hover:bg-green-500' : 'bg-yellow-600 hover:bg-yellow-500'}`}>
            {recState === 'paused' ? '▶' : '⏸'}
          </button>
          <button onClick={stopRecording} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded font-bold">■ Stop</button>
        </>)}
        {recState === 'replaying' && (
          <button onClick={stopReplay} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded font-bold">■ End Replay</button>
        )}

        {/* Session name */}
        <input value={sessionName} onChange={e => setSessionName(e.target.value)}
          onBlur={renameSession}
          placeholder="Session name…"
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500" />

        {/* Session selector */}
        <select value={activeSessionId ?? ''}
          onChange={e => { setActiveSessionId(e.target.value); loadRequests(e.target.value); setScrubber(null); setReplayMode(false); }}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs max-w-[160px]">
          <option value="">— Sessions —</option>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.requestCount})</option>
          ))}
        </select>

        {/* Replay toggle */}
        {activeSession?.state === 'completed' && recState === 'idle' && (
          <button onClick={() => setReplayMode(r => !r)}
            className={`px-2 py-1 rounded font-bold ${replayMode ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
            ⏪ Replay
          </button>
        )}

        {/* Diff */}
        <button onClick={() => setShowDiff(true)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">⇄ Diff</button>

        {/* Export */}
        <button onClick={exportSession} disabled={!activeSessionId}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded">↑ Export</button>

        {/* Import */}
        <label className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded cursor-pointer">
          ↓ Import
          <input ref={importRef} type="file" accept=".atm" className="hidden" onChange={importSession} />
        </label>

        {/* Vault indicator */}
        <div className={`flex items-center gap-1 shrink-0 ${vaultOnline ? 'text-green-400' : 'text-red-400'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${vaultOnline ? 'bg-green-400' : 'bg-red-400'}`} />
          {vaultOnline ? 'Connected' : 'Offline'}
        </div>
      </div>

      {/* Replay controls */}
      {replayMode && activeSession && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 bg-blue-950 border-b border-blue-800">
          <span className="text-blue-300 font-bold">REPLAY MODE</span>
          <input type="range"
            min={activeSession.startedAt}
            max={activeSession.endedAt ?? Date.now()}
            value={scrubber ?? activeSession.endedAt ?? Date.now()}
            onChange={e => setScrubber(Number(e.target.value))}
            className="flex-1" />
          <span className="text-blue-300 w-28 shrink-0">
            {scrubber ? fmtTime(scrubber) : 'End'}
          </span>
          <label className="flex items-center gap-1 text-blue-300">
            <input type="checkbox" checked={strictMode} onChange={e => setStrictMode(e.target.checked)} />
            Strict
          </label>
          <button onClick={startReplay}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded font-bold">
            Restore to this point
          </button>
        </div>
      )}

      {/* Column headers */}
      <div className="shrink-0 flex items-center gap-2 px-2 border-b border-gray-700 bg-gray-900 text-gray-500 uppercase text-[10px] font-bold" style={{ height: ROW_H }}>
        <span className="w-14 shrink-0">Method</span>
        <span className="flex-1">URL</span>
        <span className="w-10 shrink-0 text-right">Status</span>
        <span className="w-16 shrink-0 text-right">Size</span>
        <span className="w-16 shrink-0 text-right">Time</span>
        <span className="w-4 shrink-0" />
      </div>

      {/* Split body */}
      <div className="flex flex-1 min-h-0">
        {/* Left — timeline */}
        <div ref={leftPanelRef} className="w-[40%] border-r border-gray-800 overflow-hidden flex flex-col">
          {visibleRequests.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-600">
              {recState === 'recording' ? 'Waiting for requests…' : 'No requests. Start a recording or select a session.'}
            </div>
          ) : (
            <FixedSizeList
              ref={listRef}
              height={listHeight}
              itemCount={visibleRequests.length}
              itemSize={ROW_H}
              width="100%"
              itemData={{ items: visibleRequests, selected: selected?.id ?? null, onSelect: setSelected }}
            >
              {TimelineRow}
            </FixedSizeList>
          )}
        </div>

        {/* Right — inspector */}
        <div className="flex-1 overflow-hidden">
          {selected ? (
            <Inspector req={selected} />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-600">
              Select a request to inspect
            </div>
          )}
        </div>
      </div>

      {/* Diff modal */}
      {showDiff && <DiffModal sessions={sessions} onClose={() => setShowDiff(false)} />}
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<Panel />);
