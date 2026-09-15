import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
const workspace = require('../public/preload/services.js')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'znotes-benchmark-'))
const noteCount = 500

function flattenNotes(entries) {
  return entries.flatMap((entry) => entry.kind === 'directory' ? flattenNotes(entry.children) : [entry])
}

async function measure(name, run) {
  const startedAt = performance.now()
  const result = await run()
  return { name, milliseconds: Number((performance.now() - startedAt).toFixed(1)), result }
}

try {
  await workspace.createWorkspace(root, '性能测试工作区')
  const paragraph = '这是一段用于性能测试的 Markdown 正文，包含列表、链接和代码。\n\n- 项目一\n- 项目二\n\n```ts\nconst value = 1\n```\n\n'
  const contentBlock = paragraph.repeat(45)
  const writes = []
  for (let index = 0; index < noteCount; index += 1) {
    const group = `分组-${String(index % 10).padStart(2, '0')}`
    const section = `层级-${String(Math.floor(index / 10) % 5).padStart(2, '0')}`
    const directory = path.join(root, group, section)
    const noteName = `笔记-${String(index).padStart(4, '0')}.md`
    const marker = index === 437 ? '\n# 特殊性能命中标题\n正文唯一标记 performance-needle\n' : ''
    writes.push(fs.mkdir(directory, { recursive: true }).then(() => (
      fs.writeFile(path.join(directory, noteName), `# 笔记 ${index}\n\n${contentBlock}${marker}`, 'utf8')
    )))
  }
  await Promise.all(writes)

  const memoryBefore = process.memoryUsage().heapUsed
  const measurements = []
  measurements.push(await measure('首次扫描', () => workspace.scanWorkspace(root)))
  measurements.push(await measure('重复扫描', () => workspace.scanWorkspace(root)))
  measurements.push(await measure('文件名搜索', () => workspace.searchWorkspace(root, '笔记-0437')))
  measurements.push(await measure('正文搜索', () => workspace.searchWorkspace(root, 'performance-needle')))
  const memoryAfter = process.memoryUsage().heapUsed

  const scan = measurements[0].result
  const output = {
    notes: flattenNotes(scan.entries).length,
    approximateMarkdownMegabytes: Number(((contentBlock.length * noteCount) / 1024 / 1024).toFixed(1)),
    heapGrowthMegabytes: Number(((memoryAfter - memoryBefore) / 1024 / 1024).toFixed(1)),
    timings: Object.fromEntries(measurements.map((item) => [item.name, item.milliseconds])),
    filenameMatches: measurements[2].result.length,
    bodyMatches: measurements[3].result.length,
  }
  console.log(JSON.stringify(output, null, 2))
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
