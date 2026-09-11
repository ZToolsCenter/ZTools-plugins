import { computed, ref, watch } from 'vue'
import type { LanInterface, ScanResult } from '../types/discovery'
import { safeUiError, sortDevices } from './presentation'

export function useLanDiscovery() {
  const interfaces = ref<LanInterface[]>([])
  const selectedInterfaceId = ref('')
  const resolveHostnames = ref(false)
  const restrictedInterfaceConfirmed = ref(false)
  const loadingInterfaces = ref(false)
  const scanning = ref(false)
  const result = ref<ScanResult | null>(null)
  const error = ref('')

  const devices = computed(() => sortDevices(result.value?.devices ?? []))
  const selectedInterface = computed(() => interfaces.value.find((item) => item.id === selectedInterfaceId.value) ?? null)

  async function refreshInterfaces() {
    loadingInterfaces.value = true
    error.value = ''
    restrictedInterfaceConfirmed.value = false
    try {
      if (!window.lanDiscovery) throw new Error('bridge unavailable')
      const values = await window.lanDiscovery.listInterfaces()
      interfaces.value = values
      if (!values.some((item) => item.id === selectedInterfaceId.value)) {
        selectedInterfaceId.value = values[0]?.id ?? ''
      }
    } catch (cause) {
      interfaces.value = []
      selectedInterfaceId.value = ''
      error.value = safeUiError(cause)
    } finally {
      loadingInterfaces.value = false
    }
  }

  async function startScan() {
    if (!selectedInterfaceId.value || scanning.value) return
    scanning.value = true
    error.value = ''
    try {
      if (!window.lanDiscovery) throw new Error('bridge unavailable')
      result.value = await window.lanDiscovery.scan({
        interfaceId: selectedInterfaceId.value,
        resolveHostnames: resolveHostnames.value,
        confirmRestrictedInterface: restrictedInterfaceConfirmed.value,
      })
    } catch (cause) {
      error.value = safeUiError(cause)
    } finally {
      scanning.value = false
    }
  }

  function cancelScan() {
    window.lanDiscovery?.cancelScan()
  }

  watch(selectedInterfaceId, () => {
    restrictedInterfaceConfirmed.value = false
  })

  return {
    cancelScan,
    devices,
    error,
    interfaces,
    loadingInterfaces,
    refreshInterfaces,
    resolveHostnames,
    restrictedInterfaceConfirmed,
    result,
    scanning,
    selectedInterface,
    selectedInterfaceId,
    startScan,
  }
}
