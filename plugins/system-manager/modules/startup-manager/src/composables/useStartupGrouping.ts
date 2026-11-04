import { computed, ref, type Ref } from 'vue'
import type { StartupItem } from '../types/startup'

export interface StartupGroup {
  key: string
  name: string
  icon: string | null
  items: StartupItem[]
  enabledCount: number
  totalCount: number
  allEnabled: boolean
  noneEnabled: boolean
  isExpanded: boolean
  canToggleAll: boolean
}

export function extractGroupInfo(item: StartupItem): { key: string; name: string } {
  const raw = (item.name || '').trim()
  if (!raw) return { key: 'other', name: '其他服务' }

  // Check if it looks like reverse domain name: com.microsoft.OneDrive -> Microsoft
  const parts = raw.split(/[._\-]/).filter(p => p.length > 0 && !/^(com|org|net|io|app|daemon|agent|helper|service|plist|mxcl)$/i.test(p))
  if (parts.length > 0) {
    const lead = parts[0]
    // Clean up casing
    const display = lead.charAt(0).toUpperCase() + lead.slice(1)
    return { key: lead.toLowerCase(), name: display }
  }

  return { key: raw.toLowerCase(), name: raw }
}

export function useStartupGrouping(items: Ref<StartupItem[]>) {
  const expandedGroups = ref<Record<string, boolean>>({})

  const toggleGroupExpand = (key: string) => {
    expandedGroups.value[key] = !expandedGroups.value[key]
  }

  const groups = computed<StartupGroup[]>(() => {
    const map = new Map<string, { name: string; icon: string | null; items: StartupItem[] }>()

    for (const it of items.value) {
      const { key, name } = extractGroupInfo(it)
      if (!map.has(key)) {
        map.set(key, { name, icon: null, items: [] })
      }
      const g = map.get(key)!
      g.items.push(it)
      if (!g.icon && it.icon) {
        g.icon = it.icon
      }
    }

    const result: StartupGroup[] = []
    for (const [key, val] of map.entries()) {
      const totalCount = val.items.length
      const enabledCount = val.items.filter(i => i.enabled === true).length
      const canToggleAll = val.items.some(i => i.action?.canToggle)
      const allEnabled = totalCount > 0 && enabledCount === totalCount
      const noneEnabled = enabledCount === 0

      // Default single items or groups to collapsed/expanded
      const isExpanded = expandedGroups.value[key] ?? (totalCount <= 3)

      result.push({
        key,
        name: val.name,
        icon: val.icon,
        items: val.items,
        totalCount,
        enabledCount,
        allEnabled,
        noneEnabled,
        isExpanded,
        canToggleAll
      })
    }

    // Sort: groups with more items first or alphabetically
    return result.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name))
  })

  return {
    groups,
    toggleGroupExpand
  }
}
