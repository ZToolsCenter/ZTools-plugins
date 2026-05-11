import type { FileItem, ActionInstance, WorkflowContext, WorkflowRuntimeContext } from './types';
import { registry } from './registry';

/**
 * 对一批文件应用重命名工作流。
 * 按顺序将工作流中所有启用的操作应用于每个文件。
 * @param files - 要处理的文件数组
 * @param workflow - 要应用的有序操作实例列表
 * @returns 包含更新后的newName和status字段的FileItem数组
 */
export function applyWorkflow(
  files: FileItem[],
  workflow: ActionInstance[]
): FileItem[] {
  const runtime: WorkflowRuntimeContext = {
    sharedState: new Map<string, unknown>(),
    batchTimestamp: Date.now()
  };

  return files.map((file, index) => {
    let currentNewName = file.originalName;
    const total = files.length;
    let errorMessage: string | undefined;

    // 按顺序应用所有启用的动作
    for (const instance of workflow) {
      if (!instance.enabled) continue;

      const plugin = registry.get(instance.pluginId);
      if (!plugin) {
        console.warn(`Plugin ${instance.pluginId} not found.`);
        errorMessage = `Plugin ${instance.pluginId} not found.`;
        continue;
      }

      const context: WorkflowContext = {
        index,
        total,
        file,
        actionInstanceId: instance.instanceId,
        runtime
      };

      try {
        currentNewName = plugin.apply(currentNewName, instance.config, context);
      } catch (error) {
        console.error(`Error applying plugin ${instance.pluginId}:`, error);
        errorMessage = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    const status = errorMessage
      ? 'error'
      : currentNewName === file.originalName
        ? 'idle'
        : 'modified';

    return {
      ...file,
      newName: currentNewName,
      status,
      errorMessage
    };
  });
}
