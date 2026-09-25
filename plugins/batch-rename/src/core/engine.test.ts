import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Intent = { id: string; sourcePath: string; targetName: string }
type Result = { results: Array<{ id: string; status: string; error?: string; actualPath: string }>; canUndo: boolean }
const require = createRequire(import.meta.url)
const engine = require('../../preload/engine.js') as {
  validatePlan: (items: Intent[]) => Promise<Array<{ id: string; status: string; error?: string }>>
  executePlan: (items: Intent[]) => Promise<Result>
  undo: () => Promise<Result>
  resetTask: () => void
}
const directories: string[] = []

beforeEach(() => engine.resetTask())
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixtures(names: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'batch-rename-engine-'))
  directories.push(directory)
  for (const [name, content] of Object.entries(names)) await writeFile(join(directory, name), content)
  return directory
}

function intent(directory: string, source: string, target: string): Intent {
  return { id: source, sourcePath: join(directory, source), targetName: target }
}

describe('安全改名与单级撤销', () => {
  it('同目录两个文件指向同一个目标时均标错', async () => {
    const directory = await fixtures({ 'A.txt': 'A', 'B.txt': 'B' })
    const checked = await engine.validatePlan([
      intent(directory, 'A.txt', 'C.txt'), intent(directory, 'B.txt', 'C.txt')
    ])
    expect(checked.map((item) => item.status)).toEqual(['error', 'error'])
  })

  it('两文件交换保持内容并可撤销', async () => {
    const directory = await fixtures({ 'A.txt': 'A-content', 'B.txt': 'B-content' })
    const plan = [intent(directory, 'A.txt', 'B.txt'), intent(directory, 'B.txt', 'A.txt')]
    expect((await engine.executePlan(plan)).results.map((item) => item.status)).toEqual(['success', 'success'])
    expect(await readFile(join(directory, 'A.txt'), 'utf8')).toBe('B-content')
    expect(await readFile(join(directory, 'B.txt'), 'utf8')).toBe('A-content')
    expect((await engine.undo()).results.map((item) => item.status)).toEqual(['success', 'success'])
  })

  it('交换与三文件循环保持每个文件的原内容', async () => {
    const directory = await fixtures({ 'A.txt': 'A-content', 'B.txt': 'B-content', 'C.txt': 'C-content' })
    const plan = [intent(directory, 'A.txt', 'B.txt'), intent(directory, 'B.txt', 'C.txt'), intent(directory, 'C.txt', 'A.txt')]
    expect((await engine.validatePlan(plan)).map((item) => item.status)).toEqual(['ready', 'ready', 'ready'])
    const outcome = await engine.executePlan(plan)
    expect(outcome.results.map((item) => item.status)).toEqual(['success', 'success', 'success'])
    expect(await readFile(join(directory, 'B.txt'), 'utf8')).toBe('A-content')
    expect(await readFile(join(directory, 'C.txt'), 'utf8')).toBe('B-content')
    expect(await readFile(join(directory, 'A.txt'), 'utf8')).toBe('C-content')
    const undone = await engine.undo()
    expect(undone.results.map((item) => item.status)).toEqual(['success', 'success', 'success'])
    expect(await readFile(join(directory, 'A.txt'), 'utf8')).toBe('A-content')
    expect(await engine.undo()).toMatchObject({ canUndo: false, results: [] })
  })

  it('占用目标绝不覆盖，其他文件继续执行', async () => {
    const directory = await fixtures({ 'A.txt': 'A', 'B.txt': 'B', 'occupied.txt': 'keep' })
    const result = await engine.executePlan([
      intent(directory, 'A.txt', 'occupied.txt'), intent(directory, 'B.txt', 'renamed.txt')
    ])
    expect(result.results.find((item) => item.id === 'A.txt')?.status).toBe('error')
    expect(result.results.find((item) => item.id === 'B.txt')?.status).toBe('success')
    expect(await readFile(join(directory, 'occupied.txt'), 'utf8')).toBe('keep')
    expect(await readFile(join(directory, 'A.txt'), 'utf8')).toBe('A')
    expect(await readFile(join(directory, 'renamed.txt'), 'utf8')).toBe('B')
    expect((await readdir(directory)).some((name) => name.startsWith('.ztools-rename-'))).toBe(false)
  })

  it('四个文件中一个目标冲突时其余三个成功', async () => {
    const directory = await fixtures({ 'A.txt': 'A', 'B.txt': 'B', 'C.txt': 'C', 'D.txt': 'D', 'occupied.txt': 'keep' })
    const result = await engine.executePlan([
      intent(directory, 'A.txt', 'occupied.txt'), intent(directory, 'B.txt', 'B-new.txt'),
      intent(directory, 'C.txt', 'C-new.txt'), intent(directory, 'D.txt', 'D-new.txt')
    ])
    expect(result.results.filter((item) => item.status === 'success')).toHaveLength(3)
    expect(result.results.filter((item) => item.status === 'error')).toHaveLength(1)
    expect(await readFile(join(directory, 'occupied.txt'), 'utf8')).toBe('keep')
  })

  it('仅改变文件名大小写后仍能撤销', async () => {
    const directory = await fixtures({ 'case.txt': 'same-content' })
    const result = await engine.executePlan([intent(directory, 'case.txt', 'CASE.txt')])
    expect(result.results[0].status).toBe('success')
    expect(await readdir(directory)).toEqual(['CASE.txt'])
    expect(await readFile(join(directory, 'CASE.txt'), 'utf8')).toBe('same-content')
    const undone = await engine.undo()
    expect(undone.results[0].status).toBe('success')
    expect(await readdir(directory)).toEqual(['case.txt'])
  })

  it('被跳过的源文件继续占用其名称，关联项一起跳过', async () => {
    const directory = await fixtures({ 'A.txt': 'A', 'B.txt': 'B', 'occupied.txt': 'keep' })
    const plan = [intent(directory, 'A.txt', 'B.txt'), intent(directory, 'B.txt', 'occupied.txt')]
    expect((await engine.validatePlan(plan)).map((item) => item.status)).toEqual(['error', 'error'])
    expect(await readFile(join(directory, 'A.txt'), 'utf8')).toBe('A')
    expect(await readFile(join(directory, 'B.txt'), 'utf8')).toBe('B')
  })

  it('关联组第二个目标写入失败时恢复整个交换', async () => {
    const directory = await fixtures({ 'A.txt': 'A-content', 'B.txt': 'B-content' })
    const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises')
    const originalLink = fsPromises.link
    let injected = false
    vi.spyOn(fsPromises, 'link').mockImplementation(async (source, target) => {
      if (!injected && String(source).includes('.ztools-rename-') && target === join(directory, 'A.txt')) {
        injected = true
        throw new Error('模拟目标写入失败')
      }
      return originalLink(source, target)
    })
    const result = await engine.executePlan([intent(directory, 'A.txt', 'B.txt'), intent(directory, 'B.txt', 'A.txt')])
    expect(result.results.map((item) => item.status)).toEqual(['error', 'error'])
    expect(await readFile(join(directory, 'A.txt'), 'utf8')).toBe('A-content')
    expect(await readFile(join(directory, 'B.txt'), 'utf8')).toBe('B-content')
    expect((await readdir(directory)).some((name) => name.startsWith('.ztools-rename-'))).toBe(false)
  })

  it('撤销时源文件被替换或旧名称被占用，逐项失败且不覆盖', async () => {
    const directory = await fixtures({ 'A.txt': 'A', 'B.txt': 'B' })
    await engine.executePlan([intent(directory, 'A.txt', 'X.txt'), intent(directory, 'B.txt', 'Y.txt')])
    await rm(join(directory, 'X.txt'))
    await writeFile(join(directory, 'X.txt'), 'new X')
    await writeFile(join(directory, 'B.txt'), 'external B')
    const undone = await engine.undo()
    expect(undone.results.filter((item) => item.status === 'error')).toHaveLength(2)
    expect(await readFile(join(directory, 'X.txt'), 'utf8')).toBe('new X')
    expect(await readFile(join(directory, 'B.txt'), 'utf8')).toBe('external B')
    expect(await readFile(join(directory, 'Y.txt'), 'utf8')).toBe('B')
  })

  it('撤销其中一项失败时继续恢复其他独立文件', async () => {
    const directory = await fixtures({ 'A.txt': 'A', 'B.txt': 'B' })
    await engine.executePlan([intent(directory, 'A.txt', 'X.txt'), intent(directory, 'B.txt', 'Y.txt')])
    await rm(join(directory, 'X.txt'))
    await writeFile(join(directory, 'X.txt'), 'replacement')
    const undone = await engine.undo()
    expect(undone.results.filter((item) => item.status === 'success')).toHaveLength(1)
    expect(undone.results.filter((item) => item.status === 'error')).toHaveLength(1)
    expect(await readFile(join(directory, 'B.txt'), 'utf8')).toBe('B')
    expect(await readFile(join(directory, 'X.txt'), 'utf8')).toBe('replacement')
  })

  it('连续执行两次只撤销第二次', async () => {
    const directory = await fixtures({ 'original.txt': 'content' })
    await engine.executePlan([intent(directory, 'original.txt', 'first.txt')])
    await engine.executePlan([intent(directory, 'first.txt', 'second.txt')])
    const result = await engine.undo()
    expect(result.results[0].status).toBe('success')
    expect(await readdir(directory)).toEqual(['first.txt'])
    expect((await engine.undo()).results).toEqual([])
  })

  it('四文件撤销中一项被人工换掉时其余三项恢复', async () => {
    const directory = await fixtures({ 'A.txt': 'A', 'B.txt': 'B', 'C.txt': 'C', 'D.txt': 'D' })
    const names = ['A', 'B', 'C', 'D']
    await engine.executePlan(names.map((name) => intent(directory, `${name}.txt`, `${name}-new.txt`)))
    await rm(join(directory, 'A-new.txt'))
    await writeFile(join(directory, 'A-new.txt'), 'replacement')
    const result = await engine.undo()
    expect(result.results.filter((item) => item.status === 'success')).toHaveLength(3)
    expect(result.results.filter((item) => item.status === 'error')).toHaveLength(1)
    for (const name of names.slice(1)) expect(await readFile(join(directory, `${name}.txt`), 'utf8')).toBe(name)
  })

  it('撤销旧名被外部文件占用时仍恢复另一项', async () => {
    const directory = await fixtures({ 'A.txt': 'A', 'B.txt': 'B' })
    await engine.executePlan([intent(directory, 'A.txt', 'X.txt'), intent(directory, 'B.txt', 'Y.txt')])
    await writeFile(join(directory, 'A.txt'), 'external')
    const result = await engine.undo()
    expect(result.results.filter((item) => item.status === 'success')).toHaveLength(1)
    expect(result.results.filter((item) => item.status === 'error')).toHaveLength(1)
    expect(await readFile(join(directory, 'A.txt'), 'utf8')).toBe('external')
    expect(await readFile(join(directory, 'B.txt'), 'utf8')).toBe('B')
  })
})
