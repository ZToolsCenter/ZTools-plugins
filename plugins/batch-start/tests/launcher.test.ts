import { describe, it, expect, vi } from 'vitest'
import { launchPaths, launchTargets } from '../src/services/launcher'
import { commandAppPath } from '../src/services/scanner/ztoolsPlugins'

describe('launchPaths', () => {
  it('opens all paths in parallel and summarizes failures', async () => {
    const open = vi.fn(async (p: string) => {
      if (p.includes('bad')) return { success: false, error: 'missing' }
      return { success: true }
    })
    const result = await launchPaths(['/a', '/bad', '/c'], open)
    expect(open).toHaveBeenCalledTimes(3)
    expect(result.success).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors[0].path).toBe('/bad')
  })
})

describe('launchTargets', () => {
  it('redirects ztools command targets and opens filesystem paths', async () => {
    const open = vi.fn(async () => ({ success: true }))
    const redirect = vi.fn(() => true)
    const result = await launchTargets(
      [
        { key: '/a.exe', kind: 'path', path: '/a.exe' },
        {
          key: commandAppPath('colors', '颜色助手'),
          kind: 'ztools',
          pluginTitle: '调色板',
          launchCmd: '颜色助手',
        },
      ],
      { openPath: open, redirect },
    )
    expect(open).toHaveBeenCalledWith('/a.exe')
    expect(redirect).toHaveBeenCalledWith(['调色板', '颜色助手'])
    expect(result.success).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('fails command launch when launchCmd missing', async () => {
    const result = await launchTargets(
      [{ key: commandAppPath('x', 'y'), kind: 'ztools', launchCmd: null }],
      { openPath: async () => ({ success: true }), redirect: () => true },
    )
    expect(result.failed).toBe(1)
    expect(result.errors[0].error).toMatch(/no divertible/)
  })
})
