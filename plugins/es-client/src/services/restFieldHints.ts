/** Extract concrete index names from a REST path for mapping hints. */
export function indexNamesFromRestPath(path: string): string[] {
  const raw = path.split('?')[0].trim()
  if (!raw || raw === '/') return []
  const segs = raw.replace(/^\/+/, '').split('/').filter(Boolean)
  if (!segs.length) return []
  const first = segs[0]
  // cluster APIs
  if (first.startsWith('_')) return []
  // /idx/_search | /idx/_doc | /idx/_mapping | /idx1,idx2/_search
  return first
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('_') && !s.includes('*'))
}

/** Query clause keys whose child object keys are field names. */
export const FIELD_OBJECT_CLAUSES = new Set([
  'match',
  'match_phrase',
  'match_phrase_prefix',
  'term',
  'terms',
  'range',
  'prefix',
  'wildcard',
  'regexp',
  'fuzzy',
  'exists',
])

/**
 * Whether the JSON path indicates we should suggest mapping field names
 * as the next property key (or exists.field string is separate).
 */
export function shouldSuggestMappingFields(jsonPath: string[]): boolean {
  if (!jsonPath.length) return false
  const last = jsonPath[jsonPath.length - 1]
  if (FIELD_OBJECT_CLAUSES.has(last) && last !== 'exists') return true
  // highlight.fields
  if (jsonPath[0] === 'highlight' && last === 'fields') return true
  // sort item objects use field names as keys sometimes — skip
  return false
}
