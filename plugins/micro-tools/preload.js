// preload.js —— 科研小盒（纯 Preload 模式）
// 规则：遵循 CommonJS 规范，可 require Node.js / Electron 原生能力；
// 本文件源码保持清晰可读，未压缩混淆，并与插件一起发布。
//
// 职责：读取并解压同目录下的两个数据集，映射回完整字段后供前端检索：
//   1. journals.json.gz —— JCR 2026 期刊（影响因子 / 分区 / JCI …）
//   2. ccf.json.gz      —— CCF 第七版（2026.3）推荐国际学术会议与期刊目录
// 两者在加载时按 ISSN 关联合并：同一本刊既显示影响因子，也显示 CCF 等级；
// 未被 JCR 收录的 CCF 条目（全部会议 + 少数期刊）作为独立记录并入检索。

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DATA_FILE = 'journals.json.gz'
const CCF_FILE = 'ccf.json.gz'

let DATA = []          // JCR 期刊（合并后会挂上 CCF 字段）
let CCF = []           // 未关联 JCR 的独立 CCF 条目
let ALL = []           // 统一检索数组 = DATA + CCF
let LOADED = false
let ERROR = null
let CCF_ERROR = null

// 短键名 → 完整字段名（与生成脚本对应）
const KEY_MAP = {
  n: 'name', a: 'abbr', i: 'issn', e: 'eissn',
  p: 'publisher', c: 'category', j: 'jif', q: 'quartile',
  jp: 'jifPct', jr: 'jifRank', jc: 'jci', jq: 'jciQuartile',
  f5: 'fiveYearJif', ct: 'citations', ar: 'articles',
  im: 'immediacy', o: 'oa', cd: 'catDetail', y: 'year'
}

function expand(rec) {
  const out = {}
  for (var k in rec) {
    out[KEY_MAP[k] || k] = rec[k]
  }
  var jifStr = String(out.jif == null ? '' : out.jif)
  var jifNum = -1
  if (jifStr !== '') {
    var n = parseFloat(jifStr)
    if (!isNaN(n)) jifNum = n
  }
  out.jifNum = jifNum
  return out
}

/* ---------------- 检索辅助 ---------------- */

function isIssnLike(q) {
  return /^\d{4}-?\d{3}[\dxX]$/.test(q.replace(/\s+/g, ''))
}

// 归一化：转大写并去除所有非字母数字（消除空格/连字符/点/大小写差异）
function norm(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

var STOP = { THE: 1, OF: 1, AND: 1, A: 1, AN: 1, VOL: 1, NO: 1 }
function tok(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(function (t) { return t && !STOP[t] })
}

/* ---------------- 加载 JCR ---------------- */

function loadJournals() {
  var file = path.join(__dirname, DATA_FILE)
  var raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf-8'))
  DATA = new Array(raw.length)
  for (var i = 0; i < raw.length; i++) {
    var j = expand(raw[i])
    j._tokensAll = tok((j.abbr || '') + ' ' + (j.name || ''))
    DATA[i] = j
  }
}

/* ---------------- 加载 CCF 并合并 ---------------- */

function loadCcf() {
  var file = path.join(__dirname, CCF_FILE)
  var raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf-8'))

  // ISSN/eISSN → JCR 记录（用于校验下标是否仍然有效）
  var byIssn = {}
  for (var i = 0; i < DATA.length; i++) {
    var d = DATA[i]
    if (d.issn) byIssn[d.issn] = d
    if (d.eissn) byIssn[d.eissn] = d
  }

  CCF = []
  var linked = 0

  for (var k = 0; k < raw.length; k++) {
    var o = raw[k]
    var type = o.t === 1 ? '期刊' : '会议'
    var info = {
      ccfRank: o.r || '',
      ccfCat: o.c || '',
      ccfType: type,
      ccfUrl: o.u || '',
      ccfNotes: o.x || '',
      ccfAbbr: o.a || ''
    }

    var host = null
    if (o.k != null) {
      var cand = DATA[o.k]
      if (cand && (!o.s || cand.issn === o.s || cand.eissn === o.s)) {
        host = cand
      } else if (o.s && byIssn[o.s]) {
        host = byIssn[o.s]   // 下标失效时退回 ISSN 查找
      }
    }

    if (host) {
      // 关联成功：把 CCF 信息挂到 JCR 期刊上，并把 CCF 缩写/中文领域并入检索
      host.ccfRank = info.ccfRank
      host.ccfCat = info.ccfCat
      host.ccfType = type
      host.ccfUrl = info.ccfUrl
      host.ccfNotes = info.ccfNotes
      host.ccfAbbr = info.ccfAbbr
      host._tokensAll = host._tokensAll.concat(tok((o.a || '') + ' ' + (o.n || '') + ' ' + (o.c || '')))
      linked++
      continue
    }

    // 无 JCR 对应（会议，或已被 JCR 除名的期刊）：独立成条
    var rec = {
      name: o.n || '',
      abbr: o.a || '',
      publisher: o.p || '',
      ccfRank: info.ccfRank,
      ccfCat: info.ccfCat,
      ccfType: type,
      ccfUrl: info.ccfUrl,
      ccfNotes: info.ccfNotes,
      ccfAbbr: info.ccfAbbr,
      // 与 JCR 记录保持同构，便于复用同一套评分/渲染
      issn: '', eissn: '', jif: '', jifNum: -1, quartile: '',
      jci: '', citations: '', fiveYearJif: '', jifRank: '', oa: '', catDetail: '',
      category: o.c || '', year: '',
      _conf: type === '会议',
      _tokensAll: tok((o.a || '') + ' ' + (o.n || '') + ' ' + (o.p || '') + ' ' + (o.c || ''))
    }
    CCF.push(rec)
  }

  ALL = DATA.concat(CCF)
  // 记录自身在统一数组中的下标，供渲染后按 data-idx 精确回查（避免按名字反查出错）
  for (var z = 0; z < ALL.length; z++) ALL[z]._i = z
  return { total: raw.length, linked: linked, standalone: CCF.length }
}

function ensureLoaded() {
  if (LOADED) return { ok: !ERROR, total: DATA.length, error: ERROR, ccf: CCF.length, ccfError: CCF_ERROR }
  LOADED = true
  try {
    loadJournals()
    ERROR = null
  } catch (e) {
    ERROR = String((e && e.message) || e)
    DATA = []
    console.error('[科研小盒] 加载 journals.json.gz 失败:', ERROR)
  }
  try {
    if (!ERROR) loadCcf()
  } catch (e2) {
    CCF_ERROR = String((e2 && e2.message) || e2)
    CCF = []
    ALL = DATA
    console.error('[科研小盒] 加载 ccf.json.gz 失败:', CCF_ERROR)
  }
  if (!ALL.length) ALL = DATA.concat(CCF)
  return { ok: !ERROR, total: DATA.length, error: ERROR, ccf: CCF.length, ccfError: CCF_ERROR }
}

/* ---------------- 搜索相关性评分 ---------------- */

/**
 * 3 = 精确匹配（ISSN / 全称 / 缩写 / CCF 缩写 完全等于 query）
 * 2 = 词首/前缀匹配
 * 1 = 包含匹配 / 全词命中
 * 0 = 不匹配
 */
function relevanceScore(r, q) {
  // 中文查询（如"人工智能"）归一化后会变成空串，需在此单独处理：只匹配 CCF 中文领域
  if (r.ccfCat && q && String(r.ccfCat).indexOf(q) !== -1) return 1

  var qn = norm(q)
  if (!qn) return 0

  var issnNorm = norm(r.issn || '')
  var eissnNorm = norm(r.eissn || '')
  if ((issnNorm && issnNorm === qn) || (eissnNorm && eissnNorm === qn)) return 3

  var name = norm(r.name || '')
  var abbr = norm(r.abbr || '')
  var ccfA = norm(r.ccfAbbr || '')

  if (name === qn || abbr === qn || ccfA === qn) return 3
  if (name.indexOf(qn) === 0 || abbr.indexOf(qn) === 0 || ccfA.indexOf(qn) === 0) return 2
  if (name.indexOf(qn) !== -1 || abbr.indexOf(qn) !== -1 || ccfA.indexOf(qn) !== -1) return 1
  var qt = tok(q)
  if (qt.length) {
    var recTok = tok((r.abbr || '') + ' ' + (r.name || '') + ' ' + (r.ccfAbbr || ''))
    if (recTok.length) {
      var hit = 0
      for (var ti = 0; ti < qt.length; ti++) {
        var t = qt[ti]
        if (recTok.indexOf(t) !== -1) { hit++; continue }
        for (var ri = 0; ri < recTok.length; ri++) {
          if (recTok[ri].indexOf(t) === 0) { hit++; break }
        }
      }
      if (hit === qt.length) return 1
    }
  }

  // 缩写前缀双向匹配（处理 PubMed/NLM 缩写与全称差异）
  if (qt.length >= 2 && r._tokensAll && r._tokensAll.length) {
    var allHit = true
    for (var ci = 0; ci < qt.length; ci++) {
      var qw = qt[ci], found = false
      for (var di = 0; di < r._tokensAll.length; di++) {
        var cw = r._tokensAll[di]
        if (cw.indexOf(qw) === 0 || qw.indexOf(cw) === 0) { found = true; break }
      }
      if (!found) { allHit = false; break }
    }
    if (allHit) return 1
  }

  return 0
}

// ---------------- 对外暴露的 API（纯 Preload） ----------------
window.journalApi = {
  ensureLoaded,

  get loaded() { return LOADED && !ERROR },
  get total()   { return DATA.length },
  get error()   { return ERROR },
  get allTotal() { return ALL.length },
  get ccfTotal() { return CCF.length },
  get ccfError() { return CCF_ERROR },

  /** 按下标取统一检索数组中的记录（渲染与操作复用，避免按名字反查出错） */
  get(i) { return ALL[i] },

  /**
   * 统一检索：JCR 期刊 + CCF 目录
   * @param {string} query
   * @param {number} limit
   * @param {string} filter  'all' | 'journal' | 'conf'
   */
  search(query, limit /* = 60 */, filter /* = 'all' */) {
    if (limit == null) limit = 60
    if (filter == null) filter = 'all'
    ensureLoaded()
    var q = String(query == null ? '' : query).trim()
    if (!q) return []

    var out = []
    var wantConf = filter === 'conf'
    var wantJour = filter === 'journal'

    // ISSN 路径：精确匹配优先
    if (isIssnLike(q)) {
      var nq = q.replace(/\s+/g, '').toLowerCase()
      for (var i = 0; i < ALL.length && out.length < limit; i++) {
        var r = ALL[i]
        if (r._conf && wantJour) continue
        if (!r._conf && wantConf) continue
        if ((r.issn || '').replace(/\s+/g, '').toLowerCase() === nq ||
            (r.eissn || '').replace(/\s+/g, '').toLowerCase() === nq) out.push(r)
      }
      return out
    }

    var ql = q.toLowerCase()
    var scored = []
    for (var k = 0; k < ALL.length; k++) {
      var rec = ALL[k]
      if (rec._conf && wantJour) continue
      if (!rec._conf && wantConf) continue
      var s = relevanceScore(rec, ql)
      if (s > 0) scored.push({ r: rec, score: s, i: k })
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score
      if (b.r.jifNum !== a.r.jifNum) return b.r.jifNum - a.r.jifNum
      return a.i - b.i
    })

    for (var m = 0; m < scored.length && m < limit; m++) out.push(scored[m].r)
    return out
  },

  top(n /* = 20 */) {
    if (n == null) n = 20
    ensureLoaded()
    return DATA.slice().sort(function (a, b) { return b.jifNum - a.jifNum }).slice(0, n)
  }
}
