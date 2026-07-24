// Calculator and function plot panel
// Eval: math.js; plot: JSXGraph.
;(function () {
  'use strict'

  const $ = id => document.getElementById(id)
  const app = () => $('app')

  // ---------- 闂傚倸鍊搁崐鎼佹偋閸曨垰鍨傞柛婵嗗閻斿棙淇婇娆掝劅闁搞倖娲熼弻宥堫檨闁告挾鍠庨悾鐑藉Ψ閳轰線鍞跺銈嗗笒閸婂藝閳哄倻绠鹃柟瀵稿仦鐏忣厽绻涚€电鍘寸€殿噮鍋呴妶锝夊礃閵娧囩崜濠电姰鍨煎▔娑㈠箺濠婂牊顥夌€广儱顦伴悡娑㈡煕鐏炰箙顏堝礉閻㈢數纾奸弶鍫涘妿缁犵偟鈧娲橀〃鍡楊焽韫囨稑鐓涢柛灞剧⊕椤撳綊姊绘担鍛婂暈闁荤喆鍎靛畷顖炲垂椤旂偓娈鹃梺鍦濠㈡绮堝畝鍕厽婵﹩鍓﹂崵鐔虹磼閳?----------
  function isCalcOpen() { return app().classList.contains('calc-open') }

  function openCalcBoard() {
    if (typeof closeSketchBoard === 'function' && app().classList.contains('sketch-open')) {
      closeSketchBoard()
    }
    if (window.closeClipboard) window.closeClipboard()
    app().classList.add('calc-open')
    $('btn-calc-board').classList.add('active')
    refreshCalcPanelLayout()
    if (activeTab === 'plot') requestAnimationFrame(() => { ensureBoard(); refreshCalcPlotLayout() })
    requestAnimationFrame(syncCalcScrollArea)
    $('calc-input').focus()
  }

  function closeCalcBoard() {
    stopAnim()
    app().classList.remove('calc-open')
    $('btn-calc-board').classList.remove('active')
  }
  window.closeCalcBoard = closeCalcBoard  // 婵?sketch.js 闂傚倷鑳堕幊鎾绘倶濮樿泛绠伴柛婵勫劜椤洟鏌熸潏楣冩闁稿鍔庣槐鎾存媴閼测剝鍨瑰▎銏ゅ蓟閵夛妇鍘搁梺鍛婂姀閺呮盯宕濋崼鏇熺厽闁靛ě鍐╃亪闂?
  $('btn-calc-board').addEventListener('click', () => {
    isCalcOpen() ? closeCalcBoard() : openCalcBoard()
  })
  $('btn-calc-collapse').addEventListener('click', closeCalcBoard)

  // ---------- Tab 闂傚倷绀侀幉锛勬暜閹烘嚚娲晝閳ь剟鎮鹃悜钘夎摕闁靛闄勫▍鏍⒑閸撴彃浜栭柛搴㈠絻椤╁ジ濡搁埡鍌滃幐?/ 闂傚倷鐒﹂惇褰掑垂婵傚壊鏁嬬憸宥夋箒濠殿喗銇涢崑鎾绘煛?----------
  let activeTab = 'keypad'
  function switchCalcTab(name) {
    activeTab = name
    $('calc-panel').classList.toggle('plot-active', name === 'plot')
    document.querySelectorAll('.calc-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.calcTab === name)
    })
    $('calc-pane-keypad').classList.toggle('active', name === 'keypad')
    $('calc-pane-plot').classList.toggle('active', name === 'plot')
    refreshCalcPanelLayout()
    if (name === 'plot') {
      requestAnimationFrame(() => { ensureBoard(); refreshCalcPlotLayout() })
    } else {
      $('calc-input').focus()
    }
    requestAnimationFrame(syncCalcScrollArea)
  }
  document.querySelectorAll('.calc-tab').forEach(t => {
    t.addEventListener('click', () => switchCalcTab(t.dataset.calcTab))
  })

  // ---------- 闂備浇宕垫慨宕囨閵堝洦顫曢柡鍥ュ灪閸嬧晛鈹戦悩宕囶暡闁绘挶鍎查妵鍕籍閸屾矮澹曠紒?----------
  function insertAtCursor(text, back) {
    const ta = $('calc-input')
    const s = ta.selectionStart, e = ta.selectionEnd
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e)
    const pos = s + text.length - (back || 0)
    ta.selectionStart = ta.selectionEnd = pos
    ta.focus()
    evalAll()
  }

  function syncCalcScrollArea() {
    const io = $('calc-input').parentElement
    const ta = $('calc-input')
    const out = $('calc-results')
    const top = io.scrollTop
    ta.style.height = 'auto'
    out.style.minHeight = ''
    const h = Math.max(io.clientHeight, ta.scrollHeight, out.scrollHeight)
    ta.style.height = h + 'px'
    out.style.minHeight = h + 'px'
    io.scrollTop = top
  }

  $('calc-keypad').addEventListener('click', ev => {
    const btn = ev.target.closest('.calc-key')
    if (!btn) return
    const act = btn.dataset.act
    if (act === 'clear') {
      $('calc-input').value = ''; $('calc-input').focus(); evalAll(); return
    }
    if (act === 'back') {
      const ta = $('calc-input')
      const s = ta.selectionStart, e = ta.selectionEnd
      if (s === e && s > 0) {
        ta.value = ta.value.slice(0, s - 1) + ta.value.slice(e)
        ta.selectionStart = ta.selectionEnd = s - 1
      } else {
        ta.value = ta.value.slice(0, s) + ta.value.slice(e)
        ta.selectionStart = ta.selectionEnd = s
      }
      ta.focus(); evalAll(); return
    }
    if (btn.dataset.ins != null) {
      insertAtCursor(btn.dataset.ins, parseInt(btn.dataset.caret || '0', 10))
    }
  })

  // ---------- 闂備浇宕垫慨宕囨閵堝洦顫曢柡鍥ュ灪閸嬧晛鈹戦悩瀹犲闂傚偆鍨堕弻鏇熺節韫囨搩娲┑鐘亾闁圭虎鍠楅悡?----------
  // scope 闂傚倷绶氬鑽ゆ嫻閻旂厧绀夌€广儱顦伴崕濠囨煃閵夛附鐏遍柡瀣叄閺屽秹鍩℃担鍛婃濠电姭鍋撻柟缁㈠枟閻撴洖鈹戦悩鎻掆偓鎼佸箖閹寸偘绻嗛柣鎰絻閳ь剙娼″鑽や沪缁涘鎮戦梺鍛婁緱閸ㄨ櫕寰勯崟顖涒拺闁圭娴烽埥澶愭煟椤撴繄绐旈柕鍡曠窔楠炲鏁傜憴锝嗗闂備礁鎼ˇ浼村垂閻㈠灚濯奸柤纰卞厴閸嬫挸鈻撻崹顔界亶濠电偛寮剁划鎾愁嚕椤愶箑围濠㈣泛锕﹂ˇ顓㈡倵楠炲灝鍔氭い锔芥緲椤╁ジ濡搁埡鍌氣偓鐢告偡濞嗗繐顏柣鎿冨灣缁辨帡鎮╅棃娑欑亪闂佽鍨伴崯鏉戠暦閻旂⒈鏁冮柕蹇嬪灮琚﹂梻?/ 闂傚倷绀侀幉锟犲垂閸忓吋鍙忛柕鍫濐槸濮?
  let scope = {}
  let numMode = 'dec'    // 'dec'=小数 | 'frac'=分数
  let angleMode = 'rad'  // 'rad'=弧度 | 'deg'=角度
  const DEG = Math.PI / 180

  // 角度模式：把三角函数换成度数版本，注入 scope 覆盖 math.js 内置（默认弧度）
  function degScope() {
    return {
      sin: x => Math.sin(x * DEG), cos: x => Math.cos(x * DEG), tan: x => Math.tan(x * DEG),
      asin: x => Math.asin(x) / DEG, acos: x => Math.acos(x) / DEG, atan: x => Math.atan(x) / DEG
    }
  }

  function formatVal(v) {
    try {
      // 分数模式：仅对有限实数转分数；整数不带 /1，数组/复数等仍走常规
      if (numMode === 'frac' && typeof v === 'number' && Number.isFinite(v)) {
        try {
          const f = math.fraction(v)
          const d = f.d.toString()
          return (v < 0 ? '-' : '') + f.n.toString() + (d === '1' ? '' : '/' + d)
        } catch (e) {}
      }
      return math.format(v, { precision: 12 })
    } catch (e) { return String(v) }
  }

  // ---------- 结果显示模式：小数/分数、弧度/角度（分段选择器，放在状态声明之后避免 TDZ） ----------
  function setSegActive(groupId, val) {
    $(groupId).querySelectorAll('.calc-seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.val === val)
    })
  }
  function updateModeButtons() {
    setSegActive('calc-num-mode', numMode)
    setSegActive('calc-angle-mode', angleMode)
  }
  $('calc-num-mode').addEventListener('click', ev => {
    const b = ev.target.closest('.calc-seg-btn')
    if (!b || b.dataset.val === numMode) return
    numMode = b.dataset.val
    updateModeButtons(); evalAll(); $('calc-input').focus()
  })
  $('calc-angle-mode').addEventListener('click', ev => {
    const b = ev.target.closest('.calc-seg-btn')
    if (!b || b.dataset.val === angleMode) return
    angleMode = b.dataset.val
    updateModeButtons(); evalAll(); $('calc-input').focus()
  })
  updateModeButtons()

  function splitTopLevelColon(s) {
    const parts = []
    let depth = 0, start = 0
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
      else if (ch === ':' && depth === 0) {
        parts.push(s.slice(start, i).trim())
        start = i + 1
      }
    }
    if (!parts.length) return null
    parts.push(s.slice(start).trim())
    return parts
  }

  function canStartRangeLiteral(expr, bracketIndex) {
    for (let i = bracketIndex - 1; i >= 0; i--) {
      const ch = expr[i]
      if (/\s/.test(ch)) continue
      return '=([{,+-*/%^?:'.includes(ch)
    }
    return true
  }

  function evalRangePart(part, fallback, localScope) {
    if (part === '') return fallback
    const n = toNumber(math.evaluate(part, localScope))
    if (!Number.isFinite(n)) throw new Error('range part is not finite: ' + part)
    return n
  }

  function buildPythonRangeLiteral(body, localScope) {
    const parts = splitTopLevelColon(body)
    if (!parts || parts.length < 2 || parts.length > 3) return null
    if (parts.length === 2 && parts[0] === '' && parts[1] === '') return null
    if (parts.length === 3 && parts[0] === '' && parts[1] === '' && parts[2] === '') return null
    const stepFallback = 1
    const step = evalRangePart(parts[2] || '', stepFallback, localScope)
    if (step === 0) throw new Error('range step cannot be 0')
    const stop = evalRangePart(parts[1], 0, localScope)
    const start = evalRangePart(parts[0], step > 0 ? 0 : stop - 1, localScope)
    const out = []
    const limit = 20000
    if (step > 0) {
      for (let v = start; v < stop; v += step) {
        out.push(v)
        if (out.length > limit) throw new Error('range literal is too large')
      }
    } else {
      for (let v = start; v > stop; v += step) {
        out.push(v)
        if (out.length > limit) throw new Error('range literal is too large')
      }
    }
    return '[' + out.join(',') + ']'
  }

  function expandPythonRangeLiterals(expr, localScope = scope) {
    let out = ''
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] !== '[' || !canStartRangeLiteral(expr, i)) {
        out += expr[i]
        continue
      }
      let depth = 1, end = -1
      for (let j = i + 1; j < expr.length; j++) {
        const ch = expr[j]
        if (ch === '[') depth++
        else if (ch === ']') {
          depth--
          if (depth === 0) { end = j; break }
        }
      }
      if (end === -1) {
        out += expr[i]
        continue
      }
      const body = expr.slice(i + 1, end)
      const expanded = buildPythonRangeLiteral(body, localScope)
      if (expanded == null) out += expr.slice(i, end + 1)
      else out += expanded
      i = end
    }
    return out
  }

  function evalAll() {
    scope = angleMode === 'deg' ? degScope() : {}
    const lines = $('calc-input').value.split('\n')
    const out = $('calc-results')
    out.innerHTML = ''
    for (const raw of lines) {
      const line = raw.trim()
      const div = document.createElement('div')
      div.className = 'calc-result-line'
      if (line === '') {
        div.classList.add('muted'); div.innerHTML = '&nbsp;'
      } else if (line.startsWith('#') || line.startsWith('//')) {
        div.classList.add('muted'); div.textContent = line
      } else if (/^y\s*=/.test(line)) {
        div.classList.add('muted'); div.textContent = line + '  -> plot'
      } else if (splitTopPair(line)) {
        div.classList.add('muted'); div.textContent = line + '  -> point'
      } else {
        try {
          const val = math.evaluate(expandPythonRangeLiterals(line), scope)
          if (val === undefined || (val && Array.isArray(val.entries) && val.entries.length === 0)) {
            div.classList.add('muted'); div.innerHTML = '&nbsp;'
          } else if (typeof val === 'function') {
            div.classList.add('muted'); div.textContent = 'defined'
          } else {
            div.textContent = '= ' + formatVal(val)
          }
        } catch (e) {
          div.classList.add('err'); div.textContent = 'Error ' + (e.message || e)
        }
      }
      out.appendChild(div)
    }
    syncCalcScrollArea()
  }

  // ---------- 闂傚倷绀侀幉锟犲垂閸忓吋鍙忛柕鍫濐槸濮规煡鏌ｉ弮鍥仩缁炬儳鍚嬫穱濠囶敍濠婂啫濡虹紓?----------
  let board = null
  let boardReady = false
  let plotObjs = []
  let animTimer = null
  let calcLayoutRaf = 0
  let calcLayoutTimer = 0
  const PALETTE = ['#2f9e44', '#1971c2', '#e8590c', '#9c36b5', '#e03131', '#0c8599', '#f08c00', '#5c7cfa']

  function boardSize() {
    const el = $('calc-board')
    syncBoardElementBox()
    return [el.clientWidth, el.clientHeight]
  }

  function syncBoardElementBox() {
    const el = $('calc-board')
    if (!el || !isCalcOpen()) return
    const target = Math.floor(calcBoardTargetSize())
    if (!target || target < 1) return
    const rect = el.getBoundingClientRect()
    if (Math.abs(rect.width - target) > 1 || Math.abs(rect.height - target) > 1) {
      el.style.width = target + 'px'
      el.style.height = target + 'px'
      el.style.flexBasis = target + 'px'
    }
    // 只取画板的直接子 svg/canvas（主绘图层）；导航控件按钮内部也有 svg 图标，
    // 若一并强制放大会把右下角的缩放/归位导航条撑坏而“消失”。
    el.querySelectorAll(':scope > svg, :scope > canvas').forEach(svg => {
      svg.setAttribute('width', String(target))
      svg.setAttribute('height', String(target))
      svg.style.width = target + 'px'
      svg.style.height = target + 'px'
    })
  }

  function outerHeight(el, fallback = 0) {
    if (!el) return fallback
    const rect = el.getBoundingClientRect()
    if (!rect.height) return fallback
    const cs = getComputedStyle(el)
    return rect.height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
  }

  function calcBoardTargetSize() {
    const panel = $('calc-panel')
    if (!panel) return 0
    const max = window.innerWidth - 56
    const min = Math.min(280, Math.max(220, max))
    const panelH = panel.clientHeight || window.innerHeight
    const headerH = outerHeight(document.querySelector('.calc-header'), 34)
    const evalH = outerHeight(document.querySelector('.calc-eval'), panelH * 0.24)
    const tabsH = outerHeight(document.querySelector('.calc-tabs'), 31)
    const plotHeadH = outerHeight(document.querySelector('.calc-plot-head'), 32)
    // 画图后图例会占高度，必须计入，否则画板被整体下推、底部导航条被挤出可视区裁掉而“消失”
    const legendH = outerHeight(document.querySelector('.calc-legend'), 0)
    const available = Math.max(240, panelH - headerH - evalH - tabsH - plotHeadH - legendH)
    return Math.max(min, Math.min(max, available))
  }

  function syncCalcPanelRatioForPlot() {
    if (!isCalcOpen()) return
    const w = calcBoardTargetSize()
    const panel = $('calc-panel')
    if (w > 0 && Math.abs(panel.getBoundingClientRect().width - w) > 1) {
      panel.style.width = Math.round(w) + 'px'
    }
  }

  function syncCalcLayoutNow() {
    if (!isCalcOpen()) return
    syncCalcPanelRatioForPlot()
    syncBoardElementBox()
    syncCalcScrollArea()
    if (activeTab === 'plot') {
      ensureBoard()
      syncBoardGeometry()
    }
  }

  function queueCalcLayoutRefresh(trailing = false) {
    if (!isCalcOpen()) return
    if (calcLayoutRaf) cancelAnimationFrame(calcLayoutRaf)
    calcLayoutRaf = requestAnimationFrame(() => {
      calcLayoutRaf = 0
      syncCalcLayoutNow()
      requestAnimationFrame(syncCalcLayoutNow)
    })
    if (trailing) {
      clearTimeout(calcLayoutTimer)
      calcLayoutTimer = setTimeout(syncCalcLayoutNow, 180)
    }
  }

  function refreshCalcPanelLayout() {
    queueCalcLayoutRefresh(true)
  }

  function calcPlotBox(w, h) {
    const xHalf = 10
    const yHalf = xHalf * (h || 1) / (w || 1)
    return [-xHalf, yHalf, xHalf, -yHalf]
  }

  function syncBoardGeometry() {
    syncCalcPanelRatioForPlot()
    syncBoardElementBox()
    const [w, h] = boardSize()
    if (!board || !w || !h) return
    // 画板恒为正方形，resizeContainer 默认保持当前 boundingbox，容器缩放时坐标轴
    // 自动适应且不变形；不再强制 setBoundingBox，否则会把用户的平移/缩放视图还原。
    board.resizeContainer(w, h)
    board.fullUpdate()
  }

  function refreshCalcPlotLayout() {
    if (!isCalcOpen() || activeTab !== 'plot') return
    queueCalcLayoutRefresh(true)
  }
  window.refreshCalcPlotLayout = refreshCalcPlotLayout

  function ensureBoard() {
    if (boardReady) {
      syncBoardGeometry()
      return
    }
    if (typeof JXG === 'undefined') return
    const [w, h] = boardSize()
    if (!w || !h) return
    board = JXG.JSXGraph.initBoard('calc-board', {
      boundingbox: calcPlotBox(w, h),
      axis: true,
      showCopyright: false,
      showNavigation: true,
      keepaspectratio: false,
      pan: { enabled: true, needShift: false, needTwoFingers: false },
      zoom: { wheel: true, needShift: false, pinch: true }
    })
    boardReady = true
    syncBoardGeometry()
  }

  function toNumber(r) {
    if (typeof r === 'number') return r
    if (r && typeof r.re === 'number') return r.re   // 婵犵數濮伴崹鐓庘枖濞戞氨鐭撻柣銏㈩焾濮规煡鏌ｉ弮鍌氬付闁活厽顨婇弻鈥崇暤椤斿吋鍣烘繝銏＄墵濮?    return NaN
  }

  function flashDrawError(msg) {
    const label = $('calc-anim-label')
    label.textContent = '闂?' + msg
    label.classList.add('err')
    setTimeout(() => { label.classList.remove('err') }, 2200)
  }

  function stopAnim() {
    if (animTimer) { clearInterval(animTimer); animTimer = null }
  }

  function clearPlotObjects() {
    if (board) plotObjs.forEach(o => { try { board.removeObject(o) } catch (e) {} })
    plotObjs = []
  }

  function clearPlot() {
    stopAnim()
    clearPlotObjects()
    if (board) board.update()
    renderLegend([])
    $('calc-anim-label').textContent = ''
    $('calc-anim-label').classList.remove('err')
    // 图例清空后画板可恢复大尺寸，重算一次
    refreshCalcPlotLayout()
  }

  // 闂?math.js 闂傚倷鐒﹂惇褰掑礉瀹€鈧埀顒佸嚬閸欏啫顕ｉ幎鑺ュ亜闁惧繐婀遍敍?闂傚倷鐒﹀鍧楀储閹间礁鐤鹃柣妯哄棘閻旂厧鐒垫い鎺戝閻撴洖鈹戦悩鎻掆偓鎼佸箖閹达附鐓欓悹鍥囧懐鐦堥梺缁樹緱閸ｏ綁骞栬ぐ鎺濇晝闁靛浚婢€濞村嘲鈹戦悙鏉戠仸闁瑰憡鎸冲畷鎴﹀箻閸撲胶锛?JS 闂傚倷娴囧銊╂倿閿旂晫鐝堕柛鈩冪懃閸ㄦ繄鈧箍鍎遍ˇ浼村疾椤掍胶绠鹃柟瀛樼懃閻忣亜鈹戦鐣岀煉闁哄备鍓濋幏鍛存偡闁附顥嬬紓鍌欑贰閸犳牜绮旈棃娑辩劷濠电姵鑹惧Λ姗€鏌熺粙鎸庢崳妞?null
  function asArray(v) {
    if (Array.isArray(v)) return v
    if (v && v.isMatrix && typeof v.toArray === 'function') return v.toArray()
    return null
  }

  function referencesX(node) {
    let has = false
    node.traverse(n => { if (n.isSymbolNode && n.name === 'x') has = true })
    return has
  }

  // 闂?闂?xexpr, yexpr)闂?闂傚倷鑳堕幊鎾诲床閹绘崹娑樷枎閹惧啿鐎?[xexpr, yexpr]闂傚倷鐒︾€笛呯矙閹烘梻鐭欓柟閭﹀枤缁犳柨顭块懜闈涘闁告瑥锕ラ妵鍕冀閵娧呯暭缂備胶濮村﹢杈╂閹烘挸绶炲┑鐘插珔閿濆鐓曢柕濠忛檮閻ㄦ垿鏌嶈閸忔稓寰婃繝姘剧稏濠㈣泛澶囬崑鎾愁潩閻撳骸绫嶉悗瑙勬穿缁蹭粙鎮鹃敓鐘茬骇閻犳亽鍔嬮幋鐑芥⒑閸濆嫷妲撮柡鍛矒瀵濡搁妷?null
  function splitTopPair(line) {
    if (!(line.startsWith('(') && line.endsWith(')'))) return null
    const inner = line.slice(1, -1)
    let depth = 0, comma = -1
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth < 0) return null }
      else if (ch === ',' && depth === 0) {
        if (comma !== -1) return null   // 婵犵數濮伴崹濂稿春閺嶎厽鍎楁い鏃€宕樻慨铏亜閹哄秷鍏岄柍缁樻閺屽秷顧侀柛鎾存皑缁瑦寰勯幇鍨櫆闂佸壊鍋呯粙鍫ュ磻閹惧绡€闁告洦浜濋崟鍐⒑缁嬭法鐏遍柛瀣姍瀹曟垿骞樺鍕閸┾偓妞ゆ帒鍟ㄦ禍褰掓煕瑜庨〃鍡涘疾椤掑嫭鍊堕柣鎰硾娴滃綊鏌ｉ悢鍝ョ疄闁哄矉绻濆畷鐔兼濞戞矮鍖栭梻?
        comma = i
      }
    }
    if (depth !== 0 || comma === -1) return null
    const xb = inner.slice(0, comma).trim(), yb = inner.slice(comma + 1).trim()
    return (xb && yb) ? [xb, yb] : null
  }

  // 婵犵數鍋涢顓熸叏鐎电硶鍋撳☉鎺撴珚闁诡垰娲︾€靛ジ寮堕幋鐙呯串闂備胶绮幐鍛婎殽閹间焦鈷曟慨妞诲亾闁哄矉绻濋崺鈧い鎺戝闁卞洭鏌￠崶鈺佹灆闁稿绶氬娲捶椤撗勬瘜闂佺顑嗛幑鍥蓟閿熺姴閱囨繝鍨姈绗戦柣鐔哥矋婵晫浜稿▎鎴烆潟闁圭儤鍤﹂悢鐓庝紶闁告洦鍘奸獮鈧繝纰夌磿閸嬫垿宕愬Δ鈧埢宥夊閵忊槅娼熸繛鏉戝悑濞兼瑧绮堥崟顖涚厾闁诡厽甯掗崝婊勭箾?y=闂?/ name(x)=闂?/ 闂?x 闂傚倷鐒﹂惇褰掑礉瀹€鈧埀顒佸嚬閸ㄥ爼寮鍛傜喖宕楅悡搴濈钵闂備線娼ч…鍫ュ礉瀹ュ牄浜圭憸蹇涘焵? 婵?闂?x, y)
  function collectPlots() {
    const lines = $('calc-input').value.split('\n')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#') && !s.startsWith('//'))
    const out = []
    for (const line of lines) {
      const m = line.match(/^(y|[a-zA-Z_]\w*\s*\(\s*x\s*\))\s*=\s*(.+)$/)
      if (m) { out.push({ kind: 'fn', body: m[2].trim(), label: m[1].replace(/\s+/g, '') + '=' + m[2].trim() }); continue }
      const pair = splitTopPair(line)
      if (pair) { out.push({ kind: 'point', xbody: pair[0], ybody: pair[1], label: '(' + pair[0] + ', ' + pair[1] + ')' }); continue }
      try {
        const node = math.parse(expandPythonRangeLiterals(line))
        if (!node.isAssignmentNode && !node.isFunctionAssignmentNode && referencesX(node)) {
          out.push({ kind: 'fn', body: line, label: 'y=' + line })
        }
      } catch (e) { /* 闂傚倷绀侀幖顐﹀疮閻楀牊鍙忛柣銏犵仛閸忔粓鏌涢幘鑼妽闁哥姴妫濋弻銊モ攽閸℃﹩妫ら梺閫炲苯鍘哥紒顔界懇楠炲棝宕橀鑲╊槹濡炪倖娲栭幊蹇涘棘閳ь剟姊洪懡銈呅㈤柟纰卞亰閹潡宕堕埡鍌氬簥?*/ }
    }
    return out
  }

  function showFrame(i, N, animName, animArr) {
    const label = $('calc-anim-label')
    if (N <= 1 || !animName) { label.textContent = ''; return }
    label.textContent = animName + ' = ' + formatVal(animArr[i % N]) + '闂傚倷绶氬褍螞瀹€鍕；?' + (i + 1) + '/' + N + ')'
  }

  function renderLegend(items) {
    const box = $('calc-legend')
    if (!box) return
    box.innerHTML = ''
    items.forEach(it => {
      const chip = document.createElement('span')
      chip.className = 'calc-legend-item'
      const sw = document.createElement('span')
      sw.className = 'calc-legend-swatch' + (it.kind === 'point' ? ' dot' : '')
      sw.style.background = it.color
      const txt = document.createElement('span')
      txt.textContent = it.label
      chip.append(sw, txt)
      box.appendChild(chip)
    })
  }

  // 缂傚倸鍊搁崐鐑芥倿閿曞倹鏅梻浣虹《閺呮粓銆冮崨顔芥珡闂備胶顭堥張顒勫春閸愵喖纾婚柟鍓х帛閸嬪倿骞栨潏鍓х瘈婵炲牜鍓熷缁樻媴閻熸壆绁烽梺鍝勭墱閸撴岸寮茬捄渚悑濠㈣泛锕ら悵妯荤節閵忥絾纭鹃柨鏇樺€涢妵鎰版偐鐟?x 闂傚倷鐒﹂惇褰掑礉瀹€鈧埀顒佸嚬閸撶喎鐣烽悽鍛婄劶鐎广儱鎳忛悗顒勬煟閵忊晛鐏遍柛鐘虫皑缁牓宕熼顐ゅ數闂佺厧鎽滈弫鎼併€傞崣澶岀缁炬澘宕悘锔锯偓娈垮枟閹告娊骞婇悩娲绘晢闁逞屽墮閳绘捇鎮╃紒妯煎弳濠电偞鍨堕敃鈺侇瀶瑜忕槐鎺楀础閻愯尪鍩炲銈嗘穿缂嶄礁顕ｉ幘顔藉亹闁惧浚鍋呴褰掓⒒娴ｅ憡鍟為悽顖涱殕缁旂喖宕卞缁樼亖闂佺鎻粻鎴︽倶閾忣偆绡€濠电姴鍊搁顏呯箾閸繂顣崇紒杈ㄦ尰閹峰懐绮欏▎鍙ユ偅闁荤喐绮嶅姗€藝閻㈢钃熺€光偓閸愵亞鏉告繝鐢靛仦閸庤櫕绂嶉悙顒傜瘈闂傚牊渚楅崕宀勬煕鐎ｎ偅宕屾鐐叉喘椤㈡鎷呴崜鍙夌稉闂傚倸鍊风欢锟犲礈濞嗘垹鐭撻柡澶嬪焾閸?闂?闂傚倷绀侀幉锟犲蓟閿濆绀夐幖娣妼閺嬩礁螖閿濆懎鏆為柡鍜佸墴閺屾盯顢曢敐鍥╃暤濠电偞鍤崶銊у幐闂侀€炲苯澧存い銏＄☉閳藉螣閸忓す銉モ攽閻愭潙鐏﹂柟鍛婃尦瀹曟垿骞橀弬銉︻潔闂佺懓鐏濋崯鈺呭箖瀹ュ洨纾?
  function drawFromEval() {
    evalAll()
    stopAnim()
    clearPlotObjects()

    const items = collectPlots()
    if (!items.length) { flashDrawError('No plottable item: use y=..., f(x)=..., or point (x, y)'); renderLegend([]); return }

    const drawables = []
    try {
      for (const it of items) {
        if (it.kind === 'point') {
          const xn = math.parse(expandPythonRangeLiterals(it.xbody)), yn = math.parse(expandPythonRangeLiterals(it.ybody))
          drawables.push({ kind: 'point', label: it.label, xcode: xn.compile(), ycode: yn.compile(), nodes: [xn, yn] })
        } else {
          const n = math.parse(expandPythonRangeLiterals(it.body))
          drawables.push({ kind: 'fn', label: it.label, code: n.compile(), nodes: [n] })
        }
      }
    } catch (e) { flashDrawError(e.message || String(e)); return }

    // First referenced array variable is used as animation frames.
    let animName = null, animArr = null
    for (const d of drawables) {
      for (const node of d.nodes) {
        node.traverse(n => {
          if (animName || !n.isSymbolNode) return
          const arr = asArray(scope[n.name])
          if (arr && arr.length) { animName = n.name; animArr = arr }
        })
        if (animName) break
      }
      if (animName) break
    }

    ensureBoard()
    if (!board) return

    const N = animArr ? animArr.length : 1
    const frameScope = Object.assign({}, scope)
    const applyFrame = i => { if (animName) frameScope[animName] = animArr[i % N] }
    applyFrame(0)

    const evalNum = code => { try { return toNumber(code.evaluate(frameScope)) } catch (e) { return NaN } }

    plotObjs = drawables.map((d, idx) => {
      const color = PALETTE[idx % PALETTE.length]
      d.color = color
      if (d.kind === 'point') {
        return board.create('point', [() => evalNum(d.xcode), () => evalNum(d.ycode)], {
          name: '', withLabel: false, size: 3, strokeColor: color, fillColor: color,
          fixed: true, showInfobox: false
        })
      }
      const fn = x => { frameScope.x = x; return evalNum(d.code) }
      return board.create('functiongraph', [fn], { strokeColor: color, strokeWidth: 2.5, highlight: false })
    })
    board.update()
    renderLegend(drawables.map(d => ({ color: d.color, label: d.label, kind: d.kind })))
    showFrame(0, N, animName, animArr)
    // 图例此刻才填充，重算一次画板尺寸，避免画板底部的导航条被顶出可视区
    refreshCalcPlotLayout()

    if (N > 1) {
      const ms = Math.max(60, parseInt($('calc-anim-ms').value, 10) || 500)
      let frame = 0
      animTimer = setInterval(() => {
        frame = (frame + 1) % N
        applyFrame(frame)
        board.update()
        showFrame(frame, N, animName, animArr)
      }, ms)
    }
  }

  // ---------- 婵犵數鍋涢悺銊у垝瀹€鍕垫晞闁告洦鍋€閺?----------
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms) } }
  const debouncedEvalAll = debounce(evalAll, 200)

  $('calc-input').addEventListener('input', () => {
    syncCalcScrollArea()
    debouncedEvalAll()
  })
  $('calc-draw').addEventListener('click', drawFromEval)
  $('calc-plot-clear').addEventListener('click', clearPlot)
  $('calc-anim-ms').addEventListener('change', () => { if (animTimer) drawFromEval() })

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => queueCalcLayoutRefresh(true))
    ;[$('app'), $('calc-panel'), $('calc-board')].forEach(el => { if (el) ro.observe(el) })
  }

  window.addEventListener('resize', () => {
    if (isCalcOpen()) {
      queueCalcLayoutRefresh(true)
    }
  })
  document.addEventListener('visibilitychange', () => queueCalcLayoutRefresh(true))
})()
