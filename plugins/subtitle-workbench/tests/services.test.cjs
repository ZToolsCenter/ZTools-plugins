'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
function loadWithHost(ztools) {
  global.window = { ztools }
  delete require.cache[require.resolve('../preload/services.cjs')]
  return require('../preload/services.cjs')
}
function manyFindingsSrt(count = 150) {
  return Array.from({ length: count }, (_, index) => `${index + 1}\n00:00:00,000 --> 00:00:00,100\nFast subtitle ${index}`).join('\n\n') + '\n'
}
test('manifest declarations and preload registrations use the same short MCP names', () => {
  const calls = new Map()
  const service = loadWithHost({ registerTool(name, handler) { calls.set(name, handler) } })
  const manifest = require('../plugin.json')
  assert.deepEqual(Object.keys(manifest.tools).sort(), Object.values(service.TOOL_NAMES).sort())
  assert.deepEqual([...calls.keys()].sort(), Object.values(service.TOOL_NAMES).sort())
  assert.ok([...calls.values()].every((handler) => typeof handler === 'function'))
  delete global.window
})
test('legacy hosts without registerTool keep the renderer bridge', () => {
  loadWithHost({})
  assert.equal(typeof global.window.subtitleWorkbench.analyze, 'function')
  assert.equal(typeof global.window.subtitleWorkbench.transform, 'function')
  delete global.window
})
test('one registerTool failure does not block the UI or remaining MCP tools', () => {
  const registered = []
  const service = loadWithHost({ registerTool(name) { if (name === 'analyze') throw new Error('one failure'); registered.push(name) } })
  assert.deepEqual(registered.sort(), [service.TOOL_NAMES.analyzeApprovedFile, service.TOOL_NAMES.transform].sort())
  assert.equal(typeof global.window.subtitleWorkbench.analyze, 'function')
  delete global.window
})
test('inline MCP handlers execute core analysis and transformations with bounded output', async () => {
  const calls = new Map()
  const service = loadWithHost({ registerTool(name, handler) { calls.set(name, handler) } })
  const source = '1\n00:00:01,000 --> 00:00:01,100\nFast text here\n\n2\n00:00:02,000 --> 00:00:03,000\nOK\n'
  const analyzed = await calls.get(service.TOOL_NAMES.analyze)({ content: source, format: 'srt', thresholds: { minDuration: 500 }, offset: 0, limit: 1 })
  assert.equal(analyzed.cueCount, 2)
  assert.equal(analyzed.findings.length, 1)
  assert.ok(analyzed.summary.totalFindings >= 1)
  assert.equal(analyzed.duration.endMs, 3000)
  const shifted = await calls.get(service.TOOL_NAMES.transform)({ content: source, format: 'srt', operation: 'shift', milliseconds: 500, outputFormat: 'vtt' })
  assert.equal(shifted.outputFormat, 'vtt')
  assert.equal(shifted.cueCount, 2)
  assert.match(shifted.content, /^WEBVTT/)
  assert.match(shifted.content, /00:00:01\.500/)
  assert.ok(Buffer.byteLength(JSON.stringify(analyzed), 'utf8') <= service.MAX_MCP_RESPONSE_BYTES)
  assert.ok(Buffer.byteLength(JSON.stringify(shifted), 'utf8') <= service.MAX_MCP_RESPONSE_BYTES)
  delete global.window
})
test('analysis summary handles very large cue arrays without argument spreading', () => {
  const service = loadWithHost({})
  const cues = Array.from({ length: 150000 }, (_, index) => ({ start: index + 10, end: index + 1010 }))
  const result = service.__test.summarizeAnalysis({ cues, findings: [] }, { offset: 0, limit: 100 })
  assert.equal(result.cueCount, 150000)
  assert.deepEqual(result.duration, { startMs: 10, endMs: 151009, spanMs: 150999 })
  delete global.window
})
test('subtitle handle reads enforce the approved byte count before allocating more input', async () => {
  const service = loadWithHost({})
  const fakeHandle = (value) => {
    let cursor = 0
    return { async read(target, offset, length) { const bytesRead = Math.min(length, value.length - cursor); if (bytesRead > 0) value.copy(target, offset, cursor, cursor + bytesRead); cursor += bytesRead; return { bytesRead } } }
  }
  assert.equal((await service.__test.readHandleBounded(fakeHandle(Buffer.from('abc')), 3)).toString(), 'abc')
  await assert.rejects(service.__test.readHandleBounded(fakeHandle(Buffer.from('abcd')), 3), /大小限制/)
  delete global.window
})
test('registered MCP analysis paginates within budget and transform rejects JSON escape inflation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-mcp-budget-'))
  const approvedFile = path.join(directory, 'many-findings.srt')
  const source = manyFindingsSrt()
  await fs.writeFile(approvedFile, source)
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [approvedFile], registerTool(name, handler) { calls.set(name, handler) } })
  await global.window.subtitleWorkbench.chooseInput()
  async function collectPages(invoke) {
    let offset = 0; let total = null; const evidence = []
    while (true) {
      const result = await invoke(offset)
      assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= service.MAX_MCP_RESPONSE_BYTES)
      assert.equal(result.summary.offset, offset)
      assert.equal(result.summary.returned, result.findings.length)
      assert.ok(result.findings.length <= 200)
      if (total === null) total = result.summary.totalFindings
      else assert.equal(result.summary.totalFindings, total)
      evidence.push(...result.findings.map((item) => `${item.index}:${item.code}`))
      if (!result.summary.hasMore) { assert.equal(result.summary.nextOffset, null); break }
      assert.equal(result.summary.nextOffset, offset + result.summary.returned)
      assert.ok(result.summary.nextOffset > offset)
      offset = result.summary.nextOffset
    }
    assert.equal(evidence.length, total)
    assert.equal(new Set(evidence).size, evidence.length)
    return { total, evidence }
  }
  const inline = await collectPages((offset) => calls.get(service.TOOL_NAMES.analyze)({ content: source, format: 'srt', offset, limit: 200 }))
  const approved = await collectPages((offset) => calls.get(service.TOOL_NAMES.analyzeApprovedFile)({ offset, limit: 200 }))
  assert.equal(approved.total, inline.total)
  assert.deepEqual(approved.evidence, inline.evidence)
  const inflatedSource = `1\n00:00:01,000 --> 00:00:02,000\n${'\u0001'.repeat(520000)}\n`
  assert.ok(Buffer.byteLength(inflatedSource, 'utf8') < 512 * 1024)
  const rawContent = global.window.subtitleWorkbench.transform(inflatedSource, 'srt', { type: 'convert', format: 'srt' })
  assert.ok(Buffer.byteLength(JSON.stringify({ outputFormat: 'srt', content: rawContent, cueCount: 1, warnings: [] }), 'utf8') > 3000000)
  assert.throws(() => calls.get(service.TOOL_NAMES.transform)({ content: inflatedSource, format: 'srt', operation: 'convert', outputFormat: 'srt' }), (error) => error.code === 'MCP_RESPONSE_TOO_LARGE' && !error.message.includes('\u0001'))
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('MCP validators reject unknown, hostile, oversized, and operation-mismatched input before parsing', async () => {
  const calls = new Map()
  const service = loadWithHost({ registerTool(name, handler) { calls.set(name, handler) } })
  const analyzeTool = calls.get(service.TOOL_NAMES.analyze)
  assert.throws(() => analyzeTool({ content: '', format: 'srt', command: 'write' }), (error) => error.code === 'INVALID_TOOL_INPUT')
  const hostile = JSON.parse('{"content":"","format":"srt","__proto__":{"polluted":true}}')
  assert.throws(() => analyzeTool(hostile), (error) => error.code === 'INVALID_TOOL_INPUT')
  assert.throws(() => analyzeTool({ content: '你'.repeat(200000), format: 'srt' }), /512 KiB/)
  assert.throws(() => calls.get(service.TOOL_NAMES.transform)({ content: '', format: 'srt', operation: 'convert', speed: 2 }), /不适用字段/)
  assert.throws(() => calls.get(service.TOOL_NAMES.transform)({ content: '', format: 'srt', operation: 'convert' }), /outputFormat/)
  assert.throws(() => analyzeTool({ content: '', format: 'srt', thresholds: { minDuration: 1000, maxDuration: 999 } }), /不能小于/)
  let getterCalled = false
  const accessor = { format: 'srt' }
  Object.defineProperty(accessor, 'content', { enumerable: true, get() { getterCalled = true; return '' } })
  assert.throws(() => analyzeTool(accessor), (error) => error.code === 'INVALID_TOOL_INPUT')
  assert.equal(getterCalled, false)
  const symbolInput = { content: '', format: 'srt' }; symbolInput[Symbol('hidden')] = true
  assert.throws(() => analyzeTool(symbolInput), (error) => error.code === 'INVALID_TOOL_INPUT')
  delete global.window
})
test('approved-file MCP handler uses only the latest subtitle chosen in the UI', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-mcp-approved-'))
  const file = path.join(directory, 'approved.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nApproved\n')
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [file], registerTool(name, handler) { calls.set(name, handler) } })
  await assert.rejects(() => calls.get(service.TOOL_NAMES.analyzeApprovedFile)({}), (error) => error.code === 'UI_APPROVAL_REQUIRED')
  const originalOpen = fs.open; const opened = []
  fs.open = async (...args) => { const handle = await originalOpen(...args); opened.push(handle); return handle }
  let result
  try {
    await global.window.subtitleWorkbench.chooseInput()
    result = await calls.get(service.TOOL_NAMES.analyzeApprovedFile)({ offset: 0, limit: 10 })
  }
  finally { fs.open = originalOpen }
  assert.equal(result.cueCount, 1)
  assert.equal(result.summary.totalFindings, 0)
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= service.MAX_MCP_RESPONSE_BYTES)
  assert.equal(opened.length, 2)
  for (const handle of opened) await assert.rejects(handle.stat(), (error) => error.code === 'EBADF')
  await assert.rejects(() => calls.get(service.TOOL_NAMES.analyzeApprovedFile)({ path: file }), (error) => error.code === 'INVALID_TOOL_INPUT')
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('delayed file dialog cannot create a subtitle grant after plugin exit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-dialog-exit-'))
  const file = path.join(directory, 'late.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nLate\n')
  let resolveDialog, onOut
  const handlers = new Map()
  const service = loadWithHost({
    showOpenDialog: () => new Promise((resolve) => { resolveDialog = resolve }),
    onPluginOut(callback) { onOut = callback },
    registerTool(name, handler) { handlers.set(name, handler) }
  })
  const pending = global.window.subtitleWorkbench.chooseInput()
  onOut()
  resolveDialog([file])
  assert.deepEqual(await pending, { ok: false, code: 'SESSION_EXPIRED' })
  assert.equal(service.__test.activeSubtitleGrantId(), null)
  await assert.rejects(handlers.get(service.TOOL_NAMES.analyzeApprovedFile)({}), { code: 'UI_APPROVAL_REQUIRED' })
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('delayed entry path cannot enqueue or activate a grant after plugin exit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-entry-exit-'))
  const file = path.join(directory, 'late.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nLate\n')
  let resolvePath, onEnter, onOut
  const handlers = new Map()
  const service = loadWithHost({
    getPathForFile: () => new Promise((resolve) => { resolvePath = resolve }),
    onPluginEnter(callback) { onEnter = callback },
    onPluginOut(callback) { onOut = callback },
    registerTool(name, handler) { handlers.set(name, handler) }
  })
  onEnter({ type: 'files', payload: [{}] })
  onOut()
  resolvePath(file)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(global.window.subtitleWorkbench.consumeEntry(), { ok: false, code: 'NO_ENTRY' })
  assert.equal(service.__test.activeSubtitleGrantId(), null)
  await assert.rejects(handlers.get(service.TOOL_NAMES.analyzeApprovedFile)({}), { code: 'UI_APPROVAL_REQUIRED' })
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('approved-file MCP fails closed when plugin exit occurs during handle read', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-mcp-exit-read-'))
  const file = path.join(directory, 'approved.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nApproved\n')
  let onOut
  const handlers = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [file], onPluginOut(callback) { onOut = callback }, registerTool(name, handler) { handlers.set(name, handler) } })
  await global.window.subtitleWorkbench.chooseInput()
  const originalOpen = fs.open
  let releaseRead, announceRead
  const readStarted = new Promise((resolve) => { announceRead = resolve })
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  fs.open = async (...args) => {
    const handle = await originalOpen(...args)
    return {
      stat: (...statArgs) => handle.stat(...statArgs),
      async read(...readArgs) { announceRead(); await readGate; return handle.read(...readArgs) },
      close: () => handle.close()
    }
  }
  try {
    const pending = handlers.get(service.TOOL_NAMES.analyzeApprovedFile)({})
    await readStarted
    onOut()
    releaseRead()
    await assert.rejects(pending, (error) => error.code === 'APPROVED_SUBTITLE_FAILED')
    assert.equal(service.__test.activeSubtitleGrantId(), null)
  } finally {
    fs.open = originalOpen
    delete global.window
    await fs.rm(directory, { recursive: true, force: true })
  }
})
test('approved-file analysis never calls unbounded readFile when the selected file grows', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-mcp-growth-'))
  const file = path.join(directory, 'growth.srt')
  const source = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nApproved\n')
  await fs.writeFile(file, source)
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [file], registerTool(name, handler) { calls.set(name, handler) } })
  await global.window.subtitleWorkbench.chooseInput()
  const originalOpen = fs.open
  let readFileCalled = false
  fs.open = async (...args) => {
    const real = await originalOpen(...args)
    const expanded = Buffer.concat([source, Buffer.from('x')])
    let cursor = 0
    return {
      stat: (...statArgs) => real.stat(...statArgs),
      async read(target, offset, length) { const bytesRead = Math.min(length, expanded.length - cursor); if (bytesRead > 0) expanded.copy(target, offset, cursor, cursor + bytesRead); cursor += bytesRead; return { bytesRead } },
      async readFile() { readFileCalled = true; return expanded },
      close: () => real.close()
    }
  }
  try {
    await assert.rejects(calls.get(service.TOOL_NAMES.analyzeApprovedFile)({}), (error) => error.code === 'APPROVED_SUBTITLE_FAILED')
    assert.equal(readFileCalled, false)
  } finally {
    fs.open = originalOpen
    delete global.window
    await fs.rm(directory, { recursive: true, force: true })
  }
})
test('approved-file MCP revokes a same-inode rewrite even when size and mtime are restored', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-mcp-rewrite-'))
  const file = path.join(directory, 'rewritten.srt')
  const original = '1\n00:00:01,000 --> 00:00:02,000\nORIGINAL\n'
  const replacement = '1\n00:00:01,000 --> 00:00:02,000\nREPLACED\n'
  assert.equal(Buffer.byteLength(original), Buffer.byteLength(replacement))
  await fs.writeFile(file, original)
  const fixedSeconds = 1700000000
  await fs.utimes(file, fixedSeconds, fixedSeconds)
  const before = await fs.stat(file)
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [file], registerTool(name, handler) { calls.set(name, handler) } })
  await global.window.subtitleWorkbench.chooseInput()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await fs.writeFile(file, replacement)
  await fs.utimes(file, fixedSeconds, fixedSeconds)
  const after = await fs.stat(file)
  assert.equal(after.dev, before.dev)
  assert.equal(after.ino, before.ino)
  assert.equal(after.size, before.size)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.notEqual(after.ctimeMs, before.ctimeMs)
  const originalLstat = fs.lstat; const originalOpen = fs.open; let opened
  fs.lstat = async (...args) => { const stat = await originalLstat(...args); stat.ctimeMs = before.ctimeMs; return stat }
  fs.open = async (...args) => {
    const handle = await originalOpen(...args); opened = handle
    return {
      async stat() { const stat = await handle.stat(); stat.ctimeMs = before.ctimeMs; return stat },
      read: (...readArgs) => handle.read(...readArgs),
      close: () => handle.close()
    }
  }
  try {
    await assert.rejects(calls.get(service.TOOL_NAMES.analyzeApprovedFile)({ offset: 0, limit: 10 }), (error) => {
      assert.equal(error.code, 'APPROVED_SUBTITLE_FAILED')
      assert.equal(error.message.includes(directory), false)
      assert.equal(error.message.includes(file), false)
      assert.equal(error.message.includes('REPLACED'), false)
      return true
    })
  } finally { fs.lstat = originalLstat; fs.open = originalOpen }
  await assert.rejects(opened.stat(), (error) => error.code === 'EBADF')
  assert.equal(service.__test.activeSubtitleGrantId(), null)
  await assert.rejects(calls.get(service.TOOL_NAMES.analyzeApprovedFile)({}), (error) => error.code === 'UI_APPROVAL_REQUIRED')
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('approved-file MCP failures revoke the grant and never expose a deleted absolute path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-mcp-deleted-'))
  const file = path.join(directory, 'deleted.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nDeleted\n')
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [file], registerTool(name, handler) { calls.set(name, handler) } })
  await global.window.subtitleWorkbench.chooseInput()
  await fs.rm(file)
  await assert.rejects(calls.get(service.TOOL_NAMES.analyzeApprovedFile)({}), (error) => {
    assert.equal(error.code, 'APPROVED_SUBTITLE_FAILED')
    assert.equal(error.message.includes(directory), false)
    assert.equal(error.message.includes(file), false)
    return true
  })
  assert.equal(service.__test.activeSubtitleGrantId(), null)
  await assert.rejects(calls.get(service.TOOL_NAMES.analyzeApprovedFile)({}), (error) => error.code === 'UI_APPROVAL_REQUIRED')
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('renderer bridge is narrow and does not expose raw executable or path operations', async () => {
  global.window = { ztools: {} }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const api = global.window.subtitleWorkbench
  assert.equal(typeof api.consumeEntry, 'function')
  assert.equal(typeof api.startAudioExtract, 'function')
  assert.equal(api.runWhisper, undefined)
  assert.equal(api.extractAudio, undefined)
  assert.equal(api.onPluginEnter, undefined)
  const result = await api.startTranscription()
  assert.equal(result.code, 'TRANSCRIPTION_UNSUPPORTED')
  delete global.window
})
test('showOpenDialog accepts official string array result', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-dialog-')); const file = path.join(directory, 'one.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nHi\n')
  global.window = { ztools: { showOpenDialog: async () => [file] } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const result = await global.window.subtitleWorkbench.chooseInput()
  assert.equal(result.ok, true); assert.equal(result.file.name, 'one.srt')
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('VTT transform keeps its input format by default', () => {
  global.window = { ztools: {} }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const value = global.window.subtitleWorkbench.transform('WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n', 'vtt', { type: 'shift', milliseconds: 500 })
  assert.match(value, /^WEBVTT/); assert.match(value, /00:00:01\.500/)
  delete global.window
})
test('subtitle save replaces regular files but rejects directories and special stat entries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-save-target-'))
  const regular = path.join(directory, 'regular.srt')
  await fs.writeFile(regular, 'old')
  let target = regular
  const service = loadWithHost({ showSaveDialog: async () => target })
  const saved = await global.window.subtitleWorkbench.saveSubtitle('new', 'srt', 'regular.srt')
  assert.deepEqual(saved, { canceled: false, fileName: 'regular.srt' })
  assert.equal(await fs.readFile(regular, 'utf8'), 'new')
  target = directory
  await assert.rejects(global.window.subtitleWorkbench.saveSubtitle('blocked', 'srt', 'blocked.srt'), /普通文件/)
  assert.throws(() => service.__test.assertReplaceableSubtitleOutput({ isSymbolicLink: () => false, isFile: () => false }), /特殊文件/)
  assert.throws(() => service.__test.assertReplaceableSubtitleOutput({ isSymbolicLink: () => true, isFile: () => false }), /符号链接/)
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('plugin exit invalidates a pending subtitle save dialog before any file is written', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-save-session-'))
  const destination = path.join(directory, 'after-exit.srt')
  let onOut
  let resolveDialog
  const dialog = new Promise((resolve) => { resolveDialog = resolve })
  loadWithHost({
    showSaveDialog: async () => dialog,
    onPluginOut(callback) { onOut = callback }
  })
  const pending = global.window.subtitleWorkbench.saveSubtitle('new', 'srt', 'after-exit.srt')
  onOut()
  resolveDialog(destination)
  await assert.rejects(pending, (error) => error?.code === 'SESSION_EXPIRED')
  await assert.rejects(fs.lstat(destination), { code: 'ENOENT' })
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('subtitle save maps filesystem failures to a stable path-free error', async () => {
  const secretDestination = path.join(os.tmpdir(), 'subtitle-secret-parent-does-not-exist', 'very-secret-name.srt')
  loadWithHost({ showSaveDialog: async () => secretDestination })
  await assert.rejects(global.window.subtitleWorkbench.saveSubtitle('new', 'srt', 'secret.srt'), (error) => {
    assert.equal(error?.code, 'SUBTITLE_SAVE_FAILED')
    assert.equal(error.message.includes(secretDestination), false)
    assert.equal(error.message.includes('very-secret-name.srt'), false)
    return true
  })
  delete global.window
})
test('plugin exit during backup cleanup does not reject an already committed subtitle save', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-save-commit-'))
  const destination = path.join(directory, 'target.srt')
  await fs.writeFile(destination, 'old')
  let onOut
  let reachedCleanup
  let resumeCleanup
  const cleanupReached = new Promise((resolve) => { reachedCleanup = resolve })
  const cleanupResume = new Promise((resolve) => { resumeCleanup = resolve })
  const originalRm = fs.rm
  fs.rm = async function delayedBackupRemoval(candidate, options) {
    if (String(candidate).endsWith('.backup')) {
      reachedCleanup()
      await cleanupResume
    }
    return originalRm.call(this, candidate, options)
  }
  try {
    loadWithHost({
      showSaveDialog: async () => destination,
      onPluginOut(callback) { onOut = callback }
    })
    const pending = global.window.subtitleWorkbench.saveSubtitle('new', 'srt', 'target.srt')
    await cleanupReached
    onOut()
    resumeCleanup()
    assert.deepEqual(await pending, { canceled: false, fileName: 'target.srt' })
    assert.equal(await fs.readFile(destination, 'utf8'), 'new')
  } finally {
    fs.rm = originalRm
    delete global.window
    await fs.rm(directory, { recursive: true, force: true })
  }
})
test('subtitle save rolls back every pre-commit filesystem stage when the plugin exits', async () => {
  const scenarios = [
    { name: 'target-check', method: 'lstat', existing: true, match: (args, destination) => args[0] === destination },
    { name: 'temporary-write', method: 'writeFile', existing: true, match: (args) => String(args[0]).endsWith('.tmp') },
    { name: 'backup-move', method: 'rename', existing: true, match: (args, destination) => args[0] === destination && String(args[1]).endsWith('.backup') },
    { name: 'final-move-existing', method: 'rename', existing: true, match: (args, destination) => String(args[0]).endsWith('.tmp') && args[1] === destination },
    { name: 'final-move-new', method: 'rename', existing: false, match: (args, destination) => String(args[0]).endsWith('.tmp') && args[1] === destination }
  ]
  for (const scenario of scenarios) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `subtitle-save-${scenario.name}-`))
    const destination = path.join(directory, 'target.srt')
    if (scenario.existing) await fs.writeFile(destination, 'old')
    let onOut
    let stageReached
    let resumeStage
    const reached = new Promise((resolve) => { stageReached = resolve })
    const resume = new Promise((resolve) => { resumeStage = resolve })
    const original = fs[scenario.method]
    let intercepted = false
    fs[scenario.method] = async function delayedStage(...args) {
      const result = await original.apply(this, args)
      if (!intercepted && scenario.match(args, destination)) {
        intercepted = true
        stageReached()
        await resume
      }
      return result
    }
    try {
      loadWithHost({
        showSaveDialog: async () => destination,
        onPluginOut(callback) { onOut = callback }
      })
      const pending = global.window.subtitleWorkbench.saveSubtitle('new', 'srt', 'target.srt')
      await reached
      onOut()
      resumeStage()
      await assert.rejects(pending, (error) => error?.code === 'SESSION_EXPIRED')
      if (scenario.existing) assert.equal(await fs.readFile(destination, 'utf8'), 'old')
      else await assert.rejects(fs.lstat(destination), { code: 'ENOENT' })
      assert.deepEqual((await fs.readdir(directory)).filter((entry) => entry.includes('.ztools-')), [])
    } finally {
      fs[scenario.method] = original
      delete global.window
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
})
test('subtitle save never replaces a POSIX FIFO', { skip: process.platform === 'win32' }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-save-fifo-'))
  const fifo = path.join(directory, 'target.srt')
  const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
  assert.equal(created.status, 0, created.stderr)
  loadWithHost({ showSaveDialog: async () => fifo })
  await assert.rejects(global.window.subtitleWorkbench.saveSubtitle('blocked', 'srt', 'target.srt'), /普通文件/)
  assert.equal((await fs.lstat(fifo)).isFIFO(), true)
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('audio promotion replaces a final only after temp success', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-promote-')); const finalFile = path.join(directory, 'final.wav'); const temporary = path.join(directory, '.final.tmp.wav')
  await fs.writeFile(finalFile, 'old'); await fs.writeFile(temporary, 'new')
  global.window = { ztools: {} }; delete require.cache[require.resolve('../preload/services.cjs')]
  const service = require('../preload/services.cjs')
  const result = await service.__test.promoteAudio(temporary, finalFile)
  assert.equal(result.warning, null)
  assert.equal(await fs.readFile(finalFile, 'utf8'), 'new'); await fs.rm(directory, { recursive: true, force: true }); delete global.window
})
test('audio promotion restores old final when promote rename fails', async () => {
  const files = new Map([['final.wav', 'old'], ['temp.wav', 'new']]); const io = {
    async lstat() { return { isSymbolicLink: () => false, isFile: () => true } },
    async rename(from, to) { if (from === 'final.wav') { files.set('backup', files.get('final.wav')); files.delete('final.wav'); return } if (from === 'temp.wav' && to === 'final.wav') throw new Error('promote failed'); if (from.startsWith('final.wav.ztools-backup-') && to === 'final.wav') { files.set('final.wav', files.get('backup')); files.delete('backup') } },
    async rm() {}
  }
  global.window = { ztools: {} }; delete require.cache[require.resolve('../preload/services.cjs')]
  const service = require('../preload/services.cjs')
  await assert.rejects(service.__test.promoteAudio('temp.wav', 'final.wav', io), (error) => error.code === 'AUDIO_PROMOTE_FAILED' && error.fileName === 'final.wav' && !error.message.includes('promote failed'))
  assert.equal(files.get('final.wav'), 'old'); delete global.window
})
test('audio promotion rejects directories and special entries before renaming them', async () => {
  const service = loadWithHost({})
  for (const kind of ['directory', 'special']) {
    let renameCalled = false
    const io = { async lstat() { return { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => kind === 'directory' } }, async rename() { renameCalled = true }, async rm() {} }
    await assert.rejects(service.__test.promoteAudio('temp.wav', 'final.wav', io), (error) => error.code === 'AUDIO_OUTPUT_NOT_FILE' && error.fileName === 'final.wav')
    assert.equal(renameCalled, false)
  }
  delete global.window
})
test('audio promotion reports a stable restore failure without exposing paths', async () => {
  const service = loadWithHost({}); let renameCalls = 0
  const io = {
    async lstat() { return { isSymbolicLink: () => false, isFile: () => true } },
    async rename() { renameCalls += 1; if (renameCalls > 1) throw new Error('restore failed at /private/secret/final.wav') },
    async rm() {}
  }
  await assert.rejects(service.__test.promoteAudio('temp.wav', '/private/secret/final.wav', io), (error) => {
    assert.equal(error.code, 'AUDIO_BACKUP_RESTORE_FAILED')
    assert.match(error.fileName, /^final\.wav\.ztools-backup-/)
    assert.equal(error.message.includes('/private/secret'), false)
    return true
  })
  assert.equal(renameCalls, 3)
  delete global.window
})
test('audio cancel uses PromiseLike kill and cleans the temporary WAV after rejection', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-cancel-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav'); await fs.writeFile(input, 'media')
  let rejectJob, killed = false, argv; const job = new Promise((resolve, reject) => { rejectJob = reject }); job.kill = () => { killed = true }
  global.window = { ztools: { showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: args => { argv = args; return job } } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const selected = await global.window.subtitleWorkbench.chooseInput(); const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId)
  assert.equal(argv[0], '-n'); assert.ok(!argv.includes('-y')); assert.match(argv.at(-1), /\.wav$/)
  await global.window.subtitleWorkbench.cancelAudio(started.jobId); assert.equal(killed, true); rejectJob(new Error('killed')); await new Promise(resolve => setImmediate(resolve))
  assert.equal(global.window.subtitleWorkbench.audioJobStatus(started.jobId).state, 'canceled'); assert.deepEqual((await fs.readdir(directory)).filter(name => name.includes('.ztools-')), [])
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('audio cancellation stays fail closed when the host cancel method rejects', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-cancel-reject-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav'); await fs.writeFile(input, 'media'); await fs.writeFile(output, 'old')
  let resolveJob; const job = new Promise(resolve => { resolveJob = resolve }); job.kill = async () => { throw new Error('cancel failed') }
  global.window = { ztools: { showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: () => job } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const selected = await global.window.subtitleWorkbench.chooseInput(); const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId)
  await assert.rejects(global.window.subtitleWorkbench.cancelAudio(started.jobId), /cancel failed/)
  assert.equal(global.window.subtitleWorkbench.audioJobStatus(started.jobId).state, 'canceling')
  resolveJob(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve))
  assert.equal(global.window.subtitleWorkbench.audioJobStatus(started.jobId).state, 'canceled')
  assert.equal(await fs.readFile(output, 'utf8'), 'old')
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.includes('.ztools-')), [])
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('temporary audio cleanup failure is path-free, visible, and retryable', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-temp-cleanup-'))
  const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav')
  await fs.writeFile(input, 'media')
  let rejectJob, temporary, cleanupCalls = 0
  const job = new Promise((resolve, reject) => { rejectJob = reject })
  const service = loadWithHost({ showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg(args) { temporary = args.at(-1); return job } })
  service.__test.setAudioCleanupIo({ async rm(candidate, options) { cleanupCalls += 1; if (cleanupCalls === 1) { const error = new Error('EPERM at '+candidate); error.code = 'EPERM'; throw error } return fs.rm(candidate, options) } })
  const selected = await global.window.subtitleWorkbench.chooseInput()
  const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId)
  await fs.writeFile(temporary, 'sensitive partial audio')
  rejectJob(new Error('ffmpeg failed'))
  await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve))
  const status = global.window.subtitleWorkbench.audioJobStatus(started.jobId)
  assert.equal(status.state, 'failed')
  assert.equal(status.warning.code, 'AUDIO_TEMP_CLEANUP_FAILED')
  assert.equal(status.warning.fileName, path.basename(temporary))
  assert.equal(JSON.stringify(status).includes(directory), false)
  assert.equal((await fs.lstat(temporary)).isFile(), true)
  const pending = global.window.subtitleWorkbench.pendingAudioCleanups()
  assert.deepEqual(pending, [{ jobId: started.jobId, code: 'AUDIO_TEMP_CLEANUP_FAILED', fileName: path.basename(temporary) }])
  assert.equal(JSON.stringify(pending).includes(directory), false)
  assert.deepEqual(await global.window.subtitleWorkbench.retryAudioCleanup(started.jobId), { ok: true, fileName: path.basename(temporary) })
  await assert.rejects(fs.lstat(temporary), { code: 'ENOENT' })
  assert.deepEqual(global.window.subtitleWorkbench.pendingAudioCleanups(), [])
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('plugin exit retains a path-free cleanup record when temporary removal fails', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-exit-cleanup-'))
  const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav')
  await fs.writeFile(input, 'media')
  let rejectJob, temporary, onOut, cleanupCalls = 0
  const job = new Promise((resolve, reject) => { rejectJob = reject }); job.kill = () => {}
  const service = loadWithHost({ showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg(args) { temporary = args.at(-1); return job }, onPluginOut(callback) { onOut = callback } })
  service.__test.setAudioCleanupIo({ async rm(candidate, options) { cleanupCalls += 1; if (cleanupCalls === 1) throw Object.assign(new Error('locked '+candidate), { code: 'EPERM' }); return fs.rm(candidate, options) } })
  const selected = await global.window.subtitleWorkbench.chooseInput()
  const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId)
  await fs.writeFile(temporary, 'sensitive partial audio')
  onOut()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(global.window.subtitleWorkbench.audioJobStatus(started.jobId).state, 'unknown')
  assert.deepEqual(global.window.subtitleWorkbench.pendingAudioCleanups(), [{ jobId: started.jobId, code: 'AUDIO_TEMP_CLEANUP_FAILED', fileName: path.basename(temporary) }])
  assert.deepEqual(await global.window.subtitleWorkbench.retryAudioCleanup(started.jobId), { ok: true, fileName: path.basename(temporary) })
  rejectJob(new Error('killed'))
  await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(global.window.subtitleWorkbench.pendingAudioCleanups(), [])
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('plugin exit cancels a running audio job and a later resolve cannot promote it', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-exit-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav'); await fs.writeFile(input, 'media'); await fs.writeFile(output, 'old')
  let resolveJob, out, outCallback; const job = new Promise(resolve => { resolveJob = resolve }); job.kill = () => {}
  global.window = { ztools: { showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: args => { out = args.at(-1); return job }, onPluginOut: callback => { outCallback = callback } } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const selected = await global.window.subtitleWorkbench.chooseInput(); const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId)
  const temporary = out
  assert.equal(typeof outCallback, 'function'); outCallback(); resolveJob(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(await fs.readFile(output, 'utf8'), 'old'); assert.equal(global.window.subtitleWorkbench.audioJobStatus(started.jobId).state, 'unknown'); if (temporary) assert.deepEqual((await fs.readdir(directory)).filter(name => name.includes('.ztools-')), [])
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('plugin exit during the second media grant validation never starts FFmpeg or creates an audio job', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-exit-grant-'))
  const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav')
  await fs.writeFile(input, 'media')
  let onOut, runCalls = 0, releaseValidation, announceValidation
  const validationStarted = new Promise((resolve) => { announceValidation = resolve })
  const validationGate = new Promise((resolve) => { releaseValidation = resolve })
  const service = loadWithHost({
    showOpenDialog: async () => [input],
    showSaveDialog: async () => output,
    runFFmpeg() { runCalls += 1; return Promise.resolve() },
    onPluginOut(callback) { onOut = callback }
  })
  const selected = await global.window.subtitleWorkbench.chooseInput()
  const originalLstat = fs.lstat
  let inputLstatCalls = 0
  service.__test.setFileValidationIo({
    async lstat(...args) {
      const result = await originalLstat(...args)
      if (++inputLstatCalls === 3) {
        announceValidation()
        await validationGate
      }
      return result
    },
    realpath: (...args) => fs.realpath(...args)
  })
  try {
    const pending = global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId)
    await validationStarted
    onOut()
    releaseValidation()
    await assert.rejects(pending, (error) => error.code === 'SESSION_EXPIRED')
    assert.equal(runCalls, 0)
    assert.equal(service.__test.audioJobCount(), 0)
  } finally {
    service.__test.setFileValidationIo(null)
    delete global.window
    await fs.rm(directory, { recursive: true, force: true })
  }
})
test('backup cleanup failure returns a stable visible warning without reversing the promote', async () => {
  const files = new Map([['final.wav', 'old'], ['temp.wav', 'new']]); const io = {
    async lstat() { return { isSymbolicLink: () => false, isFile: () => true } },
    async rename(from, to) { if (from === 'final.wav') { files.set('backup', files.get('final.wav')); files.delete('final.wav'); return } if (from === 'temp.wav' && to === 'final.wav') { files.set('final.wav', files.get('temp.wav')); files.delete('temp.wav') } },
    async rm() { throw new Error('cleanup failed') }
  }
  global.window = { ztools: {} }; delete require.cache[require.resolve('../preload/services.cjs')]
  const service = require('../preload/services.cjs'); const result = await service.__test.promoteAudio('temp.wav', 'final.wav', io)
  assert.equal(result.warning.code, 'AUDIO_BACKUP_CLEANUP_FAILED'); assert.match(result.warning.fileName, /^final\.wav\.ztools-backup-/); assert.equal(result.warning.fileName.includes('/'), false)
  assert.equal(files.get('final.wav'), 'new'); delete global.window
})
test('audio job status exposes backup cleanup failure without absolute paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-cleanup-warning-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav'); await fs.writeFile(input, 'media'); await fs.writeFile(output, 'old')
  let resolveJob; const job = new Promise(resolve => { resolveJob = resolve }); const service = loadWithHost({ showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: () => job })
  service.__test.setAudioPromotionIo({ async lstat() { return { isSymbolicLink: () => false, isFile: () => true } }, async rename() {}, async rm() { throw new Error('cleanup failed at /private/secret/backup.wav') } })
  const selected = await global.window.subtitleWorkbench.chooseInput(); const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId); resolveJob(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve))
  const status = global.window.subtitleWorkbench.audioJobStatus(started.jobId)
  assert.equal(status.state, 'completed'); assert.equal(status.warning.code, 'AUDIO_BACKUP_CLEANUP_FAILED'); assert.match(status.warning.fileName, /^output\.wav\.ztools-backup-/); assert.equal(JSON.stringify(status).includes(directory), false); assert.equal(JSON.stringify(status).includes('/private/secret'), false)
  service.__test.clearSession(); delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('audio job status exposes restore failure as a stable path-free error', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-restore-failure-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav'); await fs.writeFile(input, 'media'); await fs.writeFile(output, 'old')
  let resolveJob, renameCalls = 0; const job = new Promise(resolve => { resolveJob = resolve }); const service = loadWithHost({ showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: () => job })
  service.__test.setAudioPromotionIo({ async lstat() { return { isSymbolicLink: () => false, isFile: () => true } }, async rename() { renameCalls += 1; if (renameCalls > 1) throw new Error('restore failed at /private/secret/output.wav') }, async rm() {} })
  const selected = await global.window.subtitleWorkbench.chooseInput(); const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId); resolveJob(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve))
  const status = global.window.subtitleWorkbench.audioJobStatus(started.jobId)
  assert.equal(status.state, 'failed'); assert.equal(status.code, 'AUDIO_BACKUP_RESTORE_FAILED'); assert.match(status.fileName, /^output\.wav\.ztools-backup-/); assert.match(status.message, /未能自动恢复/); assert.equal(JSON.stringify(status).includes(directory), false); assert.equal(JSON.stringify(status).includes('/private/secret'), false)
  service.__test.clearSession(); delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('audio extraction rejects a directory output before starting FFmpeg', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-output-directory-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output'); await fs.writeFile(input, 'media'); await fs.mkdir(output); let started = false
  loadWithHost({ showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: () => { started = true; return Promise.resolve() } })
  const selected = await global.window.subtitleWorkbench.chooseInput()
  await assert.rejects(global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId), (error) => error.code === 'AUDIO_OUTPUT_NOT_FILE' && error.fileName === 'output' && !error.message.includes(directory))
  assert.equal(started, false); delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('audio extraction converts synchronous FFmpeg launch failures to a stable path-free error', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-launch-failure-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav'); await fs.writeFile(input, 'media')
  loadWithHost({ showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: () => { throw new Error('无法启动 '+input) } })
  const selected = await global.window.subtitleWorkbench.chooseInput()
  await assert.rejects(global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId), (error) => error.code === 'AUDIO_EXTRACT_START_FAILED' && error.fileName === 'output.wav' && !error.message.includes(directory))
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
