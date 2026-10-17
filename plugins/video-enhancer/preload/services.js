const { spawn, exec, execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const activeJobs = new Map();
const USER_DATA_DIR = path.join(os.homedir(), '.ztools-video-enhancer');
const DEFAULT_ENGINE_DIR = path.join(USER_DATA_DIR, 'engine');

/**
 * 自动扫描并清理超过 2 小时的非正常退出遗留的孤儿临时目录
 */
function cleanOrphanTmpDirs() {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) return;
    const items = fs.readdirSync(USER_DATA_DIR);
    const now = Date.now();
    for (const item of items) {
      if (item.startsWith('job_')) {
        const full = path.join(USER_DATA_DIR, item);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory() && (now - stat.mtimeMs > 2 * 3600 * 1000)) {
            fs.rmSync(full, { recursive: true, force: true });
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
}

/**
 * 全场景多区域智能去水印滤镜构建器
 * 支持：右下角、右上角、左下角、左上角、双角标(右上+右下)、底部通栏字幕栏、顶部通栏
 */
function buildWatermarkFilters(width, height, position) {
  if (!width || !height || width <= 0 || height <= 0) return [];
  const filters = [];

  const addDelogo = (x, y, w, h) => {
    // 边界安全防护，杜绝 FFmpeg 坐标越界报错
    const safeX = Math.max(0, Math.min(Math.round(x), width - 10));
    const safeY = Math.max(0, Math.min(Math.round(y), height - 10));
    const safeW = Math.max(10, Math.min(Math.round(w), width - safeX));
    const safeH = Math.max(10, Math.min(Math.round(h), height - safeY));
    filters.push(`delogo=x=${safeX}:y=${safeY}:w=${safeW}:h=${safeH}:show=0`);
  };

  const padX = Math.round(width * 0.02);
  const padY = Math.round(height * 0.02);

  if (position === 'bottom-right') {
    // 1. 右下角 (Sora / 剪映 / 微博 / 快手)
    const w = Math.round(width * 0.16);
    const h = Math.round(height * 0.08);
    addDelogo(width - w - padX, height - h - padY, w, h);
  } else if (position === 'top-right') {
    // 2. 右上角 (B站 / 网页录屏 / 电视台标)
    const w = Math.round(width * 0.16);
    const h = Math.round(height * 0.08);
    addDelogo(width - w - padX, padY, w, h);
  } else if (position === 'bottom-left') {
    // 3. 左下角 (小红书 / 抖音用户ID标识)
    const w = Math.round(width * 0.16);
    const h = Math.round(height * 0.08);
    addDelogo(padX, height - h - padY, w, h);
  } else if (position === 'top-left') {
    // 4. 左上角 (视频台标 / 官方徽标)
    const w = Math.round(width * 0.16);
    const h = Math.round(height * 0.08);
    addDelogo(padX, padY, w, h);
  } else if (position === 'both-right') {
    // 5. 双角标：右上 + 右下 (全平台多水印链式消除)
    const w1 = Math.round(width * 0.16), h1 = Math.round(height * 0.08);
    addDelogo(width - w1 - padX, padY, w1, h1); // 右上
    const w2 = Math.round(width * 0.16), h2 = Math.round(height * 0.08);
    addDelogo(width - w2 - padX, height - h2 - padY, w2, h2); // 右下
  } else if (position === 'bottom-bar') {
    // 6. 底部通栏 (字幕与滚动广告栏消除)
    const h = Math.round(height * 0.13); // 消除底部 13% 通栏
    addDelogo(0, height - h, width, h);
  } else if (position === 'top-bar') {
    // 7. 顶部通栏 (顶部标题与滚动跑马灯消除)
    const h = Math.round(height * 0.09); // 消除顶部 9% 通栏
    addDelogo(0, 0, width, h);
  } else {
    // 兜底：默认右下角
    const w = Math.round(width * 0.16);
    const h = Math.round(height * 0.08);
    addDelogo(width - w - padX, height - h - padY, w, h);
  }

  if (filters.length === 0) return [];
  return ['-vf', filters.join(',')];
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function checkCommandExists(cmd) {
  return new Promise((resolve) => {
    if (!cmd || typeof cmd !== 'string') return resolve(false);
    if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
      try { resolve(fs.existsSync(cmd)); } catch (e) { resolve(false); }
      return;
    }
    const checkCmd = process.platform === 'win32' ? `where "${cmd}"` : `which "${cmd}"`;
    exec(checkCmd, (err) => resolve(!err));
  });
}

function runCmd(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: cwd || undefined });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`Exit ${code}: ${err || out}`));
    });
  });
}

/**
 * 全平台深度探测真实 GPU 显卡型号与显存容量
 */
function detectGpuDevice() {
  const platform = process.platform;
  let gpuName = '未知显卡设备';
  let vramGB = 0;
  let isDedicated = false;
  let isIntegrated = true;

  try {
    if (platform === 'darwin') {
      // macOS: 通过 system_profiler 获取显卡信息
      const raw = execSync('system_profiler SPDisplaysDataType 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      const modelMatch = raw.match(/Chipset Model:\s*(.+)/i);
      if (modelMatch && modelMatch[1]) {
        gpuName = modelMatch[1].trim();
      }
      const vramMatch = raw.match(/VRAM(?: \(Total\))?:\s*(\d+)\s*(GB|MB)/i);
      if (vramMatch) {
        const val = parseInt(vramMatch[1], 10);
        vramGB = vramMatch[2].toUpperCase() === 'GB' ? val : parseFloat((val / 1024).toFixed(1));
      }

      // Apple Silicon 特性：统一内存架构
      if (gpuName.includes('Apple M')) {
        isDedicated = true; // 具备媲美独显的高吞吐 GPU 核心
        isIntegrated = false;
        const totalMemGB = os.totalmem ? Math.round(os.totalmem() / (1024 * 1024 * 1024)) : 16;
        vramGB = totalMemGB; // 统一内存即是动态共享显存
      } else if (gpuName.toLowerCase().includes('amd') || gpuName.toLowerCase().includes('radeon')) {
        isDedicated = true;
        isIntegrated = false;
      } else {
        isIntegrated = true;
      }

    } else if (platform === 'win32') {
      // Windows: 通过 PowerShell 获取 WMI VideoController
      const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.AdapterRAM }"`;
      const raw = execSync(psCmd, { encoding: 'utf8', timeout: 4000 });
      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      // 如果有多张显卡（如核显 + 独显双显卡笔记本），优先挑选独立显卡
      let bestCard = { name: '', ramBytes: 0, isDed: false };
      for (const line of lines) {
        const parts = line.split('|');
        const name = parts[0] || '';
        const bytes = parseInt(parts[1] || '0', 10);
        const isDed = /nvidia|geforce|rtx|gtx|radeon rx|quadro/i.test(name);

        if (isDed || (!bestCard.isDed && bytes > bestCard.ramBytes)) {
          bestCard = { name, ramBytes: bytes, isDed };
        }
      }

      if (bestCard.name) {
        gpuName = bestCard.name;
        isDedicated = bestCard.isDed;
        isIntegrated = !bestCard.isDed;
        if (bestCard.ramBytes > 0) {
          vramGB = parseFloat((bestCard.ramBytes / (1024 * 1024 * 1024)).toFixed(1));
        }
      }

    } else {
      // Linux: 通过 lspci 或 nvidia-smi
      try {
        const lspci = execSync('lspci 2>/dev/null | grep -i vga', { encoding: 'utf8', timeout: 2000 });
        if (lspci) {
          gpuName = lspci.replace(/^.+:\s*/, '').trim();
          isDedicated = /nvidia|geforce|radeon/i.test(gpuName);
          isIntegrated = !isDedicated;
        }
      } catch (e) {}
    }
  } catch (err) {
    // 探测超时或受限时走安全保底
    gpuName = platform === 'darwin' ? 'Apple GPU' : '标准图形显示适配器';
  }

  return {
    gpuName,
    vramGB,
    isDedicated,
    isIntegrated
  };
}

/**
 * 工业级四级硬件梯队（Hardware Tier）分级与自适应策略
 */
function evaluateHardwareTier(gpuInfo, cpuCores, totalMemGB, freeMemGB) {
  // Tier 0: 极低配 / 古董设备 (内存 <= 6G 或超小显存)
  if (totalMemGB <= 6 || (gpuInfo.isDedicated && gpuInfo.vramGB > 0 && gpuInfo.vramGB < 2)) {
    return {
      tier: 0,
      tierName: '入门/轻量低配设备',
      recommendedWorkers: 1,
      maxAllowedWorkers: 1,
      tileSize: '100', // 强制极小瓦片，绝不爆显存
      threadsPerWorker: '1:1:1',
      warningNotice: '⚠️ 当前设备硬件配置较低，已自动开启超低功耗保护。若追求秒级极速，建议切换至「云端算力」模式。'
    };
  }

  // Tier 1: 轻薄核显本 / 入门级独显 / 8GB 基础款 Mac
  // 核显、或独立显存 <= 4GB（如 GTX 1650/1050Ti）、或内存 8GB
  if (gpuInfo.isIntegrated || totalMemGB <= 8 || (gpuInfo.isDedicated && gpuInfo.vramGB > 0 && gpuInfo.vramGB <= 4)) {
    return {
      tier: 1,
      tierName: '轻薄核显本 / 入门级显卡设备',
      recommendedWorkers: 1,
      maxAllowedWorkers: 2, // 严格限制最大 2 进程，防止显卡驱动崩溃
      tileSize: '200', // 开启小瓦片防爆显存
      threadsPerWorker: '1:2:1',
      warningNotice: '💡 已为核显/轻薄本自动开启防爆显存保护，建议保持单进程以确保电脑不卡顿。'
    };
  }

  // Tier 2: 主流设备 / 中端甜点独显 (6GB~8GB 独显，或 Apple Silicon 16GB~24GB 统一内存)
  if (totalMemGB <= 24 || (gpuInfo.vramGB > 0 && gpuInfo.vramGB <= 8)) {
    return {
      tier: 2,
      tierName: '主流中端性能设备',
      recommendedWorkers: 2,
      maxAllowedWorkers: 3,
      tileSize: '0', // 自动瓦片
      threadsPerWorker: '2:2:2',
      warningNotice: ''
    };
  }

  // Tier 3: 高性能工作站 / 旗舰大显存独显 (10GB+ 独显，或 Apple Silicon >= 32GB 统一内存)
  return {
    tier: 3,
    tierName: '旗舰高性能工作站',
    recommendedWorkers: 3, // 实测 3 进程为满血最佳点
    maxAllowedWorkers: 4,
    tileSize: '0',
    threadsPerWorker: '2:2:2',
    warningNotice: ''
  };
}

/**
 * 动态检测机器硬件配置并计算最优并发策略（内置动态防 OOM 熔断机制）
 * @param {number|'auto'} [userCustomWorkerCount] 用户在设置中自定义的并发进程数
 * @param {boolean} [vramGuard] 是否开启显存/内存防爆保护
 */
function getHardwareConcurrencyInfo(userCustomWorkerCount, vramGuard = true) {
  const cpuCores = (os.cpus() && os.cpus().length) || 4;
  const totalMemGB = os.totalmem ? Math.round(os.totalmem() / (1024 * 1024 * 1024)) : 8;
  const freeMemGB = os.freemem ? parseFloat((os.freemem() / (1024 * 1024 * 1024)).toFixed(1)) : 4.0;

  // 1. 深度探测 GPU 设备与分级评定
  const gpuInfo = detectGpuDevice();
  const tierInfo = evaluateHardwareTier(gpuInfo, cpuCores, totalMemGB, freeMemGB);

  let workerCount = tierInfo.recommendedWorkers;
  let threadsPerWorker = tierInfo.threadsPerWorker;
  let oomNotice = tierInfo.warningNotice || '';

  // 2. 响应用户自定义并发数 (并进行强力硬件安全上限截断 Clamping)
  if (typeof userCustomWorkerCount === 'number' && userCustomWorkerCount >= 1 && userCustomWorkerCount <= 4) {
    if (userCustomWorkerCount > tierInfo.maxAllowedWorkers) {
      // 🛡️ 强力安全拦截：低配设备如果盲目开大并发，自动限流至安全上限，杜绝爆显存崩溃
      workerCount = tierInfo.maxAllowedWorkers;
      oomNotice = `🛡️ [安全拦截] 当前设备属于 [${tierInfo.tierName}]，系统已自动将并发数安全限流至 ${workerCount} 进程上限，杜绝爆显存与卡死！`;
    } else {
      workerCount = userCustomWorkerCount;
    }
  }

  // 精准分配线程池以避免 GPU 锁颠簸：
  // 1 进程 -> 2:4:2 (单进程打满 4 推理线程)
  // 2 进程 -> 1:2:1 (双进程互补，各 2 推理线程)
  // 3~4 进程 -> 1:1:1 (多进程独立流式直通，消除 6+ 线程抢占 Metal 命令队列的锁颠簸)
  if (workerCount === 1) {
    threadsPerWorker = '2:4:2';
  } else if (workerCount === 2) {
    threadsPerWorker = '1:2:1';
  } else {
    threadsPerWorker = '1:1:1';
  }

  // 3. 🛡️ 核心防 OOM 动态内存熔断保护（智能过滤 macOS 统一内存缓存干扰）：
  // 在 macOS 统一架构下，系统会主动将空闲内存作为 Inactive 缓存，只要总物理内存充裕 (>= 12GB)，默认坚决跑满多线程多进程并发
  const isMac = process.platform === 'darwin';
  const shouldCheckOOM = isMac ? (totalMemGB < 12 && freeMemGB < 1.0) : (freeMemGB < (workerCount * 1.2));

  if (vramGuard && shouldCheckOOM && workerCount > 1) {
    const originalCount = workerCount;
    workerCount = Math.max(1, Math.floor(freeMemGB / 1.2));
    threadsPerWorker = workerCount > 1 ? '1:2:1' : '2:2:2';
    oomNotice = `🛡️ [防OOM保护] 当前系统极度匮乏空闲内存 (${freeMemGB}GB)，已自动将并发临时调整至 ${workerCount} 进程，确保系统绝不崩溃`;
  }

  const concurrencyTitle = workerCount > 1
    ? `默认多线程并发加速 (${workerCount} 进程 × ${threadsPerWorker} 线程 · ${gpuInfo.gpuName})`
    : `默认多线程硬件加速 (${threadsPerWorker} 多线程池 · ${gpuInfo.gpuName})`;

  return {
    cpuCores,
    totalMemGB,
    freeMemGB,
    workerCount,
    threadsPerWorker,
    concurrencyTitle,
    oomNotice,
    gpuInfo,
    tierInfo
  };
}

/**
 * 获取 ffmpeg 路径（内置安装目录 > 系统 PATH）
 */
function getFfmpegPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const local = path.join(DEFAULT_ENGINE_DIR, `ffmpeg${ext}`);
  if (fs.existsSync(local)) return local;
  // 检查系统 PATH（使用安全的 spawnSync 数组传参）
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'where' : 'which';
    const res = spawnSync(cmd, ['ffmpeg'], { encoding: 'utf8' });
    const output = (res.stdout || '').trim();
    if (output) return output.split('\n')[0].trim();
  } catch (e) {}
  return '';
}

/**
 * 获取 realesrgan 路径
 */
function getRealesrganPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const local = path.join(DEFAULT_ENGINE_DIR, `realesrgan-ncnn-vulkan${ext}`);
  if (fs.existsSync(local)) return local;
  return '';
}

async function detectEnvironment(customWorkerCount) {
  // 启动时自动触发过期孤儿临时目录垃圾回收
  cleanOrphanTmpDirs();

  const platform = process.platform || 'darwin';
  const arch = process.arch || 'arm64';
  const totalMemGB = os.totalmem ? Math.round(os.totalmem() / (1024 * 1024 * 1024)) : 16;

  const ffmpegPath = getFfmpegPath();
  const realesrganPath = getRealesrganPath();
  const isLocalAvailable = !!(ffmpegPath && realesrganPath);
  const hardwareInfo = getHardwareConcurrencyInfo(customWorkerCount);

  return {
    platform,
    arch,
    totalMemGB,
    isMac: platform === 'darwin',
    isWindows: platform === 'win32',
    isAppleSilicon: platform === 'darwin' && arch === 'arm64',
    foundEnginePath: realesrganPath,
    ffmpegPath,
    isLocalAvailable,
    defaultRecommendedEngine: isLocalAvailable ? 'local' : 'cloud',
    defaultInstallDir: DEFAULT_ENGINE_DIR,
    hardwareInfo
  };
}

function getVideoFileInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('文件不存在：' + filePath);
  }
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return {
    path: filePath,
    name: path.basename(filePath),
    dir: path.dirname(filePath),
    size: stat.size,
    sizeFormatted: formatFileSize(stat.size),
    ext: ext || 'mp4',
    lastModified: stat.mtimeMs || Date.now()
  };
}

function httpRequest(options, bodyData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, headers: res.headers, data: JSON.parse(data) }); }
        catch (e) { resolve({ statusCode: res.statusCode, headers: res.headers, rawData: data }); }
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    req.end();
  });
}

function downloadFile(fileUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const client = fileUrl.startsWith('https') ? https : http;
    const request = client.get(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close(); fs.unlink(destPath, () => {});
        return downloadFile(response.headers.location, destPath, onProgress).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close(); fs.unlink(destPath, () => {});
        return reject(new Error(`下载失败 HTTP ${response.statusCode}`));
      }
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0, lastTime = Date.now(), lastBytes = 0;
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (onProgress) {
          const percent = totalSize > 0 ? Math.min(100, Math.round((downloadedSize / totalSize) * 100)) : 0;
          let speedText = '';
          const now = Date.now();
          if (now - lastTime >= 500) {
            speedText = formatFileSize((downloadedSize - lastBytes) / ((now - lastTime) / 1000)) + '/s';
            lastTime = now; lastBytes = downloadedSize;
          }
          onProgress({ percent, downloadedBytes: downloadedSize, totalBytes: totalSize,
            downloadedFormatted: formatFileSize(downloadedSize), totalFormatted: formatFileSize(totalSize), speedText });
        }
      });
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    });
    request.on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
  });
}

/**
 * 一键安装引擎（realesrgan + ffmpeg 静态二进制）
 */
async function installLocalEngine(onProgress, onLog) {
  const platform = process.platform;
  const isWin = platform === 'win32';
  const isMac = platform === 'darwin';

  if (!fs.existsSync(DEFAULT_ENGINE_DIR)) {
    fs.mkdirSync(DEFAULT_ENGINE_DIR, { recursive: true });
  }

  const totalSteps = 2;
  let currentStep = 0;

  function stepProgress(stepPercent) {
    if (!onProgress) return;
    const overallPercent = Math.round(((currentStep + stepPercent / 100) / totalSteps) * 100);
    onProgress({ percent: overallPercent, downloadedBytes: 0, totalBytes: 0,
      downloadedFormatted: '', totalFormatted: '', speedText: '' });
  }

  // ── Step 1: 下载 realesrgan-ncnn-vulkan ──
  const realesrganPath = getRealesrganPath();
  if (realesrganPath) {
    if (onLog) onLog('[Step 1/2] Real-ESRGAN 引擎已存在，跳过');
    currentStep = 1;
    stepProgress(0);
  } else {
    let pkgName = 'realesrgan-ncnn-vulkan-20220424-windows.zip';
    if (isMac) pkgName = 'realesrgan-ncnn-vulkan-20220424-macos.zip';
    else if (!isWin) pkgName = 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip';

    const rawUrl = `https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/${pkgName}`;
    const urls = [`https://ghfast.top/${rawUrl}`, `https://mirror.ghproxy.com/${rawUrl}`, rawUrl];
    const zipPath = path.join(DEFAULT_ENGINE_DIR, 'esrgan.zip');

    if (onLog) onLog('[Step 1/2] 正在下载 AI 超分引擎 (Real-ESRGAN)...');
    let ok = false, lastErr;
    for (const url of urls) {
      try {
        if (onLog) onLog(`  尝试节点: ${url.slice(0, 50)}...`);
        await downloadFile(url, zipPath, (p) => {
          if (onProgress) onProgress({ ...p, percent: Math.round(p.percent / 2) });
        });
        ok = true; break;
      } catch (e) { lastErr = e; }
    }
    if (!ok) throw new Error(`下载 Real-ESRGAN 失败: ${lastErr?.message}`);

    await new Promise((res, rej) => {
      const cmd = isWin
        ? `powershell -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${DEFAULT_ENGINE_DIR}'"`
        : `/usr/bin/unzip -o "${zipPath}" -d "${DEFAULT_ENGINE_DIR}"`;
      exec(cmd, (err) => err ? rej(err) : res());
    });
    try { fs.unlinkSync(zipPath); } catch (e) {}

    const binName = isWin ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan';
    const binPath = path.join(DEFAULT_ENGINE_DIR, binName);
    if (!isWin) {
      try { fs.chmodSync(binPath, 0o755); } catch (e) {}
      if (isMac) { try { execSync(`xattr -dr com.apple.quarantine "${DEFAULT_ENGINE_DIR}"`); } catch (e) {} }
    }
    if (onLog) onLog('  ✅ Real-ESRGAN 安装完成');
    currentStep = 1;
  }

  // ── Step 2: 下载 ffmpeg 静态二进制 ──
  const existingFfmpeg = getFfmpegPath();
  if (existingFfmpeg) {
    if (onLog) onLog('[Step 2/2] ffmpeg 已存在，跳过');
    currentStep = 2;
    stepProgress(100);
  } else {
    if (onLog) onLog('[Step 2/2] 正在下载 ffmpeg 视频编解码器...');

    let ffmpegUrl = '';
    let ffmpegBinaryName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
    const ffmpegDest = path.join(DEFAULT_ENGINE_DIR, ffmpegBinaryName);

    if (isMac) {
      const isArm = process.arch === 'arm64';
      const macArchTag = isArm ? 'arm64' : 'x64';
      const rawFfmpegUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-${macArchTag}`;
      const urls = [
        `https://ghfast.top/${rawFfmpegUrl}`,
        `https://mirror.ghproxy.com/${rawFfmpegUrl}`,
        rawFfmpegUrl
      ];
      let ok = false, lastErr;
      for (const url of urls) {
        try {
          if (onLog) onLog(`  下载原生 ffmpeg (${macArchTag}): ${url.slice(0, 50)}...`);
          await downloadFile(url, ffmpegDest, (p) => {
            if (onProgress) onProgress({ ...p, percent: 50 + Math.round(p.percent / 2) });
          });
          ok = true; break;
        } catch (e) { lastErr = e; }
      }
      if (!ok) throw new Error(`下载 ffmpeg 失败: ${lastErr?.message}`);
    } else if (isWin) {
      // Windows: essentials build (~30MB)
      ffmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
      const zipDest = path.join(DEFAULT_ENGINE_DIR, 'ffmpeg-win.zip');
      await downloadFile(ffmpegUrl, zipDest, (p) => {
        if (onProgress) onProgress({ ...p, percent: 50 + Math.round(p.percent / 2) });
      });
      await new Promise((res, rej) => {
        exec(`powershell -Command "Expand-Archive -Force -Path '${zipDest}' -DestinationPath '${DEFAULT_ENGINE_DIR}'"`, (err) => err ? rej(err) : res());
      });
      // 找到解压出来的 ffmpeg.exe 并移到 engine 根目录
      try {
        const findResult = execSync(`dir /s /b "${DEFAULT_ENGINE_DIR}\\ffmpeg.exe"`, { encoding: 'utf8' });
        const found = findResult.trim().split('\n')[0];
        if (found && found !== ffmpegDest) {
          fs.copyFileSync(found, ffmpegDest);
        }
      } catch (e) {}
      try { fs.unlinkSync(zipDest); } catch (e) {}
    } else {
      // Linux: static build from johnvansickle
      ffmpegUrl = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
      const tarDest = path.join(DEFAULT_ENGINE_DIR, 'ffmpeg.tar.xz');
      await downloadFile(ffmpegUrl, tarDest, (p) => {
        if (onProgress) onProgress({ ...p, percent: 50 + Math.round(p.percent / 2) });
      });
      await new Promise((res, rej) => {
        exec(`tar xf "${tarDest}" -C "${DEFAULT_ENGINE_DIR}" --strip-components=1 --wildcards '*/ffmpeg'`, (err) => err ? rej(err) : res());
      });
      try { fs.unlinkSync(tarDest); } catch (e) {}
    }

    if (!isWin && fs.existsSync(ffmpegDest)) {
      try { fs.chmodSync(ffmpegDest, 0o755); } catch (e) {}
      if (isMac) { try { execSync(`xattr -d com.apple.quarantine "${ffmpegDest}"`); } catch (e) {} }
    }

    if (onLog) onLog('  ✅ ffmpeg 安装完成');
    currentStep = 2;
  }

  const finalEngine = getRealesrganPath();
  const finalFfmpeg = getFfmpegPath();
  if (!finalEngine) throw new Error('Real-ESRGAN 引擎文件不存在');
  if (!finalFfmpeg) throw new Error('ffmpeg 文件不存在');

  if (onLog) onLog(`[完成] AI 引擎: ${finalEngine}`);
  if (onLog) onLog(`[完成] ffmpeg:   ${finalFfmpeg}`);

  return { success: true, enginePath: finalEngine };
}

// ──── 完整视频处理管线：ffmpeg 拆帧 → realesrgan 逐帧超分 → ffmpeg 重组 ────

async function runLocalVideoPipeline(jobId, options, callbacks) {
  const { onProgress, onLog, onComplete, onError } = callbacks || {};
  let cancelled = false;
  const activeChildren = [];

  const {
    inputPath,
    preset,
    scale,
    isPreview,
    speedMode = 'fast',
    customWorkerCount,
    vramGuard = true,
    removeWatermark = false,
    watermarkPosition = 'bottom-right'
  } = options || {};
  const ext = path.extname(inputPath) || '.mp4';
  const baseName = path.basename(inputPath, ext);
  const dirName = path.dirname(inputPath);
  const tag = isPreview ? `_预览_${preset}_${scale}x` : `_AI增强_${preset}_${scale}x`;
  const outputPath = path.join(dirName, `${baseName}${tag}.mp4`);

  const ffmpegPath = getFfmpegPath();
  const realesrganPath = getRealesrganPath();

  if (!ffmpegPath || !realesrganPath) {
    if (onError) onError(new Error('本地引擎不完整，请重新执行「一键安装」（需要 ffmpeg + Real-ESRGAN 两个组件）'));
    return;
  }

  const hardware = getHardwareConcurrencyInfo(customWorkerCount, vramGuard);
  if (onLog) {
    onLog(`[系统调度] 硬件并发策略已加载: ${hardware.concurrencyTitle}`);
    if (hardware.oomNotice) onLog(hardware.oomNotice);
    onLog(`[系统调度] 工作进程数: ${hardware.workerCount} 个 | 每进程线程池: ${hardware.threadsPerWorker}`);
  }

  // 创建临时工作目录
  const tmpBase = path.join(USER_DATA_DIR, `job_${Date.now()}`);
  const framesDir = path.join(tmpBase, 'frames');
  const enhancedDir = path.join(tmpBase, 'enhanced');
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(enhancedDir, { recursive: true });

  const cleanup = () => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) {}
  };

  activeJobs.set(jobId, {
    kill: () => {
      cancelled = true;
      for (const child of activeChildren) {
        try { if (child && typeof child.kill === 'function') child.kill(); } catch (e) {}
      }
      cleanup();
      activeJobs.delete(jobId);
    }
  });

  try {
    // ── Phase 1: 用 ffmpeg 拆帧（占总进度 10%）──
    if (onLog) onLog('[Phase 1/3] 使用 ffmpeg 高速提取视频帧序列...');
    if (onProgress) onProgress({ jobId, percent: 2, currentFrame: 0, totalFrames: 0, fps: 0, etaSeconds: 0,
      statusText: '正在快速提取帧画面...' });

    // 全场景智能去水印逻辑 (支持全部水印：角标、双角标、字幕栏、顶部通栏等)
    let watermarkFilterArgs = [];
    if (removeWatermark) {
      try {
        let width = 0, height = 0;
        try {
          // 使用安全的 spawnSync 数组传参，彻底杜绝特殊字符注入
          const probe = spawnSync(ffmpegPath, ['-i', inputPath], { encoding: 'utf8' });
          const meta = ((probe.stderr || '') + (probe.stdout || '')).toString();
          const match = meta.match(/Stream.*Video:.*?(\d{2,5})x(\d{2,5})/);
          if (match) {
            width = parseInt(match[1], 10);
            height = parseInt(match[2], 10);
          }
        } catch (e) {}

        if (width > 0 && height > 0) {
          watermarkFilterArgs = buildWatermarkFilters(width, height, watermarkPosition);
          if (watermarkFilterArgs.length > 0 && onLog) {
            onLog(`  🛡️ [全场景去水印] 已智能锁定目标区域，注入 delogo 平滑擦除滤镜 (模式: ${watermarkPosition})...`);
          }
        }
      } catch (e) {
        if (onLog) onLog(`  ⚠️ 去水印定位异常: ${e.message}`);
      }
    }

    const extractArgs = ['-i', inputPath];
    if (isPreview) {
      extractArgs.push('-t', '3'); // 仅前3秒试看
    }
    if (watermarkFilterArgs.length > 0) {
      extractArgs.push(...watermarkFilterArgs);
    }
    // 采用无额外延迟的高画质快速 JPEG 序列，大幅降低磁盘 I/O 负担
    extractArgs.push('-qscale:v', '2', path.join(framesDir, '%06d.jpg'));

    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, extractArgs);
      activeChildren.push(child);
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        const idx = activeChildren.indexOf(child);
        if (idx >= 0) activeChildren.splice(idx, 1);
        if (cancelled) return reject(new Error('已取消'));
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg 拆帧失败 (exit ${code}):\n${stderr.slice(-500)}`));
      });
    });

    const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort();
    const totalFrames = frameFiles.length;
    if (totalFrames === 0) throw new Error('视频拆帧结果为空，可能视频文件已损坏');

    if (onLog) onLog(`  提取完成，共 ${totalFrames} 帧`);
    if (onProgress) onProgress({ jobId, percent: 10, currentFrame: 0, totalFrames, fps: 0, etaSeconds: 0,
      statusText: `拆帧完成 (${totalFrames} 帧)，启动多核硬件并发超分...` });

    // ── Phase 2: AI 逐帧超分（占总进度 10%~88%）──
    // 模型决策：优先使用官方针对视频优化的快速网络
    let modelName = 'realesr-animevideov3';
    if (speedMode === 'quality') {
      if (preset === 'anime') modelName = 'realesrgan-x4plus-anime';
      else if (preset === 'real') modelName = 'realesrgan-x4plus';
    } else {
      // 极速加速模式（时序视频专用轻量网络）
      modelName = 'realesr-animevideov3';
    }

    if (onLog) onLog(`[Phase 2/3] 超分模型: ${modelName} (${speedMode === 'fast' ? '🚀 极速视频加速' : '🎨 极清画质'})`);

    const startTime = Date.now();
    const workerCount = (totalFrames >= 6 && hardware.workerCount > 1) ? hardware.workerCount : 1;
    // 动态瓦片策略：结合硬件分级安全基线与用户防爆显存选项
    const tierTile = hardware.tierInfo ? hardware.tierInfo.tileSize : '0';
    const tileSize = (vramGuard && scale >= 4) ? '200' : tierTile;

    if (workerCount > 1) {
      if (onLog) onLog(`  🔥 激活 ${workerCount} 进程分块并发加速流水线，充分调度硬件算力 (Tile: ${tileSize})`);
      // 将图片均匀分摊到 N 个 chunk 目录
      const chunkDirs = [];
      const chunkOutDirs = [];
      for (let i = 0; i < workerCount; i++) {
        const cin = path.join(tmpBase, `chunk_${i}`);
        const cout = path.join(tmpBase, `chunk_${i}_out`);
        fs.mkdirSync(cin, { recursive: true });
        fs.mkdirSync(cout, { recursive: true });
        chunkDirs.push(cin);
        chunkOutDirs.push(cout);
      }

      // 分配文件
      const chunkSize = Math.ceil(totalFrames / workerCount);
      frameFiles.forEach((f, idx) => {
        const targetWorker = Math.min(Math.floor(idx / chunkSize), workerCount - 1);
        fs.renameSync(path.join(framesDir, f), path.join(chunkDirs[targetWorker], f));
      });

      // 实时监控所有输出目录的总完成数
      const checkProgressInterval = setInterval(() => {
        if (cancelled) { clearInterval(checkProgressInterval); return; }
        try {
          let totalDone = 0;
          for (const cout of chunkOutDirs) {
            totalDone += fs.readdirSync(cout).filter(f => f.endsWith('.png')).length;
          }
          const percent = 10 + Math.round((totalDone / totalFrames) * 78);
          const elapsed = (Date.now() - startTime) / 1000;
          const fps = totalDone > 0 ? (totalDone / elapsed) : 0;
          const remaining = fps > 0 ? Math.round((totalFrames - totalDone) / fps) : 0;

          if (onProgress) onProgress({
            jobId,
            percent: Math.min(88, percent),
            currentFrame: totalDone,
            totalFrames,
            fps: parseFloat(fps.toFixed(1)),
            etaSeconds: remaining,
            statusText: `${workerCount} 进程并发渲染中 ${totalDone}/${totalFrames} 帧 (${fps.toFixed(1)} FPS)`
          });
        } catch (e) {}
      }, 800);

      // 并行启动多个子进程
      const workerPromises = chunkDirs.map((cin, i) => {
        return new Promise((resolveWorker, rejectWorker) => {
          const cout = chunkOutDirs[i];
          const args = [
            '-i', cin,
            '-o', cout,
            '-s', String(scale),
            '-n', modelName,
            '-j', hardware.threadsPerWorker,
            '-t', tileSize,
            '-f', 'png'
          ];
          const child = spawn(realesrganPath, args, { cwd: DEFAULT_ENGINE_DIR });
          activeChildren.push(child);

          let stderr = '';
          child.stderr.on('data', (d) => { stderr += d.toString(); });
          child.on('error', rejectWorker);
          child.on('close', (code) => {
            const idx = activeChildren.indexOf(child);
            if (idx >= 0) activeChildren.splice(idx, 1);
            if (cancelled) return rejectWorker(new Error('已取消'));
            if (code === 0) resolveWorker();
            else rejectWorker(new Error(`Worker ${i} 渲染失败 (exit ${code}):\n${stderr.slice(-300)}`));
          });
        });
      });

      try {
        await Promise.all(workerPromises);
      } finally {
        clearInterval(checkProgressInterval);
      }

      // 将所有输出合并到 enhancedDir
      for (const cout of chunkOutDirs) {
        const outs = fs.readdirSync(cout).filter(f => f.endsWith('.png'));
        for (const f of outs) {
          fs.renameSync(path.join(cout, f), path.join(enhancedDir, f));
        }
      }

    } else {
      // 单进程硬件加速
      const esrganArgs = [
        '-i', framesDir,
        '-o', enhancedDir,
        '-s', String(scale),
        '-n', modelName,
        '-j', hardware.threadsPerWorker,
        '-t', tileSize,
        '-f', 'png'
      ];

      await new Promise((resolveSingle, rejectSingle) => {
        const child = spawn(realesrganPath, esrganArgs, { cwd: DEFAULT_ENGINE_DIR });
        activeChildren.push(child);

        const checkOutputProgress = setInterval(() => {
          if (cancelled) { clearInterval(checkOutputProgress); return; }
          try {
            const done = fs.readdirSync(enhancedDir).filter(f => f.endsWith('.png')).length;
            const percent = 10 + Math.round((done / totalFrames) * 78);
            const elapsed = (Date.now() - startTime) / 1000;
            const fps = done > 0 ? (done / elapsed) : 0;
            const remaining = fps > 0 ? Math.round((totalFrames - done) / fps) : 0;

            if (onProgress) onProgress({
              jobId,
              percent: Math.min(88, percent),
              currentFrame: done,
              totalFrames,
              fps: parseFloat(fps.toFixed(1)),
              etaSeconds: remaining,
              statusText: `AI 超分渲染中 ${done}/${totalFrames} 帧 (${fps.toFixed(1)} FPS)`
            });
          } catch (e) {}
        }, 800);

        let stderr = '';
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (err) => { clearInterval(checkOutputProgress); rejectSingle(err); });
        child.on('close', (code) => {
          clearInterval(checkOutputProgress);
          const idx = activeChildren.indexOf(child);
          if (idx >= 0) activeChildren.splice(idx, 1);
          if (cancelled) return rejectSingle(new Error('已取消'));
          if (code === 0) resolveSingle();
          else rejectSingle(new Error(`Real-ESRGAN 超分失败 (exit ${code}):\n${stderr.slice(-500)}`));
        });
      });
    }

    const enhancedCount = fs.readdirSync(enhancedDir).filter(f => f.endsWith('.png')).length;
    if (enhancedCount === 0) throw new Error('AI 超分引擎输出为空');

    const totalRenderTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const avgFps = (totalFrames / parseFloat(totalRenderTime)).toFixed(1);
    if (onLog) onLog(`  ✅ 超分完成：${enhancedCount} 帧增强完成，总耗时 ${totalRenderTime}s (平均 ${avgFps} FPS)`);

    if (onProgress) onProgress({ jobId, percent: 90, currentFrame: totalFrames, totalFrames, fps: parseFloat(avgFps), etaSeconds: 5,
      statusText: '渲染完成，正在重组视频并混入音轨...' });

    // ── Phase 3: ffmpeg 重新组装视频（占总进度 90%~100%）──
    if (onLog) onLog('[Phase 3/3] 使用 ffmpeg 高画质重组视频...');

    let fps = 24;
    try {
      // 安全使用 spawnSync 数组形式探查帧率，杜绝特殊字符报错
      const probe = spawnSync(ffmpegPath, ['-i', inputPath], { encoding: 'utf8' });
      const metaText = ((probe.stderr || '') + (probe.stdout || '')).toString();
      const match = metaText.match(/(\d+(?:\.\d+)?)\s*fps/);
      if (match && match[1]) {
        const parsed = parseFloat(match[1]);
        if (parsed > 0 && parsed <= 240) fps = parsed;
      }
    } catch (e) {}
    if (onLog) onLog(`  基准帧率: ${fps} fps`);

    const assembleArgs = [
      '-framerate', String(fps),
      '-i', path.join(enhancedDir, '%06d.png'),
      '-i', inputPath,
      '-map', '0:v',
      '-map', '1:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      '-y',
      outputPath
    ];

    await new Promise((resolveAssemble, rejectAssemble) => {
      const child = spawn(ffmpegPath, assembleArgs);
      activeChildren.push(child);
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', rejectAssemble);
      child.on('close', (code) => {
        const idx = activeChildren.indexOf(child);
        if (idx >= 0) activeChildren.splice(idx, 1);
        if (cancelled) return rejectAssemble(new Error('已取消'));
        if (code === 0) resolveAssemble();
        else rejectAssemble(new Error(`ffmpeg 重组失败 (exit ${code}):\n${stderr.slice(-500)}`));
      });
    });

    if (onProgress) onProgress({ jobId, percent: 100, currentFrame: totalFrames, totalFrames, fps: parseFloat(avgFps), etaSeconds: 0,
      statusText: '处理完成！' });

    cleanup();
    activeJobs.delete(jobId);
    if (onComplete) onComplete({ jobId, outputPath });

  } catch (err) {
    cleanup();
    activeJobs.delete(jobId);
    if (!cancelled && onError) onError(err);
  }
}

// ──── Replicate 云端 ────

async function runReplicateJob(jobId, apiKey, options, callbacks) {
  const { onProgress, onLog, onComplete, onError } = callbacks || {};
  try {
    if (!apiKey?.trim()) throw new Error('未提供云端 API Token。');

    const { inputPath, preset, scale, isPreview } = options;
    const ext = path.extname(inputPath) || '.mp4';
    const baseName = path.basename(inputPath, ext);
    const dirName = path.dirname(inputPath);
    const tag = isPreview ? `_云端预览` : `_云端增强_${preset}_${scale}x`;
    const outputPath = path.join(dirName, `${baseName}${tag}.mp4`);

    if (onLog) onLog('[Replicate] 正在编码视频并提交云端...');
    if (onProgress) onProgress({ jobId, percent: 5, fps: 0, currentFrame: 0, totalFrames: 100, etaSeconds: 60,
      statusText: '正在编码上传...' });

    const fileBuffer = fs.readFileSync(inputPath);
    const mimeType = ext === '.mov' ? 'video/quicktime' : 'video/mp4';
    const dataUri = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

    let modelSlug = 'nightmareai/real-esrgan';
    let inputPayload = { image: dataUri, scale: scale || 2, face_enhance: preset === 'real' };
    if (preset === 'interpolate') { modelSlug = 'lucataco/rife'; inputPayload = { mp4: dataUri }; }

    const createRes = await httpRequest({
      hostname: 'api.replicate.com', path: `/v1/models/${modelSlug}/predictions`, method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json', 'User-Agent': 'ZTools-Video-Enhancer/1.0' }
    }, { input: inputPayload });

    if (createRes.statusCode !== 200 && createRes.statusCode !== 201) {
      let rawErr = createRes.data?.detail || createRes.rawData || createRes.statusCode;
      if (typeof rawErr === 'object') rawErr = JSON.stringify(rawErr);
      rawErr = String(rawErr);

      if (rawErr.includes('insufficient credit') || rawErr.includes('billing')) {
        throw new Error(`云端账户余额不足 (Insufficient Credit): 您的 Replicate API 额度已用尽。建议直接切换到【本地 GPU 离线增强】，100% 免费无限次使用且保护隐私！`);
      } else if (rawErr.includes('Unauthenticated') || rawErr.includes('Invalid token') || createRes.statusCode === 401) {
        throw new Error(`云端认证失败 (Unauthenticated): Replicate API Token 无效。请在设置中检查 Token，或直接切换到【本地 GPU 离线增强】。`);
      } else {
        throw new Error(`云端接口响应异常 (${createRes.statusCode}): ${rawErr}`);
      }
    }

    const predictionId = createRes.data.id;
    let cancelled = false;
    activeJobs.set(jobId, { kill: async () => {
      cancelled = true;
      try { await httpRequest({ hostname: 'api.replicate.com', path: `/v1/predictions/${predictionId}/cancel`,
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey.trim()}` } }); } catch (e) {}
      activeJobs.delete(jobId);
    }});

    const poll = async () => {
      if (cancelled) return;
      const r = await httpRequest({ hostname: 'api.replicate.com', path: `/v1/predictions/${predictionId}`,
        method: 'GET', headers: { 'Authorization': `Bearer ${apiKey.trim()}` } });
      const s = r.data?.status;
      if (s === 'processing' || s === 'starting') {
        if (onProgress) onProgress({ jobId, percent: s === 'starting' ? 20 : 65, fps: 0, currentFrame: 0,
          totalFrames: 0, etaSeconds: 30, statusText: s === 'starting' ? '云端分配 GPU...' : '云端渲染中...' });
        setTimeout(poll, 2000);
      } else if (s === 'succeeded') {
        let url = r.data.output; if (Array.isArray(url)) url = url[0];
        if (!url) throw new Error('云端完成但无下载链接');
        if (onProgress) onProgress({ jobId, percent: 90, fps: 0, currentFrame: 0, totalFrames: 0, etaSeconds: 5, statusText: '下载结果...' });
        await downloadFile(url, outputPath);
        activeJobs.delete(jobId);
        if (onComplete) onComplete({ jobId, outputPath });
      } else if (s === 'failed') { throw new Error(r.data.error || '云端失败'); }
    };
    setTimeout(poll, 1500);
  } catch (err) { activeJobs.delete(jobId); if (onError) onError(err); }
}

// ──── 统一入口 ────

async function startEnhanceJob(jobId, options, callbacks) {
  const mode = options?.engineMode || 'cloud';
  if (mode === 'cloud') {
    const apiKey = options.cloudApiKey || '';
    if (!apiKey) {
      if (callbacks?.onError) callbacks.onError(new Error('未填写云端 API Token！请在设置中填写 Replicate Token。'));
      return { jobId, error: 'MISSING_API_KEY' };
    }
    runReplicateJob(jobId, apiKey, options, callbacks);
    return { jobId };
  }

  // 本地模式：完整视频管线
  runLocalVideoPipeline(jobId, options, callbacks);
  return { jobId };
}

function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) { try { if (typeof job.kill === 'function') job.kill(); } catch (e) {} activeJobs.delete(jobId); return true; }
  return false;
}

function showInFolder(p) {
  try {
    if (process.platform === 'win32') exec(`explorer.exe /select,"${p}"`);
    else if (process.platform === 'darwin') exec(`open -R "${p}"`);
    else exec(`xdg-open "${path.dirname(p)}"`);
  } catch (e) {}
}

function playVideoFile(p) {
  try {
    if (process.platform === 'win32') exec(`start "" "${p}"`);
    else if (process.platform === 'darwin') exec(`open "${p}"`);
    else exec(`xdg-open "${p}"`);
  } catch (e) {}
}

const servicesApi = Object.freeze({
  detectEnvironment, checkCommandExists, installLocalEngine,
  getVideoFileInfo, startEnhanceJob, cancelJob, showInFolder, playVideoFile
});

if (typeof window !== 'undefined') window.services = servicesApi;
try { const { contextBridge } = require('electron');
  if (contextBridge?.exposeInMainWorld) contextBridge.exposeInMainWorld('services', servicesApi);
} catch (e) {}

module.exports = servicesApi;
