import { computed, ref } from 'vue'
import type { PluginMarketUiPlugin } from '../types/pluginMarket'

interface MarketRiskChecklistItem {
  key: string
  label: string
  checked: boolean
}

interface MarketRiskDialogState {
  visible: boolean
  title: string
  items: MarketRiskChecklistItem[]
  type: 'info' | 'warning' | 'danger'
  confirmText: string
  cancelText: string
  resolve: ((value: boolean) => void) | null
}

const MARKET_RISK_DIALOG_TITLE = '风险提示'
const MARKET_RISK_DIALOG_KEY = 'bad-bear-market-risk-tip-dismissed'
const MARKET_RISK_ITEMS = [
  {
    key: 'uploaded-by-users',
    label: '商店内的插件均由用户上传，无法保证一定不存在恶意软件或其他风险内容。',
  },
  {
    key: 'stability-impact',
    label: '安装、运行此类插件后，可能会对计算机稳定性以及相关程序的稳定性造成影响，请您自行甄别并谨慎使用。',
  },
  {
    key: 'copyright-risk',
    label: '禁止上传有版权风险、破解付费的插件，本应用只是为了方便大家分享插件！',
  },
  {
    key: 'technical-exchange-only',
    label: '插件内容仅供技术交流与学习参考，下载后请在 24 小时内删除，请勿用于商业用途或其他侵权场景。',
  },
  {
    key: 'infringement-contact',
    label: '如发现插件内容涉及侵权或其他违规问题，请联系 admin@ydys.cc 处理。',
  },
  {
    key: 'no-data-retention-guarantee',
    label: '本市场是玩票性质的插件市场，不对任何数据存留做保证，随时跑路。',
  },
] as const

/**
 * 插件内部 API 授权引导相关常量
 */
const PLUGIN_NAME = 'bad-bear'
const INTERNAL_API_AUTH_GUIDE_KEY = 'bad-bear-internal-api-auth-guide-dismissed'

/**
 * 根据固定风险文案创建新的勾选项，确保每次打开弹框都需要重新逐项确认。
 */
function createMarketRiskChecklistItems(): MarketRiskChecklistItem[] {
  return MARKET_RISK_ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    checked: false,
  }))
}

/**
 * 创建风险提示弹框的默认状态，确保每次打开都恢复为未确认的初始勾选状态。
 */
function createMarketRiskDialogState(): MarketRiskDialogState {
  return {
    visible: false,
    title: MARKET_RISK_DIALOG_TITLE,
    items: createMarketRiskChecklistItems(),
    type: 'warning',
    confirmText: '不再弹出',
    cancelText: '我已知晓',
    resolve: null,
  }
}

export function useMarketRiskDialog() {
  const marketRiskDialogState = ref<MarketRiskDialogState>(createMarketRiskDialogState())
  const hasConfirmedMarketRiskDialogInSession = ref(false)
  const internalApiAuthGuideVisible = ref(false)

  const hasDismissedMarketRiskDialog = computed(() => {
    try {
      return localStorage.getItem(MARKET_RISK_DIALOG_KEY) === '1'
    } catch {
      return false
    }
  })

  /**
   * 判断用户是否已主动选择不再显示内部 API 授权引导弹窗。
   * 仅在未授权时用户点击"不再弹出"后持久化，授权成功导致的关闭不写入。
   */
  const hasDismissedInternalApiAuthGuide = computed(() => {
    try {
      return localStorage.getItem(INTERNAL_API_AUTH_GUIDE_KEY) === '1'
    } catch {
      return false
    }
  })

  const canSubmitMarketRiskDialog = computed(
    () =>
      marketRiskDialogState.value.items.length > 0 &&
      marketRiskDialogState.value.items.every((item) => item.checked),
  )

  /**
   * 判断插件是否需要在启动前显示市场风险提示。
   * 仅对来源于插件市场的已安装非开发插件生效，避免影响本地开发调试流程。
   */
  function shouldConfirmOpenPluginRisk(plugin: PluginMarketUiPlugin): boolean {
    return !!plugin.installed && !!plugin.marketPlugin && !plugin.isDevelopment
  }

  /**
   * 判断当前会话是否仍需要展示风险提示。
   * 用户本地已选择不再提示，或本次会话已经逐项确认过时，都会直接放行。
   */
  function shouldShowMarketRiskDialog(): boolean {
    return !hasDismissedMarketRiskDialog.value && !hasConfirmedMarketRiskDialogInSession.value
  }

  /**
   * 打开风险提示弹框，并将所有勾选项重置为未确认状态。
   * 两个按钮都会继续打开插件，仅关闭弹框会中断本次操作。
   */
  async function openMarketRiskDialog(): Promise<boolean> {
    return new Promise((resolve) => {
      marketRiskDialogState.value = {
        ...createMarketRiskDialogState(),
        visible: true,
        resolve,
      }
    })
  }

  /**
   * 在需要时弹出风险提示；若本次会话已确认或用户已选择不再提示则直接放行。
   */
  async function confirmMarketRiskDialog(): Promise<boolean> {
    if (!shouldShowMarketRiskDialog()) {
      return true
    }

    return openMarketRiskDialog()
  }

  /**
   * 在打开插件前执行一次风险确认；若用户已选择不再提示则直接放行。
   */
  async function confirmOpenPluginRisk(plugin: PluginMarketUiPlugin): Promise<boolean> {
    if (!shouldConfirmOpenPluginRisk(plugin)) {
      return true
    }

    return confirmMarketRiskDialog()
  }

  /**
   * 更新单条风险确认项的勾选状态，用于控制继续按钮何时可点击。
   */
  function updateMarketRiskChecklistItem(key: string, checked: boolean): void {
    const item = marketRiskDialogState.value.items.find((entry) => entry.key === key)
    if (!item) {
      return
    }

    item.checked = checked
  }

  /**
   * 处理“不再弹出”按钮，仅当四项风险都确认后才记录偏好并继续本次打开动作。
   */
  function handleMarketRiskConfirm(): void {
    if (!canSubmitMarketRiskDialog.value) {
      return
    }

    const resolve = marketRiskDialogState.value.resolve
    hasConfirmedMarketRiskDialogInSession.value = true
    marketRiskDialogState.value = createMarketRiskDialogState()

    try {
      localStorage.setItem(MARKET_RISK_DIALOG_KEY, '1')
    } catch (error) {
      console.warn('[BadBear] Failed to persist market risk dialog preference:', error)
    }

    resolve?.(true)
  }

  /**
   * 处理“我已知晓”按钮，仅当四项风险都确认后才继续本次打开且不持久化偏好。
   */
  function handleMarketRiskCancel(): void {
    if (!canSubmitMarketRiskDialog.value) {
      return
    }

    const resolve = marketRiskDialogState.value.resolve
    hasConfirmedMarketRiskDialogInSession.value = true
    marketRiskDialogState.value = createMarketRiskDialogState()
    resolve?.(true)
  }

  /**
   * 处理弹框可见性变更；当用户直接关闭弹框时，中断本次打开动作。
   */
  function handleMarketRiskVisibleChange(visible: boolean): void {
    if (visible) {
      marketRiskDialogState.value.visible = true
      return
    }

    const resolve = marketRiskDialogState.value.resolve
    if (!marketRiskDialogState.value.visible && !resolve) {
      return
    }

    marketRiskDialogState.value = createMarketRiskDialogState()
    resolve?.(false)
  }

  /**
   * 打开内部 API 授权引导弹窗。
   * 仅在 canUseInternalPluginApis 为 false 且用户未点过"不再弹出"时显示。
   */
  function openInternalApiAuthGuide(): void {
    internalApiAuthGuideVisible.value = true
  }

  /**
   * 关闭授权引导弹窗，本次关闭不持久化偏好。
   */
  function closeInternalApiAuthGuide(): void {
    internalApiAuthGuideVisible.value = false
  }

  /**
   * 关闭授权引导弹窗并持久化"不再弹出"偏好。
   * 仅在未授权时用户主动点击"不再弹出"时调用。
   */
  function dismissInternalApiAuthGuide(): void {
    internalApiAuthGuideVisible.value = false
    try {
      localStorage.setItem(INTERNAL_API_AUTH_GUIDE_KEY, '1')
    } catch (error) {
      console.warn('[BadBear] Failed to persist internal API auth guide preference:', error)
    }
  }

  return {
    marketRiskDialogState,
    hasDismissedMarketRiskDialog,
    hasConfirmedMarketRiskDialogInSession,
    canSubmitMarketRiskDialog,
    openMarketRiskDialog,
    shouldConfirmOpenPluginRisk,
    shouldShowMarketRiskDialog,
    confirmMarketRiskDialog,
    confirmOpenPluginRisk,
    updateMarketRiskChecklistItem,
    handleMarketRiskConfirm,
    handleMarketRiskCancel,
    handleMarketRiskVisibleChange,
    internalApiAuthGuideVisible,
    hasDismissedInternalApiAuthGuide,
    pluginName: PLUGIN_NAME,
    openInternalApiAuthGuide,
    closeInternalApiAuthGuide,
    dismissInternalApiAuthGuide,
  }
}
