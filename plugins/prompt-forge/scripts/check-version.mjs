import { readFile } from 'node:fs/promises'

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
}

const packageInfo = await readJson('../package.json')
const packageLock = await readJson('../package-lock.json')
const rootManifest = await readJson('../plugin.json')
const publicManifest = await readJson('../public/plugin.json')
const roadmap = await readFile(new URL('../ROADMAP.md', import.meta.url), 'utf8')
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const version = packageInfo.version
const changelogVersion = changelog.match(/^## \[?([^\]\s]+)\]?\s+-/m)?.[1]

const mismatches = []
if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) mismatches.push('package-lock.json')
if (rootManifest.version !== version) mismatches.push(`plugin.json=${rootManifest.version}`)
if (publicManifest.version !== version) mismatches.push(`public/plugin.json=${publicManifest.version}`)
if (!roadmap.includes(`当前版本：v${version}`)) mismatches.push('ROADMAP.md 当前版本')
if (changelogVersion !== version) mismatches.push(`CHANGELOG.md=${changelogVersion || '缺失'}`)

if (mismatches.length) {
  throw new Error(`版本信息不一致：package.json=${version}；${mismatches.join('；')}`)
}

console.log(`版本一致性检查通过：v${version}`)
