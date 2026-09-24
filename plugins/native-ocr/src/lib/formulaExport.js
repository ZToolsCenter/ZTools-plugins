// 公式识别纯函数模块 —— App.vue 与 tests/run.mjs 共用（P2-8 从 App.vue 拆出）
// 置信度分级 / 导出文本构建均为纯函数，不触碰 DOM 与 Vue 状态。

// 置信度可视化：decodeScore 为解码器长度归一平均对数概率（越接近 0 越可信）。
// 分级：≥ -0.35 高（绿）；-0.35 ~ -0.8 中（橙）；< -0.8 低（红）；无分数返回 null 不显示。
export const CONF_HIGH_MIN = -0.35
export const CONF_MID_MIN = -0.8

export function formulaScoreLevel(item) {
  const raw = item && item.decodeScore
  // 注意 Number(null) === 0，null/undefined 必须先排除，否则无分数会被误判为「高」。
  if (raw == null) return null
  const s = Number(raw)
  if (!Number.isFinite(s)) return null
  if (s >= CONF_HIGH_MIN) return { label: '高', cls: 'conf-high', tip: `解码置信度 ${s.toFixed(3)}（高）` }
  if (s >= CONF_MID_MIN) return { label: '中', cls: 'conf-mid', tip: `解码置信度 ${s.toFixed(3)}（中，建议核对）` }
  return { label: '低', cls: 'conf-low', tip: `解码置信度 ${s.toFixed(3)}（低，可能不准，可重识别或手改）` }
}

// 从公式项列表提取可导出的 latex（去空、trim，保持原顺序）。
export function formulaExportLatexList(items) {
  const list = Array.isArray(items) ? items : []
  return list
    .filter((i) => i && !i.excluded)
    .map((i) => String(i.latex || '').trim())
    .filter(Boolean)
}

// .tex 导出文本：每条一行 LaTeX，空行分隔。
export function buildFormulaTexExport(items) {
  return formulaExportLatexList(items).join('\n\n')
}

// .md 导出文本：每条独立公式块 $$…$$。
export function buildFormulaMdExport(items) {
  return formulaExportLatexList(items).map((latex) => `$$\n${latex}\n$$`).join('\n\n')
}

// 历史记录批量导出文本：formatTime/engineLabel 由调用方注入，保持本模块无 DOM 依赖。
export function buildHistoryExportText(items, { engineLabel, formatTime }) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return ''
  return list
    .map((item) => `=== ${engineLabel(item)} · ${formatTime(item.ts)} ===\n${item.text || '(未识别到文字)'}`)
    .join('\n\n')
}
