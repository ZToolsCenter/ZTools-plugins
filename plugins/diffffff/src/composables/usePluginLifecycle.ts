/**
 * 插件生命周期接线（FND-005）。
 *
 * 职责：
 * - onMounted：先从 dbStorage 恢复上次未保存输入，再向宿主注册生命周期钩子；
 * - onPluginEnter：聚焦左栏编辑器（用户重新进入插件时可直接输入）；
 * - onPluginOut：把 { leftText, rightText } 持久化到 dbStorage（key
 *   'workbench.draft'），供下次 onMounted 恢复。
 *
 * 静默降级：所有 ztools 全局访问（钩子注册 + dbStorage 读写）都包 try/catch
 * 并吞掉异常——纯浏览器 dev / vite preview 环境没有 ztools 全局，不应抛错
 * 阻塞页面；宿主内单次读写失败也不打断退出流程。
 *
 * 注册约束：onPluginEnter / onPluginOut 是宿主的覆盖式 setter（后注册者
 * 覆盖先注册者，且无 off/un 注销 API），钩子生命周期由宿主管理、无需
 * onBeforeUnmount 清理。因此本组合式函数只应在 App 根组件调用一次；
 * 模块级标记保证即便因 HMR 重复挂载，注册与草稿恢复也只执行一次；
 * 聚焦闭包经模块级持有者转发，始终指向最新一次调用传入的编辑器实现。
 */
import { onMounted } from 'vue'
import { workbenchStore, type DraftState } from '../stores/workbench'

/** dbStorage 键名：两侧输入草稿（读写共用此常量，保持 key 一致） */
const DRAFT_STORAGE_KEY = 'workbench.draft'

/** 一次性标记：草稿恢复 + 宿主钩子注册只执行一次（onPluginEnter/Out 为覆盖式 setter） */
let lifecycleInitialized = false

/** 聚焦实现持有者：每次调用 usePluginLifecycle 刷新，
    使已注册进宿主的闭包始终调用当前（HMR 后）编辑器的聚焦实现 */
let focusLeftEditor: (() => void) | null = null

/**
 * 从 dbStorage 恢复草稿。null / 非对象 / 字段缺失或类型不符均容错为不恢复。
 */
function restoreDraft(): void {
  try {
    const draft = window.ztools.dbStorage.getItem<DraftState | null>(DRAFT_STORAGE_KEY)
    if (
      draft !== null &&
      typeof draft === 'object' &&
      typeof draft.leftText === 'string' &&
      typeof draft.rightText === 'string'
    ) {
      workbenchStore.setLeftText(draft.leftText)
      workbenchStore.setRightText(draft.rightText)
    }
  } catch {
    // 浏览器 dev / preview 环境无 ztools 全局（dbStorage 不存在）→ 静默降级，保持初始空状态
  }
}

/**
 * 把当前输入持久化到 dbStorage（onPluginOut 触发）。
 */
function saveDraft(): void {
  try {
    const draft: DraftState = {
      leftText: workbenchStore.leftText,
      rightText: workbenchStore.rightText,
    }
    window.ztools.dbStorage.setItem(DRAFT_STORAGE_KEY, draft)
  } catch {
    // 写失败（宿主存储不可用 / 已在退出中）不打断流程，仅放弃本次持久化
  }
}

/**
 * 接线插件生命周期。只在 App 根组件调用一次。
 *
 * @param focusEditor 聚焦左栏编辑器的实现（App.vue 传 template ref 的 focus；
 *                    UI-001 换 CodeMirror 6 时只需替换该实现，本函数签名不变）
 */
export function usePluginLifecycle(focusEditor: () => void): void {
  // 刷新聚焦实现持有者：即使钩子已注册过（HMR 重复挂载），聚焦目标也保持最新
  focusLeftEditor = focusEditor

  onMounted(() => {
    if (lifecycleInitialized) return
    lifecycleInitialized = true

    // 1) 先恢复草稿，再注册钩子：保证 onPluginEnter 聚焦时内容已就位
    restoreDraft()

    // 2) 注册宿主生命周期钩子（try/catch：浏览器 dev 无 ztools 全局时静默降级）
    try {
      // 进入插件：聚焦左编辑器。action（code/payload/option）当前无消费方，
      // 后续如需「over 划词带入文本」再在此读取 action.payload。
      window.ztools.onPluginEnter(() => {
        focusLeftEditor?.()
      })

      // 插件隐藏 / 退出：持久化未保存输入，供下次进入时恢复
      window.ztools.onPluginOut(() => {
        saveDraft()
      })
    } catch {
      // 无宿主环境（window.ztools 未定义）→ 静默降级，不影响页面运行
    }
  })
}
