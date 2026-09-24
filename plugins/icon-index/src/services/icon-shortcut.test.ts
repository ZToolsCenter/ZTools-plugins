import { describe, expect, it } from 'vitest'
import { matchIconSequence } from './icon-shortcut'

describe('matchIconSequence', () => {
  it('waits when a single digit can start a two-digit sequence', () => {
    expect(matchIconSequence('', '1', 48)).toEqual({ buffer: '1', index: 0, commit: false })
    expect(matchIconSequence('', '4', 48)).toEqual({ buffer: '4', index: 3, commit: false })
  })

  it('commits a complete two-digit sequence', () => {
    expect(matchIconSequence('1', '2', 48)).toEqual({ buffer: '12', index: 11, commit: true })
    expect(matchIconSequence('4', '8', 48)).toEqual({ buffer: '48', index: 47, commit: true })
  })

  it('commits a single digit when it cannot start a longer sequence', () => {
    expect(matchIconSequence('', '9', 48)).toEqual({ buffer: '9', index: 8, commit: true })
  })

  it('rejects zero and out-of-range sequences', () => {
    expect(matchIconSequence('', '0', 48)).toEqual({ buffer: '', index: null, commit: false })
    expect(matchIconSequence('4', '9', 48)).toEqual({ buffer: '', index: null, commit: false })
  })
})
