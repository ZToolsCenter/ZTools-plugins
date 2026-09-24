# Header Switch + Nested Query Design

**Date:** 2026-09-16  
**Status:** Approved

## Header
- No logo / ESClient title
- Left: connection `<select>` (name · url); change calls `setActiveConnection`
- Right: theme toggle; tabs below

## Nested query
- Tree: `QueryGroup { id, combine: must|should, children: (SearchCondition|QueryGroup)[] }`
- UI: add condition / add subgroup; recursive render
- Build → ES bool; editable JSON +「应用到条件」via `parseSearchBody`
- Unsupported clauses: show error, keep JSON

## Index select
- Combobox with local filter over loaded index names

## Layout
- Compact toolbars; actions inline, not stacked full-width
