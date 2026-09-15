const fs = require('node:fs');
const path = require('node:path');
const WINDOWS_UTF8_PREAMBLE = '$OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = $OutputEncoding;';

/**
 * 返回当前平台的 PATH 环境变量规范键。
 * @param {string} platformName 当前平台名称。
 * @returns {string} 应写入环境对象的 PATH 键名。
 */
function getPathEnvironmentKey(platformName = process.platform) {
  return platformName === 'win32' ? 'Path' : 'PATH';
}

/**
 * 返回目标平台的 PATH 分隔符。
 * @param {string} platformName 当前平台名称。
 * @returns {string} PATH 条目分隔符。
 */
function getPathDelimiter(platformName = process.platform) {
  return platformName === 'win32' ? ';' : path.delimiter;
}

/**
 * 规范化大小写不敏感的 PATH 环境变量，避免 Windows 子进程丢失系统路径。
 * @param {NodeJS.ProcessEnv} environment 原始进程环境。
 * @param {string} platformName 当前平台名称。
 * @returns {NodeJS.ProcessEnv} 去除重复 PATH 键并合并路径后的新环境对象。
 */
function normalizePathEnvironment(environment = process.env, platformName = process.platform) {
  const normalized = { ...environment };
  const pathKeys = Object.keys(normalized).filter((key) => key.toLowerCase() === 'path');
  const delimiter = getPathDelimiter(platformName);
  const entries = pathKeys.flatMap((key) => String(normalized[key] || '').split(delimiter));
  for (const key of pathKeys) delete normalized[key];
  const uniqueEntries = [...new Set(entries.filter(Boolean))];
  normalized[getPathEnvironmentKey(platformName)] = uniqueEntries.join(delimiter);
  return normalized;
}

/**
 * 判断命令是否可以通过给定环境中的 PATH 找到。
 * @param {string} command 命令名称。
 * @param {NodeJS.ProcessEnv} environment 命令环境。
 * @returns {boolean} 命令是否存在。
 */
function commandExists(command, environment) {
  const pathValue = String(environment[getPathEnvironmentKey('win32')] || environment.PATH || '');
  return pathValue
    .split(getPathDelimiter('win32'))
    .filter(Boolean)
    .some((directory) => {
      const candidate = path.join(directory, command);
      return fs.existsSync(candidate) || fs.existsSync(`${candidate}.exe`);
    });
}

/**
 * 解析 Windows Shell 执行器，并为精简 PATH 的宿主提供绝对路径回退。
 * @param {NodeJS.ProcessEnv} environment 命令环境。
 * @param {string} platformName 当前平台名称。
 * @returns {string} 可传给 child_process.spawn 的 Shell 执行器。
 */
function resolveShellCommand(environment = process.env, platformName = process.platform) {
  if (platformName !== 'win32') {
    // 与模型侧 bash 工具保持同一方言；仅在系统没有 Bash 时回退到兼容 Shell。
    if (fs.existsSync('/bin/bash')) return '/bin/bash';
    return environment.SHELL || 'sh';
  }
  const systemRoot = environment.SystemRoot || environment.WINDIR || 'C:\\Windows';
  const candidates = [
    environment.ZVC_PWSH_PATH,
    path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    environment.ProgramFiles ? path.join(environment.ProgramFiles, 'PowerShell', '7', 'pwsh.exe') : '',
    environment.ProgramW6432 ? path.join(environment.ProgramW6432, 'PowerShell', '7', 'pwsh.exe') : '',
    'powershell.exe',
    'pwsh.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => path.isAbsolute(candidate)
    ? fs.existsSync(candidate)
    : commandExists(candidate, environment)) || 'powershell.exe';
}

/**
 * 构建跨平台 Shell 子进程的执行器和参数，统一前后台命令行为。
 * @param {string} command 待执行命令。
 * @param {NodeJS.ProcessEnv} environment 命令环境。
 * @param {string} platformName 当前平台名称。
 * @returns {{command: string, args: string[]}} 可传给 child_process.spawn 的执行配置。
 */
function createShellInvocation(command, environment = process.env, platformName = process.platform) {
  const normalizedCommand = String(command || '');
  if (platformName === 'win32') {
    return {
      command: resolveShellCommand(environment, platformName),
      args: ['-NoProfile', '-NonInteractive', '-Command', `${WINDOWS_UTF8_PREAMBLE} ${normalizedCommand}`],
    };
  }
  return {
    command: resolveShellCommand(environment, platformName),
    args: ['-lc', normalizedCommand],
  };
}

module.exports = {
  WINDOWS_UTF8_PREAMBLE,
  createShellInvocation,
  getPathEnvironmentKey,
  normalizePathEnvironment,
  resolveShellCommand,
};
