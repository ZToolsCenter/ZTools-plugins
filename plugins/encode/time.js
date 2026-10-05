/* =========================================================================
 * time.js —— 时间工具(纯逻辑,无 UI 依赖),自 Raycast 扩展 timestamp 迁移
 *   · parse(input): 识别输入 → { ok, ms(BigInt), unit, error }
 *       支持:秒/毫秒/微秒/纳秒 时间戳(10/13/16/19 位纯数字);
 *            数字日期字面量 yyyyMMdd / yyyyMMddHHmm / yyyyMMddHHmmss / yyyyMMddHHmmssSSS;
 *            分隔符格式 yyyy-MM-dd[ HH:mm[:ss[.SSS]]](含 / 与 . 分隔、可带 T);
 *            中文格式 yyyy年M月d日;ISO 8601 / RFC 兜底(Date.parse,UTC 感知)。
 *   · format(ms): 输出 6 种格式数组 [{ label, value }]
 *   · nowString(): 当前时间格式化为 yyyy-MM-dd HH:mm:ss.SSS
 * ========================================================================= */

const pad = (n, w = 2) => String(n).padStart(w, '0')

/* --------------------------- 解析:纯数字 --------------------------- */
// 数字日期字面量(按长度匹配,解析为本地时间)
const NUM_DATE_RE = {
  8: /^(\d{4})(\d{2})(\d{2})$/,
  12: /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/,
  14: /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
  17: /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})$/
}
const NUM_DATE_LABEL = {
  8: 'yyyyMMdd',
  12: 'yyyyMMddHHmm',
  14: 'yyyyMMddHHmmss',
  17: 'yyyyMMddHHmmssSSS'
}

function tryDateLiteral(digits) {
  const re = NUM_DATE_RE[digits.length]
  if (!re) return null
  const m = digits.match(re)
  if (!m) return null
  const y = +m[1],
    mo = +m[2],
    d = +m[3],
    h = +(m[4] || 0),
    mi = +(m[5] || 0),
    s = +(m[6] || 0),
    ms = +(m[7] || 0)
  if (y < 1900 || y > 2099) return null
  const dt = new Date(y, mo - 1, d, h, mi, s, ms)
  // 回环校验:2月30日等非法日期会被 Date 自动进位,必须排除
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  if (dt.getHours() !== h || dt.getMinutes() !== mi || dt.getSeconds() !== s) return null
  return dt
}

// 时间戳单位 → 毫秒(BigInt,纳秒超出 2^53 安全整数)
function unitToMs(digits, unit) {
  const n = BigInt(digits)
  if (unit === 'ms') return n
  if (unit === 's') return n * 1000n
  if (unit === 'us') return n / 1000n
  return n / 1000000n // ns
}

const UNIT_LABEL = { s: '秒', ms: '毫秒', us: '微秒', ns: '纳秒' }
const UNIT_LEN = { 10: 's', 13: 'ms', 16: 'us', 19: 'ns' }

// 结果年份是否在合理范围(1900-2200)
function plausible(msBig) {
  const n = Number(msBig)
  if (!isFinite(n)) return false
  const y = new Date(n).getFullYear()
  return y >= 1900 && y <= 2200
}

function parseNumeric(digits) {
  const len = digits.length
  // 1) 数字日期字面量优先(8/12/14/17 位且构成合法日期)
  if (NUM_DATE_RE[len]) {
    const dt = tryDateLiteral(digits)
    if (dt) return { ok: true, ms: BigInt(dt.getTime()), unit: NUM_DATE_LABEL[len] + ' 格式' }
  }
  // 2) 时间戳按位数猜测(10=秒 13=毫秒 16=微秒 19=纳秒)
  const guess = UNIT_LEN[len]
  if (guess) {
    const ms = unitToMs(digits, guess)
    if (plausible(ms)) return { ok: true, ms, unit: UNIT_LABEL[guess] + ' 时间戳' }
  }
  // 3) 兜底:逐个单位扫描,取第一个年份合理的解释
  for (const u of ['ms', 's', 'us', 'ns']) {
    const ms = unitToMs(digits, u)
    if (plausible(ms)) return { ok: true, ms, unit: UNIT_LABEL[u] + ' 时间戳' }
  }
  // 4) 数字符合日期位数但非法(如 20261399)
  if (NUM_DATE_RE[len]) return { ok: false, error: '数字不符合有效日期: ' + digits }
  return { ok: false, error: '无法识别的时间戳: ' + digits }
}

/* --------------------------- 解析:格式化字符串 --------------------------- */
function parseFormatted(raw) {
  // 分隔符日期时间(本地时间,可带 T;不带 Z/时区后缀时一律本地)
  const m = raw.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/
  )
  if (m) {
    const y = +m[1],
      mo = +m[2],
      d = +m[3],
      h = +(m[4] || 0),
      mi = +(m[5] || 0),
      s = +(m[6] || 0),
      ms = +(m[7] || 0)
    if (y < 1900 || y > 2099) return { ok: false, error: '年份超出支持范围(1900-2099)' }
    const dt = new Date(y, mo - 1, d, h, mi, s, ms)
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
      return { ok: false, error: '无效日期: ' + raw }
    }
    return { ok: true, ms: BigInt(dt.getTime()), unit: '日期时间字符串' }
  }
  // 中文格式:2026年08月16日 [19:25:33]
  const mc = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (mc) {
    const y = +mc[1],
      mo = +mc[2],
      d = +mc[3],
      h = +(mc[4] || 0),
      mi = +(mc[5] || 0),
      s = +(mc[6] || 0)
    const dt = new Date(y, mo - 1, d, h, mi, s)
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
      return { ok: false, error: '无效日期: ' + raw }
    }
    return { ok: true, ms: BigInt(dt.getTime()), unit: '日期时间字符串' }
  }
  return { ok: false, error: '' } // 交由 Date.parse 兜底
}

/* --------------------------- 对外:parse --------------------------- */
function parse(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: '请输入时间' }
  if (/^-?\d+$/.test(raw)) {
    const neg = raw.startsWith('-')
    const digits = neg ? raw.slice(1) : raw
    const r = parseNumeric(digits)
    if (r.ok && neg && r.ms !== undefined) r.ms = -r.ms
    return r
  }
  const r = parseFormatted(raw)
  if (r.ok) return r
  if (r.error) return r
  const t = Date.parse(raw) // ISO 8601 / RFC 兜底(UTC 感知)
  if (!isNaN(t)) return { ok: true, ms: BigInt(t), unit: 'ISO/标准格式' }
  return { ok: false, error: '无法识别的时间格式: ' + raw }
}

/* --------------------------- 对外:format --------------------------- */
function format(msBig) {
  const ms = typeof msBig === 'bigint' ? msBig : BigInt(Math.round(msBig))
  const n = Number(ms)
  const d = new Date(n)
  const Y = d.getFullYear()
  const M = pad(d.getMonth() + 1),
    D = pad(d.getDate())
  const H = pad(d.getHours()),
    Mi = pad(d.getMinutes()),
    S = pad(d.getSeconds()),
    SS = pad(d.getMilliseconds(), 3)
  // 本地时区偏移(分钟,东八区为 -480)
  const off = d.getTimezoneOffset()
  const tz =
    (off <= 0 ? '+' : '-') + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60)
  // UTC 视图
  const uY = d.getUTCFullYear()
  const uM = pad(d.getUTCMonth() + 1),
    uD = pad(d.getUTCDate())
  const uH = pad(d.getUTCHours()),
    uMi = pad(d.getUTCMinutes()),
    uS = pad(d.getUTCSeconds()),
    uSS = pad(d.getUTCMilliseconds(), 3)
  return [
    { label: '毫秒时间戳', value: ms.toString() },
    { label: 'yyyy-MM-dd HH:mm:ss', value: `${Y}-${M}-${D} ${H}:${Mi}:${S}` },
    { label: 'yyyyMMddHHmmss', value: `${Y}${M}${D}${H}${Mi}${S}` },
    { label: 'ISO 8601(本地)', value: `${Y}-${M}-${D}T${H}:${Mi}:${S}.${SS}${tz}` },
    { label: 'ISO 8601(UTC)', value: `${uY}-${uM}-${uD}T${uH}:${uMi}:${uS}.${uSS}Z` },
    { label: '秒时间戳', value: (ms / 1000n).toString() }
  ]
}

/* --------------------------- 对外:当前时间 --------------------------- */
function nowString() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

const api = { parse, format, nowString }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.TimeLib = api
