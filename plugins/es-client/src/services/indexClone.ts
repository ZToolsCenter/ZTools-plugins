/** Settings keys that must not be copied when creating a clone target. */
const STRIP_INDEX_SETTING_KEYS = new Set([
  'uuid',
  'creation_date',
  'creation_date_string',
  'version',
  'provided_name',
  'history.uuid',
  'routing.allocation.initial_recovery.total_shards_per_node',
  'resize.source.name',
  'resize.source.uuid',
])

export function sanitizeIndexSettingsForClone(settingsBody: unknown, sourceIndex: string): Record<string, unknown> {
  if (!settingsBody || typeof settingsBody !== 'object') return {}
  const root = settingsBody as Record<string, { settings?: Record<string, unknown> }>
  const block = root[sourceIndex] ?? Object.values(root)[0]
  const allSettings = (block?.settings ?? {}) as Record<string, unknown>
  const rawIndex = (allSettings.index ?? {}) as Record<string, unknown>
  const indexOut: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rawIndex)) {
    if (STRIP_INDEX_SETTING_KEYS.has(k)) continue
    if (k.startsWith('version') || k.startsWith('routing.allocation.initial_recovery')) continue
    if (k === 'blocks' || k.startsWith('blocks.')) continue
    indexOut[k] = v
  }
  const out: Record<string, unknown> = { index: indexOut }
  // Preserve analysis / similar top-level settings siblings
  for (const [k, v] of Object.entries(allSettings)) {
    if (k === 'index') continue
    out[k] = v
  }
  return out
}

/** Extract mappings object suitable for PUT /{index} create body. */
export function extractMappingsForClone(mappingBody: unknown, sourceIndex: string): Record<string, unknown> {
  if (!mappingBody || typeof mappingBody !== 'object') return {}
  const root = mappingBody as Record<string, { mappings?: Record<string, unknown> }>
  const block = root[sourceIndex] ?? Object.values(root)[0]
  const mappings = block?.mappings
  if (!mappings || typeof mappings !== 'object') return {}
  return { ...mappings }
}

export function buildReindexBody(source: string, dest: string): Record<string, unknown> {
  return {
    source: { index: source },
    dest: { index: dest },
  }
}
