# Index CRUD + Aliases (2026-09-16)

## Goal

Indices tab supports create / update / delete, and shows alias color chips after the index name. Update includes dynamic settings, optional mapping append, and alias add/remove.

## APIs (via `window.services` → `esRequest`)

| Action | HTTP |
|--------|------|
| List aliases | `GET /_alias` or `_cat/aliases?format=json` |
| Create index | `PUT /{index}` body `{ settings, mappings? }` |
| Update settings | `PUT /{index}/_settings` |
| Put mapping | `PUT /{index}/_mapping` |
| Alias add/remove | `POST /_aliases` with `actions` |
| Delete index | `DELETE /{index}` |

## UI

- Toolbar: Refresh + **新建索引**
- Table: health | name + alias chips | docs | size | mapping · settings · **修改** · **删除**
- Alias chips: hash color, title=full alias
- Create modal: name, shards, replicas, optional mappings JSON
- Edit modal: settings fields + optional mappings JSON + alias list (add input / remove)
- Delete: confirm dialog
- **Clone**: prompt for new name → copy sanitized settings + mappings → `POST /_reindex` (content); does not copy aliases

## Out of scope

ILM, close/open, reindex, move alias across indices in one action, template management.
