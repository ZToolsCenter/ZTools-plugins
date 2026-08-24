// preload.js —— 科研小盒（纯 Preload 模式）
// 规则：遵循 CommonJS 规范，可 require Node.js / Electron 原生能力；
// 本文件源码保持清晰可读，未压缩混淆，并与插件一起发布。
//
// 职责：读取并解压同目录下的 journals.json.gz（短键名压缩版），
//       映射回完整字段后供前端检索使用。
//       数据源替换：重新生成 journals.json.gz 即可（字段映射见 KEY_MAP）。

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DATA_FILE = 'journals.json.gz'

let DATA = []
let LOADED = false
let ERROR = null

// 短键名 → 完整字段名（与 Python 压缩脚本的 KEY_MAP 对应）
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
  // 补充计算字段
  var jifStr = String(out.jif || '')
  var jifNum = -1
  if (jifStr !== '') {
    var n = parseFloat(jifStr)
    if (!isNaN(n)) jifNum = n
  }
  out.jifNum = jifNum
  return out
}

// 解压 gzip → JSON → 展开键名 → 记录数组（懒加载）
function ensureLoaded() {
  if (LOADED) return { ok: !ERROR, total: DATA.length, error: ERROR }
  LOADED = true
  try {
    var file = path.join(__dirname, DATA_FILE)
    var gzBuf = fs.readFileSync(file)
    var jsonBuf = zlib.gunzipSync(gzBuf)
    var raw = JSON.parse(jsonBuf.toString('utf-8'))

    DATA = new Array(raw.length)
    for (var i = 0; i < raw.length; i++) {
      var j = expand(raw[i])
      // 构建检索用的小写拼接串（一次性）
      j._hay = ((j.name || '') + ' ' + (j.abbr || '') + ' ' +
                 (j.issn || '') + ' ' + (j.eissn || '')).toLowerCase()
      // 缩写前缀匹配用：同时覆盖“缩写 + 全称”的全部词（去停用词）
      j._tokensAll = tok((j.abbr || '') + ' ' + (j.name || ''))
      DATA[i] = j
    }
    ERROR = null
  } catch (e) {
    ERROR = String((e && e.message) || e)
    DATA = []
    console.error('[科研小盒] 加载 journals.json.gz 失败:', ERROR)
  }
  return { ok: !ERROR, total: DATA.length, error: ERROR }
}

/* ---------------- 搜索相关性评分 ---------------- */

function isIssnLike(q) {
  return /^\d{4}-?\d{3}[\dxX]$/.test(q.replace(/\s+/g, ''))
}

/**
 * 计算查询词与期刊的相关性得分（越高越相关）
 * 3 = 精确匹配（ISSN / 期刊全名 / 缩写完全等于 query）
 * 2 = 词首/前缀匹配
 * 1 = 包含匹配
 * 0 = 不匹配
 */
// 归一化：转大写并去除所有非字母数字（消除空格/连字符/点/大小写差异）
// 例： "Acta Derm Venereol" 与 "ACTA DERM-VENEREOL" 归一化后均为 "ACTADERMVENEREOL"
function norm(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// 分词 + 停用词（用于词级回退匹配）
var STOP = { THE: 1, OF: 1, AND: 1, A: 1, AN: 1, VOL: 1, NO: 1 }
function tok(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(function (t) { return t && !STOP[t] })
}

function relevanceScore(journal, q) {
  var qn = norm(q)
  if (!qn) return 0

  // ISSN 精确匹配
  var issnNorm = norm(journal.issn || '')
  var eissnNorm = norm(journal.eissn || '')
  if (issnNorm === qn || eissnNorm === qn) return 3

  var name = norm(journal.name || '')
  var abbr = norm(journal.abbr || '')

  // 精确全名/缩写（已归一化，自动容忍符号与大小写）
  if (name === qn || abbr === qn) return 3

  // 前缀匹配
  if (name.indexOf(qn) === 0 || abbr.indexOf(qn) === 0) return 2

  // 子串包含
  if (name.indexOf(qn) !== -1 || abbr.indexOf(qn) !== -1) return 1

  // 词级回退：查询的每个分词都能在刊名/缩写分词中找到，或作为某词前缀（如 N→NEW）
  // 注意：必须用“原始带空格的 q”做分词，不能用归一化后的结果（会丢失词边界）
  var qt = tok(q)
  if (qt.length) {
    var recTok = tok(journal.abbr || journal.name)
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

  // 缩写前缀匹配：处理 PubMed/NLM 缩写与 JCR 全称/缩写差异。
  // query 每个词必须是候选某词的前缀或反之（双向），且全部词命中。
  // 例： "Comput Struct Biotechnol J" -> "Computational and Structural Biotechnology Journal"
  //     "Probiotics Antimicrob Proteins" -> "Probiotics and Antimicrobial Proteins"
  //     "Clinical, Cosmetic and Investigational Dermatology" -> "CLIN COSMET INV DERM"
  if (qt.length >= 2 && journal._tokensAll && journal._tokensAll.length) {
    var allHit = true
    for (var ci = 0; ci < qt.length; ci++) {
      var qw = qt[ci], found = false
      for (var di = 0; di < journal._tokensAll.length; di++) {
        var cw = journal._tokensAll[di]
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

  /**
   * 搜索期刊：按相关性得分排序（精确 > 前缀 > 包含），同分按 JIF 高→低
   * @param {string} query  查询词（期刊名 / 缩写 / ISSN）
   * @param {number} limit  最大返回条数
   */
  search(query, limit /* = 60 */) {
    if (limit == null) limit = 60
    ensureLoaded()
    var q = String(query == null ? '' : query).trim().toLowerCase()
    if (!q) return []

    // ISSN 路径：精确匹配优先
    if (isIssnLike(q)) {
      var norm = q.replace(/\s+/g, '')
      var results = []
      for (var i = 0; i < DATA.length; i++) {
        var j = DATA[i]
        if ((j.issn || '').replace(/\s+/g, '').toLowerCase() === norm ||
            (j.eissn || '').replace(/\s+/g, '').toLowerCase() === norm) {
          results.push(j)
          if (results.length >= limit) break
        }
      }
      return results
    }

    // 通用路径：评分 + 排序
    var scored = []
    for (var k = 0; k < DATA.length; k++) {
      var journal = DATA[k]
      var s = relevanceScore(journal, q)
      if (s > 0) scored.push({ j: journal, score: s })
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score
      return b.j.jifNum - a.j.jifNum
    })

    var result = []
    for (var m = 0; m < scored.length && m < limit; m++) {
      result.push(scored[m].j)
    }
    return result
  },

  top(n /* = 20 */) {
    if (n == null) n = 20
    ensureLoaded()
    return DATA.slice().sort(function (a, b) { return b.jifNum - a.jifNum }).slice(0, n)
  }
}
