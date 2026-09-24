// uTools 宿主能力（CJS，与 preload 同风格）。
// 仅封装窗口/主题/插件进出；storage、gooseFs、gooseAiContext 仍在 preload。

/** 默认展开高度（与 pluginSetting.height 一致） */
const DEFAULT_HEIGHT = 800;
/**
 * 最小高度：480 兼顾小屏；低于此值可读性差。
 * 与 pluginSetting 初始高度解耦，仅作 setExpendHeight 下限。
 */
const MIN_HEIGHT = 480;
/** 最大高度：避免占满超大屏、滚动区域失控 */
const MAX_HEIGHT = 1200;

/** 用户自定义窗口高度（ga: 前缀，与本插件存储约定一致） */
const WINDOW_HEIGHT_KEY = "ga:windowHeight";

/**
 * @param {number} h
 * @returns {number}
 */
function clampHeight(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return DEFAULT_HEIGHT;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(n)));
}

/**
 * @param {typeof utools | undefined} u
 * @param {string} key
 * @returns {unknown}
 */
function dbGet(u, key) {
  try {
    if (typeof u?.dbStorage?.getItem === "function") {
      return u.dbStorage.getItem(key);
    }
  } catch (err) {
    console.error("[goose-agent] dbStorage get failed:", err);
  }
  return null;
}

/**
 * @param {typeof utools | undefined} u
 * @param {string} key
 * @param {unknown} value
 */
function dbSet(u, key, value) {
  try {
    if (typeof u?.dbStorage?.setItem === "function") {
      u.dbStorage.setItem(key, value);
      return true;
    }
  } catch (err) {
    console.error("[goose-agent] dbStorage set failed:", err);
  }
  return false;
}

/**
 * @param {typeof utools | undefined} u
 * @returns {number | null}
 */
function readStoredHeight(u) {
  const raw = dbGet(u, WINDOW_HEIGHT_KEY);
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return clampHeight(n);
}

/**
 * 安装 uTools 宿主：window.utools、进出事件、主题、窗口高度。
 * @returns {{ hideWindow: Function, showWindow: Function, outPlugin: Function, setWindowHeight: Function, getWindowHeight: Function } | null}
 */
function installUtoolsHost() {
  if (typeof window === "undefined" || typeof utools === "undefined") {
    return null;
  }

  window.utools = utools;

  const safeCall = (fn, ...args) => {
    try {
      if (typeof fn === "function") return fn(...args);
    } catch (err) {
      console.error("[goose-agent] utools api failed:", err);
    }
    return undefined;
  };

  /** @type {number} */
  let currentHeight = readStoredHeight(utools) ?? DEFAULT_HEIGHT;

  /**
   * @param {number} h
   * @returns {number} 实际生效高度
   */
  const applyWindowHeight = (h) => {
    const next = clampHeight(h);
    currentHeight = next;
    safeCall(utools?.setExpendHeight, next);
    return next;
  };

  // 安装时立刻应用（存储高度或默认 800）
  applyWindowHeight(currentHeight);

  utools.onPluginEnter(({ code, type, payload }) => {
    // 每次进入重新 apply，避免宿主重置后高度丢失
    applyWindowHeight(currentHeight);
    window.dispatchEvent(
      new CustomEvent("goose-agent:plugin-enter", {
        detail: { code, type, payload },
      }),
    );
  });

  if (typeof utools.onPluginOut === "function") {
    utools.onPluginOut(() => {
      window.dispatchEvent(new CustomEvent("goose-agent:plugin-out"));
    });
  }

  try {
    const { nativeTheme } = require("electron");
    if (nativeTheme) {
      nativeTheme.on("updated", () => {
        window.dispatchEvent(
          new CustomEvent("goose-agent:theme-changed", {
            detail: { isDark: nativeTheme.shouldUseDarkColors },
          }),
        );
      });
    }
  } catch (err) {
    console.error("[goose-agent] nativeTheme listener failed:", err);
  }

  return {
    hideWindow: () => {
      safeCall(utools?.hideMainWindow);
    },
    showWindow: () => {
      safeCall(utools?.showMainWindow);
    },
    outPlugin: () => {
      safeCall(utools?.outPlugin);
    },
    /**
     * clamp → setExpendHeight → 持久化 → 返回实际高度
     * @param {number} height
     * @returns {number}
     */
    setWindowHeight: (height) => {
      const next = applyWindowHeight(height);
      dbSet(utools, WINDOW_HEIGHT_KEY, next);
      return next;
    },
    /** @returns {number} 当前生效高度 */
    getWindowHeight: () => currentHeight,
  };
}

module.exports = {
  DEFAULT_HEIGHT,
  MIN_HEIGHT,
  MAX_HEIGHT,
  WINDOW_HEIGHT_KEY,
  clampHeight,
  installUtoolsHost,
};
