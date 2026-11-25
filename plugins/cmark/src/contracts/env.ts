/**
 * EnvPort —— 平台事实与生命周期
 *
 * 只描述「我在什么环境」，不提供业务能力。业务要做什么，去对应的端口。
 */
import type { Capabilities, HostKind, Platform } from './caps'
import type { Unsubscribe } from './result'

/** 宿主把插件/窗口唤起时带进来的参数 */
export interface ActivatePayload {
  /** 动态指令 code（ZTools/uTools 的 features[].code） */
  code?: string
  /** 用户输入的关键词 */
  keyword?: string
  /** 要打开的笔记（工作区相对路径） */
  noteRel?: string
  /** 原始载荷，仅排障用 */
  raw?: unknown
}

/** 平台常用目录。移动端多数为 null，不要用它拼业务路径 */
export interface EnvPaths {
  /** 配置目录（应用偏好） */
  config: string | null
  /** 临时目录（附件缓存、导出中间产物） */
  temp: string | null
  /** 下载目录（默认导出位置） */
  downloads: string | null
}

export interface EnvPort {
  readonly platform: Platform
  readonly host: HostKind
  readonly caps: Capabilities
  readonly paths: EnvPaths

  /** 宿主唤起（插件进入、窗口激活、深链打开） */
  onActivate(cb: (p: ActivatePayload) => void): Unsubscribe
  /** 窗口/页面可见性变化。ZTools 失焦即隐藏，恢复时靠它校正界面状态 */
  onVisibilityChange(cb: (visible: boolean) => void): Unsubscribe
  /** 退出前回调：用于 flush 未落盘内容。桌面端必须等它完成再关闭 */
  onBeforeQuit(cb: () => Promise<void>): Unsubscribe

  /** 排障：当前宿主缺了哪些 API（不参与业务逻辑） */
  diagnostics?(): { missing: string[]; bootErrors: string[] }
}