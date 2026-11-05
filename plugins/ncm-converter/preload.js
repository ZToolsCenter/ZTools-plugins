// ZTools 插件 preload：通用音频转 MP3（含 NCM 解密）
// 运行在 Node 上下文，可直接使用 require / fs / path / child_process。
// NCM 走纯 JS 解密；其他格式优先调用系统 ffmpeg 转码（绝对路径探测），避免触发 ZTools 的 FFmpeg 下载弹窗。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { parseNcm } = require('./ncmdump.cjs');

// 完成提示的小窗停留时长（毫秒）。宿主在 enter 的 Promise resolve 后才退出插件，
// 所以这里必须「等小窗自毁」再 resolve，否则窗口会被一起带走。
const TOAST_MS = 5000;

// 立即隐藏主窗口：ZTools 启动任何插件都会先 show 主窗口（AppsAPI.launch 无 headless 豁免），
// preload 一加载就把它藏掉，比 enter() 更早，尽量压缩「闪屏」空隙。
(function silentHide() {
  try {
    if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.hideMainWindow === 'function') {
      // false = 不恢复 explorer 焦点，排查「任务栏/资源管理器闪烁」是否是闪屏来源
      window.ztools.hideMainWindow(false);
    }
  } catch (e) {}
})();

// 清理文件名中的非法字符（Windows）
function sanitize(name) {
  return (name || 'output')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'output';
}

// 把 parseNcm 返回的 audio（Uint8Array / Buffer / 类数组对象）统一转成 Buffer
function toBuffer(x) {
  if (!x) return Buffer.alloc(0);
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (Array.isArray(x)) return Buffer.from(x);
  if (typeof x === 'object') {
    const len = Object.keys(x).length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = x[i];
    return Buffer.from(u8);
  }
  return Buffer.from(x);
}

// 统一通知（ZTools 通知；测试环境降级为 console）
function notify(text) {
  try {
    if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.showNotification === 'function') {
      window.ztools.showNotification(text);
      return;
    }
  } catch (e) {}
  try { console.log('[notify] ' + text) } catch (e) {}
}

// 诊断日志：每次转换都写 %TEMP%\ncm-converter-debug.log，失败时可直接查原因
const LOG_FILE = path.join(os.tmpdir(), 'ncm-converter-debug.log')
function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] ${msg}\n`)
  } catch (e) {}
}

// 超强兼容：把 action 里各种可能形态的文件描述提取为纯路径字符串数组。
function collectPaths(action) {
  log('收到 action: ' + summarize(action))
  let payload = action;
  if (action && typeof action === 'object') {
    if ('payload' in action) payload = action.payload;
    else if ('files' in action) payload = action.files;
  }
  const list = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const item of list) {
    if (item == null) continue;
    if (typeof item === 'string') { out.push(item); continue; }
    if (typeof item === 'object') {
      const p =
        item.path || item.filePath || item.realPath ||
        (item.data && (item.data.path || item.data.filePath)) ||
        item.name;
      if (typeof p === 'string') out.push(p);
    }
  }
  return out;
}

// 调试用：把结构压缩成可读摘要
function summarize(v) {
  try {
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 400);
    return String(v);
  } catch (e) {
    return '[unstringifiable ' + (v && v.constructor && v.constructor.name) + ']';
  }
}

// 本地测试 / 非 ZTools 环境 fallback：探测系统 ffmpeg
let _ffmpeg;
function findFfmpeg() {
  if (_ffmpeg !== undefined) return _ffmpeg;
  const cands = [
    process.env.FFMPEG_PATH,
    'ffmpeg',
    'C:/Program Files/ffmpeg-2022-11-03/bin/ffmpeg.exe',
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files (x86)/ffmpeg/bin/ffmpeg.exe',
    'C:/ffmpeg/bin/ffmpeg.exe'
  ].filter(Boolean);
  for (const c of cands) {
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore', windowsHide: true });
      _ffmpeg = c;
      return c;
    } catch (e) {}
  }
  _ffmpeg = null;
  return null;
}

// 运行 ffmpeg：优先使用系统已安装的 ffmpeg（绝对路径探测），彻底绕开 ZTools 的
// FFmpeg 下载弹窗（实测 ZTools 下载节点在你网络下全部不可达）。仅当系统无 ffmpeg 时，
// 才退回 ZTools 内置 runFFmpeg（会弹集成下载窗，让用户自行决定）。
function runFfmpeg(args) {
  const ff = findFfmpeg();
  if (ff) {
    return new Promise((resolve, reject) => {
      log('ffmpeg 命令: ' + ff + ' ' + args.map(a => (/[\s"']/.test(String(a)) ? `"${a}"` : a)).join(' '));
      const cp = spawn(ff, args, { windowsHide: true });
      let err = '';
      if (cp.stderr) cp.stderr.on('data', d => { err += d.toString(); });
      cp.on('error', e => { log('spawn 错误: ' + e.message); reject(e); });
      cp.on('close', code => {
        if (code === 0) { log('ffmpeg 成功'); return resolve(); }
        // 保留原始 stderr 尾部（不过滤，避免把中文/真实错误滤掉）
        const tail = err.trim() ? err.trim().split('\n').slice(-8).join('\n') : '(ffmpeg 无 stderr 输出)';
        log('ffmpeg 失败 code=' + code + '\n' + tail);
        reject(new Error(`ffmpeg 退出码 ${code}\n${tail}`));
      });
    });
  }
  // 本地没有 ffmpeg，再退回 ZTools 内置（会弹集成下载窗）
  if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.runFFmpeg === 'function') {
    return window.ztools.runFFmpeg(args);
  }
  return Promise.reject(new Error('未检测到 ffmpeg。请安装 ffmpeg 并加入 PATH，或设置环境变量 FFMPEG_PATH。'));
}

// 目录是否可写（用于输出目录回退）
function isWritable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

// 生成不冲突的输出路径
function uniquePath(dir, name) {
  let p = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(p)) {
    const ext = path.extname(name);
    const base = name.slice(0, -ext.length);
    p = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return p;
}

// 构造输出文件名（NCM 优先用元数据，其他用原文件名）
function buildName(filePath, metadata) {
  const base = path.basename(filePath, path.extname(filePath));
  const meta = metadata || {};
  if (meta.musicName) {
    let artist = '';
    if (Array.isArray(meta.artist)) {
      artist = meta.artist.map(a => (Array.isArray(a) ? a[0] : a)).filter(Boolean).join(', ');
    } else if (typeof meta.artist === 'string') {
      artist = meta.artist;
    }
    return sanitize((artist ? artist + ' - ' : '') + meta.musicName);
  }
  return sanitize(base);
}

// NCM 解密并输出为无封面 MP3
async function ncmToMp3(filePath) {
  const buf = fs.readFileSync(filePath);
  const { format, metadata, audio } = parseNcm(buf);

  const tmp = path.join(os.tmpdir(), `ncm_dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${format}`);
  fs.writeFileSync(tmp, toBuffer(audio));

  const outName = `${buildName(filePath, metadata)}.mp3`;
  const outPath = uniquePath(path.dirname(filePath), outName);

  // NCM 源若是 mp3，仅去封面不重编码；flac 等则编码为 mp3
  const args = format === 'mp3'
    ? ['-y', '-i', tmp, '-vn', '-c:a', 'copy', outPath]
    : ['-y', '-i', tmp, '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', outPath];

  try {
    await runFfmpeg(args);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
  return outPath;
}

// 通用音频转 MP3（无封面）
async function convertFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  if (ext === 'ncm') return ncmToMp3(filePath);

  const outName = `${buildName(filePath)}.mp3`;
  let outDir = path.dirname(filePath);
  // 源目录不可写（网盘/只读/受保护目录）时回退到桌面，避免整单失败
  if (!isWritable(outDir)) {
    const desk = path.join(os.homedir(), 'Desktop');
    log(`源目录不可写，回退桌面: ${outDir} -> ${desk}`);
    outDir = isWritable(desk) ? desk : os.tmpdir();
  }
  const outPath = uniquePath(outDir, outName);
  log(`转换: ${filePath} -> ${outPath}`);
  // -map 0:a:0：只取第一条音轨，避开封面/多轨导致 flac 转码失败
  await runFfmpeg(['-y', '-i', filePath, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', outPath]);
  return outPath;
}

// ── 完成反馈：提示音 + 右下角小窗 + 通知中心 toast ──────────────────────
// 宿主系统通知在缺 AUMID 注册的 Windows 构建上会静默失败，
// 所以自己弹一个右下角自毁小窗（真实窗口，不依赖系统通知权限）。
// 小窗属于插件进程，宿主在 enter 的 Promise resolve 后才退出插件，
// 所以调用方必须等小窗自毁（dwell）之后再 resolve。

// 弹窗位置：'br' = 右下角（默认），'bl' = 左下角。可用 dbStorage 的 toast_corner 调整。
function toastCorner() {
  try {
    const v = window.ztools.dbStorage.getItem('toast_corner');
    return v === 'bl' ? 'bl' : 'br';
  } catch (e) {
    return 'br';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 弹出一个右下角（或左下角）的自毁小窗，列出转换结果。
function showToastWindow(title, lines, closeAfterMs) {
  try {
    if (typeof window === 'undefined' || !window.ztools || typeof window.ztools.createBrowserWindow !== 'function') return;
    const disp = typeof window.ztools.getPrimaryDisplay === 'function' ? window.ztools.getPrimaryDisplay() : null;
    const wa = (disp && disp.workArea) || { x: 0, y: 0, width: 1920, height: 1080 };
    const W = 380;
    const shown = (lines || []).slice(0, 8);
    const H = 74 + shown.length * 22;
    const items = shown.map(l => {
      const bad = l.indexOf('✗') === 0;
      return `<div class="l${bad ? ' bad' : ''}">${escapeHtml(l)}</div>`;
    }).join('');
    const more = (lines || []).length > shown.length
      ? `<div class="l dim">…等 ${lines.length} 个文件</div>`
      : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:12px 14px;font:13px/1.55 "Microsoft YaHei",system-ui,sans-serif;
        background:#1b1d21;color:#e6e8ea;user-select:none}
      .t{font-weight:600;font-size:14px;margin-bottom:4px;color:#fff}
      .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c9ced6}
      .l.bad{color:#ff6b5e}
      .l.dim{color:#7d8590}
    </style></head><body>
      <div class="t">${escapeHtml(title)}</div>${items}${more}
      <script>setTimeout(function(){try{window.close()}catch(e){}},${closeAfterMs})</script>
    </body></html>`;
    const file = path.join(os.tmpdir(), 'ztools-toast-' + Date.now() + '.html');
    fs.writeFileSync(file, html);
    const url = 'file:///' + file.replace(/\\/g, '/');
    const corner = toastCorner();
    const x = corner === 'bl' ? wa.x + 16 : wa.x + wa.width - W - 16;
    window.ztools.createBrowserWindow(url, {
      width: W,
      height: H,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      show: true,
      x: x,
      y: wa.y + wa.height - H - 16
    });
    setTimeout(() => { try { fs.unlinkSync(file); } catch (e) {} }, (closeAfterMs || TOAST_MS) + 8000);
    log('toast 窗口已弹出: ' + url);
  } catch (e) {
    log('toast 窗口失败: ' + (e && e.message ? e.message : e));
  }
}

// 进 Windows 通知中心（Action Center）的原生 toast：横幅显示后留在通知中心可查历史。
// 用 PowerShell WinRT 发送，挂在 PowerShell 自己的 AUMID 下（永远已注册，不受宿主
// AUMID 缺失影响）；走 -EncodedCommand 避免引号/中文转义问题；子进程独立于插件进程存活。
function sendActionCenterToast(title, lines) {
  try {
    const texts = [escapeHtml(title)].concat((lines || []).slice(0, 8).map(escapeHtml))
      .map(t => '<text>' + t + '</text>').join('');
    const xml =
      '<toast><visual><binding template="ToastGeneric">' + texts + '</binding></visual>' +
      '<audio silent="true"/></toast>'; // 声音由 shellBeep 负责，toast 静音避免双重响
    const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('${xml.replace(/'/g, "''")}')
$t = [Windows.UI.Notifications.ToastNotification]::new($x)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($t)
`;
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { windowsHide: true, stdio: 'ignore' });
    log('通知中心 toast 已发送');
  } catch (e) {
    log('通知中心 toast 失败: ' + (e && e.message ? e.message : e));
  }
}

// 统一的入口处理
async function handle(action) {
  try {
    // 静默：只隐藏主窗口，**绝不**在这里调用 outPlugin()！
    // outPlugin() 会让 ZTools 立刻销毁插件进程（日志实证：load → killPlugin → 插件已终止，
    // 全程 <150ms），导致下面的 ffmpeg 转换根本没机会执行，表现就是「点了转换没反应」。
    // mode:'none' 插件在 enter 的 Promise resolve 后会自动退出，无需手动 outPlugin。
    if (typeof window !== 'undefined' && window.ztools) {
      if (typeof window.ztools.hideMainWindow === 'function') {
        try { window.ztools.hideMainWindow(false); } catch (e) {}
      }
    }

    let files = collectPaths(action);

    // 没有拿到文件：弹文件选择器
    if (files.length === 0) {
      let picked = null;
      if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.showOpenDialog === 'function') {
        picked = window.ztools.showOpenDialog({
          title: '选择音频文件',
          properties: ['openFile', 'multiSelections'],
          filters: [{
            name: 'Audio',
            extensions: ['ncm', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus', 'mp3', 'ape', 'caf', 'aiff', 'amr']
          }]
        });
        // showOpenDialog 可能同步返回，也可能返回 Promise —— 两种都处理
        if (picked && typeof picked.then === 'function') {
          try { picked = await picked } catch (e) { picked = null }
        }
        if (picked && !Array.isArray(picked) && Array.isArray(picked.filePaths)) picked = picked.filePaths;
      }
      if (Array.isArray(picked) && picked.length) files = picked;
    }

    if (!files.length) {
      log('未获取到文件，放弃')
      notify('未获取到音频文件。');
      return;
    }

    // 先给即时反馈：大文件转码要几秒到几十秒，没有反馈会被当成"没反应"
    notify(`开始转换 ${files.length} 个文件…`);

    const lines = [];
    let okCount = 0;
    let outDir = '';
    for (const f of files) {
      const fp = typeof f === 'string' ? f : (f && f.path) || '';
      if (!fp) {
        lines.push('跳过（无法解析路径）');
        continue;
      }
      try {
        const out = await convertFile(fp);
        okCount++;
        if (!outDir) outDir = path.dirname(out);
        lines.push('✓ ' + path.basename(out));
      } catch (e) {
        const msg = (e && e.message ? e.message : String(e));
        log('转换失败 ' + fp + ' : ' + msg);
        lines.push('✗ ' + path.basename(fp) + ': ' + msg);
      }
    }

    const head = okCount === files.length
      ? `✅ 转换完成（${okCount}/${files.length}）`
      : `转换完成（${okCount}/${files.length}）`;
    const body = lines.slice(0, 10).join('\n');

    // 三通道反馈：提示音（听得到）+ 右下角小窗（看得见）+ 通知中心原生 toast（可查历史）。
    // 小窗属于插件进程，宿主要等 enter resolve 才退插件，所以 dwell 要略长于小窗时长。
    try { if (window.ztools && typeof window.ztools.shellBeep === 'function') window.ztools.shellBeep(); } catch (e) {}
    showToastWindow(head, lines, TOAST_MS);
    sendActionCenterToast(head, lines);
    notify(head + '\n' + body);
    // 等小窗自己关掉再退出插件，否则窗口会被一起销毁（看不到提示）
    await new Promise(r => setTimeout(r, TOAST_MS + 500));
    log('完成: ' + head);
  } catch (e) {
    log('整体失败: ' + (e && e.message ? e.message : e));
    notify('转 MP3 失败: ' + (e && e.message ? e.message : e));
  }
}

window.exports = {
  convert: { mode: 'none', args: { enter: handle } },
  'convert-pick': { mode: 'none', args: { enter: handle } }
};

// 本地测试导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    collectPaths, toBuffer, convertFile, findFfmpeg, runFfmpeg,
    showToastWindow, sendActionCenterToast, toastCorner, handle, TOAST_MS
  };
}
