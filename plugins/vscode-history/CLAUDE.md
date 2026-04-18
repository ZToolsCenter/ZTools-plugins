# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains two ZTools plugins (not VS Code extensions):

1. **Root project** (`.`) — A Vue 3 + Vite + TypeScript ZTools plugin for searching and opening VSCode/Cursor history projects
2. **Example project** (`example/vscode/`) — Original "vscode next" ZTools plugin (vanilla JS, utools-based, source for migration)

The root project is the migrated version. It uses Vue 3 + Vite + TypeScript and runs as a ZTools plugin.

## ZTools API References

- [`plugin.json` 配置](https://ztoolscenter.github.io/ZTools-doc/plugin-json.html)
- [`preload.js` 配置](https://ztoolscenter.github.io/ZTools-doc/preload-js.html)
- [Node.js 能力](https://ztoolscenter.github.io/ZTools-doc/node-js.html)
- [插件可用 API](https://ztoolscenter.github.io/ZTools-doc/plugin-api.html)
- [ZTools 官方文档](https://github.com/ztool-center/ztools)

## Key Commands

### Root project

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server at localhost:5173
npm run build        # Build production to dist/ (runs vue-tsc then vite build)
```

### example/vscode/

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server
npm run build        # Build: esbuild backend + Vite frontend + copy assets to dist/
```

## Architecture

### Root Project (Vue 3 + Vite + TypeScript)

- **Entry**: `src/main.ts` → `App.vue` → route-based components
- **Routing**: `App.vue` routes to components based on `action.code` from `window.ztools.onPluginEnter()`
- **ZTools manifest**: `public/plugin.json` — features defined with `code`, `cmds`, `explain`, `icon`
- **Node.js bridge**: `public/preload/services.js` — preload script that exposes Node.js APIs via `window.services`
- **SQL.js**: npm package for SQLite operations in preload (WASM-based)
- **TypeScript**: `src/env.d.ts` declares `window.services` and ZTools types

### Component Structure

| Component | Path | Purpose |
|-----------|------|---------|
| VSCodeSearch | `src/VSCodeSearch/index.vue` | Search and open VSCode history projects |
| VSCodeIDE | `src/VSCodeIDE/index.vue` | Manage IDE configurations (add/remove/edit) |

### Core Modules

| Module | Path | Purpose |
|--------|------|---------|
| Types | `src/types.ts` | Type definitions (IDEConfig, SearchItem, etc.) |
| Config | `src/config.ts` | IDE config management (get/save/delete) |

### Preload Services (`public/preload/services.js`)

| Method | Purpose |
|--------|---------|
| `getVSCodeHistory(dbPath)` | Read VSCode history from state.vscdb |
| `deleteVSCodeHistory(dbPath, path)` | Delete single history entry |
| `deleteMultipleVSCodeHistory(dbPath, paths)` | Batch delete history entries |
| `shellExec(cmd, options)` | Execute shell command |
| `getAllDbStorageKeys()` | Get all dbStorage keys |
| `getAllIDEConfigs()` | Get all IDE configurations |
| `saveIDEConfig(config)` | Save IDE configuration |
| `deleteIDEConfig(code)` | Delete IDE configuration |

## Key Files Reference

| File | Purpose |
|------|---------|
| `public/plugin.json` | ZTools plugin manifest (features, preload, logo) |
| `public/preload/services.js` | Node.js bridge — SQL.js, shell exec, DB ops |
| `src/main.ts` | Vue app entry |
| `src/App.vue` | Root component with route logic |
| `src/types.ts` | TypeScript type definitions |
| `src/config.ts` | IDE config management |
| `src/env.d.ts` | TypeScript declarations for window/services |
| `vite.config.js` | Vite config with Vue plugin |
| `tsconfig.json` | TypeScript config with node + ztools types |

## Adding a New Feature

1. Create component in `src/<FeatureName>/index.vue`
2. Add route in `src/App.vue` template and script
3. Add feature entry to `public/plugin.json` `features` array with `code`, `cmds`, `explain`, `icon`

## Adding Node.js Capability to Preload

Edit `public/preload/services.js` to add new functions, then update `src/env.d.ts` with type declarations.

## Current Features (plugin.json)

| Code | Commands | Description |
|------|----------|-------------|
| `vscode` | vscode, 搜索历史项目, vscode-history | Search VSCode history projects |
| `vscode-ide` | vscode-ide, 管理 IDE, 添加 IDE | Manage IDE configurations |
