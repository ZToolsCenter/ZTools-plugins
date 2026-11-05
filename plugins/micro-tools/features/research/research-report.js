/* A self-contained report: all styles, SVGs, data and interaction code travel together. */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ResearchReport = factory()
})(typeof window === 'undefined' ? globalThis : window, function () {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]))
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  // One pure renderer for the live plugin and MCP/offline exports.
  function submissionHTML(submission, options = {}) {
    if (!submission || !submission.profile) return ''
    const byId = new Map((submission.candidates || []).map(c => [c.id, c]))
    const getJournal = id => ({ ...(options.getJournal ? options.getJournal(id) : {}), ...byId.get(id) })
    const listHTML = items => '<ul class="detail-list">' + items.map(t => '<li>' + esc(t) + '</li>').join('')
    function highlightsHTML(abstract, highlights) {
      const matches = highlights.map((h, i) => ({ start: abstract.indexOf(h.quote), end: abstract.indexOf(h.quote) + h.quote.length, h, i })).sort((a, b) => a.start - b.start)
      let cursor = 0, html = ''
      matches.forEach(m => { if (m.start < cursor) return; html += esc(abstract.slice(cursor, m.start)) + '<mark title="' + esc(m.h.label + '：' + m.h.explanation) + '" class="highlight highlight--' + m.i + '">' + esc(m.h.quote) + '</mark>'; cursor = m.end })
      return html + esc(abstract.slice(cursor))
    }
    const COMMUNITIES = [
      { name: 'Springer Nature Communities', label: '出版商官方社区', url: 'https://communities.springernature.com/', text: '编辑观点、论文背后的故事与学科讨论。可在社区内检索期刊名称。' },
      { name: 'Rising Scholars / AuthorAID', label: 'INASP 研究者社区', url: 'https://risingscholars.net/en/discussion/', text: '研究写作、发表与合作交流；论坛加入需申请。' },
      { name: 'PubPeer', label: '独立非营利 · 发表后评议', url: 'https://pubpeer.com/', text: '查看已发表论文的学术讨论，辅助了解研究内容。' }
    ]
    function externalLink(url, title, className = 'text-button') { return '<a class="' + className + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" data-external>' + esc(title) + ' ↗</a>' }
    function journalLinks(rec) {
      return {
        guidelines: 'https://www.bing.com/search?q=' + encodeURIComponent('"' + rec.name + '" official author guidelines ' + (rec.publisher || '')),
        profile: rec.abbr ? 'https://jcr.clarivate.com/jcr-jp/journal-profile?journal=' + encodeURIComponent(rec.abbr) + '&year=' + encodeURIComponent(rec.year || '2025') : '',
        experience: 'https://www.bing.com/search?q=' + encodeURIComponent('"' + rec.name + '" 投稿经验 review experience')
      }
    }
    function journalSubjects(rec) {
      if (rec.catDetail) return rec.catDetail.split('|').map(x => x.split('(')[0].split(':')[0].trim()).filter(Boolean).join(' · ')
      return rec.category && rec.category !== 'Multiple' ? rec.category : rec.ccfCat || '学科待核实'
    }
    function reportSection(id, title, caption, body, open = true) {
      return '<details class="panel research-profile submission-section" id="' + id + '"' + (open ? ' open' : '') + '><summary><span>' + title + '</span><small>' + caption + '</small></summary><div class="profile-body">' + body + '</div></details>'
    }
    function screeningLabel() {
      const range = submission.screening.if_range
      return range.min == null && range.max == null ? 'IF 不限' : 'IF ' + (range.min == null ? '0' : range.min) + '–' + (range.max == null ? '不限' : range.max)
    }
    function candidateTableHTML() {
      const candidates = submission.candidates || [], chosen = new Set(submission.rank ? submission.rank.recommendations.map(x => x.id) : [])
      const categories = Array.from(new Set(candidates.flatMap(c => journalSubjects(c).split(' · ')))).sort()
      return '<p class="help-text">以下是本轮送入模型比较的粗筛候选，最多 65 本，来自研究画像、学科关键词与综合期刊比较池。粗筛入围不等于建议投稿；IF / 分区来自本地快照。' + esc(screeningLabel()) + ' · ' + (submission.screening.include_general ? '包含综合期刊' : '仅专科期刊') + '。</p><div class="candidate-filters"><input data-candidate-search aria-label="检索粗筛期刊" placeholder="检索期刊、ISSN、出版方或学科"><select data-candidate-kind aria-label="期刊类别"><option value="">全部类别</option><option value="general">综合期刊</option><option value="specialist">专科期刊</option></select><select data-candidate-category aria-label="学科筛选"><option value="">全部学科</option>' + categories.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('') + '</select><input type="number" min="0" step="0.1" data-candidate-min aria-label="粗筛最低 IF" placeholder="最低 IF"><input type="number" min="0" step="0.1" data-candidate-max aria-label="粗筛最高 IF" placeholder="最高 IF"><select data-candidate-sort aria-label="粗筛排序"><option value="recall">召回顺序</option><option value="if-desc">IF 从高到低</option><option value="if-asc">IF 从低到高</option><option value="name">期刊名称 A–Z</option></select><button class="text-button" type="button" data-candidate-reset>重置筛选</button></div><p class="candidate-count" data-candidate-count aria-live="polite"></p><div class="candidate-table-wrap"><table class="candidate-table" data-candidate-table><thead><tr><th scope="col">期刊 / 出版方</th><th scope="col">JIF</th><th scope="col">分区</th><th scope="col">类别 / 学科</th><th scope="col">召回线索</th></tr></thead><tbody>' + candidates.map((c, i) => {
        const value = c.jif == null || String(c.jif).trim() === '' || !Number.isFinite(Number(c.jif)) ? '' : Number(c.jif), subjects = journalSubjects(c)
        return '<tr data-order="' + i + '" data-name="' + esc(c.name) + '" data-jif="' + value + '" data-kind="' + (c.is_general ? 'general' : 'specialist') + '" data-categories="' + esc(subjects.split(' · ').join('|')) + '" data-search="' + esc([c.name, c.publisher, subjects, c.issn].join(' ').toLowerCase()) + '"><td><strong>' + esc(c.name) + '</strong>' + (chosen.has(c.id) ? '<span class="candidate-picked">最优候选</span>' : '') + '<small>' + esc(c.publisher || '出版方待核实') + ' · ' + esc(c.issn || 'ISSN 未提供') + '</small></td><td class="candidate-if"><b>' + (value === '' ? '—' : value) + '</b><small>' + esc(c.year || '未标年') + '</small></td><td><span class="tag">' + esc(c.quartile || '—') + '</span></td><td><span class="candidate-kind' + (c.is_general ? ' candidate-kind--general' : '') + '">' + (c.is_general ? '综合期刊' : '专科期刊') + '</span><small>' + esc(subjects) + '</small></td><td><small>' + esc(c.recall_source || '研究画像线索') + '</small></td></tr>'
      }).join('') + '</tbody></table></div><p class="help-text" data-candidate-empty hidden>没有符合当前筛选条件的候选。请调整筛选或重置。</p><button class="secondary" type="button" data-candidate-more>显示更多候选</button>'
    }
    function renderBody() {
      const p = submission.profile, r = submission.rank
      const profile = reportSection('submissionProfile', '研究画像', '问题 · 方法 · 发现 · 研究亮点', '<p class="summary-text">' + esc(p.summary) + '</p><div class="tag-row">' + p.keywords.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div><div class="recommendation-detail"><div><h4>值得突出</h4>' + p.strengths.map(x => '<div class="analysis-point"><strong>' + esc(x.title) + '</strong><p>' + esc(x.evidence) + '</p></div>').join('') + '</div><div><h4>需要补充说明</h4>' + p.concerns.map(x => '<div class="analysis-point"><strong>' + esc(x.title) + '</strong><p>' + esc(x.evidence) + '</p></div>').join('') + '</div></div>' + (p.novelty_note || p.missing_information.length ? '<details class="notice"><summary>评估边界与信息缺口</summary><p>' + esc(p.novelty_note) + '</p>' + listHTML(p.missing_information) + '</details>' : ''))
      const highlights = reportSection('submissionHighlights', '摘要高亮', '逐字核对原文 · 保留上下文', '<p class="abstract-highlight">' + highlightsHTML(submission.abstract, p.highlights) + '</p>' + (p.highlights.length ? '<div class="highlight-legend">' + p.highlights.map((h, i) => '<span><i class="highlight--' + i + '"></i>' + esc(h.label) + ' · ' + esc(h.explanation) + '</span>').join('') + '</div>' : '<p class="help-text">模型没有提供可逐字核对的高亮片段，已保留原文。</p>'))
      const sections = [['submissionOverview', '报告概览'], ['submissionProfile', '研究画像'], ['submissionHighlights', '摘要高亮']]
      if (r) sections.push(['submissionRecommendations', '最优候选'])
      if (submission.candidates && submission.candidates.length) sections.push(['submissionCandidates', '粗筛清单'])
      if (r && r.general_assessment.length) sections.push(['submissionGeneral', '综合刊比较'])
      if (r) sections.push(['submissionPreparation', '投稿准备'])
      sections.push(['submissionCommunities', '交流支持'])
      const nav = '<nav class="submission-side-nav" aria-label="报告章节导航"><button class="secondary" type="button" aria-expanded="false">报告导航 ☰</button><div><strong>本页导航</strong>' + sections.map(([id, title], i) => '<a href="#' + id + '" data-report-target="' + id + '"><span>' + String(i + 1).padStart(2, '0') + '</span>' + title + '</a>').join('') + '</div></nav>'
      return nav + '<section class="panel submission-overview" id="submissionOverview"><div class="list-heading"><span class="eyebrow">YOUR JOURNAL SHORTLIST</span>' + (options.export ? '' : '<button class="secondary" id="exportSubmission">导出完整报告</button>') + '</div><h2>' + esc(submission.title || '摘要投稿分析') + '</h2><div class="tag-row"><span class="tag tag--violet">' + esc(p.field) + '</span><span class="tag">' + esc(submission.type === 'auto' ? (p.study_type || '稿件类型待确认') + ' · 模型判断' : submission.type + ' · 用户指定') + '</span><span class="tag">' + esc(screeningLabel()) + '</span><span class="tag">' + (r ? r.recommendations.length + ' 本最优候选' : '研究画像已完成') + '</span></div><p>' + esc(r ? r.strategy : p.summary) + '</p><p class="help-text">内容匹配由 AI 基于提供的材料判断；指标来自本地 JCR / CCF 快照，匹配等级不是录用概率。</p></section>' + profile + highlights +
        (r ? reportSection('submissionRecommendations', '最优候选期刊', r.recommendations.length + ' 本 · 内容与受众匹配优先', '<nav class="shortlist-nav" aria-label="推荐期刊导航">' + r.recommendations.map((x, i) => '<a href="#journal-rec-' + i + '" data-report-target="journal-rec-' + i + '"><span>' + String(i + 1).padStart(2, '0') + '</span>' + esc(getJournal(x.id).name) + '</a>').join('') + '</nav><div class="journal-shortlist">' + r.recommendations.map(recommendationHTML).join('') + '</div>') : '<section class="notice">期刊推荐生成后会显示在这里。</section>') +
        (submission.candidates && submission.candidates.length ? reportSection('submissionCandidates', '本轮粗筛清单', submission.candidates.length + ' 本 · 可检索、筛选与排序', candidateTableHTML(), false) : '') +
        (r && r.general_assessment.length ? reportSection('submissionGeneral', '综合期刊比较', '入选依据与未优先推荐的原因', '<p class="help-text">以下综合刊均进入本轮比较。结论基于所提供的材料；官网核验情况以具体条目的依据和来源为准，不代表编辑意见。</p><div class="general-assessments">' + r.general_assessment.map(x => '<article><div><strong>' + esc(getJournal(x.id).name) + '</strong><span class="tag' + (x.decision === '入选' ? ' tag--violet' : '') + '">' + esc(x.decision) + '</span></div><p>' + esc(x.reason) + '</p></article>').join('') + '</div>', false) : '') +
        (r ? reportSection('submissionPreparation', '投稿准备清单', '作者指南 · 全文证据 · 材料准备', '<ol class="checklist">' + r.checklist.map(x => '<li><strong>' + esc(x.title) + '</strong><p>' + esc(x.detail) + '</p></li>').join('') + '</ol><p class="help-text">' + esc(r.limitations) + '</p>') : '') +
        reportSection('submissionCommunities', '学术交流与发表支持', '经核对的外部入口', '<div class="community-grid">' + COMMUNITIES.map(x => '<a class="community-card" data-external href="' + x.url + '" target="_blank" rel="noopener noreferrer"><span class="tag">' + x.label + '</span><strong>' + x.name + ' ↗</strong><p>' + x.text + '</p></a>').join('') + '</div><p class="help-text">这些社区的讨论主题各不相同；用户评论不代表期刊官方承诺。审稿周期、费用与稿型以最新作者指南为准。</p>', false)
    }
    function recommendationHTML(item, i) {
      const rec = getJournal(item.id), links = journalLinks(rec)
      return '<article class="panel recommendation' + (i === 0 ? ' recommendation--lead' : '') + '" id="journal-rec-' + i + '"><div class="recommendation-top"><span class="rank-number">' + String(i + 1).padStart(2, '0') + '</span><div><div class="action-row"><span class="tag tag--violet">' + esc(item.tier) + '</span><span class="fit-chip">内容匹配 · ' + esc(item.fit) + '</span></div><h3>' + esc(rec.name) + '</h3><p class="panel-caption">' + esc(rec.publisher || '出版方待核实') + '</p></div></div><div class="journal-facts"><div><span>Journal Impact Factor</span><strong>' + esc(rec.jif !== '' && rec.jif != null ? rec.jif : '—') + '</strong><small>' + esc(rec.year || '未标年') + ' JIF · 本地快照</small></div><div><span>JCR 分区</span><strong>' + esc(rec.quartile || '—') + '</strong><small>' + (rec.ccfRank ? 'CCF ' + esc(rec.ccfRank) : '以所列学科分区为准') + '</small></div><div class="journal-field"><span>学科 / 期刊领域</span><b>' + esc(journalSubjects(rec)) + '</b><small>ISSN ' + esc(rec.issn || '未提供') + '</small></div></div><div class="journal-content"><div class="journal-fit"><h4>为什么值得比较</h4>' + listHTML(item.reasons) + '</div><div class="journal-concern"><h4>投稿前关注</h4>' + (item.concerns.length ? listHTML(item.concerns) : '<p class="help-text">摘要未提供足够信息；请结合全文与作者指南核实适配性。</p>') + '</div></div><details class="submission-requirements"><summary>投稿须知 <span>待核实 ' + item.to_verify.length + ' 项</span></summary>' + listHTML(item.to_verify.length ? item.to_verify : ['官网 Aims & Scope、稿件类型与格式、开放获取费用、最新投稿要求']) + '<p class="help-text">下列入口用于检索官网；本插件尚未抓取或认证具体投稿要求。</p></details><div class="action-row journal-actions">' + externalLink(links.guidelines, '检索官网指南', 'secondary') + (links.profile ? externalLink(links.profile, 'JCR 详情') : '') + externalLink(links.experience, '检索投稿经验') + '</div></article>'
    }
    return renderBody()
  }
  // This DOM-only function is reused live and embedded verbatim in HTML exports.
  function initSubmission(root) {
    const nav = root.querySelector('.submission-side-nav')
    if (!nav || nav.__submissionInitialized) return
    nav.__submissionInitialized = true
    if (nav) {
      const toggle = nav.querySelector('button')
      toggle.onclick = () => { const expanded = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(expanded)); nav.classList.toggle('is-open', expanded) }
      root.querySelectorAll('a[data-report-target]').forEach(link => { link.onclick = event => {
        const target = root.querySelector('#' + link.dataset.reportTarget); if (!target) return
        event.preventDefault()
        for (let parent = target; parent && parent !== root; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true
        nav.querySelectorAll('a').forEach(a => a.classList.toggle('is-active', a === link))
        nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false')
        const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (target.scrollIntoView) target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      } })
    }
    const table = root.querySelector('[data-candidate-table]'); if (!table) return
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    const search = root.querySelector('[data-candidate-search]'), kind = root.querySelector('[data-candidate-kind]'), category = root.querySelector('[data-candidate-category]'), min = root.querySelector('[data-candidate-min]'), max = root.querySelector('[data-candidate-max]'), order = root.querySelector('[data-candidate-sort]'), count = root.querySelector('[data-candidate-count]'), more = root.querySelector('[data-candidate-more]'), empty = root.querySelector('[data-candidate-empty]')
    let visible = 20
    function update() {
      const query = search.value.toLowerCase().trim(), lo = min.value.trim() === '' ? null : Number(min.value), hi = max.value.trim() === '' ? null : Number(max.value)
      const allowed = rows.filter(row => {
        const value = row.dataset.jif === '' ? null : Number(row.dataset.jif)
        return (!query || row.dataset.search.includes(query)) && (!kind.value || row.dataset.kind === kind.value) && (!category.value || row.dataset.categories.split('|').includes(category.value)) && (lo == null || (value != null && value >= lo)) && (hi == null || (value != null && value <= hi))
      })
      allowed.sort((a, b) => {
        if (order.value === 'name') return a.dataset.name.localeCompare(b.dataset.name)
        if (order.value === 'if-desc' || order.value === 'if-asc') {
          if (a.dataset.jif === '' || b.dataset.jif === '') return (a.dataset.jif === '' ? 1 : 0) - (b.dataset.jif === '' ? 1 : 0)
          return (Number(a.dataset.jif) - Number(b.dataset.jif)) * (order.value === 'if-desc' ? -1 : 1) || Number(a.dataset.order) - Number(b.dataset.order)
        }
        return Number(a.dataset.order) - Number(b.dataset.order)
      })
      rows.forEach(row => { row.hidden = true })
      allowed.forEach((row, i) => { table.tBodies[0].appendChild(row); row.hidden = i >= visible })
      count.textContent = '显示 ' + Math.min(visible, allowed.length) + ' / 筛选匹配 ' + allowed.length + ' / 本轮候选 ' + rows.length
      more.hidden = visible >= allowed.length; empty.hidden = allowed.length !== 0
    }
    ;[search, min, max].forEach(control => { control.oninput = () => { visible = 20; update() } })
    ;[kind, category, order].forEach(control => { control.onchange = () => { visible = 20; update() } })
    root.querySelector('[data-candidate-reset]').onclick = () => { search.value = kind.value = category.value = min.value = max.value = ''; order.value = 'recall'; visible = 20; update() }
    more.onclick = () => { visible += 20; update() }
    // Exports restore form defaults. Reset removes filters copied from the live DOM.
    search.value = kind.value = category.value = min.value = max.value = ''; order.value = 'recall'; update()
  }
  function boot() {
    const print = document.querySelector('#reportPrint'); if (print) print.onclick = () => window.print()
    let priorDetails = [], priorRows = []
    window.addEventListener('beforeprint', () => { priorDetails = Array.from(document.querySelectorAll('details')).map(el => [el, el.open]); priorRows = Array.from(document.querySelectorAll('[data-candidate-table] tbody tr')).map(el => [el, el.hidden]); priorDetails.forEach(([el]) => { el.open = true }); priorRows.forEach(([el]) => { el.hidden = false }) })
    window.addEventListener('afterprint', () => { priorDetails.forEach(([el, open]) => { el.open = open }); priorRows.forEach(([el, hidden]) => { el.hidden = hidden }) })
    const dataEl = document.getElementById('reportData'); if (!dataEl) return
    const data = JSON.parse(dataEl.textContent), M = window.ResearchMetrics
    const selection = { year: '', journal: '', author: '', term: '', ifbin: '', entry: '' }
    let scope = data.state.scope || 'all', dashboard
    const query = document.getElementById('reportSearch'), label = document.getElementById('reportCount'), chips = document.getElementById('reportFilters')
    function update() {
      const search = query.value.toLowerCase().trim(), allowed = new Set(data.entries.filter(e => (scope === 'all' || e.kind === scope) && M.matchesFilter(e, data.matches, selection) && (!search || [e.title, e.journal, e.authors.join(' '), e.key].join(' ').toLowerCase().includes(search))).map(e => String(e.id)))
      document.querySelectorAll('#reportTable tbody tr').forEach(row => { row.hidden = !allowed.has(row.dataset.id) })
      label.textContent = '显示 ' + allowed.size + ' / ' + data.entries.length + ' 条'
      chips.replaceChildren()
      Object.entries(selection).filter(([, value]) => value !== '').forEach(([key, value]) => { const b = document.createElement('button'); b.className = 'filter-tag'; b.textContent = ({ ifbin: 'JIF 区间 ', entry: '文献 ID ' }[key] || '') + value + ' ×'; b.onclick = () => { selection[key] = ''; dashboard.setSelection(selection); update() }; chips.appendChild(b) })
    }
    dashboard = M.mount(document.getElementById('reportDashboard'), data.entries, data.matches, { state: data.state, onSelect(value) { Object.assign(selection, value); update() }, onScope(value) { scope = value; update() }, onLocate() { document.getElementById('reportTable').scrollIntoView({ block: 'start' }) } })
    query.oninput = update
    document.getElementById('reportReset').onclick = () => { Object.keys(selection).forEach(k => { selection[k] = '' }); query.value = ''; scope = 'all'; dashboard.setSelection(selection); dashboard.setScope('all'); update() }
    update()
  }
  function build(type, body, title, assets, data) {
    if (!assets || !assets.css || (data && (!assets.core || !assets.metrics))) throw new Error('完整报告资源未能读取，请重新加载插件后导出。')
    const reportCss = '.report-shell--submission{max-width:960px!important}.report-shell{max-width:1040px;margin:0 auto;padding:30px 24px 60px}.report-header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:24px;gap:15px}.report-header strong{font-size:18px}.report-header p{font-size:12px;color:var(--muted);margin:6px 0}.report-footer{font-size:11px;color:var(--muted);border-top:1px solid var(--line);margin-top:30px;padding-top:16px;line-height:1.8}.report-search{display:flex;gap:12px;align-items:center;margin:16px 0}.report-search input{flex:1}.report-table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;background:white}th,td{padding:13px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);line-height:1.7}th{background:#edf3f8;color:#587087}td small{color:var(--muted)}.report-body h1{font-size:22px;overflow-wrap:anywhere}.report-body .metrics-tabs{position:static}@media(max-width:660px){.report-shell{padding:20px 14px}.report-search{flex-wrap:wrap}.report-header strong{font-size:16px}}@media print{body{height:auto;background:white}.report-shell{padding:0;max-width:none}.report-header button,.report-search,.network-tools,.metrics-toolbar,.filter-tag{display:none!important}.panel{break-inside:avoid}.report-table-wrap,.matrix-scroll{overflow:visible}.metrics-grid{display:block}.metrics-grid .panel{margin:14px 0}a{color:inherit}details{display:block}}'
    const css = (assets.css + '\n' + reportCss).replace(/<\/style/gi, '<\\/style')
    const scripts = (data ? assets.core + '\n' + assets.metrics + '\n' : '') + ';(' + initSubmission.toString() + ')(document);(' + boot.toString() + ')();'
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:; connect-src \'none\'"><title>' + esc(type + ' · ' + title) + '</title><style>' + css + '</style></head><body><main class="report-shell research' + (type === '投稿分析' ? ' report-shell--submission' : '') + '"><header class="report-header"><div><strong>科研小盒 · ' + esc(type) + '</strong><p>' + esc(new Date().toLocaleString('zh-CN')) + ' · 样式与交互已内嵌，可离线打开</p></div><button class="secondary" id="reportPrint">打印 / 保存 PDF</button></header><div class="report-body">' + body + '</div><footer class="report-footer">分析基于所提供的材料；AI 内容判断需复核。期刊指标来自插件本地快照，投稿条件请核实官网。作者名称未做身份消歧，主题共现与合著不等于引用关系。报告包含你导出的研究信息，请按需分享。</footer></main>' + (data ? '<script type="application/json" id="reportData">' + json(data) + '</script>' : '') + '<script>' + scripts.replace(/<\/script/gi, '<\\/script') + '</script></body></html>'
  }
  return { build, initSubmission, submissionHTML }
})
