const { createFileTools } = require('./file-tools');
const { createProcessManager } = require('./process-manager');
const { createSearchTools } = require('./search-tools');
const { createShellTool } = require('./shell-tool');

const FILE_TOOL_NAMES = new Set(['read', 'write', 'edit']);
const SEARCH_TOOL_NAMES = new Set(['grep', 'find', 'ls']);

/**
 * 创建 ZVC 本地开发工具运行时。
 * @param {{resolvePath: Function, getAttachmentStore: Function, createPresentedResult: Function, computeDiffs: Function, resolveLanguage: Function, createLines: Function, getEnvironment: Function, getDownloadToken?: Function, toolRoot: string, outputRoot: string}} dependencies 宿主桥接依赖与插件数据目录。
 * @returns {{supports: Function, execute: Function, cancel: Function, cancelAll: Function}} 工具运行时接口。
 */
function createLocalToolRuntime(dependencies) {
  const processManager = createProcessManager({ outputRoot: dependencies.outputRoot });
  const invocationControllers = new Map();
  const fileTools = createFileTools(dependencies);
  const searchTools = createSearchTools({
    resolvePath: dependencies.resolvePath,
    processManager,
    getEnvironment: dependencies.getEnvironment,
    toolRoot: dependencies.toolRoot,
    serverUrl: process.env.ZVC_FILE_SERVER_URL,
    getDownloadToken: dependencies.getDownloadToken,
  });
  const shellTool = createShellTool({ processManager, getEnvironment: dependencies.getEnvironment });

  /**
   * 判断工具是否由新的本地运行时负责。
   * @param {string} toolName 工具名称。
   * @returns {boolean} 是否支持该工具。
   */
  function supports(toolName) {
    return FILE_TOOL_NAMES.has(toolName) || SEARCH_TOOL_NAMES.has(toolName) || toolName === 'bash';
  }

  /**
   * 执行一个本地工具，并为下载、搜索和子进程统一建立取消边界。
   * @param {string} toolName 工具名称。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {{callId?: string, workspace?: Record<string, unknown>|null, workingDirectory: string, supportsImages?: boolean, onUpdate?: Function}} context 调用上下文。
   * @returns {Promise<unknown>} 工具执行结果。
   * @throws {Error} 工具未知、参数无效、执行失败或被取消时抛出。
   */
  async function execute(toolName, args, context) {
    const callId = String(context.callId || `${toolName}-${Date.now()}`);
    const previous = invocationControllers.get(callId);
    if (previous) previous.abort();
    const controller = new AbortController();
    invocationControllers.set(callId, controller);
    const runtimeContext = {
      callId,
      signal: controller.signal,
      supportsImages: context.supportsImages === true,
      onUpdate: (update) => {
        try { context.onUpdate?.(update); } catch { /* 界面已销毁时忽略迟到的过程更新。 */ }
      },
    };
    try {
      if (FILE_TOOL_NAMES.has(toolName)) return await fileTools.execute(toolName, args, context.workspace || null, runtimeContext);
      if (SEARCH_TOOL_NAMES.has(toolName)) return await searchTools.execute(toolName, args, context.workspace || null, runtimeContext);
      if (toolName === 'bash') return await shellTool.execute(args, context.workingDirectory, runtimeContext);
      throw new Error(`未知本地工具：${toolName}`);
    } finally {
      // 只释放当前代次，避免同标识的新调用被旧调用误删。
      if (invocationControllers.get(callId) === controller) invocationControllers.delete(callId);
    }
  }

  /**
   * 取消指定工具调用及其可能启动的整个进程树。
   * @param {string} callId 工具调用标识。
   * @returns {boolean} 是否找到活动调用或子进程。
   */
  function cancel(callId) {
    const key = String(callId || '');
    const controller = invocationControllers.get(key);
    if (controller) controller.abort();
    const processCancelled = processManager.cancel(key);
    return Boolean(controller || processCancelled);
  }

  /**
   * 取消当前插件实例中的全部本地工具调用。
   * @returns {void} 无返回值。
   */
  function cancelAll() {
    for (const controller of invocationControllers.values()) controller.abort();
    invocationControllers.clear();
    processManager.cancelAll();
  }

  return { supports, execute, cancel, cancelAll };
}

module.exports = {
  FILE_TOOL_NAMES,
  SEARCH_TOOL_NAMES,
  createLocalToolRuntime,
};
