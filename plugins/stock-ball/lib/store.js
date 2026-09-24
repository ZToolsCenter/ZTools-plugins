'use strict';
/*
 * 持久化：优先 ZTools/uTools 的 dbStorage（跨窗口共享），没有就退回本地 JSON 文件。
 */
const K = {
  watchlist: 'sb.watchlist',
  watchlistGroups: 'sb.watchlistGroups',
  settings: 'sb.settings',
  ballPos: 'sb.ballPos',
  ballHb: 'sb.heartbeat',
  cmd: 'sb.cmd',
  transactions: 'sb.transactions',
  alerts: 'sb.alerts',
  latestQuotes: 'sb.latestQuotes',
  latestIndexes: 'sb.latestIndexes',
  quoteStamp: 'sb.quoteStamp',
  alertCooldowns: 'sb.alertCooldowns'
};

const DEFAULT_GROUPS = ['默认', '核心持仓', '观察池'];

const DEFAULT_WATCHLIST = [
  { code: '600961', secid: '1.600961', name: '株冶集团', group: '核心持仓' },
  { code: '300547', secid: '0.300547', name: '川环科技', group: '默认' },
  { code: '516010', secid: '1.516010', name: '游戏ETF', group: '观察池' }
];

const DEFAULT_SETTINGS = {
  refreshSec: 5,       // 行情刷新间隔（秒）
  offSessionFetchOnce: true, // 非交易时段每类行情只请求一次，之后吃缓存，直到下一交易时段（收盘后不空转请求）
  rotateSec: 4,        // 球内轮播间隔（秒）
  ballSize: 72,        // 球直径（默认升级为 72px，更清晰饱满且文字不溢出）
  ballOpacity: 0.95,
  ballMode: 'profit',  // profit (持仓总盈亏) | profitRate (持仓盈亏率) | todayProfit (今日盈亏) | both | pct | price
  defaultView: 'positions', // positions (持仓) | watchlist (自选)
  showName: true,
  panelOnTop: true,
  snapEdge: true,
  proxy: 'auto',       // auto | direct | http://127.0.0.1:7891
  panelW: 424,
  panelH: 596,

  // 交易费率配置（对齐 stock-desktop 系统设置）
  freeFive: true,                // 是否免五（免除单笔交易佣金最低 5 元的限制）
  stockCommissionRate: 0.854,    // 沪深股票佣金费率（万分之，如 0.854 表示万0.854）
  etfCommissionRate: 0.6,        // ETF佣金费率（万分之，如 0.6 表示万0.6）
  shenzhenTransferFee: 0,        // 过户费（深股）（万分之，如 0）
  shanghaiTransferFee: 0.1,      // 过户费（沪股）（万分之，如 0.1）
  stampTaxRate: 5,               // 印花税费率（万分之，如 5 表示万5，仅卖出收取）
  posColumns: ['qty', 'priceCost', 'todayPl', 'pl'] // 持仓列表自定义展示列
};

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function getLocalDateStr(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    return String(ts).slice(0, 10);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function createStore(injectedDb, options) {
  const opts = options || {};
  let dataFilePath = '';
  let fileStore = null;

  if (!opts.isolated) {
    try {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      dataFilePath = opts.dataFilePath || path.join(os.homedir(), '.ztools-stock-ball.json');
      /*
       * 性能：本地 JSON 文件只作为 dbStorage 的兜底 / 镜像，不做高频读写。
       * 1) 解析结果常驻内存，用 mtime+size 判断文件是否被别的窗口改过（避免每次 getItem 都整文件 parse）；
       * 2) 同一个 tick 内的多次 setItem 合并成一次 writeFileSync（避免启动同步 / 批量写入时反复整文件落盘）；
       * 3) 高频易变的缓存类键（行情、心跳、命令）完全不落文件，只留在 dbStorage 里。
       */
      let cacheObj = null;
      let cacheMtime = -1;
      let cacheSize = -1;
      let dirty = false;
      let writeTimer = null;

      const statFile = () => {
        try {
          const st = fs.statSync(dataFilePath);
          return { m: st.mtimeMs, s: st.size };
        } catch (e) { return { m: -1, s: -1 }; }
      };
      const flushNow = () => {
        if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
        if (!dirty || !cacheObj) return;
        dirty = false;
        try {
          fs.writeFileSync(dataFilePath, JSON.stringify(cacheObj, null, 2), 'utf8');
          const st = statFile();
          cacheMtime = st.m;
          cacheSize = st.s;
        } catch (e) { /* ignore */ }
      };
      const readAll = (skipFlush) => {
        // 读取路径（getItem / 同步）自己的未落盘改动先写出去，保证随后读到的是最新内容；
        // 写入路径（setItem）跳过 flush，直接复用内存对象，同一个 tick 的多次写入只落盘一次。
        if (dirty && !skipFlush) flushNow();
        const st = statFile();
        if (cacheObj && st.m === cacheMtime && st.s === cacheSize) return cacheObj;
        let obj = {};
        try { obj = JSON.parse(fs.readFileSync(dataFilePath, 'utf8')) || {}; } catch (e) { obj = {}; }
        cacheObj = obj;
        cacheMtime = st.m;
        cacheSize = st.s;
        return obj;
      };
      const writeAll = (obj) => {
        cacheObj = obj;
        dirty = true;
        if (writeTimer) return;
        writeTimer = setTimeout(flushNow, 0);
      };
      fileStore = {
        file: dataFilePath,
        readAll,
        flushNow,
        getItem: (k) => { const all = readAll(); return all[k] === undefined ? null : all[k]; },
        setItem: (k, v) => { const all = readAll(true); all[k] = v; writeAll(all); },
        removeItem: (k) => { const all = readAll(true); delete all[k]; writeAll(all); }
      };
    } catch (e) { /* ignore */ }
  }

  let db = injectedDb;
  if (!db) {
    db = pickDb();
  }
  const mem = Object.create(null);

  function pickDb() {
    let z = null;
    try {
      if (typeof ztools !== 'undefined' && ztools) z = ztools;
      else if (typeof utools !== 'undefined' && utools) z = utools;
      else if (typeof window !== 'undefined' && (window.ztools || window.utools)) z = window.ztools || window.utools;
    } catch (e) { z = null; }
    if (z && z.dbStorage && typeof z.dbStorage.getItem === 'function') {
      return {
        getItem: (k) => z.dbStorage.getItem(k),
        setItem: (k, v) => z.dbStorage.setItem(k, v),
        removeItem: (k) => { try { z.dbStorage.removeItem(k); } catch (e) { /* ignore */ } }
      };
    }
    if (fileStore) return fileStore;
    return {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = v; },
      removeItem: (k) => { delete mem[k]; }
    };
  }

  function syncStorage(forceFromFile) {
    if (!fileStore || db === fileStore) return;
    try {
      // 1. 交易流水同步：如果强制或者本地文件中有记录且数量更多，同步到 dbStorage；反之同步到本地文件
      const fileTxs = fileStore.getItem(K.transactions);
      const dbTxs = db.getItem(K.transactions);
      const fTxsLen = Array.isArray(fileTxs) ? fileTxs.length : 0;
      const dbTxsLen = Array.isArray(dbTxs) ? dbTxs.length : 0;
      if (forceFromFile || fTxsLen > dbTxsLen || (dbTxsLen === 0 && fTxsLen > 0)) {
        if (Array.isArray(fileTxs) && fileTxs.length > 0) {
          db.setItem(K.transactions, fileTxs);
        }
      } else if (dbTxsLen > fTxsLen) {
        fileStore.setItem(K.transactions, dbTxs);
      }

      // 2. 自选股同步
      const fileWl = fileStore.getItem(K.watchlist);
      const dbWl = db.getItem(K.watchlist);
      const fWlLen = Array.isArray(fileWl) ? fileWl.length : 0;
      const dbWlLen = Array.isArray(dbWl) ? dbWl.length : 0;
      if (forceFromFile || fWlLen > dbWlLen || (dbWlLen === 0 && fWlLen > 0)) {
        if (Array.isArray(fileWl) && fileWl.length > 0) {
          db.setItem(K.watchlist, fileWl);
        }
      } else if (dbWlLen > fWlLen) {
        fileStore.setItem(K.watchlist, dbWl);
      }

      // 3. 其余项互相补充（行情缓存不参与文件同步：它只存在于 dbStorage，写文件纯属浪费）
      const keys = [K.watchlistGroups, K.settings, K.ballPos];
      keys.forEach((k) => {
        const dbVal = db.getItem(k);
        const fVal = fileStore.getItem(k);
        if (forceFromFile && fVal !== null && fVal !== undefined) {
          db.setItem(k, fVal);
        } else if (dbVal !== null && dbVal !== undefined) {
          fileStore.setItem(k, dbVal);
        } else if (fVal !== null && fVal !== undefined) {
          db.setItem(k, fVal);
        }
      });
    } catch (e) { /* ignore */ }
  }
  syncStorage();
  setTimeout(syncStorage, 200);

  function importFromTransactionsJson(customPath) {
    try {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const targetPath = customPath || path.join(os.homedir(), 'Downloads', 'stock_transactions.json');
      if (!fs.existsSync(targetPath)) {
        return { ok: false, error: '文件不存在: ' + targetPath };
      }
      const rawList = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      if (!Array.isArray(rawList) || !rawList.length) {
        return { ok: false, error: '文件中无有效交易记录' };
      }
      const stockNameMap = {};
      const formatted = rawList.map((t) => {
        const code = String(t.stock_code || '').replace(/[^\d]/g, '').slice(0, 6);
        const name = String(t.stock_name || code).trim();
        stockNameMap[code] = name;
        const isBuy = Number(t.type) === 1;
        const price = Number(t.price);
        const qty = Number(t.quantity);
        const amt = price * qty;
        const totalPrice = Number(t.total_price != null ? t.total_price : amt);
        return {
          id: t.id || (Date.now() + Math.floor(Math.random() * 1000)),
          created_at: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
          stock_code: code,
          stock_name: name,
          price: price,
          quantity: qty,
          type: isBuy ? 1 : 2,
          amount: Math.round(amt * 100) / 100,
          total_price: Math.round(totalPrice * 100) / 100,
          commission: Number(t.commission || 0),
          transfer_fee: Number(t.transfer_fee || 0),
          stamp_tax: Number(t.stamp_tax || 0),
          remark: t.remark || null
        };
      });
      formatted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      set(K.transactions, formatted);

      // 同步自选股
      const curWl = getWatchlist();
      const existingCodes = new Set(curWl.map((x) => x.code));
      let addedWlCount = 0;
      for (const [code, name] of Object.entries(stockNameMap)) {
        if (!existingCodes.has(code)) {
          const secid = (/^[659]/.test(code) ? '1.' : '0.') + code;
          curWl.push({ code, secid, name, group: '默认' });
          existingCodes.add(code);
          addedWlCount++;
        }
      }
      if (addedWlCount > 0) setWatchlist(curWl);

      return {
        ok: true,
        count: formatted.length,
        stocksCount: Object.keys(stockNameMap).length,
        path: targetPath
      };
    } catch (err) {
      return { ok: false, error: err && err.message };
    }
  }

  function get(key, dflt) {
    let v = null;
    try { v = db.getItem(key); } catch (e) { v = null; }
    if (v === undefined || v === null) return dflt;
    return v;
  }

  // 这些键变化频繁且只是进程间缓存 / 一次性信号，镜像到 JSON 文件没有意义（每次都是整文件读+写）
  const NO_FILE_MIRROR = { [K.ballHb]: 1, [K.cmd]: 1, [K.latestQuotes]: 1, [K.latestIndexes]: 1, [K.quoteStamp]: 1, [K.alertCooldowns]: 1 };

  function set(key, val) {
    try { db.setItem(key, val); } catch (e) { /* ignore */ }
    if (fileStore && db !== fileStore && !NO_FILE_MIRROR[key]) {
      try { fileStore.setItem(key, val); } catch (e) { /* ignore */ }
    }
    return val;
  }

  function getWatchlist() {
    const raw = get(K.watchlist, null);
    if (raw === null || raw === undefined) {
      set(K.watchlist, DEFAULT_WATCHLIST.slice());
      return DEFAULT_WATCHLIST.slice();
    }
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x) => x && (x.code || x.secid))
      .map((x) => {
        const code = String(x.code || x.secid).replace(/[^\d]/g, '').slice(0, 6);
        const secid = x.secid && /^[01]\./.test(String(x.secid)) ? String(x.secid) : (/^[659]/.test(code) ? '1.' : '0.') + code;
        return { code, secid, name: x.name || code, group: String(x.group || '默认').trim() || '默认' };
      });
  }

  function setWatchlist(list) {
    const cleaned = (list || [])
      .filter((x) => x && (x.code || x.secid))
      .map((x) => {
        const code = String(x.code || x.secid).replace(/[^\d]/g, '').slice(0, 6);
        const secid = x.secid && /^[01]\./.test(String(x.secid)) ? String(x.secid) : (/^[659]/.test(code) ? '1.' : '0.') + code;
        return { code, secid, name: x.name || code, group: String(x.group || '默认').trim() || '默认' };
      });
    return set(K.watchlist, cleaned);
  }

  function getWatchlistGroups() {
    const raw = get(K.watchlistGroups, null);
    if (!Array.isArray(raw) || !raw.length) {
      const wl = getWatchlist();
      const s = new Set(DEFAULT_GROUPS);
      wl.forEach((x) => { if (x.group) s.add(x.group); });
      const res = Array.from(s).filter(Boolean);
      return res.length ? res : ['默认'];
    }
    const res = Array.from(new Set(raw.map((x) => String(x || '').trim()).filter(Boolean)));
    if (!res.includes('默认')) res.unshift('默认');
    return res;
  }

  function setWatchlistGroups(groups) {
    const cleaned = Array.from(new Set((groups || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (!cleaned.includes('默认')) cleaned.unshift('默认');
    return set(K.watchlistGroups, cleaned);
  }

  function addWatchlistGroup(name) {
    const g = String(name || '').trim();
    if (!g) return getWatchlistGroups();
    const groups = getWatchlistGroups();
    if (!groups.includes(g)) {
      groups.push(g);
      setWatchlistGroups(groups);
    }
    return groups;
  }

  function removeWatchlistGroup(name) {
    const g = String(name || '').trim();
    if (!g || g === '默认') return getWatchlistGroups();
    const groups = getWatchlistGroups().filter((x) => x !== g);
    setWatchlistGroups(groups);
    const wl = getWatchlist();
    let changed = false;
    wl.forEach((it) => {
      if (it.group === g) {
        it.group = '默认';
        changed = true;
      }
    });
    if (changed) setWatchlist(wl);
    return groups;
  }

  function renameWatchlistGroup(oldName, newName) {
    const o = String(oldName || '').trim();
    const n = String(newName || '').trim();
    if (!o || !n || o === n) return getWatchlistGroups();
    const groups = getWatchlistGroups().map((g) => (g === o ? n : g));
    setWatchlistGroups(groups);
    const wl = getWatchlist();
    let changed = false;
    wl.forEach((it) => {
      if (it.group === o) {
        it.group = n;
        changed = true;
      }
    });
    if (changed) setWatchlist(wl);
    return groups;
  }

  function getSettings() {
    const raw = get(K.settings, null) || {};
    const s = Object.assign({}, DEFAULT_SETTINGS, raw);
    s.refreshSec = clampInt(s.refreshSec, 2, 120, DEFAULT_SETTINGS.refreshSec);
    s.rotateSec = clampInt(s.rotateSec, 2, 120, DEFAULT_SETTINGS.rotateSec);
    if (!raw.ballSize || raw.ballSize <= 56) {
      s.ballSize = DEFAULT_SETTINGS.ballSize;
    } else {
      s.ballSize = clampInt(s.ballSize, 56, 110, DEFAULT_SETTINGS.ballSize);
    }
    const op = Number(s.ballOpacity);
    s.ballOpacity = isFinite(op) ? Math.min(1, Math.max(0.2, op)) : DEFAULT_SETTINGS.ballOpacity;
    if (['profit', 'profitRate', 'todayProfit', 'both', 'pct', 'price'].indexOf(s.ballMode) < 0) s.ballMode = DEFAULT_SETTINGS.ballMode;
    if (['positions', 'watchlist'].indexOf(s.defaultView) < 0) s.defaultView = DEFAULT_SETTINGS.defaultView;
    s.panelOnTop = !!s.panelOnTop;
    s.snapEdge = !!s.snapEdge;
    s.showName = !!s.showName;
    if (typeof s.proxy !== 'string' || !s.proxy) s.proxy = DEFAULT_SETTINGS.proxy;

    // 费率字段规范化（支持 camelCase 和 snake_case 访问）
    s.freeFive = s.freeFive !== undefined ? !!s.freeFive : (s.free_five !== undefined ? !!s.free_five : DEFAULT_SETTINGS.freeFive);
    s.free_five = s.freeFive;
    s.stockCommissionRate = isFinite(Number(s.stockCommissionRate)) ? Number(s.stockCommissionRate) : (isFinite(Number(s.stock_commission_rate)) ? Number(s.stock_commission_rate) : DEFAULT_SETTINGS.stockCommissionRate);
    s.stock_commission_rate = s.stockCommissionRate;
    s.etfCommissionRate = isFinite(Number(s.etfCommissionRate)) ? Number(s.etfCommissionRate) : (isFinite(Number(s.etf_commission_rate)) ? Number(s.etf_commission_rate) : DEFAULT_SETTINGS.etfCommissionRate);
    s.etf_commission_rate = s.etfCommissionRate;
    s.shenzhenTransferFee = isFinite(Number(s.shenzhenTransferFee)) ? Number(s.shenzhenTransferFee) : (isFinite(Number(s.shenzhen_transfer_fee)) ? Number(s.shenzhen_transfer_fee) : DEFAULT_SETTINGS.shenzhenTransferFee);
    s.shenzhen_transfer_fee = s.shenzhenTransferFee;
    s.shanghaiTransferFee = isFinite(Number(s.shanghaiTransferFee)) ? Number(s.shanghaiTransferFee) : (isFinite(Number(s.shanghai_transfer_fee)) ? Number(s.shanghai_transfer_fee) : DEFAULT_SETTINGS.shanghaiTransferFee);
    s.shanghai_transfer_fee = s.shanghaiTransferFee;
    s.stampTaxRate = isFinite(Number(s.stampTaxRate)) ? Number(s.stampTaxRate) : (isFinite(Number(s.stamp_tax_rate)) ? Number(s.stamp_tax_rate) : DEFAULT_SETTINGS.stampTaxRate);
    s.stamp_tax_rate = s.stampTaxRate;
    s.posColumns = Array.isArray(s.posColumns) ? s.posColumns : DEFAULT_SETTINGS.posColumns.slice();
    return s;
  }

  function patchSettings(patch) {
    return set(K.settings, Object.assign({}, getSettings(), patch || {}));
  }

  function getBallPos() {
    const p = get(K.ballPos, null);
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return { x: Math.round(p.x), y: Math.round(p.y) };
    return null;
  }

  function setBallPos(pos) {
    if (!pos) return null;
    return set(K.ballPos, { x: Math.round(pos.x), y: Math.round(pos.y) });
  }

  function setHeartbeat(hb) {
    return set(K.ballHb, Object.assign({}, hb, { t: Date.now() }));
  }

  function getHeartbeat() {
    const hb = get(K.ballHb, null);
    return hb && typeof hb.t === 'number' ? hb : null;
  }

  /** 跨窗口的轻量指令（面板要求隐藏球等），用自增 seq 去重 */
  function postCmd(cmd) {
    return set(K.cmd, { t: cmd, seq: Date.now() + Math.random(), at: new Date().toISOString() });
  }

  function readCmd(afterSeq) {
    const c = get(K.cmd, null);
    if (!c || typeof c.seq !== 'number') return null;
    if (afterSeq && c.seq <= afterSeq) return null;
    return c;
  }

  // ===== 持仓与交易记录 (供后台网页端) =====
  function getTransactions(code) {
    let all = get(K.transactions, null);
    if ((!all || !all.length) && fileStore) {
      const fTxs = fileStore.getItem(K.transactions);
      if (Array.isArray(fTxs) && fTxs.length > 0) {
        db.setItem(K.transactions, fTxs);
        all = fTxs;
      }
    }
    all = all || [];
    if (!code) return all;
    return all.filter((t) => t.stock_code === String(code));
  }

  // ===== 交易费率核算（对标 stock-desktop 计算标准） =====
  function calculateFees(tx, customSettings) {
    const s = Object.assign({}, getSettings(), customSettings || {});
    const price = Number(tx.price) || 0;
    const qty = Number(tx.quantity) || 0;
    const amount = price * qty;
    const type = (Number(tx.type) === 1 || String(tx.type) === 'buy') ? 1 : 2; // 1: 买入, 2: 卖出

    const pureCode = String(tx.stock_code || '').toLowerCase().replace(/^(sh|sz)/, '').replace(/[^\d]/g, '');
    const isETF = pureCode.startsWith('51') || pureCode.startsWith('15');
    const isShanghai = pureCode.startsWith('6') || pureCode.startsWith('51') || pureCode.startsWith('688');

    // 佣金（万分之）
    const commRate = isETF ? Number(s.etfCommissionRate) : Number(s.stockCommissionRate);
    let commission = amount * (commRate / 10000.0);
    if (!s.freeFive && commission < 5 && amount > 0) {
      commission = 5;
    }

    // 过户费（万分之）
    let transferFee = 0;
    if (isShanghai) {
      transferFee = amount * (Number(s.shanghaiTransferFee) / 10000.0);
    } else {
      transferFee = amount * (Number(s.shenzhenTransferFee) / 10000.0);
    }

    // 印花税（万分之，仅卖出收取，ETF免收）
    let stampTax = 0;
    if (type !== 1 && !isETF) {
      stampTax = amount * (Number(s.stampTaxRate) / 10000.0);
    }

    const totalFees = commission + transferFee + stampTax;
    // 买入：实付总成本 = 成交金额 + 佣金 + 过户费
    // 卖出：实得净金额 = 成交金额 - 佣金 - 过户费 - 印花税
    let totalPrice = 0;
    if (type === 1) {
      totalPrice = amount + totalFees;
    } else {
      totalPrice = amount - totalFees;
    }

    return {
      amount: Math.round(amount * 100) / 100,
      commission: Math.round(commission * 100) / 100,
      transfer_fee: Math.round(transferFee * 100) / 100,
      stamp_tax: Math.round(stampTax * 100) / 100,
      total_fees: Math.round(totalFees * 100) / 100,
      total_price: Math.round(totalPrice * 100) / 100
    };
  }

  /* 可卖股数 = 当前持仓 - 今天买入（T+1：今天买入的下一个交易日才能卖），下限 0 */
  function getSellable(code) {
    const c = String(code || '').replace(/[^\d]/g, '');
    if (!c) return 0;
    const all = get(K.transactions, []) || [];
    const todayStr = getLocalDateStr(new Date());
    let qty = 0;
    let todayBuy = 0;
    for (const t of all) {
      if (String(t.stock_code || '').replace(/[^\d]/g, '') !== c) continue;
      const tQty = Number(t.quantity) || 0;
      if (Number(t.type) === 1) {
        qty += tQty;
        if (getLocalDateStr(t.created_at) === todayStr) todayBuy += tQty;
      } else {
        qty -= tQty;
      }
    }
    return Math.max(0, qty - todayBuy);
  }

  function addTransaction(tx) {
    // 数据层校验（UI 会先给友好提示，这里是最后一道闸）：
    // 1) 股数必须是正整数且为 100 的整数倍（唯一例外：卖出时恰好把零股一次性清仓，A股允许）
    // 2) 卖出不得超过可卖股数（含 T+1：今天买入的明天才能卖）
    const q = Number(tx.quantity) || 0;
    const isBuy = Number(tx.type) === 1;
    if (!Number.isInteger(q) || q <= 0) {
      throw new Error('成交股数无效');
    }
    const sellable = isBuy ? null : getSellable(tx.stock_code);
    if (sellable !== null && q > sellable) {
      throw new Error('卖出 ' + q + ' 股超过可卖 ' + sellable + ' 股（今天买入的要到下一个交易日才能卖）');
    }
    if (q % 100 !== 0 && q !== sellable) {
      throw new Error('买卖股数必须是 100 的整数倍');
    }
    const all = get(K.transactions, []) || [];
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const feeInfo = calculateFees(tx);
    const item = Object.assign({}, tx, {
      id,
      amount: tx.amount !== undefined ? tx.amount : feeInfo.amount,
      commission: tx.commission !== undefined ? tx.commission : feeInfo.commission,
      transfer_fee: tx.transfer_fee !== undefined ? tx.transfer_fee : feeInfo.transfer_fee,
      stamp_tax: tx.stamp_tax !== undefined ? tx.stamp_tax : feeInfo.stamp_tax,
      total_price: tx.total_price !== undefined && tx.total_price !== null ? tx.total_price : feeInfo.total_price,
      created_at: tx.created_at || new Date().toISOString()
    });
    all.push(item);
    set(K.transactions, all);
    return item;
  }

  function deleteTransaction(id, code) {
    let all = get(K.transactions, []) || [];
    if (id) {
      all = all.filter((t) => String(t.id) !== String(id));
    } else if (code) {
      all = all.filter((t) => t.stock_code !== String(code));
    }
    set(K.transactions, all);
    return true;
  }

  function getLatestQuotes() {
    return get(K.latestQuotes, {}) || {};
  }

  function setLatestQuotes(quotesMap) {
    if (!quotesMap || typeof quotesMap !== 'object') return;
    const cur = getLatestQuotes();
    const merged = Object.assign({}, cur, quotesMap);
    set(K.latestQuotes, merged);
    return merged;
  }

  /*
   * 跨窗口「行情新鲜度」标记（只放 dbStorage，全局共享）。
   * 主窗口 / 悬浮球 / 面板各有自己的刷新循环，之前同一份行情会被三个窗口各拉一遍；
   * 这里记录「最近一次成功拉取的时刻 + 覆盖到的代码」，
   * 其它窗口只要发现数据够新且代码覆盖完整，就直接用缓存渲染，不再重复发网络请求。
   */
  function getQuoteStamp() {
    const st = get(K.quoteStamp, null);
    return st && typeof st === 'object' ? st : null;
  }

  function setQuoteStamp(stamp) {
    return set(K.quoteStamp, stamp || null);
  }

  function getLatestIndexes() {
    const v = get(K.latestIndexes, null);
    return Array.isArray(v) ? v : [];
  }

  function setLatestIndexes(list) {
    const arr = Array.isArray(list) ? list : [];
    set(K.latestIndexes, arr);
    return arr;
  }

  function getAllPositions(latestQuotesMap) {
    const txs = get(K.transactions, []) || [];
    const stockMap = {};
    for (const t of txs) {
      if (!stockMap[t.stock_code]) stockMap[t.stock_code] = [];
      stockMap[t.stock_code].push(t);
    }
    const positions = [];
    const todayStr = getLocalDateStr(new Date());
    const cachedQuotes = getLatestQuotes();
    const qMap = latestQuotesMap || cachedQuotes || {};

    for (const [code, list] of Object.entries(stockMap)) {
      let qty = 0;
      let totalBuy = 0;
      let totalSell = 0;
      let todayBuyQty = 0;
      let todayBuyAmt = 0;
      let todaySellQty = 0;
      let todaySellAmt = 0;
      let name = code;

      for (const t of list) {
        if (t.stock_name) name = t.stock_name;
        const tDate = getLocalDateStr(t.created_at);
        const isToday = tDate === todayStr;
        const tPrice = Number(t.total_price != null ? t.total_price : (t.price * t.quantity)) || 0;
        const tQty = Number(t.quantity) || 0;

        if (Number(t.type) === 1) { // Buy
          qty += tQty;
          totalBuy += tPrice;
          if (isToday) {
            todayBuyQty += tQty;
            todayBuyAmt += tPrice;
          }
        } else { // Sell
          qty -= tQty;
          totalSell += tPrice;
          if (isToday) {
            todaySellQty += tQty;
            todaySellAmt += tPrice;
          }
        }
      }

      if (qty > 0 || todayBuyQty > 0 || todaySellQty > 0) {
        const netCost = totalBuy - totalSell;
        const costPrice = qty > 0 ? Math.max(0, netCost / qty) : 0;
        const pureCode = String(code).replace(/[^\d]/g, '');
        const q = (qMap && (qMap[code] || qMap[pureCode] || qMap['sz' + pureCode] || qMap['sh' + pureCode])) || {};
        const curPrice = (q.price !== null && q.price !== undefined && !isNaN(q.price)) ? Number(q.price) : costPrice;
        const curChg = (q.change !== null && q.change !== undefined && !isNaN(q.change)) ? Number(q.change) : 0;
        const chgPct = (q.pct !== null && q.pct !== undefined && !isNaN(q.pct)) ? Number(q.pct) : 0;
        const prevClose = (q.prevClose !== null && q.prevClose !== undefined && !isNaN(q.prevClose) && Number(q.prevClose) > 0)
          ? Number(q.prevClose)
          : ((curPrice !== undefined && curChg !== undefined) ? (curPrice - curChg) : costPrice);

        const marketValue = qty > 0 ? (curPrice * qty) : 0;
        const totalCostVal = qty > 0 ? (costPrice * qty) : 0;
        const profitLoss = qty > 0 ? (marketValue - netCost) : 0;
        const profitLossRate = totalCostVal > 0 ? (profitLoss / totalCostVal) * 100 : (netCost > 0 ? (profitLoss / netCost) * 100 : 0);

        // 券商标准当日盈亏公式：
        // 当日盈亏 = (当前持有市值 + 当日卖出成交额) - (昨日持有市值 + 当日买入成交额)
        // 其中 昨日持有股数 = 当前持有股数 - 今日买入股数 + 今日卖出股数
        const yesterdayQty = Math.max(0, qty - todayBuyQty + todaySellQty);
        const yesterdayMarketValue = yesterdayQty * prevClose;
        const todayProfitLoss = (marketValue + todaySellAmt) - (yesterdayMarketValue + todayBuyAmt);

        positions.push({
          stock_code: code,
          stock_name: name,
          quantity: qty,
          cost_price: Number(costPrice.toFixed(3)),
          current_price: Number(curPrice.toFixed(3)),
          current_change: Number(curChg.toFixed(3)),
          change_percent: Number(chgPct.toFixed(2)),
          market_value: Number(marketValue.toFixed(2)),
          total_cost: Number(totalCostVal.toFixed(2)),
          profit_loss: Number(profitLoss.toFixed(2)),
          profit_loss_rate: Number(profitLossRate.toFixed(2)),
          today_profit_loss: Number(todayProfitLoss.toFixed(2)),
          today_buy_quantity: todayBuyQty,
          today_buy_amount: todayBuyAmt,
          today_sell_quantity: todaySellQty,
          today_sell_amount: todaySellAmt
        });
      }
    }
    return positions;
  }

  function getPositionsSummary(latestQuotesMap) {
    const positions = getAllPositions(latestQuotesMap);
    let totalMarketValue = 0;
    let totalCost = 0;
    let totalProfitLoss = 0;
    let todayProfitLoss = 0;

    for (const p of positions) {
      if (p.quantity > 0) {
        totalMarketValue += p.market_value;
        totalCost += p.total_cost;
        totalProfitLoss += p.profit_loss;
      }
      if (p.quantity > 0 || p.today_profit_loss !== 0) {
        todayProfitLoss += p.today_profit_loss;
      }
    }
    const totalProfitLossRate = totalCost > 0 ? (totalProfitLoss / totalCost) * 100 : 0;
    return {
      totalMarketValue: Number(totalMarketValue.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      totalProfitLoss: Number(totalProfitLoss.toFixed(2)),
      totalProfitLossRate: Number(totalProfitLossRate.toFixed(2)),
      todayProfitLoss: Number(todayProfitLoss.toFixed(2)),
      count: positions.filter((p) => p.quantity > 0).length,
      positions
    };
  }

  function getClosedPositions(latestQuotesMap) {
    const txs = get(K.transactions, []) || [];
    const stockMap = {};
    for (const t of txs) {
      if (!stockMap[t.stock_code]) stockMap[t.stock_code] = [];
      stockMap[t.stock_code].push(t);
    }
    const positions = [];

    for (const [code, list] of Object.entries(stockMap)) {
      let qty = 0;
      let totalBuy = 0;
      let totalSell = 0;
      let name = code;
      let closedAt = '';
      for (const t of list) {
        if (t.stock_name) name = t.stock_name;
        const tPrice = Number(t.total_price || (t.price * t.quantity)) || 0;
        const tQty = Number(t.quantity) || 0;
        if (Number(t.type) === 1) {
          qty += tQty;
          totalBuy += tPrice;
        } else {
          qty -= tQty;
          totalSell += tPrice;
          const d = getLocalDateStr(t.created_at);
          if (d > closedAt) closedAt = d;
        }
      }
      if (qty === 0 && list.length > 0) {
        const profitLoss = totalSell - totalBuy;
        const profitLossRate = totalBuy > 0 ? (profitLoss / totalBuy) * 100 : 0;
        const q = (latestQuotesMap && (latestQuotesMap[code] || latestQuotesMap[code.replace(/[^\d]/g, '')])) || {};
        positions.push({
          stock_code: code,
          stock_name: name,
          quantity: 0,
          cost_price: 0,
          current_price: q.price || 0,
          current_change: q.change || 0,
          change_percent: q.pct || 0,
          profit_loss: Number(profitLoss.toFixed(2)),
          profit_loss_rate: Number(profitLossRate.toFixed(2)),
          closed_at: closedAt
        });
      }
    }
    return positions;
  }

  function getAlerts() {
    return get(K.alerts, []) || [];
  }

  function saveAlert(rawAlert) {
    if (!rawAlert || !rawAlert.stock_code) return null;
    const code = String(rawAlert.stock_code).replace(/[^\d]/g, '').slice(0, 6);
    if (!code) return null;
    const item = {
      stock_code: code,
      stock_name: String(rawAlert.stock_name || code).trim(),
      high_price: Number(rawAlert.high_price) || 0,
      low_price: Number(rawAlert.low_price) || 0,
      high_change: Number(rawAlert.high_change) || 0,
      low_change: Number(rawAlert.low_change) || 0,
      notification_interval: Math.max(1, Number(rawAlert.notification_interval) || 5),
      enabled: rawAlert.enabled !== undefined ? !!rawAlert.enabled : true,
      updated_at: Date.now()
    };
    const alerts = getAlerts().filter((a) => a.stock_code !== code);
    const hasCondition = item.high_price > 0 || item.low_price > 0 || item.high_change !== 0 || item.low_change !== 0;
    if (hasCondition) {
      alerts.push(item);
    }
    set(K.alerts, alerts);
    clearAlertCooldown(code);   // 重新设置（改了目标价）后允许立刻提醒
    return item;
  }

  function deleteAlert(code) {
    const c = String(code || '').replace(/[^\d]/g, '').slice(0, 6);
    const alerts = getAlerts().filter((a) => a.stock_code !== c);
    set(K.alerts, alerts);
    clearAlertCooldown(c);   // 删掉预警后，重新设置时应能立刻提醒
    return true;
  }

  /*
   * 预警通知冷却表。
   * 以前它是 preload.js 里的模块级变量，也就是「每个窗口各一份」，于是同一条预警
   * 会在主窗口 / 悬浮球 / 面板各弹一次（再加上持仓与自选两条评估路径，最多弹 4 次）。
   * 现在放进跨窗口共享的 dbStorage，谁先提醒谁占坑，其它窗口在整个冷却期内静默。
   * 只是运行期缓存，不镜像到 JSON 文件（同行情缓存）。
   */
  const COOLDOWN_TTL = 6 * 60 * 60 * 1000;   // 超过 6 小时的老记录清理掉
  const COOLDOWN_MAX = 200;

  function getAlertCooldowns() {
    const raw = get(K.alertCooldowns, null);
    if (!raw || typeof raw !== 'object') return {};
    const now = Date.now();
    const out = {};
    const keys = Object.keys(raw);
    for (let i = 0; i < keys.length; i++) {
      const t = Number(raw[keys[i]]);
      if (t && (now - t) < COOLDOWN_TTL) out[keys[i]] = t;
    }
    if (keys.length > COOLDOWN_MAX) {
      const sorted = Object.keys(out).sort((a, b) => out[b] - out[a]).slice(0, COOLDOWN_MAX);
      const trimmed = {};
      sorted.forEach((k) => { trimmed[k] = out[k]; });
      return trimmed;
    }
    return out;
  }

  function setAlertCooldowns(map) {
    return set(K.alertCooldowns, map && typeof map === 'object' ? map : {});
  }

  function clearAlertCooldown(code) {
    const c = String(code || '').replace(/[^\d]/g, '').slice(0, 6);
    if (!c) return false;
    const map = getAlertCooldowns();
    let changed = false;
    Object.keys(map).forEach((k) => {
      if (k.indexOf(c + '_') === 0) { delete map[k]; changed = true; }
    });
    if (changed) setAlertCooldowns(map);
    return changed;
  }

  return {
    db, get, set, getWatchlist, setWatchlist,
    getWatchlistGroups, setWatchlistGroups, addWatchlistGroup, removeWatchlistGroup, renameWatchlistGroup,
    getSettings, patchSettings,
    getBallPos, setBallPos, setHeartbeat, getHeartbeat, postCmd, readCmd,
    getSellable, getTransactions, addTransaction, deleteTransaction, calculateFees,
    getAllPositions, getPositionsSummary, getClosedPositions,
    getLatestQuotes, setLatestQuotes,
    getLatestIndexes, setLatestIndexes, getQuoteStamp, setQuoteStamp,
    getAlerts, saveAlert, deleteAlert, getAlertCooldowns, setAlertCooldowns, clearAlertCooldown,
    getDataFilePath: () => dataFilePath, syncStorage,
    syncFromFile: () => {
      syncStorage(true);
      return { transactions: (getTransactions() || []).length, watchlist: (getWatchlist() || []).length };
    },
    importFromFile: (p) => importFromTransactionsJson(p),
    K, DEFAULT_SETTINGS, DEFAULT_WATCHLIST
  };
}

module.exports = { createStore, K, DEFAULT_SETTINGS, DEFAULT_WATCHLIST };
