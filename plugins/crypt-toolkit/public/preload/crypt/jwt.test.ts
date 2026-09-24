import { describe, expect, it } from 'vitest'
import { decode } from './jwt'

describe('jwt', () => {
  it('decodes a sample JWT', () => {
    // {"alg":"HS256","typ":"JWT"} → eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
    // {"sub":"1234567890","name":"John Doe","iat":1516239022} → eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMDI0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ'
    const r = decode({ token })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.header).toEqual({ alg: 'HS256', typ: 'JWT' })
      expect(r.data.payload).toMatchObject({ name: 'John Doe' })
    }
  })

  it('rejects malformed token', () => {
    const r = decode({ token: 'no-dots-here' })
    expect(r.ok).toBe(false)
  })

  it('rejects invalid base64 segment', () => {
    const r = decode({ token: '!!!.###' })
    expect(r.ok).toBe(false)
  })
})
