'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { redact } = require('../public/preload/core/model.cjs')
const win32 = require('../public/preload/adapters/win32.cjs')
const darwin = require('../public/preload/adapters/darwin.cjs')
const linux = require('../public/preload/adapters/linux.cjs')
const runner = require('../public/preload/core/runner.cjs')

const root = path.resolve(__dirname, '..')

test('sensitive home paths are redacted on every desktop platform', () => {
  assert.equal(redact('/Users/alice/private/tool', '/Users/alice'), '~/private/tool')
  assert.equal(redact('/home/alice/private/tool', '/home/alice'), '~/private/tool')
  assert.equal(redact('C:\\Users\\alice\\private\\tool.exe', 'C:\\Users\\alice'), '~\\private\\tool.exe')
})

test('PowerShell collector is static, encoded, and avoids script evaluation', () => {
  assert.doesNotMatch(win32.SCAN_SCRIPT, /Invoke-Expression|\biex\b|Start-Process|cmd\.exe|\.Invoke\(/i)
  assert.doesNotMatch(win32.TASK_STATE_SCRIPT, /Invoke-Expression|\biex\b|Start-Process|cmd\.exe/i)
  for (const script of [win32.SCAN_SCRIPT, win32.TASK_STATE_SCRIPT]) {
    assert.match(script, /OutputEncoding=\[System\.Text\.UTF8Encoding]::new\(\$false\)/)
    assert.match(script, /PSModuleAutoloadingPreference='None'/)
    assert.match(script, /ScheduledTasks\\ScheduledTasks\.psd1|\$module\+'\\'\+\$module\+'\.psd1'/)
  }
  assert.equal(win32.parseRows(`\uFEFF[{"kind":"scheduled-task","name":"中文任务"}]`)[0].name, '中文任务')
  assert.equal(win32.parseState(`\uFEFF{"enabled":true,"uri":"\\\\任务"}`).uri, '\\任务')
  const encoded = win32.encoded(win32.SCAN_SCRIPT)
  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), win32.SCAN_SCRIPT)
})

test('preload sources never invoke shell mode or privilege escalation', () => {
  const files = []
  function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target); else files.push(target) } }
  walk(path.join(root, 'public/preload'))
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(source, /shell\s*:\s*true|execSync\s*\(|\bexec\s*\(|\bsudo\b|runas|Start-Process\s+.*-Verb\s+RunAs/i)
  assert.doesNotMatch(source, /child_process[^\n]*\.exec\b/)
})

test('system tools use absolute paths and child PATH is controlled', () => {
  for (const tool of [...Object.values(darwin.TOOLS), ...Object.values(linux.TOOL_ALLOWLIST).flat()]) assert.equal(path.isAbsolute(tool), true)
  const env = runner.controlledEnvironment({ ZTOOLS_TEST: 'ok', PATH: '/attacker/bin' })
  assert.equal(env.ZTOOLS_TEST, 'ok')
  assert.notEqual(env.PATH, '/attacker/bin')
  assert.match(env.PATH, /(?:\/usr\/bin|Windows\\System32)/)
  const windows = runner.controlledEnvironment({ SystemRoot: 'C:\\Windows', PATH: 'C:\\attacker', PSModulePath: 'C:\\Users\\demo\\Modules' }, 'win32')
  assert.equal(windows.PATH, 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0')
  assert.equal(windows.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules')
})

test('Linux tool resolver accepts only existing /usr/bin or /bin allowlist entries', async () => {
  const checked = []
  const fakeFs = { async access(candidate) { checked.push(candidate); if (candidate !== '/bin/systemctl') throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } }
  assert.equal(await linux.resolveTool('systemctl', fakeFs), '/bin/systemctl')
  assert.deepEqual(checked, ['/usr/bin/systemctl', '/bin/systemctl'])
  await assert.rejects(linux.resolveTool('systemctl', fakeFs, '/tmp/systemctl'), (error) => error.code === 'TOOL_UNAVAILABLE')
})
