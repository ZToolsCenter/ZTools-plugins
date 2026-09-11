import type { Canvas } from 'fabric'
import type { EditorContext, EditorLifecyclePhase, EditorRuntimeServices, EditorRuntimeState } from './editorTypes'

export interface CreateEditorContextOptions {
  services?: Partial<EditorRuntimeServices>
  state?: EditorRuntimeState
}

export interface EditorContextController extends EditorContext {
  setPhase: (nextPhase: EditorLifecyclePhase) => void
}

/**
 * 创建编辑器模块共享上下文，集中保存运行时阶段、Fabric Canvas 引用和共享状态入口。
 * 后续模块通过该上下文访问基础服务与 store/commands/selectors，避免继续从页面顶层变量隐式串联生命周期资源。
 */
export function createEditorContext(options: CreateEditorContextOptions = {}): EditorContextController {
  let canvas: Canvas | null = null
  let phase: EditorLifecyclePhase = 'created'
  const services: EditorRuntimeServices = {
    window,
    logger: console,
    ...options.services
  }

  return {
    services,
    state: options.state ?? {},
    getCanvas: () => canvas,
    setCanvas: (nextCanvas) => { canvas = nextCanvas },
    getPhase: () => phase,
    setPhase: (nextPhase) => { phase = nextPhase }
  }
}
