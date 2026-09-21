/**
 * ZTools 插件用 SendGB 上传执行器（纯 Node.js，无需 Python 环境）。
 *
 * 用法：
 *     node runner.js <文件1> [文件2 ...]
 *
 * stdout 输出 JSON 行：
 *     {"t":"log","m":"..."}              过程日志
 *     {"t":"progress","p":42,"m":"..."}  进度（0-100）
 *     {"t":"done","link":"https://..."}  成功
 *     {"t":"error","m":"..."}            失败
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const pw = require('playwright-core');

const SITE = 'https://www.sendgb.com/en';
const LINK_RE = /https?:\/\/(?:www\.)?sendgb\.com\/([A-Za-z0-9._~-]{5,})/g;
const NOT_LINK = /^\/(en|de|fr|it|es|nl|pl|tr|ru|pt|zh|hr|ro|download|static|cdn|assets|api|payment|blog|faq)(\/|$)/i;
const PCT_RE = /(\d{1,3})\s*%/;
const SPEED_RE = /([\d.]+)\s*(Mbps|MB\/s|kbps|KB\/s)/i;

function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n');
  } catch (e) {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function human(n) {
  const u = [['GB', 1073741824], ['MB', 1048576], ['KB', 1024]];
  for (const [name, div] of u) if (n >= div) return (n / div).toFixed(2) + ' ' + name;
  return n + ' B';
}

function formatDuration(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec);
  if (sec <= 0) return '即将完成';
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}小时${m}分` + (s > 0 ? `${s}秒` : '');
}

function formatElapsed(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec);
  if (sec <= 0) return '1秒内';
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}小时${m}分` + (s > 0 ? `${s}秒` : '');
}

function cleanLock(profileDir) {
  if (process.platform === 'win32') {
    const ps =
      'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\' or Name=\'msedge.exe\'" | ' +
      'Where-Object { $_.CommandLine -like \'*sendgb-uploader*\' -or $_.CommandLine -like \'*chrome-profile*\' -or $_.CommandLine -like \'*browser-profile*\' } | ' +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    } catch (e) {}
  }
  ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'].forEach((f) => {
    try {
      fs.rmSync(path.join(profileDir, f), { force: true });
    } catch (e) {}
  });
}

function extractLink(text) {
  if (!text || !text.toLowerCase().includes('success')) return null;
  LINK_RE.lastIndex = 0;
  let match;
  while ((match = LINK_RE.exec(text)) !== null) {
    const slug = match[1];
    if (!NOT_LINK.test('/' + slug)) {
      return `https://www.sendgb.com/${slug}`;
    }
  }
  return null;
}

async function dismissPopups(page) {
  for (let i = 0; i < 3; i++) {
    try {
      const clicked = await page.evaluate(() => {
        const b = Array.from(
          document.querySelectorAll(
            "button[aria-label*='close' i],button[title='Close'],button[aria-label*='Close']"
          )
        ).find((x) => x.offsetParent !== null);
        if (b) {
          b.click();
          return true;
        }
        return false;
      });
      if (clicked) {
        await sleep(600);
        continue;
      }
      await page.keyboard.press('Escape');
    } catch (e) {}
    break;
  }
}

async function clickSend(page) {
  try {
    const box = await page.evaluate(() => {
      const w = document.getElementById('upload-widget') || document;
      const btn = Array.from(w.querySelectorAll('button')).find(
        (b) => (b.innerText || '').trim().toUpperCase() === 'SEND'
      );
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const blocked = !(top === btn || btn.contains(top));
      return {
        x: cx,
        y: cy,
        w: r.width,
        h: r.height,
        blocked,
        blocker: blocked && top ? String(top.className || '').slice(0, 60) : ''
      };
    });

    if (!box) {
      emit({ t: 'log', m: '页面上找不到 SEND 按钮' });
      return false;
    }

    if (box.blocked) {
      emit({ t: 'log', m: `SEND 被遮挡(${box.blocker})，先关弹窗` });
      await dismissPopups(page);
      await sleep(1000);
    }

    await page.mouse.click(box.x, box.y);
    emit({ t: 'log', m: `坐标点击 SEND @(${Math.round(box.x)}, ${Math.round(box.y)})` });
    return true;
  } catch (e) {
    emit({ t: 'log', m: `查找/点击 SEND 失败: ${e.message}` });
    return false;
  }
}

function queryAppPath(exeName) {
  if (process.platform !== 'win32') return null;
  for (const root of ['HKLM', 'HKCU']) {
    try {
      const out = execFileSync(
        'reg',
        ['query', root + '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + exeName, '/ve'],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }
      );
      const lines = out.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/REG_SZ\s+(.*)/i);
        if (m && m[1]) {
          const p = m[1].trim();
          if (fs.existsSync(p)) return p;
        }
      }
    } catch (e) {}
  }
  return null;
}

function detectBrowser() {
  const force = (process.env.SENDGB_FORCE_BROWSER || '').toLowerCase();

  const getEdge = () => {
    const edgeAppPath = queryAppPath('msedge.exe');
    if (edgeAppPath) return { name: 'Microsoft Edge (系统自带)', channel: 'msedge', path: edgeAppPath };
    const edgeList = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ];
    for (const p of edgeList) {
      if (p && fs.existsSync(p)) return { name: 'Microsoft Edge (系统自带)', channel: 'msedge', path: p };
    }
    return null;
  };

  const getChrome = () => {
    const chromeAppPath = queryAppPath('chrome.exe');
    if (chromeAppPath) return { name: 'Google Chrome', channel: 'chrome', path: chromeAppPath };
    const chromeList = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    for (const p of chromeList) {
      if (p && fs.existsSync(p)) return { name: 'Google Chrome', channel: 'chrome', path: p };
    }
    return null;
  };

  if (force === 'edge') return getEdge();
  if (force === 'chrome') return getChrome();

  return getChrome() || getEdge();
}

async function runUpload(profileDir, files, timeoutS = 1800) {
  const browser = detectBrowser();
  if (!browser) {
    throw new Error('未检测到可用浏览器，请安装 Google Chrome 或启用系统自带的 Microsoft Edge');
  }

  const showBrowser = process.env.SENDGB_SHOW_BROWSER === '1' || process.argv.includes('--show-browser');

  emit({ t: 'log', m: `使用浏览器：${browser.name}（${showBrowser ? '显示窗口' : '后台静默运行'}）` });
  emit({ t: 'log', m: `正在准备上传 ${files.length} 个文件…` });

  let totalBytes = 0;
  for (const f of files) {
    try {
      const s = fs.statSync(f);
      if (s.isFile()) totalBytes += s.size;
    } catch (e) {}
  }

  // 针对大文件（最高 5GB）动态计算合理超时：基准保底 6 小时（21600秒），慢速网络也能从容传完
  const maxTimeoutS = Math.max(21600, Math.ceil(totalBytes / (50 * 1024)));

  const args = [
    '--no-proxy-server',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    // 关键防休眠与防后台降频参数：防止窗口最小化、被遮挡或长时间传输时被 Chromium 冻结/挂起
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--js-flags=--max-old-space-size=4096'
  ];

  if (showBrowser) {
    args.push('--start-maximized');
  } else {
    args.push('--window-position=25000,25000', '--window-size=1280,800');
  }

  let ctx = null;
  try {
    const launchOpts = {
      headless: false,
      viewport: null,
      args
    };
    if (browser.path) {
      launchOpts.executablePath = browser.path;
    }
    if (browser.channel) {
      launchOpts.channel = browser.channel;
    }
    ctx = await pw.chromium.launchPersistentContext(profileDir, launchOpts);
  } catch (e) {
    throw new Error(`启动浏览器（${browser.name}）失败: ${e.message}`);
  }

  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    emit({ t: 'log', m: `后台浏览器已就绪，正在打开 sendgb.com…` });

    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    emit({ t: 'log', m: 'sendgb 页面已加载，等待上传组件…' });

    await page.waitForSelector('input[type=file]', { timeout: 60000, state: 'attached' });
    await dismissPopups(page);

    // 1) 注入文件
    const fileInput = await page.$('input[type=file]');
    if (!fileInput) throw new Error('未找到文件上传控件');
    await fileInput.setInputFiles(files);
    await sleep(2000);
    emit({ t: 'log', m: '文件已注入页面' });

    // 2) 点击 Link 模式
    try {
      await page.click("#upload-widget button[aria-label='Link mode']", { timeout: 6000 });
      emit({ t: 'log', m: '已切换到 Link 模式' });
    } catch (e) {
      emit({ t: 'log', m: '定位点击 Link mode 失败，尝试 JS 兜底' });
      await page.evaluate(() => {
        const btn = document.querySelector("#upload-widget button[aria-label='Link mode']");
        if (btn) btn.click();
      });
    }
    await sleep(1500);

    // 3) 点击 SEND 按钮并等待上传
    const startedAt = Date.now();
    let uploadStartedAt = 0;
    let sentClicks = 0;
    let lastClick = 0;
    let lastProgress = -1;
    let seenUploading = false;
    let lastProgressTime = Date.now();
    let lastProgressPct = -1;
    let consecutiveErrors = 0;
    const STALL_TIMEOUT_MS = 15 * 60 * 1000; // 连续 15 分钟进度完全不动才判定为网络停滞

    while (true) {
      const now = Date.now();

      // 检查浏览器是否被外部手动关闭或崩溃
      if (page.isClosed() || (ctx && !ctx.pages().length)) {
        throw new Error('浏览器窗口已被关闭，上传中断');
      }

      // 检查总时长保护上限（6小时）
      if (now - startedAt > maxTimeoutS * 1000) {
        throw new Error(`已达到单次任务保护时长上限（${Math.round(maxTimeoutS / 3600)}小时）`);
      }

      // 检查上传网络停滞（仅在已经进入上传阶段后生效）
      if (seenUploading && (now - lastProgressTime > STALL_TIMEOUT_MS)) {
        throw new Error(`上传连接已停滞超过 15 分钟无响应（进度卡在 ${lastProgressPct}%），请检查网络后重试`);
      }

      const txt =
        (await page
          .evaluate(() => {
            const w = document.getElementById('upload-widget');
            return w ? w.innerText : '';
          })
          .catch(() => '')) || '';

      const link = extractLink(txt);
      if (link) {
        const totalDuration = Math.round((Date.now() - (uploadStartedAt || startedAt)) / 1000);
        const durStr = formatElapsed(totalDuration);
        emit({ t: 'done', link, duration: totalDuration, durationStr: durStr });
        if (showBrowser) {
          await sleep(2500); // 弹窗界面保留片刻让用户看到成功界面，随后自动关闭
        } else {
          await sleep(300);
        }
        return link;
      }

      // 错误检测防抖：SendGB 页面广告或 tus/resumable 分片重试可能会瞬时产生错误提示，需连续多次检测确认失败
      const hasErrorText = /upload failed|uploadFailed|error occurred/i.test(txt);
      if (hasErrorText) {
        consecutiveErrors++;
        if (consecutiveErrors === 1) {
          emit({ t: 'log', m: '检测到分片网络波动，等待断点续传重试…' });
        } else if (consecutiveErrors >= 10) {
          throw new Error('SendGB 返回上传失败（多次重试未果），请检查网络后重试');
        }
      } else {
        consecutiveErrors = 0;
      }

      if (/uploading/i.test(txt)) {
        seenUploading = true;
        const m = txt.match(PCT_RE);
        if (m) {
          const pct = Math.min(100, parseInt(m[1], 10));
          if (uploadStartedAt === 0 && pct > 0) {
            uploadStartedAt = Date.now();
          }
          if (pct !== lastProgress) {
            if (pct > lastProgressPct) {
              lastProgressPct = pct;
              lastProgressTime = now; // 进度在推进，持续刷新活跃时间
            }
            const sp = txt.match(SPEED_RE);
            let speedStr = sp ? sp[0] : '';
            let etaStr = '';
            const elapsed = uploadStartedAt > 0 ? (Date.now() - uploadStartedAt) / 1000 : 0;

            if (elapsed >= 1 && pct > 0) {
              const remainingSec = pct >= 100 ? 0 : Math.round((elapsed / pct) * (100 - pct));
              etaStr = formatDuration(remainingSec);
              if (!speedStr && totalBytes > 0) {
                const uploadedBytes = (pct / 100) * totalBytes;
                const speedBps = uploadedBytes / elapsed;
                if (speedBps > 0) speedStr = human(speedBps) + '/s';
              }
            }

            const spdPart = speedStr ? ` · 速度 ${speedStr}` : '';
            const etaPart = etaStr ? ` · 预估剩余 ${etaStr}` : '';
            emit({
              t: 'progress',
              p: pct,
              speed: speedStr,
              eta: etaStr,
              m: `上传中 ${pct}%${spdPart}${etaPart}`
            });
            lastProgress = pct;
          }
        }
      }

      // 首次点击或长时间卡住补点
      if (sentClicks === 0 || (!seenUploading && now - lastClick > 40000 && sentClicks < 4)) {
        await dismissPopups(page);
        if (sentClicks > 0) {
          emit({ t: 'log', m: '尚未开始上传，页面当前状态: ' + txt.replace(/\n/g, ' | ').slice(0, 180) });
        }
        const clicked = await clickSend(page);
        if (clicked) {
          sentClicks++;
          lastClick = now;
          emit({ t: 'log', m: `已点击 SEND（第 ${sentClicks} 次），等待人机验证与上传…` });
        }
        await sleep(3000);
        continue;
      }

      await sleep(1500);
    }
  } finally {
    try {
      await ctx.close();
    } catch (e) {}
  }
}

async function main() {
  const profileDir =
    process.env.SENDGB_PROFILE_DIR ||
    path.join(
      process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : 'C:\\Temp'),
      'sendgb-uploader',
      'chrome-profile'
    );
  const files = process.argv.slice(2).filter(Boolean);

  if (!files.length) {
    emit({ t: 'error', m: '没有收到文件' });
    process.exit(2);
  }

  for (const f of files) {
    if (!fs.existsSync(f)) {
      emit({ t: 'error', m: `文件不存在: ${f}` });
      process.exit(2);
    }
  }

  cleanLock(profileDir);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await runUpload(profileDir, files);
      process.exit(0);
    } catch (e) {
      const msg = e.message || String(e);
      const isLocked =
        msg.includes('ProcessSingleton') ||
        msg.includes('Lock file') ||
        msg.includes('已在运行的会话') ||
        msg.includes('Target page, context or browser has been closed') ||
        msg.includes('Target closed');

      if (isLocked && attempt === 1) {
        emit({ t: 'log', m: '检测到残留浏览器占用，自动清理锁后重试…' });
        cleanLock(profileDir);
        await sleep(2000);
        continue;
      }

      emit({ t: 'error', m: msg });
      process.exit(1);
    }
  }
}

main().catch((e) => {
  emit({ t: 'error', m: e.message || String(e) });
  process.exit(1);
});
