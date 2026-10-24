# Handling version-sensitive Tauri guidance

Tauri 2 spans the Rust `tauri` crate, JavaScript packages, the CLI, platform tooling, and separately versioned plugins. Treat generated configuration and plugin permissions as version-sensitive.

Before changing them:

1. Inspect `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json`, and `src-tauri/capabilities/`.
2. Run the repository's package-manager scripts and `cargo metadata` where available.
3. Compare the installed CLI help and generated schemas with the matching page on [v2.tauri.app](https://v2.tauri.app/).
4. Prefer project-generated templates over copied snippets.
5. Record the exact versions in tests, issue reports, or release notes.

Do not imply that a plugin permission, configuration key, platform feature, or command signature exists merely because it existed in Tauri 1 or in another plugin version.
