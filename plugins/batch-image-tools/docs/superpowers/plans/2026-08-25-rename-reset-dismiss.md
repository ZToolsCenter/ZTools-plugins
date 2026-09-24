# Rename / Reset / Dismiss Implementation Plan

> For agent: implement steps below; design: `docs/superpowers/specs/2026-08-25-rename-reset-dismiss-design.md`

**Goal:** Batch rename tool, dismissible result/error banners, header reset.

**Architecture:** `rename.js` isolated from sharp; hooks own `reset()`; `BatchImage` orchestrates.

## Tasks

1. Types + tools registry + RenamePanel + ToolPanel
2. preload `renameOne` + services + env/dev-mock
3. useBatchProcess / useImageQueue reset + path updates
4. ResultBanner / ErrorBanner + header reset UI
5. CHANGELOG 1.1.0 + README + verify build
