const assert = require('node:assert/strict')
const { describe, it, after } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  normalizeWinPath,
  isPathInsideWin,
  collectFolderCandidates,
  buildCwdScanScript,
  parseCwdScanOutput,
  filterCwdHolders,
  buildFolderResourceManagerScript,
  parseFolderRmOutput
} = require('./folder-scan')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-scan-test-'))

after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
})

function mkTree(name, spec) {
  const root = path.join(TMP, name)
  fs.mkdirSync(root, { recursive: true })
  for (const rel of spec) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, 'x')
  }
  return root
}

describe('Windows path helpers', () => {
  it('normalizes drive paths, slashes, trailing separators and \\\\?\\ prefixes', () => {
    assert.equal(normalizeWinPath('C:\\App\\'), 'c:\\app')
    assert.equal(normalizeWinPath('C:/App//Sub/'), 'c:\\app\\sub')
    assert.equal(normalizeWinPath('\\\\?\\C:\\App'), 'c:\\app')
    assert.equal(normalizeWinPath('\\??\\C:\\App'), 'c:\\app')
    assert.equal(normalizeWinPath('\\\\?\\UNC\\server\\share'), '\\\\server\\share')
    assert.equal(normalizeWinPath(''), '')
  })

  it('matches the directory and its descendants only', () => {
    assert.equal(isPathInsideWin('C:\\App\\sub\\file.txt', 'C:\\App'), true)
    assert.equal(isPathInsideWin('C:\\App', 'C:\\App'), true)
    assert.equal(isPathInsideWin('c:\\app\\SUB', 'C:/App'), true)
    assert.equal(isPathInsideWin('\\\\?\\C:\\App\\sub', 'C:\\App'), true)
    // 前缀相似但不同名，不能误判
    assert.equal(isPathInsideWin('C:\\App_backup\\file.txt', 'C:\\App'), false)
    assert.equal(isPathInsideWin('C:\\Application', 'C:\\App'), false)
    assert.equal(isPathInsideWin('', 'C:\\App'), false)
    assert.equal(isPathInsideWin('C:\\App', ''), false)
  })
})

describe('collectFolderCandidates', () => {
  it('walks nested files and directories', () => {
    const root = mkTree('tree', ['a.txt', 'sub/b.txt', 'sub/deep/c.txt'])
    const result = collectFolderCandidates(root)

    assert.equal(result.files.length, 3)
    assert.ok(result.dirs.includes(root))
    assert.ok(result.dirs.includes(path.join(root, 'sub')))
    assert.ok(result.files.some(f => f.endsWith('c.txt')))
    assert.equal(result.truncated, false)
    assert.deepEqual(result.errors, [])
  })

  it('caps the number of files and marks the result as truncated', () => {
    const root = mkTree('many', ['1.txt', '2.txt', '3.txt', '4.txt', '5.txt'])
    const result = collectFolderCandidates(root, { maxFiles: 2 })

    assert.equal(result.files.length, 2)
    assert.equal(result.truncated, true)
  })

  it('caps directory depth', () => {
    const root = mkTree('deep', ['a/b/c/d/e/file.txt'])
    const result = collectFolderCandidates(root, { maxDepth: 1 })

    assert.equal(result.files.length, 0)
    assert.equal(result.truncated, true)
  })

  it('skips junction/symlink entries instead of following them', () => {
    const outside = mkTree('outside', ['secret.txt'])
    const root = mkTree('links', ['regular.txt'])
    const link = path.join(root, 'link-outside')
    let linked = true
    try {
      fs.symlinkSync(outside, link, 'junction')
    } catch (e) {
      linked = false
    }
    if (!linked) return // 环境不允许创建 junction 时不强求

    const result = collectFolderCandidates(root)
    assert.deepEqual(result.files.map(f => path.basename(f)), ['regular.txt'])
    assert.ok(!result.files.some(f => f.endsWith('secret.txt')))
  })

  it('records unreadable directories and keeps going', () => {
    const root = mkTree('mixed', ['ok.txt', 'sub/hidden.txt'])
    const missing = path.join(root, 'gone')
    const result = collectFolderCandidates(root)
    assert.equal(result.files.length, 2)

    // 显式传入一个不存在的根目录：应返回错误而不是抛异常
    const bad = collectFolderCandidates(missing)
    assert.equal(bad.files.length, 0)
    assert.equal(bad.errors.length, 1)
  })
})

describe('CWD scan script', () => {
  it('reads the PEB CurrentDirectory through documented APIs', () => {
    const script = buildCwdScanScript(4321, 'C:\\Users\\me\\AppData\\Local\\Temp\\helper')

    assert.match(script, /NtQueryInformationProcess/)
    assert.match(script, /ReadProcessMemory/)
    assert.match(script, /ProcessBasicInformation/)
    assert.match(script, /ProcessWow64Information/)
    assert.match(script, /QueryFullProcessImageName/)
    assert.match(script, /paramsOffset = ptrSize == 8 \? 0x20 : 0x10;/)
    assert.match(script, /cwdOffset = ptrSize == 8 \? 0x38 : 0x24;/)
    assert.match(script, /\[CwdScan\]::Scan\(4321,/)
  })

  it('excludes the helper process by its unique working directory', () => {
    const script = buildCwdScanScript(1, 'C:\\Temp\\unlock-cwd-abc')
    assert.match(script, /excludeCwd/)
    assert.match(script, /StringComparison\.OrdinalIgnoreCase/)
    assert.ok(script.includes('C:\\\\Temp\\\\unlock-cwd-abc'), '路径应按 C# 字符串转义')
  })

  it('validates the UNICODE_STRING length before reading', () => {
    const script = buildCwdScanScript(1, 'C:\\Temp\\x')
    assert.match(script, /len <= 0 \|\| len > 0x10000 \|\| \(len & 1\) != 0/)
  })
})

describe('parseCwdScanOutput / filterCwdHolders', () => {
  it('parses ROW and META lines', () => {
    const raw = [
      'ROW|123|pwsh.exe|C:\\Program Files\\PowerShell\\pwsh.exe|C:\\Work\\Project',
      'ROW|456|node.exe||C:\\Work\\Project\\app',
      'META|42|3|1'
    ].join('\r\n')

    const parsed = parseCwdScanOutput(raw)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.rows.length, 2)
    assert.equal(parsed.scanned, 42)
    assert.equal(parsed.denied, 3)
    assert.equal(parsed.wow64Skipped, 1)
    assert.equal(parsed.rows[0].cwd, 'C:\\Work\\Project')
  })

  it('ignores malformed lines and empty output', () => {
    assert.deepEqual(parseCwdScanOutput('').rows, [])
    assert.deepEqual(parseCwdScanOutput('ROW|not-a-pid|x').rows, [])
    assert.deepEqual(parseCwdScanOutput('garbage').rows, [])
  })

  it('keeps only rows whose working directory is inside the target', () => {
    const holders = filterCwdHolders([
      { pid: 1, name: 'a.exe', cwd: 'C:\\App\\sub' },
      { pid: 2, name: 'b.exe', cwd: 'C:\\App_backup' },
      { pid: 3, name: 'c.exe', cwd: 'C:\\Other' },
      { pid: 0, name: 'bad.exe', cwd: 'C:\\App' }
    ], 'C:\\App')

    assert.equal(holders.length, 1)
    assert.equal(holders[0].pid, 1)
    assert.equal(holders[0].detectSource, 'cwd')
    assert.equal(holders[0].confidence, 'high')
    assert.deepEqual(holders[0].evidence, ['working-directory'])
  })
})

describe('folder Restart Manager script', () => {
  it('registers child files in batches and keeps the Unicode struct layout', () => {
    const script = buildFolderResourceManagerScript('C:\\Temp\\manifest.json')

    assert.match(script, /RmRegisterResources/)
    assert.match(script, /offset \+= 64/)
    assert.match(script, /uint needed = 0;/)
    assert.match(script, /uint have = 0;/)
    assert.match(script, /out needed, ref have/)
    assert.match(script, /\[StructLayout\(LayoutKind\.Sequential, CharSet = CharSet\.Unicode\)\]/)
    assert.match(script, /ByValTStr, SizeConst = 256/)
    assert.match(script, /Marshal\.FreeHGlobal/)
    assert.match(script, /failedBatches/)
  })

  it('parses holders, counts and failures', () => {
    const raw = JSON.stringify({
      holders: [
        { pid: 11, name: 'code.exe', exePath: 'C:\\Code\\code.exe', service: '' },
        { pid: 12, name: 'svc.exe', exePath: '', service: 'MyService' }
      ],
      registered: 120,
      failedBatches: 0,
      lastError: ''
    })
    const parsed = parseFolderRmOutput(raw)

    assert.equal(parsed.ok, true)
    assert.equal(parsed.holders.length, 2)
    assert.equal(parsed.holders[0].detectSource, 'resourcemanager-child')
    assert.equal(parsed.holders[1].service, 'MyService')
    assert.equal(parsed.registered, 120)
  })

  it('handles empty, null and malformed output', () => {
    assert.equal(parseFolderRmOutput('').holders.length, 0)
    assert.equal(parseFolderRmOutput('null').holders.length, 0)
    assert.equal(parseFolderRmOutput('[]').holders.length, 0)
    assert.equal(parseFolderRmOutput('not json').ok, false)
  })
})
