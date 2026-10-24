---
name: tauri-setup
description: Create, inspect, or migrate Tauri 2 projects and verify their toolchains. Use when starting a Tauri app, adding Tauri to an existing frontend, or diagnosing setup failures.
---

# Tauri setup

This skill is scoped to Tauri 2. Verify version-sensitive fields and commands against the installed CLI and current [official docs](https://v2.tauri.app/start/).

## Workflow

1. Inspect the repository before changing it: frontend package manager/scripts, `src-tauri/Cargo.toml`, `tauri.conf.json`, capabilities, lockfiles, and whether native mobile directories already exist.
2. For a new app, prefer the official scaffold (`npm create tauri-app@latest` or the project's chosen package manager). Confirm the selected frontend template and record the generated commands.
3. Learn the [project structure](https://v2.tauri.app/start/project-structure/): frontend source and build output are separate from `src-tauri/`, which owns Rust, configuration, capabilities, icons, resources, and native targets. Preserve generated boundaries.
4. For an existing frontend, follow [Frontend independent](https://v2.tauri.app/start/frontend/) and make the build command, dev URL, `frontendDist`, and host settings explicit. Do not replace the existing package manager or lockfile.
5. Treat the CLI as the project lifecycle entry point: use installed `tauri dev`, `tauri build`, `tauri android`, and `tauri ios` help to confirm current flags; run dependency install, development, check, and production build commands and report the first actionable failure.
6. For Tauri 1 migrations, inspect the [migration guide](https://v2.tauri.app/start/migrate/from-tauri-1/), capabilities, permissions, config schema, plugin versions, and API imports. Never copy Tauri 1 configuration blindly.
7. Verify Rust, the Tauri CLI, the frontend runtime, WebView dependencies, and desktop/mobile platform prerequisites using the official [prerequisites](https://v2.tauri.app/start/prerequisites/) page. Mobile requires platform-specific Android or Apple toolchains.

## Safe defaults

- Preserve existing lockfiles and package-manager scripts.
- Do not overwrite configuration, native projects, generated icons, or capabilities without inspecting them first.
- Treat generated schemas and plugin versions as authoritative for the installed project; see [version-sensitive guidance](references/version-sensitive.md).
