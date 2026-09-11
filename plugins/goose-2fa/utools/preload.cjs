if (window.ztools) {
  window.utools = window.ztools
}

if (typeof window !== "undefined" && typeof utools !== "undefined") {
  window.utools = utools;

  const ACCOUNTS_KEY = "goose-2fa-accounts";
  const GROUPS_KEY = "goose-2fa-groups";

  const readJsonArray = (key, label) => {
    try {
      if (typeof utools?.dbStorage?.getItem === "function") {
        const raw = utools.dbStorage.getItem(key);
        if (typeof raw === "string") {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        }
        if (Array.isArray(raw)) return raw;
      }
    } catch (err) {
      console.error(`[goose-2fa] read ${label} failed:`, err);
    }
    return [];
  };

  const writeJsonArray = (key, value, label) => {
    try {
      if (typeof utools?.dbStorage?.setItem === "function") {
        utools.dbStorage.setItem(key, JSON.stringify(value));
        return true;
      }
    } catch (err) {
      console.error(`[goose-2fa] write ${label} failed:`, err);
    }
    return false;
  };

  const readAccounts = () => readJsonArray(ACCOUNTS_KEY, "accounts");
  const writeAccounts = (accounts) => writeJsonArray(ACCOUNTS_KEY, accounts, "accounts");
  const readGroups = () => readJsonArray(GROUPS_KEY, "groups");
  const writeGroups = (groups) => writeJsonArray(GROUPS_KEY, groups, "groups");

  const readClipboardImage = () => {
    try {
      const electron = require("electron");
      if (!electron || !electron.clipboard) return null;
      const img = electron.clipboard.readImage();
      if (!img || img.isEmpty()) return null;
      const { width, height } = img.getSize();
      const bitmap = img.toBitmap();
      const rgba = new Uint8ClampedArray(bitmap.length);
      for (let i = 0; i < bitmap.length; i += 4) {
        rgba[i] = bitmap[i + 2];
        rgba[i + 1] = bitmap[i + 1];
        rgba[i + 2] = bitmap[i];
        rgba[i + 3] = bitmap[i + 3];
      }
      return { width, height, data: Array.from(rgba) };
    } catch (err) {
      console.error("[goose-2fa] read clipboard image failed:", err);
      return null;
    }
  };

  const captureScreen = (callback) => {
    try {
      if (typeof utools?.screenCapture === "function") {
        let settled = false;
        utools.hideMainWindow();
        utools.screenCapture((base64) => {
          if (settled) return;
          settled = true;
          utools.showMainWindow();
          callback(base64 || null);
        });
        // 兜底：截屏 60 秒无响应则恢复窗口
        setTimeout(() => {
          if (settled) return;
          settled = true;
          utools.showMainWindow();
          callback(null);
        }, 60000);
        return true;
      }
    } catch (err) {
      console.error("[goose-2fa] screen capture failed:", err);
    }
    return false;
  };

  const saveToFile = (content, defaultName) => {
    try {
      const fs = require("fs");
      const filePath = utools.showSaveDialog({
        title: "导出备份",
        defaultPath: defaultName,
        buttonLabel: "保存",
        filters: [{ name: "JSON 文件", extensions: ["json"] }],
      });
      if (!filePath) return false;
      fs.writeFileSync(filePath, content, "utf-8");
      return true;
    } catch (err) {
      console.error("[goose-2fa] save file failed:", err);
      return false;
    }
  };

  const readFromFile = () => {
    try {
      const fs = require("fs");
      const paths = utools.showOpenDialog({
        title: "导入备份",
        buttonLabel: "选择",
        filters: [{ name: "备份文件", extensions: ["json", "txt"] }],
        properties: ["openFile"],
      });
      if (!paths || paths.length === 0) return null;
      return fs.readFileSync(paths[0], "utf-8");
    } catch (err) {
      console.error("[goose-2fa] read file failed:", err);
      return null;
    }
  };

  /** 子搜索框 handler，由 React 侧通过 window.goose2fa.setSubInput 注册。 */
  let subInputHandler = null;
  const safeCall = (fn, ...args) => {
    try {
      if (typeof fn === "function") return fn(...args);
    } catch (err) {
      console.error("[goose-2fa] utools api failed:", err);
    }
    return undefined;
  };

  window.goose2fa = {
    loadAccounts: readAccounts,
    saveAccounts: writeAccounts,
    loadGroups: readGroups,
    saveGroups: writeGroups,
    copyText: (text) => {
      safeCall(utools?.copyText, text);
    },
    showNotification: (text) => {
      safeCall(utools?.showNotification, text);
    },
    readClipboardImage,
    readClipboardText: () => {
      try {
        const electron = require("electron");
        if (electron?.clipboard) {
          return electron.clipboard.readText() || "";
        }
      } catch {}
      return "";
    },
    captureScreen,
    saveToFile,
    readFromFile,
    hideWindow: () => {
      safeCall(utools?.hideMainWindow);
    },
    showWindow: () => {
      safeCall(utools?.showMainWindow);
    },

    /** uTools 子搜索框 API 包装 */
    setSubInput: (handler, placeholder, initial) => {
      subInputHandler = typeof handler === "function" ? handler : null;
      const ok = safeCall(
        utools?.setSubInput,
        ({ text }) => {
          if (subInputHandler) subInputHandler(text || "");
        },
        placeholder || "搜索账户...",
        true,
      );
      if (typeof initial === "string" && initial.length > 0) {
        safeCall(utools?.setSubInputValue, initial);
      }
      return ok === true;
    },
    removeSubInput: () => {
      subInputHandler = null;
      safeCall(utools?.removeSubInput);
    },
    /** 粘贴到上一个聚焦窗口；返回 boolean */
    pasteText: (text) => {
      const ok = safeCall(utools?.hideMainWindowPasteText, text);
      return ok === true;
    },
    /** 模拟键盘输入（防剪贴板被监听场景） */
    typeString: (text) => {
      const ok = safeCall(utools?.hideMainWindowTypeString, text);
      return ok === true;
    },
    outPlugin: () => {
      safeCall(utools?.outPlugin);
    },
  };

  utools.onPluginEnter(({ code, type, payload }) => {
    window.dispatchEvent(
      new CustomEvent("goose-2fa:plugin-enter", {
        detail: { code, type, payload },
      }),
    );
  });

  if (typeof utools.onPluginOut === "function") {
    utools.onPluginOut(() => {
      subInputHandler = null;
      window.dispatchEvent(new CustomEvent("goose-2fa:plugin-out"));
    });
  }

  // 监听系统主题变化（Electron nativeTheme）
  try {
    const { nativeTheme } = require("electron");
    if (nativeTheme) {
      nativeTheme.on("updated", () => {
        window.dispatchEvent(
          new CustomEvent("goose-2fa:theme-changed", {
            detail: { isDark: nativeTheme.shouldUseDarkColors },
          }),
        );
      });
    }
  } catch (err) {
    console.error("[goose-2fa] nativeTheme listener failed:", err);
  }
}
