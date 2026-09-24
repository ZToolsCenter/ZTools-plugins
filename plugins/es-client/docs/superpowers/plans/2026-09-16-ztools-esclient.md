# ZTools ESClient Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** Ship an installable ZTools Elasticsearch client plugin under `D:\MyWorkSpace\zTools-ESClient` matching the design spec.

**Tech:** Vue 3, TypeScript, Vite, Vitest, Monaco (search DSL), Node http(s) in preload.

## Tasks

- [x] Design spec
- [ ] Scaffold package / vite `base:'./'` / `src-ztools` / plugin.json
- [ ] Types + db + ConnectionStore
- [ ] EsHttpClient + unit tests
- [ ] Preload API surface `window.esClient`
- [ ] UI shell + six tabs
- [ ] DSL schema + mapping hints + Monaco editor
- [ ] README / CHANGELOG
- [ ] `npm test` + `npm run build`
- [ ] GitHub remote create + push

## Notes

- Install directory for ZTools is **`src-ztools/`**, not repo root.
- Never log password / API Key.
- Confirm before document delete and REST DELETE.
