/* Local bibliometrics and SVG views, shared by the plugin and standalone reports. */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./research-core'))
  else root.ResearchMetrics = factory(root.ResearchCore)
})(typeof window === 'undefined' ? globalThis : window, function (C) {
  'use strict'
  const KIND = { review: '综述', research: '研究论文', unknown: '待确认', other: '其他' }
  const COLOR = { review: '#9774d4', research: '#4798d9', unknown: '#b9c5d4', other: '#37b39c' }
  const BINS = [[0, 2, '0–<2'], [2, 5, '2–<5'], [5, 10, '5–<10'], [10, 20, '10–<20'], [20, Infinity, '≥20']]
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]))
  const fmt = n => Number.isInteger(n) ? String(n) : Number(n).toFixed(2)
  // Conservative name identity: keep diacritics and order; do not infer full names from initials.
  const authorKey = name => String(name).normalize('NFC').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()
  const venueKey = name => C.normalize(String(name || '').replace(/^the\s+/i, ''))
  function uniqueAuthors(e) {
    const seen = new Set()
    return (e.authors || []).filter(name => { const key = authorKey(name); if (!key || /^(others|et al|anonymous|unknown|佚名)$/.test(key) || seen.has(key)) return false; seen.add(key); return true })
  }
  function numericJif(v) { return v != null && String(v).trim() !== '' && /^\d+(?:\.\d+)?$/.test(String(v).trim()) ? Number(v) : null }
  function matchJournals(entries, api) {
    const result = Object.create(null)
    if (!api) { entries.forEach(e => { result[e.id] = { status: 'database-unavailable', jif: null } }); return result }
    api.ensureLoaded()
    if (api.error || !api.allTotal) { entries.forEach(e => { result[e.id] = { status: 'database-unavailable', jif: null } }); return result }
    const names = new Map(), issns = new Map()
    function add(map, key, record) { if (!key) return; const old = map.get(key) || []; if (!old.includes(record)) old.push(record); map.set(key, old) }
    for (let i = 0; i < api.allTotal; i++) {
      const r = api.get(i); if (!r || r._conf) continue
      add(names, venueKey(r.name), r); add(names, venueKey(r.abbr), r)
      ;[r.issn, r.eissn].forEach(v => add(issns, C.normalize(v), r))
    }
    entries.forEach(e => {
      const f = e.fields || {}, codes = (String(f.issn || '') + ' ' + String(f.eissn || '')).match(/\d{4}-?\d{3}[\dxX]/g) || []
      const byCode = Array.from(new Set(codes.flatMap(x => issns.get(C.normalize(x)) || [])))
      const byName = e.journal ? names.get(venueKey(e.journal)) || [] : []
      const choices = byCode.length ? byCode : byName
      if (choices.length !== 1) { result[e.id] = { status: choices.length ? 'ambiguous' : e.journal || codes.length ? 'unmatched' : 'missing-venue', jif: null }; return }
      const r = choices[0], jif = numericJif(r.jif)
      result[e.id] = { status: jif == null ? 'no-jif' : 'matched', name: r.name, jif, year: String(r.year || ''), quartile: r.quartile || '', method: byCode.length ? 'ISSN' : '名称 / 库内缩写标准化精确匹配（忽略大小写、标点、首部 The）' }
    })
    return result
  }
  function analyze(entries, matches) {
    const aMap = new Map(), jMap = new Map(), years = new Map(), tokens = new Map()
    let missingAuthors = 0, multi = 0, authorships = 0
    entries.forEach(e => {
      if (e.year) { const y = years.get(e.year) || { label: String(e.year), count: 0, kinds: { review: 0, research: 0, unknown: 0, other: 0 } }; y.count++; y.kinds[e.kind || 'unknown']++; years.set(e.year, y) }
      if (e.journal) { const k = C.normalize(e.journal), j = jMap.get(k) || { label: e.journal, count: 0, years: {} }; j.count++; if (e.year) j.years[e.year] = (j.years[e.year] || 0) + 1; jMap.set(k, j) }
      const names = uniqueAuthors(e); authorships += names.length; if (!names.length) missingAuthors++; if (names.length > 1) multi++
      names.forEach(name => { const k = authorKey(name), a = aMap.get(k) || { id: k, label: name, count: 0, fractional: 0, years: {}, yearSum: 0, yearCount: 0 }; a.count++; a.fractional += 1 / names.length; if (e.year) { a.years[e.year] = (a.years[e.year] || 0) + 1; a.yearSum += e.year; a.yearCount++ }; aMap.set(k, a) })
      C.terms(e.title + ' ' + e.keywords).forEach(t => { const x = tokens.get(t) || { id: t, label: t, count: 0, yearSum: 0, yearCount: 0 }; x.count++; if (e.year) { x.yearSum += e.year; x.yearCount++ }; tokens.set(t, x) })
    })
    const sort = (a, b) => b.count - a.count || a.label.localeCompare(b.label)
    const authors = Array.from(aMap.values()).sort(sort), journals = Array.from(jMap.values()).sort(sort), terms = Array.from(tokens.values()).sort(sort)
    const ifRecords = entries.map(e => ({ e, match: matches[e.id] || { jif: null, status: 'unmatched' } })).filter(x => x.match.jif != null)
    const values = ifRecords.map(x => x.match.jif).sort((a, b) => a - b)
    function quantile(p) { if (!values.length) return null; const h = (values.length - 1) * p, lo = Math.floor(h); return values[lo] + (values[Math.ceil(h)] - values[lo]) * (h - lo) }
    return { total: entries.length, years: Array.from(years.values()).sort((a, b) => +a.label - +b.label), authors, journals, terms, missingAuthors, multi, authorships,
      ifRecords, ifBins: BINS.map(([min, max, label], i) => ({ id: String(i), label, count: values.filter(v => v >= min && v < max).length })),
      ifSummary: { min: values[0], q1: quantile(.25), median: quantile(.5), q3: quantile(.75), max: values.at(-1) },
      ifYears: Array.from(new Set(ifRecords.map(x => x.match.year || '未标年'))).sort(),
      statuses: entries.reduce((m, e) => { const k = (matches[e.id] || {}).status || 'unmatched'; m[k] = (m[k] || 0) + 1; return m }, {}) }
  }
  // VOS-style author collaboration: full edge=1, fractional edge=1/(n-1) per shared document.
  // Author output credit is separately 1/n. Networks are limited to the selected top nodes, counts use the full slice.
  function network(entries, stats, type, limit, minDocuments, counting) {
    const base = type === 'author' ? stats.authors : stats.terms
    const nodes = base.slice(0, limit).map(n => ({ ...n, meanYear: n.yearCount ? n.yearSum / n.yearCount : null }))
    const selected = new Set(nodes.map(n => n.id)), edges = new Map()
    entries.forEach(e => {
      const all = type === 'author' ? uniqueAuthors(e).map(authorKey) : C.terms(e.title + ' ' + e.keywords)
      const ids = all.filter(k => selected.has(k)).sort()
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const key = JSON.stringify([ids[i], ids[j]]), edge = edges.get(key) || { source: ids[i], target: ids[j], documents: 0, weight: 0 }
        edge.documents++; edge.weight += counting === 'fractional' ? 1 / (all.length - 1) : 1; edges.set(key, edge)
      }
    })
    const allLinks = Array.from(edges.values()).filter(e => e.documents >= minDocuments).sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source))
    const links = allLinks.slice(0, 240)
    const neighbors = new Map(nodes.map(n => [n.id, []]))
    links.forEach(e => { neighbors.get(e.source).push(e.target); neighbors.get(e.target).push(e.source) })
    let component = 0; const assigned = new Map()
    nodes.forEach(n => { if (assigned.has(n.id)) return; const stack = [n.id]; assigned.set(n.id, component); while (stack.length) { const id = stack.pop(); neighbors.get(id).forEach(k => { if (!assigned.has(k)) { assigned.set(k, component); stack.push(k) } }) }; component++ })
    nodes.forEach(n => { n.component = assigned.get(n.id) })
    return { nodes, links, components: component, allLinkCount: allLinks.length, totalNodes: base.length }
  }
  function layout(net) {
    const W = 900, H = 530, nodes = net.nodes.map((n, i) => ({ ...n, x: W / 2 + Math.cos(i * 2 * Math.PI / net.nodes.length) * 260, y: H / 2 + Math.sin(i * 2 * Math.PI / net.nodes.length) * 175 }))
    const map = new Map(nodes.map(n => [n.id, n]))
    for (let tick = 0; tick < 220; tick++) {
      const deltas = new Map(nodes.map(n => [n.id, { x: (W / 2 - n.x) * .003, y: (H / 2 - n.y) * .003 }]))
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(100, dx * dx + dy * dy), f = 9000 / (d2 * Math.sqrt(d2)); deltas.get(a.id).x += dx * f; deltas.get(a.id).y += dy * f; deltas.get(b.id).x -= dx * f; deltas.get(b.id).y -= dy * f }
      net.links.forEach(e => { const a = map.get(e.source), b = map.get(e.target), dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 1, f = (dist - 105) * .022 * Math.min(3, Math.sqrt(e.weight)); deltas.get(a.id).x += dx / dist * f; deltas.get(a.id).y += dy / dist * f; deltas.get(b.id).x -= dx / dist * f; deltas.get(b.id).y -= dy / dist * f })
      const cooling = 1 - tick / 260
      nodes.forEach(n => { const d = deltas.get(n.id); n.x = Math.max(85, Math.min(W - 85, n.x + Math.max(-8, Math.min(8, d.x)) * cooling)); n.y = Math.max(42, Math.min(H - 42, n.y + Math.max(-8, Math.min(8, d.y)) * cooling)) })
    }
    return { nodes, map }
  }
  function attrs(data) { return Object.entries(data).map(([k, v]) => ' data-' + k + '="' + esc(v) + '"').join('') }
  const clickable = data => ' tabindex="0" role="button"' + attrs(data)
  const svg = (w, h, label, content) => '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' + content + '</svg>'
  const empty = text => '<p class="empty-state">' + esc(text) + '</p>'
  function timeline(stats, mode) {
    if (!stats.years.length) return empty('未提供发表年份')
    const observed = stats.years, first = +observed[0].label, last = +observed.at(-1).label
    // Fill missing years with zero, but keep very long spans to observed points.
    const ys = last - first <= 100 ? Array.from({ length: last - first + 1 }, (_, i) => observed.find(x => +x.label === first + i) || { label: String(first + i), count: 0, kinds: {} }) : observed
    const W = 800, H = 250, base = 209, step = 736 / ys.length, bw = Math.min(30, step * .7)
    let cumulative = 0; const totals = ys.map(y => (cumulative += y.count)), max = mode === 'cumulative' ? cumulative : Math.max(...ys.map(y => y.count))
    let html = [0, .5, 1].map(v => '<line x1="40" y1="' + (base - v * 165) + '" x2="784" y2="' + (base - v * 165) + '" class="grid-line"/><text x="30" y="' + (base - v * 165 + 4) + '" text-anchor="end">' + Math.round(max * v) + '</text>').join('')
    const points = []
    ys.forEach((y, i) => {
      const x = 44 + i * step, cx = x + bw / 2; let offset = 0
      let marks = ''
      if (mode === 'cumulative') { const cy = base - totals[i] / max * 165; points.push(cx + ',' + cy); marks = '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#6e7fce"/><rect x="' + x + '" y="35" width="' + bw + '" height="175" fill="transparent"/>' }
      else Object.keys(KIND).forEach(k => { const count = y.kinds[k] || 0, h = count / max * 165; if (count) marks += '<rect x="' + x + '" y="' + (base - offset - h) + '" width="' + bw + '" height="' + h + '" fill="' + COLOR[k] + '" rx="2"/>'; offset += h })
      html += '<g class="chart-click"' + clickable({ year: y.label }) + '><title>' + y.label + ' 年：' + y.count + ' 条 · 累计 ' + totals[i] + '</title>' + marks + (i % Math.ceil(ys.length / 12) === 0 || i === ys.length - 1 ? '<text x="' + cx + '" y="233" text-anchor="middle">' + y.label + '</text>' : '') + '</g>'
    })
    if (mode === 'cumulative') html = '<polyline points="' + points.join(' ') + '" fill="none" stroke="#8c9cd8" stroke-width="3"/>' + html
    return svg(W, H, '年度发表量与累计趋势', html) + '<div class="chart-key">' + (mode === 'cumulative' ? '累计计数仅包含当前类型范围内、有年份的条目' : Object.keys(KIND).map(k => '<span><i style="background:' + COLOR[k] + '"></i>' + KIND[k] + '</span>').join('')) + '</div>'
  }
  function bars(items, type, top, total, counting) {
    if (!items.length) return empty(type === 'author' ? '没有可统计的作者名称' : '未提供期刊 / 出版载体')
    const selected = type === 'author' && counting === 'fractional' ? [...items].sort((a, b) => b.fractional - a.fractional || a.label.localeCompare(b.label)) : items
    const key = type === 'author' && counting === 'fractional' ? 'fractional' : 'count', max = selected[0][key] || 1
    return '<div class="metric-bars">' + selected.slice(0, top).map((x, i) => '<button class="metric-bar"' + attrs({ [type]: type === 'author' ? x.id : x.label }) + '><span class="bar-label"><small>' + String(i + 1).padStart(2, '0') + '</small><span>' + esc(x.label) + '</span><b>' + fmt(x[key]) + '</b></span><span class="bar-track"><i style="width:' + x[key] / max * 100 + '%"></i></span>' + (type === 'journal' ? '<span class="bar-share">占当前范围 ' + (x.count / total * 100).toFixed(1) + '%</span>' : '') + '</button>').join('') + '</div>'
  }
  function distribution(stats) {
    if (!stats.ifRecords.length) return empty('当前范围没有可精确匹配的数值 JIF。缺失值不会按 0 统计。')
    const max = Math.max(...stats.ifBins.map(b => b.count)), W = 450, H = 235, base = 155
    let html = '<line x1="35" x2="438" y1="155" y2="155" class="grid-line"/>'
    stats.ifBins.forEach((b, i) => { const x = 48 + i * 78, h = b.count / max * 107; html += '<g class="chart-click"' + clickable({ ifbin: b.id }) + '><title>JIF ' + b.label + '：' + b.count + ' 条</title><rect x="' + x + '" y="' + (base - h) + '" width="43" height="' + Math.max(2, h) + '" rx="5" fill="#54b5a6"/><text x="' + (x + 21) + '" y="' + (base - h - 9) + '" text-anchor="middle">' + b.count + '</text><text x="' + (x + 21) + '" y="178" text-anchor="middle">' + b.label + '</text></g>' })
    const s = stats.ifSummary, scale = v => 45 + (s.max === s.min ? .5 : (v - s.min) / (s.max - s.min)) * 365
    html += '<line x1="' + scale(s.min) + '" x2="' + scale(s.max) + '" y1="211" y2="211" stroke="#94a5b9"/><rect x="' + scale(s.q1) + '" y="200" width="' + Math.max(2, scale(s.q3) - scale(s.q1)) + '" height="22" fill="#d9efeb" stroke="#54b5a6"/><line x1="' + scale(s.median) + '" x2="' + scale(s.median) + '" y1="198" y2="224" stroke="#259a8c" stroke-width="3"/>'
    return svg(W, H, 'JIF 直方图与五数概括', html) + '<div class="chart-key">中位数 <b>' + fmt(s.median) + '</b> · 25%–75% 分位数 ' + fmt(s.q1) + '–' + fmt(s.q3) + ' · 范围 ' + fmt(s.min) + '–' + fmt(s.max) + '</div>'
  }
  function scatter(stats) {
    const records = stats.ifRecords.filter(x => x.e.year)
    if (!records.length) return empty('需要同时具有年份和可匹配 JIF 的条目')
    const ys = records.map(x => x.e.year), first = Math.min(...ys), last = Math.max(...ys), max = Math.max(1, ...records.map(x => x.match.jif))
    const x = y => 52 + (last === first ? .5 : (y - first) / (last - first)) * 720, y = n => 220 - n / max * 174
    let html = [0, .5, 1].map(v => '<line x1="45" x2="788" y1="' + y(v * max) + '" y2="' + y(v * max) + '" class="grid-line"/><text x="36" y="' + (y(v * max) + 4) + '" text-anchor="end">' + fmt(v * max) + '</text>').join('')
    const ticks = Array.from(new Set([first, Math.round((first + last) / 2), last])); ticks.forEach(t => { html += '<text x="' + x(t) + '" y="248" text-anchor="middle">' + t + '</text>' })
    // Deterministic horizontal jitter separates coincident records, never changes JIF.
    records.forEach((r, i) => { const e = r.e, title = e.title + '\n' + e.year + ' · ' + r.match.name + '\n' + r.match.year + ' JIF ' + r.match.jif; html += '<g' + clickable({ entry: e.id }) + '><title>' + esc(title) + '</title><circle cx="' + (x(e.year) + (i % 7 - 3) * 2) + '" cy="' + y(r.match.jif) + '" r="5" fill="' + COLOR[e.kind || 'unknown'] + '" fill-opacity=".7" stroke="white"/></g>' })
    return svg(810, 270, '发表年份 × 当前 JIF 散点图', html) + '<p class="help-text">每个点为一条文献；横向轻微抖动避免遮挡。纵轴为同一快照的期刊 JIF，不是发表当年的 IF。</p>'
  }
  function heatmap(stats, type, top) {
    const rows = (type === 'author' ? stats.authors : stats.journals).slice(0, Math.min(top, 15)), years = stats.years.map(x => x.label)
    if (!rows.length || !years.length) return empty('需要名称与发表年份才能生成热图')
    const W = Math.max(720, 225 + years.length * 27), H = 60 + rows.length * 32, left = 213, step = (W - left - 20) / years.length
    const max = Math.max(1, ...rows.flatMap(r => Object.values(r.years)))
    let html = years.map((y, i) => i % Math.ceil(years.length / 22) === 0 ? '<text x="' + (left + i * step + step / 2) + '" y="24" text-anchor="middle">' + y + '</text>' : '').join('')
    rows.forEach((r, i) => { const yy = 39 + i * 32; html += '<text x="200" y="' + (yy + 17) + '" text-anchor="end"><title>' + esc(r.label) + '</title>' + esc(r.label.length > 25 ? r.label.slice(0, 23) + '…' : r.label) + '</text>'; years.forEach((yr, j) => { const count = r.years[yr] || 0; html += '<g' + clickable({ year: yr, [type]: type === 'author' ? r.id : r.label }) + '><title>' + esc(r.label + ' · ' + yr + '：' + count + ' 条') + '</title><rect x="' + (left + j * step) + '" y="' + yy + '" width="' + Math.max(1, step - 3) + '" height="26" rx="3" fill="' + (count ? '#3ca89a' : '#f0f4f8') + '" fill-opacity="' + (count ? .25 + count / max * .75 : 1) + '"/>' + (count && step > 20 ? '<text x="' + (left + j * step + (step - 3) / 2) + '" y="' + (yy + 18) + '" text-anchor="middle" fill="' + (count / max > .5 ? 'white' : '#286f67') + '">' + count + '</text>' : '') + '</g>' }) })
    return '<div class="matrix-scroll">' + svg(W, H, (type === 'author' ? '作者' : '期刊') + '年度热图', html) + '</div><p class="help-text">颜色越深，当前文件中的条目越多。点击单元格同时筛选名称与年份。</p>'
  }
  function networkSvg(net, type, colorMode, selection) {
    if (!net.nodes.length) return empty('没有可生成网络的名称或主题')
    const { nodes, map } = layout(net), max = Math.max(...nodes.map(n => n.count)), palette = ['#488fd0', '#38ae9c', '#9571ce', '#d79c57', '#c97696', '#6e92ad']
    const valid = nodes.filter(n => n.meanYear != null).map(n => n.meanYear), first = Math.min(...valid), last = Math.max(...valid)
    const active = selection[type], adjacent = new Set(active ? net.links.filter(e => e.source === active || e.target === active).flatMap(e => [e.source, e.target]) : [])
    let html = net.links.map(e => { const a = map.get(e.source), b = map.get(e.target); return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#9ab1c7" stroke-opacity="' + (active && e.source !== active && e.target !== active ? .06 : .43) + '" stroke-width="' + Math.min(5, 1 + Math.sqrt(e.weight)) + '"><title>' + esc(a.label + ' × ' + b.label + ' · 共同 ' + e.documents + ' 条 · 权重 ' + fmt(e.weight)) + '</title></line>' }).join('')
    nodes.forEach(n => { const r = 9 + Math.sqrt(n.count / max) * 17, opacity = active && active !== n.id && !adjacent.has(n.id) ? .22 : 1; const color = colorMode === 'year' && n.meanYear != null ? 'hsl(' + (210 - (last === first ? .5 : (n.meanYear - first) / (last - first)) * 165) + ',52%,52%)' : palette[n.component % palette.length]; html += '<g class="graph-node" opacity="' + opacity + '"' + clickable({ [type]: n.id }) + '><title>' + esc(n.label + ' · ' + n.count + ' 条 · 平均年份 ' + (n.meanYear == null ? '缺失' : n.meanYear.toFixed(1))) + '</title><circle cx="' + n.x + '" cy="' + n.y + '" r="' + r + '" fill="' + color + '" stroke="' + (active === n.id ? '#263e63' : '#fff') + '" stroke-width="3"/><text x="' + n.x + '" y="' + (n.y + 4) + '" text-anchor="middle" class="node-count">' + n.count + '</text><text x="' + n.x + '" y="' + (n.y + r + 15) + '" text-anchor="middle" class="node-label">' + esc(n.label.length > 24 ? n.label.slice(0, 22) + '…' : n.label) + '</text></g>' })
    return svg(900, 530, type === 'author' ? '作者合作网络' : '主题共现网络', html) + '<p class="help-text">展示 ' + nodes.length + ' / ' + net.totalNodes + ' 个节点，' + net.links.length + ' / ' + net.allLinkCount + ' 条达阈值连线。' + (colorMode === 'year' ? '蓝 → 绿 → 金色表示平均发表时间由早到晚（' + (valid.length ? first.toFixed(1) + '–' + last.toFixed(1) : '年份缺失') + '）；缺年份用分量颜色。' : '颜色表示当前显示网络的连通分量，不等同于学科或团队分类。') + '</p>'
  }
  function matchesFilter(e, matches, selection) {
    if (selection.year && String(e.year) !== selection.year) return false
    if (selection.journal && C.normalize(e.journal) !== C.normalize(selection.journal)) return false
    if (selection.term && !C.terms(e.title + ' ' + e.keywords).includes(selection.term)) return false
    if (selection.author && !uniqueAuthors(e).some(a => authorKey(a) === selection.author)) return false
    if (selection.entry !== '' && selection.entry != null && String(e.id) !== selection.entry) return false
    if (selection.ifbin !== '' && selection.ifbin != null) { const v = (matches[e.id] || {}).jif, bin = BINS[+selection.ifbin]; if (v == null || !bin || v < bin[0] || v >= bin[1]) return false }
    return true
  }
  function mount(container, entries, matches, config = {}) {
    const state = Object.assign({ tab: 'overview', scope: 'all', time: 'annual', top: '10', counting: 'full', network: 'author', nodes: '30', threshold: '2', color: 'component', matrix: 'journal', zoom: 1 }, config.state || {})
    let selection = Object.assign({ year: '', journal: '', term: '', author: '', ifbin: '', entry: '' }, config.selection || {})
    let slice, stats, lastNet
    function selectOption(name, choices, label) { return '<label class="compact-control">' + esc(label) + '<select data-option="' + name + '">' + choices.map(([v, t]) => '<option value="' + v + '"' + (String(state[name]) === String(v) ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' }
    const topControl = () => selectOption('top', [['10','前 10'],['15','前 15'],['25','前 25']], '显示数量')
    function panel(title, hint, content, wide = false, controls = '') { return '<section class="panel' + (wide ? ' chart-wide' : '') + '"><div class="list-heading"><h3>' + title + '</h3>' + controls + '</div><p class="panel-caption">' + hint + '</p>' + content + '</section>' }
    function notify() { if (config.onSelect) config.onSelect({ ...selection }); paintSelection() }
    function paintSelection() {
      const strip = container.querySelector('.metrics-selection'), info = strip && strip.querySelector('span')
      const chosen = Object.entries(selection).filter(([, value]) => value !== '')
      if (strip) { strip.hidden = !chosen.length; info.textContent = '已选：' + chosen.map(([k, v]) => k === 'ifbin' ? 'JIF ' + BINS[+v][2] : k === 'entry' ? '文献 ID ' + v : k === 'author' ? (stats.authors.find(a => a.id === v) || {}).label || v : v).join(' · ') + '　→ ' + slice.filter(e => matchesFilter(e, matches, selection)).length + ' 条文献' }
      container.querySelectorAll('[data-year],[data-journal],[data-author],[data-term],[data-ifbin],[data-entry]').forEach(el => {
        const names = Object.keys(selection).filter(k => el.hasAttribute('data-' + k)); const active = names.length && names.every(k => selection[k] !== '' && el.getAttribute('data-' + k) === selection[k]); el.classList.toggle('is-selected', Boolean(active)); if (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON') el.setAttribute('aria-pressed', Boolean(active))
      })
    }
    function render() {
      slice = state.scope === 'all' ? entries : entries.filter(e => e.kind === state.scope); stats = analyze(slice, matches)
      let html = '<div class="metrics-toolbar"><nav class="metrics-tabs" aria-label="文献计量视图">' + [['overview','概览趋势'],['impact','期刊与 IF'],['authors','作者分析'],['network','关系网络']].map(([v, t]) => '<button data-tab="' + v + '" class="' + (state.tab === v ? 'is-active' : '') + '" aria-pressed="' + (state.tab === v) + '">' + t + '</button>').join('') + '</nav>' + selectOption('scope', [['all','全部类型'],...Object.entries(KIND)], '分析范围') + '</div><p class="metrics-context">图表统计：' + (state.scope === 'all' ? '全部类型' : KIND[state.scope]) + ' · ' + slice.length + ' 条。点击图形筛选下方清单；图表保留当前类型范围的全景。</p>'
      let content = ''
      if (state.tab === 'overview') {
        const base = C.analyze(slice)
        let offset = 0
        const types = '<div class="type-chart">' + svg(120, 120, '论文类型分布', '<circle cx="60" cy="60" r="43" fill="none" stroke="#edf1f6" stroke-width="17"/>' + base.kinds.map(k => { const length = k.count / Math.max(1, slice.length) * 270.177, c = '<circle cx="60" cy="60" r="43" fill="none" stroke="' + COLOR[k.kind] + '" stroke-width="17" stroke-dasharray="' + length + ' ' + (270.177 - length) + '" stroke-dashoffset="' + -offset + '" transform="rotate(-90 60 60)"/>'; offset += length; return c }).join('') + '<text x="60" y="64" text-anchor="middle" class="donut-total">' + slice.length + '</text>') + '<div>' + base.kinds.map(k => '<button class="type-legend" data-scope="' + k.kind + '"><i style="background:' + COLOR[k.kind] + '"></i><span>' + KIND[k.kind] + '</span><b>' + k.count + '</b></button>').join('') + '</div></div>'
        content = panel('发表时间', '年度柱形按论文类型堆叠，可切换累计曲线', '<div id="bibYears" class="chart-container">' + timeline(stats, state.time) + '</div>', true, selectOption('time', [['annual','年度分布'],['cumulative','累计曲线']], '时间视图')) + panel('论文类型', '有明确依据才分类；点击切换分析范围', '<div id="bibKinds">' + types + '</div>') + panel('合作概况', '统计当前文件中的作者署名，而非作者全部科研产出', '<div class="collaboration-stats"><strong>' + stats.authors.length + '<span>作者名称</span></strong><strong>' + stats.multi + '<span>多人合著条目</span></strong><strong>' + (slice.length - stats.missingAuthors ? (stats.authorships / (slice.length - stats.missingAuthors)).toFixed(1) : '—') + '<span>每篇作者数均值</span></strong></div><p class="help-text">缺作者 ' + stats.missingAuthors + ' 条。名称按原有顺序保守归并大小写与标点，未按 ORCID 消歧；同名可能是不同作者。</p>') + panel('期刊频率', '每篇贡献一次；频率反映这个文件的选文结构', '<div id="bibJournals">' + bars(stats.journals, 'journal', +state.top, slice.length, state.counting) + '</div>', true, topControl()) + panel('期刊 × 发表年份', '追踪参考文献的期刊来源随时间的变化', heatmap(stats, 'journal', +state.top), true)
      } else if (state.tab === 'impact') {
        const known = stats.ifRecords.length, statuses = stats.statuses
        content = panel('JIF 数据覆盖', '仅使用 ISSN、全称或库内缩写的唯一精确匹配', '<div class="coverage-summary"><strong>' + known + '<small> / ' + slice.length + ' 条</small></strong><span>' + (slice.length ? (known / slice.length * 100).toFixed(1) : '0.0') + '% 已匹配数值 JIF</span></div><div class="coverage-track"><i style="width:' + (slice.length ? known / slice.length * 100 : 0) + '%"></i></div><p class="help-text">缺载体 ' + (statuses['missing-venue'] || 0) + ' · 未匹配 ' + (statuses.unmatched || 0) + ' · 歧义 ' + (statuses.ambiguous || 0) + ' · 库中无数值 ' + (statuses['no-jif'] || 0) + (statuses['database-unavailable'] ? ' · 本地期刊库不可用 ' + statuses['database-unavailable'] : '') + '</p><p class="help-text">来源：插件本地 JCR 快照；JIF 数据年：' + esc(stats.ifYears.join('、') || '暂无可用数据') + '。名称匹配忽略大小写、标点与首部 The，不作模糊猜测。分布按文献条目计数，不是期刊去重计数。</p>', true) + panel('JIF 分布', '点击区间筛选文献；下方为最小值、四分位数、中位数与最大值', distribution(stats)) + panel('期刊频率', '高频不代表高影响力或更适合投稿', '<div id="bibJournals">' + bars(stats.journals, 'journal', +state.top, slice.length, state.counting) + '</div>', false, topControl()) + panel('发表年份 × JIF', '悬停查看文献与匹配来源，点击定位单条文献', scatter(stats), true)
      } else if (state.tab === 'authors') {
        content = panel('作者频率', '完整计数：每位作者每篇 +1；分数计数：每位作者每篇 +1/n', '<div id="bibAuthors">' + bars(stats.authors, 'author', +state.top, slice.length, state.counting) + '</div>', true, '<div class="mini-controls">' + selectOption('counting', [['full','完整计数'],['fractional','分数计数']], '计数方式') + topControl() + '</div>') + panel('作者 × 发表年份', '展示当前文件中前 ' + Math.min(+state.top, 15) + ' 位作者的年度条目频率（完整计数）', heatmap(stats, 'author', +state.top), true) + panel('如何解释作者统计', '姓名与合作关系的可确认范围', '<p class="help-text">仅依据 BibTeX 的 author 字段。去除 others / et al 等占位符，同篇同名只计一次；保留变音符号，不把姓名缩写自动扩展为全名。团体署名可能作为名称节点出现。没有 ORCID、机构与引文数据时，不推算作者身份、h-index、被引量或机构排名。</p>', true)
      } else {
        lastNet = network(slice, stats, state.network, +state.nodes, +state.threshold, state.counting)
        content = panel(state.network === 'author' ? '作者合作网络' : '主题共现网络', '拖动空白区域平移，滚轮缩放；点击节点筛选文献，悬停查看权重', '<div class="network-options">' + selectOption('network', [['author','作者合作'],['term','主题共现']], '关系类型') + selectOption('nodes', [['20','前 20'],['30','前 30'],['50','前 50'],['80','前 80']], '节点数量') + selectOption('threshold', [['1','≥ 1 条'],['2','≥ 2 条'],['3','≥ 3 条'],['5','≥ 5 条']], '共同文献阈值') + selectOption('counting', [['full','完整计数'],['fractional','分数计数']], '连线权重') + selectOption('color', [['component','连通分量'],['year','平均年份']], '节点颜色') + '</div><div class="action-row network-tools"><button class="secondary" data-zoom="out" aria-label="缩小图谱">−</button><button class="text-button" data-zoom="fit">适应</button><button class="secondary" data-zoom="in" aria-label="放大图谱">＋</button><span class="help-text">最多展示 240 条最强连线；完整计数为共同篇数，分数连线每篇贡献 1/(n−1)。</span></div><div id="bibGraph" class="network-canvas graph-container">' + networkSvg(lastNet, state.network, state.color, selection) + '</div><p class="help-text">' + (state.network === 'author' ? 'n 为该篇有效署名数；作者产出与合作连线使用不同的分数权重。' : 'n 为该篇去重后保留的标题 / 关键词词项数；通用词已过滤。主题共现不代表引用、因果或研究质量。') + '网络布局为确定性弹簧布局；连通分量只描述显示子图。</p>', true)
      }
      html += '<div class="metrics-selection" hidden><span></span><button class="text-button" data-selection-reset>清空图形筛选</button><button class="text-button" data-selection-locate>查看清单 ↓</button></div><div class="chart-grid metrics-grid">' + content + '</div>'
      container.innerHTML = html; paintSelection(); bindCanvas()
    }
    function bindCanvas() {
      const canvas = container.querySelector('.network-canvas'), graph = canvas && canvas.querySelector('svg'); if (!graph) return
      let vx = 0, vy = 0, zoom = state.zoom, drag = null, dragged = false
      function update() { graph.setAttribute('viewBox', [vx, vy, 900 / zoom, 530 / zoom].join(' ')); state.zoom = zoom }
      update()
      container.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { const mode = b.dataset.zoom; if (mode === 'fit') { vx = 0; vy = 0; zoom = 1 } else { const next = Math.max(.6, Math.min(5, zoom * (mode === 'in' ? 1.25 : .8))); vx += (900 / zoom - 900 / next) / 2; vy += (530 / zoom - 530 / next) / 2; zoom = next }; update() })
      graph.addEventListener('wheel', e => { e.preventDefault(); const rect = graph.getBoundingClientRect(), fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height, next = Math.max(.6, Math.min(5, zoom * (e.deltaY < 0 ? 1.12 : .89))); vx += fx * (900 / zoom - 900 / next); vy += fy * (530 / zoom - 530 / next); zoom = next; update() }, { passive: false })
      graph.onpointerdown = e => { if (e.button !== 0 || e.target.closest('[role="button"]')) return; drag = { x: e.clientX, y: e.clientY, vx, vy }; dragged = false; if (graph.setPointerCapture) graph.setPointerCapture(e.pointerId) }
      graph.onpointermove = e => { if (!drag) return; const rect = graph.getBoundingClientRect(), dx = e.clientX - drag.x, dy = e.clientY - drag.y; dragged = dragged || Math.abs(dx) + Math.abs(dy) > 4; vx = drag.vx - dx / rect.width * 900 / zoom; vy = drag.vy - dy / rect.height * 530 / zoom; update() }
      graph.onpointerup = () => { drag = null }
      graph.onpointercancel = () => { drag = null }
      graph.addEventListener('click', e => { if (dragged) { e.stopPropagation(); dragged = false } })
    }
    container.onclick = e => {
      if (e.target.closest('[data-selection-reset]')) { Object.keys(selection).forEach(k => { selection[k] = '' }); notify(); if (state.tab === 'network') render(); return }
      if (e.target.closest('[data-selection-locate]')) { if (config.onLocate) config.onLocate(); return }
      const tab = e.target.closest('[data-tab]'); if (tab) { state.tab = tab.dataset.tab; render(); return }
      const scope = e.target.closest('[data-scope]'); if (scope) { state.scope = scope.dataset.scope; if (config.onScope) config.onScope(state.scope); render(); return }
      const el = e.target.closest('[data-year],[data-journal],[data-author],[data-term],[data-ifbin],[data-entry]'); if (!el) return
      const keys = Object.keys(selection).filter(k => el.hasAttribute('data-' + k)), same = keys.every(k => selection[k] === el.getAttribute('data-' + k))
      keys.forEach(k => { selection[k] = same ? '' : el.getAttribute('data-' + k) }); notify()
      if (state.tab === 'network') render()
    }
    container.onchange = e => { const el = e.target.closest('[data-option]'); if (!el) return; state[el.dataset.option] = el.value; if (el.dataset.option === 'scope' && config.onScope) config.onScope(state.scope); render() }
    container.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('svg [role="button"]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })) } }
    render()
    return { setSelection(value) { selection = { ...selection, ...value }; if (state.tab === 'network') render(); else paintSelection() }, setScope(value) { state.scope = value; render() }, refresh() { render() }, getState() { return { ...state } }, getStats() { return stats } }
  }
  return { KIND, BINS, authorKey, uniqueAuthors, numericJif, matchJournals, analyze, network, layout, matchesFilter, mount }
})
