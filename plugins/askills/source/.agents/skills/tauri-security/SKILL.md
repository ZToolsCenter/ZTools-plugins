---
name: tauri-security
description: Harden Tauri 2 applications with capabilities, permissions, scopes, CSP, and trust-boundary review. Use when exposing native APIs, adding plugins, handling untrusted content, or auditing a Tauri app.
---

# Tauri security

Use the official [security model](https://v2.tauri.app/security/) as the source of truth. This guidance is scoped to Tauri 2; verify generated schemas and version-sensitive fields against installed docs.

## Workflow

1. Inventory frontend origins, windows/webviews, commands, plugins, remote content, lifecycle transitions, and data crossing IPC.
2. Define capabilities per window or webview in `src-tauri/capabilities/`. Grant only required permission identifiers and review merged capabilities because permissions combine across matching windows.
3. Add [scopes](https://v2.tauri.app/security/scope/) that constrain resources where supported; enforce validation in Rust as defense in depth. Review [asset protocol](https://v2.tauri.app/security/asset-protocol/) scopes and prevent path traversal or unintended exposure.
4. Configure restrictive [CSP](https://v2.tauri.app/security/csp/) and [HTTP headers](https://v2.tauri.app/security/http-headers/) appropriate to the frontend. Avoid wildcard sources and do not weaken headers to fix unexplained failures.
5. Model [lifecycle threats](https://v2.tauri.app/security/lifecycle/): startup, navigation, window creation, suspend/resume, update/relaunch, crash recovery, and shutdown can change authority or expose stale state.
6. Review [runtime authority](https://v2.tauri.app/security/runtime-authority/) and the [ecosystem](https://v2.tauri.app/security/ecosystem/): audit plugins, dependencies, release/update paths, signing, and provenance as part of the threat model.
7. Treat remote API access as a separate trust boundary. Do not enable remote content or remote API access without explicit origin allowlisting, capability minimization, authentication/authorization, transport security, input validation, and a documented threat model.
8. Test denied access, malformed input, scope escape attempts, navigation, remote content, headers/CSP, update artifacts, and production builds.

## Rules

- Never ship private keys, tokens, or secrets in frontend code or updater artifacts.
- Use [capabilities](https://v2.tauri.app/security/capabilities/) and [permissions](https://v2.tauri.app/security/permissions/) together; neither replaces validation.
- Treat third-party plugins as privileged Rust code and audit their permissions and source.
- Do not grant filesystem, process, shell, or remote authority merely to make a prototype work.
