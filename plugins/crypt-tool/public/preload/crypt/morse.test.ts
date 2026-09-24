import { describe, expect, it } from 'vitest'
import { encode, decode } from './morse'

describe('morse', () => {
  it('encodes SOS', () => {
    expect(encode({ input: 'SOS' })).toEqual({ ok: true, data: '... --- ...' })
  })

  it('encodes hello', () => {
    const r = encode({ input: 'HELLO' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('.... . .-.. .-.. ---')
  })

  it('decode SOS', () => {
    const r = decode({ input: '... --- ...' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('sos')
  })

  it('spaces become slash', () => {
    const r = encode({ input: 'A B' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('.- / -...')
  })
})
