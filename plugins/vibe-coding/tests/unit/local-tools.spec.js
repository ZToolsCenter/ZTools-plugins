import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createFileTools } = require('../../public/runtime/tools/file-tools.js')
const { createProcessManager } = require('../../public/runtime/tools/process-manager.js')
const { createSearchTools } = require('../../public/runtime/tools/search-tools.js')
const {
  TOOL_MANIFEST,
  downloadAsset,
  resolveManagedAsset,
  resolvePlatformKey,
  validateArchiveEntries,
} = require('../../public/runtime/tools/binary-manager.js')
const {
  createShellInvocation,
  normalizePathEnvironment,
  resolveShellCommand,
} = require('../../public/runtime/tools/shell-command.js')
const { detectLineEnding } = require('../../public/runtime/tools/edit-diff.js')
const {
  resolveRuntimeToolName,
} = require('../../public/runtime/tools/shell-tool-name.js')

test('read 按行读取且 edit 原子应用多个修改并保留 BOM 与 CRLF', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-file-tools-'))
  const filePath = path.join(root, 'sample.txt')
  await fs.writeFile(filePath, '\uFEFFfirst\r\nsecond\r\nthird\r\n', 'utf8')
  const tools = createFileTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    getAttachmentStore: () => { throw new Error('本用例不读取图片') },
    createPresentedResult: (output, presentation, modelContext = []) => ({ output, presentation, modelContext }),
    computeDiffs: (target, before, after) => [{ path: target, oldText: before, newText: after }],
    resolveLanguage: () => '',
    createLines: (content, firstLine) => content.split('\n').map((text, index) => ({ number: firstLine + index, text })),
  })

  try {
    const readResult = await tools.execute('read', { path: 'sample.txt', offset: 2, limit: 1 }, null)
    assert.equal(readResult.output, 'second\n\n[显示第 2-2 行，共 4 行。请使用 offset=3 继续读取。]')
    await tools.execute('edit', {
      path: 'sample.txt',
      edits: [
        { oldText: 'first', newText: 'one' },
        { oldText: 'third', newText: 'three' },
      ],
    }, null)
    assert.equal(await fs.readFile(filePath, 'utf8'), '\uFEFFone\r\nsecond\r\nthree\r\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('edit 拒绝非唯一匹配且不改写原文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-edit-unique-'))
  const filePath = path.join(root, 'sample.txt')
  await fs.writeFile(filePath, 'same\nsame\n', 'utf8')
  const tools = createFileTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    getAttachmentStore: () => null,
    createPresentedResult: (output, presentation) => ({ output, presentation }),
    computeDiffs: () => [],
    resolveLanguage: () => '',
    createLines: () => [],
  })

  try {
    await assert.rejects(
      tools.execute('edit', { path: 'sample.txt', edits: [{ oldText: 'same', newText: 'next' }] }, null),
      /找到 2 处相同文本|确保 oldText 唯一/,
    )
    assert.equal(await fs.readFile(filePath, 'utf8'), 'same\nsame\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('edit 按 Pi 规则容忍行尾空格、Unicode 引号和单对象参数', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-edit-fuzzy-'))
  const filePath = path.join(root, 'sample.txt')
  await fs.writeFile(filePath, 'const value = “old”   \nconst keep = true\n', 'utf8')
  const tools = createFileTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    getAttachmentStore: () => null,
    createPresentedResult: (output, presentation) => ({ output, presentation }),
    computeDiffs: () => [],
    resolveLanguage: () => '',
    createLines: () => [],
  })

  try {
    const result = await tools.execute('edit', {
      path: 'sample.txt',
      edits: { oldText: 'const value = "old"', newText: 'const value = "new"' },
    }, null)
    assert.match(result.output, /已完成 1 处文本替换/)
    assert.equal(await fs.readFile(filePath, 'utf8'), 'const value = "new"\nconst keep = true\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('edit 在智能引号文本重复时拒绝模糊替换', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-edit-duplicate-unicode-'))
  const filePath = path.join(root, 'sample.txt')
  await fs.writeFile(filePath, 'const value = “old”\nconst copy = “old”\n', 'utf8')
  const tools = createFileTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    getAttachmentStore: () => null,
    createPresentedResult: (output, presentation) => ({ output, presentation }),
    computeDiffs: () => [],
    resolveLanguage: () => '',
    createLines: () => [],
  })

  try {
    await assert.rejects(
      tools.execute('edit', {
        path: 'sample.txt',
        edits: [{ oldText: '“old”', newText: '“new”' }],
      }, null),
      /找到 2 处相同文本/,
    )
    assert.equal(await fs.readFile(filePath, 'utf8'), 'const value = “old”\nconst copy = “old”\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('edit 兼容 JSON 字符串 edits 和顶层 oldText/newText 参数', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-edit-arguments-'))
  const filePath = path.join(root, 'sample.txt')
  await fs.writeFile(filePath, 'before\n', 'utf8')
  const tools = createFileTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    getAttachmentStore: () => null,
    createPresentedResult: (output, presentation) => ({ output, presentation }),
    computeDiffs: () => [],
    resolveLanguage: () => '',
    createLines: () => [],
  })

  try {
    await tools.execute('edit', {
      path: 'sample.txt',
      edits: JSON.stringify([{ oldText: 'before', newText: 'after' }]),
    }, null)
    await tools.execute('edit', {
      path: 'sample.txt',
      oldText: 'after',
      newText: 'done',
    }, null)
    assert.equal(await fs.readFile(filePath, 'utf8'), 'done\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('edit 的零匹配错误会要求重新读取文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-edit-missing-'))
  const filePath = path.join(root, 'sample.txt')
  await fs.writeFile(filePath, 'actual\n', 'utf8')
  const tools = createFileTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    getAttachmentStore: () => null,
    createPresentedResult: (output, presentation) => ({ output, presentation }),
    computeDiffs: () => [],
    resolveLanguage: () => '',
    createLines: () => [],
  })

  try {
    await assert.rejects(
      tools.execute('edit', { path: 'sample.txt', edits: [{ oldText: 'stale', newText: 'next' }] }, null),
      /请重新读取文件后重试/,
    )
    assert.equal(await fs.readFile(filePath, 'utf8'), 'actual\n')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('edit 按文件中首次出现的换行格式恢复混合换行正文', () => {
  assert.equal(detectLineEnding('first\nsecond\r\n'), '\n')
  assert.equal(detectLineEnding('first\r\nsecond\n'), '\r\n')
})

test('ls 返回排序后的单层目录并标识子目录', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-ls-'))
  await fs.mkdir(path.join(root, 'Folder'))
  await fs.writeFile(path.join(root, 'alpha.txt'), 'a')
  const tools = createSearchTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    processManager: createProcessManager({ outputRoot: path.join(root, 'output') }),
    getEnvironment: () => process.env,
  })

  try {
    const result = await tools.execute('ls', { path: '.' }, null, {})
    assert.deepEqual(result.entries, ['alpha.txt', 'Folder/'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('子进程管理器节流发布过程输出并能取消整个调用', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-process-manager-'))
  const manager = createProcessManager({ outputRoot: root, updateIntervalMs: 20 })
  const updates = []

  try {
    const completed = await manager.run(process.execPath, ['-e', "process.stdout.write('first'); setTimeout(() => process.stdout.write(' second'), 80)"], {
      callId: 'stream-test',
      cwd: root,
      onUpdate: (update) => updates.push(update),
      timeoutMs: 2000,
    })
    assert.equal(completed.code, 0)
    assert.equal(completed.output, 'first second')
    assert.ok(updates.some((update) => String(update.output).includes('first')))

    const running = manager.run(process.execPath, ['-e', 'setInterval(() => process.stdout.write("tick\\n"), 20)'], {
      callId: 'cancel-test',
      cwd: root,
      timeoutMs: 5000,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(manager.cancel('cancel-test'), true)
    await assert.rejects(running, /已取消/)
    assert.equal(manager.activeCount(), 0)
  } finally {
    manager.cancelAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('子进程管理器在 UTF-8 字符跨输出分片时保留完整字符', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-process-manager-utf8-'))
  const manager = createProcessManager({ outputRoot: root })

  try {
    const result = await manager.run(process.execPath, ['-e', "process.stdout.write(Buffer.from([0xe6])); setTimeout(() => process.stdout.write(Buffer.from([0xb5, 0x8b])), 50)"], {
      callId: 'utf8-split-test',
      cwd: root,
      timeoutMs: 2000,
    })
    assert.equal(result.stdout, '测')
    assert.equal(result.output, '测')
    assert.equal(result.output.includes('�'), false)
  } finally {
    manager.cancelAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Windows Shell 环境合并 Path/PATH 且不会留下重复键', () => {
  const environment = normalizePathEnvironment({
    Path: 'C:\\Windows\\System32',
    PATH: 'C:\\Tools',
    TEMP: 'fixture',
  }, 'win32')

  assert.equal(environment.Path, 'C:\\Windows\\System32;C:\\Tools')
  assert.equal(Object.keys(environment).filter((key) => key.toLowerCase() === 'path').length, 1)
  assert.equal(environment.PATH, undefined)
})

test('Windows Shell 优先使用存在的系统或显式 PowerShell 路径', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-shell-command-'))
  const pwshPath = path.join(root, 'pwsh.exe')
  await fs.writeFile(pwshPath, '')

  try {
    assert.equal(resolveShellCommand({ ZVC_PWSH_PATH: pwshPath }, 'win32'), pwshPath)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Shell 执行参数只在 Windows 注入 UTF-8 PowerShell 初始化', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-shell-invocation-'))
  const pwshPath = path.join(root, 'pwsh.exe')
  await fs.writeFile(pwshPath, '')

  try {
    const windows = createShellInvocation('Write-Output 中文', { ZVC_PWSH_PATH: pwshPath }, 'win32')
    assert.equal(windows.command, pwshPath)
    assert.deepEqual(windows.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
    assert.match(windows.args[3], /^\$OutputEncoding = /)
    assert.match(windows.args[3], /Write-Output 中文$/)

    const mac = createShellInvocation('printf 中文', { SHELL: '/bin/zsh' }, 'darwin')
    assert.deepEqual(mac, { command: '/bin/bash', args: ['-lc', 'printf 中文'] })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('模型侧 Shell 工具名只允许匹配当前宿主平台的方言', () => {
  assert.equal(resolveRuntimeToolName('bash', 'darwin'), 'bash')
  assert.equal(resolveRuntimeToolName('bash', 'linux'), 'bash')
  assert.equal(resolveRuntimeToolName('powershell', 'win32'), 'bash')
  assert.equal(resolveRuntimeToolName('read', 'win32'), 'read')
  assert.throws(() => resolveRuntimeToolName('powershell', 'darwin'), /只在 Windows 中可用/)
  assert.throws(() => resolveRuntimeToolName('bash', 'win32'), /请使用 powershell 工具/)
})

test('搜索工具清单固定版本与校验和并拒绝路径穿越压缩包', () => {
  assert.equal(TOOL_MANIFEST.rg.version, '14.1.1')
  assert.equal(TOOL_MANIFEST.fd.version, '10.2.0')
  assert.match(TOOL_MANIFEST.rg.assets['darwin-arm64'][1], /^[a-f0-9]{64}$/)
  assert.throws(() => validateArchiveEntries(['safe/rg', '../outside']), /不安全路径/)
})

test('文件服务元数据必须与客户端固定文件名和 SHA-256 一致', async () => {
  const content = Buffer.from('managed-search-binary')
  const sha256 = createHash('sha256').update(content).digest('hex')
  const server = http.createServer((request, response) => {
    const base = `http://127.0.0.1:${server.address().port}`
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      fileName: 'tool.tar.gz',
      fileSize: content.length,
      sha256,
      downloadUrl: `${base}/api/files/1/download`,
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    const metadata = await resolveManagedAsset(base, 'tool.tar.gz', sha256)
    assert.equal(metadata.fileSize, content.length)
    assert.equal(metadata.sha256, sha256)
    await assert.rejects(
      resolveManagedAsset(base, 'tool.tar.gz', '0'.repeat(64)),
      /SHA-256 与客户端清单不一致/,
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('带失效临时令牌下载遇到 401 时匿名重试并校验完整内容', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-managed-download-'))
  const destination = path.join(root, 'asset.part')
  const content = Buffer.from('anonymous-download-fallback')
  let authenticatedRequests = 0
  let anonymousRequests = 0
  const server = http.createServer((request, response) => {
    if (request.headers.authorization) {
      authenticatedRequests += 1
      response.statusCode = 401
      response.end('expired')
      return
    }
    anonymousRequests += 1
    response.setHeader('content-length', String(content.length))
    response.end(content)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const downloadUrl = `http://127.0.0.1:${server.address().port}/download`

  try {
    const result = await downloadAsset(downloadUrl, destination, () => {}, undefined, {
      token: 'expired-token',
      retryAnonymous: true,
      expectedBytes: content.length,
    })
    assert.equal(authenticatedRequests, 1)
    assert.equal(anonymousRequests, 1)
    assert.equal(result.sha256, createHash('sha256').update(content).digest('hex'))
    assert.deepEqual(await fs.readFile(destination), content)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('grep 和 find 在非 Git 工作区中仍启用 ignore 规则', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zvc-search-ignore-'))
  const binaryRoot = path.join(root, 'bin')
  const platformKey = resolvePlatformKey()
  const calls = []
  for (const toolName of ['rg', 'fd']) {
    const binaryName = `${TOOL_MANIFEST[toolName].binary}${process.platform === 'win32' ? '.exe' : ''}`
    const binaryPath = path.join(binaryRoot, platformKey, `${toolName}-${TOOL_MANIFEST[toolName].version}`, binaryName)
    await fs.mkdir(path.dirname(binaryPath), { recursive: true })
    await fs.writeFile(binaryPath, '')
  }
  const tools = createSearchTools({
    resolvePath: (_workspace, input) => path.resolve(root, String(input)),
    processManager: {
      run: async (command, args) => {
        calls.push({ command, args })
        return path.basename(command).startsWith('rg')
          ? { code: 0, stdout: '', stderr: '' }
          : { code: 0, stdout: '', stderr: '' }
      },
    },
    getEnvironment: () => process.env,
    toolRoot: binaryRoot,
  })

  try {
    await tools.execute('grep', { pattern: 'needle', path: '.' }, null, {})
    await tools.execute('find', { pattern: '*.txt', path: '.' }, null, {})
    assert.equal(calls.length, 2)
    assert.ok(calls.every((call) => call.args.includes('--no-require-git')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
