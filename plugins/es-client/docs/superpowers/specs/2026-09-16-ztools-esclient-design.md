# ZTools ESClient Design Spec

**Date:** 2026-09-16  
**Source decisions:** session `3f490363-e7ea-4e0a-ac15-b9226a26aa32`  
**Status:** Approved

## Goal

Build a ZTools plugin that is a lightweight Elasticsearch client for daily ops: manage connections, inspect cluster/indices, run `_search` DSL, CRUD documents, and call arbitrary REST.

## Decisions

| Topic | Choice |
|-------|--------|
| Product | New ES client (not a port of `D:\MyWorkSpace\es-client`) |
| Scope | Full: connections + cluster + indices/mapping + search + doc CRUD + REST console |
| Auth | HTTP(S) + Basic Auth + API Key |
| ES versions | 7.x / 8.x via generic REST (no version-specific SDK) |
| Stack | Vue 3 + TS + Vite, same `src-ztools/` layout as BatchStart |
| Transport | Preload Node `http`/`https` (avoid CORS), no `@elastic/elasticsearch` |
| DSL editor | Monaco + official-style `_search` JSON Schema + mapping field completion/validation |

## Architecture

```
ZTools UI (Vue)
    ↕ window.esClient.*
Preload (Node)
    → ConnectionStore + EsHttpClient
Elasticsearch REST (7.x / 8.x)
```

- **UI:** Multi-tab console (Connections / Cluster / Indices / Search / Documents / REST)
- **Preload:** All ES traffic; auth headers; TLS options; response wrapping
- **Storage:** Connection profiles in `ztools.db` (or JSON fallback); password / API Key local only; never logged
- **Feature:** Static `manage` with cmds `ESClient`, `es`

## Data model

### ConnectionProfile

- `id`, `name`, `baseUrl` (e.g. `https://localhost:9200`)
- `authType`: `none` | `basic` | `apiKey`
- `username` / `password` (basic) or `apiKey` (apiKey)
- `rejectUnauthorized` (optional, for self-signed TLS)
- `createdAt` / `updatedAt`

### Session state

- `activeConnectionId`
- Optional caches: index list, mapping for selected index, last DSL body

## Tabs

| Tab | Behavior |
|-----|----------|
| Connections | CRUD profiles; switch active connection |
| Cluster | Health, root info, node list |
| Indices | Index list; view mapping / settings |
| Search | Pick index + DSL editor + hits table / raw JSON |
| Documents | Get / create / update / delete by `_id` (confirm on delete) |
| REST | Method + path + body generic console (confirm on DELETE) |

## EsHttpClient

- Unified `request({ method, path, query, body, connectionId? })`
- Join `baseUrl + path`; set `Authorization: Basic …` or `ApiKey …`
- Honor `rejectUnauthorized`
- Return `{ ok, status, headers, body, error? }` with ES `error.type` / `reason` when present

## DSL validation (Search tab)

1. Monaco + JSON language / format
2. JSON Schema for `_search` body (query / aggs / sort / size / from / _source nesting)
3. On index select: `GET /{index}/_mapping` → field paths + types for completion
4. Soft warnings for type mismatches (e.g. `term` on `text` → suggest `.keyword`)
5. Invalid JSON blocks send; ES 4xx still shown in results

## Out of scope (v1)

- Elastic Cloud ID login
- Index create/delete UI, ILM, Reindex
- SQL / EQL / charts
- Cluster write maintenance (force merge, shrink)
- Multi-user sync / cloud sync of profiles

## Acceptance

- Connect to local/remote 7.x/8.x with Basic or API Key
- All six tabs usable against a live cluster
- Auth failure / timeout / bad DSL show readable errors
- Installable via `src-ztools/` with `base: './'`
