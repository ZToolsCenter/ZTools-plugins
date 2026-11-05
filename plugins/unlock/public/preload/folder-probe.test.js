const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { buildFolderProbeScript, parseFolderProbeOutput } = require('./folder-probe')

describe('folder-probe script', () => {
  it('opens entries with DELETE access but never deletes anything', () => {
    const script = buildFolderProbeScript('C:\\tmp\\folder')

    assert.match(script, /CreateFileW/)
    assert.match(script, /const uint DELETE = 0x00010000;/)
    assert.match(script, /FILE_FLAG_BACKUP_SEMANTICS/)
    assert.match(script, /SHARE_ALL/)
    // 非破坏性：脚本里不能出现任何删除 API
    assert.doesNotMatch(script, /DeleteFile/)
    assert.doesNotMatch(script, /RemoveDirectory/)
    assert.doesNotMatch(script, /Remove-Item/)
    assert.doesNotMatch(script, /\.Delete\(/)
  })

  it('treats sharing violations as locked and access denied as denied', () => {
    const script = buildFolderProbeScript('C:\\tmp\\folder')

    assert.match(script, /\$code -eq 32 -or \$code -eq 33/)
    assert.match(script, /\$code -eq 5/)
  })

  it('skips reparse points so probing never escapes the folder', () => {
    const script = buildFolderProbeScript('C:\\tmp\\folder')
    assert.match(script, /ReparsePoint/)
  })

  it('embeds the path safely as a PowerShell single-quoted literal', () => {
    const script = buildFolderProbeScript("C:\\it's\\a$folder")
    assert.ok(script.includes("$path = 'C:\\it''s\\a$folder'"))
  })
})

describe('parseFolderProbeOutput', () => {
  it('parses yes / no / unknown results', () => {
    assert.deepEqual(
      parseFolderProbeOutput('{"deletable":"yes","locked":0,"denied":0,"other":0,"checked":12,"truncated":false}'),
      { ok: true, deletable: 'yes', locked: 0, denied: 0, other: 0, checked: 12, truncated: false }
    )
    assert.deepEqual(
      parseFolderProbeOutput('{"deletable":"no","locked":2,"denied":0,"other":0,"checked":12,"truncated":false}'),
      { ok: true, deletable: 'no', locked: 2, denied: 0, other: 0, checked: 12, truncated: false }
    )
    assert.deepEqual(
      parseFolderProbeOutput('{"deletable":"unknown","locked":0,"denied":1,"other":0,"checked":12,"truncated":true}'),
      { ok: true, deletable: 'unknown', locked: 0, denied: 1, other: 0, checked: 12, truncated: true }
    )
  })

  it('strips a UTF-8 BOM and rejects malformed output', () => {
    const withBom = '\uFEFF' + '{"deletable":"no","locked":1,"denied":0,"other":0,"checked":1,"truncated":false}'
    assert.equal(parseFolderProbeOutput(withBom).deletable, 'no')

    const broken = parseFolderProbeOutput('not json')
    assert.equal(broken.ok, false)
    assert.equal(broken.deletable, 'unknown')

    const empty = parseFolderProbeOutput('')
    assert.equal(empty.ok, false)
    assert.equal(empty.deletable, 'unknown')
  })

  it('falls back to unknown for an unrecognized deletable value', () => {
    const parsed = parseFolderProbeOutput('{"deletable":"maybe","locked":0,"denied":0,"other":0,"checked":1,"truncated":false}')
    assert.equal(parsed.deletable, 'unknown')
  })
})
