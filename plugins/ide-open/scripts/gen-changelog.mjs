#!/usr/bin/env node
/**
 * 从 ztools-last-publish tag 之后的 commit 自动生成 CHANGELOG.md 条目
 * 约定 commit 格式: type(scope): message
 *   feat:     → Added
 *   fix:      → Fixed
 *   refactor: → Changed
 *   chore:    → (跳过，不记入)
 *   docs:     → (跳过)
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const TAG = 'ztools-last-publish'
const VERSION = JSON.parse(readFileSync('package.json', 'utf-8')).version

// 获取上次发布后的 commit messages
function getCommits() {
  let range
  try {
    // 检查 tag 是否存在
    execSync(`git rev-parse --verify refs/tags/${TAG}`, { stdio: 'pipe' })
    range = `${TAG}..HEAD`
  } catch {
    // tag 不存在，取所有 commit
    range = 'HEAD'
  }

  const log = execSync(`git log ${range} --pretty=format:"%s" --no-merges`, { encoding: 'utf-8' })
  return log.trim().split('\n').filter(Boolean)
}

const TYPE_MAP = {
  feat: 'Added',
  fix: 'Fixed',
  refactor: 'Changed',
  perf: 'Changed',
}

const groups = { Added: [], Fixed: [], Changed: [] }

for (const line of getCommits()) {
  const m = line.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/)
  if (!m) continue
  const [, type, scope, msg] = m
  const section = TYPE_MAP[type]
  if (!section) continue  // chore, docs, ci 等跳过
  const prefix = scope ? `**${scope}** ` : ''
  groups[section].push(`- ${prefix}${msg}`)
}

// 检查是否已有该版本条目
const existing = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf-8') : ''
if (existing.includes(`## ${VERSION}`)) {
  console.log(`CHANGELOG.md 中已存在 v${VERSION} 条目，跳过生成`)
  process.exit(0)
}

// 生成新条目
const sections = Object.entries(groups)
  .filter(([, items]) => items.length > 0)
  .map(([title, items]) => `### ${title}\n${items.join('\n')}`)
  .join('\n\n')

if (!sections) {
  console.log('没有可记录的变更（feat/fix/refactor）')
  process.exit(0)
}

const entry = `## ${VERSION}\n\n${sections}\n`
const output = existing
  ? existing.replace(/^# Changelog\n/, `# Changelog\n\n${entry}`)
  : `# Changelog\n\n${entry}`

writeFileSync('CHANGELOG.md', output)
console.log(`✓ 已生成 v${VERSION} 的 CHANGELOG 条目:`)
console.log(entry)
