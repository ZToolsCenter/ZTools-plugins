'use strict';
/*
 * 行情数据层：东方财富 push2 系列接口（UTF-8 JSON，无需 GBK 解码）
 * 返回结构全部归一化成前端友好的对象；拿不到的字段返回 null。
 */
const { httpGet, httpGetJSON, UA } = require('./httpclient.js');

const UT = 'bd1d9ddb04089700cf9c27f6f7426281';
const HDR = {
  'User-Agent': UA,
  'Referer': 'https://data.eastmoney.com/',
  'Accept': 'application/json, text/plain, */*'
};

/* 东财 push2 的分片服务器会轮着抽风（502），按顺序兜底 */
const EM_HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com'
];

function proxyOf(opts) { return (opts && opts.proxy) || 'auto'; }

/**
 * 打东财 push2 接口：某个分片挂了就换下一个
 * @param {string} qs 形如 'api/qt/ulist.np/get?fltt=2&...'
 */
async function emJson(qs, opts) {
  let lastErr = null;
  for (const host of EM_HOSTS) {
    try {
      const json = await httpGetJSON(host + '/' + qs, { headers: HDR, proxy: proxyOf(opts), retries: 0, timeout: 3500 });
      if (json && json.rc === 0) return json;
      lastErr = new Error('东财返回 rc=' + (json && json.rc) + '（' + host.replace(/^https:\/\//, '') + '）');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('东财接口不可用');
}

const INDEX_LIST = [
  { code: '1.000001', name: '上证指数' },
  { code: '0.399001', name: '深证成指' },
  { code: '0.399006', name: '创业板指' },
  { code: '1.000300', name: '沪深300' }
];

const QUOTE_FIELDS = 'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18';

function num(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s || s === '-' || s === '--') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function digits(input) {
  return String(input == null ? '' : input).replace(/[^\d]/g, '').slice(0, 6);
}

/** '600961' / 'sh600961' / '1.600961' → '1.600961' */
function toSecid(input) {
  const s = String(input == null ? '' : input).trim();
  if (/^[01]\.\d{6}$/.test(s)) return s;
  const m = /^(sh|sz|bj)(\d{6})$/i.exec(s);
  let market = m ? m[1].toLowerCase() : '';
  const code = digits(m ? m[2] : s);
  if (!/^\d{6}$/.test(code)) return '';
  if (!market) market = /^[659]/.test(code) ? 'sh' : 'sz';
  if (market === 'bj') market = 'sz';
  return (market === 'sh' ? '1.' : '0.') + code;
}

/** '1.600961' → { market:'sh', code:'600961', secid:'1.600961' } */
function fromSecid(secid) {
  const s = String(secid || '');
  const code = digits(s.split('.').pop());
  const market = s.charAt(0) === '1' ? 'sh' : 'sz';
  return { market, code, secid: (market === 'sh' ? '1.' : '0.') + code };
}

/** 带 TTL 的进程内缓存，防止球和面板同时轮询打爆接口 */
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < ttl) return hit.v;
  if (hit && hit.p) return hit.p;
  const p = (async () => {
    try {
      const v = await fn();
      cache.set(key, { t: Date.now(), v });
      return v;
    } catch (e) {
      cache.delete(key);
      throw e;
    }
  })();
  cache.set(key, { t: hit ? hit.t : 0, v: hit ? hit.v : null, p });
  try { return await p; } finally { const h = cache.get(key); if (h) delete h.p; }
}

function mapQuote(d) {
  return {
    code: digits(d.f12),
    secid: (num(d.f13) === 1 ? '1.' : '0.') + digits(d.f12),
    name: d.f14 || digits(d.f12),
    price: num(d.f2),
    pct: num(d.f3),
    change: num(d.f4),
    volume: num(d.f5),
    amount: num(d.f6),
    high: num(d.f15),
    low: num(d.f16),
    open: num(d.f17),
    prevClose: num(d.f18)
  };
}

/**
 * 批量行情
 * @param {Array<string|{code?:string,secid?:string}>} items
 */
async function quotes(items, opts) {
  const list = (items || []).map((it) => (typeof it === 'string' ? it : (it && (it.secid || it.code)) || '')).filter(Boolean);
  const secids = list.map(toSecid).filter(Boolean);
  if (!secids.length) return [];
  const qs = 'api/qt/ulist.np/get?fltt=2&invt=2&np=1&ut=' + UT +
    '&fields=' + QUOTE_FIELDS + '&secids=' + secids.join(',');
  const json = await cached('q:' + secids.join(','), 1500, () => emJson(qs, opts));
  const diff = (json && json.data && json.data.diff) || [];
  const out = diff.map(mapQuote);
  // 按请求顺序返回，顺便补上接口没给的名字
  const byCode = new Map(out.map((q) => [q.code, q]));
  return secids.map((sid) => {
    const c = fromSecid(sid);
    const q = byCode.get(c.code);
    if (q) return q;
    return { code: c.code, secid: sid, name: c.code, price: null, pct: null, change: null, high: null, low: null, open: null, prevClose: null, volume: null, amount: null, missing: true };
  });
}

async function indexes(opts) {
  const qs = await quotes(INDEX_LIST.map((i) => i.code), opts);
  return qs.map((q, i) => Object.assign({}, q, { name: (INDEX_LIST[i] && INDEX_LIST[i].name) || q.name }));
}

/** 分时（当日逐分钟）：{ code, secid, prevClose, items:[{time,price,avg,volume,amount}] } */
async function trend(input, opts) {
  const secid = toSecid(input);
  if (!secid) throw new Error('代码无效: ' + input);
  const qs = 'api/qt/stock/trends2/get?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ut=' + UT +
    '&np=1&fltt=2&invt=2&ndays=1&iscr=0&iscca=0';
  const json = await cached('t:' + secid, 3000, () => emJson(qs, opts));
  const data = (json && json.data) || {};
  const items = [];
  for (const line of data.trends || []) {
    const p = String(line).split(',');
    if (p.length < 6) continue;
    let t = p[0] || '';
    const sp = t.indexOf(' ');
    if (sp > 0) t = t.slice(sp + 1);
    if (t >= '09:15' && t <= '09:25' && Number(p[5]) === 0) continue;
    items.push({ time: t, price: num(p[2]), avg: num(p[7]), volume: num(p[5]), amount: num(p[6]) });
  }
  return {
    code: digits(data.code || fromSecid(secid).code),
    secid,
    name: data.name || '',
    prevClose: num(data.prePrice || data.preClose),
    items
  };
}

/** 个股详情（快照）：涨跌/开高低/量额/换手/量比/市盈率/市净率/流通市值 */
async function detail(input, opts) {
  const secid = toSecid(input);
  if (!secid) throw new Error('代码无效: ' + input);
  const qs = 'api/qt/stock/get?secid=' + secid +
    '&fields=f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f86,f116,f117,f127,f128,f162,f167,f168,f169,f170,f171,f177,f183,f184' +
    '&fltt=2&invt=2&np=1&ut=' + UT;
  const json = await cached('d:' + secid, 3000, () => emJson(qs, opts));
  const d = (json && json.data) || {};
  return {
    code: digits(d.f57 || fromSecid(secid).code),
    secid,
    name: d.f58 || '',
    price: num(d.f43),
    high: num(d.f44),
    low: num(d.f45),
    open: num(d.f46),
    prevClose: num(d.f60),
    volume: num(d.f47),        // 手
    amount: num(d.f48),        // 元
    volumeRatio: num(d.f50),   // 量比
    turnover: num(d.f168),     // 换手率 %
    pe: num(d.f162),
    pb: num(d.f167),
    marketCap: num(d.f116),    // 总市值
    floatCap: num(d.f117),     // 流通市值
    industry: d.f127 || ''
  };
}

function parseSmartbox(txt) {
  const m = /v_hint="([^"]*)"/.exec(txt || '');
  if (!m || !m[1]) return [];
  const items = m[1].split('^').filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const parts = it.split('~');
    if (parts.length < 3) continue;
    const mkt = (parts[0] || '').toLowerCase();
    const code = (parts[1] || '').trim();
    if (!['sh', 'sz', 'bj'].includes(mkt) || !/^\d{6}$/.test(code)) continue;
    const rawName = parts[2] || '';
    const name = rawName.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const pinyin = (parts[3] || '').toLowerCase();
    const tag = (parts[4] || '').toUpperCase();
    const quoteId = (mkt === 'sh' ? '1.' : '0.') + code;
    if (seen.has(quoteId)) continue;
    seen.add(quoteId);
    let typeName = 'A股';
    if (tag.includes('ETF') || tag.includes('LOF') || tag.includes('JJ') || tag.includes('OF')) typeName = '基金';
    else if (tag.includes('ZS')) typeName = '指数';
    else if (tag.includes('ZQ') || tag.includes('BOND')) typeName = '债券';
    out.push({
      code,
      secid: quoteId,
      market: mkt === 'sh' ? 'sh' : 'sz',
      name: name || code,
      type: typeName,
      pinyin
    });
  }
  return out;
}

async function searchSmartbox(kw, opts) {
  const url = 'https://smartbox.gtimg.cn/s3/?q=' + encodeURIComponent(kw) + '&t=all';
  const txt = await httpGet(url, { headers: { Referer: 'https://gu.qq.com/' }, proxy: proxyOf(opts), timeout: 3500, retries: 1 });
  return parseSmartbox(txt);
}

async function searchEastmoney(kw, opts) {
  const url = 'https://searchapi.eastmoney.com/api/suggest/get?input=' + encodeURIComponent(kw) +
    '&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=12';
  const json = await httpGetJSON(url, { headers: HDR, proxy: proxyOf(opts), timeout: 3500, retries: 1 });
  const rows = (json && json.QuotationCodeTable && json.QuotationCodeTable.Data) || [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const quoteId = r.QuoteID || '';
    if (!/^[01]\.\d{6}$/.test(quoteId)) continue;          // 只保留 A 股 / 场内基金
    const cls = String(r.Classify || '');
    if (cls && cls !== 'AStock' && cls !== 'Fund' && cls !== 'Index' && cls !== 'Bond') continue;
    if (seen.has(quoteId)) continue;
    seen.add(quoteId);
    const c = fromSecid(quoteId);
    out.push({
      code: c.code,
      secid: quoteId,
      market: c.market,
      name: r.Name || c.code,
      type: r.SecurityTypeName || cls || '',
      pinyin: r.PinYin || ''
    });
  }
  return out;
}

/** 按关键字/拼音/代码搜索（腾讯 Smartbox 支持全拼/简拼/代码/中文，东财 suggest 兜底） */
async function search(keyword, opts) {
  const kw = String(keyword == null ? '' : keyword).trim();
  if (!kw) return [];
  try {
    const list = await searchSmartbox(kw, opts);
    if (list && list.length) return list;
  } catch (e) {
    // smartbox 异常则回退
  }
  try {
    return await searchEastmoney(kw, opts);
  } catch (e) {
    return [];
  }
}

/** 兜底：腾讯行情（GBK），东财挂了时用 */
async function quotesTencent(items, opts) {
  const list = (items || []).map((it) => (typeof it === 'string' ? it : (it && (it.secid || it.code)) || '')).filter(Boolean);
  const codes = list.map((x) => {
    const c = fromSecid(toSecid(x) || '0.000000');
    return c.market + c.code;
  });
  if (!codes.length) return [];
  const url = 'http://qt.gtimg.cn/q=' + codes.join(',');
  const txt = await httpGet(url, { headers: { Referer: 'http://finance.qq.com/' }, proxy: (opts && opts.proxy) || 'auto', encoding: 'gbk' });
  const out = [];
  for (const line of txt.split(';')) {
    const t = line.trim();
    if (!t || t.indexOf('=') < 0) continue;
    const body = t.slice(t.indexOf('=') + 1).replace(/^"|"$/g, '');
    const p = body.split('~');
    if (p.length < 33) continue;
    const code = digits(p[2]);
    out.push({
      code,
      secid: (p[2].charAt(0) === '6' || /^[59]/.test(code) ? '1.' : '0.') + code,
      name: p[1],
      price: num(p[3]),
      prevClose: num(p[4]),
      open: num(p[5]),
      change: num(p[31]),
      pct: num(p[32]),
      high: num(p[33]),
      low: num(p[34]),
      volume: num(p[36]),
      amount: num(p[37]),
      source: 'tencent'
    });
  }
  return out;
}

function marketStatus(now) {
  const d = now ? new Date(now) : new Date();
  const day = d.getDay();
  const hhmm = d.getHours() * 100 + d.getMinutes();
  if (day === 0 || day === 6) return { open: false, label: '休市' };
  if (hhmm >= 930 && hhmm <= 1130) return { open: true, label: '交易中' };
  if (hhmm > 1130 && hhmm < 1300) return { open: false, label: '午间休市' };
  if (hhmm >= 1300 && hhmm <= 1500) return { open: true, label: '交易中' };
  if (hhmm < 930) return { open: false, label: '未开盘' };
  return { open: false, label: '已收盘' };
}

function isTradingTime(now) {
  const st = marketStatus(now);
  return !!(st && st.open);
}

/** 获取日K线数据（支持东财与腾讯双通道） */
async function kline(stockCode, opts) {
  const code = digits(stockCode);
  if (!code) return [];
  const secid = toSecid(stockCode) || toSecid(code);
  // klt：1/5/15/30/60=分钟K（当日K线用5），101=日K（历史K线），102=周K，103=月K
  const klt = Number(opts && opts.klt) || 101;
  const lmt = Number(opts && opts.lmt) || 2000;
  const emUrl = 'http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=' + klt + '&fqt=1&end=20500101&lmt=' + lmt;
  try {
    const json = await httpGetJSON(emUrl, { headers: HDR, proxy: proxyOf(opts), timeout: 8000 });
    if (json && json.data && Array.isArray(json.data.klines) && json.data.klines.length > 0) {
      const name = json.data.name || code;
      return json.data.klines.map((line) => {
        const p = line.split(',');
        return {
          code,
          name,
          date: p[0],
          open: num(p[1]) || 0,
          close: num(p[2]) || 0,
          high: num(p[3]) || 0,
          low: num(p[4]) || 0,
          volume: Math.round(num(p[5]) || 0)
        };
      });
    }
  } catch (e) { /* fallback to tencent */ }

  // 腾讯只兜底日K（分钟K没有对应通道）：分钟K拉失败直接返回空，由界面提示稍后重试
  if (klt !== 101) return [];
  // 腾讯日K兜底
  try {
    const m = fromSecid(secid);
    const txCode = m.market + code;
    const txUrl = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + txCode + ',day,,,2000,qfq';
    const json2 = await httpGetJSON(txUrl, { proxy: proxyOf(opts), timeout: 8000 });
    const data = json2 && json2.data && json2.data[txCode];
    const days = (data && (data.qfqday || data.day)) || [];
    return days.map((d) => ({
      code,
      name: code,
      date: String(d[0]),
      open: num(d[1]) || 0,
      close: num(d[2]) || 0,
      high: num(d[3]) || 0,
      low: num(d[4]) || 0,
      volume: Math.round(num(d[5]) || 0)
    }));
  } catch (e2) {
    return [];
  }
}

module.exports = {
  quotes,
  quotesTencent,
  indexes,
  trend,
  detail,
  search,
  marketStatus,
  isTradingTime,
  toSecid,
  fromSecid,
  INDEX_LIST,
  num,
  kline
};
