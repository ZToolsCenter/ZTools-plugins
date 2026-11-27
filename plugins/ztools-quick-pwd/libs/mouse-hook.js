const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

let psProcess = null;
let isStopping = false;

/**
 * 启动鼠标中键长按监听（目前支持 Windows 环境）
 * @param {object} options
 * @param {number} [options.holdDurationMs=500] 判定长按的毫秒数
 * @param {function} [options.onTrigger] 触发回调 (x, y)
 * @param {function} [options.onError] 错误回调
 */
function start(options = {}) {
  const platform = os.platform();
  if (platform !== 'win32' && platform !== 'linux') {
    // macOS 系统沙盒机制限制未授权子进程全局监听，建议使用 ZTools 原生超级面板或全局快捷键
    console.info('[mouse-hook] macOS 平台已原生集成 ZTools 超级面板与全局热键，无需额外脚本');
    return false;
  }

  if (psProcess) {
    return true; // 已经运行中
  }

  const holdMs = (options && options.holdDurationMs) || 500;
  isStopping = false;
  if (platform === 'win32') {
    return startWindows(options, holdMs);
  } else if (platform === 'linux') {
    return startLinux(options, holdMs);
  }
  return false;
}

function startWindows(options, holdMs) {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'mid-btn-watch.ps1');
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-HoldDurationMs', String(holdMs)
  ];

  try {
    psProcess = spawn('powershell.exe', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let buffer = '';

    psProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('TRIGGER')) {
          const parts = trimmed.split(' ');
          let x = 0, y = 0;
          if (parts.length > 1) {
            const coords = parts[1].split(',');
            x = parseInt(coords[0], 10) || 0;
            y = parseInt(coords[1], 10) || 0;
          }
          if (typeof options.onTrigger === 'function') {
            try {
              options.onTrigger(x, y);
            } catch (cbErr) {
              console.error('[mouse-hook] onTrigger 异常:', cbErr);
            }
          }
        }
      }
    });

    psProcess.stderr.on('data', (chunk) => {
      const errStr = chunk.toString('utf8').trim();
      if (errStr && !isStopping) {
        console.error('[mouse-hook] Windows stderr:', errStr);
        if (typeof options.onError === 'function') {
          options.onError(errStr);
        }
      }
    });

    psProcess.on('exit', () => { psProcess = null; });
    psProcess.on('error', (err) => {
      console.error('[mouse-hook] Windows powershell 异常:', err);
      psProcess = null;
    });

    return true;
  } catch (err) {
    console.error('[mouse-hook] 启动 powershell 失败:', err);
    psProcess = null;
    return false;
  }
}

/**
 * Linux X11 环境监听（基于 xinput）
 */
function startLinux(options, holdMs) {
  try {
    // 监听 X11 根窗口的所有输入事件
    psProcess = spawn('xinput', ['test-xi2', '--root'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let pressTimer = null;
    let isPressed = false;
    let buffer = '';

    psProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (const line of lines) {
        // xinput 事件：EVENT type 15 (ButtonPress) / EVENT type 16 (ButtonRelease)
        // 鼠标中键通常是 detail: 2
        if (line.includes('EVENT type 15 (ButtonPress)')) {
          isPressed = true;
        } else if (line.includes('EVENT type 16 (ButtonRelease)')) {
          isPressed = false;
          if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
        } else if (isPressed && line.includes('detail: 2')) {
          // 确认是中键按下，启动长按计时
          if (!pressTimer) {
            pressTimer = setTimeout(() => {
              if (isPressed && typeof options.onTrigger === 'function') {
                try {
                  options.onTrigger(0, 0);
                } catch (e) {
                  console.error('[mouse-hook] Linux onTrigger 异常:', e);
                }
              }
              pressTimer = null;
            }, holdMs);
          }
        }
      }
    });

    psProcess.stderr.on('data', () => {});
    psProcess.on('exit', () => { psProcess = null; });
    psProcess.on('error', (err) => {
      console.warn('[mouse-hook] Linux xinput 未安装或非 X11 环境，请使用 ZTools 原生超级面板或快捷键');
      psProcess = null;
    });

    return true;
  } catch (e) {
    console.warn('[mouse-hook] 启动 Linux xinput 失败:', e.message);
    psProcess = null;
    return false;
  }
}

/**
 * 停止鼠标中键监听进程
 */
function stop() {
  if (!psProcess) return;
  isStopping = true;
  try {
    psProcess.kill('SIGTERM');
  } catch (e) {
    // 忽略
  }
  psProcess = null;
}

/**
 * 是否正在监听
 */
function isRunning() {
  return !!psProcess;
}

module.exports = {
  start,
  stop,
  isRunning
};
