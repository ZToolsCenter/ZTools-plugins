/**
 * Paddle OCR 可用的关键 seam：在安装目录里能找到可执行文件。
 * 用户手动解压 7z/zip 到 paddle 目录后，paddleStatus 应能识别为 ready。
 * 直接驱动 shipped paddleLocate.cjs（preload 同源）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const requireCjs = createRequire(import.meta.url)
const cjs = requireCjs(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/preload/paddleLocate.cjs')
)
const findPaddleExe = cjs.findPaddleExe as (root: string, maxDepth?: number) => string
const paddleSpawnArgs = cjs.paddleSpawnArgs as (
  exePath: string,
  imagePath: string
) => { cwd: string; args: string[] }

function makeTree(root: string, files: string[]): void {
  for (const f of files) {
    const full = path.join(root, f)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, '')
  }
}

describe('findPaddleExe', () => {
  const root = path.join(tmpdir(), 'snap-paddle-locate-' + Date.now())

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('finds PaddleOCR-json.exe nested under a version folder', () => {
    makeTree(root, ['PaddleOCR-json_v1.4.1/PaddleOCR-json.exe'])
    expect(findPaddleExe(root)).toBe(path.join(root, 'PaddleOCR-json_v1.4.1', 'PaddleOCR-json.exe'))
  })

  it('finds RapidOCR-json.exe at top level', () => {
    makeTree(root, ['RapidOCR-json.exe'])
    expect(findPaddleExe(root)).toBe(path.join(root, 'RapidOCR-json.exe'))
  })

  it('returns empty string when nothing present', () => {
    expect(findPaddleExe(root)).toBe('')
  })

  it('spawns with cwd=exe dir and explicit -models_path so models resolve', () => {
    const exe = 'D:/Paddle/PaddleOCR-json_v1.4.1/PaddleOCR-json.exe'
    const s = paddleSpawnArgs(exe, 'D:/tmp/shot.png')
    expect(s.cwd).toContain('PaddleOCR-json_v1.4.1')
    expect(s.args).toContain('-image_path=D:/tmp/shot.png')
    expect(s.args.some((a) => a.startsWith('-models_path=') && a.includes('PaddleOCR-json_v1.4.1'))).toBe(true)
  })
})
