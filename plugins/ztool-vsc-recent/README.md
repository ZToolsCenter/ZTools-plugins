# ztool-vsc-recent

> ZTools plugin: open recent VSCode projects / workspaces / remote sessions, with one keyword.

**Keyword: `vsc` → fuzzy-search list → Enter or click → VSCode opens, plugin auto-hides.**

| | |
|---|---|
| Author | [derekxia1988](https://github.com/derekxia1988) |
| License | [MIT](./LICENSE) |
| Version | 0.1.2 |

## Features

- **Full recent list** — reads VSCode's `workspaceStorage/` directories (the actual list backing *File → Open Recent*), not just the last session.
- **Three kinds**: local folders, multi-root `.code-workspace` files, and Remote / WSL URIs.
- **Sorted by recency** (most recently opened first; ties broken by directory mtime).
- **Filters dead paths** — local folders that no longer exist are dropped automatically.
- **Fuzzy search** — type any substring of the project name or path; matches via `fuse.js`.
- **Keyboard-first** — ↑/↓ to navigate, Enter to open, Esc / `outPlugin` to dismiss.
- **Resilient data layer** — multi-source probes with graceful fallback; if `workspaceStorage` is unreadable, falls back to `state.vscdb` then `storage.json`.

## Install

Once this plugin is accepted into the official [ZTools-plugins](https://github.com/ZToolsCenter/ZTools-plugins) catalog, install it directly from the in-app plugin marketplace.

For early access (or local development) you can side-load it via the **开发者工具** plugin:

1. Install the **开发者工具** plugin in ZTools.
2. Choose *Add Local Plugin* and point it at this project directory.
3. ZTools loads `plugin.json` and registers the `vsc` keyword.

VSCode is discovered automatically from standard installation directories or the `code` command on `PATH`.
On Windows, if a portable or custom installation cannot be found, the plugin asks you to select
`Code.exe` once and stores that path for later launches.
You can also use the **设置 VSCode** button in the plugin page to replace the saved path manually.

## Architecture

```
plugin.json (entry)
  ├── preload.js   ← Node sandbox: reads VSCode storage, launches VSCode without a shell
  │     ├── src/loader/vscode-stable.ts
  │     │     ├── workspace-storage-probe   (primary)
  │     │     ├── state-vscdb-probe         (secondary, sql.js)
  │     │     └── storage-json-probe        (fallback)
  │     └── src/launcher/vscode-stable.ts   (platform-specific executable discovery)
  │
  └── index.html / index.js / index.css  ← sandboxed renderer: list UI, fuzzy search, keyboard nav
```

Each data source returns `RawEntry[]`; `uri-mapper` converts them to `RecentItem[]` (id-keyed, deduplicated, with `kind: folder | workspace | remote`). Local-path existence is checked via injectable `existsCheck` (defaults to `fs.existsSync`).

### Extending to other IDE forks

To add Insiders / Cursor / Windsurf support, drop a new file in `src/loader/` that implements `SourceProbe` for that fork's storage location and register it in `defaultProbes()`. No changes to UI or mapper required.

## Development

```bash
npm install
npm run build    # compile and assemble the production dist directory
npm test         # run the Vitest suite
```

The compiled `.js` files are checked in (ZTools loads them at runtime; per ZTools convention they must not be minified or bundled).

## Specs

- [Design spec](./docs/superpowers/specs/2026-05-21-vsc-recent-design.md)
- [Implementation plan](./docs/superpowers/plans/2026-05-21-vsc-recent-implementation.md)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE) © 2026 derekxia1988
