import { computed, ref } from 'vue'
import type { ScanResult, StartupItem } from '../types/startup'

export function useStartupManager() {
  const report = ref<ScanResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const busyItems = ref(new Set<string>())
  const lastOperation = ref<{ operationId: string; itemName: string } | null>(null)
  const bridgeAvailable = computed(() => Boolean(window.startupManager))

  async function scan() {
    if (!window.startupManager || loading.value) return
    loading.value = true
    error.value = null
    try {
      const result = await window.startupManager.scan()
      if (!result.ok) throw new Error(result.error.message)
      report.value = result.value
      lastOperation.value = null
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '扫描失败，请重试'
    } finally { loading.value = false }
  }

  function replaceItem(item: StartupItem) {
    if (!report.value) return
    const index = report.value.items.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) report.value.items.splice(index, 1, item)
  }

  async function toggle(item: StartupItem, enabled: boolean) {
    if (!window.startupManager || !report.value || busyItems.value.has(item.id)) return false
    busyItems.value = new Set(busyItems.value).add(item.id)
    error.value = null
    try {
      const result = await window.startupManager.setEnabled({ snapshotId: report.value.snapshotId, itemId: item.id, enabled })
      if (!result.ok) throw new Error(result.error.message)
      replaceItem(result.value.item)
      lastOperation.value = result.value.operationId ? { operationId: result.value.operationId, itemName: item.name } : null
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '操作失败'
      return false
    } finally {
      const next = new Set(busyItems.value); next.delete(item.id); busyItems.value = next
    }
  }

  async function undo() {
    if (!window.startupManager || !lastOperation.value) return false
    const operation = lastOperation.value
    lastOperation.value = null
    const result = await window.startupManager.undo({ operationId: operation.operationId })
    if (!result.ok) { error.value = result.error.message; return false }
    replaceItem(result.value.item)
    return true
  }

  return { report, loading, error, busyItems, lastOperation, bridgeAvailable, scan, toggle, undo }
}
