/**
 * LocalFileTitle —— local-folder 页面的虚拟文件名大标题。
 *
 * 只渲染 page.localFilePath 非空时。
 * 纯展示层，**不写入 page.content**。
 * 盒模型逐项复刻 BlockNote H1 首块，保证与内部笔记本标题视觉一致：
 *   字号 = 编辑器字号 × 3（跟随 --editor-font-size 设置）、行高 1.5（bn-block-outer）、
 *   上 18px / 下 3px 内边距（heading / bn-block-content）、块底 margin 0.5em（bn-block-outer）。
 *   letter-spacing 不显式设置，与 h1 一样继承 body 的 0.01em。
 *
 * 点击进入行内编辑：Enter/失焦提交，Esc 取消。
 * 新建页会通过 requestPageTitleFocus 自动进入编辑，光标落在文件名末尾。
 * 提交后调用 usePages.renameLocalPageFile(pageId, newBaseName)。
 * 空名保存为「未命名」；重名/非法字符 → sonner toast 提示，标题回退原值。
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "@/components/ui/sonner";
import { usePages } from "@/stores/usePages";
import { sanitizeFilenameSegment, splitFilePath } from "@/lib/local-title-binding";
import { UNTITLED_PAGE_TITLE } from "@/components/editor/utils/page-title";
import {
  completePageTitleFocus,
  isPageTitleFocusRequested,
  subscribePageTitleFocus,
} from "@/lib/page-title-focus";
import { useImeInput } from "@/hooks/useImeInput";

interface LocalFileTitleProps {
  pageId: string;
  localFilePath: string;
  onEnterBelow?: () => void;
}

export function LocalFileTitle({
  pageId,
  localFilePath,
  onEnterBelow,
}: LocalFileTitleProps) {
  // Derive display name from the current file path (re-derives on pageId change / rename).
  const displayName = (() => {
    const { base } = splitFilePath(localFilePath);
    return base || UNTITLED_PAGE_TITLE;
  })();

  const [initiallyFocused] = useState(() =>
    isPageTitleFocusRequested(pageId),
  );
  const [editing, setEditing] = useState(initiallyFocused);
  const {
    value: editValue,
    valueRef: editValueRef,
    setValue: setEditValue,
    isComposing,
    inputProps: imeInputProps,
  } = useImeInput(displayName);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextBlurCommitRef = useRef(false);

  // Sync displayName → editValue when not editing (handles external renames).
  useEffect(() => {
    if (!editing) {
      setEditValue(displayName);
    }
  }, [displayName, editing]);

  const startEditing = useCallback(() => {
    setEditValue(displayName);
    setEditing(true);
  }, [displayName]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditValue(displayName);
  }, [displayName]);

  const commitRename = useCallback(async () => {
    const trimmed = editValueRef.current.trim() || UNTITLED_PAGE_TITLE;

    const sanitized = sanitizeFilenameSegment(trimmed);
    if (!sanitized) {
      toast.error("文件名含非法字符，请重新输入");
      cancelEditing();
      return;
    }

    // No change — skip API call.
    const { base: currentBase } = splitFilePath(localFilePath);
    if (sanitized === currentBase) {
      setEditing(false);
      return;
    }

    setEditing(false);

    try {
      await usePages.getState().renameLocalPageFile(pageId, sanitized);
    } catch (err) {
      toast.error((err as Error).message ?? "重命名失败");
    }
  }, [editValueRef, localFilePath, pageId, cancelEditing]);

  // 新建页标题聚焦：多次重试抢过编辑器 body 的程序性 focus。
  useEffect(() => {
    const timers: number[] = [];
    const scheduleStableFocus = () => {
      [0, 50, 150, 300, 600].forEach((delay, index, delays) => {
        timers.push(
          window.setTimeout(() => {
            if (!isPageTitleFocusRequested(pageId)) return;
            setEditing(true);
            setEditValue(displayName);
            const input = inputRef.current;
            if (!input?.isConnected) return;
            input.focus({ preventScroll: true });
            const caret = input.value.length;
            input.setSelectionRange(caret, caret);
            if (
              index === delays.length - 1 &&
              document.activeElement === input
            ) {
              completePageTitleFocus(pageId);
            }
          }, delay),
        );
      });
    };

    if (initiallyFocused && isPageTitleFocusRequested(pageId)) {
      scheduleStableFocus();
    }
    const unsubscribe = subscribePageTitleFocus((requestedPageId) => {
      if (
        requestedPageId === pageId &&
        isPageTitleFocusRequested(pageId)
      ) {
        scheduleStableFocus();
      }
    });
    return () => {
      unsubscribe();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [displayName, initiallyFocused, pageId]);

  // Auto-focus input on enter editing mode (manual click path).
  useEffect(() => {
    if (editing) {
      const input = inputRef.current;
      if (input && document.activeElement !== input) {
        input.focus();
        const caret = input.value.length;
        input.setSelectionRange(caret, caret);
      }
    }
  }, [editing]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (isComposing(e)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        skipNextBlurCommitRef.current = true;
        void commitRename().then(() => {
          onEnterBelow?.();
        });
      } else if (e.key === "Escape") {
        e.preventDefault();
        skipNextBlurCommitRef.current = true;
        cancelEditing();
      }
    },
    [commitRename, cancelEditing, isComposing, onEnterBelow],
  );

  if (editing) {
    return (
      <div
        className="local-file-title-wrapper"
        style={{
          paddingTop: 18,
          paddingBottom: 3,
          marginBottom: "calc(var(--editor-font-size, 16px) * 0.5)",
        }}
      >
        <input
          ref={inputRef}
          value={editValue}
          {...imeInputProps}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (isComposing()) return;
            // 新建页切换期间编辑器会短暂抢焦；聚焦请求尚未完成时忽略这次
            // 程序性 blur，避免提前退出编辑态。
            if (isPageTitleFocusRequested(pageId)) return;
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false;
              return;
            }
            void commitRename();
          }}
          autoFocus={initiallyFocused}
          style={{
            fontSize: "calc(var(--editor-font-size, 16px) * 3)",
            fontWeight: 700,
            lineHeight: 1.5,
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            padding: 0,
            margin: 0,
            color: "inherit",
            fontFamily: "inherit",
            // Block-level input, matching the h1 display
            display: "block",
          }}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    );
  }

  return (
    <div
      className="local-file-title-wrapper"
      style={{
        paddingTop: 18,
        paddingBottom: 3,
        marginBottom: "calc(var(--editor-font-size, 16px) * 0.5)",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={startEditing}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            startEditing();
          }
        }}
        title="点击重命名文件"
        style={{
          fontSize: "calc(var(--editor-font-size, 16px) * 3)",
          fontWeight: 700,
          lineHeight: 1.5,
          cursor: "text",
          wordBreak: "break-word",
          outline: "none",
          // No background/border — purely text, like BlockNote H1
          color: "inherit",
          fontFamily: "inherit",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {displayName}
      </div>
    </div>
  );
}
