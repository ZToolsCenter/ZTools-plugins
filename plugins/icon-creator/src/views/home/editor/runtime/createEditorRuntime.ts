import { createEditorContext, type CreateEditorContextOptions, type EditorContextController } from './editorContext'
import { runEditorLifecycleHooks } from './editorLifecycle'
import type { EditorModule, EditorRuntime } from './editorTypes'

export interface CreateEditorRuntimeOptions extends CreateEditorContextOptions {
  modules?: EditorModule[]
}

/**
 * 创建编辑器运行时并统一驱动模块 create、mount、ready 与 dispose 顺序。
 * 页面层只需要注册模块和触发生命周期阶段，具体资源初始化与清理逐步迁移到模块钩子内。
 */
export function createEditorRuntime(options: CreateEditorRuntimeOptions = {}): EditorRuntime {
  const context: EditorContextController = createEditorContext(options)
  const modules: EditorModule[] = []
  let disposed = false

  const runtime: EditorRuntime = {
    context,
    get modules() {
      return modules
    },
    get phase() {
      return context.getPhase()
    },
    register(module) {
      if (disposed) throw new Error('编辑器运行时已销毁，无法注册模块')
      if (context.getPhase() !== 'created') throw new Error('编辑器运行时已启动，无法追加模块')
      modules.push(module)
    },
    async mount() {
      if (disposed) throw new Error('编辑器运行时已销毁，无法挂载')
      await runEditorLifecycleHooks(modules, 'onCreate', context)
      context.setPhase('mounted')
      await runEditorLifecycleHooks(modules, 'onMount', context)
      if (context.getCanvas()) await runtime.markCanvasReady()
      if (context.getPhase() === 'canvas-ready') await runtime.markDocumentReady()
    },
    async markCanvasReady() {
      if (disposed) return
      context.setPhase('canvas-ready')
      await runEditorLifecycleHooks(modules, 'onCanvasReady', context)
    },
    async markDocumentReady() {
      if (disposed) return
      context.setPhase('document-ready')
      await runEditorLifecycleHooks(modules, 'onDocumentReady', context)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await runEditorLifecycleHooks(modules, 'onDispose', context, { reverse: true, continueOnError: true })
      context.setCanvas(null)
      context.setPhase('disposed')
    }
  }

  for (const module of options.modules ?? []) runtime.register(module)

  return runtime
}
