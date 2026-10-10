// preload.js 的单元测试、端口探活测试与真实 spawn 端到端测试
// 运行方式: node test/preload.test.js
// 注意: 端到端部分会真实启动 cmd 窗口（默认窗口标题 DSH_TEST_WINDOW）并在断言后关闭它
'use strict'

const assert = require('node:assert')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// 配置路径必须在 require preload 之前改掉，避免测试碰到用户目录里的真实配置
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-launcher-'))
const configPath = path.join(tmpRoot, 'config.json')
process.env.DSH_WEB_LAUNCHER_CONFIG = configPath

// 插件 preload 依赖宿主注入的 window.ztools，这里先建一个假 window
global.window = {}

const pluginDir = path.resolve(__dirname, '..')
const preload = require(path.join(pluginDir, 'preload.js'))

let passed = 0

function check(name, fn) {
  fn()
  passed += 1
  console.log('  ok - ' + name)
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

// 临时替换配置文件，结束后无论成败都还原
async function withConfig(config, fn) {
  const hadFile = fs.existsSync(configPath)
  const original = hadFile ? fs.readFileSync(configPath, 'utf8') : ''
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    return await fn()
  } finally {
    if (hadFile) {
      fs.writeFileSync(configPath, original, 'utf8')
    } else {
      fs.rmSync(configPath, { force: true })
    }
  }
}

// 外层 cmd 会先创建空的重定向文件，必须等到内层写完内容再断言
function readFileWhenFilled(target, timeoutMs) {
  return new Promise(function (resolve) {
    const deadline = Date.now() + timeoutMs
    const tick = function () {
      let content = ''
      try {
        content = fs.readFileSync(target, 'utf8').trim()
      } catch (error) {
        content = ''
      }
      if (content !== '') {
        resolve(content)
        return
      }
      if (Date.now() > deadline) {
        resolve('')
        return
      }
      setTimeout(tick, 100)
    }
    tick()
  })
}

// Windows Terminal 托管的控制台窗口不属于 cmd 进程，tasklist / taskkill 的 WINDOWTITLE
// 过滤器都看不到它，而且无匹配时退出码仍是 0。因此窗口存在性用 EnumWindows 探测，
// 进程存活用命令行匹配。
function listVisibleWindowTitles(match) {
  const result = spawnSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(__dirname, 'window-title.ps1'),
    '-Match',
    match
  ], { encoding: 'utf8' })
  return String(result.stdout || '').split(/\r?\n/).map(function (line) {
    return line.trim()
  }).filter(Boolean)
}

function findProcessIdsByCommandLine(marker) {
  const script = "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -like '*" +
    marker + "*' } | ForEach-Object { $_.ProcessId }"
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  return String(result.stdout || '').split(/\r?\n/).map(function (line) {
    return Number(line.trim())
  }).filter(function (pid) {
    return Number.isInteger(pid) && pid > 0
  })
}

function killPids(pids) {
  pids.forEach(function (pid) {
    spawnSync('taskkill', ['/F', '/PID', String(pid)], { encoding: 'utf8' })
  })
}

function enter(featureCode, action) {
  return global.window.exports[featureCode].args.enter(action)
}

async function main() {
  console.log('1) window.exports 契约：三条指令各自注册为无界面模式')
  check('dsh / dsh update / dsh config 都注册且 mode 为 none', function () {
    assert.strictEqual(preload.FEATURE_WEB, 'dsh-web')
    assert.strictEqual(preload.FEATURE_UPDATE, 'dsh-update')
    assert.strictEqual(preload.FEATURE_CONFIG, 'dsh-config')
    const codes = [preload.FEATURE_WEB, preload.FEATURE_UPDATE, preload.FEATURE_CONFIG]
    assert.deepStrictEqual(Object.keys(global.window.exports).sort(), codes.slice().sort())
    codes.forEach(function (code) {
      const feature = global.window.exports[code]
      assert.strictEqual(feature.mode, 'none', code + ' 应为无界面模式')
      assert.strictEqual(typeof feature.args.enter, 'function', code + ' 应提供 enter')
    })
  })

  console.log('2) 目录参数解析')
  check('无参数时为空', function () {
    assert.strictEqual(preload.parseDirArgument('dsh'), '')
    assert.strictEqual(preload.parseDirArgument('dsh '), '')
    assert.strictEqual(preload.parseDirArgument('dsh update'), '')
    assert.strictEqual(preload.parseDirArgument('dsh config'), '')
    assert.strictEqual(preload.parseDirArgument(undefined), '')
  })
  check('dsh <目录> 取出目录', function () {
    assert.strictEqual(preload.parseDirArgument('dsh D:\\CODE'), 'D:\\CODE')
    assert.strictEqual(preload.parseDirArgument('dsh web D:\\CODE'), 'D:\\CODE')
  })
  check('带引号的路径去掉引号', function () {
    assert.strictEqual(preload.parseDirArgument('dsh "D:\\my code"'), 'D:\\my code')
  })

  console.log('3) 目录优先级')
  check('搜索框参数优先', function () {
    const result = preload.resolveCwd('dsh ' + tmpRoot, { defaultCwd: os.homedir() })
    assert.strictEqual(result.cwd, tmpRoot)
    assert.strictEqual(result.source, 'payload')
  })
  check('参数非法时退回 defaultCwd', function () {
    const result = preload.resolveCwd('dsh Z:\\definitely-missing-dir', { defaultCwd: tmpRoot })
    assert.strictEqual(result.cwd, tmpRoot)
    assert.strictEqual(result.source, 'config')
  })
  check('配置也非法时退回用户主目录', function () {
    const result = preload.resolveCwd('', { defaultCwd: 'Z:\\definitely-missing-dir' })
    assert.strictEqual(result.cwd, os.homedir())
    assert.strictEqual(result.source, 'home')
  })

  console.log('4) 命令行组装')
  check('dsh 默认是 dsh web', function () {
    assert.strictEqual(preload.buildWebCommandLine(preload.readConfig()), 'dsh web')
  })
  check('webArgs 附加到 web 之后', function () {
    assert.strictEqual(preload.buildWebCommandLine({ dshCommand: 'dsh', webArgs: ['--port', '8081'] }), 'dsh web --port 8081')
    assert.strictEqual(preload.buildWebCommandLine({ dshCommand: 'dsh', webArgs: ['--no-open'] }), 'dsh web --no-open')
  })
  check('dshCommand 支持绝对路径', function () {
    assert.strictEqual(preload.buildWebCommandLine({ dshCommand: 'D:\\tools\\dsh.cmd' }), 'D:\\tools\\dsh.cmd web')
  })
  check('dshCommand 含空格时自动加引号', function () {
    assert.strictEqual(
      preload.buildWebCommandLine({ dshCommand: 'C:\\Program Files\\nodejs\\dsh.cmd' }),
      '"C:\\Program Files\\nodejs\\dsh.cmd" web'
    )
  })
  check('dshCommand 自带引号时不重复加', function () {
    assert.strictEqual(
      preload.buildWebCommandLine({ dshCommand: '"C:\\Program Files\\nodejs\\dsh.cmd"' }),
      '"C:\\Program Files\\nodejs\\dsh.cmd" web'
    )
  })
  check('updateCommand 里用户自行加的引号原样保留', function () {
    assert.strictEqual(
      preload.buildUpdateCommandLine({ updateCommand: '"C:\\Program Files\\nodejs\\npm.cmd" install -g @deepseek-ai/dsh@latest' }),
      '"C:\\Program Files\\nodejs\\npm.cmd" install -g @deepseek-ai/dsh@latest'
    )
  })
  check('update 默认走 npm latest', function () {
    assert.strictEqual(preload.buildUpdateCommandLine(preload.readConfig()), 'npm install -g @deepseek-ai/dsh@latest')
  })
  check('update 可自定义且空值回退', function () {
    assert.strictEqual(preload.buildUpdateCommandLine({ updateCommand: 'pnpm add -g @deepseek-ai/dsh' }), 'pnpm add -g @deepseek-ai/dsh')
    assert.strictEqual(preload.buildUpdateCommandLine({ updateCommand: '   ' }), 'npm install -g @deepseek-ai/dsh@latest')
  })
  check('1.0.x 的 command 字段仍被识别', function () {
    fs.writeFileSync(configPath, JSON.stringify({ command: 'D:\\legacy\\dsh.cmd' }), 'utf8')
    try {
      assert.strictEqual(preload.readDshCommand(preload.readConfig()), 'D:\\legacy\\dsh.cmd')
    } finally {
      fs.rmSync(configPath, { force: true })
    }
  })

  console.log('5) 监听地址推导')
  check('默认回到 127.0.0.1:3080', function () {
    assert.deepStrictEqual(preload.resolveServerEndpoint({}), { host: '127.0.0.1', port: 3080, url: 'http://127.0.0.1:3080' })
  })
  check('识别 webArgs 里的 --port 与 --host', function () {
    assert.strictEqual(preload.resolveServerEndpoint({ webArgs: ['--port', '8081'] }).port, 8081)
    const withEquals = preload.resolveServerEndpoint({ webArgs: ['--port=9090', '--host=0.0.0.0'] })
    assert.strictEqual(withEquals.port, 9090)
    assert.strictEqual(withEquals.host, '127.0.0.1')
  })
  check('--port 0 表示不复用', function () {
    assert.strictEqual(preload.resolveServerEndpoint({ webArgs: ['--port', '0'] }).port, 0)
  })

  console.log('6) 端口探活')
  const probeServer = net.createServer()
  const probePort = await new Promise(function (resolve) {
    probeServer.listen(0, '127.0.0.1', function () {
      resolve(probeServer.address().port)
    })
  })
  const listening = await preload.isPortListening('127.0.0.1', probePort)
  check('监听中的端口判定为已在运行', function () {
    assert.strictEqual(listening, true)
  })
  await new Promise(function (resolve) {
    probeServer.close(resolve)
  })
  const closed = await preload.isPortListening('127.0.0.1', probePort)
  check('已关闭的端口判定为未运行', function () {
    assert.strictEqual(closed, false)
  })

  console.log('7) dsh：已在运行时直接开浏览器、不再起第二个实例')
  const opened = []
  const revealed = []
  const toasts = []
  global.window.ztools = {
    shellOpenExternal: function (url) {
      opened.push(url)
    },
    shellOpenPath: function (target) {
      opened.push('open:' + target)
    },
    shellShowItemInFolder: function (target) {
      revealed.push(target)
    },
    showToast: function (message) {
      toasts.push(message)
      return Promise.resolve({ success: true })
    },
    hideMainWindow: function () {}
  }
  const spawnResult = await withConfig({
    defaultCwd: tmpRoot,
    keepWindowOpen: false,
    reuseRunningInstance: false
  }, function () {
    return enter(preload.FEATURE_WEB, { payload: 'dsh' })
  })
  check('关闭复用配置时走启动分支', function () {
    assert.strictEqual(spawnResult.ok, true)
    assert.strictEqual(spawnResult.reused, false)
    assert.strictEqual(spawnResult.commandLine, 'dsh web')
    assert.strictEqual(spawnResult.cwd, tmpRoot)
  })

  const reuseServer = net.createServer()
  const reusePort = await new Promise(function (resolve) {
    reuseServer.listen(0, '127.0.0.1', function () {
      resolve(reuseServer.address().port)
    })
  })
  const reuseHit = await withConfig({
    defaultCwd: tmpRoot,
    webArgs: ['--port', String(reusePort)],
    reuseRunningInstance: true
  }, function () {
    return enter(preload.FEATURE_WEB, { payload: 'dsh' })
  })
  check('已有实例在运行时返回 reused 并打开浏览器', function () {
    assert.strictEqual(reuseHit.ok, true)
    assert.strictEqual(reuseHit.reused, true)
    assert.strictEqual(reuseHit.url, 'http://127.0.0.1:' + reusePort)
    assert.deepStrictEqual(opened, ['http://127.0.0.1:' + reusePort])
  })
  await new Promise(function (resolve) {
    reuseServer.close(resolve)
  })

  console.log('8) dsh update：真实 spawn 且 cwd 继承（经 start 新建控制台）')
  const markerName = 'cwd-marker.txt'
  const markerPath = path.join(tmpRoot, markerName)
  const cwdResult = await withConfig({
    defaultCwd: tmpRoot,
    updateCommand: 'cmd /c cd > ' + markerName,
    keepWindowOpen: false
  }, function () {
    return enter(preload.FEATURE_UPDATE, { payload: 'dsh update' })
  })
  const markerContent = await readFileWhenFilled(markerPath, 8000)
  check('cmd 子进程继承 cwd', function () {
    assert.strictEqual(cwdResult.ok, true)
    assert.strictEqual(cwdResult.commandLine, 'cmd /c cd > ' + markerName)
    assert.notStrictEqual(markerContent, '', '探针文件始终为空')
    assert.strictEqual(markerContent.toLowerCase(), tmpRoot.toLowerCase())
  })

  console.log('9) dsh update：/k 窗口能起来并存活')
  const windowTitle = 'DSH_TEST_WINDOW'
  // 先做一次反向校验，确保探测逻辑本身不是恒真
  const absentTitles = listVisibleWindowTitles('*DSH_TEST_WINDOW_NOT_CREATED*')
  check('窗口探测逻辑不是恒真', function () {
    assert.deepStrictEqual(absentTitles, [])
  })
  const keepResult = await withConfig({
    defaultCwd: tmpRoot,
    updateCommand: 'title ' + windowTitle,
    keepWindowOpen: true
  }, function () {
    return enter(preload.FEATURE_UPDATE, { payload: 'dsh update' })
  })
  await sleep(2000)
  const windowTitles = listVisibleWindowTitles('*' + windowTitle + '*')
  const windowPids = findProcessIdsByCommandLine(windowTitle)
  check('keepWindowOpen 时窗口可见且进程存活', function () {
    assert.strictEqual(keepResult.ok, true)
    const matched = windowTitles.some(function (title) {
      return title.indexOf(windowTitle) !== -1
    })
    assert.ok(matched, '未探测到可见窗口 ' + windowTitle + '，实际: ' + JSON.stringify(windowTitles))
    assert.ok(windowPids.length > 0, '未找到携带 ' + windowTitle + ' 的 cmd 进程')
  })
  killPids(windowPids)
  await sleep(500)
  killPids(findProcessIdsByCommandLine(windowTitle))

  console.log('10) 含空格的程序路径：命令必须真的执行')
  // 造一个带空格的目录，里面的批处理只做一件事：把窗口标题改成唯一值
  const spaceDir = path.join(tmpRoot, 'prog dir')
  fs.mkdirSync(spaceDir, { recursive: true })
  const spaceMarker = 'prog dir'
  const webTitle = 'DSH_SPACE_WEB'
  const updateTitle = 'DSH_SPACE_UPDATE'
  const spaceWebCmd = path.join(spaceDir, 'dsh-web.cmd')
  const spaceUpdateCmd = path.join(spaceDir, 'dsh-update.cmd')
  fs.writeFileSync(spaceWebCmd, '@echo off\r\ntitle ' + webTitle + '\r\n', 'utf8')
  fs.writeFileSync(spaceUpdateCmd, '@echo off\r\ntitle ' + updateTitle + '\r\n', 'utf8')

  const spaceWebResult = await withConfig({
    dshCommand: spaceWebCmd,
    defaultCwd: tmpRoot,
    keepWindowOpen: true,
    reuseRunningInstance: false
  }, function () {
    return enter(preload.FEATURE_WEB, { payload: 'dsh' })
  })
  await sleep(2500)
  const spaceWebTitles = listVisibleWindowTitles('*' + webTitle + '*')
  const spaceWebPids = findProcessIdsByCommandLine(spaceMarker)
  check('dsh 的空格路径被正确引号包裹并执行', function () {
    assert.strictEqual(spaceWebResult.ok, true)
    assert.strictEqual(spaceWebResult.commandLine.charAt(0), '"', '命令行应以引号开头: ' + spaceWebResult.commandLine)
    assert.ok(spaceWebTitles.indexOf(webTitle) !== -1, '未探测到可见窗口 ' + webTitle + '，实际: ' + JSON.stringify(spaceWebTitles))
    assert.ok(spaceWebPids.length > 0, '未找到携带 ' + spaceMarker + ' 的 cmd 进程')
  })
  killPids(spaceWebPids)
  await sleep(500)
  killPids(findProcessIdsByCommandLine(spaceMarker))

  const spaceUpdateResult = await withConfig({
    dshCommand: 'dsh',
    defaultCwd: tmpRoot,
    keepWindowOpen: true,
    updateCommand: '"' + spaceUpdateCmd + '"'
  }, function () {
    return enter(preload.FEATURE_UPDATE, { payload: 'dsh update' })
  })
  await sleep(2500)
  const spaceUpdateTitles = listVisibleWindowTitles('*' + updateTitle + '*')
  const spaceUpdatePids = findProcessIdsByCommandLine(spaceMarker)
  check('updateCommand 里用户加的引号被逐字传递并执行', function () {
    assert.strictEqual(spaceUpdateResult.ok, true)
    assert.ok(spaceUpdateTitles.indexOf(updateTitle) !== -1, '未探测到可见窗口 ' + updateTitle + '，实际: ' + JSON.stringify(spaceUpdateTitles))
    assert.ok(spaceUpdatePids.length > 0, '未找到携带 ' + spaceMarker + ' 的 cmd 进程')
  })
  killPids(spaceUpdatePids)
  await sleep(500)
  killPids(findProcessIdsByCommandLine(spaceMarker))

  console.log('11) dsh config：生成配置并同时打开文件与所在目录')
  fs.rmSync(configPath, { force: true })
  opened.length = 0
  revealed.length = 0
  toasts.length = 0
  const firstConfig = await enter(preload.FEATURE_CONFIG, { payload: 'dsh config' })
  check('配置缺失时生成并打开', function () {
    assert.strictEqual(firstConfig.ok, true)
    assert.strictEqual(firstConfig.configPath, configPath)
    assert.strictEqual(firstConfig.created, true)
    assert.strictEqual(firstConfig.opened, true)
    assert.strictEqual(firstConfig.revealed, true)
    assert.ok(fs.existsSync(configPath), '配置文件应已生成')
    const generated = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    assert.deepStrictEqual(generated, preload.FALLBACK_CONFIG)
    assert.deepStrictEqual(opened, ['open:' + configPath])
    assert.deepStrictEqual(revealed, [configPath])
    assert.strictEqual(toasts.length, 1)
    assert.ok(toasts[0].indexOf(configPath) !== -1, '提示里应包含配置路径')
  })
  opened.length = 0
  revealed.length = 0
  const secondConfig = await enter(preload.FEATURE_CONFIG, { payload: 'dsh config' })
  check('配置已存在时不重复生成', function () {
    assert.strictEqual(secondConfig.created, false)
    assert.strictEqual(secondConfig.opened, true)
    assert.strictEqual(secondConfig.revealed, true)
    assert.deepStrictEqual(opened, ['open:' + configPath])
    assert.deepStrictEqual(revealed, [configPath])
  })

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    console.log('  提示 - 临时目录稍后手动清理: ' + tmpRoot)
  }

  console.log('\n通过 ' + passed + ' 项断言')
}

main().catch(function (error) {
  console.error('测试异常终止: ' + (error && error.stack ? error.stack : error))
  process.exitCode = 1
})
