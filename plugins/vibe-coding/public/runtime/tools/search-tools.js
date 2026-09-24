const fs = require('node:fs');
const path = require('node:path');
const { ensureSearchBinary } = require('./binary-manager');

const SEARCH_OUTPUT_BYTES = 50 * 1024;
const GREP_DEFAULT_LIMIT = 100;
const FIND_DEFAULT_LIMIT = 1000;
const LS_DEFAULT_LIMIT = 500;

/**
 * 将搜索结果从头部截断到最大 UTF-8 字节数。
 * @param {string} text 搜索结果文本。
 * @param {number} maxBytes 最大字节数。
 * @returns {{text: string, truncated: boolean}} 截断结果。
 */
function truncateSearchHead(text, maxBytes = SEARCH_OUTPUT_BYTES) {
  const source = String(text || '');
  if (Buffer.byteLength(source, 'utf8') <= maxBytes) return { text: source, truncated: false };
  let output = source.slice(0, maxBytes);
  while (Buffer.byteLength(output, 'utf8') > maxBytes) output = output.slice(0, -1);
  if (output.includes('\n')) output = output.slice(0, output.lastIndexOf('\n'));
  return { text: output, truncated: true };
}

/**
 * 创建基于 ripgrep、fd 和 Node 文件系统的搜索工具。
 * @param {{resolvePath: Function, processManager: Record<string, Function>, getEnvironment: Function, getDownloadToken?: Function, toolRoot?: string, serverUrl?: string}} dependencies 搜索工具依赖。
 * @returns {{execute: Function}} 搜索工具执行接口。
 */
function createSearchTools(dependencies) {
  /**
   * 校验搜索目录不会退化为整个磁盘根目录。
   * @param {string} target 搜索目标绝对路径。
   * @returns {void} 无返回值。
   * @throws {Error} 搜索目标为文件系统根目录时抛出。
   */
  function validateSearchRoot(target) {
    if (path.resolve(target) === path.parse(path.resolve(target)).root) throw new Error('为避免扫描整个系统，请指定更具体的目录');
  }

  /**
   * 确保搜索依赖可用，并将下载进度转换为工具过程更新。
   * @param {'rg'|'fd'} toolName 二进制工具名称。
   * @param {Record<string, unknown>} context 当前调用上下文。
   * @returns {Promise<string>} 可执行文件路径或系统命令名。
   */
  function ensureBinary(toolName, context) {
    return ensureSearchBinary(toolName, {
      rootDirectory: dependencies.toolRoot,
      serverUrl: dependencies.serverUrl,
      getDownloadToken: dependencies.getDownloadToken,
      env: dependencies.getEnvironment(),
      signal: context.signal,
      onUpdate: (update) => context.onUpdate?.({ kind: 'search-binary', ...update }),
    });
  }

  /**
   * 使用 ripgrep 搜索文件内容并返回带路径和行号的匹配。
   * @param {Record<string, unknown>} args 搜索参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {Record<string, unknown>} context 调用标识、取消信号和过程回调。
   * @returns {Promise<Record<string, unknown>>} 搜索匹配结果。
   * @throws {Error} 参数、路径或 ripgrep 执行失败时抛出。
   */
  async function grep(args, workspace, context) {
    const pattern = String(args.pattern || '');
    if (!pattern || pattern.length > 10000) throw new Error('搜索模式为空或过长');
    const searchPath = dependencies.resolvePath(workspace, args.path || '.', { allowRoot: true });
    validateSearchRoot(searchPath);
    const stat = fs.statSync(searchPath);
    const cwd = stat.isDirectory() ? searchPath : path.dirname(searchPath);
    const target = stat.isDirectory() ? '.' : path.basename(searchPath);
    const limit = Math.min(Math.max(1, Number(args.limit) || GREP_DEFAULT_LIMIT), 1000);
    const rgPath = await ensureBinary('rg', context);
    // 工作区不一定是 Git 仓库，仍应应用就近的 .gitignore 规则。
    const rgArgs = ['--json', '--line-number', '--color=never', '--hidden', '--no-require-git', '--glob', '!.git/**', '--glob', '!node_modules/**'];
    if (args.ignoreCase) rgArgs.push('--ignore-case');
    if (args.literal) rgArgs.push('--fixed-strings');
    if (args.glob) rgArgs.push('--glob', String(args.glob));
    const contextLines = Math.min(Math.max(0, Number(args.context) || 0), 20);
    if (contextLines) rgArgs.push('--context', String(contextLines));
    rgArgs.push('--', pattern, target);
    const result = await dependencies.processManager.run(rgPath, rgArgs, {
      callId: context.callId,
      cwd,
      env: dependencies.getEnvironment(),
      timeoutMs: 120000,
      signal: context.signal,
      maxBytes: 4 * 1024 * 1024,
      maxLines: 100000,
    });
    if (![0, 1].includes(result.code)) throw new Error(result.stderr || `ripgrep 退出码 ${result.code}`);

    const matches = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (!['match', 'context'].includes(event.type)) continue;
      const data = event.data || {};
      const filePath = data.path?.text || '';
      const lineText = String(data.lines?.text || '').replace(/\r?\n$/, '');
      matches.push({
        file: filePath,
        line: Number(data.line_number) || null,
        text: lineText.slice(0, 2000),
        context: event.type === 'context',
      });
      if (matches.filter((item) => !item.context).length >= limit) break;
    }
    const rendered = matches.map((item) => `${item.file}:${item.line || 0}:${item.context ? '-' : ''}${item.text}`).join('\n');
    const bounded = truncateSearchHead(rendered);
    return {
      matches,
      text: bounded.text,
      count: matches.filter((item) => !item.context).length,
      truncated: bounded.truncated || matches.filter((item) => !item.context).length >= limit,
      limit,
    };
  }

  /**
   * 使用 fd 按 Glob 查找文件并返回相对搜索根目录的路径。
   * @param {Record<string, unknown>} args 查找参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {Record<string, unknown>} context 调用标识、取消信号和过程回调。
   * @returns {Promise<Record<string, unknown>>} 文件查找结果。
   * @throws {Error} 参数、路径或 fd 执行失败时抛出。
   */
  async function find(args, workspace, context) {
    const pattern = String(args.pattern || '');
    if (!pattern || pattern.length > 10000) throw new Error('Glob 模式为空或过长');
    const searchPath = dependencies.resolvePath(workspace, args.path || '.', { allowRoot: true });
    validateSearchRoot(searchPath);
    if (!fs.statSync(searchPath).isDirectory()) throw new Error('find 的 path 必须是目录');
    const limit = Math.min(Math.max(1, Number(args.limit) || FIND_DEFAULT_LIMIT), 10000);
    const fdPath = await ensureBinary('fd', context);
    const result = await dependencies.processManager.run(fdPath, [
      '--glob', '--color=never', '--hidden', '--no-require-git', '--exclude', '.git', '--exclude', 'node_modules', '--max-results', String(limit), '--', pattern, '.',
    ], {
      callId: context.callId,
      cwd: searchPath,
      env: dependencies.getEnvironment(),
      timeoutMs: 120000,
      signal: context.signal,
      maxBytes: 2 * 1024 * 1024,
      maxLines: 20000,
    });
    if (result.code !== 0) throw new Error(result.stderr || `fd 退出码 ${result.code}`);
    const files = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit).map((item) => item.replace(/^\.\//, ''));
    const bounded = truncateSearchHead(files.join('\n'));
    return { files, text: bounded.text, count: files.length, truncated: bounded.truncated || files.length >= limit, limit };
  }

  /**
   * 使用 Node 文件系统列出单层目录内容。
   * @param {Record<string, unknown>} args 目录参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @returns {Record<string, unknown>} 已排序的目录条目。
   * @throws {Error} 路径不存在或不是目录时抛出。
   */
  function ls(args, workspace) {
    const directory = dependencies.resolvePath(workspace, args.path || '.', { allowRoot: true });
    validateSearchRoot(directory);
    if (!fs.statSync(directory).isDirectory()) throw new Error('ls 的 path 必须是目录');
    const limit = Math.min(Math.max(1, Number(args.limit) || LS_DEFAULT_LIMIT), 5000);
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      .slice(0, limit)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
    const bounded = truncateSearchHead(entries.join('\n'));
    return { path: directory, entries, text: bounded.text, count: entries.length, truncated: bounded.truncated || entries.length >= limit, limit };
  }

  /**
   * 分发一个搜索类工具调用。
   * @param {'grep'|'find'|'ls'} toolName 搜索工具名称。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {Record<string, unknown>} context 调用上下文。
   * @returns {Promise<Record<string, unknown>>} 搜索工具结果。
   * @throws {Error} 工具名称未知或执行失败时抛出。
   */
  async function execute(toolName, args, workspace, context) {
    if (toolName === 'grep') return grep(args, workspace, context);
    if (toolName === 'find') return find(args, workspace, context);
    if (toolName === 'ls') return ls(args, workspace);
    throw new Error(`未知搜索工具：${toolName}`);
  }

  return { execute };
}

module.exports = {
  createSearchTools,
  truncateSearchHead,
};
