# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

- **Type**: ZTools Plugin (timestamp conversion tool)
- **Stack**: Vue 3 (Composition API, `<script setup lang="ts">`), Vite 6, TypeScript 5, Tailwind CSS v4
- **Note**: This is a plugin for the ZTools desktop app — it requires the ZTools runtime to function. Dev mode serves from `http://localhost:5173`.

## Build Commands

```bash
npm install     # Install dependencies
npm run dev     # Start dev server (http://localhost:5173)
npm run build   # Production build (runs vue-tsc first, outputs to dist/)
```

No test framework is configured.

## Architecture

### Plugin Routing
The app uses a simple string-based router in `App.vue`. There are no external router libraries — route state is a single `ref<string>`:

1. `window.ztools.onPluginEnter(param)` sets `route.value = param.code`
2. `App.vue` conditionally renders components based on `route`
3. Each feature maps to one Vue component registered in `App.vue`

### Component Structure
```
src/
├── App.vue                         # Root: route state + conditional rendering
├── main.ts                         # Vue app entry
├── main.css                        # Tailwind import + base styles
└── components/
    └── timestamp/
        └── timestamp.vue           # The only feature component (timestamp conversion)
```

### ZTools API (`window.ztools`)
Provided by `@ztools-center/ztools-api-types`. Key methods:
- `onPluginEnter(callback)` — plugin entry point, receives `{ code, ... }`
- `onPluginOut(callback)` — plugin exit
- `getClipboardContent()` — read clipboard
- `hideMainWindow()` / `showTip(msg)` — UI controls

### Preload Services (`window.services`)
Node.js capabilities exposed via `public/preload/services.js`. Call from Vue with `await window.services.someMethod(params)`.

## TypeScript

Strict mode is **disabled** (`strict: false`, `noImplicitAny: false`). Prefer explicit types but avoid excessive `as any`. Target: ES2020, module: ESNext (bundler resolution).

## Styling

Tailwind CSS v4 is used with the Vite plugin (`@tailwindcss/vite`). Import via:
```css
@import 'tailwindcss';
```
Custom base styles are in `src/main.css`. Use utility classes in templates.

## Adding a New Feature

1. **Component**: Create `src/components/<name>/index.vue` using `<script setup lang="ts">`
2. **Route**: Import and add to the conditional render in `App.vue`
3. **Config**: Add feature entry in `public/plugin.json` under `features`, matching `code` to the route name

## Key Files

| File | Purpose |
|------|---------|
| `public/plugin.json` | Plugin metadata, features, commands, development URL |
| `public/preload/services.js` | Node.js service extensions |
| `src/App.vue` | Route registration and conditional rendering |
| `vite.config.js` | Vite + Vue + Tailwind plugins, base path `./` |
