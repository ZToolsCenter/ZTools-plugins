'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { compressImage } = require('./compression-worker');
const PLUGIN_VERSION = require('./plugin.json').version;

const WORKSPACE = path.join(os.tmpdir(), 'ztools.image.compression');
const DEBUG_LOG_PATH = path.join(WORKSPACE, 'compression-debug.log');
const HISTORY_KEY = 'history-v3';
const HISTORY_LIMIT = 8;
const STALE_AFTER = 24 * 60 * 60 * 1000;
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg']);
const COMPRESSION_WORKER_PATH = path.join(__dirname, 'compression-worker.js');
const MAX_COMPRESSION_EXECUTORS = 4;
const ACTIVE_COMPRESSION_EXECUTORS = new WeakMap();

/**
 * 创建唯一的批次标识。
 * @param {string} prefix 标识前缀
 * @returns {string} 唯一标识
 */
function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 将一条压缩诊断信息追加到临时日志。
 * @param {string} event 事件名称
 * @param {object} details 事件详情
 * @returns {Promise<void>} 完成信号
 */
async function appendCompressionDebugLog(event, details = {}) {
  const record = {
    time: new Date().toISOString(),
    event,
    ...details
  };
  try {
    await fsp.mkdir(WORKSPACE, { recursive: true });
    await fsp.appendFile(DEBUG_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    console.error('[img-comp] 写入压缩诊断日志失败:', error);
  }
}

/**
 * 重置压缩诊断日志，并记录当前宿主与批次信息。
 * @param {object} batch 批次
 * @returns {Promise<void>} 完成信号
 */
async function resetCompressionDebugLog(batch) {
  const record = {
    time: new Date().toISOString(),
    event: '批次开始',
    pluginVersion: PLUGIN_VERSION,
    batchId: batch.id,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    electron: process.versions.electron || null,
    chrome: process.versions.chrome || null,
    availableParallelism: typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length,
    entryCount: batch.entries.length,
    inputBytes: batch.entries.reduce((total, entry) => total + (Number(entry.inputBytes) || 0), 0)
  };
  try {
    await fsp.mkdir(WORKSPACE, { recursive: true });
    await fsp.writeFile(DEBUG_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    console.error('[img-comp] 重置压缩诊断日志失败:', error);
  }
}

/**
 * 确保工作目录存在，并清理过期的临时结果。
 * @returns {Promise<void>} 完成信号
 */
async function prepareWorkspace() {
  await fsp.mkdir(WORKSPACE, { recursive: true });
  const cutoff = Date.now() - STALE_AFTER;
  let names = [];
  try { names = await fsp.readdir(WORKSPACE); } catch { return; }
  await Promise.all(names.map(async name => {
    const candidate = path.join(WORKSPACE, name);
    try {
      const stat = await fsp.stat(candidate);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) {
        await fsp.rm(candidate, { recursive: true, force: true });
      }
    } catch {}
  }));
}

/**
 * 将 Data URI 转成文件内容。
 * @param {string} value 图片 Data URI
 * @returns {{extension:string, bytes:Buffer}} 图片扩展名和字节
 */
function decodeDataUri(value) {
  const match = /^data:image\/([a-z0-9+.-]+);base64,(.+)$/i.exec(value || '');
  if (!match) throw new Error('图片数据格式无效');
  const subtype = match[1].toLowerCase();
  const extension = `.${subtype === 'jpeg' ? 'jpg' : subtype === 'svg+xml' ? 'svg' : subtype}`;
  return { extension, bytes: Buffer.from(match[2], 'base64') };
}

/**
 * 将相对输出路径清理为安全的 POSIX 风格路径。
 * @param {unknown} value 原始路径
 * @param {string} fallback 备用文件名
 * @returns {string} 安全的相对路径
 */
function safeRelativeName(value, fallback) {
  const source = String(value || fallback || 'image');
  const parts = source
    .replace(/\\/g, '/')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .map(part => part.replace(/[<>:"|?*\u0000-\u001f]/g, '_'));
  return parts.length > 0 ? parts.join('/') : (fallback || 'image');
}

/**
 * 为批次中的每个输入项分配不冲突的输出路径。
 * @param {Array<object>} entries 输入项
 */
function assignOutputNames(entries) {
  const used = new Set();
  for (const entry of entries) {
    const fallback = path.basename(entry.filename || 'image');
    const original = safeRelativeName(entry.relativeName, fallback);
    let candidate = original;
    let key = candidate.toLowerCase();
    if (used.has(key)) {
      const parent = safeRelativeName(path.basename(path.dirname(entry.inputPath)), 'images');
      candidate = safeRelativeName(`${parent}/${fallback}`, fallback);
      key = candidate.toLowerCase();
    }
    if (used.has(key)) {
      const extension = path.extname(fallback);
      const stem = path.basename(fallback, extension);
      const parent = path.posix.dirname(candidate);
      let suffix = 2;
      do {
        const name = `${stem} (${suffix++})${extension}`;
        candidate = parent === '.' ? name : `${parent}/${name}`;
        key = candidate.toLowerCase();
      } while (used.has(key));
    }
    used.add(key);
    entry.outputName = candidate;
  }
}

/**
 * 清理历史记录中已经失效的临时结果路径。
 * @param {object} entry 历史输入项
 * @returns {object} 可展示输入项
 */
function restoreEntry(entry) {
  const restored = { ...entry };
  if (restored.resultPath && !fs.existsSync(restored.resultPath)) {
    restored.resultPath = null;
    restored.resultBytes = restored.inputBytes;
    restored.savedPercent = 0;
  }
  restored.relativeName = safeRelativeName(restored.relativeName, restored.filename);
  return restored;
}

/**
 * 规范化历史记录顺序和数量。
 * @param {unknown} value 原始记录
 * @returns {Array<object>} 规范化记录
 */
function normaliseHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === 'object')
    .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0))
    .slice(-HISTORY_LIMIT);
}

/**
 * 读取持久化历史记录。
 * @returns {Array<object>} 历史记录
 */
function readHistory() {
  try {
    const storage = globalThis.window?.ztools?.dbStorage;
    if (!storage) return [];
    const raw = storage.getItem(HISTORY_KEY);
    return raw ? normaliseHistory(JSON.parse(raw)) : [];
  } catch (error) {
    console.error('[img-comp] 读取历史记录失败:', error);
    return [];
  }
}

/**
 * 写入持久化历史记录。
 * @param {Array<object>} records 历史记录
 * @returns {boolean} 是否写入成功
 */
function writeHistory(records) {
  try {
    const storage = globalThis.window?.ztools?.dbStorage;
    if (!storage) return false;
    storage.setItem(HISTORY_KEY, JSON.stringify(normaliseHistory(records)));
    return true;
  } catch (error) {
    console.error('[img-comp] 写入历史记录失败:', error);
    return false;
  }
}

/**
 * 删除一条历史记录。
 * @param {string} id 记录标识
 * @returns {boolean} 是否写入成功
 */
function removeHistory(id) {
  return writeHistory(readHistory().filter(item => item.id !== id));
}

/**
 * 清空历史记录。
 * @returns {boolean} 是否写入成功
 */
function clearHistory() {
  try {
    const storage = globalThis.window?.ztools?.dbStorage;
    if (!storage) return false;
    storage.removeItem(HISTORY_KEY);
    storage.removeItem('history');
    return true;
  } catch { return false; }
}

/**
 * 读取路径的文件名和大小。
 * @param {string} filePath 文件路径
 * @param {string} fallbackName 备用文件名
 * @returns {Promise<object|null>} 输入项
 */
async function inspectFile(filePath, fallbackName) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return null;
    const filename = fallbackName || path.basename(filePath);
    if (!SUPPORTED_EXTENSIONS.has(path.extname(filename).toLowerCase())) return null;
    return {
      id: makeId('entry'),
      inputPath: path.resolve(filePath),
      inputBytes: stat.size,
      filename,
      relativeName: filename,
      outputName: filename,
      resultPath: null,
      resultBytes: null,
      savedPercent: null,
      error: null
    };
  } catch { return null; }
}

/**
 * 递归收集目录中的图片。
 * @param {string} basePath 根目录
 * @returns {Promise<Array<object>>} 输入项
 */
async function collectDirectory(basePath) {
  const result = [];
  async function visit(currentPath) {
    let entries;
    try { entries = await fsp.readdir(currentPath, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.endsWith('.asar')) continue;
        await visit(fullPath);
      } else if (entry.isFile()) {
        const item = await inspectFile(fullPath);
        if (item) item.relativeName = path.relative(basePath, fullPath) || item.filename;
        if (item) result.push(item);
      }
    }
  }
  await visit(basePath);
  return result;
}

/**
 * 创建空批次对象。
 * @param {string} kind 批次来源类型
 * @returns {object} 批次
 */
function createBatchState(kind) {
  return {
    id: makeId('batch'),
    kind,
    createdAt: Date.now(),
    phase: 'pending',
    cancelled: false,
    rootPath: null,
    outputRoot: null,
    entries: [],
    progress: { total: 0, completed: 0, succeeded: 0, failed: 0, percent: 0 }
  };
}

/**
 * 将剪贴板图片写入批次工作目录。
 * @param {object} batch 批次
 * @param {string[]} dataUris 图片数据
 * @returns {Promise<void>} 完成信号
 */
async function attachDataUris(batch, dataUris) {
  if (!Array.isArray(dataUris) || dataUris.length === 0) return;
  const inputRoot = path.join(WORKSPACE, 'clipboard', batch.id);
  await fsp.mkdir(inputRoot, { recursive: true });
  for (let index = 0; index < dataUris.length; index++) {
    const decoded = decodeDataUri(dataUris[index]);
    const filename = `clipboard-${index + 1}${decoded.extension}`;
    const inputPath = path.join(inputRoot, filename);
    await fsp.writeFile(inputPath, decoded.bytes);
    batch.entries.push({
      id: makeId('entry'),
      inputPath,
      inputBytes: decoded.bytes.length,
      filename,
      relativeName: filename,
      outputName: filename,
      resultPath: null,
      resultBytes: null,
      savedPercent: null,
      error: null
    });
  }
}

/**
 * 根据 ZTools 输入创建一个批次。
 * @param {{kind:string,payload?:unknown}} request 输入请求
 * @returns {Promise<object>} 批次
 */
async function createBatch(request = {}) {
  await prepareWorkspace();
  const batch = createBatchState(request.kind || 'files');
  if (request.kind === 'clipboard') {
    await attachDataUris(batch, Array.isArray(request.payload) ? request.payload : [request.payload]);
  } else {
    const descriptors = Array.isArray(request.payload) ? request.payload : [];
    const directories = descriptors.filter(item => item && item.isDirectory && item.path);
    const files = descriptors.filter(item => item && item.isFile && item.path);
    for (const descriptor of directories) {
      const root = path.resolve(descriptor.path);
      const entries = await collectDirectory(root);
      if (!batch.rootPath && directories.length === 1) batch.rootPath = root;
      batch.entries.push(...entries);
    }
    for (const descriptor of files) {
      const item = await inspectFile(descriptor.path, descriptor.name);
      if (item) batch.entries.push(item);
    }
  }
  assignOutputNames(batch.entries);
  batch.progress.total = batch.entries.length;
  return batch;
}

/**
 * 向已有批次追加剪贴板图片。
 * @param {object} batch 批次
 * @param {string[]} dataUris 图片数据
 * @returns {Promise<object>} 更新后的批次
 */
async function addDataUris(batch, dataUris) {
  await attachDataUris(batch, dataUris);
  assignOutputNames(batch.entries);
  batch.progress.total = batch.entries.length;
  return batch;
}

/**
 * 生成当前批次的输出路径。
 * @param {object} batch 批次
 * @param {object} entry 输入项
 * @returns {string} 输出路径
 */
function resultPathFor(batch, entry) {
  if (!batch.outputRoot) batch.outputRoot = path.join(WORKSPACE, 'results', batch.id);
  return path.join(batch.outputRoot, entry.outputName || entry.relativeName || entry.filename);
}

/**
 * 根据机器并行度和任务数量计算并行执行器数量。
 * @param {object[]} entries 待处理图片
 * @returns {number} 并行执行器数量
 */
function compressionExecutorCount(entries) {
  if (entries.length === 0) return 0;
  const parallelism = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  const largestInputBytes = entries.reduce((largest, entry) => {
    return Math.max(largest, Number(entry.inputBytes) || 0);
  }, 0);
  const sizeLimit = largestInputBytes >= 32 * 1024 * 1024
    ? 2
    : largestInputBytes >= 16 * 1024 * 1024 ? 3 : MAX_COMPRESSION_EXECUTORS;
  return Math.min(entries.length, sizeLimit, Math.max(1, parallelism - 1));
}

/**
 * 将线程或子进程通道包装成串行压缩执行器。
 * @param {number} executorId 执行器编号
 * @param {string} mode 执行器类型
 * @param {import('node:events').EventEmitter} channel 消息通道
 * @param {(task:object)=>void} sendTask 发送任务函数
 * @param {()=>unknown} stopChannel 停止通道函数
 * @returns {{id:number,mode:string,run:(task:object)=>Promise<object>,close:()=>Promise<unknown>}} 压缩执行器
 */
function createCompressionClient(executorId, mode, channel, sendTask, stopChannel) {
  let pending = null;
  let failure = null;
  let closed = false;
  let closePromise = null;

  /**
   * 拒绝当前等待中的任务。
   * @param {Error} error 失败原因
   */
  function rejectPending(error) {
    if (!pending) return;
    const current = pending;
    pending = null;
    current.reject(error);
  }

  channel.on('message', message => {
    if (!pending || !message || message.id !== pending.id) return;
    const current = pending;
    pending = null;
    current.resolve(message);
  });
  channel.on('error', error => {
    failure = error;
    void appendCompressionDebugLog('压缩执行器异常', {
      executorId,
      mode,
      error: error && error.stack ? error.stack : String(error)
    });
    rejectPending(error);
  });
  channel.on('exit', (code, signal) => {
    void appendCompressionDebugLog('压缩执行器退出', {
      executorId,
      mode,
      code,
      signal,
      expected: closed
    });
    if (closed) return;
    failure = failure || new Error(`压缩执行器意外退出，代码 ${code}，信号 ${signal || '无'}`);
    rejectPending(failure);
  });

  /**
   * 在执行器中运行一个压缩任务。
   * @param {object} task 压缩任务
   * @returns {Promise<object>} 执行器响应
   */
  function run(task) {
    if (closed) return Promise.reject(new Error('压缩执行器已停止'));
    if (failure) return Promise.reject(failure);
    if (pending) return Promise.reject(new Error('压缩执行器仍有任务未完成'));
    return new Promise((resolve, reject) => {
      pending = { id: task.id, resolve, reject };
      try {
        sendTask(task);
      } catch (error) {
        pending = null;
        reject(error);
      }
    });
  }

  /**
   * 停止压缩执行器。
   * @returns {Promise<unknown>} 停止信号
   */
  function close() {
    if (closePromise) return closePromise;
    closed = true;
    rejectPending(new Error('压缩执行器已停止'));
    closePromise = Promise.resolve().then(stopChannel).catch(() => undefined);
    return closePromise;
  }

  return { id: executorId, mode, run, close };
}

/**
 * 创建一个工作线程压缩执行器。
 * @param {number} executorId 执行器编号
 * @returns {{id:number,mode:string,run:(task:object)=>Promise<object>,close:()=>Promise<unknown>}} 压缩执行器
 */
function createCompressionWorkerClient(executorId) {
  const worker = new Worker(COMPRESSION_WORKER_PATH);
  const client = createCompressionClient(
    executorId,
    'worker-thread',
    worker,
    task => worker.postMessage(task),
    () => worker.terminate()
  );
  worker.on('online', () => {
    void appendCompressionDebugLog('工作线程上线', { executorId });
  });
  return client;
}

/**
 * 创建一个独立 Node 子进程压缩执行器。
 * @param {number} executorId 执行器编号
 * @returns {{id:number,mode:string,run:(task:object)=>Promise<object>,close:()=>Promise<unknown>}} 压缩执行器
 */
function createCompressionProcessClient(executorId) {
  const child = fork(COMPRESSION_WORKER_PATH, [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true
  });
  const client = createCompressionClient(
    executorId,
    'child-process',
    child,
    task => child.send(task),
    () => child.kill()
  );
  child.on('spawn', () => {
    void appendCompressionDebugLog('压缩子进程启动', {
      executorId,
      processId: child.pid
    });
  });
  return client;
}

/**
 * 将单项处理结果写回批次，并更新进度。
 * @param {object} batch 批次
 * @param {object} entry 输入项
 * @param {object} response 压缩响应
 * @param {(batch:object)=>void} onChange 状态回调
 */
function completeEntry(batch, entry, response, onChange) {
  if (response && response.ok) {
    entry.resultPath = response.result.resultPath;
    entry.resultBytes = response.result.resultBytes;
    entry.savedPercent = response.result.savedPercent;
    batch.progress.succeeded += 1;
  } else {
    entry.error = response && response.error ? response.error : '处理失败';
    batch.progress.failed += 1;
  }
  batch.progress.completed += 1;
  batch.progress.percent = batch.progress.total
    ? Math.round(batch.progress.completed * 100 / batch.progress.total)
    : 100;
  emitChange(batch, onChange);
}

/**
 * 在共享主线程队列中串行执行兼容回退任务。
 * @param {{fallbackTail:Promise<void>}} state 共享任务状态
 * @param {object} batch 批次
 * @param {object} task 压缩任务
 * @returns {Promise<object|null>} 压缩响应
 */
function runCompressionFallback(state, batch, task) {
  const response = state.fallbackTail.then(async () => {
    if (batch.cancelled) return null;
    try {
      return { id: task.id, ok: true, result: await compressImage(task) };
    } catch (error) {
      return {
        id: task.id,
        ok: false,
        error: error && error.message ? error.message : '处理失败'
      };
    }
  });
  state.fallbackTail = response.then(() => undefined);
  return response;
}

/**
 * 持续从共享下标领取任务，并在一个压缩执行器中串行执行。
 * @param {object} batch 批次
 * @param {{nextIndex:number,entries:object[],fallbackTail:Promise<void>}} state 共享任务状态
 * @param {{id:number,mode:string,run:(task:object)=>Promise<object>,close:()=>Promise<unknown>}|null} client 压缩执行器
 * @param {(batch:object)=>void} onChange 状态回调
 * @returns {Promise<void>} 完成信号
 */
async function runCompressionLane(batch, state, client, onChange) {
  let executorAvailable = !!client;
  while (!batch.cancelled) {
    const index = state.nextIndex++;
    if (index >= state.entries.length) return;
    const entry = state.entries[index];
    const task = {
      id: makeId('task'),
      inputPath: entry.inputPath,
      filename: entry.filename,
      resultPath: resultPathFor(batch, entry)
    };
    const executorId = client ? client.id : 0;
    const executorMode = client ? client.mode : 'main-thread';
    const dispatchedAt = Date.now();
    await appendCompressionDebugLog('任务派发', {
      batchId: batch.id,
      taskId: task.id,
      executorId,
      executorMode,
      filename: entry.filename,
      inputBytes: entry.inputBytes
    });
    let response = null;

    if (executorAvailable) {
      try {
        response = await client.run(task);
      } catch (error) {
        if (batch.cancelled) return;
        executorAvailable = false;
        await client.close();
        await appendCompressionDebugLog('任务回退到主线程', {
          batchId: batch.id,
          taskId: task.id,
          executorId,
          executorMode,
          filename: entry.filename,
          error: error && error.stack ? error.stack : String(error)
        });
        console.error('[img-comp] 并行压缩执行器不可用，已回退到主线程:', error);
      }
    }

    if (!executorAvailable && !response) {
      if (batch.cancelled) return;
      response = await runCompressionFallback(state, batch, task);
      if (!response) return;
    }
    await appendCompressionDebugLog('任务完成', {
      batchId: batch.id,
      taskId: task.id,
      executorId,
      executorMode: response.executorMode || executorMode,
      threadId: response.threadId || 0,
      processId: response.processId || process.pid,
      filename: entry.filename,
      success: !!response.ok,
      elapsedMs: Date.now() - dispatchedAt,
      executorDurationMs: response.durationMs || null,
      error: response.ok ? null : response.error
    });
    completeEntry(batch, entry, response, onChange);
  }
}

/**
 * 使用受控并行执行器池处理批次中的压缩任务。
 * 优先使用工作线程，宿主禁用线程时改用独立 Node 子进程。
 * @param {object} batch 批次
 * @param {(batch:object)=>void} onChange 状态回调
 * @returns {Promise<void>} 完成信号
 */
async function executeCompressionPool(batch, onChange) {
  const executorCount = compressionExecutorCount(batch.entries);
  await appendCompressionDebugLog('执行器池配置', {
    batchId: batch.id,
    requestedExecutors: executorCount,
    maxInputBytes: batch.entries.reduce((largest, entry) => {
      return Math.max(largest, Number(entry.inputBytes) || 0);
    }, 0)
  });
  const clients = [];
  let preferredMode = 'worker-thread';
  for (let index = 0; index < executorCount; index++) {
    const executorId = index + 1;
    let client = null;
    if (preferredMode === 'worker-thread') {
      try {
        client = createCompressionWorkerClient(executorId);
      } catch (error) {
        preferredMode = 'child-process';
        await appendCompressionDebugLog('创建工作线程失败，改用子进程', {
          batchId: batch.id,
          executorId,
          error: error && error.stack ? error.stack : String(error)
        });
      }
    }
    if (!client) {
      try {
        client = createCompressionProcessClient(executorId);
      } catch (error) {
        await appendCompressionDebugLog('创建压缩子进程失败', {
          batchId: batch.id,
          executorId,
          error: error && error.stack ? error.stack : String(error)
        });
        console.error('[img-comp] 创建压缩子进程失败，将使用已有执行器或主线程:', error);
        break;
      }
    }
    clients.push(client);
  }
  await appendCompressionDebugLog('执行器池已创建', {
    batchId: batch.id,
    activeExecutors: clients.length,
    modes: clients.map(client => client.mode)
  });

  const lanes = clients.length > 0 ? clients : [null];
  const state = {
    nextIndex: 0,
    entries: batch.entries,
    fallbackTail: Promise.resolve()
  };
  ACTIVE_COMPRESSION_EXECUTORS.set(batch, clients);
  try {
    await Promise.all(lanes.map(client => runCompressionLane(batch, state, client, onChange)));
  } finally {
    ACTIVE_COMPRESSION_EXECUTORS.delete(batch);
    await Promise.allSettled(clients.map(client => client.close()));
    await appendCompressionDebugLog('执行器池结束', { batchId: batch.id });
  }
}

/**
 * 执行批次中的所有图片。
 * @param {object} batch 批次
 * @param {(batch:object)=>void} onChange 状态回调
 * @returns {Promise<object>} 完成后的批次
 */
async function executeBatch(batch, onChange) {
  if (!batch || !Array.isArray(batch.entries)) throw new Error('批次数据无效');
  const startedAt = Date.now();
  await resetCompressionDebugLog(batch);
  batch.phase = 'running';
  emitChange(batch, onChange);
  await executeCompressionPool(batch, onChange);
  if (batch.cancelled) {
    for (const entry of batch.entries) {
      if (!entry.resultPath && !entry.error) entry.error = '已取消';
    }
    batch.phase = 'cancelled';
  } else {
    batch.phase = 'complete';
  }
  await appendCompressionDebugLog('批次结束', {
    batchId: batch.id,
    phase: batch.phase,
    elapsedMs: Date.now() - startedAt,
    completed: batch.progress.completed,
    succeeded: batch.progress.succeeded,
    failed: batch.progress.failed
  });
  emitChange(batch, onChange);
  return batch;
}

/**
 * 安全触发状态回调。
 * @param {object} batch 批次
 * @param {(batch:object)=>void} callback 回调
 */
function emitChange(batch, callback) {
  if (typeof callback === 'function') callback(batch);
}

/**
 * 取消批次。
 * @param {object} batch 批次
 * @returns {object} 更新后的批次
 */
function cancelBatch(batch) {
  if (batch) {
    batch.cancelled = true;
    void appendCompressionDebugLog('收到取消请求', { batchId: batch.id });
    const clients = ACTIVE_COMPRESSION_EXECUTORS.get(batch) || [];
    for (const client of clients) void client.close();
  }
  return batch;
}

/**
 * 将结果覆盖回输入文件。
 * @param {object} batch 已完成批次
 * @returns {Promise<boolean>} 是否全部成功
 */
async function replaceInputs(batch) {
  if (!batch || batch.phase !== 'complete') return false;
  let success = true;
  for (const entry of batch.entries) {
    if (!entry.resultPath || entry.resultPath === entry.inputPath || entry.error) continue;
    try {
      await fsp.copyFile(entry.resultPath, entry.inputPath);
    } catch (error) {
      success = false;
      console.error('[img-comp] 覆盖原文件失败:', entry.inputPath, error);
    }
  }
  return success;
}

/**
 * 复制单个路径到系统剪贴板。
 * @param {string} filePath 文件路径
 * @returns {boolean} 是否成功
 */
function copyPath(filePath) {
  try { return !!globalThis.window?.ztools?.copyFile(filePath); } catch { return false; }
}

/**
 * 一次性复制多个路径，并校验系统剪贴板收到的数量。
 * @param {string[]} paths 文件路径列表
 * @returns {Promise<object>} 复制结果
 */
async function copyPaths(paths) {
  const list = [...new Set((Array.isArray(paths) ? paths : [])
    .filter(value => typeof value === 'string' && fs.existsSync(value))
    .map(value => path.resolve(value)))];
  if (list.length === 0) return { success: false, count: 0, expected: 0 };
  const host = globalThis.window?.ztools;
  try {
    if (host && typeof host.copyFile === 'function') {
      if (!host.copyFile(list)) return { success: false, count: 0, expected: list.length };
      if (process.platform === 'win32' && typeof host.getCopyedFiles === 'function') {
        for (let attempt = 0; attempt < 5; attempt++) {
          if (attempt) await new Promise(resolve => setTimeout(resolve, 30));
          const current = host.getCopyedFiles();
          const currentPaths = new Set((Array.isArray(current) ? current : [])
            .map(item => typeof item === 'string' ? item : item?.path)
            .filter(Boolean)
            .map(value => path.resolve(value).toLowerCase()));
          const count = list.filter(value => currentPaths.has(value.toLowerCase())).length;
          if (count === list.length) return { success: true, count, expected: list.length };
        }
        return { success: false, count: 0, expected: list.length };
      }
      return { success: true, count: list.length, expected: list.length };
    }
    const result = await host?.clipboard?.writeContent?.({ type: 'file', content: list }, false);
    return { success: !!result?.success, count: result?.success ? list.length : 0, expected: list.length };
  } catch (error) {
    console.error('[img-comp] 复制文件失败:', error);
    return { success: false, count: 0, expected: list.length };
  }
}

/**
 * 将批次转换为可持久化的摘要。
 * @param {object} batch 批次
 * @returns {object} 历史记录
 */
function toHistoryRecord(batch) {
  return {
    id: batch.id,
    kind: batch.kind,
    createdAt: batch.createdAt,
    count: batch.entries.length,
    rootPath: batch.rootPath || null,
    entries: batch.entries.map(entry => ({
      inputPath: entry.inputPath,
      inputBytes: entry.inputBytes,
      filename: entry.filename,
      relativeName: entry.relativeName,
      outputName: entry.outputName,
      resultPath: entry.resultPath,
      resultBytes: entry.resultBytes,
      savedPercent: entry.savedPercent,
      error: entry.error || null
    }))
  };
}

/**
 * 从历史摘要恢复可展示批次。
 * @param {object} record 历史记录
 * @returns {object} 批次
 */
function fromHistoryRecord(record) {
  const entries = Array.isArray(record?.entries)
    ? record.entries.map(restoreEntry)
    : [];
  assignOutputNames(entries);
  return {
    id: record.id,
    historyId: record.id,
    kind: record.kind || 'files',
    createdAt: record.createdAt || Date.now(),
    phase: 'complete',
    cancelled: false,
    rootPath: record.rootPath || null,
    outputRoot: null,
    entries,
    progress: {
      total: entries.length,
      completed: entries.length,
      succeeded: entries.filter(entry => !entry.error).length,
      failed: entries.filter(entry => entry.error).length,
      percent: 100
    },
    historical: true
  };
}

/**
 * 格式化文件大小。
 * @param {number} bytes 字节数
 * @returns {string} 展示文本
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

module.exports = {
  addDataUris,
  cancelBatch,
  clearHistory,
  copyPath,
  copyPaths,
  createBatch,
  executeBatch,
  formatBytes,
  fromHistoryRecord,
  readHistory,
  removeHistory,
  replaceInputs,
  toHistoryRecord,
  writeHistory
};
