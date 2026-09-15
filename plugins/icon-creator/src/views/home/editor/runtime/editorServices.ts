import type { EditorRuntimeLogger, EditorRuntimeServices } from './editorTypes'

export interface CreateEditorServicesOptions {
  window?: Window
  logger?: EditorRuntimeLogger
}

/**
 * 创建运行时可注入的外部服务集合，先封装 window 和日志能力。
 * 后续文件系统、剪贴板、通知等浏览器外部能力会继续收敛到这里，模块不再直接假设全局实现。
 */
export function createEditorServices(options: CreateEditorServicesOptions = {}): EditorRuntimeServices {
  return {
    window: options.window ?? window,
    logger: options.logger ?? console
  }
}
