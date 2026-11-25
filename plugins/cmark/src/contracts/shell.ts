/**
 * ShellPort —— 宿主交互（通知、选择器、剪贴板、外部打开、AI、搜索框）
 *
 * 不支持的能力返回 unsupported，不要抛错、不要静默返回假成功。
 * UI 应先用 caps.shell 判断是否渲染入口，再调用。
 */
import type { Result, Unsubscribe } from './result'
import type { ActivatePayload } from './env'

export interface PickFileOptions {
  title?: string
  /** 扩展名白名单，如 ['md', 'png'] */
  accept?: string[]
  /** 允许一次选多个 */
  multiple?: boolean
}

export interface SaveFileOptions {
  defaultName: string
  /** 不带点，如 'md' */
  ext: string
  /** 默认目录（桌面端可用，移动端忽略） */
  dir?: string
}

export interface NotifyOptions {
  title: string
  body?: string
}

export interface AiModel {
  /** 调用时传这个值 */
  id: string
  label: string
  provider?: string
  contextWindow?: number
}

export interface AiRequest {
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  temperature?: number
}

export interface AiChatHandle {
  /** 完整文本（流式结束后 resolve） */
  done: Promise<Result<{ text: string }>>
  abort(): void
}

export interface ShellPort {
  notify(o: NotifyOptions): void

  pickDirectory(o?: { title?: string }): Promise<Result<string | null>>
  pickFile(o?: PickFileOptions): Promise<Result<string[] | null>>
  saveFile(o: SaveFileOptions): Promise<Result<string | null>>

  copyText(text: string): Promise<Result<void>>
  openUrl(url: string): Promise<Result<void>>
  /** 在文件管理器中定位；caps.shell.revealInFolder=false 时返回 unsupported */
  revealInFolder(rel: string): Promise<Result<void>>

  /** 宿主内置 AI；caps.shell.ai=false 时为 null */
  readonly ai: {
    list(): Promise<AiModel[]>
    chat(req: AiRequest, onChunk: (t: string) => void): AiChatHandle
    /** 打开宿主的模型设置页（可选） */
    openSettings?(): void
  } | null

  /** 接管宿主顶部搜索框（caps.shell.subInput=false 时返回空解绑） */
  setSearchKeyword(keyword: string, placeholder: string): Unsubscribe
  /** 宿主唤起时的参数流（与 EnvPort.onActivate 同源，UI 侧用哪个都行） */
  onEnter(cb: (p: ActivatePayload) => void): Unsubscribe
}