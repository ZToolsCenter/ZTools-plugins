import { describe, expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  WEB_FETCH_ERROR_CODES,
  assertResponseBodySize,
  decodeBody
}: {
  WEB_FETCH_ERROR_CODES: Record<string, string>
  assertResponseBodySize: (receivedBytes: number, maxBytes: number) => void
  decodeBody: (buffer: Buffer, encoding: string, maxDecodedBytes: number) => Promise<Buffer>
} = require('../../preload/web-fetch.cjs')

describe('preload web fetch decoded body limits', () => {
  test('exposes a stable error code when the compressed response body is too large', () => {
    expect(() => assertResponseBodySize(65 * 1024, 64 * 1024)).toThrow()
    try {
      assertResponseBodySize(65 * 1024, 64 * 1024)
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe(
        WEB_FETCH_ERROR_CODES.RESPONSE_TOO_LARGE
      )
      expect((error as Error).message).toContain('响应体过大')
    }
  })

  test('decodes a compressed text body under the hard limit', async () => {
    const decoded = await decodeBody(gzipSync(Buffer.from('安全正文')), 'gzip', 1024)
    expect(decoded.toString('utf8')).toBe('安全正文')
  })

  test('rejects a compressed body once decoded bytes exceed the hard limit', async () => {
    const compressed = gzipSync(Buffer.alloc(256 * 1024, 65))
    try {
      await decodeBody(compressed, 'gzip', 64 * 1024)
      throw new Error('expected decodeBody to reject')
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe(
        WEB_FETCH_ERROR_CODES.DECOMPRESSED_TOO_LARGE
      )
      expect((error as Error).message).toContain('解压后内容过大')
    }
  })

  test('applies the same decoded limit to uncompressed bodies', async () => {
    await expect(decodeBody(Buffer.alloc(70 * 1024), '', 64 * 1024)).rejects.toMatchObject({
      code: WEB_FETCH_ERROR_CODES.DECOMPRESSED_TOO_LARGE
    })
  })
})
