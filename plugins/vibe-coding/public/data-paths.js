const path = require('node:path');

/**
 * 校验并规范化宿主或环境变量提供的数据目录。
 * @param {unknown} value 候选目录路径。
 * @param {string} label 路径用途说明。
 * @returns {string} 规范化后的绝对路径。
 * @throws {Error} 路径为空或不是绝对路径时抛出。
 */
function normalizeAbsoluteDirectory(value, label) {
  const directory = String(value || '').trim();
  if (!directory || !path.isAbsolute(directory)) throw new Error(`${label}不可用`);
  return path.resolve(directory);
}

/**
 * 解析 ZVC 在当前插件隔离域中使用的全部文件系统目录。
 * @param {(name: string) => unknown} getPath ZTools 路径查询函数。
 * @param {NodeJS.ProcessEnv} env 当前进程环境变量。
 * @returns {{pluginDataRoot: string, workspaceRoot: string, skillRoot: string, toolBinaryRoot: string, toolOutputRoot: string, sessionRoot: string}} 插件专属数据目录布局。
 * @throws {Error} 宿主没有提供插件数据目录时抛出。
 */
function createPluginDataPaths(getPath, env = process.env) {
  if (typeof getPath !== 'function') throw new Error('ZTools 路径 API 不可用');
  const pluginDataRoot = normalizeAbsoluteDirectory(getPath('pluginData'), 'ZTools 插件数据目录');

  /**
   * 优先使用测试或诊断环境的显式目录，否则返回插件数据目录内的默认位置。
   * @param {unknown} value 环境变量提供的候选目录。
   * @param {string} fallback 插件数据目录内的默认路径。
   * @param {string} label 路径用途说明。
   * @returns {string} 最终使用的绝对路径。
   * @throws {Error} 显式目录不是有效绝对路径时抛出。
   */
  const resolveConfiguredDirectory = (value, fallback, label) => value
    ? normalizeAbsoluteDirectory(value, label)
    : fallback;

  return {
    pluginDataRoot,
    workspaceRoot: resolveConfiguredDirectory(env.ZVC_WORKSPACE_ROOT, path.join(pluginDataRoot, 'workspace'), 'ZVC 工作区目录'),
    skillRoot: resolveConfiguredDirectory(env.ZVC_SKILL_ROOT, path.join(pluginDataRoot, 'skill'), 'ZVC Skill 目录'),
    toolBinaryRoot: resolveConfiguredDirectory(env.ZVC_TOOL_BINARY_ROOT, path.join(pluginDataRoot, 'bin'), 'ZVC 工具目录'),
    toolOutputRoot: resolveConfiguredDirectory(env.ZVC_TOOL_OUTPUT_ROOT, path.join(pluginDataRoot, 'tool-output'), 'ZVC 工具输出目录'),
    sessionRoot: path.join(pluginDataRoot, 'sessions'),
  };
}

module.exports = {
  createPluginDataPaths,
  normalizeAbsoluteDirectory,
};
