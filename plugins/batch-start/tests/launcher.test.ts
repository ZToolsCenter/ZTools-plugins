import { describe, it, expect, vi } from 'vitest'
import { launchPaths } from '../src/services/launcher'

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
