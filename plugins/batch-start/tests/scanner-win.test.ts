import { describe, expect, it, vi } from 'vitest'
import { createWinScanner } from '../src/services/scanner/win'

describe('createWinScanner', () => {
  it('scanCustomDir includes exe bat cmd lnk', async () => {
    const files = ['a.exe', 'b.bat', 'c.cmd', 'd.lnk', 'e.txt']
    const resolveLnks = vi.fn(async (paths: string[]) => {
      const map = new Map<string, string>()
      for (const p of paths) {
        map.set(p, p.replace(/\.lnk$/i, '.exe'))
      }
      return map
    })
    const scanner = createWinScanner({
      readdir: async () =>
        files.map((name) => ({
          name,
          isFile: () => true,
          isDirectory: () => false,
        })),
      resolveLnks,
    })
    const apps = await scanner.scanCustomDir('C:/Apps')
    const names = apps.map((a) => a.path.toLowerCase())
    expect(names.some((p) => p.endsWith('a.exe'))).toBe(true)
    expect(names.some((p) => p.endsWith('b.bat'))).toBe(true)
    expect(names.some((p) => p.endsWith('c.cmd'))).toBe(true)
    expect(names.some((p) => p.endsWith('.exe'))).toBe(true)
    expect(names.some((p) => p.endsWith('e.txt'))).toBe(false)
    expect(resolveLnks).toHaveBeenCalledTimes(1)
  })

  it('uses Node basename for Chinese shortcut display names', async () => {
    const scanner = createWinScanner({
      readdir: async () => [
        {
          name: '微信.lnk',
          isFile: () => true,
          isDirectory: () => false,
        },
      ],
      resolveLnks: async (paths) => {
        const map = new Map<string, string>()
        map.set(paths[0], 'C:/Program Files/Tencent/WeChat/WeChat.exe')
        return map
      },
    })
    const apps = await scanner.scanCustomDir('C:/Menu')
    expect(apps).toHaveLength(1)
    expect(apps[0].name).toBe('微信')
    expect(apps[0].path).toContain('WeChat.exe')
  })

  it('scanCustomDir returns [] when dir is missing', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const scanner = createWinScanner({
      readdir: async () => {
        throw err
      },
      resolveLnks: async () => new Map(),
    })
    await expect(scanner.scanCustomDir('C:/Missing')).resolves.toEqual([])
  })

  it('scanCustomDir returns [] when readdir throws EACCES', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    const scanner = createWinScanner({
      readdir: async () => {
        throw err
      },
      resolveLnks: async () => new Map(),
    })
    await expect(scanner.scanCustomDir('C:/Denied')).resolves.toEqual([])
  })

  it('skips uninstall shortcuts before resolving', async () => {
    const resolveLnks = vi.fn(async (paths: string[]) => {
      const map = new Map<string, string>()
      for (const p of paths) map.set(p, p.replace(/\.lnk$/i, '.exe'))
      return map
    })
    const scanner = createWinScanner({
      readdir: async () =>
        ['Uninstall Foo.lnk', '卸载 Bar.lnk', 'Foo.lnk'].map((name) => ({
          name,
          isFile: () => true,
          isDirectory: () => false,
        })),
      resolveLnks,
    })
    const apps = await scanner.scanCustomDir('C:/Menu')
    expect(apps.map((a) => a.name)).toEqual(['Foo'])
    expect(resolveLnks).toHaveBeenCalledTimes(1)
    const passed = resolveLnks.mock.calls[0][0] as string[]
    expect(passed).toHaveLength(1)
    expect(passed[0].endsWith('Foo.lnk')).toBe(true)
  })
})
