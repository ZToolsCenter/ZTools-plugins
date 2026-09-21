# ESClient Theme & Polish Design

**Date:** 2026-09-16  
**Status:** Approved — execute directly

## Goal

Default dark graphite theme with light toggle; restyle shared UI tokens for a restrained IDE-like look.

## Approach

CSS variables on `html[data-theme="dark|light"]`. Toggle in app header; persist `localStorage` key `esclient.theme`. Default `dark`.

## Tokens

| Token | Dark | Light |
|-------|------|-------|
| `--bg` | `#0f1115` | `#f3f4f6` |
| `--surface` | `#181b21` | `#ffffff` |
| `--surface-2` | `#1e2229` | `#f8f9fb` |
| `--border` | `#2a2f38` | `#e2e5ea` |
| `--text` | `#e6e8ec` | `#1c1f26` |
| `--muted` | `#9aa3af` | `#6b7280` |
| `--accent` | `#a8b4c4` | `#4b5568` |
| `--accent-fg` | `#0f1115` | `#ffffff` |
| `--danger` / `--ok` / `--warn` | low-sat semantic | same family, theme-aware bg |
| `--selected` | `#252a33` | `#e8eaee` |
| `--mask` | `rgba(15,17,21,0.72)` | `rgba(243,244,246,0.78)` |
| `--json-bg` / `--json-fg` | slightly lifted surface / light text | light gray / dark text |
| `--radius` | `8px` | `8px` |

## UI

- Header: brand + tabs; theme toggle (深色 / 浅色) on the right
- Buttons, fields, tables, panels, errors, LoadingMask consume tokens only (no hardcoded light colors)
- Primary button: accent fill + `--accent-fg`
- Focus: 1px accent outline, no glow stacks

## Out of scope

Business logic, new tabs, system-theme auto-follow.
