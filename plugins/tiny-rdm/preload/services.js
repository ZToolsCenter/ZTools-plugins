const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');

const SERVER_URL = 'http://localhost:8088/api/auth/status';
const POLL_INTERVAL = 1000; // 轮询间隔 1 秒

let serverProcess = null;
let pollTimer = null;
let isPluginExiting = false;

/**
 * 将 ASAR 虚拟路径转换为 unpack 目录中的实体路径。
 * @param {string} filePath 插件文件路径
 * @returns {string} 可交给系统命令使用的实体路径
 */
function resolveUnpackedPath(filePath) {
  return filePath.replace(/\.asar(?=[/\\]|$)/, '.asar.unpacked');
}

/**
 * 获取当前平台对应的可执行文件实体路径。
 * @returns {string} TinyRDM 可执行文件路径
 */
function getExecutablePath() {
  const libDir = path.join(__dirname, '..', 'lib');
  const exeName = process.platform === 'win32' ? 'tinyrdm.exe' : 'tinyrdm';
  return resolveUnpackedPath(path.join(libDir, exeName));
}

/**
 * 检查服务是否已在运行
 */
async function isServerRunning() {
  try {
    const response = await fetch(SERVER_URL);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 轮询等待服务就绪，就绪后刷新页面
 */
function pollUntilReady() {
  console.log('⏳ Waiting for TinyRDM server to be ready...');
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const response = await fetch(SERVER_URL);
      if (response.ok) {
        clearInterval(pollTimer);
        pollTimer = null;
        if (isPluginExiting) return;
        console.log('✅ TinyRDM server is ready, refreshing page...');
        window.location.reload();
      }
    } catch {
      // 服务还未就绪，继续轮询
    }
  }, POLL_INTERVAL);
}

/**
 * 启动 TinyRDM 服务
 */
function spawnServer() {
  if (isPluginExiting) return;

  const exePath = getExecutablePath();
  console.log('🚀 Starting TinyRDM server:', exePath);

  // macOS/Linux 需要确保可执行权限
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(exePath, 0o755);
    } catch (e) {
      console.warn('⚠️ Failed to set executable permission:', e.message);
    }
  }

  // macOS 清除 Gatekeeper 隔离属性，避免"无法验证开发者"弹窗
  if (process.platform === 'darwin') {
    try {
      execFileSync('xattr', ['-cr', exePath]);
    } catch (e) {
      console.warn('⚠️ Failed to clear quarantine attribute:', e.message);
    }
  }

  serverProcess = spawn(exePath, [], {
    stdio: 'ignore',
    detached: true,
    cwd: path.dirname(exePath),
  });

  const startedProcess = serverProcess;
  startedProcess.once('error', (error) => {
    console.error('❌ Failed to start TinyRDM server:', error.message);
    if (serverProcess === startedProcess) {
      serverProcess = null;
    }
  });
  startedProcess.once('exit', () => {
    if (serverProcess === startedProcess) {
      serverProcess = null;
    }
  });

  // 完全断开父子进程关联，让进程独立运行
  startedProcess.unref();

  // 启动轮询，等待服务就绪后刷新页面
  pollUntilReady();
}

/**
 * 停止插件启动的 TinyRDM 服务
 */
function stopServer() {
  clearInterval(pollTimer);
  pollTimer = null;

  const target = serverProcess;
  serverProcess = null;
  if (!target || target.exitCode !== null || target.signalCode !== null) return;

  try {
    target.kill('SIGTERM');
    console.log('🛑 TinyRDM server stopped');
  } catch (error) {
    console.warn('⚠️ Failed to stop TinyRDM server:', error.message);
  }
}

// 向渲染进程注入服务
window.services = {};

// 插件加载时检查并启动服务
window.addEventListener('DOMContentLoaded', async () => {
  console.log('📦 TinyRDM plugin loaded');

  if (await isServerRunning()) {
    console.log('✅ TinyRDM server is already running, skipping launch');
    return;
  }

  spawnServer();
});

// 插件进程被销毁时，同时结束由插件启动的 TinyRDM 服务
window.ztools.onPluginOut((isKill) => {
  if (!isKill) return;
  isPluginExiting = true;
  stopServer();
});
