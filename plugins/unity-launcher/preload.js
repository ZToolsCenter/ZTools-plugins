const { scanUnityFolders } = require('./scanner');
// ZTools preload —— 独立数据，不读 Unity Hub
// ZTools 要求定义与 plugin.json feature code 对应的 exports，否则提示未配置
const ztools = window.ztools || window.utools || {};
window.exports = {
  'unity-launcher': {
    mode: 'none',
    args: {
      enter() {
        if (ztools.setExpendHeight) ztools.setExpendHeight(620);
        if (ztools.showMainWindow) ztools.showMainWindow();
      },
      leave() {}
    }
  }
};
window.services = {
  // ---------- ZTools 数据库 ----------
  dbGet(key) { return ztools.dbStorage ? ztools.dbStorage.getItem(key) : null; },
  dbSet(key, val) { return ztools.dbStorage ? ztools.dbStorage.setItem(key, val) : null; },

  // ---------- 统一的分离式启动（带错误处理，避免未捕获的 'error' 事件） ----------
  _spawnDetached(exePath, args) {
    const fs = require('fs');
    const { spawn } = require('child_process');
    if (!exePath) throw new Error('未指定 Unity.exe 路径');
    if (!fs.existsSync(exePath)) throw new Error(`编辑器不存在: ${exePath}`);
    let child;
    try {
      child = spawn(exePath, args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (e) {
      throw new Error(`启动失败: ${e.message}`);
    }
    child.on('error', (err) => {
      console.error('spawn failed:', exePath, err);
      if (ztools.showNotification) ztools.showNotification(`启动失败: ${err.message}`);
    });
    if (child.unref) child.unref();
    return child;
  },

  // ---------- 文件/目录选择（支持单个/批量扫描） ----------
  selectFolder() {
    if (!ztools.showOpenDialog) return null;
    const r = ztools.showOpenDialog({
      title: '选择 Unity 项目文件夹（或选择磁盘根目录/父文件夹以批量扫描项目）',
      properties: ['openDirectory'],
      filters: [{ name: 'Unity 项目', extensions: ['*'] }]
    });
    if (!r || !r.length) return null;
    return r[0];
  },
  scanFolderAsync(selectedPath, onProgress, options) {
    return scanUnityFolders(selectedPath, 'projects', onProgress, options);
  },
  selectEditorFolder() {
    if (!ztools.showOpenDialog) return null;
    const r = ztools.showOpenDialog({
      title: '选择磁盘或文件夹，批量扫描其中所有 Unity 编辑器',
      properties: ['openDirectory'],
      filters: [{ name: 'Unity Editor Folder', extensions: ['*'] }]
    });
    if (!r || !r.length) return null;
    return r[0];
  },
  scanEditorsAsync(selectedPath, onProgress, options) {
    return scanUnityFolders(selectedPath, 'editors', onProgress, options);
  },
  // ---------- 启动 ----------
  launch(editorPath, projectPath) {
    this._spawnDetached(editorPath, ['-projectPath', projectPath]);
    return true;
  },

  openInExplorer(p) { if (ztools.shellOpenPath) ztools.shellOpenPath(p); },

  // 读取项目当前使用的 Unity 版本（打开前刷新，避免沿用导入时的旧版本）
  readProjectVersion(projectPath) {
    const fs = require('fs');
    const path = require('path');
    try {
      const text = fs.readFileSync(path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
      return (text.match(/m_EditorVersion:\s*(\S+)/) || [])[1] || null;
    } catch (err) {
      return null;
    }
  },

  // Unity 打开项目时会持有 Temp/UnityLockfile
  isProjectLocked(projectPath) {
    const fs = require('fs');
    const path = require('path');
    try {
      return fs.existsSync(path.join(projectPath, 'Temp', 'UnityLockfile'));
    } catch (err) {
      return false;
    }
  },

  pickDirectory() {
    if (!ztools.showOpenDialog) return null;
    const r = ztools.showOpenDialog({
      title: '选择新项目的存放目录',
      properties: ['openDirectory']
    });
    return r && r.length ? r[0] : null;
  },

  createNewProject(editorPath, parentPath, name) {
    const fs = require('fs');
    const path = require('path');
    const safeName = String(name || '').trim();
    if (!safeName) {
      throw new Error('项目名称不能为空');
    }
    if (/[\\/:*?"<>|]/.test(safeName)) {
      throw new Error('项目名称不能包含 \\ / : * ? " < > | 等字符');
    }
    if (/^\.+$/.test(safeName)) {
      throw new Error('项目名称不能是 . 或 ..');
    }
    if (/[. ]$/.test(safeName)) {
      throw new Error('项目名称不能以点或空格结尾');
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(safeName)) {
      throw new Error('项目名称不能使用 Windows 保留名称（CON、PRN、AUX、NUL、COM1-9、LPT1-9）');
    }
    const targetPath = path.join(parentPath, safeName);
    if (fs.existsSync(targetPath)) {
      throw new Error('该存放目录下已存在同名文件夹！');
    }
    this._spawnDetached(editorPath, ['-createProject', targetPath]);
    return targetPath;
  },

  // 异步删除本地项目文件夹（不卡顿 UI 渲染线程）
  deleteFolderAsync(folderPath) {
    const fs = require('fs');
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(folderPath)) {
        return resolve(false);
      }
      if (fs.rm) {
        fs.rm(folderPath, { recursive: true, force: true }, (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      } else if (fs.rmdir) {
        fs.rmdir(folderPath, { recursive: true }, (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      } else {
        try {
          fs.rmSync(folderPath, { recursive: true, force: true });
          resolve(true);
        } catch (e) {
          reject(e);
        }
      }
    });
  }
};
