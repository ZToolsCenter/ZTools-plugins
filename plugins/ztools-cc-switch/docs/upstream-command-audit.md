# cc-switch 3.18.0 command-level audit

Baseline: commit `a377d79303bc1e592d2783d559ca5bd6b8ba1417`.

The audit extracts every `#[tauri::command]` under `src-tauri/src/commands`. The current baseline contains 276 commands in 29 source domains. A domain is only marked covered when its behavior is represented by a Preload capability or an explicit ZTools host replacement and has relevant automated evidence. This document does not treat a similarly named UI as proof.

| Upstream command domain | Count | Current evidence | Audit state |
| --- | ---: | --- | --- |
| balance | 1 | `balanceManager.js` and native-provider tests | covered |
| coding_plan | 1 | `codingPlanManager.js` and SigV4/quota tests | covered |
| config | 14 | fixed client paths/status, ZTools picker/open-path, common snippets/TOML transform | covered |
| copilot | 15 | `authManager.js`, account/model/quota flows | covered |
| deeplink | 4 | parse, redacted preview, one-time confirmation import | covered |
| env | 3 | scan, recoverable repair, restore | covered |
| failover | 6 | explicit per-app queue, available Provider list, add/remove, guarded enable/disable, automatic retry | covered |
| global_proxy | 5 | HTTP(S)/SOCKS/system proxy, scan and test | covered |
| hermes | 10 | live providers, memory, model, Web UI/dashboard | covered |
| import_export | 11 | portable backup, local snapshots and ZTools dialogs | covered |
| lightweight | 3 | ZTools Webview/host lifecycle replacement | host replacement |
| mcp | 14 | unified CRUD, per-app projection, six-app import, Claude status/redacted config, PATH validation | covered |
| misc | 12 | tool lifecycle/terminal plus explicit ZTools Shell/clipboard/update/window replacements | covered / host replacement |
| omo | 6 | standard/slim local read, activate and disable | covered |
| openclaw | 14 | live providers, model catalog, agents/tools/env/health | covered |
| plugin | 6 | Claude onboarding and plugin integration | covered |
| profile | 6 | CRUD, apply, clear and autosave | covered |
| prompt | 6 | CRUD/enable plus fixed global-file read and import | covered |
| provider | 30 | CRUD/switch/import, universal, endpoints, usage script, additive live fragments | covered |
| proxy | 24 | router lifecycle, takeover, optimizer, pricing, circuit breaker | covered |
| s3_sync | 5 | settings, test, manifest upload/download/info | covered |
| session_manager | 5 | seven-app list/read/delete/batch delete/terminal | covered |
| settings | 19 | scoped managers for logs/optimizer/history/config override; restart/update/autolaunch delegated to ZTools | covered / host replacement |
| skill | 24 | repositories, discovery/search, storage migration, app sync, ZIP, backups | covered |
| stream_check | 4 | config, one/all Provider reachability | covered |
| subscription | 1 | official quota manager | covered |
| usage | 14 | logs/detail/summary/trends/stats/pricing/import/recoverable Codex rebuild | covered |
| webdav_sync | 5 | settings, test, upload/download/info | covered |
| workspace | 8 | Workspace and Daily Memory CRUD/search/trash/open | covered |

### Usage command evidence

| Upstream command | Current implementation |
| --- | --- |
| `get_usage_summary` / `get_usage_summary_by_app` | `activityStore.summary()` / `summaryByApp()` |
| `get_usage_trends` / `get_provider_stats` / `get_model_stats` | `activityStore.trends()` / `providerStats()` / `modelStats()` |
| `get_request_logs` / `get_request_detail` | `activityStore.paginated()` / `detail()` and bounded Preload aliases |
| `get_model_pricing` / `update_model_pricing` / `delete_model_pricing` | Built-in plus custom pricing, validation and missing-cost backfill in `activityStore.js` |
| `check_provider_limits` | Local-day/local-month exact accumulation in `activityStore.checkProviderLimits()` |
| `sync_session_usage` | Serialized incremental cursors and stable-ID import in `usageImportManager.sync()` |
| `rebuild_codex_usage` | Serialized full Codex scan; recoverable log/state backups; target-only `codex_session` and cursor replacement |
| `get_usage_data_sources` | `activityStore.dataSources()` exposed by `getUsageImportStatus` |

The usage domain is covered by `activityStore.test.cjs`, `usageImportManager.test.cjs`, the Preload bridge, and wide/narrow Usage UI regression.

### Config command evidence

| Upstream command(s) | Current implementation |
| --- | --- |
| `get_claude_config_status`, `get_config_status`, `get_claude_code_config_path`, `get_config_dir` | `configManager.getClientStatus()` plus fixed `getClientConfigDirectoryInfo()`; Settings renders every known file and existence state |
| `open_config_folder` | Client-ID whitelist resolves the fixed primary directory, then borrows ZTools `shellOpenPath`; Claude never widens to the Home directory |
| `pick_directory` | ZTools `showOpenDialog` through `chooseAppConfigDirectory` |
| `get_app_config_path`, `open_app_config_folder` | Active ZTools user-data path through `getAppConfigDirOverride` and bounded `openAppDataDirectory` |
| `get_claude_common_config_snippet`, `set_claude_common_config_snippet` | Backward-compatible behavior through generic `get/setCommonConfigSnippet('claude')` |
| `get_common_config_snippet`, `set_common_config_snippet` | `configManager` JSON/TOML validation, old-value removal and active Provider reapply |
| `update_toml_common_config_snippet` | Rust sidecar `toml_edit` operation used by Config Manager and integration-tested for comment/key-order preservation |
| `extract_common_config_snippet` | Fixed live-file extraction with credential/endpoint/model/MCP filtering; no arbitrary path input is accepted |

### Misc command evidence

| Upstream command(s) | Current implementation / ZTools replacement |
| --- | --- |
| `open_external` | HTTPS-only `openExternal` borrowing ZTools `shellOpenExternal` |
| `copy_text_to_clipboard` | Length-bounded `copyText` borrowing ZTools clipboard, with Electron host fallback |
| `check_for_updates` | ZTools owns plugin updates; rules use the separate npmmirror updater |
| `is_portable_mode` | Independent executable mode is removed; ZTools userData plus validated directory override provides portable/shared placement |
| `get_init_error` | There is no monolithic Tauri/SQLite startup migration; manager errors remain structured at the responsible Preload call, and sidecar availability is exposed in runtime status |
| `get_migration_result`, `get_skills_migration_result` | Migration outcomes are returned directly by Codex History and Skills actions instead of process-global one-shot flags |
| `get_tool_versions`, `probe_tool_installations`, `run_tool_lifecycle_action` | `toolManager.js`, executable anchoring and lifecycle tests |
| `open_provider_terminal` | Fixed-client `terminalManager.js` with generated environment whitelist and ZTools-selected working directory |
| `set_window_theme` | ZTools owns the native window; Webview theme is independently stored in ZTools `dbStorage`, defaults to light, and supports system/dark modes |

### Settings command evidence

| Upstream command(s) | Current implementation / ZTools replacement |
| --- | --- |
| `get_settings`, `save_settings` | Split into least-authority managers for proxy, cloud sync, startup, logs, Router, history and data directory instead of one oversized settings object |
| `has_codex_unify_history_backup`, `restore_codex_unified_history` | `codexHistoryManager.getStatus()` / `disable({ restoreBackup: true })`, JSONL ledger and SQLite Online Backup tests |
| `restart_app` | ZTools owns plugin/Webview lifecycle; directory override is applied when the plugin is reopened |
| `install_update_and_restart`, `check_app_update_available` | ZTools plugin-center update lifecycle |
| `get_app_config_dir_override`, `set_app_config_dir_override` | ZTools `dbStorage`, realpath/directory/access validation and restart-required UI state |
| `set_auto_launch`, `get_auto_launch_status` | ZTools owns OS login startup; `hostStartupManager` only restores opted-in Router state on Preload/plugin entry |
| `get/set_rectifier_config`, `get/set_optimizer_config`, `get/set_copilot_optimizer_config` | Scoped portions of `routerManager.status()` / `saveConfig()` with Router UI controls |
| `get_log_config`, `set_log_config` | `logManager.getConfig()` / `saveConfig()`, redaction, rotation and recoverable cleanup tests |

Config, misc and settings now have command-level mappings. No command remains in the “verifying aliases” state; shell-only responsibilities are explicitly assigned to ZTools rather than reimplemented inside the plugin.
