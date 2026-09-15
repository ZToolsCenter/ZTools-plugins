const MODEL_SHELL_TOOL_NAMES = new Set(['bash', 'powershell']);

/**
 * 判断名称是否属于模型侧的平台专属 Shell 工具。
 * @param {unknown} toolName 待判断的工具名称。
 * @returns {boolean} 是否为 Bash 或 PowerShell 工具。
 */
function isModelShellToolName(toolName) {
  return MODEL_SHELL_TOOL_NAMES.has(String(toolName || ''));
}

/**
 * 校验模型侧 Shell 工具与宿主平台是否一致，并映射为内部统一执行名称。
 * @param {unknown} toolName 模型请求的工具名称。
 * @param {string} platformName 当前宿主平台标识。
 * @returns {string} 本地运行时使用的内部工具名称。
 * @throws {Error} Shell 工具与当前平台方言不一致时抛出。
 */
function resolveRuntimeToolName(toolName, platformName = process.platform) {
  const name = String(toolName || '');
  if (!isModelShellToolName(name)) return name;
  if (name === 'powershell') {
    if (platformName !== 'win32') {
      throw new Error('powershell 工具只在 Windows 中可用');
    }
    return 'bash';
  }
  if (platformName === 'win32') {
    throw new Error('Windows 中请使用 powershell 工具执行命令');
  }
  return 'bash';
}

module.exports = {
  isModelShellToolName,
  resolveRuntimeToolName,
};
