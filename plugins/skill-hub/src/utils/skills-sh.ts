import type { Skill } from '../types'
import { parseFrontmatter } from './frontmatter'

const BASE = 'https://skills.sh'

// ── Filter definitions (like PromptHub) ──

export interface LeaderboardFilter {
  key: string
  label: string
  path: string
}

export const LEADERBOARD_FILTERS: LeaderboardFilter[] = [
  { key: 'all', label: '全部', path: '/' },
  { key: 'trending', label: '趋势', path: '/trending' },
  { key: 'hot', label: '热门', path: '/hot' },
]

export function getFilterByKey(key: string): LeaderboardFilter {
  return LEADERBOARD_FILTERS.find((f) => f.key === key) || LEADERBOARD_FILTERS[0]
}

// ── Data types ──

export interface LeaderboardEntry {
  owner: string
  repo: string
  skillName: string
  detailPath: string
  detailUrl: string
  installs: number
}

export interface SkillDetailRaw {
  name: string
  description: string
  content: string
}

export interface SkillDetailMeta extends SkillDetailRaw {
  githubStars?: string
  weeklyInstalls?: string
}

// ── Error ──

class SkillsShError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'SkillsShError'
  }
}

// ── HTTP helper ──

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'User-Agent': 'skill-hub' } })
  if (!resp.ok) throw new SkillsShError(resp.status, `HTTP ${resp.status}`)
  return resp.text()
}

// ── HTML normalization ──

function normalizeHtml(html: string): string {
  return html.replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function stripTags(input: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      input
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6|pre|code)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ).replace(/[ \t]{2,}/g, ' '),
  )
}

function htmlToText(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|header|footer|aside|main|nav|li|ul|ol|h1|h2|h3|h4|h5|h6|pre|code|blockquote|table|thead|tbody|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n'),
  )
}

// ── Section parsing ──

function getSectionLines(text: string, heading: string, stopHeadings: string[]): string[] {
  const lines = text.split('\n').map((l) => l.trim())
  const startIdx = lines.findIndex((l) => l.toLowerCase() === heading.toLowerCase())
  if (startIdx === -1) return []
  const stopSet = new Set(stopHeadings.map((h) => h.toLowerCase()))
  const collected: string[] = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (stopSet.has(lines[i].toLowerCase())) break
    collected.push(lines[i])
  }
  return collected
}

function normalizeSectionContent(lines: string[]): string {
  return normalizeWhitespace(lines.join('\n'))
}

function extractSimpleMetric(text: string, heading: string): string | undefined {
  const lines = getSectionLines(text, heading, ['Summary', 'SKILL.md', 'Weekly Installs', 'Repository', 'GitHub Stars', 'Installed on', 'Security audits'])
  return lines.length ? lines[0] : undefined
}

function extractInstalledOnAgents(lines: string[]): string[] {
  return lines
    .map((l) => l.match(/^([a-z0-9-]+)\s+\d+/i)?.[1]?.toLowerCase() ?? null)
    .filter((v): v is string => Boolean(v))
}

// ── Leaderboard HTML scraping ──

export interface LeaderboardResult {
  entries: LeaderboardEntry[]
  totalCount: number
}

function parseSkillsShTotalCount(html: string): number {
  const m = html.match(/"totalSkills"\s*:\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  const m2 = html.match(/(\d[\d,]*)\s*skills?/i)
  if (m2) return parseInt(m2[1].replace(/,/g, ''), 10)
  return 0
}

export async function fetchLeaderboard(filterKey?: string): Promise<LeaderboardResult> {
  const filter = getFilterByKey(filterKey || 'all')
  const url = `${BASE}${filter.path}`
  const html = normalizeHtml(await fetchText(url))
  const entries: LeaderboardEntry[] = []
  const seen = new Set<string>()

  const linkRe = /<a[^>]+href="(\/[^"']+\/[^"']+\/[^"']+\/?)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) {
    const path = m[1].replace(/\/+/g, '/').replace(/\/$/, '')
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 3) continue
    const owner = parts[0]
    const repo = parts[1]
    const anchorText = m[2]
    const h3Match = anchorText.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
    const skillName = h3Match ? decodeHtmlEntities(stripTags(h3Match[1])).trim() : (stripTags(decodeHtmlEntities(anchorText)).trim() || parts[2])
    const key = `${owner}/${repo}/${skillName}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ owner, repo, skillName, detailPath: path, detailUrl: `${BASE}${path}`, installs: 0 })
  }

  if (entries.length === 0) {
    const dataRe = /"source":"([^"]+)","skillId":"([^"]+)","name":"([^"]+)"/g
    while ((m = dataRe.exec(html)) !== null) {
      const [owner, repo] = m[1].split('/')
      const name = m[3]
      const key = `${owner}/${repo}/${name}`
      if (!owner || !repo || seen.has(key)) continue
      seen.add(key)
      entries.push({ owner, repo, skillName: name, detailPath: `/${m[1]}/${m[2]}`, detailUrl: `${BASE}/${m[1]}/${m[2]}`, installs: 0 })
    }
  }

  const filtered = entries.filter((e) => e.owner !== 'site')
  const totalCount = filtered.length
  return { entries: filtered, totalCount }
}

// ── Detail page scraping (like PromptHub) ──

export async function fetchDetailPageHtml(entry: LeaderboardEntry): Promise<string> {
  return fetchText(entry.detailUrl)
}

function htmlToMarkdown(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
        .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```')
        .replace(/<pre>([\s\S]*?)<\/pre>/gi, '```\n$1\n```')
        .replace(/<h([1-6])[^>]*>(.+?)<\/h\1>/gi, (_, level, content) => '#'.repeat(Number(level)) + ' ' + content)
        .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
        .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
        .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
        .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
        .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
        .replace(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
        .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, '![]($1)')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|header|footer|aside|main|nav|li|ul|ol|h[1-6]|pre|code|blockquote|table|thead|tbody|tr)>/gi, '\n')
        .replace(/<hr\s*\/?>/gi, '\n---\n')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n'),
  )
}

export function parseDetailPage(html: string, entry: LeaderboardEntry): SkillDetailMeta | null {
  const md = htmlToMarkdown(html)
  const summary = normalizeSectionContent(
    getSectionLines(md, 'Summary', ['SKILL.md', 'Installs', 'Repository', 'GitHub Stars', 'First Seen', 'Security Audits']),
  )
  const skillMd = normalizeSectionContent(
    getSectionLines(md, 'SKILL.md', ['Related skills', 'Installs', 'Repository', 'GitHub Stars', 'First Seen', 'Security Audits']),
  )

  if (!summary && !skillMd) return null

  const repository = extractSimpleMetric(md, 'Repository') || `${entry.owner}/${entry.repo}`
  const weeklyInstalls = extractSimpleMetric(md, 'Installs') || ''
  const githubStars = extractSimpleMetric(md, 'GitHub Stars')

  const fm = parseFrontmatter(skillMd)
  const name = fm.name || entry.skillName
  const description = summary || fm.description || `${name} community skill`

  return {
    name,
    description,
    content: skillMd || `# ${name}\n\n${description}`,
    githubStars,
    weeklyInstalls,
  }
}

// ── Fetch skill detail (from skills.sh, not GitHub raw) ──

export async function fetchSkillDetail(entry: LeaderboardEntry): Promise<SkillDetailRaw | null> {
  try {
    const html = await fetchDetailPageHtml(entry)
    return parseDetailPage(html, entry)
  } catch {
    return null
  }
}

export async function fetchSkillDetailFromSkill(skill: Skill): Promise<SkillDetailRaw | null> {
  if (!skill.repo) return null
  const parts = skill.repo.split('/')
  if (parts.length < 2) return null
  const entry: LeaderboardEntry = {
    owner: parts[0],
    repo: parts[1],
    skillName: skill.name,
    detailPath: `/${parts[0]}/${parts[1]}/${skill.path || skill.name.toLowerCase().replace(/\s+/g, '-')}`,
    detailUrl: `${BASE}/${parts[0]}/${parts[1]}/${skill.path || skill.name.toLowerCase().replace(/\s+/g, '-')}`,
    installs: skill.installCount || 0,
  }
  return fetchSkillDetail(entry)
}

// ── Search ──

export interface PublicSearchResult {
  name: string
  source: string
  installs: number
}

export async function searchSkillsSh(q: string): Promise<PublicSearchResult[]> {
  if (!q || q.length < 1) return []
  const url = `https://skills.sh/api/search?q=${encodeURIComponent(q)}`
  const resp = await fetch(url, { headers: { 'User-Agent': 'skill-hub', Accept: 'application/json' } })
  if (!resp.ok) throw new SkillsShError(resp.status, `search API error: ${resp.status}`)
  const body = await resp.json()
  return body.skills || []
}

// ── Converters ──

export function leaderboardEntryToSkill(e: LeaderboardEntry): Skill {
  const dirName = e.detailPath.split('/').filter(Boolean).pop() || e.skillName.toLowerCase().replace(/\s+/g, '-')
  return {
    id: `${e.owner}/${e.repo}/${dirName}`,
    name: e.skillName,
    description: '',
    author: e.owner,
    tags: [],
    format: 'generic',
    source: 'skills-sh',
    repo: `${e.owner}/${e.repo}`,
    path: dirName,
    installCount: e.installs,
  }
}

export function searchResultToSkill(s: PublicSearchResult): Skill {
  const parts = s.source.split('/')
  const owner = parts[0] || ''
  const slug = s.name.toLowerCase().replace(/\s+/g, '-')
  return {
    id: `${s.source}/${slug}`,
    name: s.name,
    description: '',
    author: owner,
    tags: [],
    format: 'generic',
    source: 'skills-sh',
    repo: s.source,
    path: slug,
    installCount: s.installs,
  }
}

// ── GitHub download helpers ──

export function getGitHubRepo(skill: Skill): { owner: string; repo: string } | null {
  if (!skill.repo) return null
  const parts = skill.repo.split('/')
  if (parts.length < 2) return null
  return { owner: parts[0], repo: parts[1] }
}
