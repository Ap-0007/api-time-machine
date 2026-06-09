<p align="center">
  <img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1a1b27&height=220&section=header&text=api-time-machine&fontSize=58&fontColor=e6edf3&fontAlignY=35&desc=Record%20your%20app%27s%20network%20traffic.%20Replay%20any%20past%20state.%20Debug%20by%20time-traveling.&descSize=13&descAlignY=55&descColor=8b949e&animation=fadeIn" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Chrome_Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/pnpm_Monorepo-F69220?style=for-the-badge&logo=pnpm&logoColor=white&labelColor=0d1117&color=0d1117" />
</p>

---

## ⏰ What is this?

**api-time-machine** is a Chrome extension + local server that **records every XHR and fetch request your app makes**, then lets you replay any past network state on demand.

You're not debugging the current state of your app. You're debugging the *exact state it was in 3 hours ago, during that specific user flow*.

> *Most bugs are time-sensitive. Now you can go back.*

---

## ⚙️ How It Works

```
┌──────────────────────────────────────────────────────────┐
│                   🔌 CHROME EXTENSION                    │
│                                                          │
│  Intercepts all XHR + fetch traffic via DevTools Protocol│
│  ├── Request: method, URL, headers, body                 │
│  ├── Response: status, headers, body                     │
│  └── Timestamp + session metadata                        │
│                                                          │
│  Streams to local server in real-time                    │
└───────────────────────────────┬──────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────┐
│                   🗄️ LOCAL SERVER                        │
│                                                          │
│  Stores traffic snapshots as named sessions              │
│  ├── "session_before_the_crash"                          │
│  ├── "session_checkout_flow_2024_01_15"                  │
│  └── "session_user_reported_bug"                         │
└───────────────────────────────┬──────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────┐
│                   🔁 REPLAY ENGINE                       │
│                                                          │
│  Load any saved session → intercept your app's requests  │
│  → return the RECORDED responses instead of live ones    │
│                                                          │
│  Your app runs exactly as it did at that moment in time  │
└──────────────────────────────────────────────────────────┘
```

---

## 🧱 Tech Stack

| Layer | Technology | Purpose |
|:---|:---|:---|
| **Extension** | Chrome Extension (MV3) | Traffic interception & replay |
| **Language** | TypeScript | Type-safe request/response schemas |
| **Server** | Node.js | Session storage & replay proxy |
| **Monorepo** | pnpm workspaces | Extension + server in one repo |

---

## 🚀 Getting Started

### Prerequisites

```bash
node >= 18.0.0
pnpm >= 8.0.0
Chrome browser
```

### Installation

```bash
git clone https://github.com/Ap-0007/api-time-machine.git
cd api-time-machine

pnpm install

# Build the extension
pnpm build:extension

# Start the local server
pnpm start:server
```

### Load the Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `packages/extension/dist`

---

## 📁 Monorepo Structure

```
api-time-machine/
├── packages/
│   ├── extension/       # Chrome extension (MV3)
│   │   ├── src/
│   │   │   ├── background.ts    # Service worker
│   │   │   ├── content.ts       # Page injection
│   │   │   └── devtools.ts      # DevTools panel
│   │   └── manifest.json
│   └── server/          # Local replay server
│       ├── src/
│       │   ├── recorder.ts      # Session storage
│       │   └── replay.ts        # Proxy engine
│       └── package.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 🏛️ Use Cases

- **Reproduce intermittent bugs** — capture a session when it happens, replay anytime
- **Demo specific flows** — record a perfect user flow, replay it reliably in presentations
- **API contract testing** — record production responses, test against them locally
- **Onboarding** — share a session file so others can see exactly what the app looked like

---

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:58a6ff,60:1f6feb,100:0d1117&height=120&section=footer&animation=fadeIn" width="100%" />
</p>
