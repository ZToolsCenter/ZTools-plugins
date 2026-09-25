import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

type ScanResult = { paths: string[]; errors: Array<{ path: string; message: string }> }
const require = createRequire(import.meta.url)
const { scanDirectory } = require('../../preload/scan.js') as {
  scanDirectory: (directoryPath: string) => Promise<ScanResult>
}
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'batch-rename-scan-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('preload 目录扫描', () => {
  it('递归收集普通文件，不把目录作为结果', async () => {
    const root = await createTemporaryDirectory()
    const nested = join(root, 'nested')
    await mkdir(nested)
    await writeFile(join(root, 'root.txt'), 'root')
    await writeFile(join(nested, 'child.txt'), 'child')

    const result = await scanDirectory(root)

    expect(result.paths.sort()).toEqual([join(root, 'root.txt'), join(nested, 'child.txt')].sort())
    expect(result.errors).toEqual([])
    expect(result.paths.some((filePath) => filePath === nested)).toBe(false)
  })

  it('跳过符号链接目录，不递归到链接目标', async () => {
    const root = await createTemporaryDirectory()
    const target = await createTemporaryDirectory()
    await writeFile(join(target, 'outside.txt'), 'outside')
    try {
      await symlink(target, join(root, 'linked'), 'junction')
    } catch (error) {
      if (process.platform === 'win32') throw error
      await symlink(target, join(root, 'linked'), 'dir')
    }

    const result = await scanDirectory(root)

    expect(result.paths).toEqual([])
    expect(result.errors).toEqual([])
    expect((await readdir(target))).toEqual(['outside.txt'])
  })

  it('拒绝相对路径', async () => {
    await expect(scanDirectory('relative/path')).rejects.toThrow('目录路径必须是绝对路径')
  })

  it('超过 10000 个文件时返回截断错误', async () => {
    const root = await createTemporaryDirectory()
    for (let index = 0; index <= 10000; index += 1) {
      await writeFile(join(root, `file-${index}.txt`), '')
    }

    const result = await scanDirectory(root)

    expect(result.paths).toHaveLength(10000)
    expect(result.errors).toContainEqual(expect.objectContaining({
      path: root,
      message: expect.stringContaining('文件数量超过上限 10000')
    }))
  }, 30000)
})
