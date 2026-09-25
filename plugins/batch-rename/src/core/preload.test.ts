import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileInfo } from './session'

type RenameService = { readFileInfos: (paths: string[]) => Promise<FileInfo[]> }
const require = createRequire(import.meta.url)
const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('preload 文件信息接口', () => {
  it('逐项返回元数据和错误，且不修改文件内容或名称', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'batch-rename-'))
    temporaryDirectories.push(directory)
    const sourcePath = join(directory, 'sample.txt')
    await writeFile(sourcePath, 'test content')

    vi.stubGlobal('window', {})
    require('../../preload/services.js')
    const service = (globalThis.window as Window).renameService as RenameService
    const result = await service.readFileInfos([
      sourcePath,
      join(directory, 'missing.txt'),
      directory,
      'relative.txt'
    ])

    expect(result[0]).toMatchObject({ path: sourcePath, name: 'sample.txt', size: 12 })
    expect(result[1].error).toBe('源文件不存在')
    expect(result[2].error).toBe('仅支持文件')
    expect(result[3].error).toBe('文件路径无效')
    expect(await readFile(sourcePath, 'utf8')).toBe('test content')
  })
})
