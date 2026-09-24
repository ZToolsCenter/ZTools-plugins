const { platform } = require('node:os');
const { createShellInvocation } = require('./shell-command');

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 600000;
const MAX_COMMAND_LENGTH = 10000;

/**
 * 创建支持实时输出与进程树取消的 Bash 工具。
 * @param {{processManager: Record<string, Function>, getEnvironment: Function}} dependencies Shell 工具依赖。
 * @returns {{execute: Function}} Bash 工具执行接口。
 */
function createShellTool(dependencies) {
  /**
   * 拦截明确的破坏性或凭据读取命令。
   * @param {string} command 待执行命令。
   * @returns {void} 无返回值。
   * @throws {Error} 命令命中高风险规则时抛出。
   */
  function validateCommand(command) {
    const dangerousPatterns = [
      /(^|[;&|\s])rm\s+(-rf|-r|-f)\s+\/(?:$|[;&|\s])/i,
      />\s*\/dev\/sd/i,
      /\bmkfs\b/i,
      /\bdd\s+/i,
      /\bcurl\s+.*\|\s*(?:ba)?sh/i,
      /\bwget\s+.*\|\s*(?:ba)?sh/i,
      /\bchmod\s+777\b/i,
      /\bcat\s+.*(?:id_rsa|authorized_keys|\.env)/i,
    ];
    if (dangerousPatterns.some((pattern) => pattern.test(command))) throw new Error('命令包含高风险操作，已被安全策略阻止');
  }

  /**
   * 执行前台 Bash 命令，并按 100ms 节流发布过程输出。
   * @param {Record<string, unknown>} args Bash 参数。
   * @param {string} workingDirectory 当前工作目录。
   * @param {{callId: string, signal?: AbortSignal, onUpdate?: Function}} context 调用上下文。
   * @returns {Promise<Record<string, unknown>>} 退出码、输出和截断信息。
   * @throws {Error} 命令无效、启动失败、超时或被取消时抛出。
   */
  async function execute(args, workingDirectory, context) {
    const command = String(args.command || '').trim();
    if (!command || command.length > MAX_COMMAND_LENGTH) throw new Error('命令为空或过长');
    validateCommand(command);
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
    const windows = platform() === 'win32';
    const environment = dependencies.getEnvironment();
    const invocation = createShellInvocation(command, environment, windows ? 'win32' : platform());
    const result = await dependencies.processManager.run(invocation.command, invocation.args, {
      callId: context.callId,
      cwd: workingDirectory,
      env: environment,
      timeoutMs,
      signal: context.signal,
      onUpdate: (update) => context.onUpdate?.({ kind: 'shell', command, ...update }),
    });
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.output,
      truncated: result.truncated,
      fullOutputPath: result.fullOutputPath,
      elapsedMs: result.elapsedMs,
    };
  }

  return { execute };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  createShellTool,
};
