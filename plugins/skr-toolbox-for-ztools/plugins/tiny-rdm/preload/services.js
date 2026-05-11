const path = require('node:path');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');

const SERVER_URL = 'http://localhost:8088/api/auth/status';
const POLL_INTERVAL = 1000; // 轮询间隔 1 秒

/**
 * 获取当前平台对应的可执行文件路径
 */
function getExecutablePath() {
  const libDir = path.join(__dirname, '..', 'lib');
  const exeName = process.platform === 'win32' ? 'tinyrdm.exe' : 'tinyrdm';
  return path.join(libDir, exeName);
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
  const timer = setInterval(async () => {
    try {
      const response = await fetch(SERVER_URL);
      if (response.ok) {
        clearInterval(timer);
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
      execSync(`xattr -cr "${exePath}"`);
    } catch (e) {
      console.warn('⚠️ Failed to clear quarantine attribute:', e.message);
    }
  }

  const serverProcess = spawn(exePath, [], {
    stdio: 'ignore',
    detached: true,
    cwd: path.dirname(exePath),
  });

  // 完全断开父子进程关联，让进程独立运行
  serverProcess.unref();

  // 启动轮询，等待服务就绪后刷新页面
  pollUntilReady();
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
