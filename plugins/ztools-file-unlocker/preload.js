/**
 * 文件解锁器 - preload.js (Ztools / uTools)
 */
console.log('ztools-file-unlocker preload.js loaded!');

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

window._utoolsPendingActions = window._utoolsPendingActions || [];

function getHelperPath() {
  const candidates = [
    path.join(__dirname, 'bin', 'unlocker-helper.exe'),
    path.join(__dirname, 'unlocker-helper.exe'),
    path.join(process.cwd(), 'bin', 'unlocker-helper.exe'),
    path.join(process.cwd(), 'unlocker-helper.exe')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function handleIncomingAction(action) {
  if (!action) return;
  window._utoolsPendingActions.push(action);
  if (typeof window.onPluginEnter === 'function') {
    try {
      window.onPluginEnter(action);
    } catch (e) {
      console.error('Error in onPluginEnter:', e);
    }
  }
}

// 统一包装 Ztools / uTools API
const getUtools = () => {
  if (typeof utools !== 'undefined') return utools;
  if (typeof window !== 'undefined' && window.utools) return window.utools;
  if (typeof window !== 'undefined' && window.ztools) return window.ztools;
  return null;
};

function expandWindow(h = 560) {
  const targets = [
    typeof utools !== 'undefined' ? utools : null,
    typeof ztools !== 'undefined' ? ztools : null,
    typeof window !== 'undefined' && window.utools ? window.utools : null,
    typeof window !== 'undefined' && window.ztools ? window.ztools : null
  ].filter(Boolean);

  for (const t of targets) {
    try { if (typeof t.setExpendHeight === 'function') t.setExpendHeight(h); } catch (e) {}
    try { if (typeof t.setExploresHeight === 'function') t.setExploresHeight(h); } catch (e) {}
    try { if (typeof t.setHeight === 'function') t.setHeight(h); } catch (e) {}
    try { if (typeof t.showMainWindow === 'function') t.showMainWindow(); } catch (e) {}
  }
}

// 监听 uTools / Ztools 的全局事件
try {
  const ut = getUtools();
  if (ut && typeof ut.onPluginEnter === 'function') {
    ut.onPluginEnter((action) => {
      expandWindow(560);
      setTimeout(() => expandWindow(560), 50);
      setTimeout(() => expandWindow(560), 150);
      handleIncomingAction(action);
    });
  }
} catch (e) {}

window.addEventListener('DOMContentLoaded', () => {
  expandWindow(560);
  setTimeout(() => expandWindow(560), 50);
  setTimeout(() => expandWindow(560), 200);
});

function runNativeHelper(args, timeout = 10000) {
  return new Promise((resolve) => {
    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      return resolve({ error: '找不到底层辅助程序：' + helperPath });
    }
    execFile(helperPath, args, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        return resolve({ error: err.message || stderr || '执行失败' });
      }
      resolve({ stdout: stdout || '' });
    });
  });
}

window.services = {

  expandWindow(h = 560) {
    expandWindow(h);
  },

  getPendingActions() {
    const actions = window._utoolsPendingActions ? [...window._utoolsPendingActions] : [];
    window._utoolsPendingActions = [];
    return actions;
  },

  /** 获取当前系统资源管理器或剪贴板中选中的文件/目录 */
  async getSelectedFiles() {
    const res = await runNativeHelper(['get-selected']);
    if (res.error) return [];
    try {
      const data = JSON.parse((res.stdout || '').trim());
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  },

  /** 安全获取 File 对象的本地绝对路径 */
  getPathForFile(file) {
    if (!file) return '';
    try {
      const electron = require('electron');
      if (electron && electron.webUtils && typeof electron.webUtils.getPathForFile === 'function') {
        const p = electron.webUtils.getPathForFile(file);
        if (p) return p;
      }
    } catch (e) {}
    return file.path || '';
  },

  /** 打开「选择文件/文件夹」对话框（同时兼容 uTools 同步与 Electron Promise） */
  selectPaths() {
    return new Promise((resolve) => {
      try {
        const ut = getUtools();
        if (ut && typeof ut.showOpenDialog === 'function') {
          const res = ut.showOpenDialog({
            title: '选择文件或文件夹',
            properties: ['openFile', 'openDirectory', 'multiSelections']
          });
          if (res && typeof res.then === 'function') {
            return res.then(r => resolve(Array.isArray(r) ? r : [])).catch(() => resolve([]));
          } else if (Array.isArray(res)) {
            return resolve(res);
          } else if (typeof res === 'string' && res) {
            return resolve([res]);
          }
        }
      } catch (e) {}

      try {
        const { dialog } = require('electron');
        if (dialog && typeof dialog.showOpenDialog === 'function') {
          dialog.showOpenDialog({
            title: '选择文件或文件夹',
            properties: ['openFile', 'openDirectory', 'multiSelections']
          }).then((r) => resolve((r && r.filePaths) || [])).catch(() => resolve([]));
          return;
        }
      } catch (e) {}

      resolve([]);
    });
  },

  /** 选择目标文件夹（用于移动） */
  pickFolder() {
    return new Promise((resolve) => {
      try {
        const ut = getUtools();
        if (ut && typeof ut.showOpenDialog === 'function') {
          const res = ut.showOpenDialog({
            title: '选择目标文件夹',
            properties: ['openDirectory', 'createDirectory']
          });
          if (res && typeof res.then === 'function') {
            return res.then(r => resolve(Array.isArray(r) ? (r[0] || '') : (r && r[0]) || '')).catch(() => resolve(''));
          } else if (Array.isArray(res)) {
            return resolve(res[0] || '');
          } else if (typeof res === 'string') {
            return resolve(res);
          }
        }
      } catch (e) {}

      try {
        const { dialog } = require('electron');
        if (dialog && typeof dialog.showOpenDialog === 'function') {
          dialog.showOpenDialog({
            title: '选择目标文件夹',
            properties: ['openDirectory', 'createDirectory']
          }).then((r) => { const p = (r && r.filePaths) || []; resolve(p[0] || ''); }).catch(() => resolve(''));
          return;
        }
      } catch (e) {}

      resolve('');
    });
  },

  /** 列出占用该路径的所有进程（RM + 内核句柄枚举 + 模块扫描 + 进程EXE扫描） */
  async listHolders(targetPath) {
    const res = await runNativeHelper(['list', targetPath]);
    if (res.error) return { error: res.error, holders: [] };
    try {
      const text = (res.stdout || '').trim();
      if (!text) return { holders: [] };
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : [data];
      return { holders: arr.filter(h => h && h.pid > 0) };
    } catch (e) {
      return { error: '解析进程占用数据失败: ' + e.message, holders: [] };
    }
  },

  /** 批量极速列出占用进程（一次进程调用，内部多引擎并行扫描） */
  async listHoldersBatch(targetPaths) {
    if (!targetPaths || !targetPaths.length) return {};
    const res = await runNativeHelper(['list-batch', ...targetPaths]);
    if (res.error) return {};
    try {
      const text = (res.stdout || '').trim();
      if (!text) return {};
      const data = JSON.parse(text);
      return (typeof data === 'object' && data) ? data : {};
    } catch (e) {
      return {};
    }
  },

  /** 关闭远程进程中的特定文件句柄（不杀进程解除占用） */
  async closeHandle(pid, handle) {
    const res = await runNativeHelper(['close-handle', String(pid), String(handle)]);
    if (res.error) return { ok: false, message: res.error };
    try {
      const data = JSON.parse((res.stdout || '').trim());
      return { ok: !!(data && data.ok) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  /** 重启 Windows 资源管理器 (explorer.exe) 防止桌面异常或任务栏消失 */
  restartExplorer() {
    return new Promise((resolve) => {
      // 1. 调用底层 C++ 原生 ShellExecute 重启 Explorer 桌面
      runNativeHelper(['restart-explorer']).then((res) => {
        // 2. 双保险：启动 explorer 独立进程
        try {
          const { exec } = require('child_process');
          exec('cmd.exe /c start explorer.exe', { windowsHide: false }, () => {});
        } catch (e) {}
        resolve(true);
      });
    });
  },

  /** 结束单个进程（强制终止进程树，若为资源管理器则自动重启以防电脑异常） */
  async killProcess(pid, force = true, processHint = '') {
    const isHintExp = (function(s) {
      if (!s) return false;
      const l = String(s).toLowerCase();
      return l.includes('explorer.exe') || l === 'explorer' || l.includes('资源管理器');
    })(processHint);

    // 优先调用底层 C++ 原生 kill（包含内部 QueryFullProcessImageName 校验和 ShellExecute 自动重启）
    const res = await runNativeHelper(['kill', String(pid)]);
    if (!res.error) {
      try {
        const data = JSON.parse((res.stdout || '').trim());
        if (data && data.ok) {
          const isExp = !!(data.restartedExplorer || isHintExp);
          if (isExp) {
            window.services.restartExplorer();
          }
          return { ok: true, message: '已结束进程', restartedExplorer: isExp };
        }
      } catch (e) {}
    }

    // 兜底 taskkill
    return new Promise((resolve) => {
      const args = force ? ['/F', '/T', '/PID', String(pid)] : ['/PID', String(pid)];
      execFile('taskkill.exe', args, { encoding: 'utf8', windowsHide: true }, (err, stdout, stderr) => {
        if (!err) {
          if (isHintExp) {
            window.services.restartExplorer();
          }
          return resolve({ ok: true, message: stdout || '已结束进程', restartedExplorer: isHintExp });
        }
        const msg = (stderr || stdout || (res && res.error) || err.message || '结束进程失败').split('\n').filter(Boolean).pop();
        resolve({ ok: false, message: msg, restartedExplorer: false });
      });
    });
  },

  /** 查找占用并直接杀掉所有占用进程以彻底解锁（若含资源管理器则自动重启） */
  async unlockPath(targetPath) {
    const res = await window.services.listHolders(targetPath);
    if (res.error) return { ok: false, message: res.error, killed: [], restartedExplorer: false };
    const holders = res.holders || [];
    if (!holders.length) return { ok: true, message: '未发现占用', killed: [], restartedExplorer: false };

    const killed = [];
    const failed = [];
    let hadExplorer = false;

    const isExpFn = (s) => {
      if (!s) return false;
      const l = String(s).toLowerCase();
      return l.includes('explorer.exe') || l === 'explorer' || l.includes('资源管理器');
    };

    for (const h of holders) {
      const isExp = isExpFn(h.name) || isExpFn(h.exe);
      const kRes = await window.services.killProcess(h.pid, true, h.name || h.exe);
      if (kRes.ok) {
        killed.push(h);
        if (isExp || kRes.restartedExplorer) hadExplorer = true;
      } else {
        if (h.handles && h.handles.length > 0) {
          let closed = true;
          for (const handleVal of h.handles) {
            const cRes = await window.services.closeHandle(h.pid, handleVal);
            if (!cRes.ok) closed = false;
          }
          if (closed) {
            killed.push(h);
          } else {
            failed.push(h);
          }
        } else {
          failed.push(h);
        }
      }
    }

    if (hadExplorer) {
      window.services.restartExplorer();
    }

    return {
      ok: failed.length === 0,
      killed,
      failed,
      restartedExplorer: hadExplorer,
      message: failed.length 
        ? `部分进程 (${failed.map(f => f.name || f.pid).join(', ')}) 无法结束` 
        : (hadExplorer ? '占用进程已结束（检测到资源管理器占用，已自动重启桌面）' : '占用进程已全部结束，文件已解锁')
    };
  },

  /** 删除文件/文件夹 */
  deletePath(targetPath) {
    return new Promise((resolve) => {
      fs.stat(targetPath, (err, st) => {
        if (err) return resolve({ ok: false, code: err.code, message: err.message });
        const cb = (e) => e ? resolve({ ok: false, code: e.code, message: e.message }) : resolve({ ok: true });
        if (st.isDirectory()) {
          fs.rm(targetPath, { recursive: true, force: true }, cb);
        } else {
          fs.unlink(targetPath, cb);
        }
      });
    });
  },

  /** 重命名 */
  renamePath(targetPath, newName) {
    return new Promise((resolve) => {
      const dir = path.dirname(targetPath);
      const safe = newName.trim();
      if (!safe) return resolve({ ok: false, message: '文件名不能为空' });
      if (/[\\/:*?"<>|]/.test(safe)) return resolve({ ok: false, message: '文件名包含非法字符' });
      const dest = path.join(dir, safe);
      fs.rename(targetPath, dest, (e) => e ? resolve({ ok: false, code: e.code, message: e.message }) : resolve({ ok: true, dest }));
    });
  },

  /** 移动 */
  movePath(targetPath, destDir) {
    return new Promise((resolve) => {
      try {
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const dest = path.join(destDir, path.basename(targetPath));
        fs.rename(targetPath, dest, (e) => e ? resolve({ ok: false, code: e.code, message: e.message }) : resolve({ ok: true, dest }));
      } catch (e) {
        resolve({ ok: false, message: e.message });
      }
    });
  },

  /** 在资源管理器中定位文件 */
  showInExplorer(targetPath) {
    return new Promise((resolve) => {
      try {
        const p = path.resolve(targetPath);
        if (fs.existsSync(p)) {
          spawn('explorer.exe', ['/select,' + p], { windowsHide: true }).on('error', () => resolve(false));
          resolve(true);
        } else {
          const dir = path.dirname(p);
          if (fs.existsSync(dir)) spawn('explorer.exe', [dir], { windowsHide: true });
          resolve(true);
        }
      } catch (e) { resolve(false); }
    });
  },

  /** 探测占用状态 */
  probeLock(targetPath) {
    return new Promise((resolve) => {
      try {
        const st = fs.statSync(targetPath);
        if (st.isDirectory()) return resolve({ locked: null });
        const fd = fs.openSync(targetPath, 'r+');
        fs.closeSync(fd);
        resolve({ locked: false });
      } catch (e) {
        if (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EBUSY') resolve({ locked: true, code: e.code });
        else resolve({ locked: null, code: e.code });
      }
    });
  },

  getPathInfo(targetPath) {
    return new Promise((resolve) => {
      fs.stat(targetPath, (err, st) => {
        if (err) return resolve({ ok: false, code: err.code });
        resolve({
          ok: true,
          isDirectory: st.isDirectory(),
          size: st.size,
          sizeStr: st.isDirectory() ? '文件夹' : (() => {
            const b = st.size; if (b >= 1024*1024*1024) return (b/1024/1024/1024).toFixed(2)+' GB';
            if (b >= 1024*1024) return (b/1024/1024).toFixed(1)+' MB';
            if (b >= 1024) return (b/1024).toFixed(1)+' KB';
            return b+' B';
          })()
        });
      });
    });
  }
};