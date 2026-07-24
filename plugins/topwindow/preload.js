const { exec } = require('child_process');
const path = require('path');

/**
 * 切换当前窗口的置顶状态
 * 调用同目录下的 toggle-topmost.ps1 脚本完成：
 *   1. 获取当前前台窗口句柄和窗口标题
 *   2. 切换 TOPMOST 状态
 *   3. 弹出一个自动消失的 Toast 提示（含窗口名称）
 */
function toggleTopMost() {
  // 隐藏 ZTools 主窗口，将焦点还给之前的窗口
  try {
    window.ztools.hideMainWindow(true);
  } catch (e) {
    console.error('hideMainWindow failed:', e);
  }

  // 等待焦点完全切换回目标窗口
  setTimeout(() => {
    // 获取 ps1 脚本的绝对路径（与 preload.js 同目录）
    const scriptPath = path.join(__dirname, 'toggle-topmost.ps1');
    const command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath + '"';

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('TopWindow exec error:', error.message);
        try {
          window.ztools.showNotification('TopWindow 执行失败: ' + error.message);
        } catch (e) { /* ignore */ }
      } else {
        // 解析结果: "Pinned||窗口标题" 或 "Unpinned||窗口标题"
        const output = stdout.trim();
        const parts = output.split('||');
        const action = parts[0] || '';
        const title = parts[1] || '';

        if (action === 'Pinned') {
          window.ztools.showNotification('已置顶: ' + title);
        } else if (action === 'Unpinned') {
          window.ztools.showNotification('已取消置顶: ' + title);
        } else if (action === 'NoWindow') {
          window.ztools.showNotification('未找到活动窗口');
        }
      }

      // 退出插件
      setTimeout(() => {
        try { window.ztools.outPlugin(); } catch (e) { /* ignore */ }
      }, 200);
    });
  }, 350);
}

// 插件进入时触发
window.ztools.onPluginEnter(({ code, type, payload }) => {
  if (code === 'topwindow') {
    toggleTopMost();
  }
});
