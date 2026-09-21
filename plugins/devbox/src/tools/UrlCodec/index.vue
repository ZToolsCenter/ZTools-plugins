<script lang="ts" setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

type Direction = 'encode' | 'decode'
type Scope = 'component' | 'uri' | 'params'

interface UrlParam {
  key: string
  value: string
  keyError: string
  valueError: string
  hasValue: boolean
}

type UrlParts =
  | { kind: 'url'; scheme: string; host: string; path: string; hash: string; params: UrlParam[] }
  | { kind: 'query'; params: UrlParam[] }

interface StructureRow {
  label: string
  value: string
}

interface Result {
  ok: boolean
  /** 完整结果（复制用） */
  value: string
  /** 截断后的展示内容 */
  display: string
  truncated: boolean
  error: string
  note: string
  meta: string
}

interface RawPair {
  rawKey: string
  rawValue: string
  hasValue: boolean
}

interface UrlMatch {
  scheme: string
  host: string
  path: string
  search: string
  hash: string
}

const MAX_DISPLAY = 8000
const MAX_FILL = 200000

/** scheme://host/path?search#hash */
const URL_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/
/** 查询串：k=v&k2&k3=v3，允许无值参数与空值 */
const QUERY_PATTERN = /^[^\s&?=]*(=[^&]*)?(?:&[^\s&?=]*(=[^&]*)?)*$/

const direction = ref<Direction>('encode')
const scope = ref<Scope>('component')
const plusToSpace = ref(true)
const inputText = ref('')

// ---------- 结构解析 ----------

function matchUrl(text: string): UrlMatch | null {
  const m = URL_PATTERN.exec(text)
  if (!m) return null
  return {
    scheme: m[1],
    host: m[2],
    path: m[3],
    search: (m[4] || '').replace(/^\?/, ''),
    hash: m[5] || '',
  }
}

/** 去掉可选 ? 前缀并校验为查询串，不是则返回 null */
function matchQuery(text: string): string | null {
  const qs = text.startsWith('?') ? text.slice(1) : text
  if (!qs || !qs.includes('=') || /\s/.test(qs)) return null
  return QUERY_PATTERN.test(qs) ? qs : null
}

/** 按 & 和第一个 = 拆分——解码前后都基于同一个拆分结果，避免值内含 &/= 时被错误切分 */
function splitQuery(qs: string): RawPair[] {
  if (!qs) return []
  return qs.split('&').map(pair => {
    const eq = pair.indexOf('=')
    if (eq === -1) return { rawKey: pair, rawValue: '', hasValue: false }
    return { rawKey: pair.slice(0, eq), rawValue: pair.slice(eq + 1), hasValue: true }
  })
}

// ---------- 编解码底层 ----------

/** 尽力解码单个片段，失败时返回原文并标记错误 */
function decodePart(raw: string, plus: boolean): { text: string; error: string } {
  const s = plus ? raw.replace(/\+/g, ' ') : raw
  try {
    return { text: decodeURIComponent(s), error: '' }
  } catch {
    return { text: raw, error: '无法解码' }
  }
}

/** 路径逐段解码，保留 / 分隔符，+ 视为字面字符 */
function decodePath(path: string): string {
  if (!path) return ''
  return path
    .split('/')
    .map(seg => decodePart(seg, false).text)
    .join('/')
}

function parseQuery(qs: string, plus: boolean): UrlParam[] {
  return splitQuery(qs).map(p => {
    const k = decodePart(p.rawKey, plus)
    const v = decodePart(p.rawValue, plus)
    return { key: k.text, value: v.text, keyError: k.error, valueError: v.error, hasValue: p.hasValue }
  })
}

/**
 * 编码单个参数值：先解码再编码做归一化，对已合法编码的值是恒等变换（避免二次转义成 %25）。
 * 空格编码为 %20、字面 + 编码为 %2B——与解码方向「+ 还原为空格」的语义保持一致，
 * 否则输出里的裸 + 会被解读成空格，导致编解码来回不一致。
 */
function encodeValue(v: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(v))
  } catch {
    return encodeURIComponent(v)
  }
}

/** 「仅参数值」：只转义各查询参数的值，结构与参数名原样保留；输入不是 URL 时回退整段编码（count = -1） */
function encodeParamValues(raw: string): { value: string; count: number } {
  const t = raw.trim()
  const hit = matchUrl(t)
  let qs = ''
  let prefix = ''
  let suffix = ''
  if (hit) {
    prefix = `${hit.scheme}://${hit.host}${hit.path}`
    suffix = hit.hash
    qs = hit.search
  } else {
    const bare = matchQuery(t)
    if (bare === null) return { value: encodeURIComponent(t), count: -1 }
    qs = bare
  }

  let count = 0
  const pairs = splitQuery(qs).map(p => {
    if (!p.hasValue) return p.rawKey
    const enc = encodeValue(p.rawValue)
    if (enc !== p.rawValue) count++
    return `${p.rawKey}=${enc}`
  })
  const query = pairs.join('&')
  return { value: prefix + (query ? `?${query}` : '') + suffix, count }
}

/** 解码，plusToSpace 控制 + 是否还原为空格（x-www-form-urlencoded 语义） */
function decodeText(raw: string, plus: boolean): string {
  const cleaned = raw.trim()
  if (!cleaned) {
    throw new Error('没有可解码的内容')
  }
  const s = plus ? cleaned.replace(/\+/g, ' ') : cleaned
  try {
    return decodeURIComponent(s)
  } catch {
    const invalid = /%(?![0-9A-Fa-f]{2})/.exec(s)
    if (invalid && invalid.index !== undefined) {
      const from = Math.max(0, invalid.index - 10)
      const context = s.slice(from, invalid.index + 12).replace(/\n/g, ' ')
      throw new Error(`位置 ${invalid.index} 附近存在非法转义「…${context}…」，% 后必须跟两位十六进制数（如 %20）。若要表示字面 % 字符，请写成 %25`)
    }
    throw new Error('包含无法解码的转义序列，可能是不完整的 UTF-8 编码（如 %E4%B8 后缺少后续字节）')
  }
}

// ---------- URL 结构解析 ----------

/**
 * 在原始输入上解析 URL / 查询串结构（先按 & 和 = 拆分再逐段解码，
 * 避免解码后的值里恰好包含 & 或 = 导致错误切分）。
 * 命中不了任何结构时返回 null。
 */
function analyzeUrl(raw: string, plus: boolean): UrlParts | null {
  const t = raw.trim()
  if (!t) return null

  const hit = matchUrl(t)
  if (hit) {
    return {
      kind: 'url',
      scheme: hit.scheme,
      host: hit.host,
      path: decodePath(hit.path) || '/',
      hash: hit.hash ? decodePart(hit.hash.slice(1), false).text : '',
      params: parseQuery(hit.search, plus),
    }
  }

  const qs = matchQuery(t)
  if (qs === null) return null
  return { kind: 'query', params: parseQuery(qs, plus) }
}

// ---------- 结果计算 ----------

function emptyResult(error = '', meta = ''): Result {
  return { ok: false, value: '', display: '', truncated: false, error, note: '', meta }
}

function truncate(text: string) {
  return {
    display: text.length > MAX_DISPLAY ? text.slice(0, MAX_DISPLAY) : text,
    truncated: text.length > MAX_DISPLAY,
  }
}

/** 统计转义个数：不分配匹配数组，直接数 %（编码后出现的每个 % 都必然是一个转义序列的开头） */
function countEscapes(encoded: string): number {
  let count = 0
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') count++
  }
  return count
}

const result = computed<Result>(() => {
  if (direction.value === 'encode') {
    const text = inputText.value
    if (!text) return emptyResult()

    if (scope.value === 'params') {
      const { value, count } = encodeParamValues(text)
      const { display, truncated } = truncate(value)
      return {
        ok: true,
        value,
        display,
        truncated,
        error: '',
        note:
          count === -1
            ? '输入不是 URL / 查询串，已按「整段转义」方式编码'
            : count === 0
              ? '各参数值均为 URL 安全字符，无需转义，结果与输入一致'
              : `已转义 ${count} 个参数值，URL 结构（协议/主机/路径）与参数名原样保留`,
        meta: `${text.trim().length} 字符 → ${value.length} 字符`,
      }
    }

    const encoded = scope.value === 'uri' ? encodeURI(text) : encodeURIComponent(text)
    const { display, truncated } = truncate(encoded)
    return {
      ok: true,
      value: encoded,
      display,
      truncated,
      error: '',
      note:
        scope.value === 'uri'
          ? 'encodeURI：保留 : / ? & = 等结构字符，仅转义中文、空格等不安全字符；输入本身是合法 URL 时结果不变'
          : 'encodeURIComponent：把整段输入当作一个值全部转义（除字母数字与 - _ . ! ~ * \' ( ) 外），适合把整个 URL 塞进另一个参数里',
      meta: `${text.length} 字符 → ${encoded.length} 字符 · ${countEscapes(encoded)} 个转义`,
    }
  }

  const raw = inputText.value
  if (!raw.trim()) return emptyResult()

  try {
    const decoded = decodeText(raw, plusToSpace.value)
    const { display, truncated } = truncate(decoded)
    const plusNote = !plusToSpace.value && raw.includes('+') ? ' · 注意：+ 未还原为空格' : ''
    return {
      ok: true,
      value: decoded,
      display,
      truncated,
      error: '',
      note: decoded === raw.trim() ? '输入中没有需要解码的转义序列' + plusNote : plusNote,
      meta: `${raw.trim().length} 字符 → ${decoded.length} 字符`,
    }
  } catch (e: any) {
    return emptyResult(e.message || '解码失败', '解码失败')
  }
})

/**
 * 解码方向下解析出的 URL 结构（独立于解码是否成功）。
 * 优先在原始输入上解析（能正确处理只编码了部分内容的输入）；
 * 若原始输入里已不含未转义的结构字符（如「整段转义」的回填结果 http%3A%2F%2F…），
 * 则回退到在解码结果上解析——此时第一遍解码已还原出结构字符。
 * 注意回退时 + 不再当作空格：第一遍解码已消费掉 form-urlencoded 语义，剩余的 + 属字面字符。
 */
const analysis = computed<{ parts: UrlParts; fromDecoded: boolean } | null>(() => {
  if (direction.value !== 'decode') return null
  const direct = analyzeUrl(inputText.value, plusToSpace.value)
  if (direct) return { parts: direct, fromDecoded: false }
  if (!result.value.ok) return null
  const fallback = analyzeUrl(result.value.value, false)
  return fallback ? { parts: fallback, fromDecoded: true } : null
})

const urlParts = computed<UrlParts | null>(() => analysis.value?.parts ?? null)

const structureRows = computed<StructureRow[]>(() => {
  const parts = analysis.value?.parts
  if (!parts || parts.kind !== 'url') return []
  const rows: StructureRow[] = [
    { label: '协议', value: `${parts.scheme}://` },
    { label: '主机', value: parts.host },
    { label: '路径', value: parts.path || '/' },
  ]
  if (parts.hash) rows.push({ label: '锚点', value: `#${parts.hash}` })
  return rows
})

const inputStat = computed(() => {
  const len = inputText.value.length
  return len ? `${len} 字符` : ''
})

/** 编码方向下，输入看起来已是 percent-encoding 时给个提示 */
const looksEncoded = computed(() => {
  if (direction.value !== 'encode') return false
  const t = inputText.value
  return t.length >= 6 && /%[0-9A-Fa-f]{2}/.test(t)
})

// ---------- 交互 ----------

function setDirection(dir: Direction) {
  direction.value = dir
}

function swapDirection() {
  if (!result.value.ok) {
    setDirection(direction.value === 'encode' ? 'decode' : 'encode')
    return
  }
  if (result.value.value.length > MAX_FILL) {
    ElMessage.warning('内容过长，不适合回填到输入框')
    return
  }
  inputText.value = result.value.value
  setDirection(direction.value === 'encode' ? 'decode' : 'encode')
}

function clearAll() {
  inputText.value = ''
}

function copyText(text: string) {
  const ztools = (window as any).ztools
  // ztools.copyText 是同步 IPC 调用、可能同步抛错；clipboard 在非安全上下文下不存在。
  // 两者都放进 Promise 链，避免异常直接抛进点击事件变成未捕获错误。
  const task: Promise<void> = ztools?.copyText
    ? Promise.resolve().then(() => ztools.copyText(text))
    : navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error('当前环境不支持剪贴板'))
  task
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function copyParam(p: UrlParam) {
  copyText(p.value)
}

if ((window as any).ztools?.onPluginEnter) {
  ;(window as any).ztools.onPluginEnter(() => {
    try { (window as any).ztools.setExpendHeight(600) } catch (_) {}
  })
}
</script>

<template>
  <div class="urlcodec-tool">
    <h2>URL 编解码</h2>
    <p class="desc">URL 编码（percent-encoding）与解码，支持整段转义 / 仅不安全字符 / 仅参数值三种编码范围，自动解析 URL 结构与查询参数</p>

    <div class="toolbar">
      <el-radio-group :model-value="direction" size="small" @update:model-value="setDirection">
        <el-radio-button value="encode">编码</el-radio-button>
        <el-radio-button value="decode">解码</el-radio-button>
      </el-radio-group>

      <el-button link size="small" class="swap-btn" @click="swapDirection">
        {{ result.ok ? '结果回填并换向' : '换向' }}
      </el-button>

      <span class="spacer" />

      <template v-if="direction === 'encode'">
        <span class="opt-label">范围</span>
        <el-radio-group v-model="scope" size="small">
          <el-radio-button value="component">整段转义</el-radio-button>
          <el-radio-button value="uri">仅不安全字符</el-radio-button>
          <el-radio-button value="params">仅参数值</el-radio-button>
        </el-radio-group>
      </template>
      <el-checkbox v-else v-model="plusToSpace" size="small">+ 还原为空格</el-checkbox>
    </div>

    <div class="panels">
      <!-- 输入 -->
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">输入</span>
          <span class="panel-stat">{{ inputStat }}</span>
          <span class="spacer" />
          <el-button link size="small" @click="clearAll" :disabled="!inputText">清空</el-button>
        </div>

        <el-input
          v-model="inputText"
          type="textarea"
          resize="none"
          :placeholder="direction === 'encode' ? '在此输入要编码的文本、参数值或完整 URL…' : '在此粘贴 URL 或 percent-encoding 字符串…'"
          class="input-box"
        />

        <div v-if="looksEncoded" class="tip">
          输入看起来已经过 URL 编码
          <el-button link size="small" class="tip-btn" @click="setDirection('decode')">切到解码 →</el-button>
        </div>
      </div>

      <!-- 输出 -->
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">输出</span>
          <span class="panel-stat">{{ result.meta }}</span>
          <span class="spacer" />
          <el-button link size="small" :disabled="!result.ok" @click="copyText(result.value)">复制</el-button>
        </div>

        <div v-if="result.error" class="error-box">{{ result.error }}</div>

        <template v-else-if="result.ok">
          <div class="out-box">{{ result.display || '（空）' }}</div>
          <div v-if="result.truncated" class="tip">内容较长，此处仅展示前 {{ MAX_DISPLAY }} 字符，复制为完整内容</div>
          <div v-else-if="result.note" class="tip">{{ result.note }}</div>
        </template>

        <div v-else class="out-box placeholder">结果会实时显示在这里</div>
      </div>
    </div>

    <!-- URL 结构解析 -->
    <div v-if="analysis" class="analysis">
      <div class="analysis-head">
        <span class="analysis-title">{{ analysis.parts.kind === 'url' ? 'URL 结构解析' : 'Query 参数解析' }}</span>
        <span v-if="analysis.fromDecoded" class="analysis-flag">基于解码结果</span>
        <span class="spacer" />
        <span class="analysis-hint">点击行可复制内容</span>
      </div>

      <div v-if="structureRows.length" class="part-rows">
        <div
          v-for="row in structureRows"
          :key="row.label"
          class="part-row"
          :title="'点击复制：' + row.value"
          @click="copyText(row.value)"
        >
          <span class="part-label">{{ row.label }}</span>
          <span class="part-value">{{ row.value || '（空）' }}</span>
        </div>
      </div>

      <template v-if="analysis.parts.params.length">
        <div class="params-title">
          查询参数（{{ analysis.parts.params.length }} 个）
        </div>
        <div class="param-table">
          <div class="param-row param-head">
            <span>参数名</span>
            <span>参数值</span>
          </div>
          <div
            v-for="(p, i) in analysis.parts.params"
            :key="i"
            class="param-row"
            :title="'点击复制参数值：' + p.value"
            @click="copyParam(p)"
          >
            <span class="param-key">
              {{ p.key || '（空）' }}
              <em v-if="p.keyError" class="param-err">{{ p.keyError }}</em>
            </span>
            <span class="param-value">
              {{ p.hasValue ? (p.value || '（空）') : '（无值）' }}
              <em v-if="p.valueError" class="param-err">{{ p.valueError }}，显示原始值</em>
            </span>
          </div>
        </div>
      </template>
      <div v-else-if="analysis.parts.kind === 'url'" class="tip">该 URL 不包含查询参数</div>
    </div>
  </div>
</template>

<style scoped>
.urlcodec-tool { padding: 12px; max-width: 760px; margin: 0 auto; font-size: 13px; }
h2 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
.desc { color: #909399; margin: 0 0 12px; font-size: 13px; }

.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.spacer { flex: 1; }
.opt-label { font-size: 12px; color: #909399; }
.swap-btn { color: #667eea; }
.toolbar :deep(.el-button.is-link) { color: #667eea; padding: 4px 6px; height: auto; font-size: 13px; }
.toolbar :deep(.el-button.is-link.is-disabled) { color: #c0c4cc; }

.panels { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.panel { display: flex; flex-direction: column; min-width: 0; }

.panel-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; min-height: 22px; }
.panel-title { font-size: 13px; font-weight: 500; color: #303133; }
.panel-stat { font-size: 11px; color: #909399; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel-head :deep(.el-button.is-link) { color: #667eea; padding: 2px 4px; height: auto; font-size: 12px; }
.panel-head :deep(.el-button.is-link.is-disabled) { color: #c0c4cc; }

.input-box :deep(.el-textarea__inner) {
  height: 232px;
  box-sizing: border-box;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.out-box { height: 232px; box-sizing: border-box; overflow: auto; padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e5e5); border-radius: 8px; background: var(--bg-card, #f5f7fa);
  font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-all; color: #303133; }
.out-box.placeholder { color: #c0c4cc; }

.error-box { min-height: 232px; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
  border: 1px solid #fde2e2; background: #fef0f0; color: #f56c6c; font-size: 13px; line-height: 1.6; }

.tip { margin-top: 5px; font-size: 11px; color: #909399; line-height: 1.5; word-break: break-all; }
.tip-btn { color: #667eea; font-size: 11px; padding: 0 2px; height: auto; vertical-align: baseline; }

.analysis { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 8px; background: var(--bg-card, #f5f7fa); }
.analysis-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.analysis-title { font-size: 13px; font-weight: 500; color: #303133; }
.analysis-hint { font-size: 11px; color: #909399; }
.analysis-flag { font-size: 11px; color: #667eea; border: 1px solid rgba(102, 126, 234, 0.4);
  border-radius: 3px; padding: 0 4px; line-height: 1.5; }

.part-rows { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.part-row { display: flex; align-items: baseline; gap: 8px; padding: 3px 6px; border-radius: 4px;
  cursor: pointer; }
.part-row:hover { background: rgba(102, 126, 234, 0.08); }
.part-label { flex: 0 0 36px; font-size: 12px; color: #909399; }
.part-value { font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; color: #303133;
  word-break: break-all; line-height: 1.5; }

.params-title { font-size: 12px; color: #909399; margin: 8px 0 4px; }
.param-table { border: 1px solid var(--border-color, #e5e5e5); border-radius: 6px; overflow: hidden;
  background: #fff; }
.param-row { display: grid; grid-template-columns: minmax(100px, 2fr) 3fr; gap: 10px;
  padding: 5px 10px; font-size: 12px; line-height: 1.5; cursor: pointer; }
.param-row + .param-row { border-top: 1px solid var(--border-color, #ebeef5); }
.param-row:hover { background: rgba(102, 126, 234, 0.08); }
.param-row.param-head { cursor: default; background: var(--bg-card, #f5f7fa); color: #909399;
  font-weight: 500; }
.param-row.param-head:hover { background: var(--bg-card, #f5f7fa); }
.param-key, .param-value { font-family: 'Consolas', 'Courier New', monospace; color: #303133;
  word-break: break-all; }
.param-err { font-style: normal; color: #f56c6c; font-size: 11px; margin-left: 4px; }

@media (prefers-color-scheme: dark) {
  h2 { color: #e0e0e0; }
  .desc, .opt-label, .tip, .params-title, .analysis-hint { color: #8a8a8a; }
  .panel-title { color: #e0e0e0; }
  .analysis-title { color: #e0e0e0; }
  .analysis-flag { color: #8ba4f7; border-color: rgba(139, 164, 247, 0.45); }
  .panel-stat { color: #8a8a8a; }
  .toolbar :deep(.el-button.is-link) { color: #8ba4f7; }
  .toolbar :deep(.el-button.is-link.is-disabled) { color: #666; }
  .swap-btn { color: #8ba4f7; }
  .panel-head :deep(.el-button.is-link) { color: #8ba4f7; }
  .panel-head :deep(.el-button.is-link.is-disabled) { color: #666; }
  .out-box, .analysis { background: #2c2c2c; border-color: #444; }
  .out-box { color: #d0d0d0; }
  .out-box.placeholder { color: #666; }
  .error-box { background: #2b1d1d; border-color: #4a2a2a; color: #f09595; }
  .tip-btn { color: #8ba4f7; }
  .part-row:hover { background: rgba(139, 164, 247, 0.12); }
  .part-label { color: #8a8a8a; }
  .part-value { color: #d0d0d0; }
  .param-table { border-color: #444; background: #242424; }
  .param-row + .param-row { border-top-color: #3a3a3a; }
  .param-row:hover { background: rgba(139, 164, 247, 0.12); }
  .param-row.param-head { background: #2c2c2c; color: #8a8a8a; }
  .param-row.param-head:hover { background: #2c2c2c; }
  .param-key, .param-value { color: #d0d0d0; }
  .param-err { color: #f09595; }
}

@media (max-width: 620px) {
  .panels { grid-template-columns: 1fr; }
}
</style>
