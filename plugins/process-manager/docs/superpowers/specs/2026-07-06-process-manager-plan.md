# Process Port Manager — Implementation Plan

## Step 1: preload services (`public/preload/services.js`)
- Add `listProcesses()` using `tasklist /FO CSV /NH` (Windows)
- Add `scanPorts()` using `netstat -ano` parsing
- Add `killProcess(pid)` using `taskkill /PID <pid> /F`
- Wrap all in try/catch, return structured results

## Step 2: type declarations (`src/env.d.ts`)
- Add `ProcessRaw`, `PortEntry`, `ProcessInfo` interfaces
- Extend `Window.services` with new methods

## Step 3: plugin config (`public/plugin.json`)
- Register new feature `code: "process"` with cmds: `pid`, `port`, `process`, `端口`, `进程`, `进程管理`

## Step 4: smart matching engine (`src/ProcessManager/search.ts`)
- Pure function `searchProcesses(keyword, list): ProcessInfo[]`
- Numeric detection → match PID + Port
- Alpha detection → match name (case-insensitive)
- Path detection → match path
- Multiple values → OR match
- Sort: exact > prefix > fuzzy

## Step 5: data hook (`src/ProcessManager/useProcessData.ts`)
- On mount: call `services.listProcesses()` + `services.scanPorts()`
- Merge by PID into `ProcessInfo[]`
- Cache with 5s TTL
- Expose `processes`, `loading`, `refresh`, `lastFetched`

## Step 6: UI component (`src/ProcessManager/index.tsx` + `index.css`)
- Search input (auto-focus, controlled)
- Result list with items showing: [name tag] [PID tag] [path...] + Kill button
- Port tags on second row
- Click-to-copy on each info element
- Kill confirmation → call services.killProcess
- Theme light/dark via `prefers-color-scheme`
- Footer with count + refresh timer

## Step 7: routing (`src/App.tsx`)
- Import ProcessManager
- Add route `process` → ProcessManager

## Step 8: verify
- `npm run build` passes
- UI matches mockups
