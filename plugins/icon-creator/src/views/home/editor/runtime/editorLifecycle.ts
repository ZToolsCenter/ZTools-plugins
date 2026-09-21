import type { EditorContext, EditorMaybePromise, EditorModule } from './editorTypes'

type EditorLifecycleHookName = 'onCreate' | 'onMount' | 'onCanvasReady' | 'onDocumentReady' | 'onDispose'

export interface RunEditorLifecycleHooksOptions {
  reverse?: boolean
  continueOnError?: boolean
}

/**
 * 按注册顺序执行模块生命周期钩子，并在销毁阶段支持反向释放。
 * 初始化阶段默认遇错中断，dispose 阶段可配置为继续清理剩余模块，避免单个模块异常阻断资源释放。
 */
export async function runEditorLifecycleHooks(
  modules: readonly EditorModule[],
  hookName: EditorLifecycleHookName,
  context: EditorContext,
  options: RunEditorLifecycleHooksOptions = {}
) {
  const orderedModules = options.reverse ? [...modules].reverse() : modules
  const errors: unknown[] = []

  for (const module of orderedModules) {
    const hook = module[hookName] as ((context: EditorContext) => EditorMaybePromise) | undefined
    if (!hook) continue
    try {
      await hook(context)
    } catch (error) {
      errors.push(error)
      context.services.logger.error?.(`编辑器模块 ${module.name} 执行 ${hookName} 失败`, error)
      if (!options.continueOnError) throw error
    }
  }

  return errors
}
