// index.js —— 科研小盒 前端逻辑（多功能 SPA）
// 视图：home（启动器）/ journal（期刊查询）/ database（数据库查询）
// 数据检索由 preload 的 window.journalApi 提供；ztools API 做剪贴板/通知/打开外链。

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
  dSearch: $('#dSearch'),
  dbGrid: $('#dbGrid')
}

const VIEW_TITLE = { home: '科研小盒', journal: '期刊查询', database: '数据库查询' }
let currentView = 'home'
let journalInited = false

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

/* ================= ① 期刊查询 ================= */
const QCLASS = { Q1: 'q1', Q2: 'q2', Q3: 'q3', Q4: 'q4' }

function journalCardHTML(j) {
  const q = j.quartile || ''
  const qc = QCLASS[q] || 'qna'
  const jif = j.jif === '' || j.jif == null ? '—' : j.jif
  return `
  <article class="card" data-name="${esc(j.name)}">
    <div class="card__top">
      <div class="card__info">
        <h3 class="card__name">${esc(j.name)}</h3>
        <div class="card__sub">${esc(j.abbr || '—')} · ${esc(j.publisher || '—')}</div>
      </div>
      <div class="card__if-block">
        <span class="badge badge--if">IF ${esc(jif)}</span>
        ${q ? `<span class="badge badge--${qc}">${esc(q)}</span>` : ''}
      </div>
    </div>
    <div class="card__meta card__meta--sub">
      <span>ISSN ${esc(j.issn || '—')}</span>
      <span class="dot">·</span>
      <span>${esc(j.category || '—')}</span>
    </div>
    <div class="card__stats">
      <div class="stat"><span class="stat__num">${esc(j.citations || '—')}</span><span class="stat__label">总被引</span></div>
      <div class="stat"><span class="stat__num">${esc(j.jci || '—')}</span><span class="stat__label">JCI</span></div>
      <div class="stat"><span class="stat__num">${esc(j.oa || '—')}${j.oa ? '%' : ''}</span><span class="stat__label">金色OA</span></div>
      <div class="stat"><span class="stat__num">${esc(j.jifRank || '—')}</span><span class="stat__label">JIF排名</span></div>
    </div>
    ${j.catDetail ? `<div class="card__cat">分区详情：${esc(j.catDetail)}</div>` : ''}
    <div class="card__actions">
      <button class="btn btn--sm" data-copy>复制信息</button>
      ${j.abbr ? `<button class="btn btn--sm btn--ghost" data-jcr>JCR 官网</button>` : ''}
    </div>
  </article>`
}

function renderJournal(list) {
  if (!list.length) {
    els.jResults.innerHTML = '<div class="empty">未找到匹配的期刊，换个关键词试试。</div>'
    return
  }
  els.jResults.innerHTML = list.map(journalCardHTML).join('')
}

function doJournalSearch(q) {
  const api = window.journalApi
  if (!api) return
  const query = (q || '').trim()
  if (query) {
    const list = api.search(query)
    renderJournal(list)
    els.jHint.innerHTML = `匹配到 <b>${list.length}</b> 条结果（按影响因子排序，最多 60 条）`
  } else {
    renderJournal(api.top(20))
    els.jHint.innerHTML = `共收录 <b>${api.total}</b> 条期刊数据（默认显示影响因子最高的 20 条）`
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
  // 首次进入触发一次性加载（gzip 解压 + 解析约 <0.1 秒）
  els.jHint.textContent = '正在加载期刊数据…'
  setTimeout(() => {
    const info = api.ensureLoaded()
    if (!info.ok) {
      els.jHint.textContent = '数据加载失败：' + info.error
      els.jResults.innerHTML = '<div class="empty">无法读取期刊数据，请确认 journals.json.gz 与插件在同一目录。</div>'
      return
    }
    journalInited = true
    doJournalSearch(els.jSearch.value)
  }, 30)
}

let jTimer
els.jSearch.addEventListener('input', () => {
  clearTimeout(jTimer)
  jTimer = setTimeout(() => doJournalSearch(els.jSearch.value), 220)
})

els.jResults.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]')
  if (btn) {
    const name = btn.closest('.card').dataset.name
    const j = window.journalApi && window.journalApi.search(name)[0]
    if (!j) return
    const text =
      `期刊: ${j.name}\n缩写: ${j.abbr || '—'}\n出版商: ${j.publisher || '—'}\n` +
      `ISSN: ${j.issn || '—'}\n学科: ${j.category || '—'}\n` +
      `影响因子(JIF): ${j.jif || '—'}  分区: ${j.quartile || '—'}\n` +
      `JCI: ${j.jci || '—'}  5年IF: ${j.fiveYearJif || '—'}\n` +
      `总被引: ${j.citations || '—'}  金色OA: ${j.oa || '—'}%\n` +
      `JIF排名: ${j.jifRank || '—'}\n分区详情: ${j.catDetail || '—'}\n数据年份: ${j.year || '—'}`
    copyToClipboard(text, '已复制期刊信息')
    return
  }

  const jcrBtn = e.target.closest('[data-jcr]')
  if (jcrBtn) {
    const card = jcrBtn.closest('.card')
    const name = card.dataset.name
    const j = window.journalApi && window.journalApi.search(name)[0]
    if (j && j.abbr) {
      openExternal(
        'https://jcr.clarivate.com/jcr-jp/journal-profile?journal=' +
        encodeURIComponent(j.abbr) + '&year=2025&fromPage=%2Fjcr%2Fhome'
      )
    }
    return
  }
})

/* ================= ② 数据库查询（体验版） ================= */
// 通过检索词拼出各数据库的搜索链接，用系统浏览器打开。
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
    if (q) openExternal(DATABASES[0].url(encodeURIComponent(q))) // 回车默认打开第一个（NCBI Genome）
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
    if (code === 'journal') {
      showView('journal')
      if (payload) {
        els.jSearch.value = payload
        // 如果数据已加载完成，立即搜索；否则 initJournal 会在加载后自动触发
        if (journalInited && window.journalApi && window.journalApi.loaded) {
          doJournalSearch(payload)
        }
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
