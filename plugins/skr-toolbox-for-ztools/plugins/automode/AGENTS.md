# Repository Guidelines

## Project Structure & Module Organization
`plugin.json` defines the ZTools plugin manifest. `preload.js` is the main integration layer: it manages Windows scheduled tasks, PowerShell scripts, location lookup, and theme switching. `index.html` contains the plugin UI and inline styles/scripts. Put reusable pure logic in [`lib/utils.js`](lib/utils.js) so it stays testable. Tests live in `test/` and currently cover time math and XML/script generation. `logo.png` is the shipped asset, and `AutoMode.zpx` is the packaged output, not source.

## Build, Test, and Development Commands
This repo does not use `package.json`; run tools directly from the repo root.

- `node --test test\utils.test.js test\time-calc.test.js`: run the current Node built-in test suite.
- `node pack.js`: build `AutoMode.zpx` by invoking `_pack.ps1`.
- `powershell -ExecutionPolicy Bypass -File .\_pack.ps1`: package directly when debugging the archive step.

Use Windows when validating runtime behavior because scheduled tasks, registry edits, and PowerShell are core to the plugin.

## Coding Style & Naming Conventions
Follow the existing JavaScript style: 2-space indentation, semicolons, CommonJS modules (`require`, `module.exports`), and straightforward control flow. Use `camelCase` for functions and variables, `SCREAMING_SNAKE_CASE` for constants such as task names, and keep UI IDs descriptive (`sunToggle`, `themeValue`). Prefer pure helpers in `lib/` over embedding logic in `index.html` or `preload.js`.

## Testing Guidelines
Use Node's built-in `node:test` with `node:assert/strict`. Name test files `*.test.js` and write case names in `should ...` form. Add deterministic tests for any change to time calculations, XML generation, PowerShell script output, or validation logic. For Windows-only integration changes, include manual verification notes for Scheduled Tasks, registry updates, and sunrise/sunset flows.

## Commit & Pull Request Guidelines
No `.git` metadata is present in this workspace snapshot, so no local history is available to infer conventions. Use short, imperative commit subjects, preferably with a scope, for example `fix: wrap midnight offset correctly` or `docs: clarify packaging steps`. Pull requests should summarize user-visible behavior, list verification steps, link related issues, and include screenshots when `index.html` UI changes.

## Security & Configuration Tips
Keep Windows-specific behavior explicit. Avoid hardcoding user-specific absolute paths outside packaging scripts, and document any new external API dependency before adding it. Never commit secrets or machine-local tokens.
