// Runs in PAGE WORLD — no chrome.* APIs available.
// Must remain self-contained after bundling.
export {};

type ReplayMap = Record<string, { status: number; headers: Record<string, string>; body: string }>;

declare global {
  interface Window {
    __ATM_REPLAY_MAP__?: ReplayMap;
    __ATM_STRICT_MODE__?: boolean;
  }
}

const BINARY_TYPES = ['image/', 'font/', 'application/wasm', 'application/octet-stream', 'audio/', 'video/'];

function isBinary(contentType: string): boolean {
  return BINARY_TYPES.some(t => contentType.includes(t));
}

function matchGlob(pattern: string, url: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(url);
}

function findReplay(url: string): ReplayMap[string] | null {
  const map = window.__ATM_REPLAY_MAP__;
  if (!map) return null;
  if (map[url]) return map[url];
  try {
    const u = new URL(url);
    const noQuery = url.slice(0, url.length - u.search.length);
    if (map[noQuery]) return map[noQuery];
  } catch {}
  for (const pattern of Object.keys(map)) {
    if (pattern.includes('*') && matchGlob(pattern, url)) return map[pattern];
  }
  return null;
}

function postCapture(payload: object): void {
  window.postMessage({ __ATM__: true, type: 'FETCH_CAPTURED', payload }, '*');
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

const _fetch = window.fetch.bind(window);

window.fetch = async function atm_fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : (input as Request).url;

  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const replay = findReplay(url);

  if (replay) {
    postCapture({ url, method, requestHeaders: {}, requestBody: null, status: replay.status, responseHeaders: replay.headers, responseBody: replay.body, duration: 0, timestamp: Date.now(), streaming: false, __replayed: true });
    return new Response(replay.body, { status: replay.status, headers: replay.headers });
  }

  const reqHeaders: Record<string, string> = {};
  try {
    const h = init?.headers;
    if (h instanceof Headers) h.forEach((v, k) => { reqHeaders[k] = v; });
    else if (Array.isArray(h)) h.forEach(([k, v]) => { reqHeaders[k] = v; });
    else if (h) Object.assign(reqHeaders, h);
  } catch {}

  let reqBody: string | null = null;
  try {
    const b = init?.body ?? (input instanceof Request ? input.body : null);
    if (typeof b === 'string') reqBody = b;
    else if (b instanceof URLSearchParams) reqBody = b.toString();
    else if (b instanceof FormData) reqBody = '[FormData]';
    else if (b instanceof ArrayBuffer || ArrayBuffer.isView(b as any)) reqBody = '[Binary]';
  } catch {}

  const t0 = Date.now();
  const response = await _fetch(input, init);
  const duration = Date.now() - t0;
  const cloned = response.clone();
  const ct = cloned.headers.get('content-type') || '';
  const resHeaders: Record<string, string> = {};
  cloned.headers.forEach((v, k) => { resHeaders[k] = v; });

  let responseBody = '';
  let streaming = false;

  try {
    if (ct.includes('text/event-stream')) {
      streaming = true;
      const reader = cloned.body?.getReader();
      if (reader) {
        const dec = new TextDecoder();
        const chunks: string[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(dec.decode(value, { stream: true }));
        }
        chunks.push(dec.decode());
        responseBody = chunks.join('');
      }
    } else if (isBinary(ct)) {
      const buf = await cloned.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      responseBody = '[base64]' + btoa(bin);
    } else {
      responseBody = await cloned.text();
    }
  } catch {}

  postCapture({ url, method, requestHeaders: reqHeaders, requestBody: reqBody, status: response.status, responseHeaders: resHeaders, responseBody, duration, timestamp: t0, streaming });
  return response;
};

// ─── XMLHttpRequest ───────────────────────────────────────────────────────────

const NativeXHR = window.XMLHttpRequest;

class ATMXHR extends NativeXHR {
  private _atmUrl = '';
  private _atmMethod = 'GET';
  private _atmReqBody: string | null = null;
  private _atmT0 = 0;
  private _atmReqHeaders: Record<string, string> = {};
  private _atmReplay: ReplayMap[string] | null = null;

  open(method: string, url: string, async = true, user?: string | null, password?: string | null): void {
    this._atmMethod = method.toUpperCase();
    this._atmUrl = url;
    super.open(method, url, async, user ?? undefined, password ?? undefined);
  }

  setRequestHeader(name: string, value: string): void {
    this._atmReqHeaders[name] = value;
    super.setRequestHeader(name, value);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    if (body !== undefined && body !== null) {
      if (typeof body === 'string') this._atmReqBody = body;
      else if (body instanceof URLSearchParams) this._atmReqBody = body.toString();
      else if (body instanceof FormData) this._atmReqBody = '[FormData]';
      else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) this._atmReqBody = '[Binary]';
    }

    this._atmReplay = findReplay(this._atmUrl);
    if (this._atmReplay) {
      const entry = this._atmReplay;
      Object.defineProperty(this, 'status', { get: () => entry.status, configurable: true });
      Object.defineProperty(this, 'readyState', { get: () => 4, configurable: true });
      Object.defineProperty(this, 'responseText', { get: () => entry.body, configurable: true });
      Object.defineProperty(this, 'response', { get: () => entry.body, configurable: true });
      const headersStr = Object.entries(entry.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      Object.defineProperty(this, 'getAllResponseHeaders', { value: () => headersStr, configurable: true });

      queueMicrotask(() => {
        postCapture({ url: this._atmUrl, method: this._atmMethod, requestHeaders: this._atmReqHeaders, requestBody: this._atmReqBody, status: entry.status, responseHeaders: entry.headers, responseBody: entry.body, duration: 0, timestamp: Date.now(), streaming: false, __replayed: true });
        this.dispatchEvent(new Event('readystatechange'));
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange(new Event('readystatechange') as any);
        this.dispatchEvent(new ProgressEvent('load', { loaded: entry.body.length, total: entry.body.length }));
        this.dispatchEvent(new ProgressEvent('loadend'));
      });
      return;
    }

    this._atmT0 = Date.now();

    this.addEventListener('readystatechange', () => {
      if (this.readyState !== 4) return;
      const duration = Date.now() - this._atmT0;
      const ct = this.getResponseHeader('content-type') || '';
      const resHeaders: Record<string, string> = {};
      this.getAllResponseHeaders().trim().split('\r\n').forEach(line => {
        const idx = line.indexOf(': ');
        if (idx > -1) resHeaders[line.slice(0, idx)] = line.slice(idx + 2);
      });
      let responseBody = this.responseText || '';
      if (isBinary(ct) && this.responseType === 'arraybuffer' && this.response instanceof ArrayBuffer) {
        const bytes = new Uint8Array(this.response as ArrayBuffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        responseBody = '[base64]' + btoa(bin);
      }
      postCapture({ url: this._atmUrl, method: this._atmMethod, requestHeaders: this._atmReqHeaders, requestBody: this._atmReqBody, status: this.status, responseHeaders: resHeaders, responseBody, duration, timestamp: this._atmT0, streaming: false });
    });

    super.send(body as any);
  }
}

window.XMLHttpRequest = ATMXHR as unknown as typeof XMLHttpRequest;
