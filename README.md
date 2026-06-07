<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1a1b27&height=220&section=header&text=API%20TIME%20MACHINE&fontSize=55&fontColor=e6edf3&fontAlignY=35&desc=Record%20%E2%80%A2%20Replay%20%E2%80%A2%20Time-Travel%20Any%20App%20State&descSize=16&descAlignY=55&descColor=8b949e&animation=fadeIn" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Chrome_Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white&labelColor=0d1117&color=0d1117" />
</p>

---

## ⏳ What is this?

**API Time Machine** is a Chrome extension paired with a local server that **records every XHR and fetch request** your browser makes — then lets you **replay any past state** of your application on demand.

Found a bug that only happened at 3:47 PM yesterday? Rewind to exactly that moment. The extension intercepts live network traffic and replays the recorded responses, putting your app back into the exact state it was in.

No more "it works on my machine." No more "I can't reproduce it." Just pick a timestamp and watch.

> *Debug by time-traveling, not by guessing.*

### Key Features

- 🎥 **Record** — Silently captures all XHR/fetch traffic with timestamps
- ⏪ **Replay** — Intercept live requests and serve recorded responses instead
- 🕐 **Time-travel** — Scrub to any point in time and see app state at that moment
- 🏗️ **Monorepo** — Clean separation between extension and server packages

---

## ⚙️ How It Works

```
┌──────────────────────────────────────────────────────────┐
│                 🌐 YOUR WEB APP                          │
│                                                          │
│  fetch("/api/users")  ──┐                                │
│  xhr.open("GET", ...)  ─┤                                │
│  fetch("/api/data")   ──┘                                │
└─────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│            🔌 CHROME EXTENSION (Interceptor)             │
│                                                          │
│  ┌──────────┐                         ┌──────────┐      │
│  │ 🔴 REC   │  Intercepts all         │ ⏪ PLAY  │      │
│  │ Mode     │  network traffic        │ Mode     │      │
│  └────┬─────┘                         └────┬─────┘      │
│       │ Records request + response         │ Serves     │
│       │ with timestamp                     │ recorded   │
│       │                                    │ responses  │
└───────┼────────────────────────────────────┼────────────┘
        │                                    │
        ▼                                    ▲
┌──────────────────────────────────────────────────────────┐
│               💾 LOCAL SERVER (Storage)                   │
│                                                          │
│  Timeline: ─────●────●──●───────●────●──▶               │
│              3:41  3:43  3:47   4:02  4:15               │
│                          ▲                               │
│                     "Bug was HERE"                        │
│                                                          │
│  Stores full request/response pairs with timestamps      │
│  Serves recorded data back on replay                     │
└──────────────────────────────────────────────────────────┘
```

---

## 🧱 Tech Stack

| Layer | Technology | Purpose |
|:------|:-----------|:--------|
| **Extension** | Chrome Extensions API | Network interception & UI |
| **Server** | Node.js | Traffic storage & replay serving |
| **Language** | TypeScript | Type-safe across all packages |
| **Monorepo** | pnpm Workspaces | Multi-package management |
| **Build** | TypeScript Compiler | Package builds |

---

## 🚀 Getting Started

### Prerequisites

```bash
node >= 18.0.0
pnpm >= 8.0.0
Google Chrome
```

### Installation

```bash
# Clone the repository
git clone https://github.com/Ap-0007/api-time-machine.git
cd api-time-machine

# Install all packages
pnpm install

# Build all packages
pnpm build

# Start the local server
pnpm --filter server start
```

### Loading the Chrome Extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `packages/extension/dist` directory
5. The API Time Machine icon appears in your toolbar

---

## 📁 Project Structure

```
api-time-machine/
├── packages/               # pnpm monorepo packages
│   ├── extension/          # Chrome extension
│   │   ├── src/            # Extension source
│   │   ├── manifest.json   # Chrome manifest
│   │   └── package.json    # Extension dependencies
│   ├── server/             # Local recording server
│   │   ├── src/            # Server source
│   │   └── package.json    # Server dependencies
│   └── shared/             # Shared types & utilities
│       └── package.json    # Shared dependencies
├── PRIVACY.md              # Privacy policy
├── pnpm-workspace.yaml     # Workspace configuration
└── package.json            # Root package
```

---

## 🔒 Privacy

API Time Machine runs **entirely locally**. All recorded traffic stays on your machine. No data is ever transmitted to external servers. See [PRIVACY.md](PRIVACY.md) for full details.

---

## 🤝 Contributing

If you've ever lost hours trying to reproduce a bug, this project needs your empathy and your code.

```bash
# Fork the repo
# Create your feature branch
git checkout -b feat/your-feature

# Commit your changes
git commit -m "feat: add your feature"

# Push and open a PR
git push origin feat/your-feature
```

---

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-e6edf3?style=flat-square&labelColor=0d1117&color=161b22" />
</p>

<p align="center">
  <sub>Built by <a href="https://github.com/Ap-0007">vanta.nox</a> · bugs exist in time, now you can too</sub>
</p>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1a1b27&height=100&section=footer" width="100%" />
