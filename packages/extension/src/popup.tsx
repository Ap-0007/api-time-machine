import './styles.css';
import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionMeta } from '@atm/shared';

type RecState = 'idle' | 'recording' | 'paused' | 'replaying';

interface ATMState {
  activeSessionId: string | null;
  recordingState: RecState;
  pendingBuffer: unknown[];
  vaultOnline: boolean;
}

function msg(type: string, extra?: object): Promise<any> {
  return chrome.runtime.sendMessage({ type, ...extra });
}

const STATE_COLORS: Record<RecState, string> = {
  idle: 'bg-gray-600',
  recording: 'bg-red-500 animate-pulse',
  paused: 'bg-yellow-500',
  replaying: 'bg-blue-500',
};

function Popup() {
  const [state, setState] = useState<ATMState | null>(null);
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [vaultCmd] = useState('npx api-time-machine');
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { state: s } = await msg('GET_STATE');
      setState(s as ATMState);
      if (s.activeSessionId) {
        const res = await fetch(`http://127.0.0.1:7842/sessions/${s.activeSessionId}`);
        if (res.ok) setSession(await res.json());
      } else {
        setSession(null);
      }
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  async function startRecording() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await msg('START_RECORDING', { tabUrl: tab?.url ?? '', name: `${tab?.title ?? 'Session'} – ${new Date().toLocaleTimeString()}` });
    await refresh();
  }

  async function stopRecording() { await msg('STOP_RECORDING'); await refresh(); }
  async function pauseRecording() { await msg('PAUSE_RECORDING'); await refresh(); }
  async function resumeRecording() { await msg('RESUME_RECORDING'); await refresh(); }
  async function stopReplay() { await msg('STOP_REPLAY'); await refresh(); }

  function copyCmd() {
    navigator.clipboard.writeText(vaultCmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  if (!state) return <div className="w-72 p-4 bg-gray-900 text-gray-300 text-xs">Loading…</div>;

  const { recordingState, vaultOnline, pendingBuffer } = state;
  const offline = !vaultOnline;

  return (
    <div className="w-72 bg-gray-900 text-gray-100 text-xs font-mono select-none">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
        <div className={`w-2 h-2 rounded-full ${offline ? 'bg-red-500' : 'bg-green-400'}`} />
        <span className="font-semibold text-sm">API Time Machine</span>
        <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase ${STATE_COLORS[recordingState]} text-white`}>
          {recordingState}
        </span>
      </div>

      {/* Vault offline banner */}
      {offline && (
        <div className="mx-3 mt-2 p-2 bg-red-950 border border-red-700 rounded text-red-300">
          <p className="font-bold mb-1">Vault offline</p>
          <p className="mb-1 text-[10px]">Start the local server:</p>
          <div className="flex items-center gap-1">
            <code className="flex-1 bg-gray-950 px-2 py-1 rounded text-green-400">{vaultCmd}</code>
            <button onClick={copyCmd} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Session info */}
      {session && (
        <div className="px-3 py-2 border-b border-gray-800">
          <p className="text-gray-400 truncate">{session.name}</p>
          <p className="text-gray-500 mt-0.5">
            {session.requestCount} requests
            {pendingBuffer.length > 0 && (
              <span className="ml-2 text-yellow-400">{pendingBuffer.length} buffered</span>
            )}
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 px-3 py-2">
        {recordingState === 'idle' && (
          <button onClick={startRecording} disabled={offline}
            className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed rounded font-bold text-white">
            ● Start Recording
          </button>
        )}
        {recordingState === 'recording' && (<>
          <button onClick={pauseRecording} className="flex-1 py-1.5 bg-yellow-600 hover:bg-yellow-500 rounded font-bold text-white">⏸ Pause</button>
          <button onClick={stopRecording} className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 rounded font-bold text-white">■ Stop</button>
        </>)}
        {recordingState === 'paused' && (<>
          <button onClick={resumeRecording} className="flex-1 py-1.5 bg-green-600 hover:bg-green-500 rounded font-bold text-white">▶ Resume</button>
          <button onClick={stopRecording} className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 rounded font-bold text-white">■ Stop</button>
        </>)}
        {recordingState === 'replaying' && (
          <button onClick={stopReplay} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded font-bold text-white">■ Stop Replay</button>
        )}
      </div>

      <p className="px-3 pb-2 text-gray-600 text-[10px]">Open DevTools → API Time Machine for full UI</p>
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<Popup />);
