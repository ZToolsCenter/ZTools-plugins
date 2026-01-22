// preload 运行在 CJS，避免与主项目 ESM 冲突
const fs = require("fs");
const path = require("path");

window.utools = {
  ...window.ztools
}

if (typeof window !== "undefined" && typeof utools !== "undefined") {
  window.utools = utools;
  const PENDING_OPEN_FOLDER_KEY = "__gooseNotePendingOpenFolder";

  // 本地文件变更监听映射
  const watchers = new Map();
  // 最近写入的文件标记，用于避免自己写入触发重载提示
  const recentWrites = new Map();

  // 本地文件系统 API 桥接（仅用于本地文件夹模式）
  window.gooseFs = {
    readDir: (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          path: path.join(dir, entry.name),
        }));
      } catch (err) {
        console.error("[gooseFs] readDir failed:", err);
        return [];
      }
    },

    readFile: (filePath) => {
      try {
        return fs.readFileSync(filePath, "utf-8");
      } catch (err) {
        console.error("[gooseFs] readFile failed:", err);
        return null;
      }
    },

    writeFile: (filePath, content) => {
      try {
        fs.writeFileSync(filePath, content, "utf-8");
        // 标记最近写入，防止 watch 误触发重载提示
        recentWrites.set(filePath, Date.now());
        return true;
      } catch (err) {
        console.error("[gooseFs] writeFile failed:", err);
        return false;
      }
    },

    exists: (filePath) => {
      try {
        return fs.existsSync(filePath);
      } catch (err) {
        console.error("[gooseFs] exists failed:", err);
        return false;
      }
    },

    watch: (dirPath, callback) => {
      try {
        // 如果已经存在监听器，先停止
        if (watchers.has(dirPath)) {
          watchers.get(dirPath).close();
        }

        const watcher = fs.watch(
          dirPath,
          { recursive: true },
          (eventType, filename) => {
            if (filename) {
              const fullPath = path.join(dirPath, filename);
              // 检查是否为最近写入的文件，避免误触发重载提示
              const now = Date.now();
              let skip = false;
              for (const [key, time] of recentWrites) {
                if (now - time >= 1000) {
                  recentWrites.delete(key);
                  continue;
                }
                if (fullPath === key || fullPath.startsWith(key)) {
                  skip = true;
                  break;
                }
              }
              if (skip) return; // 跳过自己写入/删除的文件

              // 通知前端有文件变更
              window.dispatchEvent(
                new CustomEvent("goose-note:file-changed", {
                  detail: { eventType, filename, dirPath },
                }),
              );
            }
          },
        );

        watchers.set(dirPath, watcher);
        return watcher;
      } catch (err) {
        console.error("[gooseFs] watch failed:", err);
        return null;
      }
    },

    unwatch: (dirPath) => {
      const watcher = watchers.get(dirPath);
      if (watcher) {
        watcher.close();
        watchers.delete(dirPath);
      }
    },

    mkdir: (dirPath) => {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
        return true;
      } catch (err) {
        console.error("[gooseFs] mkdir failed:", err);
        return false;
      }
    },

    deleteFile: (filePath) => {
      try {
        fs.unlinkSync(filePath);
        recentWrites.set(filePath, Date.now());
        return true;
      } catch (err) {
        console.error("[gooseFs] deleteFile failed:", err);
        return false;
      }
    },

    deleteDir: (dirPath) => {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        recentWrites.set(`${dirPath}${path.sep}`, Date.now());
        return true;
      } catch (err) {
        console.error("[gooseFs] deleteDir failed:", err);
        return false;
      }
    },

    rename: (oldPath, newPath) => {
      try {
        fs.renameSync(oldPath, newPath);
        recentWrites.set(oldPath, Date.now());
        recentWrites.set(newPath, Date.now());
        return true;
      } catch (err) {
        console.error("[gooseFs] rename failed:", err);
        return false;
      }
    },
  };

  // 处理 uTools 全局搜索（sublist）点击
  // 注意：sublist API 可能不是所有 uTools 版本都支持
  if (typeof utools.onSublistEnter === "function") {
    utools.onSublistEnter((item) => {
      const pageId = item.url.replace("goose-note://page/", "");

      // 通知应用切换页面
      window.dispatchEvent(
        new CustomEvent("goose-note:navigate", {
          detail: { pageId },
        }),
      );
    });
  }

  const dispatchOpenFolder = (folderPath) => {
    window[PENDING_OPEN_FOLDER_KEY] = folderPath;
    window.dispatchEvent(
      new CustomEvent("goose-note:open-folder", {
        detail: { path: folderPath },
      }),
    );
  };

  utools.onPluginEnter(({ code, type, payload }) => {
    if (code !== "open_folder") return;
    if (type !== "files" && type !== "file") return;
    if (!payload || payload.length === 0) return;

    const folderPath = payload[0]?.path;
    if (!folderPath) return;

    try {
      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) return;
    } catch (err) {
      console.error("[gooseFs] stat failed:", err);
      return;
    }

    dispatchOpenFolder(folderPath);
  });

  if (typeof utools.setSubInput === "function") {
    const UTOOLS_INPUT_EVENT = "goose-note:utools-search";
    const APP_SYNC_EVENT = "goose-note:utools-search-sync";
    let suppressNextChange = false;
    let lastAppValue = "";

    utools.setSubInput(
      ({ text }) => {
        if (suppressNextChange && text === lastAppValue) {
          suppressNextChange = false;
          return;
        }

        window.dispatchEvent(
          new CustomEvent(UTOOLS_INPUT_EVENT, {
            detail: { text },
          }),
        );
      },
      "搜索笔记",
      true,
    );

    if (typeof utools.onPluginOut === "function") {
      utools.onPluginOut(() => {
        if (typeof utools.removeSubInput === "function") {
          utools.removeSubInput();
        }
      });
    }

    window.addEventListener(APP_SYNC_EVENT, (event) => {
      const detail = event.detail || {};
      const text = typeof detail.text === "string" ? detail.text : "";
      if (text === lastAppValue) return;
      lastAppValue = text;
      if (typeof utools.setSubInputValue === "function") {
        suppressNextChange = true;
        utools.setSubInputValue(text);
      }
    });
  }
}
