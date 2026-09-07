import { ref, watch } from 'vue'
import type { Ref } from 'vue'

export interface UseDialogOptions {
  /** 弹窗初始标题 */
  title?: string
  /** 是否默认打开（默认 false） */
  initialVisible?: boolean
  /** 弹窗宽度，可在模板上用 :width 覆盖 */
  width?: string | number
  /** 打开时回调（openDialog 或直接改 visible 都会触发） */
  onOpen?: () => void
  /** 关闭时回调（含右上角 ×、遮罩关闭等所有路径） */
  onClose?: () => void
}

export interface UseDialogReturn {
  /** 弹窗根元素引用，可用于聚焦、滚动 */
  dialogRef: Ref<HTMLElement | null>
  /** 是否显示，直接绑定 v-model */
  visible: Ref<boolean>
  /** 弹窗内加载状态 */
  loading: Ref<boolean>
  /** 弹窗标题 */
  title: Ref<string>
  /** 弹窗宽度 */
  width: Ref<string | number | undefined>
  /** 每次 openDialog 自增，作为子组件 :key 强制重建，避免数据残留 */
  refreshKey: Ref<number>
  /** 打开弹窗，可传入新标题覆盖默认标题 */
  openDialog: (title?: string) => void
  /** 关闭弹窗 */
  closeDialog: () => void
  /** 按当前状态切换开关 */
  toggleDialog: () => void
  /** 动态修改标题 */
  setTitle: (title: string) => void
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void
  openLoading: () => void
  closeLoading: () => void
  /** 重置 loading 与标题，并重建子组件 */
  reset: () => void
}

/**
 * 弹窗状态管理：统一维护 visible / title / loading 及开关方法，
 * 并通过 watch 捕获所有关闭路径（含 el-dialog 右上角 ×）分发回调。
 */
export default function useDialog(options: UseDialogOptions = {}): UseDialogReturn {
  const dialogRef = ref<HTMLElement | null>(null)
  const visible = ref(options.initialVisible ?? false)
  const loading = ref(false)
  const title = ref(options.title ?? '')
  const width = ref(options.width)
  const refreshKey = ref(0)

  // 单一状态源：无论 closeDialog 还是 × 按钮关闭，回调都从 visible 变化统一分发
  watch(visible, (val) => {
    if (val) {
      options.onOpen?.()
    } else {
      options.onClose?.()
    }
  })

  const openDialog = (newTitle?: string) => {
    if (newTitle !== undefined) {
      title.value = newTitle
    }
    // 每次打开自增，模板上 :key="refreshKey" 即可强制重建子组件
    refreshKey.value += 1
    visible.value = true
  }

  const closeDialog = () => {
    visible.value = false
  }

  const toggleDialog = () => {
    visible.value ? closeDialog() : openDialog()
  }

  const setTitle = (t: string) => {
    title.value = t
  }

  const setLoading = (l: boolean) => {
    loading.value = l
  }

  const openLoading = () => setLoading(true)
  const closeLoading = () => setLoading(false)

  const reset = () => {
    loading.value = false
    title.value = options.title ?? ''
    refreshKey.value += 1
  }

  return {
    dialogRef,
    visible,
    loading,
    title,
    width,
    refreshKey,
    openDialog,
    closeDialog,
    toggleDialog,
    setTitle,
    setLoading,
    openLoading,
    closeLoading,
    reset,
  }
}
