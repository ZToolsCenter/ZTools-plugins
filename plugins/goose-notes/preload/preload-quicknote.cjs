if (window.ztools) {
  window.utools = window.ztools
}

// B 插件（鹅的速记）preload：纯速记小窗 toggle 逻辑，无主窗联动。
// CJS 运行在 uTools preload 上下文（Electron renderer），避免与 ESM 主项目冲突。
//
// 小窗双击图片需要走 openResourceExternally：把内存/库内图片落到临时文件后
// utools.shellOpenPath 交给系统查看器。主插件 preload 有完整 gooseFs；B 插件
// 子窗原先没有，会落到「当前环境不支持调用系统应用 → 内置预览 + toast」。
// 这里只补齐打开资源所需的最小 gooseFs 面，不搬主插件本地文件夹全套能力。

const fs = require("fs");
const os = require("os");
const path = require("path");

const QUICKNOTE_WIDTH = 480;
const QUICKNOTE_MIN_WIDTH = 320;
const QUICKNOTE_HEIGHT = 350;
const QUICKNOTE_MIN_HEIGHT = 300;
const QUICKNOTE_EDGE_GAP = 16;

const isFiniteNumber = (value) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value));

const normalizeWorkArea = (value) => {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
};

/**
 * 把持久化窗口 bounds 完整收进当前显示器 workArea。
 * 已经合法的位置保持不变；仅在显示器拓扑/分辨率变化后越界时才移动或缩小。
 */
const fitQuickNoteBoundsToWorkArea = (bounds, rawWorkArea) => {
  const workArea = normalizeWorkArea(rawWorkArea);
  if (!workArea) return null;

  const requestedWidth = isFiniteNumber(bounds?.width)
    ? Math.round(Number(bounds.width))
    : QUICKNOTE_WIDTH;
  const requestedHeight = isFiniteNumber(bounds?.height)
    ? Math.round(Number(bounds.height))
    : QUICKNOTE_HEIGHT;
  // 极小工作区下优先保证窗口可见；正常屏幕仍遵守 BrowserWindow 的最小尺寸。
  const minWidth = Math.min(QUICKNOTE_MIN_WIDTH, workArea.width);
  const minHeight = Math.min(QUICKNOTE_MIN_HEIGHT, workArea.height);
  const width = Math.min(workArea.width, Math.max(minWidth, requestedWidth));
  const height = Math.min(
    workArea.height,
    Math.max(minHeight, requestedHeight),
  );

  const minX = workArea.x;
  const maxX = workArea.x + workArea.width - width;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - height;
  const hasRememberedPosition =
    isFiniteNumber(bounds?.x) && isFiniteNumber(bounds?.y);
  const requestedX = hasRememberedPosition
    ? Math.round(Number(bounds.x))
    : maxX - QUICKNOTE_EDGE_GAP;
  const requestedY = hasRememberedPosition
    ? Math.round(Number(bounds.y))
    : minY + QUICKNOTE_EDGE_GAP;

  return {
    x: Math.min(maxX, Math.max(minX, requestedX)),
    y: Math.min(maxY, Math.max(minY, requestedY)),
    width,
    height,
  };
};

/**
 * 只依赖可注入的 screen API，便于在 Node 中覆盖外接屏断开场景而无需真实 Electron。
 */
const resolveQuickNoteBounds = (prefs, screenApi) => {
  const hasRememberedPosition =
    isFiniteNumber(prefs?.windowX) && isFiniteNumber(prefs?.windowY);
  let point = null;
  if (hasRememberedPosition) {
    point = {
      x: Number(prefs.windowX) + Number(prefs.windowWidth) / 2,
      y: Number(prefs.windowY) + Number(prefs.windowHeight) / 2,
    };
  } else {
    try {
      point = screenApi?.getCursorScreenPoint?.() ?? null;
    } catch {
      point = null;
    }
  }

  let display = null;
  if (point && isFiniteNumber(point.x) && isFiniteNumber(point.y)) {
    try {
      display = screenApi?.getDisplayNearestPoint?.({
        x: Math.round(Number(point.x)),
        y: Math.round(Number(point.y)),
      });
    } catch {
      display = null;
    }
  }
  const workArea = display?.workArea || display?.bounds;
  const fitted = fitQuickNoteBoundsToWorkArea(
    {
      x: hasRememberedPosition ? prefs.windowX : undefined,
      y: hasRememberedPosition ? prefs.windowY : undefined,
      width: prefs?.windowWidth,
      height: prefs?.windowHeight,
    },
    workArea,
  );
  if (fitted) return fitted;

  // screen API 不可用时维持旧行为，不凭空覆盖已记住的位置。
  return {
    ...(hasRememberedPosition
      ? {
          x: Math.round(Number(prefs.windowX)),
          y: Math.round(Number(prefs.windowY)),
        }
      : {}),
    width: Math.max(
      QUICKNOTE_MIN_WIDTH,
      Math.round(Number(prefs?.windowWidth) || QUICKNOTE_WIDTH),
    ),
    height: Math.max(
      QUICKNOTE_MIN_HEIGHT,
      Math.round(Number(prefs?.windowHeight) || QUICKNOTE_HEIGHT),
    ),
  };
};

/**
 * 把相对路径限制在 os.tmpdir() 下，防止 `../` 逃逸。
 * 与主插件 preload 的 resolveTempTargetPath 行为一致。
 */
const resolveTempTargetPath = (relativePath) => {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error("relativePath is required");
  }

  const tmpRoot = os.tmpdir();
  const normalized = path
    .normalize(relativePath)
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^[/\\]+/, "");
  const targetPath = path.join(tmpRoot, normalized);

  if (!targetPath.startsWith(tmpRoot)) {
    throw new Error("invalid temp path");
  }

  return targetPath;
};

const getBase64ByteLength = (contentBase64) => {
  const sanitized = String(contentBase64 || "").replace(/\s+/g, "");
  if (!sanitized) return 0;
  const padding = sanitized.endsWith("==")
    ? 2
    : sanitized.endsWith("=")
      ? 1
      : 0;
  return Math.floor((sanitized.length * 3) / 4) - padding;
};

const removeExpiredEntries = async (targetPath, cutoff) => {
  let stat;
  try {
    stat = await fs.promises.stat(targetPath);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    let children = [];
    try {
      children = await fs.promises.readdir(targetPath);
    } catch {
      return;
    }

    await Promise.all(
      children.map((child) =>
        removeExpiredEntries(path.join(targetPath, child), cutoff),
      ),
    );

    try {
      const remaining = await fs.promises.readdir(targetPath);
      if (remaining.length === 0) {
        await fs.promises.rmdir(targetPath);
      }
    } catch {
      /* noop */
    }
    return;
  }

  if (stat.mtimeMs >= cutoff) return;

  try {
    await fs.promises.unlink(targetPath);
  } catch (err) {
    console.error("[gooseFs/quicknote] cleanup temp file failed:", err);
  }
};

const writeTempFile = async (relativePath, contentBase64) => {
  try {
    const targetPath = resolveTempTargetPath(relativePath);
    const targetDir = path.dirname(targetPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    const expectedSize = getBase64ByteLength(contentBase64);
    try {
      const existingStat = await fs.promises.stat(targetPath);
      if (existingStat.isFile() && existingStat.size === expectedSize) {
        const now = new Date();
        await fs.promises.utimes(targetPath, now, now);
        return targetPath;
      }
    } catch {
      /* 不存在或不可 stat：继续写入 */
    }

    await fs.promises.writeFile(targetPath, contentBase64, "base64");
    return targetPath;
  } catch (err) {
    console.error("[gooseFs/quicknote] writeTempFile failed:", err);
    return null;
  }
};

const cleanupTempFiles = async (prefix, maxAgeMs) => {
  try {
    const basePath = resolveTempTargetPath(prefix);
    const cutoff = Date.now() - Number(maxAgeMs || 0);
    if (!Number.isFinite(cutoff)) return;
    await removeExpiredEntries(basePath, cutoff);
  } catch (err) {
    console.error("[gooseFs/quicknote] cleanupTempFiles failed:", err);
  }
};

/**
 * 小窗打开图片 / 附件所需的最小 gooseFs。
 * isAvailable 仅需对象存在；openResourceExternally 还会调用 writeTempFile /
 * cleanupTempFiles / existsAsync。
 */
const createQuicknoteGooseFs = () => ({
  exists: (targetPath) => {
    try {
      return fs.existsSync(targetPath);
    } catch {
      return false;
    }
  },
  existsAsync: async (targetPath) => {
    try {
      await fs.promises.access(targetPath);
      return true;
    } catch {
      return false;
    }
  },
  writeTempFile,
  cleanupTempFiles,
});

if (typeof window !== "undefined" && typeof utools !== "undefined") {
  window.utools = utools;
  // 子窗与宿主都注入：子窗双击图片依赖；宿主注入无害且便于单测/调试。
  window.gooseFs = createQuicknoteGooseFs();

  // ── 速记小窗（独立 browser 窗口）──────────────────────────────
  let quickNoteWin = null;
  // 速记小窗强制置顶：恒为最前层，无取消置顶入口（产品决定）。
  const QUICKNOTE_ALWAYS_ON_TOP = true;
  let quickNoteVisible = false;
  let quickNoteActiveMode = null;

  const QUICKNOTE_DB_KEY = "goose-note:quicknote";
  const STORAGE_DOC_PREFIX = "gn:storage:";
  const getStorageDocId = (storageKey) => `${STORAGE_DOC_PREFIX}${storageKey}`;

  /**
   * 速记 feature 进入后释放 uTools 宿主主界面：
   * - hideMainWindow：立刻收起本次命中条
   * - outPlugin(false)：插件退后台、不杀进程
   *
   * 为什么必须 outPlugin：只 hide 不 out 时，插件仍占着宿主会话；
   * 用户再按全局 uTools 热键会重新露出「鹅的小窗」宿主条，而不是主搜索界面。
   * outPlugin 默认/false 只隐藏到后台，不结束进程，createBrowserWindow 浮窗与
   * quickNoteWin 引用都保留——浮窗继续显示，不因唤起 uTools 被关掉。
   */
  const releaseHostToUToolsMain = () => {
    try {
      utools.removeSubInput?.();
    } catch {
      /* noop */
    }
    try {
      utools.hideMainWindow?.();
    } catch {
      /* noop */
    }
    try {
      // false = 不杀进程；省略参数官方语义同样是退后台。
      utools.outPlugin?.(false);
    } catch {
      /* noop */
    }
  };

  const readStoredString = (storageKey) => {
    try {
      if (utools?.db?.get) {
        const doc = utools.db.get(getStorageDocId(storageKey));
        if (typeof doc?.data === "string") return doc.data;
        if (typeof doc?.data?.value === "string") return doc.data.value;
      }
    } catch {
      /* noop */
    }

    try {
      const raw =
        utools.dbStorage && typeof utools.dbStorage.getItem === "function"
          ? utools.dbStorage.getItem(storageKey)
          : null;
      if (typeof raw === "string") {
        writeStoredString(storageKey, raw);
        return raw;
      }
    } catch {
      /* noop */
    }

    return null;
  };

  const writeStoredString = (storageKey, value) => {
    let saved = false;
    try {
      if (utools?.db?.put && utools?.db?.get) {
        const docId = getStorageDocId(storageKey);
        const current = utools.db.get(docId);
        let result = utools.db.put({
          _id: docId,
          _rev: current?._rev,
          data: { value, updatedAt: Date.now() },
        });
        if (result?.ok === false) {
          const latest = utools.db.get(docId);
          result = utools.db.put({
            _id: docId,
            _rev: latest?._rev,
            data: { value, updatedAt: Date.now() },
          });
        }
        saved = result?.ok !== false;
      }
    } catch {
      /* noop */
    }

    if (!saved) return;
    try {
      if (
        utools.dbStorage &&
        typeof utools.dbStorage.removeItem === "function"
      ) {
        utools.dbStorage.removeItem(storageKey);
      }
    } catch {
      /* noop */
    }
  };

  // 从 uTools db 文档读速记持久化偏好（与 A 插件共享同一 key，数据共通）。
  // 位置 windowX/windowY 可缺省（首次开窗或老数据）：缺省时回退到「光标屏右上角」。
  const readQuickNotePrefs = () => {
    const fallback = {
      windowWidth: QUICKNOTE_WIDTH,
      windowHeight: QUICKNOTE_HEIGHT,
      windowX: null,
      windowY: null,
    };
    try {
      const raw = readStoredString(QUICKNOTE_DB_KEY);
      if (typeof raw !== "string") return fallback;
      const parsed = JSON.parse(raw);
      const st = parsed && parsed.state ? parsed.state : parsed;
      const w = Number(st && st.windowWidth);
      const h = Number(st && st.windowHeight);
      const rawX = st && st.windowX;
      const rawY = st && st.windowY;
      // Number(null) === 0；缺省坐标不能被误当成屏幕左上角。
      const x = rawX == null ? Number.NaN : Number(rawX);
      const y = rawY == null ? Number.NaN : Number(rawY);
      return {
        windowWidth:
          Number.isFinite(w) && w >= QUICKNOTE_MIN_WIDTH
            ? Math.round(w)
            : QUICKNOTE_WIDTH,
        windowHeight:
          Number.isFinite(h) && h >= QUICKNOTE_MIN_HEIGHT
            ? Math.round(h)
            : QUICKNOTE_HEIGHT,
        windowX: Number.isFinite(x) ? Math.round(x) : null,
        windowY: Number.isFinite(y) ? Math.round(y) : null,
      };
    } catch {
      return fallback;
    }
  };

  const updateQuickNotePrefs = (patch) => {
    if (!patch || typeof patch !== "object") return;
    try {
      const raw = readStoredString(QUICKNOTE_DB_KEY);
      let parsed = {};
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw) || {};
        } catch {
          parsed = {};
        }
      }
      const hasStateWrapper =
        parsed && typeof parsed.state === "object" && parsed.state;
      const previousState = hasStateWrapper ? parsed.state : parsed;
      const state = { ...previousState, ...patch };
      const next = hasStateWrapper
        ? { ...parsed, state }
        : {
            state,
            version: typeof parsed.version === "number" ? parsed.version : 1,
          };
      writeStoredString(QUICKNOTE_DB_KEY, JSON.stringify(next));
    } catch {
      /* noop */
    }
  };

  // 把窗口当前 bounds（位置+尺寸）写回 db 文档，作为下次开窗的权威持久化来源。
  // persist-size（拖动停下）与关窗时都调用——拖动只触发 resize、移动不触发，故关窗兜底位置。
  const persistQuickNoteBounds = () => {
    if (!quickNoteWin || quickNoteWin.isDestroyed?.()) return;
    let bounds;
    try {
      bounds = quickNoteWin.getBounds?.();
    } catch {
      /* noop */
    }
    if (!bounds || typeof bounds !== "object") return;
    const w = Math.max(
      QUICKNOTE_MIN_WIDTH,
      Math.round(Number(bounds.width) || 0),
    );
    const h = Math.max(
      QUICKNOTE_MIN_HEIGHT,
      Math.round(Number(bounds.height) || 0),
    );
    const x = Math.round(Number(bounds.x));
    const y = Math.round(Number(bounds.y));
    updateQuickNotePrefs({
      windowWidth: w,
      windowHeight: h,
      ...(Number.isFinite(x) ? { windowX: x } : {}),
      ...(Number.isFinite(y) ? { windowY: y } : {}),
    });
  };

  // 只更新位置 x/y 写回 db 文档（尺寸保持库中原值）。供子窗移动上报使用：
  // 直接用传入坐标，不读 getBounds，避开关窗销毁瞬间取值不可靠的问题。
  const persistQuickNotePosition = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    updateQuickNotePrefs({ windowX: Math.round(x), windowY: Math.round(y) });
  };

  // 关窗=隐藏（不销毁）：窗口常驻后台，下次唤起秒显（省去重新加载页面 + 重跑 bootstrap）。
  // 隐藏前持久化 bounds；保留 quickNoteWin 引用、仅置 visible=false。
  // 若窗口已被宿主销毁（isDestroyed），清空引用走下次新建路径。
  // 注意：不在此处 hideMainWindow——enter 时已 outPlugin 释放宿主；
  // 若再延迟 hide 主窗，会把用户「关小窗后立刻唤起的 uTools 主界面」误关掉。
  const hideQuickNoteWindow = () => {
    if (!quickNoteWin || quickNoteWin.isDestroyed?.()) {
      quickNoteWin = null;
      quickNoteVisible = false;
      quickNoteActiveMode = null;
      return;
    }
    persistQuickNoteBounds();
    try {
      quickNoteWin.hide?.();
    } catch {
      /* noop */
    }
    quickNoteVisible = false;
    quickNoteActiveMode = null;
  };

  // 复用已隐藏的窗口：show + focus + 置顶，并推 enter 让子窗重新聚焦光标（草稿延续，不重解析）。
  // 再次显示前用持久化位置/尺寸 setBounds，避免隐藏期间被系统挪位或首次 setBounds 失败后落错位置。
  // 宿主释放由 enter 末尾 releaseHostToUToolsMain 统一做，这里只负责浮窗本体。
  const showExistingQuickNoteWindow = (mode) => {
    if (!quickNoteWin || quickNoteWin.isDestroyed?.()) return false;
    try {
      const prefs = readQuickNotePrefs();
      const restoredBounds = resolveQuickNoteBounds(prefs, utools);
      if (typeof quickNoteWin.setBounds === "function") {
        try {
          quickNoteWin.setBounds(restoredBounds);
        } catch {
          /* noop */
        }
      }
      quickNoteWin.show?.();
      quickNoteWin.focus?.();
      try {
        quickNoteWin.setAlwaysOnTop?.(true, "screen-saver");
      } catch {
        /* noop */
      }
      quickNoteVisible = true;
      quickNoteActiveMode = mode;
      try {
        quickNoteWin.webContents?.send?.("quicknote:enter", { mode });
      } catch {
        /* noop */
      }
      return true;
    } catch {
      return false;
    }
  };

  // getWindowType 三态：main=吸附在 uTools、detach=分离独立窗口、browser=createBrowserWindow 子窗。
  // B 插件：宿主（main/detach）负责开窗；子窗（browser）只走子窗侧逻辑。
  const isMainWindow =
    typeof utools.getWindowType !== "function" ||
    utools.getWindowType() !== "browser";

  // ── 子窗侧（browser）：监听父窗推过来的信号，转成 DOM 事件供 QuickNoteApp 消费 ──
  if (!isMainWindow) {
    // 注入标志：告知 QuickNoteApp 当前运行于 B 插件独立速记子窗，保存应 redirect 回 A。
    window.__GOOSE_QUICKNOTE_STANDALONE__ = true;
    try {
      const { ipcRenderer } = require("electron");
      ipcRenderer.on("quicknote:enter", (_e, data) => {
        window.dispatchEvent(
          new CustomEvent("goose-note:quicknote-enter", { detail: data || {} }),
        );
      });
      // 外部改了笔记：转 DOM 事件，小窗据此从 db 重读（防跨窗脏写）。
      ipcRenderer.on("quicknote:note-updated-from-main", (_e, pageId) => {
        window.dispatchEvent(
          new CustomEvent("goose-note:note-updated-external", {
            detail: { pageId },
          }),
        );
      });
    } catch {
      /* noop */
    }
  }

  // ── 宿主侧（main/detach）：持有 quickNoteWin，处理子窗通过 sendToParent 发来的请求 ──
  if (isMainWindow)
    try {
      const { ipcRenderer } = require("electron");

      // 强制置顶后无置顶切换入口；保留监听仅为兼容旧子窗发来的 pin 请求，不做任何操作。
      ipcRenderer.on("quicknote:pin", () => {
        /* 强制置顶，忽略 */
      });

      ipcRenderer.on("quicknote:close", () => {
        // 子窗 Esc / 关闭按钮：隐藏而非销毁，窗口常驻后台，下次唤起秒显。
        // hideQuickNoteWindow 内部已持久化 bounds（关窗是位置/尺寸终态、最可靠的记忆时机）。
        hideQuickNoteWindow();
      });

      // 自动调整高度：子窗按内容算出目标高度，请求父窗 setSize（宽度保持不变）。
      ipcRenderer.on("quicknote:set-height", (_e, height) => {
        if (!quickNoteWin || quickNoteWin.isDestroyed?.()) return;
        const h = Math.max(
          QUICKNOTE_MIN_HEIGHT,
          Math.round(Number(height) || 0),
        );
        try {
          const [w] = quickNoteWin.getSize?.() || [QUICKNOTE_WIDTH];
          quickNoteWin.setSize(w || QUICKNOTE_WIDTH, h, false);
        } catch {
          /* noop */
        }
      });

      // 用户拖动边框停下后：读真实窗口 bounds（位置+尺寸），写回 dbStorage 速记偏好（持久化）。
      ipcRenderer.on("quicknote:persist-size", () => {
        persistQuickNoteBounds();
      });

      // 用户拖动窗口移动停下后：子窗用 screenX/screenY 上报当前位置，直接写回持久化。
      // 移动不触发 resize，且关窗时 getBounds() 在窗口销毁瞬间可能取到旧值/默认值，
      // 故由子窗在移动停下时主动上报坐标，绕开 getBounds 的时机不可靠问题。
      ipcRenderer.on("quicknote:persist-position", (_e, pos) => {
        const x = Math.round(Number(pos && pos.x));
        const y = Math.round(Number(pos && pos.y));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        persistQuickNotePosition(x, y);
      });

      // 小窗改动某条笔记：B 插件无主窗，此处仅作空消费（防止 sendToParent 丢失报错）。
      ipcRenderer.on("quicknote:note-updated", (_e, _pageId) => {
        // B 无主窗，不需要跨窗同步；保留监听避免 ipc 无人接收时的警告。
      });
    } catch {
      /* noop */
    }

  // ── 打开速记小窗 ──────────────────────────────────────────────
  const openQuickNoteWindow = (mode) => {
    // 窗口常驻：再次触发 = toggle。可见 → 隐藏；已隐藏 → 秒显（复用已加载的窗口）。
    // 宿主主界面由 enter 末尾 releaseHostToUToolsMain 释放，这里不碰 hideMainWindow。
    if (quickNoteWin && !quickNoteWin.isDestroyed?.()) {
      if (quickNoteVisible) {
        hideQuickNoteWindow();
      } else {
        showExistingQuickNoteWindow(mode);
      }
      return;
    }

    // 读持久化偏好：用记住的宽高+位置开窗。
    const prefs = readQuickNotePrefs();
    const restoredBounds = resolveQuickNoteBounds(prefs, utools);
    const openWidth = restoredBounds.width;
    const openHeight = restoredBounds.height;

    const winOpts = {
      show: false,
      width: openWidth,
      height: openHeight,
      minWidth: QUICKNOTE_MIN_WIDTH,
      minHeight: QUICKNOTE_MIN_HEIGHT,
      frame: false,
      resizable: true,
      skipTaskbar: true,
      closable: true,
      alwaysOnTop: QUICKNOTE_ALWAYS_ON_TOP,
      // 小窗需要从背景中浮出来；边界感由原生外投影 + Web 内描边共同承担。
      hasShadow: true,
      roundedCorners: true,
      webPreferences: {
        preload: "preload-quicknote.js",
      },
    };

    // 位置：合法的记忆坐标原样沿用；显示器断开/分辨率变化导致越界时，
    // resolveQuickNoteBounds 会按当前最近显示器 workArea 收回可见范围。
    if (
      Number.isFinite(restoredBounds.x) &&
      Number.isFinite(restoredBounds.y)
    ) {
      winOpts.x = restoredBounds.x;
      winOpts.y = restoredBounds.y;
    }

    const url = `quicknote.html`;
    try {
      quickNoteWin = utools.createBrowserWindow(url, winOpts, () => {
        try {
          // 显式回设 bounds：部分 uTools / Electron 版本会忽略 createBrowserWindow
          // 的 winOpts.x/y（改为居中或默认位置），导致「记住的位置」开窗时不生效，
          // 表现为每次开窗都回到默认位置（用户感知为「关闭后位置被重置」）。
          // 这里在窗口就绪后用 setBounds 强制落到持久化的位置+尺寸，作为权威修正。
          if (
            typeof winOpts.x === "number" &&
            typeof winOpts.y === "number" &&
            typeof quickNoteWin.setBounds === "function"
          ) {
            try {
              quickNoteWin.setBounds({
                x: winOpts.x,
                y: winOpts.y,
                width: openWidth,
                height: openHeight,
              });
            } catch {
              /* noop */
            }
          }
          quickNoteWin.show();
          quickNoteWin.focus?.();
          quickNoteVisible = true;
          quickNoteActiveMode = mode;
          // 强制置顶：用最高层级 screen-saver，确保盖在其他置顶窗之上。
          try {
            quickNoteWin.setAlwaysOnTop(true, "screen-saver");
          } catch {
            /* noop */
          }
        } catch {
          /* noop */
        }
      });
    } catch {
      /* noop */
    }
  };

  const triggerQuickNote = (mode) => {
    openQuickNoteWindow(mode);
  };

  // 无主界面模板插件：每个 feature 用 mode:"none"，enter 回调里开浮窗。
  // 必须用 isMainWindow 守卫——子窗（browser）加载 quicknote.html 时也会跑这份 preload，
  // 不能让子窗也定义 window.exports（否则覆盖宿主入口、重复定义）。
  if (isMainWindow) {
    const enterQuickNote = (mode) => {
      try {
        triggerQuickNote(mode);
      } catch {
        /* noop */
      }
      // 官方 mode:none 范式：hideMainWindow + outPlugin。
      // 释放宿主后，全局 uTools 热键应回到主搜索界面；浮窗本身不在此处隐藏。
      releaseHostToUToolsMain();
    };
    window.exports = {
      quicknote_new: {
        mode: "none",
        args: {
          enter: () => enterQuickNote("new"),
        },
      },
      quicknote_last: {
        mode: "none",
        args: {
          enter: () => enterQuickNote("last"),
        },
      },
    };

    // onPluginOut：绝不能 hide/destroy 浮窗（用户要的是小窗常驻 + uTools 主界面可用）。
    // isKill=true 时进程将被回收，清空引用避免悬挂；浮窗随进程一起走。
    if (typeof utools.onPluginOut === "function") {
      utools.onPluginOut((isKill) => {
        if (isKill === true) {
          try {
            persistQuickNoteBounds();
          } catch {
            /* noop */
          }
          quickNoteWin = null;
          quickNoteVisible = false;
          quickNoteActiveMode = null;
        }
      });
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fitQuickNoteBoundsToWorkArea,
    resolveQuickNoteBounds,
    resolveTempTargetPath,
    getBase64ByteLength,
    writeTempFile,
    cleanupTempFiles,
    createQuicknoteGooseFs,
  };
}
