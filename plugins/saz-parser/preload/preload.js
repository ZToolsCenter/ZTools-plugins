'use strict';

/**
 * preload.js —— 插件 preload 入口（ZTools 硬约束：CommonJS、不得压缩混淆、逐行可读）
 *
 * 职责只有三件，刻意不做别的：
 * 1. 建归档句柄缓存 + 造出 api 表面，挂到渲染端能拿到的位置；
 * 2. 注册 plugin.json 里声明的 MCP tools，让外部 AI 能直接取数（D18=b）；
 * 3. 把"到底哪条通路真的生效"记录成诊断对象 —— 因为宿主 API 的可用性
 *    在文档与实测之间存在缺口（见设计文档 2.5 / M0），**不能靠假设上线**。
 *
 * 解析、解码、成包算法全在 core/ 与 analysis/ 里，本文件不含业务逻辑。
 */

const path = require('node:path');

const electron = (() => {
  try { return require('electron'); } catch (e) { return null; }
})();

const { createArchiveStore } = require('./store');
const { createApi } = require('./api');
const dec = require('./core/decode');

/** 插件自己声明的 tools（唯一事实来源，避免代码与 plugin.json 漂移）。 */
const PLUGIN_MANIFEST = (() => {
  try { return require('../plugin.json'); } catch (e) { return { tools: {} }; }
})();

const diag = {
  ready: false,
  mountedAt: null,
  mountMode: null,
  contextIsolated: typeof process.contextIsolated === 'boolean' ? process.contextIsolated : null,
  hasElectron: !!electron,
  hasContextBridge: !!(electron && electron.contextBridge),
  hostApiPresent: [],
  hostApiMissing: [],
  // 宿主事件实录：M0 要说清“files 触发时 payload 到底长什么样”，
  // 唯一可信的做法是把真实回调参数原样留痕（序列化后），而不是按文档猜测。
  hostEvents: [],
  toolRegistration: { declared: Object.keys(PLUGIN_MANIFEST.tools || {}), attempted: [], succeededVia: null, errors: [] },
  // 真实调用留痕：M0 要在 ZTools 里确认“tool 到底有没有被派发到”，
  // 只看 plugin.json 的声明没有说服力，必须有“确实被调过、返了什么、多少毫秒”.
  toolCalls: [],
  // 一键解析留痕：进哪条判定（headless / mode-query / code / setting）、目标路径、何时。
  // 无界面场景下这是唯一能回答“它到底跑没跑”的证据。
  quickRuns: [],
  // 宿主「模式询问」与「无界面调用」通路的实录（两条通道都不经 window.ztools，直接走 ipcRenderer）。
  // 这是本插件能真正做到“不打开界面”的唯一依据，必须留痕可查，不能停留在推断。
  modeChannel: { available: false, reason: null, answers: [], headlessCalls: [] },
  capabilities: dec.capabilities(),
  runtime: { node: process.versions.node, electron: process.versions.electron || null, chrome: process.versions.chrome || null },
};

/* ---------------- 1. 事件总线（preload 的长任务进度 → UI） ---------------- */
const listeners = new Map();
const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => bus.off(event, fn);
  },
  off(event, fn) { const s = listeners.get(event); if (s) s.delete(fn); },
  emit(event, payload) {
    const s = listeners.get(event);
    if (s) for (const fn of s) { try { fn(payload); } catch (e) { /* 单个订阅者出错不能影响主流程 */ } }
  },
};

/* ---------------- 2. 造 API ---------------- */
const host = (typeof window !== 'undefined' && window.ztools) ? window.ztools : null;
if (host) {
  const expect = ['showOpenDialog', 'showSaveDialog', 'getPathForFile', 'setSubInput', 'dbStorageGet', 'dbStorageSet',
    'clipboard', 'copyText', 'shellOpenPath', 'showNotification', 'setExpendHeight', 'redirect', 'registerTool',
    'checkFilePaths', 'getLastCopiedContent', 'onPluginEnter', 'outPlugin'];
  for (const k of expect) (typeof host[k] === 'function' ? diag.hostApiPresent : diag.hostApiMissing).push(k);
}

const store = createArchiveStore({ max: 2 });
store.on((e) => bus.emit('archive', e));
const api = createApi({
  store,
  host,
  logger: (m) => bus.emit('log', m),
  progress: (p) => bus.emit('progress', p),
});

/*
 * 设置里只留 autoClose / beautifyLevel。
 * 早期版本在这包一层刷新 quickMode 缓存，现在 quickMode 已取消（由两条指令区分），
 * 所以下面必须是真正的赋值：不能留个调空函数的包装（它会在线上报 ReferenceError）。
 */

/* ---------------- 2.5 宿主事件接线 ---------------- */
/** 进诊断的 payload 先过一道序列化：带函数/DOM 的对象不能住在诊断里。 */
function cloneable(payload) {
  try { return JSON.parse(JSON.stringify(payload === undefined ? null : payload)); }
  catch (e) { return { unserializable: String(e.message), type: typeof payload }; }
}

/**
 * 从 onPluginEnter 的 payload 里取 .saz，**按绝对路径与文件名分开返回**。
 *
 * 为什么不能“递归拿第一个以 .saz 结尾的字符串”（上一版就这么写的）：
 * 实测 ZTools 3.2.0 渲染端源码，`files` 指令的 payload 是数组，元素为
 *   { isFile, isDirectory, name, path }
 * 对象键序里 `name` 在 `path` 之前，于是拿到的是裸文件名
 * “<时间戳>.saz” 这样的**文件名**，再被拼成宿主安装目录下的假路径去报“文件不存在”。
 * 现在按优先级取：① 明确的路径字段 ② 看上去是绝对路径的字符串 ③ 只剩文件名 → 交给剪贴板回查。
 */
const PATH_KEYS = ['path', 'fullPath', 'absolutePath', 'filePath', 'realPath', 'file'];
const NAME_KEYS = ['name', 'fileName', 'filename', 'title'];

function pushTarget(out, value) {
  const s = String(value).replace(/[\r\n\t]+/g, ' ').trim().replace(/^["“']/, '').replace(/["”']$/, '').trim();
  if (!/\.saz$/i.test(s)) return;
  /*
   * 归类只看**清洗后**的值是否绝对路径，不看它来自哪个字段：
   * 字段名靠不住（实测里 name 就是文件名，但别的形状可能把绝对路径放在任何位置），
   * 而“带引号与换行的绝对路径”必须能被判成可用路径（曾因为在清洗前判而错分到 names）。
   */
  const bucket = path.isAbsolute(s) ? out.paths : out.names;
  if (!bucket.includes(s)) bucket.push(s);
}

function collectSazTargets(payload, depth) {
  const d = depth || 0;
  const out = { paths: [], names: [] };
  if (d > 6 || payload === null || payload === undefined) return out;

  if (typeof payload === 'string') { pushTarget(out, payload); return out; }
  if (Array.isArray(payload)) {
    for (const it of payload) {
      const sub = collectSazTargets(it, d + 1);
      out.paths.push(...sub.paths); out.names.push(...sub.names);
    }
    return out;
  }
  if (typeof payload === 'object') {
    // 先拿明确的路径字段（实测结构里就是 path），再看名字字段，最后递归其余
    for (const k of PATH_KEYS) {
      const v = payload[k];
      if (typeof v === 'string') pushTarget(out, v);
      else if (v && typeof v === 'object') { const sub = collectSazTargets(v, d + 1); out.paths.push(...sub.paths); out.names.push(...sub.names); }
    }
    for (const k of NAME_KEYS) {
      const v = payload[k];
      if (typeof v === 'string') pushTarget(out, v);
    }
    for (const k of Object.keys(payload)) {
      if (PATH_KEYS.includes(k) || NAME_KEYS.includes(k)) continue;
      const sub = collectSazTargets(payload[k], d + 1);
      out.paths.push(...sub.paths); out.names.push(...sub.names);
    }
    return out;
  }
  return out;
}

/**
 * payload 的结构骨架（键名 + 类型，不是 JSON 值）。
 * JSON.stringify 会把 File 类对象抹成 {}，恰好丢掉最需要的诊断信息。
 */
function payloadShape(v, depth) {
  const d = depth || 0;
  if (d > 3) return '…';
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return v.length ? '[' + payloadShape(v[0], d + 1) + (v.length > 1 ? ' ×' + v.length : '') + ']' : '[]';
  if (typeof v === 'object') {
    const ctor = typeof v.constructor === 'function' ? v.constructor.name : 'object';
    const keys = {};
    for (const k of Object.keys(v).slice(0, 16)) keys[k] = payloadShape(v[k], d + 1);
    return (ctor === 'Object' ? '' : ctor + ' ') + '{' + Object.keys(keys).map((k) => k + ':' + keys[k]).join(', ') + '}';
  }
  return typeof v === 'string' ? 'string(' + v.length + ')' : typeof v;
}

/**
 * 取触发本次进入的 feature code。
 * 实测确证的 files payload 里只有 `{type, payload, inputState}`，**没见过 code**，
 * 所以不赌单一字段：逐个常见位置试，并保留完整骨架进诊断；
 * 拿不到 code 时回落 `lastFeatureCode`（宿主每次进入前都会用 `get-plugin-mode` 问过 featureCode，
 * 那是比猜 payload 字段可靠得多的来源）；**不再用设置项抢判定**（quickMode 已取消）。
 */
function enterFeatureCode(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const cands = [payload.code, payload.featureCode, payload.feature, payload.cmd && payload.cmd.code,
    payload.pluginInfo && payload.pluginInfo.code];
  for (const c of cands) if (typeof c === 'string' && c) return c;
  return null;
}

/**
 * 从触发参数里拿到要解析的 .saz 绝对路径（enter 与 headless 两条通路共用）。
 * 只拿到文件名时回查剪贴板 —— 实测 getLastCopiedContent 的 path 是完整的绝对路径。
 */
async function resolveQuickTarget(payload) {
  const t = collectSazTargets(payload);
  let target = t.paths[0] || null;
  if (t.paths.length > 1) bus.emit('log', '触发里有多个 .saz，取第一个：' + t.paths.join(' | '));
  if (!target && t.names.length) {
    let hit = null;
    for (const n of t.names) {
      try { hit = await api.lastCopiedFile(n); } catch (e) { hit = null; }
      if (hit && hit.path) break;
    }
    if (hit && hit.path) {
      bus.emit('log', '触发只给了文件名 ' + t.names.join(',') + '，已从剪贴板回查到绝对路径（' + hit.matched + '）');
      target = hit.path;
    }
  }
  const reason = t.names.length
    ? '触发里只有文件名，回查剪贴板也没拿到绝对路径；请在界面里「选择 .saz」或直接输入完整路径'
    : (t.paths.length ? '' : '触发参数里没有 .saz 文件');
  return { target, names: t.names, reason };
}

/**
 * F27 一键解析：不开界面、不切列表，直接把同构目录树落盘。
 * 无界面时错误也必须可见：进宿主通知 + 广播事件（窗口若还开着就能看到结果卡片）。
 * @param sazPath .saz 绝对路径
 * @param opts.headless true = 由宿主 call-plugin-method 触发（视图高度已被压成 0，不要再去关窗）
 */
async function runQuickParse(sazPath, opts) {
  const headless = !!(opts && opts.headless);
  bus.emit('quick-start', { path: sazPath, headless });
  try {
    const r = await api.quickParse(sazPath, {});
    bus.emit('quick-done', r);
    if (!headless) {
      const s = await api.settingsGet();
      if (s.autoClose && host && typeof host.outPlugin === 'function') {
        try { host.outPlugin(false); } catch (e) { log('outPlugin 失败（结果已落盘，不影响产物）：' + e.message); }
      }
    }
    return r;
  } catch (e) {
    bus.emit('quick-error', { path: sazPath, error: e.message });
    api.notify('一键解析失败', e.message);
    log('一键解析失败：' + e.message);
    return null;
  }
}

/*
 * ---------------- 2.7 宿主「模式询问」与「无界面调用」（实测确证于 app.asar 主进程源码）----------------
 *
 * 宿主的**每一条**进入路径（当前视图复用 / 缓存视图恢复 / 新建视图）都会先问插件要什么模式：
 *   主进程 → webContents.send('get-plugin-mode', { featureCode, callId })
 *   插件  → ipcRenderer.send('plugin-mode-result-' + callId, mode)   **1 秒不回就超时当普通界面**
 *   mode = 'none' → 无界面：setExpendHeight(0) 且**不派发 onPluginEnter**，改为
 *                    send('call-plugin-method', { featureCode, action, callId })，
 *                    插件必须回 'plugin-method-result-'+callId = {success, result|error}（**30 秒超时**）
 *   mode = 'list' → 结果列表模式；其它值 / 超时 → 正常展开界面
 *
 * 两点额外收益：
 *   ① 这个询问**自带 featureCode**，比猜 enter payload 里的 code 可靠得多（源码里 enter payload 确实没有 code）；
 *   ② 配合 plugin.json 的 `features[].mainHide = true`（宿主 isFeatureMainHide → 高度压 0，
 *      且启动来源为 global-shortcut / super-panel 时连主窗口都不弹出），
 *      「缓存视图恢复」那条路径也不会把界面撑开。
 */
const ipc = (electron && electron.ipcRenderer) ? electron.ipcRenderer : null;
/** 最近一次宿主询问的 featureCode（判定一键的第一依据，来自宿主而非我们猜）。 */
let lastFeatureCode = null;
/**
 * 只在这个 feature 上返 'none'：
 * 界面入口 saz-view（files / regex / 关键词）永远返 'main'，
 * 这样“粘贴后选哪条”完全由用户在宿主列表里点的那条决定，不需要任何开关参与。
 */
const HEADLESS_FEATURES = new Set(['saz-quick']);

function modeForFeature(featureCode) {
  return featureCode && HEADLESS_FEATURES.has(featureCode) ? 'none' : 'main';
}

function pushModeAnswer(rec) {
  diag.modeChannel.answers.push(rec);
  if (diag.modeChannel.answers.length > 20) diag.modeChannel.answers.shift();
}
function pushHeadlessCall(rec) {
  diag.modeChannel.headlessCalls.push(rec);
  if (diag.modeChannel.headlessCalls.length > 20) diag.modeChannel.headlessCalls.shift();
}
function pushQuickRun(rec) {
  diag.quickRuns.push(rec);
  if (diag.quickRuns.length > 20) diag.quickRuns.shift();
}

function wireModeAndHeadless() {
  if (!ipc) {
    diag.modeChannel.reason = '拿不到 electron.ipcRenderer（纯 Node 测试环境，或宿主未注入）——一键解析将退化到依赖 onPluginEnter + mainHide';
    return;
  }
  diag.modeChannel.available = true;

  try {
    ipc.on('get-plugin-mode', (event, arg) => {
      const callId = arg && arg.callId;
      const featureCode = (arg && typeof arg.featureCode === 'string' && arg.featureCode) || null;
      lastFeatureCode = featureCode;
      const mode = modeForFeature(featureCode);
      pushModeAnswer({ at: new Date().toISOString(), featureCode, mode });
      if (callId) {
        try { ipc.send('plugin-mode-result-' + callId, mode); } catch (e) { log('应答 plugin-mode-result 失败：' + e.message); }
      }
    });
  } catch (e) { diag.modeChannel.reason = 'get-plugin-mode 监听注册失败：' + e.message; }

  try {
    ipc.on('call-plugin-method', async (event, arg) => {
      const callId = arg && arg.callId;
      const featureCode = (arg && arg.featureCode) || null;
      const reply = (payload) => {
        if (!callId) return;
        try { ipc.send('plugin-method-result-' + callId, payload); } catch (e) { log('应答 plugin-method-result 失败：' + e.message); }
      };
      pushHeadlessCall({ at: new Date().toISOString(), featureCode });
      try {
        const { target, reason } = await resolveQuickTarget(arg && arg.action);
        if (!target) {
          const err = reason || '没拿到 .saz 的绝对路径';
          api.notify('一键解析没拿到文件', err);
          reply({ success: false, error: err });
          return;
        }
        pushQuickRun({ at: new Date().toISOString(), path: target, via: 'headless', code: featureCode });
        const r = await runQuickParse(target, { headless: true });
        if (!r) { reply({ success: false, error: '解析失败，具体原因见宿主通知与插件诊断页' }); return; }
        reply({ success: true, result: { outDir: r.outDir, counts: r.counts, elapsedMs: r.elapsedMs } });
      } catch (e) {
        // 必须回包：不回的话宿主会等到 30 秒再抛“Plugin method call timeout”
        reply({ success: false, error: e.message });
      }
    });
  } catch (e) {
    const base = diag.modeChannel.reason ? diag.modeChannel.reason + '；' : '';
    diag.modeChannel.reason = base + 'call-plugin-method 监听注册失败：' + e.message;
  }
}

function wireHostEvents() {
  if (!host) return;
  const record = (kind, payload) => {
    bus.emit(kind, payload);
    diag.hostEvents.push({ kind, at: new Date().toISOString(), shape: payloadShape(payload), payload: cloneable(payload) });
    if (diag.hostEvents.length > 20) diag.hostEvents.shift();
  };
  if (typeof host.onPluginEnter === 'function') {
    try {
      host.onPluginEnter(async (payload) => {
        record('enter', payload);
        const { target, names, reason } = await resolveQuickTarget(payload);
        if (!target) {
          bus.emit('enter-needs-path', { names, reason: reason || '触发参数里没有 .saz 文件' });
          return;
        }
        /*
         * 一键解析的判定（优先级从高到低，任一成立即走）：
         * ① lastFeatureCode —— 宿主问 mode 时亲给的 featureCode（实测最可靠）；
         * ② payload 里能翻出 code（兼容宿主将来补上这个字段）。
         * 不再拿设置项抢判定：选哪条由用户在宿主列表里点的那条决定（saz-quick / saz-view）。
         */
        const fromPayload = enterFeatureCode(payload);
        const code = fromPayload || lastFeatureCode;
        if (code === 'saz-quick') {
          pushQuickRun({
            at: new Date().toISOString(),
            path: target,
            via: fromPayload ? 'code' : 'mode-query',
            code,
          });
          await runQuickParse(target);
          return;
        }
        bus.emit('open-path', target);
      });
    } catch (e) { diag.toolRegistration.errors.push('onPluginEnter 注册失败：' + e.message); }
  }
  if (typeof host.setSubInput === 'function') {
    try { host.setSubInput((text) => record('subinput', text), '过滤：域名 / 方法 / 状态 / URL / sid', false); }
    catch (e) { diag.toolRegistration.errors.push('setSubInput 注册失败：' + e.message); }
  }
}

/* ---------------- 3. 挂到渲染端 ---------------- */
function mount() {
  if (typeof window === 'undefined') { diag.mountMode = 'no-window'; return; }
  // ZTools 文档说"给 window 挂自定义属性，前端直接调用"，前提是未开上下文隔离。
  // 但隔离与否取决于宿主配置，这里两条路都走：隔离时用 contextBridge，否则直挂。
  if (diag.contextIsolated === true && diag.hasContextBridge) {
    try {
      electron.contextBridge.exposeInMainWorld('sazApi', api);
      electron.contextBridge.exposeInMainWorld('sazEvents', bus);
      electron.contextBridge.exposeInMainWorld('sazDiagnostics', diag);
      diag.mountMode = 'contextBridge';
      return;
    } catch (e) {
      diag.toolRegistration.errors.push('contextBridge 失败，回落直挂 window：' + e.message);
    }
  }
  try {
    window.sazApi = api;
    window.sazEvents = bus;
    window.sazDiagnostics = diag;
    diag.mountMode = 'window-direct';
  } catch (e) {
    diag.mountMode = 'failed';
    diag.toolRegistration.errors.push('window 挂载失败：' + e.message);
  }
}

/* ---------------- 4. MCP tools ---------------- */
const log = (m) => bus.emit('log', m);

/** tool 名 → 实现。返回一律是可 JSON 序列化的纯数据。 */
function buildToolHandlers() {
  return {
    saz_parse(input) {
      const p = input && input.path;
      if (!p) throw new Error('saz_parse 需要 path（.saz 的绝对路径）');
      const r = api.open(p, { headerReadBytes: input.headerReadBytes });
      // 实测：3756 会话 × 40 字段全量返回是 2MB+ JSON，一次就把分析方的上下文吃干，
      // 与唯一第一目的（把结果交给 AI 分析）直接相反。因此工具侧默认只给概览 + 前 N 行；
      // UI 走 api.open() 拿全量。两个入口的差别在这里写明，而不是让人靠试验去发现。
      const limit = Math.max(0, Math.min(Number(input.limit >= 0 ? input.limit : 200) || 200, r.sessions.length));
      // 历史写入失败绝不能拖垮解析：工具主路的结果比“记得这个文件”重要
      Promise.resolve(api.historyPut({ path: p, name: r.archive.name, sessions: r.summary.sessionCount, mode: 'tool' }))
        .catch((e) => log('写入解析历史失败（不影响结果）：' + e.message));
      return {
        archive: r.archive,
        summary: r.summary,
        sessionsTotal: r.sessions.length,
        sessionsReturned: limit,
        sessions: r.sessions.slice(0, limit),
        next: '本清单只是概览。按条件取数用 saz_query（domains/methods/status/category/urlRegex/bodyContains 等），'
          + '取正文用 saz_body(sid)，取 WebSocket 帧用 saz_ws(sid)，取事件流/多帧正文用 saz_stream(sid)。',
      };
    },
    saz_query(input) {
      const o = input || {};
      return api.list(o.filter || {}, { limit: o.limit || 200, offset: o.offset || 0, sort: o.sort, order: o.order });
    },
    saz_body(input) {
      const o = input || {};
      if (o.sid === undefined || o.sid === null) throw new Error('saz_body 需要 sid');
      const d = api.detail(o.sid, { limitBytes: o.limitBytes || 262144, withFields: o.withFields !== false });
      const part = o.part || 'all';
      if (part === 'request') return { sid: d.sid, session: d.session, request: d.request };
      if (part === 'response') return { sid: d.sid, session: d.session, response: d.response, decode: d.response && d.response.decode };
      return d;
    },
    saz_ws(input) {
      const o = input || {};
      if (o.sid === undefined || o.sid === null) throw new Error('saz_ws 需要 sid');
      return api.websocketFrames(o.sid, { wsFrom: o.from || 0, wsCount: o.count || 200 });
    },
    /** F28：事件流 / 顶层多帧 JSON 的逐条取数（与 saz_ws 同构的分页口）。 */
    saz_stream(input) {
      const o = input || {};
      if (o.sid === undefined || o.sid === null) throw new Error('saz_stream 需要 sid');
      return api.streamEvents(o.sid, { from: o.from || 0, count: o.count === undefined ? 200 : o.count, limitBytes: o.limitBytes || 0 });
    },
  };
}

const handlers = buildToolHandlers();

/** 统一入口：外部（主进程 executeJavaScript）只调这一个函数。 */
function invokeTool(name, input) {
  const fn = handlers[name];
  if (!fn) {
    return { ok: false, error: '未注册的工具名：' + name, declared: diag.toolRegistration.declared };
  }
  const t0 = Date.now();
  let res;
  try {
    const data = fn(input || {});
    res = { ok: true, tool: name, elapsedMs: Date.now() - t0, data };
  } catch (e) {
    // 工具错误必须以数据返回，不能抛：抛出后主进程拿不到任何信息，AI 侧只看到超时
    res = { ok: false, tool: name, elapsedMs: Date.now() - t0, error: e.message, stack: (e.stack || '').split('\n').slice(0, 4) };
  }
  diag.toolCalls.push({ tool: name, ok: res.ok, ms: res.elapsedMs, error: res.error || null, at: new Date().toISOString() });
  if (diag.toolCalls.length > 50) diag.toolCalls.shift();
  return res;
}

/**
 * 注册通路尝试（宿主签名未在文档中写死，逐一试并记录结果）。
 * 兜底最关键的一步：主进程实际是 executeJavaScript("window.ztools.__invokeRegisteredTool(name,input)")，
 * 因此只要该函数存在就能派发 —— 即使没有 registerTool API。
 */
function registerTools() {
  if (typeof window === 'undefined' || !window.ztools) {
    diag.toolRegistration.attempted.push('window.ztools 不存在');
    return false;
  }
  const zt = window.ztools;

  if (typeof zt.__invokeRegisteredTool !== 'function') {
    try {
      zt.__invokeRegisteredTool = invokeTool;
      diag.toolRegistration.attempted.push('__invokeRegisteredTool=（自定义）');
      diag.toolRegistration.succeededVia = '__invokeRegisteredTool';
    } catch (e) {
      diag.toolRegistration.errors.push('无法定义 __invokeRegisteredTool：' + e.message);
    }
  } else {
    // 宿主已提供：包一层，确保我们的 handler 被派发到
    const inner = zt.__invokeRegisteredTool.bind(zt);
    zt.__invokeRegisteredTool = (name, input) => (handlers[name] ? invokeTool(name, input) : inner(name, input));
    diag.toolRegistration.attempted.push('__invokeRegisteredTool=（包装宿主实现）');
    diag.toolRegistration.succeededVia = '__invokeRegisteredTool(wrapped)';
  }

  for (const cand of ['registerTool', 'registerTools', 'setTools', 'addTool']) {
    if (typeof zt[cand] !== 'function') continue;
    try {
      if (cand === 'registerTool') {
        for (const [name, fn] of Object.entries(handlers)) zt[cand](name, (input) => invokeTool(name, input));
      } else {
        const map = {};
        for (const name of Object.keys(handlers)) map[name] = (input) => invokeTool(name, input);
        zt[cand](PLUGIN_MANIFEST.tools && Object.keys(PLUGIN_MANIFEST.tools).length ? map : map);
      }
      diag.toolRegistration.attempted.push(cand + '=成功');
      diag.toolRegistration.succeededVia = cand;
      return true;
    } catch (e) {
      diag.toolRegistration.attempted.push(cand + '=失败');
      diag.toolRegistration.errors.push(cand + '：' + e.message);
    }
  }
  return !!diag.toolRegistration.succeededVia;
}

/* ---------------- 5. 启动 ---------------- */
mount();
registerTools();
wireHostEvents();
wireModeAndHeadless();
diag.ready = true;
diag.mountedAt = new Date().toISOString();
if (typeof window !== 'undefined') {
  window.__SAZ_PRELOAD_READY__ = true;
  // UI 侧若已先加载并留下等待钩子，立刻补发
  if (typeof window.__sazPreloadWaiter__ === 'function') { try { window.__sazPreloadWaiter__(diag); } catch (e) { void e; } }
}
bus.emit('ready', diag);

module.exports = {
  api, store, diag, bus, invokeTool, handlers,
  collectSazTargets, payloadShape, enterFeatureCode, resolveQuickTarget, runQuickParse,
  modeForFeature, wireModeAndHeadless,
};
