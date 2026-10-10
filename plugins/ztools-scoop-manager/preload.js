/**
 * Scoop 包管理器 · preload（ZTools 的 Node 运行环境，CommonJS）
 *
 * 职责：封装 scoop 命令行调用（查询走 JSON 管道，写操作走流式日志）、
 *       输入消毒（应用名/bucket 名最终要拼进 powershell -Command，绝不能放任意字符串进壳）。
 * 页面（index.html）没有 Node，只能通过本文件挂在 window.services 上的函数通信。
 *
 * 为什么查询命令都要套 `| ConvertTo-Json`：
 *   scoop 本身是 PowerShell 脚本，`scoop list` / `scoop status` 等输出的表格
 *   会按宿主控制台宽度自动排版，列宽随内容漂移，还有 ANSI 色码和 WARN 行混排。
 *   实测（本机 scoop v0.6.0）`scoop list | ConvertTo-Json`、`scoop status | ConvertTo-Json`、
 *   `scoop bucket list | ConvertTo-Json`、`scoop search x | ConvertTo-Json`、
 *   `scoop info x | ConvertTo-Json` 都能输出结构化对象，是唯一稳的解析路径。
 *   JSON 之前的输出（"Installed apps:"、git fatal、WARN 行）统一切走 warnings 通道展示。
 */

function ZT() {
  if (typeof window !== 'undefined') return window.ztools || window.utools || {};
  return globalThis.ztools || globalThis.utools || {};
}

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- 持久化（dbStorage 简单键值） ----------
function dbGet(key) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.getItem(key) : null; } catch (e) { return null; }
}
function dbSet(key, val) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.setItem(key, val) : null; } catch (e) { return null; }
}
function dbDel(key) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.removeItem(key) : null; } catch (e) { return null; }
}
const K_SHIMS = 'scoop.shimsDir';   // 用户手动指定的 shims 目录（scoop 不在 PATH 时的兜底）

// ---------- scoop 环境定位 ----------
// 宿主(ZTools)的 PATH 未必包含 scoop 的 shims 目录（比如先装了 scoop 后装的 ZTools
// 且 PATH 没刷新，或 scoop 装在非默认盘）。三层兜底：
//   ① 用户在配置页手动指定的目录（K_SHIMS）
//   ② 常见安装位置扫描（%SCOOP%、%USERPROFILE%\scoop、C:\scoop、D:\scoop）
//   ③ 都没有 → 靠进程自身 PATH 直呼 scoop
// 本插件运行期补装的工具（如 git）目录也追加在这里，见 extraPathDirs。
let extraPathDirs = [];
function configuredShimsDir() {
  const v = String(dbGet(K_SHIMS) || '').trim();
  if (v && fs.existsSync(path.join(v, 'scoop.ps1'))) return v;
  return '';
}
function findExistingShimsDir() {
  const env = process.env || {};
  const candidates = [];
  if (env.SCOOP) candidates.push(env.SCOOP + '\\shims');
  if (env.USERPROFILE) candidates.push(env.USERPROFILE + '\\scoop\\shims');
  candidates.push('C:\\scoop\\shims', 'D:\\scoop\\shims');
  for (const c of candidates) {
    try { if (c && fs.existsSync(path.join(c, 'scoop.ps1'))) return c; } catch (e) {}
  }
  return '';
}
function activeShimsDir() {
  return configuredShimsDir() || findExistingShimsDir();
}
/** 子进程环境：把定位到的 shims 目录插到 PATH 最前，让 `scoop` 一定能被解析 */
function childEnv() {
  const shims = activeShimsDir();
  const parts = extraPathDirs.slice();
  if (shims) parts.push(shims);
  const pre = parts.join(';');
  if (!pre) return process.env;
  return Object.assign({}, process.env, { PATH: pre + ';' + (process.env.PATH || '') });
}

// ---------- 输入消毒 ----------
// 应用名/bucket 名会拼进 powershell -Command 字符串。scoop 官方名集是
// [\w.@-]（如 7zip@16.04、7zip-beta_DoveBoy），超出这个集合的一律拒绝，
// 这是防 PS 注入的唯一防线，不要放宽。
const APP_NAME_RE = /^[\w.@-]{1,100}$/;
const BUCKET_NAME_RE = /^[\w.-]{1,64}$/;
// bucket 来源：远端 git URL、本机/网络路径、或官方短名。scoop bucket add 三种都认。
const URL_RE = /^https?:\/\/\S{1,300}$/;
const LOCAL_PATH_RE = /^[A-Za-z]:[\\/]\S{0,299}$/;

function assertApp(name) {
  const s = String(name || '').trim();
  if (!APP_NAME_RE.test(s)) throw new Error('非法的应用名：' + s);
  return s;
}
function assertBucketName(name) {
  const s = String(name || '').trim();
  if (!BUCKET_NAME_RE.test(s)) throw new Error('非法的 bucket 名：' + s);
  return s;
}
function assertBucketSource(arg) {
  const s = String(arg || '').trim();
  if (BUCKET_NAME_RE.test(s) || URL_RE.test(s) || LOCAL_PATH_RE.test(s)) return s;
  throw new Error('bucket 来源只能是名称、https(s) 链接或本机路径');
}

// ---------- PowerShell 调用 ----------
const PS_BASE = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'];
// 统一前缀：UTF-8 输出 + 关掉进度条（否则 install 会刷 ProgressRecord 噪音）
const PS_PREFIX = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ";

function scoopScript(scoopArgs, { json = false } = {}) {
  const a = scoopArgs.join(' ');
  if (json) return PS_PREFIX + 'scoop ' + a + ' | ConvertTo-Json -Depth 5 -Compress';
  // 流式：合并 stderr 到 stdout 并压平 ErrorRecord，让日志面板按行实时滚动
  return PS_PREFIX + 'scoop ' + a + ' 2>&1 | ForEach-Object { "$_" }';
}

/**
 * 查询类命令：拿到完整输出后抽取 JSON。
 * 返回 { data, warnings } —— warnings 是 JSON 前缀里的告警行
 * （git fatal / "WARN Scoop bucket(s) out of date" 等），页面选择性展示。
 *
 * allowEmpty：结果集可能为空的命令（status 全最新 / search 无结果 / cache 已清空），
 * PowerShell 5.1 对空数组管道 ConvertTo-Json 会输出空串，拿不到任何 JSON——
 * 打开这个开关后按 { data: [], warnings: 全部输出行 } 返回，而不是报错。
 */
function runScoopJson(scoopArgs, { timeout = 150000, allowEmpty = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', PS_BASE.concat(scoopScript(scoopArgs, { json: true })), {
      windowsHide: true,
      env: childEnv()
    });
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      finish(new Error('scoop 查询超时（' + Math.round(timeout / 1000) + 's）'));
    }, timeout);

    function finish(e, val) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      e ? reject(e) : resolve(val);
    }

    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => finish(new Error('无法启动 powershell.exe：' + e.message)));
    child.on('close', (code) => {
      if (done) return;
      try {
        const r = extractJson(out || err);
        finish(null, r);
      } catch (e) {
        if (allowEmpty) {
          // ⚠ stderr 必须一起纳入："命令不存在"类错误走的是错误流（stderr），
          // 只看 stdout 的话 detect 永远看不到报错文本（1.4.2 修了个寂寞，用户实测）
          const raw = String(out || '') + (err ? '\n' + String(err) : '');
          finish(null, {
            data: [],
            warnings: raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(-5),
            empty: true,
            code: code,
            raw: raw
          });
          return;
        }
        // 无 JSON 且退出码非 0：多半是命令本身失败（比如 scoop 不存在）
        finish(new Error(trimLog((out + '\n' + err)) || ('scoop 退出码 ' + code)));
      }
    });
  });
}

/** 从混杂输出中截取 JSON；前缀行作为 warnings 返回 */
function extractJson(text) {
  const lines = String(text || '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    // ⚠ 只认 [ 或 { 开头。带引号的 JSON 标量串（scoop prefix 输出路径）不算——
    // 它走 runScoopText，不进这里；放宽反而会把日志里的引号行误判成数据。
    if (t.startsWith('[') || t.startsWith('{')) { start = i; break; }
  }
  if (start < 0) throw new Error('输出里没有找到 JSON');
  const warnings = [];
  for (let i = 0; i < start; i++) {
    const t = lines[i].trim();
    // "Installed apps:" 这种表头不算告警，git fatal / WARN 才值得给用户看
    if (t && !/^Installed apps:$/.test(t)) warnings.push(t);
  }
  let data;
  try {
    data = JSON.parse(lines.slice(start).join('\n'));
  } catch (e) {
    throw new Error('JSON 解析失败：' + String(e.message).slice(0, 120));
  }
  return { data, warnings };
}

/** scoop 的日期有三种形态：/Date(ms)/、DateTime 本地化串、普通字符串 */
function parseScoopDate(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    const m = /\/Date\((\d+)\)\//.exec(v.value || v.DateTime || '');
    if (m) return Number(m[1]);
    return 0;
  }
  const m = /\/Date\((\d+)\)\//.exec(String(v));
  if (m) return Number(m[1]);
  const t = Date.parse(String(v));
  return isFinite(t) ? t : 0;
}

function trimLog(text) {
  return String(text || '').replace(/\r/g, '').split('\n')
    .map((l) => l.trim()).filter(Boolean).slice(-8).join('\n').slice(0, 800);
}

// ---------- 长任务（install/update/uninstall/cleanup/bucket 增删） ----------
// 全局同时只允许一个写操作：scoop 自己没有并发锁，两个 install 并跑会互相踩缓存。
let currentChild = null;
let currentLabel = '';

/** 通用 PowerShell 流式任务：长命令（装 scoop、install/update）共用，互斥 + 行回调 */
function streamPowerShell(psScript, label, onLine) {
  return new Promise((resolve, reject) => {
    if (currentChild) throw new Error('已有任务在执行：' + currentLabel);
    const child = spawn('powershell.exe', PS_BASE.concat(psScript), {
      windowsHide: true,
      env: childEnv()
    });
    currentChild = child;
    currentLabel = label;
    const lines = [];
    const push = (buf) => {
      String(buf).split(/\r?\n/).forEach((l) => {
        const t = l.trim();
        if (!t) return;
        lines.push(t);
        try { if (onLine) onLine(t); } catch (e) {}
      });
    };
    const finish = (e) => {
      if (currentChild === child) { currentChild = null; currentLabel = ''; }
      e ? reject(e) : resolve({ lines });
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => finish(new Error('无法启动 powershell.exe：' + e.message)));
    child.on('close', (code) => {
      if (code === 0) return finish(null);
      const tail = lines.slice(-6).join('\n');
      finish(new Error(label + ' 失败（退出码 ' + code + '）\n' + tail));
    });
  });
}

function runScoopStream(scoopArgs, label, onLine) {
  return streamPowerShell(scoopScript(scoopArgs), label, onLine);
}

function stopOp() {
  if (currentChild) {
    try { currentChild.kill(); } catch (e) {}
    currentChild = null;
    currentLabel = '';
    return true;
  }
  return false;
}
function isBusy() { return !!currentChild; }
function busyLabel() { return currentLabel; }

// 进程退出兜底：绝不让插件把 powershell/scoop 留成孤儿
try {
  process.on('exit', () => { try { stopOp(); } catch (e) {} });
} catch (e) {}

/**
 * 纯文本命令（scoop prefix）：输出是一个裸路径，不是 JSON，也不该套 ConvertTo-Json。
 * 拿完整输出 trim 后直接返回字符串。
 */
function runScoopText(scoopArgs, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', PS_BASE.concat(PS_PREFIX + 'scoop ' + scoopArgs.join(' ')), {
      windowsHide: true,
      env: childEnv()
    });
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      finish(new Error('scoop 查询超时'));
    }, timeout);
    function finish(e, val) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      e ? reject(e) : resolve(val);
    }
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => finish(new Error('无法启动 powershell.exe：' + e.message)));
    child.on('close', (code) => {
      if (done) return;
      const text = (out || err).trim();
      if (!text) return finish(new Error('scoop 没有输出（退出码 ' + code + '）'));
      finish(null, text.split(/\r?\n/)[0].trim());   // 只取第一行，防末尾混入告警
    });
  });
}

// ---------- 业务查询 ----------
/**
 * 环境检测（启动时调用）。不再抛异常——检测结果交给页面分流：
 * ok=true 进主界面，ok=false 进配置页。detectInfo 里带上定位到的 shims 目录，
 * 配置页据此区分「装了但不在 PATH」和「没装」。
 */
/** 判定输出是否是"scoop 命令不存在"类错误（中英文 PowerShell 都覆盖） */
function looksLikeCommandNotFound(text) {
  return /is not recognized|不被识别|无法将.*识别为|is not an internal or external command|CommandNotFoundException|不是内部或外部命令/i.test(String(text || ''));
}

/**
 * 根据 --version 的结果分类：'online' | 'not-found'（纯函数，好测）。
 * - 有 JSON 数据 / 输出里有版本号 → 在线（新装无 git 的机器属于这种，版本行在宿主流）；
 * - 空结果 + 命令不存在报错 → 未安装；
 * - 空结果 + 退出码非 0 + 连版本号都没有 → 也判未安装（覆盖未知体裁的报错）。
 */
function classifyDetect(r) {
  const text = Array.isArray(r.data) ? r.data.join('\n') : String(r.data || '');
  const all = text + '\n' + (r.warnings || []).join('\n') + '\n' + (r.raw || '');
  const versionFound = /v\d+\.\d+\.\d+/.test(all);
  if (r.empty && (looksLikeCommandNotFound(all) || (r.code !== 0 && !versionFound))) {
    return 'not-found';
  }
  return 'online';
}

async function detect() {
  let r;
  try {
    // ⚠ 必须 allowEmpty：刚装好的机器上没有 git，scoop --version 的 bucket 摘要
    // 管道输出为空，PowerShell 5.1 空数组 | ConvertTo-Json 是空串——
    // 没有这个开关，新装机第一次检测就会误判"scoop 不可用"（实测踩坑）。
    // 版本号在宿主流的 warnings 里，照样能拿到。
    r = await runScoopJson(['--version'], { timeout: 30000, allowEmpty: true });
  } catch (e) {
    return {
      ok: false,
      reason: String(e && e.message || e),
      shims: activeShimsDir(),
      configured: configuredShimsDir(),
      autoFound: findExistingShimsDir()
    };
  }
  // ⚠ allowEmpty 的代价：连"命令不存在"也会走空结果通道（用户实测：卸载 scoop 后
  // 徽标显示 v未知版本还进了主界面）。分类判定见 classifyDetect。
  if (classifyDetect(r) === 'not-found') {
    return {
      ok: false,
      reason: 'scoop 命令不存在（可能已被卸载，或 shims 不在 PATH）',
      shims: activeShimsDir(),
      configured: configuredShimsDir(),
      autoFound: findExistingShimsDir()
    };
  }
  const text = Array.isArray(r.data) ? r.data.join('\n') : String(r.data || '');
  const all = text + '\n' + (r.warnings || []).join('\n') + '\n' + (r.raw || '');
  // ⚠ 这版 scoop 的 --version 有两个坑：
  // ① 版本行（"v0.6.0 - Released at ..."）走 Write-Host 直达宿主流，不在管道里，
  //    所以 ConvertTo-Json 拿不到它，只能从 warnings 前缀里捞；
  // ② 管道里反而是各 bucket 的更新摘要（如 "tombi: Update to version 1.6.1"），
  //    宽松的 \d+\.\d+\.\d+ 会把 1.6.1 当成 scoop 版本，必须锚定 v 前缀。
  const m = /v(\d+\.\d+\.\d+)/.exec(all);
  const shims = activeShimsDir();
  return {
    ok: true,
    version: m ? m[1] : '未知版本',
    raw: text,
    warnings: r.warnings,
    shims: shims,
    configured: configuredShimsDir(),
    autoFound: findExistingShimsDir(),
    root: shims ? path.dirname(shims) : ''
  };
}

// ---------- 环境配置（无 scoop 机器的自举） ----------
// 常见本地代理端口（与 ztools-weather 同一套探测清单，顺序按实际命中率排）。
// 直连 github.com 不通时，装 Scoop 会自动逐个试这些代理。
const LOCAL_PROXY_CANDIDATES = [
  'http://127.0.0.1:7891', 'http://127.0.0.1:7897', 'http://127.0.0.1:7890',
  'http://127.0.0.1:10809', 'http://127.0.0.1:1080'
];

// 国内加速镜像：scoop.201704.xyz 是社区 GitHub 反代（本插件用户的 apps bucket
// 也在用同一服务）。用法是在原 GitHub URL 前拼上前缀。
// 实测：https://scoop.201704.xyz/https://github.com/ScoopInstaller/Scoop/archive/master.zip
// 返回 HTTP 200 + PK 魔数，可用；而 Gitee 的 archive zip 已全面 404，不能用。
const MIRROR_PREFIX = 'https://scoop.201704.xyz/';

/**
 * 组装一次安装尝试的 PowerShell 脚本。
 * @param proxy '' = 直连；'http://127.0.0.1:xxxx' = 走该代理
 * @param mirror true = 官方安装器 + 把脚本内 GitHub 下载地址打上镜像前缀补丁，
 *        并在 get.scoop.sh 拉不到时改从镜像代理拉安装器本体
 */
function installScript(proxy, mirror) {
  const proxyArgs = proxy ? " -Proxy '" + proxy + "'" : '';
  const fetchInstaller = mirror
    ? // get.scoop.sh 挂了就走镜像代理拉 raw install.ps1（双保险）
      'try { irm get.scoop.sh -OutFile $installer' + proxyArgs + ' } catch { irm "' +
      MIRROR_PREFIX + 'https://raw.githubusercontent.com/ScoopInstaller/Install/master/install.ps1" -OutFile $installer' + proxyArgs + ' }'
    : 'irm get.scoop.sh -OutFile $installer' + proxyArgs;
  // 给安装器内部所有单引号包裹的 GitHub 地址加镜像前缀——正好覆盖
  // $SCOOP_PACKAGE_REPO / $SCOOP_MAIN_BUCKET_REPO / 两个 .git 仓库地址（实测它们就是
  // 下载失败的地方），注释和提示文案里的裸 URL 不受影响。
  const patch = mirror
    ? '$t = [IO.File]::ReadAllText($installer); ' +
      "$t = $t.Replace(\"'https://github.com/\", \"'" + MIRROR_PREFIX + "https://github.com/\"); " +
      '[IO.File]::WriteAllText($installer, $t, [Text.UTF8Encoding]::new($true)); '
    : '';
  return PS_PREFIX +
    // ⚠ PS5.1 的 .NET 默认不开 TLS 1.2，而 GitHub 强制要求——
    // "基础连接已经关闭: 发送时发生错误" 十有八九是它
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ' +
    // 执行策略覆盖告警是语句终止错误，-ErrorAction 压不住，必须 try/catch（实测）
    'try { Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force -ErrorAction Stop } catch {}; ' +
    '$admin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())' +
    '.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); ' +
    '$installer = Join-Path $env:TEMP "ztools-scoop-install.ps1"; ' +
    fetchInstaller + '; ' +
    patch +
    'if ($admin) { & $installer -RunAsAdmin' + proxyArgs + ' } else { & $installer' + proxyArgs + ' }';
}

/** 上次安装半途而废会在 %USERPROFILE%\scoop 留下残骸，下次再装会被
 * "exists and is not empty" 挡住（实测踩坑）。改名为 .bak-时间戳 保底不删。 */
function renamePartialScoopDir(onLine) {
  const up = (process.env.USERPROFILE || '').trim();
  if (!up) return;
  const dir = path.join(up, 'scoop');
  try {
    if (!fs.existsSync(dir)) return;
    // 里面已经有完整的 shims 结构 → 其实是可用的 scoop，不能动
    if (fs.existsSync(path.join(dir, 'shims', 'scoop.ps1'))) return;
    const bak = dir + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(dir, bak);
    try { onLine('>> 检测到上次失败留下的 ' + dir + '，已改名为 ' + bak + '（没有删除）'); } catch (e) {}
  } catch (e) {
    try { onLine('>> 残留目录改名失败（不继续挡路就不管）：' + (e && e.message)); } catch (e2) {}
  }
}

/** TCP 探测本地代理端口是否在监听，800ms 不通就算关 */
function portOpen(proxy, timeout = 800) {
  return new Promise((resolve) => {
    const net = require('net');
    let u;
    try { u = new URL(proxy); } catch (e) { return resolve(false); }
    const sock = net.connect(Number(u.port) || 80, u.hostname);
    const done = (ok) => { try { sock.destroy(); } catch (e) {} resolve(ok); };
    const timer = setTimeout(() => done(false), timeout);
    sock.once('connect', () => { clearTimeout(timer); done(true); });
    sock.once('error', () => { clearTimeout(timer); done(false); });
  });
}

/**
 * 一键安装 Scoop。尝试顺序（每次都以「能否定位到 scoop.ps1」收口，绝不信任退出码）：
 *   ① 官方安装器 + GitHub 下载地址打镜像前缀（国内直连，无需梯子）
 *   ② 官方源直连（TLS 1.2 修好后有概率直接通）
 *   ③ 本机在监听的代理端口 + 官方源
 */
async function installScoop(onLine) {
  // 已有可用的 scoop 就不折腾安装了，直接登记并返回
  const existing = findExistingShimsDir();
  if (existing) {
    dbSet(K_SHIMS, existing);
    try { onLine('>> 本机已有可用的 scoop（' + existing + '），跳过安装'); } catch (e) {}
    return { shims: existing };
  }
  renamePartialScoopDir(onLine);

  const proxies = [];
  for (const p of LOCAL_PROXY_CANDIDATES) {
    if (await portOpen(p)) proxies.push(p);
  }
  const attempts = [
    { mirror: true, proxy: '', label: '安装 Scoop（国内镜像）' },
    { mirror: false, proxy: '', label: '安装 Scoop（官方源直连）' }
  ].concat(proxies.map((p) => ({ mirror: false, proxy: p, label: '安装 Scoop（代理 ' + p + '）' })));

  let lastErr = null;
  for (const a of attempts) {
    try { onLine('>> 尝试：' + a.label); } catch (e) {}
    try {
      await streamPowerShell(installScript(a.proxy, a.mirror), a.label, onLine);
      const found = findExistingShimsDir();
      if (found) {
        dbSet(K_SHIMS, found);
        return { shims: found };
      }
      lastErr = new Error('安装脚本执行完了，但没有找到 scoop（shims 未生成）');
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    '所有安装方式都失败了（国内镜像 / 官方直连' + (proxies.length ? ' / 本机代理' : '，且本机没探测到在运行的代理') +
    '）。最后一次错误：' + (lastErr && lastErr.message ? lastErr.message.split('\n')[0] : lastErr)
  );
}

/** 手动选择已有的 shims 目录（scoop 装在非默认位置且不在 PATH 时的兜底） */
function pickShimsDir() {
  const z = ZT();
  if (!z.showOpenDialog) throw new Error('宿主不支持打开目录选择器');
  let picked = z.showOpenDialog({
    title: '选择 scoop 的 shims 目录（里面应有 scoop.ps1）',
    properties: ['openDirectory']
  });
  if (picked && !Array.isArray(picked) && picked.filePaths) picked = picked.filePaths;
  const dir = Array.isArray(picked) ? picked[0] : picked;
  if (!dir) return null;   // 用户取消
  if (!fs.existsSync(path.join(dir, 'scoop.ps1'))) {
    throw new Error('该目录下没有 scoop.ps1——请选择 shims 目录，例如 D:\\scoop\\shims');
  }
  dbSet(K_SHIMS, dir);
  return dir;
}
function clearShimsDir() { dbDel(K_SHIMS); return true; }
/** 配置页展示用：当前的自定义配置与扫描结果 */
function getSetupInfo() {
  return {
    configured: configuredShimsDir(),
    configuredRaw: String(dbGet(K_SHIMS) || ''),
    autoFound: findExistingShimsDir()
  };
}

/** 已安装列表。Info 列可能是 "Global install"、"Held package"、"Install failed" 等，原样带给页面标色 */
async function installed() {
  const r = await runScoopJson(['list']);
  const arr = Array.isArray(r.data) ? r.data : [];
  const seen = {};
  const apps = [];
  for (const x of arr) {
    const row = {
      name: String(x.Name || ''),
      version: String(x.Version || ''),
      source: String(x.Source || ''),
      updated: parseScoopDate(x.Updated),
      info: String(x.Info || '')
    };
    if (!row.name) continue;
    // 实测同一行会整条重复（scoop 的安装记录库里有冗余），完全相同的只留一条；
    // 同名不同 info 的（全局+用户各装一份）是真实状态，保留。
    const key = [row.name, row.version, row.source, row.info].join('|');
    if (seen[key]) continue;
    seen[key] = 1;
    apps.push(row);
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return { apps, warnings: r.warnings };
}

/** 可更新清单 + 异常包（Manifest removed / Install failed）。全部最新时输出为空，须 allowEmpty */
async function status() {
  const r = await runScoopJson(['status'], { timeout: 240000, allowEmpty: true });
  const arr = Array.isArray(r.data) ? r.data : [];
  const seen = {};
  const outdated = [];
  const broken = [];
  for (const x of arr) {
    const name = String(x.Name || '');
    if (!name || seen[name]) continue;   // 实测偶发整表重复，按名去重
    seen[name] = true;
    const item = {
      name,
      installed: String(x['Installed Version'] || ''),
      latest: String(x['Latest Version'] || ''),
      missing: String(x['Missing Dependencies'] || ''),
      info: String(x.Info || '')
    };
    if (item.info.indexOf('removed') >= 0 || item.info.indexOf('Install failed') >= 0) broken.push(item);
    else outdated.push(item);
  }
  return { outdated, broken, warnings: r.warnings };
}

async function searchApps(keyword) {
  const q = String(keyword || '').trim();
  if (!q) return { results: [], warnings: [] };
  if (!/^[\w.@ -]{1,60}$/.test(q)) throw new Error('搜索词只能包含字母、数字、空格和 . @ _ -');
  const r = await runScoopJson(['search', q], { timeout: 240000, allowEmpty: true });
  const arr = Array.isArray(r.data) ? r.data : [];
  const seen = {};
  const results = [];
  for (const x of arr) {
    const name = String(x.Name || '');
    if (!name || seen[name + '|' + x.Source]) continue;
    seen[name + '|' + x.Source] = true;
    results.push({
      name,
      version: String(x.Version || ''),
      source: String(x.Source || ''),
      binaries: String(x.Binaries || '')
    });
  }
  return { results, warnings: r.warnings };
}

async function infoApp(name) {
  const app = assertApp(name);
  const r = await runScoopJson(['info', app], { timeout: 60000 });
  const d = (r.data && !Array.isArray(r.data)) ? r.data : {};
  const flat = {};
  Object.keys(d).forEach((k) => {
    let v = d[k];
    if (v && typeof v === 'object') v = v.DateTime || v.value || JSON.stringify(v);
    if (Array.isArray(v)) v = v.join(', ');
    flat[k] = v == null ? '' : String(v);
  });
  return { info: flat, warnings: r.warnings };
}

async function listBuckets() {
  const r = await runScoopJson(['bucket', 'list']);
  const arr = Array.isArray(r.data) ? r.data : [];
  return {
    buckets: arr.map((b) => ({
      name: String(b.Name || ''),
      source: String(b.Source || ''),
      updated: parseScoopDate(b.Updated),
      manifests: Number(b.Manifests) || 0
    })),
    warnings: r.warnings
  };
}

async function cacheInfo() {
  // 输出形如：前缀行 "Total: 240 files, 30.2 GB" + JSON 数组；
  // 缓存为空时连 JSON 数组都没有（空数组 | ConvertTo-Json 输出空串），须 allowEmpty
  const r = await runScoopJson(['cache', 'show'], { allowEmpty: true });
  const totalLine = (r.warnings.concat()).reverse().find((l) => /^Total:/.test(l)) || '';
  const m = /Total:\s*(\d+)\s*files?,\s*([0-9.]+\s*[KMG]B?)/.exec(totalLine);
  const arr = Array.isArray(r.data) ? r.data : [];
  const byApp = {};
  for (const x of arr) {
    const name = String(x.Name || '');
    if (!name) continue;
    if (!byApp[name]) byApp[name] = { name, files: 0, bytes: 0 };
    byApp[name].files += 1;
    byApp[name].bytes += Number(x.Length) || 0;
  }
  return {
    total: { files: m ? Number(m[1]) : arr.length, sizeText: m ? m[2] : '' },
    apps: Object.values(byApp).sort((a, b) => b.bytes - a.bytes),
    warnings: r.warnings
  };
}

/** 应用安装目录（scoop prefix），用于"打开目录"。输出是裸路径，走纯文本通道 */
async function prefixOf(name) {
  const app = assertApp(name);
  const p = await runScoopText(['prefix', app]);
  return p;
}

// ---------- 清单镜像化（解决"装软件"这一层的网络问题） ----------
// bucket 加好后，清单里的下载地址仍是硬编码的 GitHub（releases/raw 等），
// 没梯子的机器会死在下载上（实测：aria2 → "远程主机强迫关闭了一个现有的连接"）。
// 方案：读本地 bucket 里的清单 → 深度遍历把 GitHub 地址打上镜像前缀 →
// 用改好的本地清单执行 scoop install（scoop 原生支持按路径装清单）。
// 镜像代理的是原字节流，hash 校验不受影响；非 GitHub 地址一律不动。
const GITHUB_URL_PREFIXES = [
  'https://github.com/',
  'https://raw.githubusercontent.com/',
  'https://objects.githubusercontent.com/',
  'https://codeload.github.com/',
  'https://api.github.com/'
];

function mirrorize(s) {
  for (const p of GITHUB_URL_PREFIXES) {
    if (s.indexOf(p) === 0) return MIRROR_PREFIX + s;
  }
  return s;
}

function deepMirrorize(v) {
  if (typeof v === 'string') return mirrorize(v);
  if (Array.isArray(v)) return v.map(deepMirrorize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepMirrorize(v[k]);
    return out;
  }
  return v;
}

function bucketsRoot() {
  const shims = activeShimsDir();
  if (shims) return path.join(path.dirname(shims), 'buckets');
  const env = process.env || {};
  const roots = [];
  if (env.SCOOP) roots.push(env.SCOOP);
  if (env.USERPROFILE) roots.push(env.USERPROFILE + '\\scoop');
  roots.push('C:\\scoop', 'D:\\scoop');
  for (const r of roots) {
    try { if (fs.existsSync(path.join(r, 'buckets'))) return path.join(r, 'buckets'); } catch (e) {}
  }
  return '';
}

/** 在所有本地 bucket 里找应用的清单文件（标准布局：buckets/<名>/bucket/<app>.json 或根目录） */
function findManifestFile(app) {
  const root = bucketsRoot();
  if (!root) return '';
  let buckets = [];
  try {
    buckets = fs.readdirSync(root).filter((d) => {
      try { return fs.statSync(path.join(root, d)).isDirectory(); } catch (e) { return false; }
    });
  } catch (e) { return ''; }
  for (const b of buckets) {
    for (const sub of ['bucket', '']) {
      const p = path.join(root, b, sub, app + '.json');
      try { if (fs.existsSync(p)) return p; } catch (e) {}
    }
  }
  return '';
}

/**
 * 就地临时镜像化 bucket 清单，返回 { path, changed, restore }。
 *
 * ⚠ 为什么不能像 1.4.0 那样把改好的清单写到临时目录再 `scoop install <path>`：
 * 清单里的 post_install 脚本会引用 bucket 相对资源（实测 7zip：
 * "$bucketsdir\$bucket\scripts\7-zip"），从临时目录安装时 scoop 不知道 bucket 归属，
 * $bucket 为空 → 路径解析成 buckets\scripts\7-zip → 脚本报"找不到路径"。
 * 就地改写则 bucket 上下文原样保留，一切按正常安装路径走。
 *
 * 安全性：原始内容先备份为 <原路径>.ztools-bak，restore() 用备份精确还原并删备份；
 * install/update 的 finally 里必调 restore。若上次运行中途崩溃留下备份，
 * 下一次调用会先检测并还原，bucket 的 git 工作区不会长期处于脏状态。
 */
function patchManifestInPlace(app) {
  const src = findManifestFile(app);
  if (!src) return { path: '', changed: false, restore: null };
  const backup = src + '.ztools-bak';
  // 崩溃残留恢复：有备份说明上次没还原完，先还原再继续
  try {
    if (fs.existsSync(backup)) fs.copyFileSync(backup, src);
  } catch (e) {}
  let original;
  try {
    original = fs.readFileSync(src, 'utf8');
  } catch (e) { return { path: src, changed: false, restore: null }; }
  let obj;
  try { obj = JSON.parse(original); } catch (e) { return { path: src, changed: false, restore: null }; }
  const patched = JSON.stringify(deepMirrorize(obj), null, 2);
  if (patched === original.trim() || patched === original) {
    return { path: src, changed: false, restore: null };   // 清单里没有 GitHub 地址，不用动
  }
  try {
    fs.writeFileSync(backup, original, 'utf8');
    fs.writeFileSync(src, patched, 'utf8');
  } catch (e) { return { path: src, changed: false, restore: null }; }
  const restore = () => {
    try {
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, src);
        fs.unlinkSync(backup);
      }
    } catch (e) { /* 还原失败不能打断主流程 */ }
  };
  return { path: src, changed: true, restore: restore };
}

// ---------- 写操作（全部流式日志） ----------
/**
 * bucket add 参数构造（纯函数，好测）。
 * ⚠ 1.3.2 的教训：chips 改传国内源时把 bucket 名字弄丢了，实际执行成
 * `scoop bucket add <URL>`，scoop 把 URL 当已知 bucket 别名去查，
 * 报 "Unknown bucket ... Try specifying <repo>"（用户实测日志实锤）。
 * 名字和源必须都传：scoop bucket add <name> <repo>
 */
function bucketAddArgs(name, source) {
  const n = assertBucketName(name);
  if (source && source !== n) return ['add', n, assertBucketSource(source)];
  return ['add', n];
}
/**
 * 安装：就地临时镜像化 bucket 清单（装完自动还原），再正常 `scoop install <app>`。
 * 清单里没有 GitHub 地址时不动文件；应用不在任何本地 bucket 时退回普通安装。
 */
const install = async (app, onLine) => {
  const a = assertApp(app);
  const ctx = patchManifestInPlace(a);
  try {
    if (ctx.changed) {
      try { onLine('>> 清单下载地址已临时镜像化（GitHub → ' + MIRROR_PREFIX.trim() + '），装完自动还原'); } catch (e) {}
    }
    return await runScoopStream(['install', a], '安装 ' + a, onLine);
  } finally {
    if (ctx.restore) {
      ctx.restore();
      try { onLine('>> 已还原原始清单'); } catch (e) {}
    }
  }
};
const uninstall = (app, purge, onLine) =>
  runScoopStream(['uninstall', assertApp(app)].concat(purge ? ['-p'] : []), '卸载 ' + app, onLine);
/** 更新：先走 scoop update；失败（如 GitHub 下载被墙）时就地镜像化清单后强制重装。
 * 「已经是最新版」时 scoop update 正常返回，不会触发兜底。 */
const updateApp = async (app, onLine) => {
  const a = app === '*' ? '*' : assertApp(app);
  try {
    return await runScoopStream(['update'].concat(a === '*' ? ['*'] : [a]), '更新 ' + a, onLine);
  } catch (e) {
    if (a === '*') throw e;   // 批量更新不做兜底，逐个失败的信息都在日志里
    const ctx = patchManifestInPlace(a);
    if (!ctx.changed) throw e;
    try { onLine('>> 直接更新失败，清单已临时镜像化，强制安装新版本'); } catch (e2) {}
    try {
      return await runScoopStream(['install', a, '-f'], '更新 ' + a + '（镜像清单）', onLine);
    } finally {
      ctx.restore();
      try { onLine('>> 已还原原始清单'); } catch (e3) {}
    }
  }
};
const updateScoop = (onLine) => runScoopStream(['update'], '更新 Scoop 与 bucket', onLine);
// ---------- git 保障（bucket 管理的硬依赖） ----------
// scoop 源码 add_bucket 第一行就是 Test-GitAvailable，没 git 直接
// "Git is required for buckets"。而镜像安装的 scoop 是 zip 解包的，全新机器没有
// git——加 bucket 前必须保障 git。装法走 npmmirror 的 git-for-windows 国内 CDN，
// 同样不依赖梯子。
function gitAvailable() {
  return new Promise((resolve) => {
    const child = spawn('git.exe', ['--version'], { env: childEnv(), windowsHide: true });
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; try { child.kill(); } catch (e) {} resolve(ok); } };
    const timer = setTimeout(() => done(false), 10000);
    child.on('error', () => { clearTimeout(timer); done(false); });
    child.on('close', (code) => { clearTimeout(timer); done(code === 0); });
  });
}

/** git 静默安装脚本：npmmirror 列出版本 → 选最新稳定版 64 位 → 下载 → InnoSetup 静默装。
 * 用数组 join 而不是长串拼接：PS 引号转义太密，分行可读可测。 */
function ensureGitScript() {
  return [
    PS_PREFIX,
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ',
    "$list = irm 'https://registry.npmmirror.com/-/binary/git-for-windows/'; ",
    "$ver = $list | ForEach-Object { $_.name } | ",
      "Where-Object { $_ -match '^v(\\d+\\.\\d+\\.\\d+)\\.windows\\.\\d+/$' } | ",
      "Sort-Object { [version]($_.TrimEnd('/').TrimStart('v') -replace '\\.windows\\.\\d+$', '') } -Descending | ",
      'Select-Object -First 1; ',
    "if (!$ver) { throw 'npmmirror 上没有找到可用的 git 版本' }; ",
    "$exeName = ($ver.TrimEnd('/') -replace '^v', 'Git-') -replace '\\.windows\\.\\d+$', ''; ",
    '$url = "https://registry.npmmirror.com/-/binary/git-for-windows/" + $ver + $exeName + "-64-bit.exe"; ',
    'Write-Output ("下载 " + $url); ',
    '$dst = Join-Path $env:TEMP ($exeName + "-64-bit.exe"); ',
    'irm $url -OutFile $dst; ',
    'Write-Output "开始静默安装（约 1 分钟，请稍候）…"; ',
    "Start-Process -FilePath $dst -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait; ",
    'Write-Output "安装程序执行完毕"; '
  ].join('');
}

/** 装完 git 后扫常见安装位置，把 git\cmd 注入子进程 PATH */
function locateGitAndPatchPath() {
  const candidates = [
    'C:\\Program Files\\Git\\cmd',
    'C:\\Program Files (x86)\\Git\\cmd',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd')
  ];
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(path.join(c, 'git.exe'))) {
        if (extraPathDirs.indexOf(c) < 0) extraPathDirs.push(c);
        return c;
      }
    } catch (e) {}
  }
  return '';
}

/** 确保 git 可用；没有就自动装（npmmirror 镜像）。失败抛错由调用方兜底 */
async function ensureGit(onLine) {
  if (await gitAvailable()) return true;
  try { onLine('>> 未检测到 git（bucket 管理的硬依赖），从 npmmirror 镜像自动安装…'); } catch (e) {}
  locateGitAndPatchPath();
  if (await gitAvailable()) return true;
  await streamPowerShell(ensureGitScript(), '安装 git', onLine);
  const dir = locateGitAndPatchPath();
  if (!(await gitAvailable())) {
    throw new Error('git 安装程序执行完了但仍检测不到 git（安装位置没找到 git.exe）。' +
      '可以手动安装 git 后重试，或把 git\\cmd 目录加进系统 PATH');
  }
  try { onLine('>> git 就绪（' + dir + '）'); } catch (e) {}
  return true;
}

const addBucket = async (name, source, onLine) => {
  await ensureGit(onLine);
  return runScoopStream(['bucket'].concat(bucketAddArgs(name, source)), '添加 bucket ' + name, onLine);
};
const removeBucket = (name, onLine) => runScoopStream(['bucket', 'rm', assertBucketName(name)], '移除 bucket ' + name, onLine);
const clearCache = (onLine) => runScoopStream(['cache', 'rm', '*'], '清空下载缓存', onLine);
const cleanup = (onLine) => runScoopStream(['cleanup', '*'], '清理旧版本', onLine);
const holdApp = (app, hold, onLine) =>
  runScoopStream([hold ? 'hold' : 'unhold', assertApp(app)], (hold ? '锁定 ' : '解锁 ') + app, onLine);

// ---------- 系统能力转发 ----------
function openUrl(url) {
  const z = ZT();
  if (!/^https?:\/\//.test(String(url || ''))) throw new Error('非法链接');
  if (z.shellOpenExternal) return z.shellOpenExternal(url);
  return null;
}
function openPath(p) {
  const z = ZT();
  if (z.shellOpenPath) return z.shellOpenPath(p);
  return null;
}
function notify(body) {
  const z = ZT();
  if (z.showNotification) return z.showNotification(String(body || ''));
  if (z.showToast) return z.showToast(String(body || ''));
  return null;
}
function copy(text) {
  const z = ZT();
  if (z.copyText) return z.copyText(String(text || ''));
  return null;
}
function theme() {
  const z = ZT();
  try {
    if (typeof z.isDarkColors === 'function') return { isDark: !!z.isDarkColors(), source: 'ztools' };
  } catch (e) {}
  return { isDark: false, source: 'default' };
}
function onThemeChange(cb) {
  const z = ZT();
  if (typeof z.onThemeChange === 'function') { try { z.onThemeChange(cb); return true; } catch (e) { return false; } }
  return false;
}

// ---------- 暴露给页面 ----------
const services = {
  detect, installed, status, searchApps, infoApp, listBuckets, cacheInfo, prefixOf,
  install, uninstall, updateApp, updateScoop, addBucket, removeBucket, clearCache, cleanup, holdApp,
  installScoop, installScript, LOCAL_PROXY_CANDIDATES, MIRROR_PREFIX, portOpen,
  bucketAddArgs, ensureGitScript, gitAvailable, ensureGit,
  mirrorize, deepMirrorize, findManifestFile, patchManifestInPlace, bucketsRoot,
  pickShimsDir, clearShimsDir, getSetupInfo,
  stopOp, isBusy, busyLabel,
  openUrl, openPath, notify, copy, theme, onThemeChange,
  // 纯函数也暴露出去，页面做"已装标记/时间格式化"时直接复用
  parseScoopDate, extractJson, assertApp, looksLikeCommandNotFound, classifyDetect
};

if (typeof window !== 'undefined') {
  // 与 weather 插件同款双保险：优先 contextBridge，挂不上就直接挂 window
  var exposedBridge = false;
  try {
    var bridge = window.contextBridge;
    if (bridge && typeof bridge.exposeInMainWorld === 'function') {
      bridge.exposeInMainWorld('services', services);
      exposedBridge = true;
    }
  } catch (e) { /* 走下方兜底 */ }
  if (!exposedBridge) {
    try { window.services = services; } catch (e) { /* ignore */ }
  }
  // ⚠ 不要写 mode:'none'：宿主会把 'none' 当无界面插件处理，界面高度为 0 表现为打不开。
  // weather 插件踩过这个坑（详见 ztools-weather/preload.js 尾部注释），这里固定 'web'。
  try {
    window.exports = {
      'scoop': { mode: 'web', args: { enter() { try { if (ZT().setExpendHeight) ZT().setExpendHeight(620); } catch (e) {} }, leave() {} } }
    };
  } catch (e) { /* ignore */ }
}

module.exports = services;
