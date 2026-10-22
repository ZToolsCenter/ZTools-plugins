const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { buildShredScript, buildDeleteScript, parseShredResult } = require('./shredder')

describe('shredder', () => {
  describe('buildShredScript', () => {
    it('generates PowerShell script for single file shred', () => {
      const script = buildShredScript('C:\\test\\file.txt')
      assert(script.includes('RandomNumberGenerator'))
      assert(script.includes("'C:\\test\\file.txt'"))
      assert(script.includes('Remove-Item'))
    })

    it('generates an honest directory shred script that never swallows failures', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shredder-test-'))
      try {
        const script = buildShredScript(tmpDir)
        assert(script.includes('EnumerateFileSystemEntries'))
        assert(script.includes('ReparsePoint'))
        assert(script.includes('$fileFailed++'))
        assert(script.includes('permissionDenied'))
        assert(script.includes('remaining'))
        assert(script.includes('Sort-Object'))
        // 逐文件失败必须被记录，而不是空 catch 吞掉后仍报成功
        assert.doesNotMatch(script, /catch \{ \}/)
        assert.doesNotMatch(script, /ErrorAction SilentlyContinue/)
        assert.doesNotMatch(script, /ok = \$true/)
      } finally {
        fs.rmdirSync(tmpDir)
      }
    })

    it('escapes single quotes in path', () => {
      const script = buildShredScript("C:\\test\\it's.txt")
      assert(script.includes("'C:\\test\\it''s.txt'"))
    })

    it('includes UTF-8 encoding header', () => {
      const script = buildShredScript('C:\\test\\file.txt')
      assert(script.includes('[Console]::OutputEncoding'))
      assert(script.includes('UTF8'))
    })
  })

  describe('buildDeleteScript', () => {
    it('generates Remove-Item for file', () => {
      const script = buildDeleteScript('C:\\test\\file.txt')
      assert(script.includes('Remove-Item'))
      assert(script.includes('-Force'))
    })

    it('generates Remove-Item -Recurse for directory', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shredder-test-'))
      try {
        const script = buildDeleteScript(tmpDir)
        assert(script.includes('-Recurse'))
      } finally {
        fs.rmdirSync(tmpDir)
      }
    })

    it('includes UTF-8 encoding header', () => {
      const script = buildDeleteScript('C:\\test\\file.txt')
      assert(script.includes('[Console]::OutputEncoding'))
      assert(script.includes('UTF8'))
    })
  })

  describe('parseShredResult', () => {
    it('parses success JSON', () => {
      const result = parseShredResult('{"ok":true,"count":5}')
      assert.equal(result.success, true)
      assert.equal(result.filesProcessed, 5)
    })

    it('parses failure JSON with permission error (locked flag)', () => {
      const result = parseShredResult('{"ok":false,"error":"access denied"}')
      assert.equal(result.success, false)
      assert.equal(result.locked, true)
      assert(result.message.includes('权限不足'))
    })

    it('parses failure JSON with lock error (locked flag)', () => {
      const result = parseShredResult('{"ok":false,"error":"file is being used by another process"}')
      assert.equal(result.success, false)
      assert.equal(result.locked, true)
      assert(result.message.includes('占用'))
    })

    it('parses failure JSON with Chinese lock error', () => {
      const result = parseShredResult('{"ok":false,"error":"文件正由另一进程使用，因此该进程无法访问此文件。"}')
      assert.equal(result.success, false)
      assert.equal(result.locked, true)
      assert(result.message.includes('占用'))
    })

    it('parses failure JSON with Chinese permission error', () => {
      const result = parseShredResult('{"ok":false,"error":"对路径的访问被拒绝"}')
      assert.equal(result.success, false)
      assert.equal(result.locked, true)
      assert(result.message.includes('权限'))
    })

    it('parses failure JSON with unknown error (no locked flag)', () => {
      const result = parseShredResult('{"ok":false,"error":"something went wrong"}')
      assert.equal(result.success, false)
      assert.equal(result.locked, undefined)
    })

    it('detects lock from error text', () => {
      const result = parseShredResult('Remove-Item : The process cannot access the file because it is being used by another process.')
      assert.equal(result.success, false)
      assert.equal(result.locked, true)
    })

    it('separates permission failures from lock failures', () => {
      const denied = parseShredResult('{"ok":false,"error":"access denied"}')
      assert.equal(denied.permissionDenied, true)
      assert.equal(denied.message, '权限不足，请以管理员身份运行 ZTools 后重试')

      const locked = parseShredResult('{"ok":false,"error":"file is being used by another process"}')
      assert.equal(locked.permissionDenied, false)
      assert.equal(locked.message, '有文件正被其他程序占用，无法处理')
    })

    it('phrases success without debug punctuation', () => {
      const result = parseShredResult('{"ok":true,"count":3}')
      assert.equal(result.message, '已处理 3 个文件')
    })

    it('reports a partial folder shred instead of success', () => {
      const result = parseShredResult(JSON.stringify({
        ok: false,
        count: 3,
        failed: 2,
        locked: 2,
        permissionDenied: 0,
        other: 0,
        remaining: true,
        errors: ['b.txt: 文件正由另一进程使用']
      }))

      assert.equal(result.success, false)
      assert.equal(result.partial, true)
      assert.equal(result.filesProcessed, 3)
      assert.equal(result.failedFiles, 2)
      assert.equal(result.remaining, true)
      assert.equal(result.locked, true)
      assert.match(result.message, /已处理 3 个文件.*2 个/)
    })

    it('keeps the lock flag when locked and permission failures are mixed', () => {
      const result = parseShredResult(JSON.stringify({
        ok: false,
        count: 1,
        failed: 2,
        locked: 1,
        permissionDenied: 1,
        other: 0,
        remaining: true,
        errors: []
      }))

      assert.equal(result.locked, true)
      assert.equal(result.permissionDenied, true)
      assert.equal(result.partial, true)
      assert.match(result.message, /占用/)
    })

    it('treats permission-only folder failures as permission problems', () => {
      const result = parseShredResult(JSON.stringify({
        ok: false,
        count: 0,
        failed: 2,
        locked: 0,
        permissionDenied: 2,
        other: 0,
        remaining: true,
        errors: []
      }))

      assert.equal(result.success, false)
      assert.equal(result.permissionDenied, true)
      assert.equal(result.locked, true)
      assert.match(result.message, /权限不足/)
    })

    it('does not claim success when ok is true but content remains', () => {
      const result = parseShredResult(JSON.stringify({
        ok: true,
        count: 2,
        failed: 0,
        locked: 0,
        permissionDenied: 0,
        other: 0,
        remaining: true,
        errors: []
      }))

      assert.equal(result.success, false)
      assert.equal(result.partial, true)
      assert.match(result.message, /仍有/)
    })

    it('reports other partial failures without pretending they were locked', () => {
      const result = parseShredResult(JSON.stringify({
        ok: false,
        count: 1,
        failed: 1,
        locked: 0,
        permissionDenied: 0,
        other: 1,
        remaining: true,
        errors: ['x.txt: 设备未就绪']
      }))

      assert.equal(result.success, false)
      assert.equal(result.locked, undefined)
      assert.equal(result.partial, true)
      assert.match(result.message, /已处理 1 个文件/)
    })
  })
})
