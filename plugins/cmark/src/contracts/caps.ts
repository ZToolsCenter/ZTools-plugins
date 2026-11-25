/**
 * 能力声明（caps）
 *
 * 平台差异只允许表达为「能力有无」，不允许在业务代码里写 `if (platform === 'android')`。
 * UI 与 core 只读 caps，据此决定入口是否渲染、功能是否降级。
 *
 * 口径：caps 描述的是「这个运行时能做什么」，不是「它是什么平台」。
 * 同一平台装不同插件也可能能力不同（例如 uTools 没有 aiChat）。
 */

/** 运行时所在的系统平台 */
export type Platform = 'win32' | 'darwin' | 'linux' | 'android' | 'ios' | 'web'

/** 承载应用的宿主形态 */
export type HostKind =
  | 'ztools' // ZTools 插件
  | 'utools' // uTools 插件
  | 'tauri-desktop' // Tauri 独立桌面（Windows / macOS / Linux）
  | 'tauri-mobile' // Tauri 移动（Android / iOS）
  | 'browser' // 浏览器（dev 预览 / E2E）

export type VcsProtocol = 'https' | 'ssh' | 'file'

export interface FsCaps {
  /** 能弹出系统目录选择器；移动端为 SAF / 文档选择器 */
  pickDirectory: boolean
  /** 有原生文件监听；false 时退化为轮询（core 负责定时重扫） */
  watch: boolean
  /** 能拿到并展示绝对路径；移动端是 URI 或沙盒句柄，不可展示 */
  absolutePaths: boolean
  /** 有回收站语义；false 时删除即移入应用内回收目录（仍不硬删） */
  trash: boolean
}

export interface VcsCaps {
  /** 支持的远程协议。移动端通常只有 https */
  protocols: readonly VcsProtocol[]
  /** 能借用系统凭据管理器（credential.helper） */
  credentialHelper: boolean
  /** 能读全局配置（~/.gitconfig），决定建仓时能否沿用身份 */
  globalConfig: boolean
  /** 引擎自带 rename 判定；false 时由 core 用 blob oid 配对 */
  renameDetection: boolean
  /** 引擎跑在同一进程内（isomorphic-git），需要自己串行化 */
  inProcess: boolean
}

export interface ExportCaps {
  /** 能产出 PDF */
  pdf: boolean
  /** 能产出长图 */
  longImage: boolean
  /** 有系统分享面板（移动端） */
  shareSheet: boolean
  /** 能弹系统「另存为」对话框 */
  saveDialog: boolean
}

export interface ShellCaps {
  /** 宿主有全局搜索框，支持「设为全局搜索指令」 */
  globalSearch: boolean
  /** 宿主有子输入框可接管 */
  subInput: boolean
  /** 宿主内置 AI 能力 */
  ai: boolean
  /** 能读剪贴板图片 */
  clipboardImage: boolean
  /** 能在文件管理器里定位文件 */
  revealInFolder: boolean
}

export interface Capabilities {
  readonly fs: FsCaps
  readonly vcs: VcsCaps
  readonly export: ExportCaps
  readonly shell: ShellCaps
}

/** 最小可用能力：任何一项都不支持时的保守基线 */
export const MINIMAL_CAPS: Capabilities = {
  fs: { pickDirectory: false, watch: false, absolutePaths: false, trash: false },
  vcs: { protocols: [], credentialHelper: false, globalConfig: false, renameDetection: false, inProcess: false },
  export: { pdf: false, longImage: false, shareSheet: false, saveDialog: false },
  shell: { globalSearch: false, subInput: false, ai: false, clipboardImage: false, revealInFolder: false },
}

/** 桌面端基线（ZTools / uTools / Tauri 桌面共用，按需覆写） */
export const DESKTOP_CAPS: Capabilities = {
  fs: { pickDirectory: true, watch: true, absolutePaths: true, trash: true },
  vcs: { protocols: ['https', 'ssh', 'file'], credentialHelper: true, globalConfig: true, renameDetection: true, inProcess: false },
  export: { pdf: true, longImage: true, shareSheet: false, saveDialog: true },
  shell: { globalSearch: false, subInput: false, ai: false, clipboardImage: true, revealInFolder: true },
}

/** 移动端基线：只保留确实能做的，其余一律 false */
export const MOBILE_CAPS: Capabilities = {
  fs: { pickDirectory: true, watch: false, absolutePaths: false, trash: false },
  vcs: { protocols: ['https'], credentialHelper: false, globalConfig: false, renameDetection: false, inProcess: false },
  export: { pdf: true, longImage: true, shareSheet: true, saveDialog: false },
  shell: { globalSearch: false, subInput: false, ai: false, clipboardImage: true, revealInFolder: false },
}