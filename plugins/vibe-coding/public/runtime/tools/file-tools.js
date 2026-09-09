const fs = require('node:fs');
const path = require('node:path');
const {
  applyEditsToNormalizedContent,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
} = require('./edit-diff');

const MAX_READ_FILE_BYTES = 20 * 1024 * 1024;
const MAX_WRITE_FILE_BYTES = 1024 * 1024;
const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 50 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/**
 * 创建 Pi 风格的文件读取、写入和精确编辑工具。
 * @param {{resolvePath: Function, getAttachmentStore: Function, createPresentedResult: Function, computeDiffs: Function, resolveLanguage: Function, createLines: Function}} dependencies 文件工具依赖。
 * @returns {{execute: Function}} 文件工具执行接口。
 */
function createFileTools(dependencies) {
  const mutationQueues = new Map();

  /**
   * 将同一文件的写入任务串行化，避免并行工具覆盖彼此结果。
   * @param {string} filePath 文件绝对路径。
   * @param {() => Promise<unknown>|unknown} operation 文件变更操作。
   * @returns {Promise<unknown>} 当前变更操作结果。
   */
  function withFileMutationQueue(filePath, operation) {
    const previous = mutationQueues.get(filePath) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    mutationQueues.set(filePath, current);
    return current.finally(() => {
      if (mutationQueues.get(filePath) === current) mutationQueues.delete(filePath);
    });
  }

  /**
   * 在文件操作的关键边界检查取消信号。
   * @param {AbortSignal|undefined} signal 当前工具调用的取消信号。
   * @returns {void} 信号未取消时无返回值。
   * @throws {Error} 工具调用已取消时抛出操作中止错误。
   */
  function throwIfAborted(signal) {
    if (signal?.aborted) throw new Error('Operation aborted');
  }

  /**
   * 检查文件是否具备指定访问权限，并保留底层错误码。
   * @param {string} filePath 目标文件路径。
   * @param {number} mode Node.js 文件访问权限掩码。
   * @param {string} action 当前操作名称。
   * @returns {void} 检查通过后无返回值。
   * @throws {Error} 文件不存在或权限不足时抛出可读错误。
   */
  function assertFileAccess(filePath, mode, action) {
    try {
      fs.accessSync(filePath, mode);
    } catch (error) {
      const code = error && typeof error.code === 'string' ? `错误码：${error.code}` : String(error);
      throw new Error(`无法${action}文件：${filePath}。${code}`);
    }
  }

  /**
   * 读取受限大小的 UTF-8 文本文件。
   * @param {string} filePath 文件绝对路径。
   * @param {AbortSignal|undefined} signal 当前工具调用的取消信号。
   * @returns {string} 文件文本。
   * @throws {Error} 文件不存在、不是普通文件或超过读取上限时抛出。
   */
  function readTextFile(filePath, signal) {
    throwIfAborted(signal);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('目标不是普通文件');
    if (stat.size > MAX_READ_FILE_BYTES) throw new Error('文件超过 20 MB，请使用 Shell 或其他分段工具处理');
    const content = fs.readFileSync(filePath, 'utf8');
    throwIfAborted(signal);
    return content;
  }

  /**
   * 从指定一基行号开始构建满足行数和字节上限的文本窗口。
   * @param {string} content 完整文件文本。
   * @param {number} offset 起始行号，从 1 开始。
   * @param {number} limit 最大行数。
   * @returns {{lines: string[], startLine: number, totalLines: number, truncated: boolean, nextOffset: number|null}} 文本窗口。
   */
  function createReadWindow(content, offset, limit) {
    const allLines = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const requestedOffset = Number(offset);
    if (Number.isFinite(requestedOffset) && requestedOffset > allLines.length) {
      throw new Error(`读取起始行 ${requestedOffset} 超出文件范围（共 ${allLines.length} 行）。`);
    }
    const startLine = Math.min(Math.max(1, Number(offset) || 1), Math.max(1, allLines.length));
    const requestedLimit = Math.min(Math.max(1, Number(limit) || MAX_READ_LINES), MAX_READ_LINES);
    const lines = [];
    let bytes = 0;
    for (let index = startLine - 1; index < allLines.length && lines.length < requestedLimit; index += 1) {
      const lineBytes = Buffer.byteLength(`${allLines[index]}${lines.length ? '\n' : ''}`, 'utf8');
      if (lines.length && bytes + lineBytes > MAX_READ_BYTES) break;
      if (!lines.length && lineBytes > MAX_READ_BYTES) {
        lines.push(Buffer.from(allLines[index], 'utf8').subarray(0, MAX_READ_BYTES).toString('utf8'));
        bytes = MAX_READ_BYTES;
        break;
      }
      lines.push(allLines[index]);
      bytes += lineBytes;
    }
    const consumedThrough = startLine - 1 + lines.length;
    const truncated = consumedThrough < allLines.length;
    return { lines, startLine, totalLines: allLines.length, truncated, nextOffset: truncated ? consumedThrough + 1 : null };
  }

  /**
   * 将不同模型返回的编辑参数形态统一为 Pi 使用的 edits 数组。
   * @param {Record<string, unknown>} value 原始模型参数。
   * @returns {Record<string, unknown>} 规范化后的编辑参数。
   */
  function prepareEditArguments(value) {
    // 复制参数对象，避免兼容处理修改模型请求快照。
    const args = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
    if (typeof args.edits === 'string') {
      try {
        // 部分模型会把数组序列化为字符串，先恢复为标准数组形态。
        const parsed = JSON.parse(args.edits);
        if (Array.isArray(parsed)) {
          args.edits = parsed;
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          typeof parsed.oldText === 'string' &&
          typeof parsed.newText === 'string'
        ) {
          args.edits = [parsed];
        }
      } catch {
        // 解析失败交给后续参数校验，错误会明确指出 edits 格式无效。
      }
    } else if (
      args.edits &&
      !Array.isArray(args.edits) &&
      typeof args.edits === 'object' &&
      typeof args.edits.oldText === 'string' &&
      typeof args.edits.newText === 'string'
    ) {
      // 单对象编辑按 Pi 兼容规则包装成单元素数组。
      args.edits = [args.edits];
    }
    if (typeof args.oldText === 'string' && typeof args.newText === 'string') {
      // 兼容旧模型发送的顶层 oldText/newText 参数。
      args.edits = [...(Array.isArray(args.edits) ? args.edits : []), {
        oldText: args.oldText,
        newText: args.newText,
      }];
      delete args.oldText;
      delete args.newText;
    }
    return args;
  }

  /**
   * 校验编辑参数，确保进入匹配引擎的字段与工具协议一致。
   * @param {Record<string, unknown>} args 已完成兼容转换的编辑参数。
   * @returns {Array<{oldText: string, newText: string}>} 可执行的编辑列表。
   * @throws {Error} 编辑列表或编辑字段格式无效时抛出。
   */
  function validateEditArguments(args) {
    const edits = args && Array.isArray(args.edits) ? args.edits : null;
    if (!edits || !edits.length || edits.length > 100) {
      throw new Error('edits 必须包含 1 到 100 个修改块');
    }
    for (let index = 0; index < edits.length; index += 1) {
      const edit = edits[index];
      if (
        !edit ||
        typeof edit !== 'object' ||
        Array.isArray(edit) ||
        typeof edit.oldText !== 'string' ||
        typeof edit.newText !== 'string'
      ) {
        throw new Error(`edits[${index}] 必须包含字符串类型的 oldText 和 newText。`);
      }
    }
    return edits;
  }

  /**
   * 读取文本或图片，并生成模型结果与专用展示卡片。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {{supportsImages?: boolean}} context 当前模型能力上下文。
   * @returns {Record<string, unknown>} 文件读取结果信封。
   * @throws {Error} 路径、文件类型或文件内容无效时抛出。
   */
  function read(args, workspace, context) {
    const filePath = dependencies.resolvePath(workspace, args.path);
    throwIfAborted(context?.signal);
    const extension = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) {
      assertFileAccess(filePath, fs.constants.R_OK, '读取');
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error('图片文件不存在');
      const reference = dependencies.getAttachmentStore().saveImage({ bytes: fs.readFileSync(filePath), name: path.basename(filePath) });
      throwIfAborted(context?.signal);
      const supportsImages = context?.supportsImages === true;
      return dependencies.createPresentedResult(
        supportsImages
          ? `已读取图片：${filePath}（${reference.width}×${reference.height}）`
          : `已读取图片：${filePath}。当前模型不支持图片输入。`,
        { card: 'image', path: filePath, attachment: reference },
        supportsImages ? [{ type: 'text', text: `已读取图片：${filePath}（${reference.width}×${reference.height}）` }, { type: 'image', attachment: reference }] : [],
      );
    }

    assertFileAccess(filePath, fs.constants.R_OK, '读取');
    const content = readTextFile(filePath, context?.signal);
    const window = createReadWindow(content, Number(args.offset), Number(args.limit));
    const visibleText = window.lines.join('\n');
    const notice = window.truncated ? `\n\n[显示第 ${window.startLine}-${window.startLine + window.lines.length - 1} 行，共 ${window.totalLines} 行。请使用 offset=${window.nextOffset} 继续读取。]` : '';
    return dependencies.createPresentedResult(
      `${visibleText}${notice}`,
      {
        card: 'read',
        path: filePath,
        lang: dependencies.resolveLanguage(filePath),
        lines: dependencies.createLines(visibleText, window.startLine),
        totalLines: window.totalLines,
      },
    );
  }

  /**
   * 创建或完整覆盖文本文件，并返回真实差异。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {{signal?: AbortSignal}} context 当前工具调用上下文。
   * @returns {Promise<Record<string, unknown>>} 文件写入结果信封。
   * @throws {Error} 内容超过上限或目标路径无效时抛出。
   */
  async function write(args, workspace, context = {}) {
    const filePath = dependencies.resolvePath(workspace, args.path);
    const content = String(args.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_FILE_BYTES) throw new Error('单次写入不能超过 1 MB');
    return withFileMutationQueue(filePath, () => {
      throwIfAborted(context.signal);
      const before = fs.existsSync(filePath) ? readTextFile(filePath, context.signal) : '';
      // 父目录与正文作为一次受管变更写入，避免暴露任意文件系统 API。
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      throwIfAborted(context.signal);
      fs.writeFileSync(filePath, content, 'utf8');
      return dependencies.createPresentedResult(
        { ok: true, path: filePath, bytes: Buffer.byteLength(content, 'utf8') },
        { card: 'diff', path: filePath, diffs: dependencies.computeDiffs(filePath, before, content) },
      );
    });
  }

  /**
   * 使用多个唯一且不重叠的文本替换原子编辑单个文件。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {{signal?: AbortSignal}} context 当前工具调用上下文。
   * @returns {Promise<Record<string, unknown>>} 编辑结果信封。
   * @throws {Error} 修改为空、匹配不唯一、区域重叠或文件无效时抛出。
   */
  async function edit(args, workspace, context = {}) {
    const filePath = dependencies.resolvePath(workspace, args.path);
    const prepared = prepareEditArguments(args);
    const edits = validateEditArguments(prepared);
    return withFileMutationQueue(filePath, () => {
      throwIfAborted(context.signal);
      assertFileAccess(filePath, fs.constants.R_OK | fs.constants.W_OK, '编辑');
      // 在同文件队列内读取最新正文，避免并发编辑覆盖其他调用的结果。
      const rawContent = readTextFile(filePath, context.signal);
      // 去除 BOM 并统一换行后再计算 Pi 风格的匹配偏移。
      const bom = rawContent.startsWith('\uFEFF') ? '\uFEFF' : '';
      const withoutBom = bom ? rawContent.slice(1) : rawContent;
      const lineEnding = detectLineEnding(withoutBom);
      const normalized = normalizeToLF(withoutBom);
      const result = applyEditsToNormalizedContent(normalized, edits, filePath);
      throwIfAborted(context.signal);
      const restored = bom + restoreLineEndings(result.newContent, lineEnding);
      fs.writeFileSync(filePath, restored, 'utf8');
      return dependencies.createPresentedResult(
        `已完成 ${edits.length} 处文本替换：${filePath}`,
        { card: 'diff', path: filePath, diffs: dependencies.computeDiffs(filePath, rawContent, restored) },
      );
    });
  }

  /**
   * 分发一个文件类工具调用。
   * @param {'read'|'write'|'edit'} toolName 工具名称。
   * @param {Record<string, unknown>} args 工具参数。
   * @param {Record<string, unknown>|null} workspace 当前工作区。
   * @param {Record<string, unknown>} context 当前模型上下文。
   * @returns {Promise<Record<string, unknown>>} 工具结果信封。
   * @throws {Error} 工具名称未知或执行失败时抛出。
   */
  async function execute(toolName, args, workspace, context = {}) {
    if (toolName === 'read') return read(args, workspace, context);
    if (toolName === 'write') return write(args, workspace, context);
    if (toolName === 'edit') return edit(args, workspace, context);
    throw new Error(`未知文件工具：${toolName}`);
  }

  return { execute };
}

module.exports = {
  MAX_READ_BYTES,
  MAX_READ_LINES,
  createFileTools,
};
