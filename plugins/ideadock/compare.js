// ==================== 文本对比（PyCharm 式左右对齐 diff）====================
// 从 app.js 抽出。依赖 app.js 提供的全局：$ / storeGet / storeSet /
// clipboardOpen / closeClipboard / updateEditorGridLayout / pushUndo /
// currentState / updateCount / persistCurrent / updateSplitHandle /
// setLangPanel，以及外部 Diff(jsdiff)。故必须在 app.js 之后加载。
// 顶层注册 btn-compare 事件 + 编辑态 IIFE，依赖 DOM 元素已在 body 中。

let compareOpen = false
let compareEditing = false
let compareText = ''   // 右侧对比文本（仅用于对比，不影响导出/标题）
const CMP_W_KEY = 'ideadock.compareLeftWidth'
const CMP_W_RATIO_KEY = 'ideadock.compareLeftWidthRatio'

function compareWidthFromRatio(total) {
  const ratio = parseFloat(storeGet(CMP_W_RATIO_KEY))
  if (ratio > 0) return Math.round(total * Math.max(0.2, Math.min(0.8, ratio)))
  const saved = parseInt(storeGet(CMP_W_KEY), 10)
  return saved > 0 ? saved : 0
}

function applyCompareWidth() {
  const cols = document.querySelector('.compare-cols')
  if (!cols) return
  const total = cols.getBoundingClientRect().width
  const raw = compareWidthFromRatio(total)
  const fixedFlex = raw > 0 ? `0 0 ${Math.max(80, Math.min(total - 80, raw))}px` : ''
  $('compare-left').style.flex = fixedFlex
  $('compare-edit-left').style.flex = fixedFlex
}
function escHtmlDiff(s) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

let cmpSegs = []   // 最近一次对比的段模型，供块替换使用

// 把 jsdiff 结果归并成段：equal（公共行）/ change（连续增删块，含 rem/add）
function buildSegs(leftStr, rightStr) {
  const parts = Diff.diffLines(leftStr, rightStr)
  const toLines = v => {
    const a = v.split('\n')
    if (a.length && a[a.length - 1] === '') a.pop()
    return a
  }
  const segs = []
  let id = 0
  for (let i = 0; i < parts.length;) {
    const p = parts[i]
    if (!p.added && !p.removed) {
      segs.push({ type: 'equal', lines: toLines(p.value) }); i++
    } else {
      let rem = [], add = []
      while (i < parts.length && (parts[i].added || parts[i].removed)) {
        if (parts[i].removed) rem = rem.concat(toLines(parts[i].value))
        else add = add.concat(toLines(parts[i].value))
        i++
      }
      segs.push({ type: 'change', id: id++, rem, add })
    }
  }
  return segs
}

// 段 → 左/右/中三栏等长行；差异行错位排列；每个 change 块在其中部行挂一对箭头
function segsToRows(segs) {
  const left = [], right = [], mid = []
  let ln = 1, rn = 1
  for (const seg of segs) {
    if (seg.type === 'equal') {
      for (const t of seg.lines) { left.push({ n: ln++, t, c: '' }); right.push({ n: rn++, t, c: '' }); mid.push({}) }
    } else {
      const start = left.length
      for (const t of seg.rem) { left.push({ n: ln++, t, c: 'diff-removed' }); right.push({ gap: true }); mid.push({}) }
      for (const t of seg.add) { left.push({ gap: true }); right.push({ n: rn++, t, c: 'diff-added' }); mid.push({}) }
      const h = seg.rem.length + seg.add.length
      mid[start + Math.floor((h - 1) / 2)] = { arr: seg.id }   // 块中部行放箭头
    }
  }
  return { left, right, mid }
}

function diffRowHtml(r) {
  if (r.gap) return '<div class="diff-line diff-gap"><span class="diff-ln"></span><span class="diff-tx"></span></div>'
  return `<div class="diff-line ${r.c}"><span class="diff-ln">${r.n}</span><span class="diff-tx">${escHtmlDiff(r.t) || ' '}</span></div>`
}

function midRowHtml(r) {
  if (r.arr == null) return '<div class="diff-line diff-mid"></div>'
  return `<div class="diff-line diff-mid"><span class="diff-arrows">` +
    `<button class="diff-arrow" data-blk="${r.arr}" data-dir="l2r" title="用左块覆盖右块">→</button>` +
    `<button class="diff-arrow" data-blk="${r.arr}" data-dir="r2l" title="用右块覆盖左块">←</button></span></div>`
}

function renderCompare() {
  if (typeof Diff === 'undefined') return
  cmpSegs = buildSegs($('editor').value, compareText)
  const { left, right, mid } = segsToRows(cmpSegs)
  $('compare-left').innerHTML = left.map(diffRowHtml).join('')
  $('compare-right').innerHTML = right.map(diffRowHtml).join('')
  $('compare-mid').innerHTML = mid.map(midRowHtml).join('')
}

// 整块覆盖：l2r 用左块内容覆盖右块，r2l 反之；改完写回并重渲染
function applyCompareChunk(id, dir) {
  const seg = cmpSegs.find(s => s.type === 'change' && s.id === id)
  if (!seg) return
  pushUndo(currentState())   // 改主编辑器前记录，支持 Ctrl+Z 撤销
  if (dir === 'l2r') seg.add = seg.rem.slice()
  else seg.rem = seg.add.slice()
  const collect = key => {
    const out = []
    for (const s of cmpSegs) out.push(...(s.type === 'equal' ? s.lines : s[key]))
    return out.join('\n')
  }
  $('editor').value = collect('rem')   // 左侧写回主编辑器（导出/行号/字数以左为准）
  compareText = collect('add')
  updateCount(); persistCurrent()
  renderCompare()
}

function openCompare() {
  if (clipboardOpen) closeClipboard()
  compareOpen = true
  $('editor-grid').style.display = 'none'
  $('col-resize-handle').style.display = 'none'
  ;['python-output-panel', 'js-output-panel', 'md-preview-panel', 'csv-preview-panel', 'html-preview-panel', 'ai-panel']
    .forEach(id => $(id).style.display = 'none')
  if ($('btn-ai')) $('btn-ai').classList.remove('active')
  if (window.markAiPanelClosed) window.markAiPanelClosed()
  $('compare-panel').style.display = ''
  updateEditorGridLayout()
  // 复位为对比态（渲染栏可见、两个编辑盒子隐藏）
  compareEditing = false
  $('compare-panel').classList.remove('editing')
  $('compare-edit-left').style.display = 'none'
  $('compare-edit-right').style.display = 'none'
  $('compare-left').style.display = ''
  $('compare-right').style.display = ''
  $('compare-mid').style.display = ''
  applyCompareWidth()
  $('btn-compare').classList.add('active')
  renderCompare()
}

function closeCompare(opts = {}) {
  if (!compareOpen) return
  // 关闭前若在编辑态，提交左右内容
  if (compareEditing) {
    $('editor').value = $('compare-input-left').value
    compareText = $('compare-input').value
    updateCount(); persistCurrent()
    compareEditing = false
  }
  compareOpen = false
  $('compare-panel').classList.remove('editing')
  $('compare-edit-left').style.display = 'none'
  $('compare-edit-right').style.display = 'none'
  $('compare-panel').style.display = 'none'
  $('btn-compare').classList.remove('active')
  $('editor-grid').style.display = ''
  updateEditorGridLayout()
  if (opts.restorePanel === false) updateSplitHandle()
  else setLangPanel($('lang-select').value)
}

$('btn-compare').addEventListener('click', () => {
  compareOpen ? closeCompare() : openCompare()
})

// 点击任一栏 → 暂停对比、左右都变可编辑文本框；焦点离开两个文本框 → 提交并恢复对比
;(() => {
  const lc = $('compare-left'), rc = $('compare-right'), mc = $('compare-mid')
  const lb = $('compare-edit-left'), rb = $('compare-edit-right')   // 编辑盒子
  const lt = $('compare-input-left'), rt = $('compare-input')       // 文本框
  const lnL = $('compare-ln-left'), lnR = $('compare-ln-right')     // 行号栏

  function cmpLineNums(ta, lnEl) {
    const n = ta.value === '' ? 1 : ta.value.split(/\r?\n/).length
    const out = []
    for (let i = 1; i <= n; i++) out.push(i)
    lnEl.textContent = out.join('\n')
  }

  function enterEdit(focusEl) {
    if (!compareEditing) {
      compareEditing = true
      lt.value = $('editor').value
      rt.value = compareText
      cmpLineNums(lt, lnL); cmpLineNums(rt, lnR)
      lc.style.display = 'none'; rc.style.display = 'none'; mc.style.display = 'none'
      lb.style.display = ''; rb.style.display = ''
      $('compare-panel').classList.add('editing')
    }
    ;(focusEl || rt).focus()
  }
  function exitEdit() {
    if (!compareEditing) return
    compareEditing = false
    $('editor').value = lt.value      // 左侧写回主编辑器（导出/行号/字数/槽位仍以左为准）
    compareText = rt.value
    updateCount(); persistCurrent()
    lb.style.display = 'none'; rb.style.display = 'none'
    $('compare-panel').classList.remove('editing')
    lc.style.display = ''; rc.style.display = ''; mc.style.display = ''
    renderCompare()
  }

  lc.addEventListener('click', () => enterEdit(lt))
  rc.addEventListener('click', () => enterEdit(rt))
  // 中间栏箭头：整块覆盖（点空白处不进编辑态）
  mc.addEventListener('click', e => {
    const btn = e.target.closest('.diff-arrow')
    if (btn) applyCompareChunk(+btn.dataset.blk, btn.dataset.dir)
  })

  // 行号随输入更新、随滚动同步
  lt.addEventListener('input', () => cmpLineNums(lt, lnL))
  rt.addEventListener('input', () => cmpLineNums(rt, lnR))
  lt.addEventListener('scroll', () => lnL.scrollTop = lt.scrollTop)
  rt.addEventListener('scroll', () => lnR.scrollTop = rt.scrollTop)

  // 焦点在两个文本框之间切换不退出；移出去才提交恢复对比
  const onFocusOut = e => { if (e.relatedTarget !== lt && e.relatedTarget !== rt) exitEdit() }
  lt.addEventListener('focusout', onFocusOut)
  rt.addEventListener('focusout', onFocusOut)

  // 纵向滚动同步（各栏独立横滚，纵向对齐）
  let cmpSyncing = false
  const sync = (src, dst) => src.addEventListener('scroll', () => {
    if (cmpSyncing) return
    cmpSyncing = true
    dst.scrollTop = src.scrollTop
    cmpSyncing = false
  })
  sync(lc, rc); sync(rc, lc); sync(lt, rt); sync(rt, lt)
  sync(lc, mc); sync(rc, mc)   // 中间箭头栏跟随纵向滚动

  // 拖拽调整左右宽度（手柄复用 col-resize-handle 样式）
  const handle = $('compare-resize')
  const cols = document.querySelector('.compare-cols')
  handle.addEventListener('mousedown', e => {
    e.preventDefault()
    const startX = e.clientX
    const startW = (compareEditing ? lb : lc).getBoundingClientRect().width
    handle.classList.add('dragging')
    function onMove(ev) {
      const total = cols.getBoundingClientRect().width
      const w = Math.max(80, Math.min(total - 80, startW + ev.clientX - startX))
      lc.style.flex = `0 0 ${w}px`
      lb.style.flex = `0 0 ${w}px`
      storeSet(CMP_W_KEY, Math.round(w))
      storeSet(CMP_W_RATIO_KEY, String(w / total))
    }
    function onUp() {
      handle.classList.remove('dragging')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
})()
