// index.js —— 科研小盒 前端逻辑（多功能 SPA）
// 视图：home（启动器）/ journal（期刊·会议查询）/ database（数据库查询）
// 数据检索由 preload 的 window.journalApi 提供（JCR 期刊 + CCF 目录已合并）；
// ztools API 做剪贴板/通知/打开外链。

const $ = (sel) => document.querySelector(sel)

const els = {
  backBtn: $('#backBtn'),
  viewTitle: $('#viewTitle'),
  footer: $('#footer'),
  home: $('#view-home'),
  journal: $('#view-journal'),
  database: $('#view-database'),
  jSearch: $('#jSearch'),
  jHint: $('#jHint'),
  jResults: $('#jResults'),
  jFilter: $('#jFilter'),
  dSearch: $('#dSearch'),
  dbGrid: $('#dbGrid')
}

const VIEW_TITLE = { home: '科研小盒', journal: '期刊 · 会议查询', database: '数据库查询' }
let currentView = 'home'
let journalInited = false
let jFilter = 'all'   // all | journal | conf

/* ================= 视图路由 ================= */
function showView(view) {
  currentView = VIEW_TITLE[view] ? view : 'home'
  els.home.hidden = currentView !== 'home'
  els.journal.hidden = currentView !== 'journal'
  els.database.hidden = currentView !== 'database'
  els.backBtn.hidden = currentView === 'home'
  els.footer.hidden = currentView !== 'home'
  els.viewTitle.textContent = VIEW_TITLE[currentView]

  if (currentView === 'journal') initJournal()
  if (currentView === 'database') {
    renderDbGrid()
    setTimeout(() => els.dSearch.focus(), 0)
  }
}

/* ================= 通用 ================= */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  )
}

function copyToClipboard(text, okMsg) {
  if (window.ztools && typeof window.ztools.copyText === 'function') {
    const ok = window.ztools.copyText(text)
    if (window.ztools.showNotification) window.ztools.showNotification(ok ? (okMsg || '已复制') : '复制失败')
    return
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => alert(okMsg || '已复制'), () => alert('复制失败'))
  }
}

function openExternal(url) {
  if (window.ztools && typeof window.ztools.shellOpenExternal === 'function') {
    window.ztools.shellOpenExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

/* ================= ① 期刊 · 会议查询 ================= */
const QCLASS = { Q1: 'q1', Q2: 'q2', Q3: 'q3', Q4: 'q4' }
const CCFCLASS = { A: 'ccf-a', B: 'ccf-b', C: 'ccf-c' }

// CCF 领域全称 → 短标签（卡片上显示，避免过长）
const CCF_CAT_SHORT = {
  '计算机体系结构/并行与分布计算/存储系统': '体系结构',
  '计算机网络': '网络',
  '网络与信息安全': '安全',
  '软件工程/系统软件/程序设计语言': '软件工程',
  '数据库/数据挖掘/内容检索': '数据库',
  '计算机科学理论': '理论',
  '计算机图形学与多媒体': '图形学',
  '人工智能': '人工智能',
  '人机交互与普适计算': '人机交互',
  '交叉/综合/新兴': '交叉'
}

function shortCats(cat) {
  if (!cat) return ''
  return String(cat).split('·').map((s) => CCF_CAT_SHORT[s.trim()] || s.trim()).join(' · ')
}

// CCF 变动备注 → 徽章文案
const NOTE_LABEL = { '新增': '新增', '晋级': '晋级', '降级': '降级', '名称更新': '更名' }

function noteBadge(note) {
  if (!note) return ''
  const key = Object.keys(NOTE_LABEL).find((k) => note.indexOf(k) !== -1)
  if (!key) return ''
  return `<span class="badge badge--note">${esc(NOTE_LABEL[key])}</span>`
}

function journalCardHTML(r, i) {
  const q = r.quartile || ''
  const qc = QCLASS[q] || 'qna'
  const hasIf = r.jif !== '' && r.jif != null
  const jif = hasIf ? r.jif : '—'
  const rank = r.ccfRank || ''
  const cc = rank ? (CCFCLASS[rank] || 'ccf-c') : ''
  const isConf = !!r._conf

  const metaBits = []
  if (r.issn) metaBits.push(`ISSN ${esc(r.issn)}`)
  if (r.category && !isConf) metaBits.push(esc(r.category))
  if (isConf) metaBits.push('会议')
  if (!metaBits.length) metaBits.push('—')

  const hasStats = hasIf || r.citations || r.jci || r.jifRank

  return `
  <article class="card" data-idx="${i}">
    <div class="card__top">
      <div class="card__info">
        <h3 class="card__name">${esc(r.name)}</h3>
        <div class="card__sub">${esc(r.abbr || r.ccfAbbr || '—')} · ${esc(r.publisher || '—')}</div>
      </div>
      <div class="card__if-block">
        <div class="badge-row">
          ${hasIf ? `<span class="badge badge--if">IF ${esc(jif)}</span>` : ''}
          ${q ? `<span class="badge badge--${qc}">${esc(q)}</span>` : ''}
        </div>
        <div class="badge-row">
          ${rank ? `<span class="badge badge--${cc}">CCF ${esc(rank)}</span>` : ''}
          ${rank ? `<span class="badge badge--cat">${esc(shortCats(r.ccfCat))}</span>` : ''}
          ${noteBadge(r.ccfNotes)}
        </div>
      </div>
    </div>
    <div class="card__meta card__meta--sub">
      ${metaBits.map((m, k) => (k ? `<span class="dot">·</span><span>${m}</span>` : `<span>${m}</span>`)).join('')}
    </div>
    ${r.ccfCat ? `<div class="card__ccf">CCF 领域：${esc(r.ccfCat)}</div>` : ''}
    ${hasStats ? `
    <div class="card__stats">
      <div class="stat"><span class="stat__num">${esc(r.citations || '—')}</span><span class="stat__label">总被引</span></div>
      <div class="stat"><span class="stat__num">${esc(r.jci || '—')}</span><span class="stat__label">JCI</span></div>
      <div class="stat"><span class="stat__num">${esc(r.oa || '—')}${r.oa ? '%' : ''}</span><span class="stat__label">金色OA</span></div>
      <div class="stat"><span class="stat__num">${esc(r.jifRank || '—')}</span><span class="stat__label">JIF排名</span></div>
    </div>` : ''}
    ${r.catDetail ? `<div class="card__cat">分区详情：${esc(r.catDetail)}</div>` : ''}
    <div class="card__actions">
      <button class="btn btn--sm" data-copy>复制信息</button>
      ${(!isConf && r.abbr) ? `<button class="btn btn--sm btn--ghost" data-jcr>JCR 官网</button>` : ''}
      ${r.ccfUrl ? `<button class="btn btn--sm btn--ghost" data-home>官方/DBLP</button>` : ''}
    </div>
  </article>`
}

function renderJournal(list) {
  if (!list.length) {
    const what = jFilter === 'conf' ? '会议' : jFilter === 'journal' ? '期刊' : '期刊或会议'
    els.jResults.innerHTML = `<div class="empty">未找到匹配的${what}，换个关键词或切换筛选试试。</div>`
    return
  }
  els.jResults.innerHTML = list.map((r, i) => journalCardHTML(r, r._i == null ? i : r._i)).join('')
}

function doJournalSearch(q) {
  const api = window.journalApi
  if (!api) return
  const query = (q || '').trim()
  if (query) {
    const list = api.search(query, 60, jFilter)
    renderJournal(list)
    els.jHint.innerHTML = `匹配到 <b>${list.length}</b> 条${jFilter === 'conf' ? '会议' : jFilter === 'journal' ? '期刊' : '结果'}（按相关度、影响因子排序，最多 60 条）`
  } else {
    const list = api.top(20)
    renderJournal(list)
    const ccf = api.ccfTotal ? ` · CCF 目录 ${api.ccfTotal} 条独立条目` : ''
    els.jHint.innerHTML = `共收录 <b>${api.total}</b> 条 JCR 期刊${ccf}（默认显示影响因子最高的 20 条）`
  }
}

function initJournal() {
  setTimeout(() => els.jSearch.focus(), 0)
  if (journalInited) return
  const api = window.journalApi
  if (!api) {
    els.jHint.textContent = 'preload 未加载，无法读取期刊数据。'
    return
  }
  els.jHint.textContent = '正在加载期刊与 CCF 数据…'
  setTimeout(() => {
    const info = api.ensureLoaded()
    if (!info.ok) {
      els.jHint.textContent = '数据加载失败：' + info.error
      els.jResults.innerHTML = '<div class="empty">无法读取 journals.json.gz，请确认它与插件在同一目录。</div>'
      return
    }
    journalInited = true
    if (info.ccfError) {
      els.jHint.innerHTML = `JCR 加载正常，CCF 目录加载失败：${esc(info.ccfError)}`
    }
    doJournalSearch(els.jSearch.value)
  }, 30)
}

let jTimer
els.jSearch.addEventListener('input', () => {
  clearTimeout(jTimer)
  jTimer = setTimeout(() => doJournalSearch(els.jSearch.value), 220)
})

els.jFilter.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip')
  if (!chip) return
  jFilter = chip.dataset.filter
  els.jFilter.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === chip))
  doJournalSearch(els.jSearch.value)
})

els.jResults.addEventListener('click', (e) => {
  const card = e.target.closest('.card')
  if (!card) return
  const rec = window.journalApi && window.journalApi.get(Number(card.dataset.idx))
  if (!rec) return

  if (e.target.closest('[data-copy]')) {
    const lines = [
      `名称: ${rec.name}`,
      `缩写: ${rec.abbr || rec.ccfAbbr || '—'}`,
      `出版商/主办: ${rec.publisher || '—'}`
    ]
    if (rec.ccfRank) {
      lines.push(`CCF: ${rec.ccfRank} 类（${rec.ccfType}）`)
      lines.push(`CCF 领域: ${rec.ccfCat || '—'}`)
      if (rec.ccfNotes) lines.push(`CCF 变动: ${rec.ccfNotes}`)
    }
    if (rec.jif !== '' && rec.jif != null) {
      lines.push(
        `影响因子(JIF): ${rec.jif}  分区: ${rec.quartile || '—'}`,
        `JCI: ${rec.jci || '—'}  5年IF: ${rec.fiveYearJif || '—'}`,
        `总被引: ${rec.citations || '—'}  金色OA: ${rec.oa || '—'}%`,
        `JIF排名: ${rec.jifRank || '—'}`,
        `分区详情: ${rec.catDetail || '—'}`,
        `数据年份: ${rec.year || '—'}`
      )
    } else {
      lines.push('影响因子: 未被 JCR 2026 收录')
    }
    if (rec.issn) lines.push(`ISSN: ${rec.issn}`)
    copyToClipboard(lines.join('\n'), '已复制信息')
    return
  }

  if (e.target.closest('[data-jcr]')) {
    if (rec.abbr) {
      openExternal(
        'https://jcr.clarivate.com/jcr-jp/journal-profile?journal=' +
        encodeURIComponent(rec.abbr) + '&year=2025&fromPage=%2Fjcr%2Fhome'
      )
    }
    return
  }

  if (e.target.closest('[data-home]')) {
    if (rec.ccfUrl) openExternal(rec.ccfUrl)
  }
})

/* ================= ② 数据库查询（体验版） ================= */
const DATABASES = [
  { name: 'NCBI Genome', desc: '基因组/物种参考序列', url: (q) => `https://www.ncbi.nlm.nih.gov/genome/?term=${q}` },
  { name: 'NCBI Gene', desc: '基因功能与位点信息', url: (q) => `https://www.ncbi.nlm.nih.gov/gene/?term=${q}` },
  { name: 'PubMed', desc: '生物医学文献检索', url: (q) => `https://pubmed.ncbi.nlm.nih.gov/?term=${q}` },
  { name: 'NCBI Nucleotide', desc: '核酸序列数据库', url: (q) => `https://www.ncbi.nlm.nih.gov/nuccore/?term=${q}` },
  { name: 'UniProt', desc: '蛋白质序列与功能', url: (q) => `https://www.uniprot.org/uniprotkb?query=${q}` },
  { name: 'PDB', desc: '蛋白质三维结构', url: (q) => `https://www.rcsb.org/search?request=${q}` },
  { name: 'Ensembl', desc: '基因组注释浏览', url: (q) => `https://www.ensembl.org/Multi/Search/Results?q=${q}` },
  { name: 'Google Scholar', desc: '学术文献检索', url: (q) => `https://scholar.google.com/scholar?q=${q}` }
]

function renderDbGrid() {
  els.dbGrid.innerHTML = DATABASES.map(
    (d, i) => `<button class="db" data-idx="${i}"><div class="db__name">${esc(d.name)}</div><div class="db__desc">${esc(d.desc)}</div></button>`
  ).join('')
}

els.dbGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.db')
  if (!btn) return
  const db = DATABASES[Number(btn.dataset.idx)]
  const q = els.dSearch.value.trim()
  if (!q) {
    if (window.ztools && window.ztools.showNotification) window.ztools.showNotification('请先输入检索词')
    els.dSearch.focus()
    return
  }
  openExternal(db.url(encodeURIComponent(q)))
})

els.dSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = els.dSearch.value.trim()
    if (q) openExternal(DATABASES[0].url(encodeURIComponent(q)))
  }
})

/* ================= 导航事件 ================= */
els.backBtn.addEventListener('click', () => showView('home'))
els.home.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open]')
  if (btn && !btn.disabled) showView(btn.dataset.open)
})

/* ================= ZTools 生命周期 ================= */
if (window.ztools && window.ztools.onPluginEnter) {
  window.ztools.onPluginEnter((param) => {
    const code = param && param.code
    const payload = param && param.payload != null ? String(param.payload) : ''
    if (code === 'journal' || code === 'ccf') {
      showView('journal')
      if (code === 'ccf' && !payload) {
        jFilter = 'conf'
        els.jFilter.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c.dataset.filter === 'conf'))
      }
      if (payload) {
        els.jSearch.value = payload
        // 数据已加载则立即搜索，否则 initJournal 会在加载完成后自动触发
        if (journalInited && window.journalApi && window.journalApi.loaded) {
          doJournalSearch(payload)
        }
      } else if (journalInited) {
        doJournalSearch('')
      }
    } else if (code === 'database') {
      showView('database')
      if (payload) els.dSearch.value = payload
    } else {
      showView('home')
    }
  })
}

/* ================= 初始化 ================= */
showView('home')
