const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const DEFAULT_UPDATE_INTERVAL_MS = 100;
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024;
const DEFAULT_MAX_OUTPUT_LINES = 2000;

/**
 * 从文本尾部截取满足字节数与行数双重限制的窗口。
 * @param {string} text 完整或有界的过程输出。
 * @param {number} maxBytes 最大 UTF-8 字节数。
 * @param {number} maxLines 最大行数。
 * @returns {{text: string, truncated: boolean, totalLines: number, outputLines: number}} 截断结果。
 */
function truncateOutputTail(text, maxBytes = DEFAULT_MAX_OUTPUT_BYTES, maxLines = DEFAULT_MAX_OUTPUT_LINES) {
  const normalized = String(text || '');
  const allLines = normalized.split('\n');
  let selected = allLines.slice(-Math.max(1, maxLines)).join('\n');
  let truncated = allLines.length > maxLines;
  while (Buffer.byteLength(selected, 'utf8') > maxBytes && selected.length > 1) {
    truncated = true;
    selected = selected.slice(Math.max(1, Math.floor(selected.length * 0.1)));
  }
  // 字符截断可能落在一行中间，去除开头残片使终端结果更易读。
  if (truncated && selected.includes('\n')) selected = selected.slice(selected.indexOf('\n') + 1);
  return {
    text: selected,
    truncated,
    totalLines: allLines.length,
    outputLines: selected ? selected.split('\n').length : 0,
  };
}

/**
 * 终止子进程及其派生进程，避免停止会话后留下构建或安装任务。
 * @param {import('node:child_process').ChildProcess} child 待终止的子进程。
 * @param {'SIGTERM'|'SIGKILL'} signal Unix 信号。
 * @returns {void} 无返回值。
 */
function killProcessTree(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode != null) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).unref();
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* 进程可能已在停止请求到达前退出。 */ }
  }
}

/**
 * 创建支持过程更新和按调用取消的子进程管理器。
 * @param {{outputRoot: string, updateIntervalMs?: number}} options 管理器设置。
 * @returns {{run: Function, cancel: Function, cancelAll: Function, activeCount: Function}} 子进程管理接口。
 * @throws {Error} 工具输出目录为空或不是绝对路径时抛出。
 */
function createProcessManager(options = {}) {
  const configuredOutputRoot = String(options.outputRoot || '').trim();
  if (!configuredOutputRoot || !path.isAbsolute(configuredOutputRoot)) throw new Error('ZVC 工具输出目录不可用');
  const outputRoot = path.resolve(configuredOutputRoot);
  const updateIntervalMs = Math.max(20, Number(options.updateIntervalMs) || DEFAULT_UPDATE_INTERVAL_MS);
  const active = new Map();

  /**
   * 执行子进程并持续发布有界输出快照。
   * @param {string} command 可执行程序路径或命令名。
   * @param {string[]} args 命令参数。
   * @param {{callId?: string, cwd: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, onUpdate?: Function, signal?: AbortSignal, maxBytes?: number, maxLines?: number, track?: boolean}} runOptions 执行设置。
   * @returns {Promise<{code: number|null, stdout: string, stderr: string, output: string, truncated: boolean, fullOutputPath: string|null, elapsedMs: number}>} 最终进程结果。
   * @throws {Error} 进程无法启动、超时或被取消时抛出，并在 error.result 中保留最后输出。
   */
  function run(command, args, runOptions) {
    const callId = String(runOptions.callId || randomUUID());
    const maxBytes = Math.max(1024, Number(runOptions.maxBytes) || DEFAULT_MAX_OUTPUT_BYTES);
    const maxLines = Math.max(1, Number(runOptions.maxLines) || DEFAULT_MAX_OUTPUT_LINES);
    const timeoutMs = Number(runOptions.timeoutMs) > 0 ? Number(runOptions.timeoutMs) : 0;
    const startedAt = Date.now();
    const controller = new AbortController();
    let combined = '';
    let stdout = '';
    let stderr = '';
    let updateTimer = null;
    let timeoutTimer = null;
    let settled = false;
    let aborted = false;
    let timedOut = false;
    fs.mkdirSync(outputRoot, { recursive: true });
    const fullOutputPath = path.join(outputRoot, `${Date.now()}-${callId.replace(/[^A-Za-z0-9_-]/g, '_')}.log`);
    const fullOutput = fs.createWriteStream(fullOutputPath, { flags: 'wx' });
    const child = spawn(command, args, {
      cwd: runOptions.cwd,
      env: runOptions.env || process.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 让 Node 在数据分片边界组装 UTF-8 字符，避免中文和 Emoji 被替换。
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    /**
     * 构建当前输出快照，并在发生截断时附加完整日志路径。
     * @returns {Record<string, unknown>} 可传给前端的过程快照。
     */
    const snapshot = () => {
      const tail = truncateOutputTail(combined, maxBytes, maxLines);
      return {
        callId,
        output: tail.text,
        stdout: truncateOutputTail(stdout, maxBytes, maxLines).text,
        stderr: truncateOutputTail(stderr, maxBytes, maxLines).text,
        truncated: tail.truncated,
        totalLines: tail.totalLines,
        outputLines: tail.outputLines,
        fullOutputPath: tail.truncated ? fullOutputPath : null,
        elapsedMs: Date.now() - startedAt,
      };
    };

    /**
     * 按固定间隔合并输出更新，避免高频分片触发界面重绘。
     * @returns {void} 无返回值。
     */
    const scheduleUpdate = () => {
      if (typeof runOptions.onUpdate !== 'function' || updateTimer) return;
      updateTimer = setTimeout(() => {
        updateTimer = null;
        runOptions.onUpdate(snapshot());
      }, updateIntervalMs);
    };

    /**
     * 累加一个输出分片，并分别保留标准输出或标准错误尾部。
     * @param {'stdout'|'stderr'} stream 输出流名称。
     * @param {Buffer|string} chunk 子进程输出分片。
     * @returns {void} 无返回值。
     */
    const append = (stream, chunk) => {
      const text = String(chunk);
      fullOutput.write(text);
      combined = `${combined}${text}`.slice(-maxBytes * 8);
      if (stream === 'stdout') stdout = `${stdout}${text}`.slice(-maxBytes * 4);
      else stderr = `${stderr}${text}`.slice(-maxBytes * 4);
      scheduleUpdate();
    };

    child.stdout?.on('data', (chunk) => append('stdout', chunk));
    child.stderr?.on('data', (chunk) => append('stderr', chunk));

    /**
     * 响应外部或会话停止信号并终止整个进程树。
     * @returns {void} 无返回值。
     */
    const abort = () => {
      if (settled) return;
      aborted = true;
      killProcessTree(child, 'SIGTERM');
      setTimeout(() => killProcessTree(child, 'SIGKILL'), 1200).unref?.();
    };
    controller.signal.addEventListener('abort', abort, { once: true });
    runOptions.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    if (runOptions.track !== false) active.set(callId, { child, controller });
    if (timeoutMs) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
    runOptions.onUpdate?.({ ...snapshot(), phase: 'running' });

    return new Promise((resolve, reject) => {
      /**
       * 完成日志流并按进程状态解析或拒绝最终结果。
       * @param {number|null} code 子进程退出码。
       * @param {Error|null} launchError 启动阶段错误。
       * @returns {void} 无返回值。
       */
      const finish = (code, launchError = null) => {
        if (settled) return;
        settled = true;
        if (updateTimer) clearTimeout(updateTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        active.delete(callId);
        controller.signal.removeEventListener('abort', abort);
        fullOutput.end(() => {
          const current = { ...snapshot(), code };
          runOptions.onUpdate?.({ ...current, phase: 'settled' });
          if (!current.truncated) fs.rmSync(fullOutputPath, { force: true });
          if (launchError || timedOut || aborted) {
            const error = launchError || new Error(timedOut ? `命令执行超时（${timeoutMs}ms）` : '命令执行已取消');
            error.result = current;
            reject(error);
            return;
          }
          resolve(current);
        });
      };
      child.once('error', (error) => finish(null, error));
      child.once('close', (code) => finish(code));
    });
  }

  /**
   * 取消指定工具调用关联的子进程树。
   * @param {string} callId 工具调用标识。
   * @returns {boolean} 是否找到并发出取消请求。
   */
  function cancel(callId) {
    const record = active.get(String(callId || ''));
    if (!record) return false;
    record.controller.abort();
    return true;
  }

  /**
   * 取消管理器持有的全部子进程。
   * @returns {void} 无返回值。
   */
  function cancelAll() {
    for (const record of active.values()) record.controller.abort();
  }

  /**
   * 返回当前仍在运行的受管进程数量。
   * @returns {number} 活动进程数量。
   */
  function activeCount() {
    return active.size;
  }

  return { run, cancel, cancelAll, activeCount };
}

module.exports = {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_OUTPUT_LINES,
  createProcessManager,
  killProcessTree,
  truncateOutputTail,
};
