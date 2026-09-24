const fs = require('node:fs');
const path = require('node:path');

const SESSION_FORMAT_VERSION = 4;
const INDEX_DOCUMENT_KIND = 'zvc-conversation-index';
const LOG_FILE_NAME = 'session.jsonl';
const TAIL_WINDOW_FILE_NAME = 'window.json';
const TAIL_WINDOW_MESSAGE_LIMIT = 100;
const CHECKPOINT_COMMIT_INTERVAL = 64;
const CHECKPOINT_LOG_BYTES = 8 * 1024 * 1024;

/**
 * 将 JSON 兼容数据复制为不含响应式代理的普通值。
 * @param {unknown} value 待复制的数据。
 * @returns {unknown} 复制后的普通数据。
 * @throws {Error} 数据不能序列化为 JSON 时抛出。
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 将会话标识编码为单一、安全且无碰撞的文件系统路径段。
 * @param {unknown} value 原始会话标识。
 * @returns {string} 编码后的路径段。
 * @throws {Error} 会话标识为空时抛出。
 */
function encodePathSegment(value) {
  const source = String(value || '').trim();
  if (!source) throw new Error('会话标识无效');
  let encoded = '';
  for (const character of source) {
    if (/^[A-Za-z0-9_-]$/.test(character)) encoded += character;
    else encoded += `~${character.codePointAt(0).toString(16).toUpperCase().padStart(6, '0')}`;
  }
  return encoded;
}

/**
 * 为消息生成在一次会话时间线内稳定的存储键。
 * @param {Record<string, unknown>} message 消息对象。
 * @param {number} index 消息在时间线中的位置。
 * @returns {string} 消息存储键。
 */
function getMessageStorageKey(message, index) {
  const id = typeof message?.id === 'string' ? message.id : '';
  return id ? `id:${id}` : `index:${index}`;
}

/**
 * 将消息时间线转换为便于增量比较的映射。
 * @param {Array<Record<string, unknown>>} messages 会话消息时间线。
 * @param {boolean} includeSerialized 是否生成用于完整快照差异比较的序列化结果。
 * @returns {{order: string[], values: Map<string, Record<string, unknown>>, serialized: Map<string, string>}} 消息顺序、值和可选序列化结果。
 */
function indexMessages(messages, includeSerialized = true) {
  const order = [];
  const values = new Map();
  const serialized = new Map();
  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    const key = getMessageStorageKey(message, index);
    order.push(key);
    values.set(key, message);
    if (includeSerialized) serialized.set(key, JSON.stringify(message));
  }
  return { order, values, serialized };
}

/**
 * 从完整会话中提取适合云同步的轻量索引字段。
 * @param {Record<string, unknown>} conversation 已规范化会话。
 * @returns {Record<string, unknown>} 不含消息正文和上下文摘要的会话索引。
 */
function createConversationMetadata(conversation) {
  return {
    storageVersion: conversation.storageVersion,
    id: conversation.id,
    title: conversation.title,
    modelKey: conversation.modelKey,
    reasoningEffort: conversation.reasoningEffort,
    projectId: conversation.projectId,
    workspaceLocked: conversation.workspaceLocked === true,
    enabledTools: conversation.enabledTools,
    enabledSkills: conversation.enabledSkills,
    autoApproveTools: conversation.autoApproveTools,
    archived: conversation.archived === true,
    hasImages: conversation.hasImages === true,
    messageCount: conversation.messages.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

/**
 * 提取需要随本地日志保存、但不进入云同步索引的会话状态。
 * @param {Record<string, unknown>} conversation 已规范化会话。
 * @returns {Record<string, unknown>} 不含消息数组的完整会话状态。
 */
function createConversationState(conversation) {
  return {
    ...createConversationMetadata(conversation),
    contextState: conversation.contextState,
    contextMeter: conversation.contextMeter,
    tasks: conversation.tasks,
    pendingMessages: conversation.pendingMessages,
  };
}

/**
 * 创建可独立恢复完整会话的检查点事件。
 * @param {Record<string, unknown>} conversation 当前完整会话。
 * @param {number} seq 当前连续事件序号。
 * @returns {Record<string, unknown>} JSONL 检查点事件。
 */
function createCheckpointEvent(conversation, seq) {
  return {
    type: 'conversation/checkpoint',
    version: SESSION_FORMAT_VERSION,
    seq,
    time: Date.now(),
    state: createConversationState(conversation),
    messages: conversation.messages,
  };
}

/**
 * 根据前后两版会话生成只包含变化消息的原子提交事件。
 * @param {Record<string, unknown>} previous 上一次已持久化会话。
 * @param {Record<string, unknown>} next 本次待保存会话。
 * @param {number} seq 日志连续序号。
 * @returns {Record<string, unknown>} 可追加到 JSONL 的提交事件。
 */
function createCommitEvent(previous, next, seq) {
  const before = indexMessages(previous.messages || []);
  const after = indexMessages(next.messages || []);
  const removed = before.order.filter((key) => !after.values.has(key));
  const upserts = after.order
    .filter((key) => before.serialized.get(key) !== after.serialized.get(key))
    .map((key) => ({ key, message: after.values.get(key) }));
  const sameOrder = before.order.length === after.order.length
    && before.order.every((key, index) => key === after.order[index]);
  const appendOnlyOrder = before.order.length <= after.order.length
    && before.order.every((key, index) => key === after.order[index]);
  return {
    type: 'conversation/commit',
    version: SESSION_FORMAT_VERSION,
    seq,
    time: Date.now(),
    state: createConversationState(next),
    messages: {
      upserts,
      removed,
      ...sameOrder ? {} : appendOnlyOrder
        ? { appended: after.order.slice(before.order.length) }
        : { order: after.order },
    },
  };
}

/**
 * 根据调用方声明的消息变化和状态补丁创建原子提交事件。
 * @param {Record<string, unknown>} previous 提交前的完整会话。
 * @param {{state?: Record<string, unknown>, upserts?: Array<Record<string, unknown>>, removedIds?: string[]}} changes 调用方已经定位的原子变化。
 * @param {number} seq 日志连续序号。
 * @param {Set<string>|null} knownMessageIds 已缓存的消息标识集合；为空时从当前会话建立。
 * @returns {Record<string, unknown>} 不需要扫描完整历史的提交事件。
 */
function createAtomicCommitEvent(previous, changes, seq, knownMessageIds = null) {
  const currentIds = knownMessageIds || new Set(previous.messages.map((message) => String(message?.id || '')).filter(Boolean));
  const upserts = [];
  const appended = [];
  for (const message of Array.isArray(changes.upserts) ? changes.upserts : []) {
    const id = String(message?.id || '').trim();
    if (!id) continue;
    const key = `id:${id}`;
    upserts.push({ key, message });
    if (!currentIds.has(id)) {
      currentIds.add(id);
      appended.push(key);
    }
  }
  return {
    type: 'conversation/commit',
    version: SESSION_FORMAT_VERSION,
    seq,
    time: Date.now(),
    state: changes.state && typeof changes.state === 'object' ? changes.state : {},
    messages: {
      upserts,
      removed: (Array.isArray(changes.removedIds) ? changes.removedIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .map((id) => `id:${id}`),
      ...(appended.length ? { appended } : {}),
    },
  };
}

/**
 * 把原子提交应用到当前会话快照，并保持未变化消息的对象内容。
 * @param {Record<string, unknown>} conversation 当前会话快照。
 * @param {Record<string, unknown>} event 原子提交事件。
 * @param {(value: Record<string, unknown>) => Record<string, unknown>} normalizeConversation 会话规范化函数。
 * @returns {Record<string, unknown>} 应用提交后的会话快照。
 */
function applyCommitEvent(conversation, event, normalizeConversation) {
  const indexed = indexMessages(conversation.messages || [], false);
  for (const key of Array.isArray(event.messages?.removed) ? event.messages.removed : []) indexed.values.delete(key);
  for (const item of Array.isArray(event.messages?.upserts) ? event.messages.upserts : []) {
    if (typeof item?.key === 'string' && item.message && typeof item.message === 'object') indexed.values.set(item.key, item.message);
  }
  let order = indexed.order.filter((key) => indexed.values.has(key));
  if (Array.isArray(event.messages?.order)) order = event.messages.order.filter((key) => indexed.values.has(key));
  else {
    for (const key of Array.isArray(event.messages?.appended) ? event.messages.appended : []) {
      if (indexed.values.has(key) && !order.includes(key)) order.push(key);
    }
  }
  return normalizeConversation({
    ...conversation,
    ...(event.state && typeof event.state === 'object' ? event.state : {}),
    messages: order.map((key) => indexed.values.get(key)).filter(Boolean),
  });
}

/**
 * 校验数据库写入或删除结果，并把宿主错误转换为异常。
 * @param {unknown} result ZTools 数据库操作结果。
 * @param {string} action 当前操作说明。
 * @returns {void} 无返回值。
 * @throws {Error} 数据库未明确返回成功时抛出。
 */
function assertDatabaseResult(result, action) {
  if (result && result.ok === true) return;
  const detail = result && typeof result === 'object' ? result.message || result.error : '';
  throw new Error(`${action}失败${detail ? `：${detail}` : ''}`);
}

/**
 * 创建基于轻量数据库索引和原子 JSONL 日志的会话存储。
 * @param {{getDb: () => Record<string, Function>, getRootDirectory: () => string, normalizeConversation: (value: Record<string, unknown>) => Record<string, unknown>, documentPrefix: string}} options 存储依赖和命名配置。
 * @returns {{create: Function, get: Function, getMetadata: Function, getState: Function, getPage: Function, list: Function, commit: Function, save: Function, release: Function, remove: Function, getLogPath: Function}} 会话存储接口。
 */
function createConversationStore(options) {
  const cache = new Map();
  const tailWindowCache = new Map();

  /**
   * 校验并返回会话存储依赖。
   * @returns {{db: Record<string, Function>, rootDirectory: string}} 数据库和日志根目录。
   * @throws {Error} 依赖不完整或日志根目录无效时抛出。
   */
  function requireDependencies() {
    const db = options.getDb();
    const rootDirectory = String(options.getRootDirectory() || '').trim();
    if (!rootDirectory || !path.isAbsolute(rootDirectory)) throw new Error('会话日志根目录无效');
    return { db, rootDirectory };
  }

  /**
   * 生成单个会话的数据库索引标识。
   * @param {unknown} id 会话标识。
   * @returns {string} 数据库文档标识。
   * @throws {Error} 会话标识为空时抛出。
   */
  function getDocumentId(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) throw new Error('会话标识无效');
    return `${options.documentPrefix}${normalizedId}`;
  }

  /**
   * 生成单个会话的 JSONL 文件路径。
   * @param {unknown} id 会话标识。
   * @returns {string} 会话日志绝对路径。
   * @throws {Error} 会话标识或日志根目录无效时抛出。
   */
  function getLogPath(id) {
    const { rootDirectory } = requireDependencies();
    return path.join(rootDirectory, encodePathSegment(id), LOG_FILE_NAME);
  }

  /**
   * 生成会话尾部窗口快照路径。
   * @param {unknown} id 会话标识。
   * @returns {string} 尾部窗口 JSON 文件路径。
   * @throws {Error} 会话标识或日志根目录无效时抛出。
   */
  function getTailWindowPath(id) {
    return path.join(path.dirname(getLogPath(id)), TAIL_WINDOW_FILE_NAME);
  }

  /**
   * 从完整消息时间线选择包含完整 Turn 的尾部窗口。
   * @param {Array<Record<string, unknown>>} messages 完整消息时间线。
   * @param {number} limit 目标消息数量。
   * @returns {{messages: Array<Record<string, unknown>>, start: number, total: number}} 尾部窗口及全局位置。
   */
  function selectTailMessages(messages, limit = TAIL_WINDOW_MESSAGE_LIMIT) {
    const timeline = Array.isArray(messages) ? messages : [];
    let start = Math.max(0, timeline.length - Math.max(1, limit));
    const turnId = typeof timeline[start]?.turnId === 'string' ? timeline[start].turnId : '';
    // 尾部快照不得从同一 Turn 中间切开，避免 Function Calling 配对不完整。
    while (turnId && start > 0 && timeline[start - 1]?.turnId === turnId) start -= 1;
    return { messages: timeline.slice(start), start, total: timeline.length };
  }

  /**
   * 构建与指定日志字节边界严格绑定的轻量尾部快照。
   * @param {Record<string, unknown>} conversation 完整会话状态。
   * @param {number} seq 当前日志事件序号。
   * @param {number} logBytes 当前完整日志字节数。
   * @returns {Record<string, unknown>} 可原子写入磁盘的尾部快照。
   */
  function createTailWindowSnapshot(conversation, seq, logBytes) {
    const tail = selectTailMessages(conversation.messages);
    return {
      type: 'conversation/window',
      version: SESSION_FORMAT_VERSION,
      id: conversation.id,
      seq,
      logBytes,
      state: createConversationState(conversation),
      messages: tail.messages,
      start: tail.start,
      total: tail.total,
    };
  }

  /**
   * 原子写入尾部窗口，失败时不影响已经提交的 JSONL 事实日志。
   * @param {Record<string, unknown>} conversation 完整会话状态。
   * @param {number} seq 当前日志事件序号。
   * @param {number} logBytes 当前完整日志字节数。
   * @returns {boolean} 是否成功更新尾部快照。
   */
  function writeTailWindow(conversation, seq, logBytes) {
    const snapshot = createTailWindowSnapshot(conversation, seq, logBytes);
    const filePath = getTailWindowPath(conversation.id);
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(temporaryPath, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporaryPath, filePath);
      tailWindowCache.set(conversation.id, snapshot);
      return true;
    } catch {
      // 快照仅用于加速读取；写入失败时保留 JSONL 并让读取路径自动回退重放。
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* 临时文件可能尚未创建。 */ }
      tailWindowCache.delete(conversation.id);
      return false;
    }
  }

  /**
   * 读取并校验尾部窗口，日志大小不匹配时拒绝使用过期快照。
   * @param {unknown} id 会话标识。
   * @returns {Record<string, unknown>|null} 有效尾部快照；缺失或过期时返回空值。
   */
  function readTailWindow(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return null;
    const logPath = getLogPath(normalizedId);

    /**
     * 校验快照结构及其绑定的日志字节边界。
     * @param {unknown} snapshot 待校验的尾部窗口。
     * @returns {Record<string, unknown>|null} 有效快照；结构或日志边界不匹配时返回空值。
     */
    function validate(snapshot) {
      try {
        if (!snapshot || snapshot.type !== 'conversation/window' || snapshot.version !== SESSION_FORMAT_VERSION || snapshot.id !== normalizedId) return null;
        if (!Number.isSafeInteger(snapshot.logBytes) || !fs.existsSync(logPath) || fs.statSync(logPath).size !== snapshot.logBytes) return null;
        if (!Array.isArray(snapshot.messages) || !snapshot.state || typeof snapshot.state !== 'object') return null;
        if (!Number.isSafeInteger(snapshot.start) || !Number.isSafeInteger(snapshot.total) || snapshot.start < 0) return null;
        if (snapshot.total < snapshot.start || snapshot.start + snapshot.messages.length !== snapshot.total) return null;
        return snapshot;
      } catch {
        // 文件可能在会话删除或修复期间变化，交由完整日志路径重新判断。
        return null;
      }
    }

    const cached = validate(tailWindowCache.get(normalizedId));
    if (cached) return cached;
    try {
      const parsed = validate(JSON.parse(fs.readFileSync(getTailWindowPath(normalizedId), 'utf8')));
      if (parsed) tailWindowCache.set(normalizedId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * 将会话索引写入 ZTools 数据库并沿用现有修订号。
   * @param {Record<string, unknown>} conversation 已规范化会话。
   * @returns {void} 无返回值。
   * @throws {Error} 数据库写入失败时抛出。
   */
  function writeIndex(conversation) {
    const { db } = requireDependencies();
    const documentId = getDocumentId(conversation.id);
    const existing = db.get(documentId);
    const document = {
      _id: documentId,
      kind: INDEX_DOCUMENT_KIND,
      storageVersion: conversation.storageVersion,
      metadata: createConversationMetadata(conversation),
    };
    if (existing?._rev) document._rev = existing._rev;
    // 索引不包含正文，确保云同步始终只传输轻量元数据。
    assertDatabaseResult(db.put(document), '保存会话索引');
  }

  /**
   * 解析数据库中的轻量会话索引。
   * @param {unknown} document 原始数据库文档。
   * @returns {Record<string, unknown>|null} 规范化会话元数据；无效文档返回空值。
   */
  function parseIndex(document) {
    if (!document || document.kind !== INDEX_DOCUMENT_KIND || !document.metadata || typeof document.metadata !== 'object') return null;
    const conversation = options.normalizeConversation(document.metadata);
    return conversation.id ? conversation : null;
  }

  /**
   * 可靠写入一个新会话日志文件。
   * @param {Record<string, unknown>} conversation 会话初始状态。
   * @returns {{seq: number, commitCount: number, logBytes: number}} 初始日志游标。
   * @throws {Error} 日志已存在或文件系统写入失败时抛出。
   */
  function createLog(conversation) {
    const filePath = getLogPath(conversation.id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const header = { type: 'session', version: SESSION_FORMAT_VERSION, id: conversation.id, createdAt: conversation.createdAt };
    const content = `${JSON.stringify(header)}\n${JSON.stringify(createCheckpointEvent(conversation, 0))}\n`;
    const descriptor = fs.openSync(filePath, 'wx');
    try {
      fs.writeFileSync(descriptor, content, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    return { seq: 0, commitCount: 0, logBytes: Buffer.byteLength(content, 'utf8') };
  }

  /**
   * 扫描完整日志并从最近检查点与后续原子提交恢复会话。
   * @param {string} filePath 日志文件路径。
   * @param {Record<string, unknown>} indexedConversation 数据库索引提供的基础会话。
   * @returns {{conversation: Record<string, unknown>, seq: number, commitCount: number, validBytes: number, totalBytes: number}} 日志重放结果。
   * @throws {Error} 会话头或事件序号无效时抛出。
   */
  function scanLog(filePath, indexedConversation) {
    const content = fs.readFileSync(filePath);
    let offset = 0;
    let validBytes = 0;
    let lineIndex = 0;
    let seq = -1;
    let commitCount = 0;
    let conversation = options.normalizeConversation(indexedConversation);
    while (offset < content.length) {
      const newline = content.indexOf(10, offset);
      if (newline < 0) break;
      const rawLine = content.subarray(offset, newline).toString('utf8').trim();
      const nextOffset = newline + 1;
      let record;
      try { record = rawLine ? JSON.parse(rawLine) : null; } catch { break; }
      if (lineIndex === 0) {
        if (!record || record.type !== 'session' || record.version !== SESSION_FORMAT_VERSION || record.id !== indexedConversation.id) {
          throw new Error('会话日志头无效或与索引不匹配');
        }
      } else if (record?.type === 'conversation/checkpoint' && record.version === SESSION_FORMAT_VERSION) {
        if (!Number.isSafeInteger(record.seq) || record.seq < 0) break;
        conversation = options.normalizeConversation({
          ...(record.state && typeof record.state === 'object' ? record.state : {}),
          messages: Array.isArray(record.messages) ? record.messages : [],
        });
        seq = record.seq;
        commitCount = 0;
      } else if (record?.type === 'conversation/commit' && record.version === SESSION_FORMAT_VERSION && record.seq === seq + 1) {
        conversation = applyCommitEvent(conversation, record, options.normalizeConversation);
        seq = record.seq;
        commitCount += 1;
      } else break;
      lineIndex += 1;
      validBytes = nextOffset;
      offset = nextOffset;
    }
    if (lineIndex < 2 || seq < 0) throw new Error('会话日志缺少有效检查点');
    return { conversation, seq, commitCount, validBytes, totalBytes: content.length };
  }

  /**
   * 加载会话日志，并丢弃崩溃时留下的不完整尾部。
   * @param {Record<string, unknown>} indexedConversation 数据库索引提供的基础会话。
   * @returns {{conversation: Record<string, unknown>, seq: number, commitCount: number, logBytes: number}} 可继续追加的会话状态。
   * @throws {Error} 日志主体损坏或修复失败时抛出。
   */
  function loadLog(indexedConversation) {
    const filePath = getLogPath(indexedConversation.id);
    if (!fs.existsSync(filePath)) throw new Error('会话日志不存在');
    const scanned = scanLog(filePath, indexedConversation);
    if (scanned.validBytes < scanned.totalBytes) {
      // 仅截断第一个无效记录之后的尾部，保留所有已经 fsync 的完整提交。
      fs.truncateSync(filePath, scanned.validBytes);
    }
    // 完整重放完成后修复尾部窗口，后续冷启动无需再次扫描同一份日志。
    writeTailWindow(scanned.conversation, scanned.seq, scanned.validBytes);
    return {
      conversation: scanned.conversation,
      seq: scanned.seq,
      commitCount: scanned.commitCount,
      logBytes: scanned.validBytes,
    };
  }

  /**
   * 返回存储层内部的完整会话游标，冷会话仅在首次访问时重放日志。
   * @param {unknown} id 会话标识。
   * @returns {{conversation: Record<string, unknown>, seq: number, commitCount: number, logBytes: number, messageIndex?: Map<string, number>}|null} 内部会话游标。
   */
  function getCurrent(id) {
    const normalizedId = String(id || '').trim();
    if (cache.has(normalizedId)) return cache.get(normalizedId);
    const indexed = parseIndex(requireDependencies().db.get(getDocumentId(normalizedId)));
    if (!indexed) return null;
    const loaded = loadLog(indexed);
    cache.set(normalizedId, loaded);
    return loaded;
  }

  /**
   * 在当前会话游标上直接应用原子消息变化，避免复制和比较完整消息数组。
   * @param {{conversation: Record<string, unknown>, messageIndex?: Map<string, number>}} current 当前内部会话游标。
   * @param {Record<string, unknown>} event 原子提交事件。
   * @returns {Record<string, unknown>} 应用变化后的完整会话。
   */
  function applyAtomicEvent(current, event) {
    const messages = current.conversation.messages;
    let messageIndex = current.messageIndex;
    if (!messageIndex) {
      messageIndex = new Map(messages.map((message, index) => [String(message?.id || ''), index]).filter(([id]) => id));
      current.messageIndex = messageIndex;
    }
    for (const item of Array.isArray(event.messages?.upserts) ? event.messages.upserts : []) {
      const id = String(item?.message?.id || '').trim();
      if (!id) continue;
      const index = messageIndex.get(id);
      if (index === undefined) {
        messageIndex.set(id, messages.length);
        messages.push(item.message);
      } else messages[index] = item.message;
    }
    const removedIds = new Set((Array.isArray(event.messages?.removed) ? event.messages.removed : []).map((key) => String(key).replace(/^id:/, '')));
    if (removedIds.size) {
      // 删除属于低频维护动作，完成后一次性重建位置索引。
      const retained = messages.filter((message) => !removedIds.has(String(message?.id || '')));
      messages.splice(0, messages.length, ...retained);
      current.messageIndex = new Map(messages.map((message, index) => [String(message?.id || ''), index]).filter(([id]) => id));
    }
    return options.normalizeConversation({
      ...current.conversation,
      ...(event.state && typeof event.state === 'object' ? event.state : {}),
      messages,
    });
  }

  /**
   * 将一条原子提交追加并同步到磁盘，失败时回滚到原文件长度。
   * @param {string} filePath 日志文件路径。
   * @param {Record<string, unknown>} event 待追加事件。
   * @returns {number} 追加完成后的日志字节数。
   * @throws {Error} 写入、同步或回滚失败时抛出。
   */
  function appendEvent(filePath, event) {
    const descriptor = fs.openSync(filePath, 'a+');
    const previousSize = fs.fstatSync(descriptor).size;
    try {
      fs.writeSync(descriptor, `${JSON.stringify(event)}\n`, null, 'utf8');
      fs.fsyncSync(descriptor);
      return fs.fstatSync(descriptor).size;
    } catch (error) {
      // 失败时恢复到上一个完整事件边界，避免下一次加载读到半条 JSON。
      try { fs.ftruncateSync(descriptor, previousSize); } catch { /* 原始写入错误更能说明失败原因。 */ }
      throw error;
    } finally {
      fs.closeSync(descriptor);
    }
  }

  /**
   * 将增长过长的事件日志原子压实为会话头和单个完整检查点。
   * @param {Record<string, unknown>} conversation 当前完整会话。
   * @param {number} seq 当前日志序号。
   * @returns {number} 压实完成后的日志字节数。
   * @throws {Error} 临时文件写入、同步或替换失败时抛出。
   */
  function compactLog(conversation, seq) {
    const filePath = getLogPath(conversation.id);
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const header = { type: 'session', version: SESSION_FORMAT_VERSION, id: conversation.id, createdAt: conversation.createdAt };
    const content = `${JSON.stringify(header)}\n${JSON.stringify(createCheckpointEvent(conversation, seq))}\n`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporaryPath, 'wx');
      fs.writeFileSync(descriptor, content, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, filePath);
      return Buffer.byteLength(content, 'utf8');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
  }

  /**
   * 创建新会话的检查点日志和轻量索引。
   * @param {Record<string, unknown>} conversation 新会话状态。
   * @returns {Record<string, unknown>} 已保存的规范化会话。
   * @throws {Error} 日志或索引创建失败时抛出。
   */
  function create(conversation) {
    // 新会话仅在首次物化时复制一次，避免调用方后续修改共享引用绕过事件日志。
    const normalized = options.normalizeConversation(cloneJson(conversation));
    const filePath = getLogPath(normalized.id);
    try {
      const cursor = createLog(normalized);
      writeIndex(normalized);
      writeTailWindow(normalized, cursor.seq, cursor.logBytes);
      cache.set(normalized.id, { conversation: normalized, ...cursor });
      return cloneJson(normalized);
    } catch (error) {
      // 新会话索引未发布时清除半成品目录，确保用户可以直接重试。
      cache.delete(normalized.id);
      fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * 按标识加载一条完整会话。
   * @param {unknown} id 会话标识。
   * @returns {Record<string, unknown>|null} 重放后的完整会话；索引不存在时返回空值。
   * @throws {Error} 数据库或日志读取失败时抛出。
   */
  function get(id) {
    const current = getCurrent(id);
    return current ? cloneJson(current.conversation) : null;
  }

  /**
   * 按标识读取一条轻量会话索引，不打开或重放 JSONL 日志。
   * @param {unknown} id 会话标识。
   * @returns {Record<string, unknown>|null} 会话元数据；索引不存在时返回空值。
   */
  function getMetadata(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return null;
    const { db } = requireDependencies();
    return parseIndex(db.get(getDocumentId(normalizedId)));
  }

  /**
   * 读取会话的非消息状态，避免把完整正文传给界面层。
   * @param {unknown} id 会话标识。
   * @returns {Record<string, unknown>|null} 不含消息数组的完整运行状态；会话不存在时返回空值。
   */
  function getState(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId || !getMetadata(normalizedId)) return null;
    const snapshot = readTailWindow(normalizedId);
    if (snapshot) return cloneJson(snapshot.state);
    const current = getCurrent(normalizedId);
    return current ? cloneJson(createConversationState(current.conversation)) : null;
  }

  /**
   * 从一段带全局起点的消息窗口中读取按完整 Turn 对齐的页面。
   * @param {Array<Record<string, unknown>>} messages 可用消息窗口。
   * @param {number} windowStart 可用窗口在完整时间线中的起点。
   * @param {number} total 完整时间线消息总数。
   * @param {{before?: number, limit?: number}} page 分页游标和目标条数。
   * @returns {{messages: Array<Record<string, unknown>>, start: number, hasMore: boolean, total: number}|null} 可由当前窗口满足的页面；范围不足时返回空值。
   */
  function readPageFromWindow(messages, windowStart, total, page) {
    const before = Math.max(0, Math.min(total, Number.isFinite(page.before) ? Math.floor(page.before) : total));
    const limit = Math.max(1, Math.min(500, Number.isFinite(page.limit) ? Math.floor(page.limit) : 50));
    if (before < windowStart || before > windowStart + messages.length) return null;
    let start = Math.max(0, before - limit);
    if (start < windowStart) return null;
    const localStart = start - windowStart;
    const turnId = typeof messages[localStart]?.turnId === 'string' ? messages[localStart].turnId : '';
    // 页面边界向前扩展到完整 Turn，避免拆开模型调用与配对工具结果。
    while (turnId && start > windowStart && messages[start - windowStart - 1]?.turnId === turnId) start -= 1;
    return {
      messages: cloneJson(messages.slice(start - windowStart, before - windowStart)),
      start,
      hasMore: start > 0,
      total,
    };
  }

  /**
   * 读取一个按完整 Turn 对齐的历史消息窗口。
   * @param {unknown} id 会话标识。
   * @param {{before?: number, limit?: number}} page 分页游标和目标条数。
   * @returns {{messages: Array<Record<string, unknown>>, start: number, hasMore: boolean, total: number}|null} 历史窗口；会话不存在时返回空值。
   */
  function getPage(id, page = {}) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId || !getMetadata(normalizedId)) return null;
    const snapshot = readTailWindow(normalizedId);
    if (snapshot) {
      const snapshotPage = readPageFromWindow(snapshot.messages, snapshot.start, snapshot.total, page);
      if (snapshotPage) return snapshotPage;
    }
    // 仅当请求超出尾部窗口时重放完整日志，承担加载更旧历史的成本。
    const current = getCurrent(normalizedId);
    return current
      ? readPageFromWindow(current.conversation.messages, 0, current.conversation.messages.length, page)
      : null;
  }

  /**
   * 列出全部轻量会话索引，不读取任何消息日志。
   * @returns {Array<Record<string, unknown>>} 按更新时间倒序排列的会话元数据。
   * @throws {Error} 数据库读取失败时抛出。
   */
  function list() {
    const { db } = requireDependencies();
    const documents = db.allDocs(options.documentPrefix);
    return (Array.isArray(documents) ? documents : [])
      .map(parseIndex)
      .filter(Boolean)
      .filter((conversation) => conversation.archived !== true)
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
  }

  /**
   * 追加保存一条完整会话与上次状态之间的原子差异。
   * @param {Record<string, unknown>} conversation 待保存的完整会话。
   * @returns {Record<string, unknown>} 已持久化的规范化会话。
   * @throws {Error} 会话不存在或日志、索引写入失败时抛出。
   */
  function save(conversation) {
    const normalized = options.normalizeConversation(conversation);
    const current = getCurrent(normalized.id);
    if (!current) throw new Error('会话不存在');
    const filePath = getLogPath(normalized.id);
    const event = createCommitEvent(current.conversation, normalized, current.seq + 1);
    const logBytes = appendEvent(filePath, event);
    const next = { conversation: normalized, seq: event.seq, commitCount: current.commitCount + 1, logBytes };
    cache.set(normalized.id, next);
    writeIndex(normalized);
    if (next.commitCount >= CHECKPOINT_COMMIT_INTERVAL || logBytes >= CHECKPOINT_LOG_BYTES) {
      // 压实属于保存后的维护步骤；失败时保留已提交日志，下次保存会再次尝试。
      try {
        next.logBytes = compactLog(normalized, event.seq);
        next.commitCount = 0;
      } catch { /* 已追加并同步的原子提交仍然有效。 */ }
    }
    writeTailWindow(normalized, event.seq, next.logBytes);
    return cloneJson(normalized);
  }

  /**
   * 直接提交调用方已经定位的消息变化和会话状态，避免重新比较完整历史。
   * @param {unknown} id 会话标识。
   * @param {{state?: Record<string, unknown>, upserts?: Array<Record<string, unknown>>, removedIds?: string[]}} changes 原子变化集合。
   * @returns {Record<string, unknown>} 提交后的轻量会话元数据。
   * @throws {Error} 会话不存在或日志写入失败时抛出。
   */
  function commit(id, changes = {}) {
    const normalizedId = String(id || '').trim();
    const current = getCurrent(normalizedId);
    if (!current) throw new Error('会话不存在');
    const state = changes.state && typeof changes.state === 'object' ? changes.state : {};
    if (!current.messageIndex) {
      current.messageIndex = new Map(current.conversation.messages.map((message, index) => [String(message?.id || ''), index]).filter(([messageId]) => messageId));
    }
    const event = createAtomicCommitEvent(current.conversation, {
      state: {
        ...state,
        id: normalizedId,
        updatedAt: Number(state.updatedAt) || current.conversation.updatedAt,
      },
      upserts: cloneJson(Array.isArray(changes.upserts) ? changes.upserts : []),
      removedIds: Array.isArray(changes.removedIds) ? changes.removedIds : [],
    }, current.seq + 1, new Set(current.messageIndex.keys()));
    const nextConversation = applyAtomicEvent(current, event);
    const filePath = getLogPath(normalizedId);
    const logBytes = appendEvent(filePath, event);
    const next = {
      conversation: nextConversation,
      seq: event.seq,
      commitCount: current.commitCount + 1,
      logBytes,
      messageIndex: current.messageIndex,
    };
    cache.set(normalizedId, next);
    writeIndex(nextConversation);
    if (next.commitCount >= CHECKPOINT_COMMIT_INTERVAL || logBytes >= CHECKPOINT_LOG_BYTES) {
      // 压实失败不会撤销已经同步完成的原子提交，下次提交会继续尝试。
      try {
        next.logBytes = compactLog(nextConversation, event.seq);
        next.commitCount = 0;
      } catch { /* 已提交事件保持有效。 */ }
    }
    writeTailWindow(nextConversation, event.seq, next.logBytes);
    return cloneJson(createConversationMetadata(nextConversation));
  }

  /**
   * 释放单个会话的完整内存快照，轻量索引与磁盘日志保持不变。
   * @param {unknown} id 会话标识。
   * @returns {boolean} 是否移除了已缓存快照。
   */
  function release(id) {
    const normalizedId = String(id || '').trim();
    const releasedCurrent = cache.delete(normalizedId);
    const releasedWindow = tailWindowCache.delete(normalizedId);
    return releasedCurrent || releasedWindow;
  }

  /**
   * 删除会话索引及其本地日志目录。
   * @param {unknown} id 会话标识。
   * @returns {boolean} 是否完成删除。
   * @throws {Error} 数据库删除失败时抛出。
   */
  function remove(id) {
    const { db } = requireDependencies();
    const existing = db.get(getDocumentId(id));
    if (existing) assertDatabaseResult(db.remove(existing), '删除会话索引');
    release(id);
    // 索引删除成功后清理仅属于该会话的日志目录。
    fs.rmSync(path.dirname(getLogPath(id)), { recursive: true, force: true });
    return true;
  }

  return { create, get, getMetadata, getState, getPage, list, commit, save, release, remove, getLogPath };
}

module.exports = {
  CHECKPOINT_COMMIT_INTERVAL,
  INDEX_DOCUMENT_KIND,
  LOG_FILE_NAME,
  SESSION_FORMAT_VERSION,
  TAIL_WINDOW_FILE_NAME,
  TAIL_WINDOW_MESSAGE_LIMIT,
  createConversationStore,
};
