const assert = require('node:assert/strict')
const { describe, it, after } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'unlock-test-'))

after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
})

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function tmpFile(name, content) {
  const p = path.join(TMP, name)
  fs.writeFileSync(p, content == null ? 'x' : content)
  return p
}

/** 起一个独占占用文件的 PowerShell 进程，等文件真的被锁上再返回 { pid, dispose() } */
async function startExclusiveHolder(file) {
  const literal = "'" + file.replace(/'/g, "''") + "'"
  const command = '$fs=[System.IO.File]::Open(' + literal + ',"Open","ReadWrite","None"); Start-Sleep -Seconds 45'
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    stdio: 'ignore'
  })
  const { probePathState } = require('./unlock')
  const deadline = Date.now() + 30000
  let state = 'unknown'
  while (Date.now() < deadline) {
    await sleep(300)
    state = await probePathState(file)
    if (state === 'locked') {
      return { pid: proc.pid, dispose() { try { proc.kill() } catch (e) {} } }
    }
  }
  try { proc.kill() } catch (e) {}
  throw new Error('占用进程未能在超时前锁住文件（state=' + state + '）')
}

/** 起一个共享读句柄的 PowerShell 进程（同样会挡住独占打开/删除），等锁生效再返回 */
async function startSharedHolder(file) {
  const literal = "'" + file.replace(/'/g, "''") + "'"
  const command = '$fs=[System.IO.File]::Open(' + literal + ',"Open","Read","ReadWrite"); $sr=New-Object System.IO.StreamReader($fs); $null=$sr.ReadToEnd(); Start-Sleep -Seconds 45'
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    stdio: 'ignore'
  })
  const { probePathState } = require('./unlock')
  const deadline = Date.now() + 30000
  let state = 'unknown'
  while (Date.now() < deadline) {
    await sleep(300)
    state = await probePathState(file)
    if (state === 'locked') {
      return { pid: proc.pid, dispose() { try { proc.kill() } catch (e) {} } }
    }
  }
  try { proc.kill() } catch (e) {}
  throw new Error('共享读占用进程未能在超时前锁住文件（state=' + state + '）')
}

function isPowerShellUsable() {
  try {
    const { execFileSync } = require('node:child_process')
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { timeout: 15000, stdio: 'ignore' })
    return true
  } catch (e) {
    return false
  }
}

const PS_OK = isPowerShellUsable()
const windowsOnly = { skip: process.platform !== 'win32' || !PS_OK ? '需要 Windows 与 PowerShell' : false }

describe('findLockingProcesses', () => {
  it('throws when path does not exist', async () => {
    const { findLockingProcesses } = require('./unlock')

    await assert.rejects(
      async () => await findLockingProcesses('C:\\NonExistent\\Path\\file.txt'),
      /路径不存在/
    )
  })

  it('returns lock scan result shape for an existing file', async () => {
    const { findLockingProcesses } = require('./unlock')
    const tmp = tmpFile('shape.txt', 'hello')

    const result = await findLockingProcesses(tmp)
    assert.ok(result && typeof result === 'object')
    assert.ok(Array.isArray(result.processes))
    assert.ok('locked' in result)
    assert.ok('engine' in result)
    assert.equal(result.holders, result.processes.length)
    for (const p of result.processes) {
      assert.ok(typeof p.pid === 'number')
      assert.ok(typeof p.name === 'string')
      assert.ok(p.why && typeof p.why === 'object')
      assert.ok(typeof p.why.ancestryText === 'string')
      assert.ok(Array.isArray(p.why.ancestry))
      assert.ok(p.why.source && typeof p.why.source.type === 'string')
      assert.ok(['high', 'medium', 'low'].includes(p.confidence || 'high'))
    }
  })

  it('reports an unlocked file as not occupied with a friendly note', async () => {
    const { findLockingProcesses } = require('./unlock')
    const tmp = tmpFile('free.txt', 'hello')

    const result = await findLockingProcesses(tmp)
    assert.equal(result.locked, false)
    assert.equal(result.blocked, false)
    assert.equal(result.holders, 0)
    assert.equal(result.state, 'free')
    assert.equal(result.noteLevel, 'success')
    assert.match(result.note, /未检测到占用/)
  })

  it('scans directories and reports an empty folder as free', windowsOnly, async () => {
    const { findLockingProcesses } = require('./unlock')
    const dir = path.join(TMP, 'a-directory')
    fs.mkdirSync(dir, { recursive: true })

    const result = await findLockingProcesses(dir)
    assert.equal(result.state, 'directory')
    assert.equal(result.isDirectory, true)
    assert.equal(result.holders, 0)
    assert.equal(result.processes.length, 0)
    assert.equal(result.blocked, false)
    assert.equal(result.locked, false)
    assert.equal(result.noteLevel, 'success')
    assert.match(result.note, /文件夹当前没有被占用/)
  })

  it('finds a process holding a file inside a folder and verifies release', windowsOnly, async () => {
    const { findLockingProcesses, verifyRelease } = require('./unlock')
    const dir = path.join(TMP, 'locked-folder')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'inside.txt')
    fs.writeFileSync(file, 'hello')

    const holder = await startExclusiveHolder(file)
    try {
      const scan = await findLockingProcesses(dir)
      assert.equal(scan.isDirectory, true)
      assert.equal(scan.blocked, true)
      assert.equal(scan.locked, true)
      assert.ok(
        scan.processes.some(p => p.pid === holder.pid),
        '期望文件夹扫描包含 PID ' + holder.pid + '，实际: ' + JSON.stringify(scan.processes.map(p => p.pid))
      )

      const verify = await verifyRelease(dir, { attempts: 2, intervalMs: 100 })
      assert.equal(verify.released, false)
      assert.equal(verify.verification, 'delete-probe')
    } finally {
      holder.dispose()
    }

    await sleep(800)
    const after = await findLockingProcesses(dir)
    assert.equal(after.blocked, false)
    assert.equal(after.locked, false)
    assert.equal(after.noteLevel, 'success')
  })

  it('finds a process whose working directory is the folder', windowsOnly, async () => {
    const { findLockingProcesses } = require('./unlock')
    const dir = path.join(TMP, 'cwd-folder')
    fs.mkdirSync(dir, { recursive: true })

    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 45'], {
      cwd: dir,
      windowsHide: true,
      stdio: 'ignore'
    })
    try {
      await sleep(1200)
      const scan = await findLockingProcesses(dir)
      assert.equal(scan.isDirectory, true)
      const hit = scan.processes.find(p => p.pid === proc.pid)
      assert.ok(hit, '期望按工作目录找到 PID ' + proc.pid + '，实际: ' + JSON.stringify(scan.processes.map(p => p.pid)))
      assert.match(String(hit.detectSource), /cwd/)
      assert.deepEqual(hit.evidence, ['working-directory'])
    } finally {
      try { proc.kill() } catch (e) {}
    }
  })

  it('finds the real holder of a locked file via witr or Restart Manager', windowsOnly, async () => {
    const { findLockingProcesses } = require('./unlock')
    const file = tmpFile('locked.txt', 'hello')
    const holder = await startExclusiveHolder(file)
    try {
      const result = await findLockingProcesses(file)
      assert.equal(result.locked, true)
      assert.equal(result.blocked, true)
      assert.ok(
        result.processes.some(p => p.pid === holder.pid),
        '期望占用者列表包含 PID ' + holder.pid + '，实际: ' + JSON.stringify(result.processes.map(p => p.pid))
      )
    } finally {
      holder.dispose()
    }
  })
})

describe('Restart Manager (regression: aliased RmGetList arguments)', () => {
  // 旧实现把同一个变量同时作为 pnProcInfoNeeded(out) 和 pnProcInfo(ref)，
  // 写回时计数被清零 → 分配 0 字节 → 永远返回空列表。这里从脚本层面守住契约。
  it('uses two distinct variables for RmGetList needed/free counts', () => {
    const { buildResourceManagerScript } = require('./unlock')
    const script = buildResourceManagerScript('C:\\tmp\\a.txt')

    assert.match(script, /uint needed = 0;/)
    assert.match(script, /uint have = 0;/)
    assert.match(script, /RmGetList\(session, out needed, ref have,/)
    assert.doesNotMatch(script, /out needed, ref needed/)
  })

  it('marshals RM_PROCESS_INFO as Unicode so RmGetList cannot overrun the buffer', () => {
    // 按 Ansi 计算结构体大小会低于 API 实际写入量 → 越界写 → 宿主堆损坏 0xC0000374
    const { buildResourceManagerScript } = require('./unlock')
    const script = buildResourceManagerScript('C:\\tmp\\a.txt')
    const structAt = script.indexOf('public struct RM_PROCESS_INFO')
    assert.ok(structAt > 0, '脚本里应包含 RM_PROCESS_INFO 定义')
    assert.match(
      script.slice(Math.max(0, structAt - 120), structAt),
      /\[StructLayout\(LayoutKind\.Sequential, CharSet = CharSet\.Unicode\)\]/
    )
    assert.match(script, /Marshal\.SizeOf\(typeof\(RM_PROCESS_INFO\)\)/)
    // 调用与解析都收在 C# 里：PowerShell 侧不再手工分配/解析非托管内存
    assert.match(script, /\[RestartManager\]::GetHolders\(\$path\)/)
    assert.doesNotMatch(script, /\[System\.Runtime\.InteropServices\.Marshal\]::AllocHGlobal/)
    assert.doesNotMatch(script, /\[System\.Runtime\.InteropServices\.Marshal\]::PtrToStructure/)
  })

  it('surfaces errors instead of swallowing them', () => {
    const { buildResourceManagerScript } = require('./unlock')
    const script = buildResourceManagerScript('C:\\tmp\\a.txt')

    assert.match(script, /\[Console\]::Error\.WriteLine/)
    assert.match(script, /exit 1/)
  })

  it('finds a real holder through Restart Manager', windowsOnly, async () => {
    const { findByResourceManager } = require('./unlock')
    const file = tmpFile('rm-locked.txt', 'hello')
    const holder = await startExclusiveHolder(file)
    try {
      const found = await findByResourceManager(file)
      assert.ok(Array.isArray(found))
      assert.ok(
        found.some(p => p.pid === holder.pid),
        '重启管理器应报出占用者 ' + holder.pid + '，实际: ' + JSON.stringify(found)
      )
      const hit = found.find(p => p.pid === holder.pid)
      assert.equal(hit.detectSource, 'resourcemanager')
      assert.ok(typeof hit.name === 'string' && hit.name.length > 0, '进程名不应为空')
      if (hit.exePath) {
        assert.equal(hit.name, path.basename(hit.exePath), '进程名应与可执行文件一致')
      }
    } finally {
      holder.dispose()
    }
  })
})

describe('probePathState', () => {
  it('maps path kinds to states', windowsOnly, async () => {
    const { probePathState } = require('./unlock')
    const dir = path.join(TMP, 'probe-dir')
    fs.mkdirSync(dir, { recursive: true })

    assert.equal(await probePathState(tmpFile('probe-free.txt')), 'free')
    assert.equal(await probePathState(dir), 'directory')
    assert.equal(await probePathState(path.join(TMP, 'definitely-missing.txt')), 'missing')

    const file = tmpFile('probe-locked.txt')
    const holder = await startExclusiveHolder(file)
    try {
      assert.equal(await probePathState(file), 'locked')
    } finally {
      holder.dispose()
    }
    await sleep(500)
    assert.equal(await probePathState(file), 'free')
  })
})

describe('closed loop: kill then verify release', () => {
  it('killLockingProcess reports the lock as released and leaves the file free', windowsOnly, async () => {
    const { killLockingProcess, probePathState, findLockingProcesses } = require('./unlock')
    const file = tmpFile('close-loop.txt', 'hello')
    const holder = await startExclusiveHolder(file)

    assert.equal(await probePathState(file), 'locked')

    const scan = await findLockingProcesses(file)
    assert.ok(scan.processes.some(p => p.pid === holder.pid))

    const result = await killLockingProcess(file, holder.pid, 'powershell.exe')
    assert.equal(result.success, true)
    assert.equal(result.released, true)
    assert.equal(result.level, 'success')
    assert.match(result.message, /已解除占用/)
    assert.equal(await probePathState(file), 'free')

    // 清理：确认文件真的可以删掉（用户真正关心的事）
    fs.unlinkSync(file)
    assert.equal(fs.existsSync(file), false)
  })

  it('verifyRelease reports not-released while a holder is still alive', windowsOnly, async () => {
    const { verifyRelease } = require('./unlock')
    const file = tmpFile('still-locked.txt', 'hello')
    const holder = await startExclusiveHolder(file)
    try {
      const verify = await verifyRelease(file, { attempts: 2, intervalMs: 100 })
      assert.equal(verify.released, false)
      assert.equal(verify.state, 'locked')
    } finally {
      holder.dispose()
    }
  })

  it('finds every holder when several processes share the lock', windowsOnly, async () => {
    // 两个占用者同时踩过两个坑：witr --file 会退出码 4 输出文本列表（不是 JSON），
    // 重启管理器脚本曾因结构体按 Ansi 计算大小而堆损坏崩溃（0xC0000374）。
    const { findLockingProcesses, findByResourceManager } = require('./unlock')
    const file = tmpFile('two-holders.txt', 'hello')
    const first = await startSharedHolder(file)
    const second = await startSharedHolder(file)
    try {
      const byRM = await findByResourceManager(file)
      assert.ok(
        byRM.some(p => p.pid === first.pid) && byRM.some(p => p.pid === second.pid),
        '重启管理器应同时报出两个占用者，实际: ' + JSON.stringify(byRM.map(p => p.pid))
      )

      const scan = await findLockingProcesses(file)
      assert.ok(scan.processes.length >= 2, '应至少查到两个占用者，实际: ' + scan.processes.length)
      assert.ok(scan.processes.some(p => p.pid === first.pid))
      assert.ok(scan.processes.some(p => p.pid === second.pid))
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('killAllLockingProcesses ends every holder and confirms the release', windowsOnly, async () => {
    const { killAllLockingProcesses, probePathState, findLockingProcesses } = require('./unlock')
    const file = tmpFile('kill-all.txt', 'hello')
    const first = await startSharedHolder(file)
    const second = await startSharedHolder(file)

    try {
      assert.equal(await probePathState(file), 'locked')
      const scan = await findLockingProcesses(file)
      assert.ok(scan.processes.length >= 2, '应至少查到两个占用者，实际: ' + scan.processes.length)

      const result = await killAllLockingProcesses(file, [
        { pid: first.pid, name: 'powershell.exe' },
        { pid: second.pid, name: 'powershell.exe' }
      ])

      assert.equal(result.killed, 2)
      assert.equal(result.failed, 0)
      assert.equal(result.released, true)
      assert.equal(result.level, 'success')
      assert.match(result.message, /已解除占用/)
      assert.equal(await probePathState(file), 'free')
    } finally {
      first.dispose()
      second.dispose()
    }
  })
})

describe('killProcess', () => {
  it('returns result object with success and message fields', async () => {
    const { killProcess } = require('./unlock')

    const testProc = spawn('ping', ['127.0.0.1', '-t'], { windowsHide: true })
    const testPid = testProc.pid

    await new Promise(r => setTimeout(r, 100))

    try {
      const result = await killProcess(testPid, 'ping.exe')

      assert.ok(result && typeof result === 'object', 'should return object')
      assert.ok(typeof result.success === 'boolean', 'should have success boolean')
      assert.ok(typeof result.message === 'string', 'should have message string')
      assert.ok(result.message.length > 0, 'message should not be empty')
      assert.match(result.message, /ping\.exe/)
    } finally {
      try { testProc.kill() } catch (e) {}
    }
  })

  it('speaks to users instead of dumping exit codes', async () => {
    const { killProcess } = require('./unlock')
    const dead = spawn('cmd.exe', ['/c', 'exit'], { windowsHide: true })
    await new Promise(r => r(dead.on('close', r)))
    await sleep(300)

    const result = await killProcess(dead.pid, 'cmd.exe')
    assert.equal(result.success, true)
    assert.doesNotMatch(result.message, /exit code|退出码|128/)
    assert.match(result.message, /cmd\.exe/)
  })

  it('explains permission problems in plain language', async () => {
    const { killProcess } = require('./unlock')
    // 复用真实分支：不存在的 PID 会被 taskkill 视为已退出
    const result = await killProcess(999999, 'no-such-process.exe')
    assert.ok(typeof result.message === 'string')
    assert.doesNotMatch(result.message, /exit code|退出码/i)
  })
})

describe('psLiteral', () => {
  it('escapes single quotes and never interpolates', () => {
    const { psLiteral } = require('./unlock')
    assert.equal(psLiteral("C:\\a\\b.txt"), "'C:\\a\\b.txt'")
    assert.equal(psLiteral("D:\\it's\\a$file.txt"), "'D:\\it''s\\a$file.txt'")
    assert.equal(psLiteral(null), "''")
  })

  it('keeps $-paths intact inside the generated scripts', () => {
    const { buildResourceManagerScript, buildProbeScript } = require('./unlock')
    const weird = "C:\\tmp\\$env:TEMP\\`tick\\o'brien.txt"
    const expected = "'" + weird.replace(/'/g, "''") + "'"
    assert.ok(buildResourceManagerScript(weird).includes('$path = ' + expected))
    assert.ok(buildProbeScript(weird).includes('$path = ' + expected))
  })
})

describe('dedupeByPid', () => {
  it('keeps first occurrence of each pid', () => {
    const { dedupeByPid } = require('./unlock')
    const out = dedupeByPid([
      { pid: 1, name: 'a' },
      { pid: 1, name: 'b' },
      { pid: 2, name: 'c' },
      { pid: 0, name: 'bad' }
    ])
    assert.equal(out.length, 2)
    assert.equal(out[0].name, 'a')
    assert.equal(out[1].pid, 2)
  })
})

describe('getDebugLog', () => {
  it('returns array and clears internal buffer', () => {
    const { getDebugLog } = require('./unlock')

    const logs1 = getDebugLog()
    assert.ok(Array.isArray(logs1), 'should return array')

    const logs2 = getDebugLog()
    assert.ok(Array.isArray(logs2), 'should return array on second call')
  })
})
