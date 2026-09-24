# BatchStart ZTools Plugins Inclusion — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Include installed ZTools plugins in the app list and launch them via `redirect`.

**Architecture:** Scan `~/.ztools/plugins/*/plugin.json`, merge as `source:'plugin'` apps with `ztools-plugin://{name}` paths; launcher branches to `ztools.redirect`.

**Tech Stack:** Vue 3 + TS + Vite (existing), Node fs in preload/scanner.

## Global Constraints

- Exclude plugins: `setting`, `system`, `batch-start`
- Launch: first usable string cmd via `redirect([title, cmd])`
- Sync on full scan; remove orphan plugin apps + strip from groups

---

### Task 1: Types + plugin scanner + merge/reconcile

- Extend `AppSource` / `AppDoc`
- Add `src/services/scanner/ztoolsPlugins.ts`
- Extend `mergeScannedApps` for plugin source + stable ids
- Reconcile orphans in `runFullScan`
- Tests

### Task 2: Launcher + preload wiring

- Launch targets support plugin redirect
- Update `launchGroupById`
- Tests

### Task 3: UI + version bump

- AppList badge for plugins
- CHANGELOG 0.1.1 / plugin.json versions
- Build + test
