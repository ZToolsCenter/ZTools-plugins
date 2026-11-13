import { expect, test, _electron as electron } from '@playwright/test'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePluginRoot = path.join(projectRoot, 'src-ztools')
const settingsUrlFragment = 'internal-plugins/setting/index.html'

/**
 * 读取由当前运行中 ZTools 进程注入的宿主可执行文件路径。
 * @returns {Promise<string>} ZTools 可执行文件绝对路径。
 * @throws 宿主路径缺失、不是绝对路径或不可执行时抛出。
 */
async function resolveZToolsExecutable() {
  const executablePath = String(process.env.ZTOOLS_E2E_EXECUTABLE_PATH || '').trim()
  if (!executablePath) throw new Error('当前 ZTools 进程未提供宿主路径，请从 ZVC 中运行测试')
  if (!path.isAbsolute(executablePath)) throw new Error('ZTOOLS_E2E_EXECUTABLE_PATH 必须是绝对路径')
  try {
    await fs.access(executablePath, fsConstants.X_OK)
    return executablePath
  } catch {
    throw new Error(`当前 ZTools 宿主不存在或不可执行：${executablePath}`)
  }
}

/**
 * 在设置插件的 WebContentsView 中执行受控脚本。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} source 要执行的页面脚本。
 * @returns {Promise<unknown>} 页面脚本执行结果。
 * @throws 未找到设置页时抛出错误。
 */
async function executeInSettings(electronApp, source) {
  return electronApp.evaluate(async ({ webContents }, script) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes('internal-plugins/setting/index.html'))
    if (!contents) throw new Error('未找到设置插件 WebContentsView')
    return contents.executeJavaScript(script)
  }, source)
}

/**
 * 读取设置插件正文，供 Playwright 轮询加载状态。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @returns {Promise<string>} 设置页正文；尚未完成加载时为空字符串。
 */
async function readSettingsText(electronApp) {
  return electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().includes('internal-plugins/setting/index.html'))
    if (!contents || contents.isLoading()) return ''
    return contents.executeJavaScript('document.body?.innerText || ""')
  })
}

/**
 * 读取插件页面状态并统计截图中的非背景像素。
 * @param {import('@playwright/test').ElectronApplication} electronApp 隔离的 Electron 应用。
 * @param {string} expectedUrl 插件生产页面 URL。
 * @returns {Promise<{ready: boolean, text: string, png: string, width: number, height: number, nonBackgroundPixels: number}>} 页面状态和截图。
 * @throws 插件页面脚本或截图失败时抛出错误。
 */
async function inspectPluginView(electronApp, expectedUrl) {
  return electronApp.evaluate(async ({ webContents }, targetUrl) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === targetUrl)
    if (!contents || contents.isLoading()) {
      return { ready: false, text: '', png: '', width: 0, height: 0, nonBackgroundPixels: 0 }
    }

    const text = await contents.executeJavaScript('document.body?.innerText || ""')
    const image = await contents.capturePage()
    const bitmap = image.toBitmap()
    let nonBackgroundPixels = 0
    // 防止 DOM 已加载但 Electron 合成层仍为空白。
    for (let index = 0; index < bitmap.length; index += 4) {
      const blue = bitmap[index]
      const green = bitmap[index + 1]
      const red = bitmap[index + 2]
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (spread > 8 || (red + green + blue) / 3 < 220) nonBackgroundPixels += 1
    }

    return {
      ready: true,
      text,
      png: image.toPNG().toString('base64'),
      width: image.getSize().width,
      height: image.getSize().height,
      nonBackgroundPixels,
    }
  }, expectedUrl)
}

async function executeInPlugin(electronApp, url, source) {
  return electronApp.evaluate(async ({ webContents }, { url, source }) => {
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)
    if (!contents) throw new Error('找不到影视搜索页面')
    return contents.executeJavaScript(source, true)
  }, { url, source })
}

async function installFixture(pluginRoot) {
  const [clip, ts] = await Promise.all(['sample.mp4', 'sample.ts'].map(name =>
    fs.readFile(path.join(projectRoot, 'tests/fixtures', name))))
  const server = createServer((req, res) => {
    if (req.url === '/missing.m3u8' || req.url === '/sample.m3u8') {
      const segment = req.url === '/missing.m3u8' ? 'missing.ts' : 'sample.ts'
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*' })
        .end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${segment}\n#EXT-X-ENDLIST\n`)
      return
    }
    if (req.url === '/sample.ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Access-Control-Allow-Origin': '*' }).end(ts)
      return
    }
    if (req.url === '/missing.ts') {
      res.writeHead(302, { Location: '/not-found', 'Access-Control-Allow-Origin': '*' }).end()
      return
    }
    if (req.url === '/not-found') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
        .end('<!DOCTYPE html><html><head><title>页面不存在</title></head></html>')
      return
    }
    if (req.url === '/cover.png') {
      // 1×1 的 PNG，用来验证播放记录里的封面能被保存和显示。
      res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' })
        .end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
      return
    }
    if (req.url !== '/sample.mp4') { res.writeHead(404).end(); return }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${clip.length}` }).end(); return }
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*', ...(range && { 'Content-Range': `bytes ${start}-${end}/${clip.length}` }),
    }).end(clip.subarray(start, end + 1))
  })
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  try {
    await fs.writeFile(path.join(pluginRoot, 'preload/provider.js'), `
      // 剧集标识刻意与单集标识不同，避免续播测试被“剧 id 恰好等于第一集 id”掩盖。
      const series = 'chseries001';
      const episodes = [{v:'chdemo001',line:1,number:1},{v:'chdemo002',line:1,number:2}];
      const broken = {v:'chmissing01',line:1,number:1};
      const hls = {v:'chdemo003',line:1,number:1};
      const base = ${JSON.stringify(`http://127.0.0.1:${server.address().port}`)};
      exports.provider = {
        async channel(key) {
          const title = {movie:'最新上架',tv:'最近更新',anime:'正在连载'}[key];
          return [{title,items:[{v:series,title:'测试影片',cover:base+'/cover.png',year:'2026',rating:'8.5'}]}];
        },
        async search(query) { return query === '测试影片' ? [{v:series,title:'测试影片',cover:base+'/cover.png',year:'2026'}] : []; },
        async catalog(v) {
          if (v === broken.v) return {title:'失效线路',episodes:[broken],selected:broken};
          if (v === hls.v) return {title:'HLS 样片',episodes:[hls],selected:hls};
          return {title:'测试影片',episodes,selected:episodes.find(e=>e.v===v) ?? episodes[0]};
        },
        async resolve(v) {
          if (v === broken.v) return [{url:base+'/missing.m3u8',format:'hls',quality:'测试失效线路'}];
          if (v === hls.v) return [{url:base+'/sample.m3u8',format:'hls',quality:'测试片段'}];
          return [{url:base+'/sample.mp4',format:'mp4',quality:'测试片段'}];
        },
      };
    `)
  } catch (error) {
    server.close()
    throw error
  }
  return server
}

async function withPlugin(testInfo, { fixture = false, dismissDisclaimer = true, check } = {}) {
  const executablePath = await resolveZToolsExecutable()
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-plugin-e2e-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const pluginRoot = path.join(dataRoot, 'plugin')
  const pluginConfigPath = path.join(pluginRoot, 'plugin.json')
  await fs.cp(sourcePluginRoot, pluginRoot, { recursive: true })
  const manifest = JSON.parse(await fs.readFile(pluginConfigPath, 'utf8'))
  // 隔离副本禁用开发入口，确保本用例验证构建后的本地页面。
  delete manifest.development
  await fs.writeFile(pluginConfigPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const featureCode = manifest.features?.[0]?.code || 'open'
  const expectedUrl = pathToFileURL(path.resolve(pluginRoot, manifest.main)).href
  const playerUrl = pathToFileURL(path.join(pluginRoot, 'dist/player.html')).href
  const screenshotPath = testInfo.outputPath('plugin-view.png')
  let electronApp = null
  let fixtureServer = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    if (fixture) fixtureServer = await installFixture(pluginRoot)
    // 使用当前 ZTools 进程对应的宿主和隔离目录，避免读取或污染用户的真实数据。
    const developmentAppRoot = String(process.env.ZTOOLS_E2E_APP_ROOT || '').trim()
    electronApp = await electron.launch({
      executablePath,
      args: developmentAppRoot ? [developmentAppRoot] : [],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value)),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_E2E: '1',
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      },
    })

    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => readSettingsText(electronApp), { timeout: 15_000 }).not.toBe('')

    // 通过设置插件的内部 API 导入、安装并启动当前构建产物。
    const imported = await executeInSettings(
      electronApp,
      `window.ztools.internal.importDevPlugin(${JSON.stringify(pluginConfigPath)})`,
    )
    expect(imported, JSON.stringify(imported)).toMatchObject({ success: true })
    const installed = await executeInSettings(
      electronApp,
      `window.ztools.internal.installDevPlugin(${JSON.stringify(manifest.name)})`,
    )
    expect(installed, JSON.stringify(installed)).toMatchObject({ success: true })
    const launchResult = await executeInSettings(
      electronApp,
      `window.ztools.internal.launch({path: ${JSON.stringify(pluginRoot)}, type: 'plugin', name: ${JSON.stringify(manifest.title)}, param: {payload: '', type: 'text', code: ${JSON.stringify(featureCode)}}})`,
    )
    expect(launchResult, JSON.stringify(launchResult)).toMatchObject({ success: true })

    await expect.poll(
      async () => (await inspectPluginView(electronApp, expectedUrl)).ready,
      { timeout: 20_000 },
    ).toBe(true)
    const inspection = await inspectPluginView(electronApp, expectedUrl)
    expect(inspection.width).toBeGreaterThan(0)
    expect(inspection.height).toBeGreaterThan(0)
    expect(inspection.nonBackgroundPixels).toBeGreaterThan(50)
    // 打开插件直接进入电影频道，不再有首页。
    expect(inspection.text).toContain('电影')
    if (process.env.ZTOOLS_E2E_EXPECTED_TEXT) {
      expect(inspection.text).toContain(process.env.ZTOOLS_E2E_EXPECTED_TEXT)
    }

    await fs.writeFile(screenshotPath, Buffer.from(inspection.png, 'base64'))
    await testInfo.attach('plugin-view', {
      path: screenshotPath,
      contentType: 'image/png',
    })
    const run = source => executeInPlugin(electronApp, expectedUrl, source)
    const capture = async (name, url = expectedUrl) => {
      const view = await inspectPluginView(electronApp, url)
      const imagePath = testInfo.outputPath(`${name}.png`)
      await fs.writeFile(imagePath, Buffer.from(view.png, 'base64'))
      await testInfo.attach(name, { path: imagePath, contentType: 'image/png' })
    }
    expect(await run(`['channel', 'search', 'catalog', 'resolve', 'cancel'].every(key => typeof window.videoService?.[key] === 'function')`)).toBe(true)
    // 首次打开会展示免责声明，这里按真实操作点掉，避免遮罩挡住后续交互。
    // 需要验证声明本身的用例通过 dismiss: false 自行处理。
    if (dismissDisclaimer) {
      await expect.poll(() => run(`Boolean(document.querySelector('.disclaimer-accept'))`)).toBe(true)
      await run(`document.querySelector('.disclaimer-accept').click()`)
      await expect.poll(() => run(`Boolean(document.querySelector('.disclaimer'))`)).toBe(false)
    }
    const setZoom = factor => electronApp.evaluate(({ webContents }, { url, factor }) => {
      webContents.getAllWebContents().find(item => item.getURL() === url).setZoomFactor(factor)
    }, { url: expectedUrl, factor })
    const player = {
      run: source => executeInPlugin(electronApp, playerUrl, source),
      capture: name => capture(name, playerUrl),
      windows: () => electronApp.windows().filter(window => window.url() === playerUrl),
      async window() {
        await expect.poll(() => this.windows().length).toBe(1)
        return this.windows()[0]
      },
    }
    // 截图用例需要直接拿到两个页面的地址与宿主实例。
    await check?.(run, capture, setZoom, player, { electronApp, mainUrl: expectedUrl, playerUrl })
  } finally {
    // 无论断言是否成功，都释放测试实例并删除本次创建的数据目录。
    await electronApp?.close()
    if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve))
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
}

function submit(run, value) {
  return run(`(() => {
    const input = document.querySelector('input[type="search"]');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.form.requestSubmit();
  })()`)
}

function clickChannel(run, label) {
  return run(`[...document.querySelectorAll('.channel-nav button')].find(node => node.textContent.trim() === ${JSON.stringify(label)}).click()`)
}

const videoReady = `(() => { const video = document.querySelector('video'); return video?.readyState >= 2 && video.videoWidth > 0; })()`

async function verifyPlaybackProgress(run) {
  const initial = await run(`(() => {
    const video = document.querySelector('video');
    if (video.paused) void video.play().catch(() => {});
    return video.currentTime;
  })()`)
  await expect.poll(() => run(`document.querySelector('video').currentTime`), { timeout: 15_000 })
    .toBeGreaterThan(initial + 0.2)
}

// 每个用例都启动一次完整的 ZTools 实例，启动成本远高于断言本身。
// 所以按「能否共用一个实例」分组，一个实例内顺序跑完多个场景。

test('首屏与检索：安装、免责声明、搜索、选集、频道、窄窗口', async ({}, testInfo) => {
  await withPlugin(testInfo, { fixture: true, dismissDisclaimer: false, check: async (run, capture, setZoom, player) => {
    // 首次打开必须弹出免责声明，确认后写入标记并关闭。
    await expect.poll(() => run(`Boolean(document.querySelector('.disclaimer'))`)).toBe(true)
    expect(await run(`document.querySelector('.disclaimer-accept').textContent`)).toContain('我已阅读并同意')
    await run(`document.querySelector('.disclaimer-accept').click()`)
    await expect.poll(() => run(`Boolean(document.querySelector('.disclaimer'))`)).toBe(false)
    expect(await run(`ztools.dbStorage.getItem('disclaimer-accepted')`)).toBe(true)

    // 打开即进入电影频道，顶栏带搜索框，没有首页入口。
    expect(await run(`document.querySelector('.channel-nav [aria-current="page"]').textContent`)).toBe('电影')
    expect(await run(`document.querySelectorAll('.channel-nav button').length`)).toBe(3)
    expect(await run(`Boolean(document.querySelector('.topbar-row form[role="search"]'))`)).toBe(true)
    await expect.poll(() => run(`document.querySelector('.channel-browser h2')?.textContent`), { timeout: 30_000 }).toBe('最新上架')
    for (const [label, heading] of [['电视剧', '最近更新'], ['动漫', '正在连载']]) {
      await clickChannel(run, label)
      await expect.poll(() => run(`document.querySelector('.channel-browser h2')?.textContent`)).toBe(heading)
      expect(await run(`document.querySelector('.channel-nav [aria-current="page"]').textContent`)).toBe(label)
    }

    // 频道里点一部，播放详情在独立窗口打开，主窗口保留列表。
    await run(`document.querySelector('.channel-browser .result-card').click()`)
    const channelWindow = await player.window()
    await expect.poll(() => player.run(videoReady)).toBe(true)
    expect(await player.run('ztools.getWindowType()')).toBe('browser')
    expect(await run(`Boolean(document.querySelector('video'))`)).toBe(false)
    await channelWindow.close()
    await expect.poll(() => player.windows().length).toBe(0)
    expect(await run(`document.querySelector('.channel-browser h2').textContent`)).toBe('正在连载')
    expect(await run(`document.querySelector('.channel-browser').style.display`)).not.toBe('none')

    // 窄窗口下频道入口和海报不溢出。
    await setZoom((await run('window.innerWidth')) / 340)
    await expect.poll(() => run(`(() => {
      const lastTab = document.querySelector('.channel-nav button:last-child').getBoundingClientRect();
      const firstPoster = document.querySelector('.poster-list .result-card').getBoundingClientRect();
      return innerWidth <= 365 && lastTab.width > 0 && lastTab.right <= innerWidth && firstPoster.right <= innerWidth;
    })()`)).toBe(true)
    await capture('narrow-channel')
    await clickChannel(run, '电影')

    // 搜索、选集：结果卡片打开播放窗口，并能在窗口内切集。
    await submit(run, '测试影片')
    await expect.poll(() => run('Boolean(document.querySelector(".result-card"))')).toBe(true)
    await run('document.querySelector(".result-card").click()')
    await player.window()
    await expect.poll(() => player.run(videoReady)).toBe(true)
    await player.run(`document.querySelector(".episode-grid button[aria-label='第 2 集']").click()`)
    await expect.poll(() => player.run(`document.querySelector('.episode-grid [aria-current]')?.textContent`)).toBe('2')
    await expect.poll(() => player.run(videoReady)).toBe(true)

    // 片源分片返回网页时，播放窗口要给出明确提示而不是解码失败。
    await submit(run, 'chmissing01')
    await expect.poll(() => player.run(`document.querySelector('.player-status.failure')?.innerText`))
      .toContain('片源服务器返回了网页，没有提供视频分片')
  } })
})

test('播放器：全屏、自动连播、开关、下一集按钮、记录', async ({}, testInfo) => {
  await withPlugin(testInfo, { fixture: true, check: async (run, _capture, _setZoom, player) => {
    // 多集剧集：控制栏有下一集按钮，位于播放按钮之后、音量之前。
    await submit(run, '测试影片')
    await run('document.querySelector(".result-card").click()')
    const playbackWindow = await player.window()
    await expect.poll(() => player.run(videoReady)).toBe(true)
    expect(await player.run(`(() => {
      const next = document.querySelector('.dplayer-next-icon');
      if (!next) return false;
      return next.previousElementSibling?.classList.contains('dplayer-play-icon')
        && next.nextElementSibling?.classList.contains('dplayer-volume')
        && getComputedStyle(next).display !== 'none';
    })()`)).toBe(true)
    // 悬停不显示文字气泡，只保留无障碍标签。
    expect(await player.run(`(() => {
      const next = document.querySelector('.dplayer-next-icon');
      return { balloon: next.hasAttribute('data-balloon'), label: next.getAttribute('aria-label'), after: getComputedStyle(next, '::after').content };
    })()`)).toEqual({ balloon: false, label: '下一集', after: 'none' })
    await player.capture('next-in-controller')

    // 点下一集按钮切换到第 2 集，最后一集时按钮隐藏。
    await player.run(`document.querySelector('.dplayer-next-icon').click()`)
    await expect.poll(() => player.run(`document.querySelector('.episode-grid [aria-current]')?.textContent`)).toBe('2')
    await expect.poll(() => player.run(videoReady)).toBe(true)
    expect(await player.run(`document.querySelector('.dplayer-next-icon')?.classList.contains('is-hidden')`)).toBe(true)

    // 双击画面进入和退出全屏，并且复用同一个窗口。
    await submit(run, 'chdemo003')
    await expect.poll(() => player.run(`document.querySelector('.play-title h2')?.textContent`)).toBe('HLS 样片')
    await expect.poll(() => player.run(videoReady)).toBe(true)
    // 单集影片不显示下一集按钮。
    expect(await player.run(`document.querySelectorAll('.episode-grid button').length`)).toBe(0)
    expect(await player.run(`document.querySelector('.dplayer-next-icon')?.classList.contains('is-hidden')`)).toBe(true)
    const doubleClickCenter = async () => {
      // 全屏时面板的布局高度会塌成 0，用视口中心才能稳定落在画面上。
      const [x, y] = await playbackWindow.evaluate(() => [innerWidth / 2, innerHeight / 2])
      await playbackWindow.mouse.dblclick(Math.round(x), Math.round(y))
    }
    await verifyPlaybackProgress(player.run)
    await doubleClickCenter()
    await expect.poll(() => player.run(`document.fullscreenElement?.tagName`)).toBe('VIDEO')
    expect(await run('Boolean(document.fullscreenElement)')).toBe(false)
    // 两次双击间隔要超过系统的双击判定时间，否则第二组会被算成三连击。
    await playbackWindow.waitForTimeout(700)
    await doubleClickCenter()
    await expect.poll(() => player.run('Boolean(document.fullscreenElement)')).toBe(false)
    await expect.poll(() => player.run('document.querySelector("video").paused')).toBe(false)
    await submit(run, 'chdemo001')
    await expect.poll(() => player.run(`document.querySelector('.play-title h2')?.textContent`)).toBe('测试影片')
    expect(await player.window()).toBe(playbackWindow)

    // 全屏下播完自动连播，换集过程中不退出全屏。
    await expect.poll(() => player.run(`document.querySelector('.episode-grid [aria-current]')?.textContent`)).toBe('1')
    // DPlayer 的控制栏在鼠标停留时不会隐藏，落在栏上的双击会被它吃掉，
    // 先把鼠标移开画面并等控制栏收起，再双击进全屏。
    await playbackWindow.mouse.move(1, 1)
    await playbackWindow.waitForTimeout(900)
    await doubleClickCenter()
    await expect.poll(() => player.run(`document.fullscreenElement?.tagName`)).toBe('VIDEO')
    await player.run(`(() => {
      const video = document.querySelector('video');
      video.currentTime = Math.max(0, video.duration - 0.4);
      void video.play().catch(() => {});
    })()`)
    await expect.poll(() => player.run(`document.querySelector('.episode-grid [aria-current]')?.textContent`), { timeout: 20_000 })
      .toBe('2')
    expect(await player.run(`document.fullscreenElement?.tagName`)).toBe('VIDEO')
    await expect.poll(() => player.run(videoReady), { timeout: 20_000 }).toBe(true)
    await expect.poll(() => player.run(`(() => { const video = document.querySelector('video'); return video.currentTime > 0.2 && !video.paused })()`), { timeout: 15_000 })
      .toBe(true)
    expect(await run(`ztools.dbStorage.getItem('playback-history')[0].episodeNumber`)).toBe(2)
    // 退出全屏，方便后续检查。
    await playbackWindow.waitForTimeout(700)
    await doubleClickCenter()
    await expect.poll(() => player.run('Boolean(document.fullscreenElement)')).toBe(false)

    // 关闭自动连播后播完停在本集。
    expect(await player.run(`document.querySelector('.auto-next input')?.checked`)).toBe(true)
    await player.run(`(() => { const box = document.querySelector('.auto-next input'); box.click(); return box.checked })()`)
    expect(await player.run(`document.querySelector('.auto-next input')?.checked`)).toBe(false)
    await player.run(`(() => {
      const video = document.querySelector('video');
      video.currentTime = Math.max(0, video.duration - 0.4);
      void video.play().catch(() => {});
    })()`)
    await expect.poll(() => player.run('document.querySelector("video").ended'), { timeout: 15_000 }).toBe(true)
    await player.run('new Promise(resolve => setTimeout(resolve, 1200))')
    expect(await player.run(`document.querySelector('.episode-grid [aria-current]')?.textContent`)).toBe('2')
    expect(await run(`ztools.dbStorage.getItem('auto-play-next')`)).toBe(false)
    // 打开回去，避免影响后面的记录断言。
    await player.run(`document.querySelector('.auto-next input').click()`)
  } })
})

test('播放记录：封面、进度、续播、删除', async ({}, testInfo) => {
  await withPlugin(testInfo, { fixture: true, check: async (run, _capture, _setZoom, player) => {
    await submit(run, '测试影片')
    await expect.poll(() => run('Boolean(document.querySelector(".result-card"))')).toBe(true)
    await run('document.querySelector(".result-card").click()')
    const playbackWindow = await player.window()
    await expect.poll(() => player.run(videoReady)).toBe(true)
    await player.run(`document.querySelector(".episode-grid button[aria-label='第 2 集']").click()`)
    await expect.poll(() => player.run(`document.querySelector('.episode-grid [aria-current]')?.textContent`)).toBe('2')
    await expect.poll(() => player.run(videoReady)).toBe(true)
    await player.run(`(() => {
      const video = document.querySelector('video');
      video.currentTime = 6;
      void video.play().catch(() => {});
    })()`)
    await expect.poll(() => player.run('document.querySelector("video").currentTime')).toBeGreaterThan(6.2)
    await playbackWindow.close()
    await expect.poll(() => player.windows().length).toBe(0)

    // 首页不放记录，只保留右上角入口；记录数和封面已经被记下。
    await submit(run, '')
    expect(await run(`Boolean(document.querySelector('.history-grid'))`)).toBe(false)
    expect(await run(`document.querySelector('.history-count')?.textContent`)).toBe('1')
    const saved = await run(`ztools.dbStorage.getItem('playback-history')[0]`)
    expect(saved.cover).toMatch(/\/cover\.png$/)
    expect(saved.episodeNumber).toBe(2)

    // 点右上角图标进入播放记录页。
    await run(`document.querySelector('.history-toggle').click()`)
    await expect.poll(() => run(`document.querySelector('.history-card .history-title')?.textContent`)).toBe('测试影片')
    expect(await run(`document.querySelector('.history-card img')?.getAttribute('src')`)).toMatch(/\/cover\.png$/)
    expect(await run(`document.querySelector('.history-detail').textContent`)).toContain('第 2 集')
    expect(await run(`document.querySelector('.history-detail').textContent`)).toContain('已看 00:0')
    // 第三行显示剩余时长，可据此判断能续播。
    expect(await run(`document.querySelector('.history-action').textContent`)).toContain('还剩')
    expect(await run(`document.querySelector('.history-bar span')?.style.width`)).not.toBe('')
    expect(await run(`document.querySelector('.history-toggle').getAttribute('aria-pressed')`)).toBe('true')

    // 再点这条记录，回到第 2 集，并落在上次的位置。
    await run(`document.querySelector('.history-card').click()`)
    const resumedWindow = await player.window()
    await expect.poll(() => player.run(videoReady)).toBe(true)
    await expect.poll(() => player.run(`document.querySelector('.episode-grid [aria-current]')?.textContent`)).toBe('2')
    await expect.poll(() => player.run('document.querySelector("video").currentTime'), { timeout: 15_000 })
      .toBeGreaterThan(5.5)
    await resumedWindow.close()

    // 主窗口仍停在记录页。删除要先确认，取消则记录保留。
    await expect.poll(() => run(`Boolean(document.querySelector('.history-remove'))`)).toBe(true)
    await run(`document.querySelector('.history-remove').click()`)
    await expect.poll(() => run(`document.querySelector('.dialog')?.innerText || ''`)).toContain('删除播放记录')
    expect(await run(`document.querySelector('.dialog p').textContent`)).toContain('测试影片')
    await run(`document.querySelector('.dialog .secondary').click()`)
    await expect.poll(() => run(`Boolean(document.querySelector('.dialog'))`)).toBe(false)
    expect(await run(`document.querySelectorAll('.history-card').length`)).toBe(1)

    // 再次删除并确认，列表清空并显示空状态。
    await run(`document.querySelector('.history-remove').click()`)
    await expect.poll(() => run(`Boolean(document.querySelector('.dialog-danger'))`)).toBe(true)
    await run(`document.querySelector('.dialog-danger').click()`)
    await expect.poll(() => run(`Boolean(document.querySelector('.history-grid'))`)).toBe(false)
    expect(await run(`document.querySelector('.empty h2').textContent`)).toBe('还没有播放记录')
    expect(await run(`Boolean(document.querySelector('.history-count'))`)).toBe(false)

    // 记录已清空，现在停在记录页；先回到浏览页再搜索。
    await run(`document.querySelector('.history-toggle').click()`)
    await expect.poll(() => run(`Boolean(document.querySelector('input[type="search"]'))`)).toBe(true)
    // 再播一部产生一条新记录，用来验证「清空」的确认流程。
    await submit(run, '测试影片')
    await expect.poll(() => run(`Boolean(document.querySelector('.result-card'))`)).toBe(true)
    await run(`document.querySelector('.result-card').click()`)
    await player.window()
    await expect.poll(() => player.run(videoReady), { timeout: 30_000 }).toBe(true)
    await player.run(`(() => { const v = document.querySelector('video'); v.currentTime = 6; void v.play().catch(() => {}) })()`)
    await expect.poll(() => player.run('document.querySelector("video").currentTime')).toBeGreaterThan(6.2)
    await player.window().then(w => w.close())
    await expect.poll(() => player.windows().length).toBe(0)
    await submit(run, '')
    await run(`document.querySelector('.history-toggle').click()`)
    await expect.poll(() => run(`document.querySelectorAll('.history-card').length`)).toBe(1)
    await run(`[...document.querySelectorAll('.link-button')].find(n => n.textContent.includes('清空')).click()`)
    await expect.poll(() => run(`document.querySelector('.dialog')?.innerText || ''`)).toContain('清空播放记录')
    expect(await run(`document.querySelector('.dialog p').textContent`)).toContain('1 条')
    // Esc 关闭，记录保留。
    await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await expect.poll(() => run(`Boolean(document.querySelector('.dialog'))`)).toBe(false)
    expect(await run(`document.querySelectorAll('.history-card').length`)).toBe(1)
    // 再确认一次，记录被清空。
    await run(`[...document.querySelectorAll('.link-button')].find(n => n.textContent.includes('清空')).click()`)
    await expect.poll(() => run(`Boolean(document.querySelector('.dialog-danger'))`)).toBe(true)
    await run(`document.querySelector('.dialog-danger').click()`)
    await expect.poll(() => run(`document.querySelectorAll('.history-card').length`)).toBe(0)
    expect(await run(`ztools.dbStorage.getItem('playback-history').length`)).toBe(0)
  } })
})

test('实际线路：MP4 与带 PNG 前缀的 HLS', async ({}, testInfo) => {
  test.skip(process.env.ZTOOLS_VIDEO_LIVE !== '1', '仅在明确要求验证实际线路时运行')
  test.setTimeout(180_000)
  await withPlugin(testInfo, { check: async (run, capture, _setZoom, player) => {
    for (const [label, heading] of [['电影', '最新上架'], ['电视剧', '最近更新'], ['动漫', '正在连载']]) {
      await clickChannel(run, label)
      await expect.poll(() => run(`document.querySelector('.channel-browser h2')?.textContent`)).toBe(heading)
      expect(await run(`document.querySelectorAll('.channel-browser .result-card').length`)).toBeGreaterThan(0)
      if (label === '电影') await capture('movie-channel')
    }
    // 搜索会覆盖当前频道，不再需要切回首页。
    // 《三国》的 CDN 在部分网络下只有 206 却读不到数据，改用响应正常的影片。
    await submit(run, '野兽之心')
    await expect.poll(() => run(`[...document.querySelectorAll('.result-card')].some(node => node.textContent.includes('野兽之心'))`), { timeout: 30_000 }).toBe(true)
    await run(`[...document.querySelectorAll('.result-card')].find(node => node.textContent.includes('野兽之心')).click()`)
    await player.window()
    await expect.poll(() => player.run(videoReady), { timeout: 35_000 }).toBe(true)
    expect(await player.run(`document.querySelector('.badge').textContent`)).toBe('MP4')
    await verifyPlaybackProgress(player.run)
    // 片头可能是黑场，等画面推进几秒再截图。
    await player.run('document.querySelector("video").currentTime = 20')
    await expect.poll(() => player.run(`document.querySelector('video').currentTime`), { timeout: 20_000 }).toBeGreaterThan(20.2)
    await player.capture('mp4-playing')
    await submit(run, 'cgzsy23h0')
    await expect.poll(() => player.run(`document.querySelector('.badge')?.textContent`), { timeout: 40_000 }).toContain('HLS')
    await expect.poll(() => player.run(videoReady), { timeout: 40_000 }).toBe(true)
    await verifyPlaybackProgress(player.run)
    await player.capture('hls-png-playing')
  } })
})

test('生成 README 截图', async ({}, testInfo) => {
  test.skip(process.env.ZTOOLS_VIDEO_SHOTS !== '1', '仅在需要刷新 README 截图时运行')
  test.setTimeout(300_000)
  const outDir = path.resolve(projectRoot, 'docs/screenshots')
  const save = async (electronApp, url, name) => {
    const png = await electronApp.evaluate(async ({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === targetUrl)
      if (!contents) throw new Error('找不到目标页面')
      const image = await contents.capturePage()
      return image.toPNG().toString('base64')
    }, url)
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(path.join(outDir, `${name}.png`), Buffer.from(png, 'base64'))
    console.log('已保存 docs/screenshots/' + name + '.png')
  }
  await withPlugin(testInfo, { check: async (run, _capture, _setZoom, player, ctx) => {
    const { electronApp, mainUrl, playerUrl } = ctx
    // 首页搜索结果
    await submit(run, '凡人修仙传')
    await expect.poll(() => run(`document.querySelectorAll('.result-card').length`), { timeout: 40_000 }).toBeGreaterThan(0)
    await save(electronApp, mainUrl, 'home')

    // 播放窗口
    await run(`document.querySelector('.result-card').click()`)
    const w = await player.window()
    await expect.poll(() => player.run(videoReady), { timeout: 60_000 }).toBe(true)
    await player.run(`(() => { const v = document.querySelector('video'); v.currentTime = 30; void v.play().catch(()=>{}) })()`)
    await w.waitForTimeout(6000)
    const box = await w.locator('.dplayer').boundingBox()
    await w.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await w.waitForTimeout(900)
    await save(electronApp, playerUrl, 'player')
    await w.close()

    // 播放记录页
    await run(`(() => {
      ztools.dbStorage.setItem('playback-history', [
        { key: 'catalog:cgzq7f3tf', kind: 'catalog', title: '凡人修仙传', v: 'cgzq7f3tf', episodeV: 'cgzq7f3tf', episodeNumber: 20, episodeLine: 1, position: 1420, duration: 2488, cover: 'https://gimg0.baidu.com/gimg/app=2001&n=0&g=0n&fmt=jpeg&src=4kvm.staticimgjs.org/uploads/2022/04/bb14k2AyChUVSJiFqd8wd2fQ4U8-250x350.jpg', updatedAt: Date.now() },
        { key: 'catalog:ch4napyc1', kind: 'catalog', title: '无间兄弟情', v: 'ch4napyc1', episodeV: 'ch4napyc1', episodeNumber: 3, episodeLine: 1, position: 900, duration: 2700, cover: 'https://gimg0.baidu.com/gimg/app=2001&n=0&g=0n&fmt=jpeg&src=4kvm.staticimgjs.org/uploads/2026/10/douban_1791269022-300x450.jpg', updatedAt: Date.now() - 60000 }
      ]);
      return true
    })()`)
    await run(`document.querySelector('.history-toggle').click()`)
    await expect.poll(() => run(`document.querySelectorAll('.history-card').length`)).toBe(2)
    // 等所有封面图片都加载完再截图，避免截到占位图标。
    await expect.poll(() => run(`(() => {
      const images = [...document.querySelectorAll('.history-card img')];
      return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0);
    })()`), { timeout: 25_000 }).toBe(true)
    await save(electronApp, mainUrl, 'history')

    // 频道页
    await run(`document.querySelector('.history-toggle').click()`)
    await clickChannel(run, '电影')
    await expect.poll(() => run(`document.querySelectorAll('.poster-list .result-card').length`), { timeout: 40_000 }).toBeGreaterThan(0)
    // 等海报图加载完，避免截到占位图标。
    await run('new Promise(resolve => setTimeout(resolve, 3000))')
    await save(electronApp, mainUrl, 'channels')
  } })
})
