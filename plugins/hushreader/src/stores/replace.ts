// 净化规则 store（对标 Legado replace_rules 表）

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  type ReplaceRule,
  newReplaceRule,
  parseReplaceRulesJson
} from '../utils/replaceRules'

function storageGet(key: string): string | null {
  try {
    const zStorage = (window as any).ztools?.dbStorage
    if (zStorage?.getItem) {
      const val = zStorage.getItem(key)
      if (val != null) return typeof val === 'string' ? val : JSON.stringify(val)
    }
  } catch { }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string) {
  try {
    const zStorage = (window as any).ztools?.dbStorage
    if (zStorage?.setItem) {
      zStorage.setItem(key, value)
      return
    }
  } catch { }
  try {
    window.localStorage.setItem(key, value)
  } catch { }
}

export const useReplaceStore = defineStore('replace', () => {
  const rules = ref<ReplaceRule[]>([])
  const nextOrder = ref(0)

  function load() {
    const raw = storageGet('hushreader_replace_rules')
    if (raw) {
      try {
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          rules.value = data.map(r => ({ ...newReplaceRule(), ...r }))
          nextOrder.value = rules.value.reduce((m, r) => Math.max(m, r.order), 0) + 1
        }
      } catch { }
    }
  }

  function save() {
    storageSet('hushreader_replace_rules', JSON.stringify(rules.value))
  }

  // ---------- CRUD ----------

  function addRule(rule?: Partial<ReplaceRule>): ReplaceRule {
    const r = newReplaceRule({ ...(rule || {}), order: nextOrder.value++ })
    rules.value.push(r)
    save()
    return r
  }

  function updateRule(id: string, updates: Partial<ReplaceRule>) {
    const idx = rules.value.findIndex(r => r.id === id)
    if (idx !== -1) {
      rules.value[idx] = { ...rules.value[idx], ...updates }
      save()
    }
  }

  function removeRule(id: string) {
    rules.value = rules.value.filter(r => r.id !== id)
    save()
  }

  function toggleRule(id: string) {
    const idx = rules.value.findIndex(r => r.id === id)
    if (idx !== -1) {
      rules.value[idx].isEnabled = !rules.value[idx].isEnabled
      save()
    }
  }

  function moveRule(id: string, dir: -1 | 1) {
    const idx = rules.value.findIndex(r => r.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= rules.value.length) return
    const [item] = rules.value.splice(idx, 1)
    rules.value.splice(target, 0, item)
    rules.value.forEach((r, i) => { r.order = i })
    nextOrder.value = rules.value.length
    save()
  }

  /** 从文本导入净化规则（Legado replaceRule.json 兼容） */
  function importRulesText(text: string): { added: number; skipped: number; error?: string } {
    let list: ReplaceRule[]
    try {
      list = parseReplaceRulesJson(text)
    } catch (e: any) {
      return { added: 0, skipped: 0, error: `净化规则文件不是合法的 JSON：${e?.message || e}` }
    }
    if (!list.length) return { added: 0, skipped: 0, error: '未解析到任何净化规则' }
    let added = 0
    let skipped = 0
    for (const rule of list) {
      if (!rule.pattern.trim()) { skipped++; continue }
      if (rules.value.some(r => r.name === rule.name && r.pattern === rule.pattern)) {
        skipped++
        continue
      }
      rule.order = nextOrder.value++
      rules.value.push(rule)
      added++
    }
    if (added) save()
    return { added, skipped }
  }

  function exportRulesText(): string {
    return JSON.stringify(rules.value, null, 2)
  }

  const groups = computed(() => {
    const set = new Set<string>()
    rules.value.forEach(r => { if (r.group) set.add(r.group) })
    return Array.from(set)
  })

  return {
    rules, groups,
    load, save,
    addRule, updateRule, removeRule, toggleRule, moveRule,
    importRulesText, exportRulesText
  }
})
