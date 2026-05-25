# API Time Machine

Record every XHR and fetch call on any web page, then replay any past app state by injecting recorded responses back into the network layer.

---

## Monorepo layout

```
api-time-machine/
├── packages/
│   ├── shared/      TypeScript types shared by vault + extension
│   ├── vault/       Express + SQLite + WebSocket server (port 7842)
│   └── extension/   Chrome MV3 extension (Vite + React + Tailwind)
└── package.json     pnpm workspaces root
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| pnpm | ≥ 9 |
| Chrome | ≥ 110 |

Install pnpm if needed:
```bash
npm i -g pnpm
```

---

## Install

```bash
cd api-time-machine
pnpm install
```

---

## Running the vault server

### Development (hot reload)
```bash
pnpm dev:vault
# → Vault running on :7842
```

### As a globally-installed CLI
```bash
pnpm build:vault
cd packages/vault
npm link           # or: npm install -g .
api-time-machine   # → Vault running on :7842
```

The vault binds to **127.0.0.1:7842 only**. It never listens on 0.0.0.0.  
SQLite database is stored at `~/.api-time-machine/vault.db`.

---

## Building the Chrome extension

```bash
pnpm build:extension
# output → packages/extension/dist/
```

For live rebuild during development:
```bash
pnpm dev:extension
```

---

## Loading the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select `packages/extension/dist/`

The extension icon appears in the toolbar. Click it for a quick status popup.  
Open DevTools on any page → **API Time Machine** tab for the full panel.

---

## Workflow

### Recording

1. Start the vault: `npx api-time-machine`
2. Open any web page
3. Open DevTools → **API Time Machine**
4. Type a session name, click **● REC**
5. Interact with the page — all XHR / fetch traffic is captured
6. Click **■ Stop** when done

### Replay

1. Select a completed session from the dropdown
2. Click **⏪ Replay** to enter replay mode
3. Drag the time scrubber to choose a point in time
4. Click **Restore to this point** — the extension injects the snapshot into every open tab
5. Reload the page — it runs entirely on recorded data
6. Click **■ End Replay** to restore normal network

**Strict mode**: when checked, all unmatched requests are blocked with a 503 so the app runs exclusively on recorded data.

### Diff

Click **⇄ Diff**, select two sessions, click **Diff** — a per-URL recursive JSON diff is rendered inline.

### Export / Import

- **↑ Export**: downloads a `.atm` file (JSON) containing the full session
- **↓ Import**: imports a `.atm` file as a new session

> ⚠ `.atm` files may contain auth tokens, cookies, and other secrets.  
> See [PRIVACY.md](./PRIVACY.md) for handling guidance.

### Redacting secrets before export

Before exporting, use the Redact feature (programmatic via background message) to replace sensitive JSON paths:

```js
chrome.runtime.sendMessage({
  type: 'REDACT_SESSION',
  sessionId: '<id>',
  paths: ['$.token', '$.user.email', '$.data.access_token']
});
```

All matching values across every response in the session are replaced with `[REDACTED]`.

---

## URL match priority (replay)

1. Exact URL (including query string)
2. URL without query string
3. Glob pattern match (`*` wildcard, configurable in replay map)

---

## REST API reference

```
POST   /sessions
GET    /sessions?page=&limit=
GET    /sessions/:id
PATCH  /sessions/:id          { name?, state? }
DELETE /sessions/:id

GET    /sessions/:id/requests?url=&method=&status=&from=&to=&page=&limit=
GET    /sessions/:id/requests/:reqId
GET    /sessions/:id/snapshot?timestamp=
GET    /sessions/:id/export
POST   /sessions/import        body: ATMFile JSON
GET    /sessions/:id/diff/:otherId

GET    /health
```

WebSocket at `ws://127.0.0.1:7842` — messages documented in [packages/vault/src/ws.ts](packages/vault/src/ws.ts).

---

## Performance notes

| Concern | Mitigation |
|---------|-----------|
| 10 000+ timeline rows | `react-window` FixedSizeList — zero DOM nodes for off-screen rows |
| Large response bodies | gzip compressed in SQLite when > 500 KB; lazy-loaded in panel |
| Service worker restart | All state persisted to `chrome.storage.session` on every mutation |
| Vault offline during recording | Up to 50 requests buffered in memory; flushed in a single SQLite transaction on reconnect |
| Binary responses | Detected by Content-Type; stored as base64 string; image preview in inspector |
| Streaming / SSE | All chunks buffered before storage; `streaming` flag shown as `〜` in timeline |

---

## Known limitations

- declarativeNetRequest blocking is limited to 100 URL rules per session (Chrome's per-extension dynamic rule limit is 5 000; the current implementation uses the first 100 URLs in the snapshot).
- XHR binary response capture requires `responseType = 'arraybuffer'` to be set before `send()`; responses where the page did not set this will be captured as text.
- The vault has no authentication. It is strictly localhost-only — do not expose port 7842.
- `.atm` export is never automatic; it always requires an explicit user action.
