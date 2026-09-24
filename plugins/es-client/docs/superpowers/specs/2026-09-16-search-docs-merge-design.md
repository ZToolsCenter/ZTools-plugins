# Search + Docs Merge Design

**Date:** 2026-09-16  
**Status:** Approved

## Goals

1. Fix dark-mode input/select contrast via Bootstrap form classes + theme overrides.
2. Remove Docs tab; document CRUD lives in Search results (row actions + modal).
3. Search layout: conditions on top, results below; paginated results.

## UX

- Top: index, combine, page size, conditions, search button, optional DSL peek.
- Bottom: results table with 查看 / 编辑 / 删除; toolbar「新建文档」; pagination (prev/next + page info).
- Modal: `_id` (optional on create), `_source` JSON textarea, 保存 / 取消. View mode read-only.
- Delete confirms then refreshes current page.

## Tech

- Bootstrap 5 CSS only (`bootstrap/dist/css/bootstrap.min.css`).
- Forms use `form-control` / `form-select` (+ `form-control-sm` where dense).
- Dark theme CSS overrides for Bootstrap form colors using existing tokens.
- Remove `DocsTab` from nav; delete component file.
