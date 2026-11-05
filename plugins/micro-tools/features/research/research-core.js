/* Pure local analysis. Browser + CommonJS; no requests and no persistent storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ResearchCore = factory()
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict'
  const MONTHS = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' }
  function plain(value) {
    return String(value || '').replace(/&(amp|quot|apos|lt|gt);/g, (_, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[entity])).replace(/\\(["'`^~=.uvHck])\s*\{?([A-Za-z])\}?/g, (_, accent, char) => {
      const mark = { '"': '\u0308', "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303', '=': '\u0304', '.': '\u0307', u: '\u0306', v: '\u030c', H: '\u030b', c: '\u0327', k: '\u0328' }[accent]
      return (char + (mark || '')).normalize('NFC')
    }).replace(/\\(ae|AE|oe|OE|ss|o|O|l|L)(?![a-z])/g, (_, c) => ({ ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', ss: 'ß', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł' }[c]))
      .replace(/\\(?:url|href|textit|textbf|emph|textrm|textsc)\s*/g, '')
      .replace(/\\([&%_$#])/g, '$1').replace(/[{}]/g, '').replace(/\\[a-zA-Z]+\s*/g, '')
      .replace(/~/g, ' ').replace(/\s+/g, ' ').trim()
  }
  function parseBibtex(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('请选择有内容的 .bib 文件。')
    if (text.length > 8 * 1024 * 1024) throw new Error('文件超过 8 MB，请分批导入。')
    const entries = [], warnings = [], macros = Object.assign(Object.create(null), MONTHS)
    let pos = 0
    while (pos < text.length) {
      const at = text.indexOf('@', pos)
      if (at < 0) break
      const lineStart = text.lastIndexOf('\n', at) + 1
      if (text.slice(lineStart, at).includes('%')) { const lineEnd = text.indexOf('\n', at); pos = lineEnd < 0 ? text.length : lineEnd + 1; continue }
      const header = /^@([a-zA-Z]+)\s*([{(])/.exec(text.slice(at))
      if (!header) { pos = at + 1; continue }
      const type = header[1].toLowerCase(), open = header[2], close = open === '{' ? '}' : ')'
      let i = at + header[0].length, depth = 0, quoted = false, end = -1
      for (; i < text.length; i++) {
        const c = text[i]
        if (c === '\\') { i++; continue }
        if (c === '"' && depth === 0) { quoted = !quoted; continue }
        if (c === '{') depth++
        else if (c === '}') { if (depth > 0) depth--; else if (!quoted && close === '}') { end = i; break } }
        else if (c === close && depth === 0 && !quoted) { end = i; break }
      }
      if (end < 0) throw new Error('BibTeX 条目未闭合，位置约 ' + at + '：' + header[0])
      const body = text.slice(at + header[0].length, end)
      pos = end + 1
      if (type === 'comment' || type === 'preamble') continue
      const comma = body.indexOf(',')
      const key = type === 'string' ? '' : (comma < 0 ? body : body.slice(0, comma)).trim()
      const fields = Object.create(null)
      let p = type === 'string' ? 0 : comma < 0 ? body.length : comma + 1
      function skip() { while (p < body.length) { if (/[\s,]/.test(body[p])) p++; else if (body[p] === '%') { const nl = body.indexOf('\n', p); p = nl < 0 ? body.length : nl + 1 } else break } }
      function atom() {
        while (/\s/.test(body[p] || '') && p < body.length) p++
        const start = p, c = body[p]
        if (c === '{') {
          p++; const a = p; let d = 1
          while (p < body.length && d) {
            if (body[p] === '\\') { p += 2; continue }
            if (body[p] === '{') d++
            if (body[p] === '}') d--
            p++
          }
          if (d) throw new Error('字段未闭合：' + key)
          return body.slice(a, p - 1)
        }
        if (c === '"') {
          p++; const a = p; let d = 0
          while (p < body.length) {
            if (body[p] === '\\') { p += 2; continue }
            if (body[p] === '{') d++
            if (body[p] === '}') d--
            if (body[p] === '"' && d === 0) break
            p++
          }
          if (p >= body.length) throw new Error('引号字段未闭合：' + key)
          return body.slice(a, p++)
        }
        while (p < body.length && !/[,#\s]/.test(body[p])) p++
        const raw = body.slice(start, p)
        return macros[raw.toLowerCase()] == null ? raw : macros[raw.toLowerCase()]
      }
      while (p < body.length) {
        skip(); if (p >= body.length) break
        const f = /^([\w:-]+)\s*=\s*/.exec(body.slice(p))
        if (!f) { warnings.push((key || '@string') + '：忽略无法识别的字段片段'); break }
        p += f[0].length
        let value = atom()
        while (p < body.length) {
          while (/\s/.test(body[p] || '') && p < body.length) p++
          if (body[p] !== '#') break
          p++; value += atom()
        }
        fields[f[1].toLowerCase()] = value
      }
      if (type === 'string') { Object.keys(fields).forEach(k => { macros[k] = fields[k] }); continue }
      if (!key) { warnings.push('跳过没有 citation key 的条目'); continue }
      const f = Object.create(null)
      Object.keys(fields).forEach(k => { f[k] = plain(fields[k]) })
      const yearString = f.year || f.date || ''
      const yearMatch = /(?:^|\D)(1[5-9]\d{2}|20\d{2}|2100)(?:\D|$)/.exec(yearString)
      const entry = {
        id: entries.length, key, bibType: type, title: f.title || '',
        authors: authors(fields.author || fields.editor || ''),
        journal: f.journal || f.journaltitle || f.booktitle || '',
        year: yearMatch ? Number(yearMatch[1]) : null,
        doi: (f.doi || '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim(),
        abstract: f.abstract || '', keywords: f.keywords || f.keyword || '',
        url: f.url || '', fields: f
      }
      Object.assign(entry, classify(entry))
      entries.push(entry)
      if (entries.length > 3000) throw new Error('单次最多分析 3000 条文献，请分批导入。')
    }
    if (!entries.length) throw new Error('未找到有效 BibTeX 条目，请检查文件格式。')
    const seenKeys = new Set(), seen = new Map()
    entries.forEach(e => {
      if (seenKeys.has(e.key)) warnings.push('重复 citation key：' + e.key)
      seenKeys.add(e.key)
      const identity = e.doi ? 'doi:' + e.doi.toLowerCase() : e.title ? 'title:' + normalize(e.title) : ''
      if (identity && seen.has(identity)) { e.duplicateOf = seen.get(identity); warnings.push('可能重复：' + e.key) }
      else if (identity) seen.set(identity, e.key)
    })
    return { entries, warnings: Array.from(new Set(warnings)) }
  }
  function authors(raw) {
    let depth = 0, start = 0; const names = []
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\\') { i++; continue }
      if (raw[i] === '{') depth++
      if (raw[i] === '}') depth--
      const match = depth === 0 && /^\s+and\s+/i.exec(raw.slice(i))
      if (match) { names.push(plain(raw.slice(start, i))); i += match[0].length - 1; start = i + 1 }
    }
    names.push(plain(raw.slice(start)))
    return names.filter(Boolean)
  }
  function classify(e) {
    const explicit = [e.fields.type, e.fields.genre, e.fields.pubtype, e.fields['article-type']].filter(Boolean).join(' ')
    if (/\breview\b|综述|meta[- ]analysis/i.test(explicit)) return { kind: 'review', kindSource: 'metadata', kindReason: '文件类型字段：' + explicit }
    if (/research article|original (?:article|research)|研究论文/i.test(explicit)) return { kind: 'research', kindSource: 'metadata', kindReason: '文件类型字段：' + explicit }
    if (/\breview\b|meta[- ]analysis|综述|系统评价/i.test(e.title)) return { kind: 'review', kindSource: 'title', kindReason: '标题包含综述/Meta-analysis 线索，待复核' }
    if (/\b(editorial|correction|erratum|retraction|commentary)\b/i.test(e.title + ' ' + explicit)) return { kind: 'other', kindSource: 'title', kindReason: '标题/类型字段中的文献类型线索' }
    if (['book', 'inbook', 'incollection', 'phdthesis', 'mastersthesis', 'techreport'].includes(e.bibType)) return { kind: 'other', kindSource: 'metadata', kindReason: 'BibTeX 类型：' + e.bibType }
    return { kind: 'unknown', kindSource: 'unknown', kindReason: 'BibTeX 的 @article/@misc 不等于研究论文类型' }
  }
  function normalize(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '') }
  const STOP = new Set(('a an and are as at be been by for from in into is it its of on or our the their these this to toward towards using use used via was were with within without across along between during under through over than that based effects effect study studies insights insight understanding response responses role roles patterns pattern implications new novel high low northern early late specific distinct diverse diversity different combined comprehensive approach approaches analysis analyses journal article review research microbial microbes communities community soil soils ecosystem ecosystems').split(' '))
  const STEM = { glaciers: 'glacier', glacial: 'glacier', forefields: 'forefield', forelands: 'foreland', microorganisms: 'microorganism', bacteria: 'bacterial', fungi: 'fungal', genes: 'gene', warming: 'warming', dynamics: 'dynamics', plants: 'plant', nutrients: 'nutrient', systems: 'system' }
  function terms(text) {
    return Array.from(new Set((String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z][a-z-]{2,}|[\u4e00-\u9fff]{2,8}/g) || [])
      .map(t => STEM[t] || t).filter(t => !STOP.has(t) && t.length > 2)))
  }
  function count(items) {
    const map = new Map()
    items.forEach(x => { if (x) { const k = String(x).toLowerCase(); const old = map.get(k); map.set(k, { label: old ? old.label : String(x), count: old ? old.count + 1 : 1 }) } })
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }
  function analyze(entries) {
    const yearItems = count(entries.map(e => e.year)).sort((a, b) => Number(a.label) - Number(b.label))
    const tokenLists = entries.map(e => terms(e.title + ' ' + e.keywords))
    const termCounts = count(tokenLists.flat()), top = termCounts.slice(0, 18)
    const labels = new Set(top.map(x => x.label)), links = new Map()
    tokenLists.forEach(ts => {
      const unique = Array.from(new Set(ts.filter(t => labels.has(t)))).sort()
      for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
        const key = unique[i] + '|' + unique[j]; links.set(key, (links.get(key) || 0) + 1)
      }
    })
    const kinds = ['review', 'research', 'unknown', 'other'].map(kind => ({ kind, count: entries.filter(e => e.kind === kind).length }))
    return {
      total: entries.length, years: yearItems, journals: count(entries.map(e => e.journal)),
      authors: count(entries.flatMap(e => e.authors)), kinds,
      inferred: entries.filter(e => e.kindSource === 'title' || e.kindSource === 'ai').length,
      missing: { title: entries.filter(e => !e.title).length, year: entries.filter(e => !e.year).length, journal: entries.filter(e => !e.journal).length, doi: entries.filter(e => !e.doi).length, abstract: entries.filter(e => !e.abstract).length },
      duplicates: entries.filter(e => e.duplicateOf).length,
      graph: { nodes: top.map(t => ({ id: t.label, count: t.count })), links: Array.from(links).filter(x => x[1] >= 2).map(([key, weight]) => ({ source: key.split('|')[0], target: key.split('|')[1], weight })).sort((a, b) => b.weight - a.weight).slice(0, 55) },
      tokenLists
    }
  }
  function candidates(api, profile, options = {}) {
    api.ensureLoaded()
    const includeGeneral = options.include_general !== false, range = options.if_range || {}
    const bounded = range.min != null || range.max != null
    const generalNames = new Set(['Nature', 'Science', 'Nature Communications', 'Science Advances', 'Proceedings of the National Academy of Sciences of the United States of America', 'Scientific Reports', 'PLOS ONE', 'National Science Review'].map(normalize))
    const isGeneral = r => generalNames.has(normalize(r.name)) || /\bMULTIDISCIPLINARY SCIENCES\b/i.test((r.category || '') + ' ' + (r.catDetail || ''))
    const allowed = r => {
      if (!r || r._conf || (!includeGeneral && isGeneral(r))) return false
      const value = r.jif == null || String(r.jif).trim() === '' ? NaN : Number(r.jif)
      return !bounded || (Number.isFinite(value) && (range.min == null || value >= range.min) && (range.max == null || value <= range.max))
    }
    const seeds = new Set(), scored = new Map()
    ;(profile.journal_seeds || []).slice(0, 12).forEach(name => {
      const matches = api.search(String(name), 8, 'journal')
      const exact = matches.filter(r => normalize(r.name) === normalize(name) || normalize(r.abbr) === normalize(name))
      ;(exact.length ? exact : matches.slice(0, 2)).filter(allowed).forEach(r => { seeds.add(r._i); scored.set(r._i, { r, score: 30, source: '研究画像线索' }) })
    })
    // Journal subjects need broader terms than the co-word graph's stop list.
    const queryTerms = Array.from(new Set((profile.search_terms || []).flatMap(s => String(s).toLowerCase().match(/[a-z][a-z-]{2,}/g) || []))).filter(t => !['and','the','for','with','from','research','study'].includes(t))
    const matchers = queryTerms.map(t => new RegExp('\\b' + t + '\\b'))
    const reserved = []
    for (let i = 0; i < api.allTotal; i++) {
      const r = api.get(i); if (!allowed(r)) continue
      if (includeGeneral && generalNames.has(normalize(r.name))) reserved.push({ r, score: 0, source: '综合期刊比较池' })
      const hay = (r.name + ' ' + (r.category || '') + ' ' + (r.catDetail || '') + ' ' + (r.ccfCat || '')).toLowerCase()
      let score = 0
      matchers.forEach(re => { if (re.test(hay)) score++ })
      if (score > 0 && !seeds.has(r._i)) scored.set(r._i, { r, score, source: '学科关键词匹配' })
    }
    // Reserve real, name-verified interdisciplinary journals before truncation.
    // Recall is intentionally broad; inclusion here does not imply suitability.
    const reservedIds = new Set(reserved.map(x => x.r._i))
    const selected = Array.from(scored.values()).filter(x => !reservedIds.has(x.r._i)).sort((a, b) => b.score - a.score || a.r._i - b.r._i).slice(0, Math.max(0, 65 - reserved.length))
    reserved.forEach(x => selected.push(scored.get(x.r._i) || x))
    return selected.sort((a, b) => b.score - a.score || a.r._i - b.r._i).map(x => ({
      id: x.r._i, name: x.r.name, publisher: x.r.publisher || '', category: x.r.category || '',
      catDetail: x.r.catDetail || '', is_general: isGeneral(x.r), recall_source: x.source,
      issn: x.r.issn || '', jif: x.r.jif, quartile: x.r.quartile || '', year: x.r.year || '',
      ccfRank: x.r.ccfRank || '', ccfCat: x.r.ccfCat || ''
    }))
  }
  function jsonResult(text) {
    if (typeof text !== 'string') throw new Error('模型未返回文本。')
    let raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
    try { const data = JSON.parse(raw); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data }
    catch (_) { throw new Error('模型未返回完整 JSON，请换用支持结构化输出的模型或重新分析。') }
  }
  function csv(entries, matches) {
    const rows = [['Citation key', 'Title', 'Year', 'Journal', 'Authors', 'DOI', 'Type', 'Type source', 'Type evidence'], ...entries.map(e => [e.key, e.title, e.year || '', e.journal, e.authors.join('; '), e.doi, e.kind, e.kindSource, e.kindReason])]
    if (matches) { rows[0].push('JIF (local snapshot)', 'JIF year', 'Journal match method', 'Journal match status'); entries.forEach((e, i) => { const m = matches[e.id] || {}; rows[i + 1].push(m.jif == null ? '' : m.jif, m.year || '', m.method || '', m.status || '') }) }
    return '\uFEFF' + rows.map(row => row.map(x => { let s = String(x == null ? '' : x); if (/^[=+@-]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"' }).join(',')).join('\r\n')
  }
  return { plain, parseBibtex, authors, classify, normalize, terms, analyze, candidates, jsonResult, csv }
})
