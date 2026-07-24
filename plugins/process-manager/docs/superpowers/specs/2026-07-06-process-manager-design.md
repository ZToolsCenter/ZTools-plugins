# Process Port Manager — Design Spec

## Overview

A ZTools plugin (utools-like launcher) for searching and killing Windows processes by PID, port number, process name, or file path. Built with React 18 + Vite + TypeScript, following the existing plugin template patterns.

## Architecture

**Approach: React component + preload services backend**

```
preload/services.js          src/ProcessManager/
  listProcesses()              index.tsx (UI component)
  scanPorts()                  index.css
  killProcess(pid)             useProcessData.ts (collection + cache hook)
                               search.ts (smart matching engine)
```

- `services.js` — thin system-command layer, exposes 3 async methods
- React component — state management, search filtering, cache control, rendering
- `search.ts` — pure function: `(keyword, processes) => filtered[]` with auto-detect matching

## Data Flow

```
User types "8080"
    │
    ▼
search.ts smart matching
    │  auto-detects: number → match PID + Port
    ▼
Filter in cached process list
    │
    ├─ click Kill ──► services.killProcess(pid) ──► toast result
    │
    └─ continue typing ──► real-time filter (cache only, no re-collect)
```

**Cache strategy:**
- On feature enter: call `listProcesses()` + `scanPorts()` once
- Merge data by PID into `ProcessInfo[]`
- Cache for 5 seconds
- Within 5s: search filters cache only
- After 5s: auto-refresh on next keystroke

## Preload Services API

```ts
interface ProcessRaw { pid: number; name: string; path: string; status: string }
interface PortEntry  { port: number; pid: number; protocol: string }

services.listProcesses(): Promise<ProcessRaw[]>
services.scanPorts():     Promise<PortEntry[]>
services.killProcess(pid: number): Promise<{ success: boolean; error?: string }>
```

**Windows implementation:**
- `listProcesses` → `tasklist /FO CSV /NH`
- `scanPorts` → `netstat -ano` parse all TCP/UDP (listening + established)
- `killProcess` → `taskkill /PID <pid> /F`, catch error on permission failure

## Smart Matching Engine

Pure function with no side effects. Matching priority:

| Input | Match behavior |
|---|---|
| `8080` (numeric) | Match PID and Port |
| `chrome` (alpha) | Match process name (case-insensitive) |
| `nginx.exe` (has `.exe`) | Match name + path |
| `C:\Users` (has path sep) | Match file path |
| `443 8080` (multiple nums) | Match multiple ports/PIDs |

Sorting: exact match > prefix match > fuzzy contains.

## Core Types

```ts
interface ProcessInfo {
  pid: number
  name: string
  path: string
  ports: number[]
}
```

## UI Layout

```
┌─────────────────────────────────────┐
│ 🔍 搜索进程...                       │
│ [进程名] [PID] [路径...]    [✕]     │
│ 🔌 8080  🔌 443  🔌 3000           │
├─────────────────────────────────────┤
│ [chrome.exe] [1234] 路径...  [✕]    │
│ 🔌 8080  🔌 443                     │
├─────────────────────────────────────┤
│ [node.exe] [5678] 路径...    [✕]    │
│ 🔌 9229                             │
├─────────────────────────────────────┤
│ 共3个结果              5s后自动刷新  │
└─────────────────────────────────────┘
```

- **Row 1**: `[name tag] [PID tag] [path...]` + Kill `✕` button right-aligned, vertically centered
- **Row 2**: Port tags `🔌 port`
- Every info element is clickable to copy its content (toast: "已复制: xxx")
- Search auto-focuses, real-time filtering

## Interaction

- Enter via ZTools command trigger (keywords: `pid`, `port`, `process`, `端口`, `进程`, `进程管理`)
- Kill button click → confirmation dialog → `services.killProcess(pid)` → success/error toast
- Permission errors shown as toast, not thrown

## Theme / Color Scheme

### Light — Blue-Purple (default)
| Element | Background | Text |
|---|---|---|
| Process name tag | `#e8eaf6` | `#283593` |
| PID tag | `#f3e8ff` | `#7c3aed` |
| Port tag | `#eef2ff` | `#4f6ef7` |
| Path | transparent | `#b0b0c0` |
| Search box | `#f0f2f5` | `#333` |
| Kill button | `#fee2e2` | `#ef4444` |
| Kill hover | `#ef4444` | `#fff` |

### Dark — Terminal Green
| Element | Background | Text |
|---|---|---|
| Background | `#0d1117` | — |
| Process name tag | `#1a3a2a` | `#7ee787` |
| PID tag | `#3a2a1a` | `#d29922` |
| Port tag | `#1a2a3a` | `#58a6ff` |
| Path | transparent | `#8b949e` |
| Search box | `#21262d` | `#c9d1d9` |
| Kill button | `#3a1a1a` | `#fca5a5` |
| Kill hover | `#ef4444` | `#fff` |

## Theme Switching

Theme follows the OS-level `prefers-color-scheme` media query. No manual toggle. When the user switches their OS between light/dark mode, the plugin adapts automatically via CSS media queries.

Implementation: define two CSS classless theme blocks scoped by `@media (prefers-color-scheme: light/dark)`.

## YAGNI Exclusions

- No CPU/memory usage display (not needed for port/process search)
- No process status tag (removed as not meaningful)
- No continuous polling — cached 5s refresh only
- No batch kill — single process kill only
- No remote process management — local Windows only

## Files to Create

### New files
- `src/ProcessManager/index.tsx` — main component
- `src/ProcessManager/index.css` — styles
- `src/ProcessManager/search.ts` — matching engine
- `src/ProcessManager/useProcessData.ts` — data hook

### Modified files
- `public/plugin.json` — register new feature with cmds: `pid`, `port`, `process`, `端口`, `进程`, `进程管理`
- `public/preload/services.js` — add listProcesses, scanPorts, killProcess
- `src/App.tsx` — add ProcessManager route
- `src/env.d.ts` — add types for new services
