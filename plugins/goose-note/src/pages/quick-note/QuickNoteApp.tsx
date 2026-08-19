import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CircleAlert, X, Pencil } from "lucide-react";
import {
  useQuickNote,
  buildQuickNoteDraftPage,
  getQuickNoteSlotName,
  loadQuickNoteSlotNames,
  persistQuickNoteSlotNames,
  updateQuickNoteSlotName,
  clampQuickNoteZoom,
  QUICKNOTE_MIN_WIDTH,
  QUICKNOTE_MIN_HEIGHT,
  QUICKNOTE_ZOOM_STEP,
  QUICKNOTE_SLOTS,
  isQuickNoteDraftEmpty,
  type QuickNoteSlot,
} from "@/stores/useQuickNote";
import { EditorHostBridge } from "@/pages/workspace/components/editor-host/EditorHostBridge";
import { Editor, type EditorRef } from "@/components/editor/core/Editor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Toaster } from "@/components/ui/sonner";
import { quickNoteWindow } from "@/lib/utools/quickNoteWindow";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { getContentSignature } from "@/components/editor/utils/blocknote-content";
import { QuickNoteSlotSwitcher } from "./QuickNoteSlotSwitcher";
import {
  getQuickNoteSlotShortcut,
  shouldQuickNoteEditableTargetOwnShortcut,
} from "./quickNoteShortcuts";
import { isImeKeyboardEvent } from "@/hooks/useImeInput";
import { formatShortcut, getPlatformKind } from "@/lib/utils";
import { QuickNoteCollectPreview } from "./QuickNoteCollectPreview";
import { getQuickNoteCollectVariant } from "./quickNoteCollectDetector";
import { useSettings } from "@/stores/settings";
import {
  computeEditorUiScale,
  EDITOR_UI_SCALE_CHANGE_EVENT,
} from "@/lib/appearance";

const POSITION_POLL_MS = 120;
const POSITION_SETTLE_MS = 720;

/**
 * 速记小窗根组件（独立窗口进程）。
 *
 * 小窗是「草稿便签」：不直接对应一条真实笔记，编辑内容只落到草稿存储
 * （useQuickNote.drafts[activeSlot]），不写进 pages、不进笔记列表 / 搜索、不自动存盘成文件。
 *
 * 支持 1–5 五个独立草稿槽位，各自持久化。切换槽位时重挂编辑器加载对应草稿。
 *
 * 复用主应用的编辑器内核：通过 <EditorHostBridge page={draftPage} onContentChangeOverride>
 * 注入草稿 page + 平台能力，再渲染 <Editor>。不渲染侧栏/标签栏/大纲——小窗只有编辑区。
 */
export function QuickNoteApp() {
  const editorRef = useRef<EditorRef>(null);
  const collectVariant = useMemo(
    () => getQuickNoteCollectVariant(window.location.search),
    [],
  );
  /** 撤销/重做重挂编辑器后，只静默一次同一槽位且与恢复内容签名一致的初始化同步。 */
  const restoredContentSignatureRef = useRef<{
    slot: QuickNoteSlot;
    signature: string;
  } | null>(null);

  const activeSlot = useQuickNote((s) => s.activeSlot);
  const drafts = useQuickNote((s) => s.drafts);
  const setActiveSlot = useQuickNote((s) => s.setActiveSlot);
  const setDraftContent = useQuickNote((s) => s.setDraftContent);
  const undoDraft = useQuickNote((s) => s.undoDraft);
  const redoDraft = useQuickNote((s) => s.redoDraft);
  const setWindowSize = useQuickNote((s) => s.setWindowSize);
  const setWindowPosition = useQuickNote((s) => s.setWindowPosition);
  const setEditorZoom = useQuickNote((s) => s.setEditorZoom);

  // 编辑界面缩放（持久化：下次开窗沿用上次 Cmd +/- 的程度）。
  const zoom = useQuickNote((s) => s.editorZoom);
  const editorFontSize = useSettings((s) => s.editorFontSize);

  // 速记运行在独立 WebView：全局编辑字号与小窗局部缩放共同决定工具条等
  // 编辑器 UI 的有效尺寸。卸载时不清理，避免复用窗口期间退回错误的默认值。
  useEffect(() => {
    const root = document.documentElement;
    const scale = computeEditorUiScale(editorFontSize, zoom);
    if (root.style.getPropertyValue("--editor-ui-scale") === scale) return;
    root.style.setProperty("--editor-ui-scale", scale);
    window.dispatchEvent(
      new CustomEvent(EDITOR_UI_SCALE_CHANGE_EVENT, {
        detail: { scale },
      }),
    );
  }, [editorFontSize, zoom]);

  /**
   * 撤销/重做后递增，迫使 EditorHostBridge 用最新 drafts 重建。
   * 仅依赖 activeSlot 时，关窗重开后的持久化撤销无法驱动编辑器刷新。
   */
  const [historyEpoch, setHistoryEpoch] = useState(0);
  /**
   * 按住 1–5 拖动时的临时预览槽；null 表示未在 scrub。
   * 编辑器显示 previewSlot ?? activeSlot，松手/移走后由 onChange 正式写入 activeSlot。
   */
  const [previewSlot, setPreviewSlot] = useState<QuickNoteSlot | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [renamingSlot, setRenamingSlot] = useState<QuickNoteSlot | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameFinishingRef = useRef(false);
  const [slotNames, setSlotNames] = useState(() =>
    loadQuickNoteSlotNames(useQuickNote.getState().slotNames),
  );
  const slotNamesRef = useRef(slotNames);

  const helpShortcuts = useMemo(() => {
    const platform = getPlatformKind();
    return {
      switchSlots: formatShortcut("Mod+1–5", platform),
      alternateSwitchSlots:
        platform === "windows" ? formatShortcut("Alt+1–5", platform) : null,
      zoomIn: formatShortcut("Mod+Plus", platform),
      zoomOut: formatShortcut("Mod+-", platform),
      zoomReset: formatShortcut("Mod+0", platform),
      undo: formatShortcut("Mod+Z", platform),
      redo: formatShortcut("Mod+Shift+Z", platform),
      alternateRedo: formatShortcut("Mod+Y", platform),
    };
  }, []);

  const displaySlot = previewSlot ?? activeSlot;
  const displaySlotName = getQuickNoteSlotName(displaySlot, slotNames);
  const occupiedSlots = useMemo(
    () =>
      Object.fromEntries(
        QUICKNOTE_SLOTS.map((slot) => [
          slot,
          !isQuickNoteDraftEmpty(drafts[slot] ?? null),
        ]),
      ) as Record<QuickNoteSlot, boolean>,
    [drafts],
  );

  // 草稿 page：基于显示槽位草稿现造。仅随 displaySlot / 历史恢复重建，
  // 避免编辑 onChange 回灌打断输入。预览拖动时只换显示、不改 activeSlot。
  const draftPage = useMemo(
    () => buildQuickNoteDraftPage(drafts[displaySlot] ?? null),
    // 有意不依赖 drafts 的每次击键：槽位内容变更由编辑器内部维护。
    // historyEpoch 仅在撤销/重做后变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displaySlot, historyEpoch],
  );

  // resize 抖动抑制：拖动边框期间标记，停下再持久化尺寸（见下方 resize effect）。
  const isResizingRef = useRef(false);
  const resizeSettleTimerRef = useRef<number | null>(null);

  // 草稿内容变更：写入「当前显示的槽位」（正式 active 或 scrub 预览）。
  // 用 displaySlot 闭包锁定槽号，避免切换后旧实例尾随 onChange 串写。
  const onDraftChange = useMemo(() => {
    const boundSlot = displaySlot;
    return (content: BlockNoteContent) => {
      const signature = getContentSignature(content);
      const restored = restoredContentSignatureRef.current;
      const isRestoreSync =
        restored?.slot === boundSlot && signature === restored.signature;
      if (restored?.slot === boundSlot) {
        restoredContentSignatureRef.current = null;
      }
      setDraftContent(content as never, boundSlot, {
        recordHistory: !isRestoreSync,
      });
    };
  }, [displaySlot, setDraftContent]);

  const flushEditor = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("goose-note:flush-editor", {
        detail: { immediate: true },
      }),
    );
  }, []);

  const startRename = useCallback(
    (slot: QuickNoteSlot) => {
      flushEditor();
      renameFinishingRef.current = false;
      setHelpOpen(false);
      setRenameValue(getQuickNoteSlotName(slot, slotNames));
      setRenamingSlot(slot);
    },
    [flushEditor, slotNames],
  );

  const finishRename = useCallback(
    (save: boolean) => {
      if (renamingSlot === null || renameFinishingRef.current) return;
      renameFinishingRef.current = true;
      if (save) {
        const next = updateQuickNoteSlotName(
          slotNamesRef.current,
          renamingSlot,
          renameValue,
        );
        if (next !== slotNamesRef.current) {
          slotNamesRef.current = next;
          setSlotNames(next);
          persistQuickNoteSlotNames(next);
        }
      }
      setRenamingSlot(null);
      requestAnimationFrame(() => {
        renameFinishingRef.current = false;
        editorRef.current?.editor?.focus?.();
      });
    },
    [renameValue, renamingSlot],
  );

  useEffect(() => {
    if (renamingSlot === null) return;
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renamingSlot]);

  const applyHistoryContentToEditor = useCallback(
    (content: BlockNoteContent | null) => {
      restoredContentSignatureRef.current = {
        slot: useQuickNote.getState().activeSlot,
        signature: getContentSignature(
          buildQuickNoteDraftPage(content as never).content,
        ),
      };
      setHistoryEpoch((n) => n + 1);
      requestAnimationFrame(() => {
        editorRef.current?.editor?.focus?.();
      });
    },
    [],
  );

  const handleUndo = useCallback(() => {
    flushEditor();
    const result = undoDraft();
    if (!result.applied) return false;
    applyHistoryContentToEditor(result.content as BlockNoteContent | null);
    return true;
  }, [applyHistoryContentToEditor, flushEditor, undoDraft]);

  const handleRedo = useCallback(() => {
    flushEditor();
    const result = redoDraft();
    if (!result.applied) return false;
    applyHistoryContentToEditor(result.content as BlockNoteContent | null);
    return true;
  }, [applyHistoryContentToEditor, flushEditor, redoDraft]);

  const handleSwitchSlot = useCallback(
    (
      slot: QuickNoteSlot,
      source: "pointer" | "shortcut" | "switcher-keyboard",
    ) => {
      flushEditor();
      setPreviewSlot(null);
      if (slot === useQuickNote.getState().activeSlot) return;
      setActiveSlot(slot);
      if (source !== "switcher-keyboard") {
        requestAnimationFrame(() => {
          editorRef.current?.editor?.focus?.();
        });
      }
    },
    [flushEditor, setActiveSlot],
  );

  const handleHelpOpenChange = useCallback((open: boolean) => {
    setHelpOpen(open);
  }, []);

  /** 拖动预览：只改显示槽，不写 activeSlot。 */
  const handlePreviewSlot = useCallback(
    (slot: QuickNoteSlot | null) => {
      flushEditor();
      setPreviewSlot(slot);
    },
    [flushEditor],
  );

  /** 关窗 / 收起前把当前位置写进 store + preload，保证下次 uTools 唤起仍在原处。 */
  const persistPlacementThenClose = useCallback(() => {
    flushEditor();
    const x = window.screenX;
    const y = window.screenY;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      setWindowPosition(x, y);
      quickNoteWindow.persistPosition(x, y);
    }
    quickNoteWindow.close();
  }, [flushEditor, setWindowPosition]);

  // 首帧：聚焦光标到编辑器。
  useEffect(() => {
    requestAnimationFrame(() => editorRef.current?.editor?.focus?.());
  }, []);

  // 复用窗口：父窗以「速记」再次唤起已存在的小窗时（preload 发 quicknote:enter），
  // 重新聚焦即可（草稿延续，不重解析笔记）。
  useEffect(() => {
    const handler = () => {
      requestAnimationFrame(() => editorRef.current?.editor?.focus?.());
    };
    window.addEventListener("goose-note:quicknote-enter", handler);
    return () =>
      window.removeEventListener("goose-note:quicknote-enter", handler);
  }, []);
  // 强制置顶（无失焦自动隐藏）：小窗常驻最前层，置顶由主窗 preload 在创建时设定，
  // 失焦不再触发隐藏——点窗外不会收起，只能 Esc / 关闭按钮收起。

  // 键盘：Esc 收起；macOS Cmd / Windows Alt+1~5 切换便签；Cmd/Ctrl+Z 超长期撤销；
  // Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y 重做；Cmd/Ctrl +/- 缩放编辑界面（0 复位）。
  useEffect(() => {
    const onShortcutKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isImeKeyboardEvent(e)) return;
      if (e.key === "Escape") return;
      if (
        shouldQuickNoteEditableTargetOwnShortcut(e.target as HTMLElement | null)
      ) {
        return;
      }

      const shortcutSlot = getQuickNoteSlotShortcut(e);
      if (shortcutSlot !== null) {
        e.preventDefault();
        e.stopPropagation();
        handleSwitchSlot(shortcutSlot, "shortcut");
        return;
      }

      // 仅在按下 Cmd（macOS）/ Ctrl 时处理缩放与撤销。
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      // 超长期撤销/重做：未被浮层消费时拦截默认行为，走持久化栈。
      if (key === "z") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if (key === "y" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        handleRedo();
        return;
      }

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setEditorZoom(
          clampQuickNoteZoom(
            useQuickNote.getState().editorZoom + QUICKNOTE_ZOOM_STEP,
          ),
        );
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setEditorZoom(
          clampQuickNoteZoom(
            useQuickNote.getState().editorZoom - QUICKNOTE_ZOOM_STEP,
          ),
        );
      } else if (e.key === "0") {
        e.preventDefault();
        setEditorZoom(1);
      }
    };
    const onEscapeKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isImeKeyboardEvent(e)) {
        return;
      }
      e.preventDefault();
      persistPlacementThenClose();
    };

    // 槽位和撤销快捷键需先于编辑器默认行为处理；Escape 使用冒泡阶段，
    // 让 Radix/编辑器浮层先关闭自身，未消费时才收起整窗。
    window.addEventListener("keydown", onShortcutKeyDown, true);
    window.addEventListener("keydown", onEscapeKeyDown);
    return () => {
      window.removeEventListener("keydown", onShortcutKeyDown, true);
      window.removeEventListener("keydown", onEscapeKeyDown);
    };
  }, [
    handleSwitchSlot,
    handleUndo,
    handleRedo,
    persistPlacementThenClose,
    setEditorZoom,
  ]);

  // 窗口位置记忆：用户拖动窗口移动 → 停下后记住最终位置，下次开窗沿用。
  // 轮询间隔必须短于 settle 时间，否则拖动中会反复触发持久化 IPC，导致正文重绘抖动。
  useEffect(() => {
    let lastX = window.screenX;
    let lastY = window.screenY;
    let settleTimer: number | null = null;
    const poll = window.setInterval(() => {
      const x = window.screenX;
      const y = window.screenY;
      if (x === lastX && y === lastY) return;
      lastX = x;
      lastY = y;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        const x = window.screenX;
        const y = window.screenY;
        // preload 权威写 db；store 同步一份，避免后续草稿 persist 用旧坐标盖掉位置。
        quickNoteWindow.persistPosition(x, y);
        setWindowPosition(x, y);
      }, POSITION_SETTLE_MS);
    }, POSITION_POLL_MS);
    return () => {
      window.clearInterval(poll);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, [setWindowPosition]);

  // 窗口尺寸记忆：用户拖动窗口边框改宽高 → 停下后记住最终尺寸，下次开窗沿用。
  useEffect(() => {
    const onResize = () => {
      isResizingRef.current = true;
      if (resizeSettleTimerRef.current !== null) {
        window.clearTimeout(resizeSettleTimerRef.current);
      }
      resizeSettleTimerRef.current = window.setTimeout(() => {
        resizeSettleTimerRef.current = null;
        isResizingRef.current = false;
        // 持久化由主窗用 win.getSize() 权威读取后写回 dbStorage：子窗渲染进程的
        // outerWidth 在 uTools frameless 窗口里 resize 后并不更新，直接存会记错值，
        // 导致下次开窗仍回默认宽度（用户每次都要重新拉宽）。
        quickNoteWindow.persistSize();
        // 同步进程内 store（best-effort），用视口宽高兜底，开窗尺寸以 dbStorage 为准。
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w >= QUICKNOTE_MIN_WIDTH && h >= QUICKNOTE_MIN_HEIGHT) {
          setWindowSize(w, h);
        }
      }, 240);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (resizeSettleTimerRef.current !== null) {
        window.clearTimeout(resizeSettleTimerRef.current);
        resizeSettleTimerRef.current = null;
      }
      window.removeEventListener("resize", onResize);
    };
  }, [setWindowSize]);

  const headerBar = (
    <div
      className="quicknote-titlebar-reveal-zone"
      data-renaming={renamingSlot === null ? "false" : "true"}
    >
      {renamingSlot !== null && (
        <input
          ref={renameInputRef}
          value={renameValue}
          maxLength={24}
          aria-label={`重命名便签 ${renamingSlot}`}
          className="quicknote-slot-name-input"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={() => finishRename(true)}
          onKeyDown={(event) => {
            // 中文输入法按 Enter 确认候选词时不能提前提交；keyCode 229 兼容旧 Chromium。
            if (
              isImeKeyboardEvent(event.nativeEvent) ||
              isImeKeyboardEvent(event)
            ) {
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              finishRename(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finishRename(false);
            }
          }}
        />
      )}
      <div
        className="quicknote-titlebar"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      >
        <div className="quicknote-titlebar-left">
          <button
            type="button"
            aria-label="修改标签名称"
            title={`${displaySlotName} · 修改标签名称`}
            className="quicknote-slot-name-display quicknote-titlebar-btn"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            onClick={() => startRename(activeSlot)}
          >
            <span
              key={`${displaySlot}-${displaySlotName}`}
              className="quicknote-slot-name-text"
            >
              {displaySlotName}
            </span>
          </button>
        </div>

        {/* 绝对居中，避免左右内容宽度差导致视觉偏移 */}
        <div className="quicknote-slot-switcher-positioner">
          <div className="quicknote-slot-switcher-interactive">
            <QuickNoteSlotSwitcher
              activeSlot={activeSlot}
              occupiedSlots={occupiedSlots}
              slotNames={slotNames}
              onChange={handleSwitchSlot}
              onPreviewChange={handlePreviewSlot}
              onRenameRequest={startRename}
            />
          </div>
        </div>

        <div className="quicknote-titlebar-actions">
          <Popover open={helpOpen} onOpenChange={handleHelpOpenChange}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="使用说明"
                title="使用说明"
                className="quicknote-titlebar-btn quicknote-help-trigger"
                style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
              >
                <CircleAlert className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              collisionPadding={8}
              className="quicknote-help-popover w-72 text-xs"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div className="quicknote-help-heading">
                <div className="text-sm font-medium">速记便签</div>
                <p>内容只保留在当前便签，不会自动进入笔记本。</p>
              </div>
              <button
                type="button"
                className="quicknote-help-rename flex w-full items-center gap-2 text-left text-xs text-foreground"
                onClick={() => startRename(activeSlot)}
              >
                <Pencil className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">重命名当前便签</span>
                <span className="max-w-24 truncate text-muted-foreground">
                  {getQuickNoteSlotName(activeSlot, slotNames)}
                </span>
              </button>
              <ul className="quicknote-help-list text-muted-foreground">
                <li>
                  <b className="text-foreground">切换</b>
                  ：顶部 1–5 是五个独立便签。点击或拖动切换；也可按
                  {helpShortcuts.switchSlots}
                  {helpShortcuts.alternateSwitchSlots
                    ? `，或 ${helpShortcuts.alternateSwitchSlots}`
                    : ""}
                  。
                </li>
                <li>
                  <b className="text-foreground">编辑</b>：
                  {helpShortcuts.zoomIn} / {helpShortcuts.zoomOut} 缩放，
                  {helpShortcuts.zoomReset} 复位；{helpShortcuts.undo} 撤销，
                  {helpShortcuts.redo} 或 {helpShortcuts.alternateRedo} 重做。
                </li>
                <li>
                  <b className="text-foreground">收起</b>
                  ：小窗始终置顶；按 {formatShortcut(
                    "Esc",
                    getPlatformKind(),
                  )}{" "}
                  或点右上角
                  <X className="mx-0.5 inline h-3 w-3 align-text-bottom" />
                  收起。草稿、位置、尺寸和缩放都会保留。
                </li>
              </ul>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            aria-label="关闭"
            className="quicknote-titlebar-btn quicknote-close-btn"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            onClick={() => persistPlacementThenClose()}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="quicknote-root relative flex h-screen w-screen flex-col bg-[hsl(var(--goose-editor-bg))]"
      data-collect-variant={collectVariant ?? undefined}
    >
      {headerBar}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto page-scroll-container">
        <EditorHostBridge
          key={`${displaySlot}-${historyEpoch}`}
          page={draftPage}
          isEditorFullWidth
          contentMode="raw"
          onContentChangeOverride={onDraftChange}
        >
          {/*
            用 CSS zoom（Chromium/uTools 支持）而不是 transform:scale + 反向宽高。
            transform 不改变布局盒：缩小后 width=100/zoom% 会 > 100%，父级
            overflow-y-auto 会连带出现底部横向滚动条，放大时也会出现可视高度与
            scrollHeight 不一致。zoom 同步缩放布局与绘制，滚动条只随真实内容出现。
          */}
          <div
            className="quicknote-editor-surface flex min-h-full flex-col"
            style={{ zoom } as CSSProperties}
          >
            <Editor ref={editorRef} editable showSideMenu={false} />
          </div>
        </EditorHostBridge>
      </div>
      {collectVariant && <QuickNoteCollectPreview variant={collectVariant} />}
      <Toaster
        className="quicknote-toaster"
        position="bottom-center"
        offset={{ bottom: 30, left: 24, right: 24 }}
        mobileOffset={{ bottom: 30, left: 24, right: 24 }}
        toastOptions={{
          classNames: {
            toast: "!min-w-0 !pr-10",
            // 不再覆盖 top：保留 sonner.tsx 默认的 !top-1/2 !-translate-y-1/2 垂直居中。
            closeButton: "!right-2.5",
          },
        }}
      />
    </div>
  );
}
