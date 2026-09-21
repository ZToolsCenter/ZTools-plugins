# Theme & Polish Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Dark-default graphite theme with light toggle and shared UI polish.

**Architecture:** Dual CSS variable sets via `data-theme` on `document.documentElement`; Vue toggle in `App.vue`; `localStorage` persistence.

**Tech Stack:** Vue 3, CSS custom properties, Vite

## Global Constraints

- Default theme: dark
- Storage key: `esclient.theme`
- Accent: neutral graphite (not saturated blue/teal/purple)
- No business logic changes

---

## Task 1: CSS tokens + component token cleanup

**Files:** `src/styles.css`, `src/components/LoadingMask.vue`

- [ ] Replace `:root` with dark defaults + `[data-theme="light"]` overrides
- [ ] Wire btn hover, table header/hover, danger/warn borders, json-view to tokens
- [ ] LoadingMask uses `--mask`, `--spinner-track`, `--shadow`

## Task 2: Theme toggle in App

**Files:** `src/App.vue`

- [ ] On mount: read storage, apply `data-theme`, default dark
- [ ] Header actions: 深色 / 浅色 toggle
- [ ] Polish header layout (brand row with toggle)

## Task 3: Version bump + pack

**Files:** `package.json`, `src-ztools/plugin.json`, `CHANGELOG.md`

- [ ] Bump `0.1.2`
- [ ] `npm test` + `npm run pack`
