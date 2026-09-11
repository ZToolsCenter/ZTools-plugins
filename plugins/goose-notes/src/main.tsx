// Polyfill for older Chromium (uTools built-in)
if (typeof globalThis.structuredClone !== "function") {
  Object.defineProperty(globalThis, "structuredClone", {
    value: function structuredClonePolyfill<T>(value: T): T {
      return JSON.parse(JSON.stringify(value)) as T;
    },
    writable: true,
    configurable: true,
  });
}

if (
  typeof globalThis.crypto !== "undefined" &&
  typeof globalThis.crypto.randomUUID !== "function"
) {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: function randomUUIDPolyfill() {
      const bytes = new Uint8Array(16);
      if (typeof globalThis.crypto.getRandomValues === "function") {
        globalThis.crypto.getRandomValues(bytes);
      } else {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = Math.floor(Math.random() * 256);
        }
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      );
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    },
    writable: true,
    configurable: true,
  });
}

if (!(Array.prototype as any).toReversed) {
  Object.defineProperty(Array.prototype, "toReversed", {
    value: function (this: unknown[]) {
      return [...this].reverse();
    },
    writable: true,
    configurable: true,
  });
}

// Iterator Helpers (ES2025) polyfill — uTools 旧内核 (< Chrome 122) 缺 Iterator.prototype.*。
// @blocknote/xl-ai 直接用了 Map.prototype.values().filter()，缺失时会抛
// `s.values(...).filter is not a function`，导致 AI 调用在错误处理路径二次崩溃。
{
  const IterProto = Object.getPrototypeOf(
    Object.getPrototypeOf([][Symbol.iterator]()),
  ) as Record<string, unknown> | null;
  if (IterProto && typeof (IterProto as any).filter !== "function") {
    const define = (name: string, value: (...args: any[]) => unknown) => {
      Object.defineProperty(IterProto, name, {
        value,
        writable: true,
        configurable: true,
      });
    };

    define(
      "filter",
      function (
        this: Iterator<unknown>,
        fn: (v: unknown, i: number) => boolean,
      ) {
        // generator 内捕获 this（Iterator 实例），generator 函数不可用箭头函数替代
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const it = this;
        let i = 0;
        return (function* () {
          for (let r = it.next(); !r.done; r = it.next()) {
            if (fn(r.value, i++)) yield r.value;
          }
        })();
      },
    );
    define(
      "map",
      function (
        this: Iterator<unknown>,
        fn: (v: unknown, i: number) => unknown,
      ) {
        // generator 内捕获 this（Iterator 实例），generator 函数不可用箭头函数替代
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const it = this;
        let i = 0;
        return (function* () {
          for (let r = it.next(); !r.done; r = it.next())
            yield fn(r.value, i++);
        })();
      },
    );
    define("take", function (this: Iterator<unknown>, limit: number) {
      // generator 内捕获 this（Iterator 实例），generator 函数不可用箭头函数替代
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const it = this;
      return (function* () {
        let n = 0;
        if (n >= limit) return;
        for (let r = it.next(); !r.done; r = it.next()) {
          yield r.value;
          if (++n >= limit) return;
        }
      })();
    });
    define("drop", function (this: Iterator<unknown>, limit: number) {
      // generator 内捕获 this（Iterator 实例），generator 函数不可用箭头函数替代
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const it = this;
      return (function* () {
        let n = 0;
        for (let r = it.next(); !r.done; r = it.next()) {
          if (n++ < limit) continue;
          yield r.value;
        }
      })();
    });
    define(
      "flatMap",
      function (
        this: Iterator<unknown>,
        fn: (v: unknown, i: number) => unknown,
      ) {
        // generator 内捕获 this（Iterator 实例），generator 函数不可用箭头函数替代
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const it = this;
        let i = 0;
        return (function* () {
          for (let r = it.next(); !r.done; r = it.next()) {
            const mapped = fn(r.value, i++) as any;
            if (mapped && typeof mapped[Symbol.iterator] === "function") {
              yield* mapped;
            } else {
              yield mapped;
            }
          }
        })();
      },
    );
    define("toArray", function (this: Iterator<unknown>) {
      const out: unknown[] = [];
      for (let r = this.next(); !r.done; r = this.next()) out.push(r.value);
      return out;
    });
    define(
      "forEach",
      function (this: Iterator<unknown>, fn: (v: unknown, i: number) => void) {
        let i = 0;
        for (let r = this.next(); !r.done; r = this.next()) fn(r.value, i++);
      },
    );
    define(
      "reduce",
      function (
        this: Iterator<unknown>,
        fn: (acc: unknown, v: unknown, i: number) => unknown,
        init?: unknown,
      ) {
        let acc = init;
        let i = 0;
        let r = this.next();
        if (arguments.length < 2) {
          if (r.done)
            throw new TypeError(
              "Reduce of empty iterator with no initial value",
            );
          acc = r.value;
          r = this.next();
        }
        for (; !r.done; r = this.next()) acc = fn(acc, r.value, i++);
        return acc;
      },
    );
    define(
      "some",
      function (
        this: Iterator<unknown>,
        fn: (v: unknown, i: number) => boolean,
      ) {
        let i = 0;
        for (let r = this.next(); !r.done; r = this.next())
          if (fn(r.value, i++)) return true;
        return false;
      },
    );
    define(
      "every",
      function (
        this: Iterator<unknown>,
        fn: (v: unknown, i: number) => boolean,
      ) {
        let i = 0;
        for (let r = this.next(); !r.done; r = this.next())
          if (!fn(r.value, i++)) return false;
        return true;
      },
    );
    define(
      "find",
      function (
        this: Iterator<unknown>,
        fn: (v: unknown, i: number) => boolean,
      ) {
        let i = 0;
        for (let r = this.next(); !r.done; r = this.next())
          if (fn(r.value, i++)) return r.value;
        return undefined;
      },
    );
  }
}

import { applyRolldownPolyfills } from "@/lib/rolldown-polyfill";
applyRolldownPolyfills();

import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { toast } from "@/components/ui/sonner";
import "./index.css";
import "./fonts.css";
import {
  applyFontVariables,
  DEFAULT_FONT_NAMES,
  ensurePersistentRemoteFont,
} from "./lib/fontLoader";
import {
  applyAppearanceScaleVariables,
  clearStartupSettling,
  markStartupSettling,
} from "./lib/appearance";
import {
  migrateCodeStyleTo2026,
  runCodeStyleMigration2026,
} from "./lib/code-style-migration";
import { recoverMissingNotebooksFromPages } from "./lib/storage/recoverMissingNotebooks";
import { migrateLegacyStorage } from "./lib/storage/migrateLegacyStorage";
import { UToolsAdapter } from "./lib/utools";
import { DEFAULT_NOTEBOOK, useNotebooks } from "./stores/useNotebooks";
import { usePages } from "./stores/usePages";
import { useSettings } from "./stores/useSettings";
import { ErrorBoundary } from "./components/ErrorBoundary";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

function BootstrapScreen({ lean, error }: { lean: boolean; error?: unknown }) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : error
        ? String(error)
        : "";
  return (
    <main className="bootstrap-screen" role={error ? "alert" : "status"}>
      <div className="bootstrap-screen__mark" aria-hidden="true">
        🪿
      </div>
      {error ? (
        <>
          <h1>鹅的笔记暂时无法打开</h1>
          <p>
            {lean
              ? "速记初始化没有完成，草稿数据仍保留在本地。"
              : "初始化没有完成，本地数据不会因此被清除。"}
          </p>
          {message && <code>{message}</code>}
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </>
      ) : (
        <>
          <h1>{lean ? "正在打开速记" : "正在打开鹅的笔记"}</h1>
          <p>{lean ? "正在恢复草稿…" : "正在恢复本地笔记与设置…"}</p>
          <span className="bootstrap-screen__progress" aria-hidden="true" />
        </>
      )}
    </main>
  );
}

let flushInFlight: Promise<void> | null = null;

const flushAllPendingWrites = async () => {
  window.dispatchEvent(
    new CustomEvent("goose-note:flush-editor", {
      detail: { immediate: true },
    }),
  );
  await usePages.getState().flushPendingLocalSaves();
};

const runFlushOnce = () => {
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushAllPendingWrites().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
};

const reportFlushFailure = (error: unknown) => {
  console.error("[save-guard] pending writes flush failed", error);
  toast.error("仍有内容未完成保存", {
    id: "goose-pending-writes-failed",
    description: "最新内容已保留在恢复备份，请保持窗口打开后重试。",
    action: {
      label: "重试",
      onClick: () => retryPendingWrites(),
    },
  });
};

const retryPendingWrites = () => {
  // 所有入口都复用 runFlushOnce：连续点击或生命周期事件只共享一个在途任务。
  void runFlushOnce()
    .then(() => {
      toast.success("内容已保存", {
        id: "goose-pending-writes-failed",
        duration: 1200,
      });
    })
    .catch(reportFlushFailure);
};

const flushFromLifecycle = () => {
  void runFlushOnce().catch(reportFlushFailure);
};

const hasVisiblePagesInNotebook = (
  notebookId: string | null,
  pages: ReturnType<typeof usePages.getState>["pages"],
) => {
  if (!notebookId) return false;

  return Object.values(pages).some(
    (page) => page.workspaceId === notebookId && !page.trashedAt,
  );
};

// 「打开后 5 秒时间窗写盘守卫」（setupMarkdownOpenWriteGuard / setupLocalContentUpdateGuard /
// setupEditorMutationTracker + gooseFs monkey-patch）已整套移除：
// 打开零写盘现在由链路本身保证——编辑器层用户意图门控（Editor.tsx / EditorComposer.tsx）、
// updatePage silent 分流（stores/pages/index.ts）、写盘前 diff 兜底（write.ts + local-md-snapshot.ts）。
// goose-raw fence 的 decode 职责随之收归 write.ts 的写盘路径。

const setupSaveGuards = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const hostWindow = window as Window & {
    __gooseNoteSaveGuardInstalled?: boolean;
  };
  if (hostWindow.__gooseNoteSaveGuardInstalled) return;
  hostWindow.__gooseNoteSaveGuardInstalled = true;

  const handleManualSave = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (!event.metaKey && !event.ctrlKey) return;
    if (event.altKey || event.shiftKey || event.repeat) return;
    if (event.key.toLowerCase() !== "s") return;

    const target = document.activeElement;
    const isEditableInput =
      target instanceof HTMLElement &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    if (isEditableInput) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    // 本地文件夹来源：显式调 saveDirtyLocalPage 写盘；其它来源沿用自动保存 flush。
    const pagesState = usePages.getState();
    const activePageId = pagesState.activePageId;
    const activePage = activePageId ? pagesState.pages[activePageId] : null;
    const isLocalFile =
      Boolean(activePage?.localFilePath) &&
      useNotebooks.getState().notebooks[activePage?.workspaceId ?? ""]
        ?.source === "local-folder";

    if (isLocalFile && activePageId) {
      if (activePage?.localReadState === "error") {
        toast.error("此文件无法解析，已禁用保存", { duration: 1800 });
        return;
      }
      // 内容已自动保存；显式保存会再确保落盘并应用「标题→文件名」重命名。
      void pagesState
        .saveDirtyLocalPage(activePageId)
        .then((ok) => {
          if (ok) toast.success("已保存", { duration: 1200 });
          else {
            reportFlushFailure(new Error(`manual save failed: ${activePageId}`));
          }
        })
        .catch(reportFlushFailure);
      return;
    }

    void runFlushOnce()
      .then(() => {
        toast.success("内容已保存", { duration: 1200 });
      })
      .catch(reportFlushFailure);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flushFromLifecycle();
    }
  };

  const handleWindowBlur = () => {
    flushFromLifecycle();
  };

  const handlePageHide = () => {
    flushFromLifecycle();
  };

  const handleBeforeUnload = () => {
    flushFromLifecycle();
  };

  const handlePluginOut = () => {
    flushFromLifecycle();
  };

  document.addEventListener("keydown", handleManualSave, { capture: true });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("goose-note:plugin-out", handlePluginOut);
};

const initHostFs = async () => {
  await UToolsAdapter.ensureGooseFs();
  // uTools 没接上时（浏览器 / bun dev / web 部署），用 File System Access API
  // 作为兜底实现，让 scanner / saveLocalPageContent 走同一套 gooseFs 接口。
  if (typeof window !== "undefined" && !window.gooseFs) {
    try {
      const { installWebGooseFs } = await import("@/lib/web-fs");
      installWebGooseFs();
    } catch (err) {
      console.warn("[bootstrap] web-fs 加载失败", err);
    }
  }
};

// 渲染目标由调用方传入：主窗口（index-entry.tsx）渲染 <App/>，速记小窗（quicknote.tsx）
// 渲染 <QuickNoteApp/>，但两者复用同一套 host fs / 迁移 / hydration / guard 流程，
// 保证两个窗口进程的数据层初始化完全一致（共享 uTools db）。
//
// 注意：renderRoot 必须显式传入、本模块不再 import App。这是刻意的解耦——
// 小窗（quicknote.tsx → 本模块）不再经默认参数把整个 workspace <App/> 拖进依赖图，
// 使 quicknote 构建能甩掉 echarts / PDF 导出 / AI 图表等仅主应用需要的重型代码。
export const bootstrap = async (
  renderRoot: () => ReactNode,
  options: { lean?: boolean; beforeInit?: () => Promise<void> | void } = {},
) => {
  // lean=true（速记小窗）：跳过主应用专属的重活——加载+修复全部笔记、AI 聊天记录水合、
  // 缺失笔记本恢复、代码风格全量迁移、legacy 迁移、收件箱消费。这些与「草稿便签」无关，
  // 且 hydrateFromStorage 随笔记数线性变慢，是小窗冷启动的最大开销。
  // 仍保留：initHostFs（编辑器文件能力）、设置/字体（主题）、保存守卫（关窗 flush 草稿）。
  const { lean = false, beforeInit } = options;
  const root = createRoot(rootElement);
  // 主工作区在恢复完成前保持 index.html 的空 root，不提交启动页或首页。
  // uTools 会先显示 BrowserWindow，任何提前 render 都会成为用户看见的错误首帧。
  // 速记是独立入口，继续沿用原有的草稿初始化页，不受主工作区门控影响。
  if (lean) {
    root.render(<BootstrapScreen lean />);
  }

  try {
    await beforeInit?.();
    // DEV-only: install in-memory gooseFs mock before initHostFs（让 scanner /
    // saveLocalPageContent 走与 uTools 相同的 gooseFs 接口）。
    // Tree-shaken out of production builds via the DEV+dynamic-import pattern.
    if (import.meta.env.DEV && location.search.includes("e2eLocalMock")) {
      const { installE2ELocalMock } = await import("@/lib/dev/e2eLocalMock");
      await installE2ELocalMock();
    }

    await initHostFs();
    if (!lean) {
      await migrateLegacyStorage();
    }
    await Promise.all([
      useSettings.persist.rehydrate(),
      useNotebooks.persist.rehydrate(),
    ]);
    if (!lean) {
      // NotebookAiChats 持久化 store（skipHydration=true，需手动水合）。主应用 AI 聊天记录，小窗不需要。
      const { useNotebookAiChats } =
        await import("@/stores/useNotebookAiChats");
      useNotebookAiChats.persist.rehydrate();
      // 加载+修复全部笔记（随笔记数线性变慢）；小窗草稿是独立存储，不读 pages。
      await usePages.getState().hydrateFromStorage();
    }
    if (import.meta.env.DEV) {
      const { installTestBridge } = await import("@/testBridge");
      installTestBridge();
    }
    if (!lean) {
      const pagesStore = usePages.getState();
      const notebooksStore = useNotebooks.getState();
      const recoveredNotebooks = recoverMissingNotebooksFromPages({
        notebooks: notebooksStore.notebooks,
        pages: pagesStore.pages,
      });

      if (recoveredNotebooks) {
        const shouldFocusRecoveredNotebook = !hasVisiblePagesInNotebook(
          notebooksStore.activeNotebookId,
          pagesStore.pages,
        );
        useNotebooks.setState({
          notebooks: recoveredNotebooks.notebooks,
          ...(shouldFocusRecoveredNotebook
            ? {
                activeNotebookId:
                  recoveredNotebooks.recoveredNotebookIds[0] ?? null,
              }
            : {}),
        });
        console.warn(
          `[bootstrap] 已从页面数据恢复 ${recoveredNotebooks.recoveredCount} 个缺失记事本索引`,
        );
      }

      const nextNotebooksStore = useNotebooks.getState();
      if (
        !nextNotebooksStore.notebooks[nextNotebooksStore.activeNotebookId || ""]
      ) {
        const firstNotebookId =
          Object.keys(nextNotebooksStore.notebooks)[0] ?? DEFAULT_NOTEBOOK;
        useNotebooks.setState({ activeNotebookId: firstNotebookId });
      }
    }
    setupSaveGuards();
    if (!lean) {
      await runCodeStyleMigration2026();
    }

    const settingsStore = useSettings.getState();
    const migratedCodeStyle = migrateCodeStyleTo2026(settingsStore.codeStyle);
    if (migratedCodeStyle !== settingsStore.codeStyle) {
      settingsStore.setCodeStyle(migratedCodeStyle);
    }

    const settings = useSettings.getState();
    applyFontVariables(settings.customFonts);
    // 首帧前同步落定界面字号与编辑器缩放：窗口一出现就处于上次状态，
    // 不再先按 100% 布局、等 App effect 再跳回（用户看到的“突兀缩小”）。
    applyAppearanceScaleVariables({
      uiFontSize: settings.uiFontSize,
      editorFontSize: settings.editorFontSize,
    });

    const renderApplication = () => {
      // 首帧稳定前禁用过渡：内部组件不会从默认值播动画追赶到恢复值。
      // 解除由主 App 挂载后的 releaseStartupSettlingAfterPaint 完成；
      // 速记小窗（lean）是独立根组件，不做门控也不标记。
      if (!lean) {
        markStartupSettling();
      }
      root.render(
        <ErrorBoundary
          fallback={(error) => {
            // 渲染失败时不会有 App 挂载来解除标记，这里兜底清理（幂等）。
            clearStartupSettling();
            return <BootstrapScreen lean={lean} error={error} />;
          }}
        >
          {renderRoot()}
        </ErrorBoundary>,
      );
    };

    if (lean) {
      renderApplication();
    } else {
      const { prepareWorkspaceStartup, renderWorkspaceAfterStartup } =
        await import("@/lib/workspaceStartup");
      const startupResult = await renderWorkspaceAfterStartup({
        prepare: prepareWorkspaceStartup,
        render: renderApplication,
        renderError: (error) => {
          console.error("[bootstrap] 工作区恢复失败", error);
          clearStartupSettling();
          root.render(<BootstrapScreen lean={false} error={error} />);
        },
      });
      if (startupResult === "error") return;

      // 从持久缓存在后台安装大体积衬线字体：首次只下载一次，
      // 后续切到任意衬线体页面时已可直接渲染，不发生字体替换重排。
      void ensurePersistentRemoteFont(DEFAULT_FONT_NAMES.serif);
    }
  } catch (error) {
    console.error("[bootstrap] 初始化失败", error);
    clearStartupSettling();
    root.render(<BootstrapScreen lean={lean} error={error} />);
    return;
  }

  // 速记收件箱消费：B 插件 redirect 回传的 blocks 落库。由主应用（plugin A）消费；
  // 速记小窗自身（lean）是发送方，不接收，故跳过。
  if (lean) return;

  // 冷启动时 preload 已 push 进 window.__gooseQuickNoteInbox，mount 后在此消费；
  // 热场景（A 已在运行）通过 "goose-note:quicknote-inbox" 事件触发消费。
  const consumeQuickNoteInbox = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const inbox: string[] | undefined = w.__gooseQuickNoteInbox;
    if (!Array.isArray(inbox) || inbox.length === 0) return;
    const items = inbox.splice(0, inbox.length);
    for (const blocksJson of items) {
      try {
        const blocks = JSON.parse(blocksJson);
        const nbId =
          useNotebooks.getState().activeNotebookId ?? DEFAULT_NOTEBOOK;
        usePages
          .getState()
          .createPageRecord({ workspaceId: nbId, content: blocks });
      } catch (e) {
        console.error("[quicknote_save] 落库失败", e);
      }
    }
    // 落库后：若是被 redirect 唤起（A 本轮不是用户主动打开的），退回后台。
    if (w.__gooseQuickNoteRedirectWoke) {
      w.__gooseQuickNoteRedirectWoke = false;
      try {
        const ut = w.utools;
        if (ut && typeof ut.outPlugin === "function") {
          ut.outPlugin(false);
        }
      } catch {
        /* noop */
      }
    }
  };
  // 冷启动消费（React 刚 mount，已有积压）
  consumeQuickNoteInbox();
  // 热场景监听
  window.addEventListener("goose-note:quicknote-inbox", consumeQuickNoteInbox);

  // 主窗启动后后台静默预热所有 local-folder 记事本页面，使「所有记事本」全局搜索覆盖全量。
  // 不 await：不阻塞首屏；小窗（quicknote）不预热。idle 时机执行，避开首屏渲染高峰。
  if (rootElement.dataset.entry !== "quicknote") {
    const preloadAll = async () => {
      try {
        await usePages.getState().loadAllLocalFolderPages();
      } catch (err) {
        console.error("预加载本地文件夹页面失败", err);
      }
      import("@/lib/webdavSync")
        .then(({ triggerAutoWebdavBackup }) => {
          void triggerAutoWebdavBackup();
        })
        .catch((e) => {
          console.error("加载 webdavSync 模块失败", e);
        });
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(preloadAll, { timeout: 4000 });
    } else {
      setTimeout(preloadAll, 1500);
    }
  }
};

// 入口区分（两个独立 HTML 入口各自显式启动，本模块不再自动启动）：
// - index.html → src/index-entry.tsx：import App + 调用 bootstrap(() => <App/>)
// - quicknote.html → src/quicknote.tsx：调用 bootstrap(() => <QuickNoteApp/>)
// 自动启动逻辑下沉到 index-entry.tsx，避免本共享模块静态引用 <App/>（详见 bootstrap 注释）。
