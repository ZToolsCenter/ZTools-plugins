# Upstream Differences

This project is based on [stevebauman/showcode](https://github.com/stevebauman/showcode), licensed under the MIT License.

The comparison below uses upstream `stevebauman/showcode` at commit `a19c9f9`.

## Architecture

- Upstream is a Nuxt 4 application with source code under `app/`.
- This project is a Vue 3 + Vite ZTools plugin with source code under `src/`.
- `src/nuxt-compat.ts` provides small compatibility helpers for code that originally used Nuxt-style APIs.
- `src/App.vue` renders `src/pages/index.vue` directly instead of using `NuxtPage`.

## ZTools Integration

- Added `public/plugin.json` for ZTools metadata, command triggers, preload entry, logo, and development URL.
- Added `public/preload/services.js` to expose local capabilities through `window.services`.
- Added local file operations for reading files, writing exported JSON, saving generated images, and listing system fonts.
- The app sets the ZTools window height through `window.ztools?.setExpendHeight`.
- Export flows prefer ZTools preload file writes and fall back to browser downloads when preload APIs are unavailable.

## Removed Web-App Features

- Removed Nuxt routes that are not needed inside ZTools, including `download.vue` and `generator.vue`.
- Removed API export and API documentation links from the UI.
- Removed web-app-only elements such as `GitHubCorner`, `ModalChangelog`, Nuxt plugins, PWA setup, and OG image components.
- Removed upstream content files for the public website, such as changelog and help content under the Nuxt app content system.

## Dependency Changes

- Removed Nuxt ecosystem dependencies such as `nuxt`, `@pinia/nuxt`, `@vite-pwa/nuxt`, `nuxt-og-image`, and `shadcn-nuxt`.
- Removed upstream web/API/test/rendering dependencies that are not used by the plugin, such as `satori`, `@resvg/resvg-js`, `vitest`, and `happy-dom`.
- Added Vite plugin project dependencies such as `vite`, `@vitejs/plugin-vue`, `vue-tsc`, `typescript`, `unplugin-vue-components`, and `@ztools-center/ztools-api-types`.

## Build And Packaging

- Upstream builds with Nuxt scripts such as `nuxt build` and `nuxt generate`.
- This project builds with `vite build`.
- `npm run package` builds the plugin and creates `showcode-v1.0.0.zip` in the project root.
- Build output is generated in `dist/`.

## Documentation And License

- `README.md` now documents the ZTools plugin usage, commands, build flow, and upstream source.
- `LICENSE` preserves the upstream MIT License text and copyright notice.
- This file records the main migration differences for maintainers and reviewers.
