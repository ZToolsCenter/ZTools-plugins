<div align="center">

# ⚫⚪ Gomoku 3D

**A 3D Gomoku (Five-in-a-Row) game with an AI opponent, replay & game-record export — built with React, Three.js & TypeScript.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646cff.svg)](https://vitejs.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-169-black.svg)](https://threejs.org/)

🎮 **Live Demo:** <https://crper.github.io/gomoku-3d/>

[English](./README.md) · [简体中文](./README.zh.md)

</div>

---

## ✨ Features

- **15×15 Gomoku (Five-in-a-Row)** rendered on an interactive 3D board.
- **AI opponent** with four difficulties — Easy / Medium / Hard / **Master** (a depth-limited alpha-beta negamax search).
- **Dual view modes** — a locked 2D top-down board for clean play, and a free-orbit 3D view, with a smooth camera tween between them.
- **Juicy animations** — stone drop-bounce with dust ripple, hover breathing preview, last-move pulse, victory line shimmer & hop, AI-thinking glow. All respect `prefers-reduced-motion`.
- **Synthesized sound** via the Web Audio API — place / hover / undo / victory / defeat / achievement cues, with a mute toggle. Zero audio asset files.
- **Game stats & achievements** persisted to `localStorage` (wins/losses/draws, win streaks, speed-win, beat-hard, etc.).
- **Undo** a full round (your move + the AI's reply).
- **Replay** any game — step forward/back, jump to any move, play/pause with 0.5×–4× speed, draggable progress bar. A read-only scrubbing mode that leaves the live game untouched.
- **Game-record export** — save a finished or in-progress game as **SGF** (the de-facto standard for Go/Gomoku/Renju software), **JSON**, or human-readable **TXT**, with a custom filename.
- **Fully responsive** — desktop sidebar layout and a mobile bottom action bar, no overlap or overflow.
- **Keyboard shortcuts** and screen-reader-friendly controls (ARIA labels, `aria-live` move info, focus-managed dialogs).

## 🧱 Tech Stack

| Layer | Choice |
| --- | --- |
| UI framework | [React 18](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/) (strict mode) |
| Build tool | [Vite 5](https://vitejs.dev/) |
| 3D rendering | [Three.js](https://threejs.org/) via [`@react-three/fiber`](https://github.com/pmndrs/react-three-fiber) + [`@react-three/drei`](https://github.com/pmndrs/drei) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) + hand-written shadcn/ui-style components |
| Audio | Web Audio API (synthesized — no asset files, no audio dependency) |
| State | React hooks — no external state library |

## 🚀 Getting Started

### Prerequisites

- Node.js **≥ 18** (developed on 22)
- npm

### Install & run

```bash
git clone https://github.com/crper/gomoku-3d.git
cd gomoku-3d
npm install
npm run dev          # http://localhost:5173
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check (`tsc -b`) + production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Run `tsc --noEmit` |

## 🧪 Tests

Tests are plain TypeScript under `scripts/` and run with [esbuild](https://esbuild.github.io/) bundling + Node (no test runner dependency):

```bash
# Engine + AI logic (20 cases)
./node_modules/.bin/esbuild scripts/engine.test.ts --bundle --platform=node --format=esm --outfile=/tmp/e.mjs && node /tmp/e.mjs

# AI strength matrix
./node_modules/.bin/esbuild scripts/strength.test.ts --bundle --platform=node --format=esm --outfile=/tmp/s.mjs && node /tmp/s.mjs

# Replay & export (SGF/JSON/TXT) — 37 cases
./node_modules/.bin/esbuild scripts/replay.test.ts --bundle --platform=node --format=esm --outfile=/tmp/r.mjs && node /tmp/r.mjs

# 50-game self-play simulation (no stalls / illegal moves)
./node_modules/.bin/esbuild scripts/sim.ts --bundle --platform=node --format=esm --outfile=/tmp/sim.mjs && node /tmp/sim.mjs
```

## 🎯 How to Play

- Black moves first. Click any intersection to place your stone.
- Connect **five** of your stones in a row (horizontally, vertically, or diagonally) to win.
- Use the sidebar (desktop) or bottom bar (mobile) to switch difficulty, swap who plays first, toggle 2D/3D, undo, mute, replay, or export.

### Keyboard shortcuts (during replay)

| Key | Action |
| --- | --- |
| `←` / `→` | Previous / next move |
| `Space` | Play / pause |
| `Home` / `End` | First / last move |
| `Esc` | Exit replay |

## 📁 Project Structure

```
src/
├── App.tsx                  # Layout, state wiring, replay/export integration
├── main.tsx                 # Entry
├── components/
│   ├── GameBoard.tsx        # 3D board (R3F) + all stone/board animations
│   ├── ReplayPanel.tsx      # Replay transport controls
│   ├── ExportDialog.tsx     # SGF/JSON/TXT export modal
│   └── ui/                  # Hand-written shadcn/ui-style primitives
├── hooks/
│   ├── useGomoku.ts         # Game state, AI scheduling, stats, sound
│   ├── useReplay.ts         # Read-only replay state machine
│   └── useViewMode.ts       # 2D/3D view persistence
└── lib/
    ├── gomoku/
    │   ├── types.ts         # Board, Move, Player, win detection
    │   ├── engine.ts        # Immutable game state + transitions
    │   ├── ai.ts            # Heuristic + alpha-beta search
    │   ├── replay.ts        # Move derivation & board-at-step
    │   ├── export.ts        # SGF/JSON/TXT serialization + download
    │   └── stats.ts         # Stats & achievements model
    ├── audio/sfx.ts         # Web Audio synthesized SFX
    └── achievementIcons.ts
```

## 📦 Deployment

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the app and deploys `dist/` to **GitHub Pages** on every push to `main`. The Vite base path is derived from `GITHUB_REPOSITORY`, so it works for any repo name.

## 📄 License

[MIT](./LICENSE) © [crper](https://github.com/crper)

<div align="center">

Made with ⚛️ React · 🧊 Three.js · 💛 TypeScript

</div>
