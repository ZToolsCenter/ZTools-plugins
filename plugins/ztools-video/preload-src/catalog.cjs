const { parse } = require('parse5')

const ORIGIN = 'https://www.4kvm.tv'
const SLUG = /^[a-zA-Z0-9_-]{1,64}$/
const PLAY_ID = /^[1-9]\d{0,14}$/

function* nodes(root) {
  yield root
  for (const child of root.childNodes || []) yield* nodes(child)
}

function attr(node, key) {
  return node.attrs?.find((item) => item.name === key)?.value || ''
}

function content(node) {
  if (!node) return ''
  let text = ''
  for (const child of nodes(node)) if (child.nodeName === '#text') text += child.value
  return text.replace(/\s+/gu, ' ').trim()
}

function playSlug(href) {
  try {
    const url = new URL(href, ORIGIN)
    if (url.origin !== ORIGIN) return null
    const value = url.pathname.match(/^\/play\/([^/]+)\/?$/)?.[1]
    return value && SLUG.test(value) ? value : null
  } catch { return null }
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || !/^https:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch { return null }
}

function searchResults(html) {
  const results = new Map()
  for (const node of nodes(parse(html))) {
    if (node.tagName !== 'a' || !attr(node, 'data-vod')) continue
    const v = playSlug(attr(node, 'href'))
    if (!v || results.has(v)) continue
    const children = [...nodes(node)]
    const img = children.find((child) => child.tagName === 'img')
    const title = (content(children.find((child) => child.tagName === 'h3')) || (img && attr(img, 'alt')) || '').slice(0, 160)
    if (!title) continue
    const cover = img && (attr(img, 'data-src') || attr(img, 'src'))
    const year = children.find((child) => child.tagName === 'div' &&
      attr(child, 'class').split(/\s+/).includes('top-2') && /^\d{4}$/.test(content(child)))
    results.set(v, { v, title, cover: httpsUrl(cover) ? cover : null, year: content(year) || null })
    if (results.size >= 80) break
  }
  return [...results.values()]
}

function browseSections(html) {
  const main = [...nodes(parse(html))].find(node => node.tagName === 'main')
  if (!main) return []
  const sections = []
  let section
  let seen
  for (const node of nodes(main)) {
    if (node.tagName === 'h2') {
      const title = content(node).slice(0, 80)
      if (section?.items.length) sections.push(section)
      if (sections.length >= 8) return sections
      section = title ? { title, items: [] } : undefined
      seen = new Set()
      continue
    }
    if (!section || section.items.length >= 48 || !attr(node, 'class').split(/\s+/).includes('movie-card')) continue
    const children = [...nodes(node)]
    const link = children.find(child => child.tagName === 'a' && attr(child, 'data-vod') && playSlug(attr(child, 'href')))
    if (!link) continue
    const v = playSlug(attr(link, 'href'))
    const cover = [...nodes(link)].filter(child => child.tagName === 'img')
      .map(child => attr(child, 'data-src') || attr(child, 'src')).find(httpsUrl) || null
    const title = content(children.find(child => child.tagName === 'h3')).slice(0, 160)
    if (!title || seen.has(v)) continue
    const labels = children.filter(child => ['span', 'div'].includes(child.tagName) &&
      child.childNodes?.every(part => part.nodeName === '#text')).map(content)
    const year = labels.find(label => /^(?:19|20)\d{2}$/.test(label)) || null
    const progress = labels.find(label => /^(?:更新至|全)\s*\d+\s*集$/.test(label)) || null
    const rating = content(children.find(child => child.tagName === 'span' &&
      attr(child, 'class').split(/\s+/).includes('text-green-500')))
    seen.add(v)
    section.items.push({ v, title, cover, year, progress, rating: /^(?:\d(?:\.\d)?|10(?:\.0)?)$/.test(rating) ? rating : null })
  }
  if (section?.items.length) sections.push(section)
  return sections
}

function playPage(html, v) {
  const rows = new Map()
  const pMatches = new Set()
  let title = '', stamp = null, version = ''
  for (const node of nodes(parse(html))) {
    if (node.tagName === 'meta' && attr(node, 'property') === 'og:title') title = attr(node, 'content')
    if (node.tagName === 'meta' && attr(node, 'id') === 'nb-st') {
      const value = attr(node, 'content')
      if (/^\d{13}$/.test(value)) stamp = Number(value)
    }
    if (node.tagName === 'link' && attr(node, 'id') === 'wasm-cfg') version = attr(node, 'data-bg')
    if (node.tagName !== 'a') continue
    const slug = playSlug(attr(node, 'href'))
    const p = attr(node, 'dataid')
    if (!slug || !PLAY_ID.test(p)) continue
    if (slug === v) pMatches.add(p)
    const line = Number(attr(node, 'data-line'))
    const number = Number(attr(node, 'data-episode'))
    if (Number.isSafeInteger(line) && line > 0 && Number.isSafeInteger(number) && number > 0) {
      rows.set(slug, { v: slug, line, number })
    }
  }
  if (pMatches.size !== 1) throw new Error(pMatches.size ? '播放页返回了多个播放 ID。' : '没有找到这部影片或这一集的播放 ID。')
  if (!rows.has(v)) rows.set(v, { v, line: 1, number: 1 })
  const episodes = [...rows.values()].sort((a, b) => a.line - b.line || a.number - b.number)
  const selected = episodes.find((item) => item.v === v)
  const visitor = html.match(/\buserlink\s*:\s*'([a-zA-Z0-9+/=_-]{0,512})'/)?.[1] || '0'
  return {
    catalog: {
      title: (title.replace(/\s*-\s*第\s*\d+\s*集\s*$/u, '').trim() || '影片').slice(0, 160),
      episodes: episodes.slice(0, 2000),
      selected,
    },
    p: pMatches.values().next().value,
    stamp,
    version,
    visitor,
  }
}

module.exports = { ORIGIN, SLUG, searchResults, browseSections, playPage, httpsUrl }
