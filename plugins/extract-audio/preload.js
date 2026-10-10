// ZTools 插件 preload：视频 → 无损提取音频（原编码直出，不重转码）
// 运行在 Node 上下文，可直接使用 require / fs / path / child_process。
// 架构沿用 zt-ncm-converter 的生产经验：
//   1. 优先调用系统已安装的 ffmpeg（探测 PATH 与常见安装路径），
//      避免触发 ZTools 内置 runFFmpeg 的 FFmpeg 下载弹窗（下载节点实测不可达）；
//   2. 仅当系统完全没有 ffmpeg 时，才回退 ZTools 内置 runFFmpeg。
// 职责边界：preload 只干 node/ffmpeg 的活（探测/提取/校验/移动），
// UI 在 index.html，两者通过 window.audioBridge 与 CustomEvent 通讯。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

// 诊断日志：每次提取都写 %TEMP%\audio-extract-debug.log，失败时可直接查原因
const LOG_FILE = path.join(os.tmpdir(), 'audio-extract-debug.log');
function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleString('zh-CN')}] ${msg}\n`);
  } catch (e) {}
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

// 运行 ffmpeg：优先系统已安装的 ffmpeg，仅当系统无 ffmpeg 时退回 ZTools 内置。
// opts.onProgress(percent)  仅系统 ffmpeg 路径用：解析 -progress pipe:1 的 out_time_ms
function runFfmpeg(args, opts) {
  const onProgress = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const ff = findFfmpeg();
  if (ff) {
    return new Promise((resolve, reject) => {
      log('ffmpeg 命令: ' + ff + ' ' + args.map(a => (/[\s"']/.test(String(a)) ? `"${a}"` : a)).join(' '));
      const cp = spawn(ff, args, { windowsHide: true });
      let err = '';
      if (cp.stderr) cp.stderr.on('data', d => { err += d.toString(); });
      if (cp.stdout && onProgress) {
        let buf = '';
        cp.stdout.on('data', d => {
          buf += d.toString();
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            const m = /out_time_ms=(\d+)/.exec(line) || /out_time_us=(\d+)/.exec(line);
            // ffmpeg 的 out_time_ms 名不副实，单位是微秒
            if (m) onProgress(parseInt(m[1], 10) / 1e6);
          }
        });
      }
      cp.on('error', e => { log('spawn 错误: ' + e.message); reject(e); });
      cp.on('close', code => {
        if (code === 0) { log('ffmpeg 成功'); return resolve(); }
        const tail = err.trim() ? err.trim().split('\n').slice(-8).join('\n') : '(ffmpeg 无 stderr 输出)';
        log('ffmpeg 失败 code=' + code + '\n' + tail);
        reject(new Error(`ffmpeg 退出码 ${code}\n${tail}`));
      });
    });
  }
  if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.runFFmpeg === 'function') {
    return window.ztools.runFFmpeg(args, {
      onLog: () => {},
      onProgress: p => { if (onProgress && p && typeof p.percent === 'number') onProgress(p.percent / 100); }
    });
  }
  return Promise.reject(new Error('未检测到 ffmpeg。请安装 ffmpeg 并加入 PATH，或设置环境变量 FFMPEG_PATH。'));
}

// 从 ffmpeg 的 stderr 里解析第一条音轨的编码名（aac/mp3/opus/...）
function parseCodec(stderrText) {
  const m = /Audio:\s*([A-Za-z0-9_]+)/.exec(stderrText || '');
  return m ? m[1].toLowerCase() : null;
}

// 从 ffmpeg 的 stderr 里解析容器总时长（秒）
function parseDuration(stderrText) {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(stderrText || '');
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 100;
}

// 探测文件：第一条音轨的编码 + 容器时长。探测不到音轨时 codec 为 null
function probeAudio(file) {
  const args = ['-hide_banner', '-i', file];
  const ff = findFfmpeg();
  if (ff) {
    return new Promise((resolve) => {
      const cp = spawn(ff, args, { windowsHide: true });
      let err = '';
      if (cp.stderr) cp.stderr.on('data', d => { err += d.toString(); });
      cp.on('error', () => resolve({ codec: null, duration: 0 }));
      cp.on('close', () => resolve({ codec: parseCodec(err), duration: parseDuration(err) }));
    });
  }
  // 回退 ZTools 内置 runFFmpeg：探测命令没有输出文件，ffmpeg 必定报错退出，
  // 但流信息已经在 stderr（onLog）里了，照常解析即可
  if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.runFFmpeg === 'function') {
    let text = '';
    return window.ztools.runFFmpeg(args, { onLog: line => { text += line + '\n'; } })
      .then(() => ({ codec: parseCodec(text), duration: parseDuration(text) }))
      .catch(() => ({ codec: parseCodec(text), duration: parseDuration(text) }));
  }
  return Promise.resolve({ codec: null, duration: 0 });
}

// 编码 → 输出容器后缀。原则：除大端 PCM 的字节序重排外，全程 -c:a copy 零转码，
// 位深/采样率/声道/采样值一律原样（16bit 永远是 16bit，32bit 永远是 32bit）。
// 大端 PCM（pcm_*be，相机 twos 等）：WAV 规范只收小端，按规范重排字节后进 .wav，
// 采样值数学上完全等价、零损失；其余 pcm（小端）直接进 wav；
// aac/alac 进 m4a；mka（Matroska 纯音频）几乎能装下任何编码，做默认兜底。
const CODEC_EXT = {
  aac: 'm4a', alac: 'm4a', mp3: 'mp3', opus: 'opus', vorbis: 'ogg',
  flac: 'flac', ac3: 'ac3', eac3: 'eac3', amr_nb: 'amr', amr_wb: 'amr'
};
function codecToExt(codec) {
  if (!codec) return 'mka';
  if (codec.indexOf('pcm') === 0) return 'wav';
  return CODEC_EXT[codec] || 'mka';
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

// 生成不冲突的输出路径（同名文件已存在时追加 " (1)"、" (2)"…）
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

// 提取单个视频的音频：探测编码 → 选容器 → 原样抽出 → 时长校验。
// opts.onProgress(sec)  已处理的音频秒数
// opts.validate         是否做输出时长校验（默认开）
// 只提取、只生成文件，**绝不删除/移动源视频**——归档由 UI 层显式调用 moveExtractedVideo。
async function extractFile(filePath, opts) {
  const onProgress = opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const validate = !opts || opts.validate !== false;

  const { codec, duration } = await probeAudio(filePath);
  log(`探测 ${filePath} 音轨编码: ${codec || '(无音轨)'} 时长: ${duration}s`);
  if (!codec) throw new Error('未探测到音频轨（视频可能没有声音或文件损坏）');

  const base = path.basename(filePath, path.extname(filePath));
  let outDir = path.dirname(filePath);
  // 源目录不可写（网盘/只读/受保护目录）时回退到桌面，避免整单失败
  if (!isWritable(outDir)) {
    const desk = path.join(os.homedir(), 'Desktop');
    log(`源目录不可写，回退桌面: ${outDir} -> ${desk}`);
    outDir = isWritable(desk) ? desk : os.tmpdir();
  }
  const outPath = uniquePath(outDir, `${base}.${codecToExt(codec)}`);
  log(`提取: ${filePath} -> ${outPath}`);

  // 除大端 PCM 外全程 -c:a copy 零转码。-map 0:a:0 只取第一条音轨（避开封面流/多轨干扰）
  const args = ['-y', '-i', filePath, '-map', '0:a:0', '-vn'];
  if (codec.indexOf('pcm_') === 0 && /be$/.test(codec)) {
    // 相机素材的大端 PCM（twos/pcm_s16be 等）装不进 WAV——WAV 规范只收小端
    // （ffmpeg 报 "Codec pcm_s16be not supported in WAVE format"）。按 WAV 规范
    // 重排字节序后进 .wav：PCM→PCM 仅字节表示不同，位深/采样率/声道/采样值全部
    // 原样（16bit 仍是 16bit，32bit 仍是 32bit），数学意义上零损失，不是重采样/转码。
    // 注意编码名结尾是数字+be（pcm_s16be），不是 _be。
    const le = codec.replace(/be$/, 'le');
    log(`大端 PCM 按 WAV 规范重排字节序: ${codec} -> ${le}（位深等规格不变）`);
    args.push('-c:a', le);
  } else {
    args.push('-c:a', 'copy');
  }
  if (onProgress) args.push('-progress', 'pipe:1', '-nostats');
  args.push(outPath);

  try {
    await runFfmpeg(args, onProgress ? { onProgress: sec => onProgress(Math.min(100, Math.round(sec / (duration || 1) * 100))) } : null);
  } catch (e) {
    // ffmpeg 失败时输出文件可能已建出（20 字节空壳），删掉避免误导
    try { fs.unlinkSync(outPath); } catch (_) {}
    throw e;
  }

  if (validate) {
    const ok = await checkOutputDuration(outPath, duration);
    if (!ok) {
      try { fs.unlinkSync(outPath); } catch (_) {}
      const e = new Error('输出时长异常（可能截断），已丢弃结果，源视频未受影响');
      log(`校验失败 ${outPath}: 期望≈${duration}s`);
      throw e;
    }
  }
  return outPath;
}

// 输出时长校验：明显短于源（<90%）视为提取失败。
// ponytail: 粗粒度启发式，只防"截断/坏文件"这一类事故；流式源无精确音轨时长，用容器时长兜底。
async function checkOutputDuration(outPath, sourceDuration) {
  if (!sourceDuration) return true; // 探测不到源时长时只能放行
  const { duration: outDur } = await probeAudio(outPath);
  if (!outDur) return false;
  return outDur >= sourceDuration * 0.9;
}

// 把提取成功的源视频移动到源目录下的归档子文件夹（只移动，不删除，随时可拖回）。
// 源已经在归档文件夹里时不重复移动（防「已提取音频的视频」层层套娃），返回 null。
function moveExtractedVideo(videoPath, folderName) {
  const name = folderName || '已提取音频的视频';
  if (path.basename(path.dirname(videoPath)) === name) {
    log('已在归档文件夹内，跳过移动: ' + videoPath);
    return null;
  }
  const targetDir = path.join(path.dirname(videoPath), name);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const dest = uniquePath(targetDir, path.basename(videoPath));
  fs.renameSync(videoPath, dest);
  log(`归档: ${videoPath} -> ${dest}`);
  return dest;
}

// 保证可见的完成提示：系统通知（Electron Notification）在缺 AUMID 注册的 Windows 构建
// 上会静默失败，这里兜底弹一个右下角自毁小窗（真实窗口，不依赖系统通知权限）。
// 窗口属于插件进程，宿主在 enter 的 Promise resolve 后才退出插件，所以调用方需 dwell 几秒。
async function showToastWindow(title, lines, closeAfterMs) {
  try {
    if (typeof window === 'undefined' || !window.ztools || typeof window.ztools.createBrowserWindow !== 'function') return;
    const disp = typeof window.ztools.getPrimaryDisplay === 'function' ? window.ztools.getPrimaryDisplay() : null;
    const wa = (disp && disp.workArea) || { x: 0, y: 0, width: 1920, height: 1080 };
    const W = 380;
    const H = 74 + lines.length * 22;
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const items = lines.map(l => {
      const bad = l.indexOf('✗') === 0;
      return `<div class="l${bad ? ' bad' : ''}">${esc(l)}</div>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:12px 14px;font:13px/1.55 "Microsoft YaHei",system-ui,sans-serif;
        background:#1b1d21;color:#e6e8ea;user-select:none}
      .t{font-weight:600;font-size:14px;margin-bottom:4px;color:#fff}
      .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c9ced6}
      .l.bad{color:#ff6b5e}
    </style></head><body>
      <div class="t">${esc(title)}</div>${items}
      <script>setTimeout(function(){try{window.close()}catch(e){}},${closeAfterMs})</script>
    </body></html>`;
    const file = path.join(os.tmpdir(), 'ztools-toast-' + Date.now() + '.html');
    fs.writeFileSync(file, html);
    const url = 'file:///' + file.replace(/\\/g, '/');
    window.ztools.createBrowserWindow(url, {
      width: W,
      height: H,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      show: true,
      x: wa.x + wa.width - W - 16,
      y: wa.y + wa.height - H - 16
    });
    setTimeout(() => { try { fs.unlinkSync(file); } catch (e) {} }, (closeAfterMs || 2800) + 8000);
  } catch (e) {
    log('toast 窗口失败: ' + (e && e.message ? e.message : e));
  }
}

// ── 无界面模式（中键/超级面板/粘贴 files 指令触发）────────────────────────
// 不弹窗口、干完活发系统通知，enter 的 Promise resolve 后宿主自动退出插件。

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

// 把 action 里各种可能形态的文件描述提取为真实存在的文件路径
function collectPaths(action) {
  log('收到 action: ' + summarize(action));
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
  return out.filter(p => {
    try { return fs.statSync(p).isFile(); } catch (e) { return false; }
  });
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

// 没拿到文件时弹系统选择框（showOpenDialog 可能同步返回也可能返回 Promise，两种都处理）
async function pickDialog() {
  if (typeof window === 'undefined' || !window.ztools || typeof window.ztools.showOpenDialog !== 'function') return null;
  let picked = window.ztools.showOpenDialog({
    title: '选择要提取音频的视频文件',
    properties: ['openFile', 'multiSelections'],
    filters: [{
      name: 'Video',
      extensions: ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'flv', 'wmv', 'webm', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', 'mxf', '3gp', 'rmvb']
    }]
  });
  if (picked && typeof picked.then === 'function') {
    try { picked = await picked } catch (e) { picked = null }
  }
  if (picked && !Array.isArray(picked) && Array.isArray(picked.filePaths)) picked = picked.filePaths;
  return Array.isArray(picked) ? picked : null;
}

// 归档开关：UI 里的勾选存在 dbStorage，无界面模式读同一份（默认开）
function archiveEnabled() {
  try {
    return window.ztools.dbStorage.getItem('archive_default') !== false;
  } catch (e) {
    return true;
  }
}

// 进 Windows 通知中心（Action Center）的原生 toast：横幅显示后留在通知中心可查历史。
// 用 PowerShell WinRT 发送，挂在 PowerShell 自己的 AUMID 下（永远已注册，不受宿主
// AUMID 缺失影响）；走 -EncodedCommand 避免引号/中文转义问题；子进程独立于插件进程存活。
function sendActionCenterToast(title, lines) {
  try {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
    const texts = [esc(title)].concat(lines.slice(0, 8).map(esc))
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

// 无界面入口：提取全部文件 → 通知结果 → resolve 后宿主自动退出
async function handleHeadless(action) {
  try {
    let files = collectPaths(action);
    if (!files.length) files = (await pickDialog()) || [];
    if (!files.length) { log('未获取到视频文件，放弃'); return; }

    notify(`开始提取 ${files.length} 个文件的音频…`);

    const lines = [];
    const done = [];
    let okCount = 0;
    for (const f of files) {
      try {
        const out = await extractFile(f, {
          onProgress: () => {}
        });
        okCount++;
        done.push({ src: f, out });
        lines.push('✓ ' + path.basename(out));
      } catch (e) {
        const all = (e && e.message ? e.message : String(e)).split('\n');
        const msg = all.find(l => l.trim() && l.indexOf('ffmpeg 退出码') !== 0) || all[0];
        log('提取失败 ' + f + ' : ' + msg);
        lines.push('✗ ' + path.basename(f) + ': ' + msg);
      }
    }

    // 归档：只移动提取成功的源视频，失败的不动；已在归档文件夹里的不重复移动
    let archived = 0;
    let alreadyArchived = 0;
    if (archiveEnabled()) {
      for (const d of done) {
        try {
          const dest = moveExtractedVideo(d.src);
          if (dest === null) alreadyArchived++;
          else archived++;
        } catch (e) { log('归档失败 ' + d.src + ' : ' + (e && e.message)); }
      }
    }

    const head = okCount === files.length
      ? `✅ 音频已提取（${okCount}/${files.length}）`
      : `音频提取完成（${okCount}/${files.length}）`;
    let body = lines.slice(0, 10).join('\n');
    if (lines.length > 10) body += `\n…等 ${lines.length} 个文件`;
    if (archived) body += `\n已提取的视频(${archived})移入「已提取音频的视频」`;
    else if (alreadyArchived) body += `\n源视频已在归档文件夹，未重复移动`;

    // 四通道反馈：提示音（听得到）+ 右下角小窗（5 秒，历史在通知中心）
    // + 通知中心原生 toast（可查历史）+ 宿主系统通知（锦上添花）。
    // 小窗属于插件进程，宿主要等 enter resolve 才退插件，dwell 略长于小窗时长。
    try { if (window.ztools && typeof window.ztools.shellBeep === 'function') window.ztools.shellBeep(); } catch (e) {}
    await showToastWindow(head, body.split('\n'), 5000);
    sendActionCenterToast(head, body.split('\n'));
    notify(head + '\n' + body);
    await new Promise(r => setTimeout(r, 5500));
  } catch (e) {
    log('整体失败: ' + (e && e.message ? e.message : e));
    notify('音频提取失败: ' + (e && e.message ? e.message : e));
  }
}

// ── 双模式装配 ──────────────────────────────────────────────
// extract     files 指令（中键/超级面板/粘贴）→ mode:'none' 无界面，配 mainHide:true 不弹窗
// extract-ui  关键词（Alt+Space 搜索）→ 无 mode 带界面，入口在 index.html 的 onPluginEnter
window.exports = {
  extract: { mode: 'none', args: { enter: handleHeadless } }
};

// 渲染层桥：node/ffmpeg 能力全在这里，UI 只管展示。
// 注意：带界面的插件，进入参数由宿主派发给渲染层的 ztools.onPluginEnter，
// window.exports.args.enter 只对 mode:'none' 无界面插件生效（ZTools 宿主 shim 实证）。
window.audioBridge = {
  extractFile,
  moveExtractedVideo,
  LOG_FILE
};

// 本地测试导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { collectPaths, probeAudio, parseCodec, parseDuration, codecToExt, extractFile, moveExtractedVideo, checkOutputDuration, findFfmpeg, runFfmpeg, handleHeadless };
}
