// LaTeX OCR 输出容错修复。
//
// 背景：RapidLaTeXOCR 等模型会输出结构上非法的 LaTeX，最常见的是
// 「双下标 / 双上标」（同一个原子重复挂 `_` / `^`），例如
//   {\Theta}^{j}\overline{{{\pi}}}_{\Phi}_{\Phi}_{\Phi}^{j}
// KaTeX 对此直接抛 "Double subscript"，导致预览完全无法渲染。
//
// 本模块在**渲染前**对源码做最小侵入修复：把同一原子上的重复脚本
// 用空组隔断（`x_a_b` -> `x_a{}_b`），保留全部内容且可正常渲染。
// 修复结果仅用于预览，不回写用户源码；合法 LaTeX 不受影响。

const SCRIPT_CHARS = new Set(['_', '^'])

function isEscaped(text, index) {
  let backslashes = 0
  let i = index - 1
  while (i >= 0 && text[i] === '\\') {
    backslashes += 1
    i -= 1
  }
  return backslashes % 2 === 1
}

// 从 start 起读出一个原子/脚本参数：花括号平衡组、控制序列，或单个字符。
// 返回 { end, text }。
function readGroup(text, start) {
  let i = start
  if (i >= text.length) return { end: i, text: '' }

  if (text[i] === '{') {
    const begin = i
    let depth = 0
    while (i < text.length) {
      const ch = text[i]
      if (ch === '\\') { i += 2; continue }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) { i += 1; break }
      }
      i += 1
    }
    return { end: i, text: text.slice(begin, i) }
  }

  if (text[i] === '\\') {
    const begin = i
    i += 1
    if (i < text.length && /[a-zA-Z]/.test(text[i])) {
      while (i < text.length && /[a-zA-Z]/.test(text[i])) i += 1
    } else {
      i += 1
    }
    return { end: i, text: text.slice(begin, i) }
  }

  return { end: i + 1, text: text.slice(i, i + 1) }
}

// 合并同一原子上的重复脚本。
// 一个原子最多只能有一个下标 + 一个上标；OCR 模型常输出 `x_a_b`（双下标）
// 或 `x^a_b_c`（上标后又挂两个下标）。这里用一个 atom 状态位跟踪当前原子
// 已用过的脚本类型，重复时插入空组 `{}` 隔断 —— 合法且能完整保留内容。
export function sanitizeLatexForRender(input) {
  const text = String(input || '')
  let out = ''
  let i = 0
  let atomSub = false // 当前原子已用下标
  let atomSup = false // 当前原子已用上标

  const resetAtom = () => { atomSub = false; atomSup = false }

  while (i < text.length) {
    const ch = text[i]

    // 控制序列整体透传，并重置原子状态
    if (ch === '\\') {
      const { end, text: cmd } = readGroup(text, i)
      out += cmd
      i = end
      resetAtom()
      continue
    }

    // 遇到 `_` / `^`：读出其参数
    if (SCRIPT_CHARS.has(ch) && !isEscaped(text, i)) {
      const { end, text: arg } = readGroup(text, i + 1)
      if (!arg) { out += ch; i += 1; continue }
      const isSub = ch === '_'
      const used = isSub ? atomSub : atomSup
      if (used) {
        out += '{}' // 该原子已用过同类脚本 → 空组隔断
        resetAtom()
      }
      out += `${ch}${arg}`
      if (isSub) atomSub = true
      else atomSup = true
      i = end
      continue
    }

    // 其他字符透传；进入新分组/新原子时重置状态
    out += ch
    i += 1
    if (ch === '{' || ch === '}' || /\s/.test(ch)) resetAtom()
    else resetAtom()
  }

  return out
}

export default sanitizeLatexForRender
