# BatchStart: Include Installed ZTools Plugins — Design Spec

**Date:** 2026-09-17  
**Status:** Approved for planning  
**Project:** `zTools-BatchStart`

## 1. Goal

Extend the application list so that **installed ZTools plugins** appear alongside scanned/manual apps, can be categorized and added to launch groups, and open via ZTools redirect when a group runs.

## 2. Decisions (locked)

| Topic | Choice |
|-------|--------|
| Discovery | Scan `~/.ztools/plugins/*/plugin.json` (no internal API) |
| Launch | Open plugin default entry via `ztools.redirect` using first usable text command |
| Inclusion | All installed plugins **except** `setting`, `system`, and `batch-start` |
| Sync timing | During existing full scan (same 「扫描」 action) |

## 3. Data model

### 3.1 `AppSource`

```ts
type AppSource = 'scan' | 'manual' | 'plugin'
```

### 3.2 Plugin app document

Reuse `AppDoc` with:

| Field | Value |
|-------|--------|
| `_id` | Stable `app:plugin:{pluginName}` (or existing id helper + plugin prefix) |
| `name` | `plugin.json.title` (fallback `name`) |
| `path` | Pseudo URI `ztools-plugin://{pluginName}` |
| `source` | `'plugin'` |
| `icon` | Resolved logo path or data URL when readable; else `null` |
| `categoryId` | Unchanged merge rules (preserve user category on rescan) |
| `platform` | Current host platform |

Optional persisted meta (either embed on doc or derive at launch from path + cached fields):

- `pluginName`: string  
- `launchCmd`: first divertible text cmd string  
- `pluginTitle`: title used for `redirect([title, cmd])`

If a plugin has **no** usable string command on any feature, still list it but mark launch as unavailable (skip with error on group launch).

### 3.3 Divertible command

A cmd is usable when it is a non-empty `string`. Object cmds (`regex`, `img`, etc.) are skipped for default launch.

Selection order: first feature in `features[]`, then first usable string in that feature’s `cmds[]`. If none, try subsequent features.

## 4. Discovery & merge

### 4.1 Roots

- Primary: `path.join(os.homedir(), '.ztools', 'plugins')`
- Each immediate child directory: if `plugin.json` exists and parses, treat as one plugin

### 4.2 Filters

Skip when `plugin.json.name` is in:

- `setting`
- `system`
- `batch-start`

Also skip unreadable / invalid JSON (log once, continue).

### 4.3 Merge with `AppLibrary`

- Upsert plugin apps like scanned apps (case-insensitive path / stable id)
- On full scan completion: remove DB docs with `source === 'plugin'` whose plugin is no longer present
- When removing, also strip those `appIds` from all `GroupDoc`s and re-sync features for affected groups

## 5. Launch path

Update `launchGroupApps` / group launch:

1. Resolve each app id → `AppDoc`
2. If `path.startsWith('ztools-plugin://')` (or `source === 'plugin'`):
   - Call `ztools.redirect([pluginTitle, launchCmd])` or `ztools.redirect(launchCmd)` if title missing
   - Treat falsy return as failure for that item
3. Else: existing `ztools.shellOpenPath(path)`

Batch launch remains near-simultaneous (`Promise.all`); redirect and shell opens run in parallel.

「试跑当前组」 uses the same launcher.

## 6. UI

- App list: small source badge/label for plugin rows (e.g. 「插件」)
- Path column may show plugin id / title instead of filesystem path
- Scan toast/summary may include plugin count: e.g. scanned N apps including M plugins
- No new tab required

## 7. Out of scope

- Privilege / `ztools.internal.getAllPlugins`
- Per-plugin custom command picker in UI (v1 uses first string cmd only)
- Opening a specific non-default feature from the group editor
- Watching plugins folder live without scan (rescan refreshes)

## 8. Acceptance

1. After scan, installed third-party plugins appear in the app list (minus exclusions).
2. Plugin can be categorized and added to a launch group.
3. Running the group opens the plugin UI via redirect for plugin members and native apps via shell for others.
4. Uninstalling a plugin + rescan removes it from the list and from groups.
5. Existing scan/manual apps behavior unchanged.

## 9. Implementation notes

- Add `src/services/scanner/ztoolsPlugins.ts` (or similar) returning `ScannedApp[]`-compatible shapes with `source: 'plugin'` once types allow — or a dedicated merge step after filesystem scan
- Unit tests: filter exclusions, first-cmd selection, merge/remove orphan plugins, launcher branch for `ztools-plugin://`
- Bump patch version + CHANGELOG when shipping
