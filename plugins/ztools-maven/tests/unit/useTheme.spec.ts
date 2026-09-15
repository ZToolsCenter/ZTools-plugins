import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyTheme, detectDark } from '../../src/lib/useTheme'

describe('detectDark', () => {
  beforeEach(() => {
    delete (globalThis as any).ztools
    delete (globalThis as any).window
  })

  it('returns true when ztools.isDarkColors() is true', () => {
    ;(globalThis as any).window = { ztools: { isDarkColors: () => true } }
    expect(detectDark()).toBe(true)
  })

  it('falls back to matchMedia when ztools absent and media matches', () => {
    ;(globalThis as any).window = {
      matchMedia: (q: string) => ({ matches: q.includes('dark') }),
    }
    expect(detectDark()).toBe(true)
  })

  it('falls back to matchMedia when ztools absent and media does not match', () => {
    ;(globalThis as any).window = {
      matchMedia: (q: string) => ({ matches: !q.includes('dark') }),
    }
    expect(detectDark()).toBe(false)
  })

  it('prefers ztools over matchMedia when both present', () => {
    ;(globalThis as any).window = {
      ztools: { isDarkColors: () => false },
      matchMedia: (q: string) => ({ matches: q.includes('dark') }),
    }
    expect(detectDark()).toBe(false)
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = ''
  })

  it('writes data-theme="dark" when dark', () => {
    ;(globalThis as any).window = { ztools: { isDarkColors: () => true } }
    applyTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('writes data-theme="light" when not dark', () => {
    ;(globalThis as any).window = {
      ztools: { isDarkColors: () => false },
      matchMedia: () => ({ matches: false }),
    }
    applyTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('does not register any listeners (one-shot only)', () => {
    const addSpy = vi.fn()
    ;(globalThis as any).window = {
      ztools: { isDarkColors: () => false },
      matchMedia: () => ({ matches: false, addEventListener: addSpy }),
    }
    applyTheme()
    expect(addSpy).not.toHaveBeenCalled()
  })
})