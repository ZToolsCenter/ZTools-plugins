// Reuses the offline report shell and interactive bibliometrics renderer.
const fs = require('fs')
const path = require('path')
const R = require('./research-report')
const C = require('./research-core')
const M = require('./research-metrics')
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const list = items => '<ul class="detail-list">' + items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'
const section = (title, body) => '<section class="panel"><h2>' + esc(title) + '</h2>' + body + '</section>'
module.exports = function makeReport(session, directory, api) {
  const read = file => fs.readFileSync(path.join(directory, file), 'utf8')
  const assets = { css: read('index.css') + '\n' + read('features/research/research.css'), core: read('features/research/research-core.js'), metrics: read('features/research/research-metrics.js') }
  const d = session.data
  if (session.kind === 'submission') {
    return R.build('投稿分析', R.submissionHTML(d, { export: true, getJournal: api && (id => api.get(id)) }), d.title || '摘要投稿分析', assets)
  }
  // Exclude abstracts, file paths and raw BibTeX fields from exported HTML.
  const entries = d.entries.map(e => ({ id: e.id, key: e.key, title: e.title, year: e.year, authors: e.authors, journal: e.journal,
    keywords: e.keywords, kind: e.kind, kindSource: e.kindSource, kindReason: e.kindReason }))
  const quality = C.analyze(d.entries)
  const body = '<h1>' + esc(session.filename) + '</h1><p>本地分析 · ' + entries.length + ' 条 · 图表和清单支持离线联动</p>' +
    section('元数据完整性', '<p>缺期刊 ' + quality.missing.journal + ' · 缺年份 ' + quality.missing.year + ' · 缺 DOI ' + quality.missing.doi + ' · 缺摘要 ' + quality.missing.abstract + ' · 疑似重复 ' + quality.duplicates + '（保留在统计中）</p>' + list(d.warnings)) +
    '<div id="reportDashboard"></div><section class="panel"><h2>完整文献清单</h2><span id="reportCount"></span><div class="report-search"><input id="reportSearch" aria-label="检索导出文献" placeholder="检索标题、期刊与作者"><button id="reportReset">重置筛选</button></div><div id="reportFilters"></div><div class="report-table-wrap"><table id="reportTable"><thead><tr><th>年份</th><th>标题 / 作者</th><th>期刊 / JIF</th><th>类型与依据</th></tr></thead><tbody>' +
    entries.map(e => { const m = d.matches[e.id] || {}; return '<tr data-id="' + e.id + '"><td>' + esc(e.year || '—') + '</td><td>' + esc(e.title) + '<br><small>' + esc(e.authors.join('; ')) + '</small></td><td>' + esc(e.journal || '未提供') + '<br><small>' + esc(m.jif == null ? 'JIF 未匹配' : m.year + ' JIF ' + m.jif) + '</small></td><td>' + esc(M.KIND[e.kind]) + '<br><small>' + esc(e.kindReason) + '</small></td></tr>' }).join('') +
    '</tbody></table></div></section>'
  return R.build('文献图谱', body, session.filename, assets, { entries, matches: d.matches, state: { scope: 'all' } })
}
