import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import {
  getPageTitle,
  UNTITLED_PAGE_TITLE,
  withInternalPageTitle,
} from "@/components/editor/utils/page-title";
import { extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import { usePages } from "@/stores/usePages";
import type { Page } from "@/types";
import {
  completePageTitleFocus,
  isPageTitleFocusRequested,
  subscribePageTitleFocus,
} from "@/lib/page-title-focus";
import { useImeInput } from "@/hooks/useImeInput";
import { splitFilePath } from "@/lib/local-title-binding";

interface SingleTabTitleProps {
  page: Page;
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

export function SingleTabTitle({ page }: SingleTabTitleProps) {
  const currentTitle = getPageTitle(page);
  const [initiallyFocused] = useState(() =>
    isPageTitleFocusRequested(page.id),
  );
  const {
    value,
    valueRef,
    setValue,
    isComposing,
    inputProps: imeInputProps,
  } = useImeInput(initiallyFocused ? "" : currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);
  const skipNextBlurCommitRef = useRef(false);

  const focusAsNewPage = useCallback(() => {
    setValue("");
  }, [setValue]);

  useLayoutEffect(() => {
    let focusFrame: number | null = null;
    let retryTimer: number | null = null;
    const stopAutoFocusOnUserPointerDown = (event: PointerEvent) => {
      if (!isPageTitleFocusRequested(page.id)) return;
      const input = inputRef.current;
      if (
        input &&
        event.target instanceof Node &&
        input.contains(event.target)
      ) {
        return;
      }

      // 挂载期的定时重试只用于抵抗编辑器自身的程序性 focus。
      // 用户已经主动点击正文或其他控件时，应立即尊重这次选择，避免后续重试抢回标题。
      completePageTitleFocus(page.id);
    };
    const focusOnce = () => {
      if (!isPageTitleFocusRequested(page.id)) return true;
      const input = inputRef.current;
      if (!input?.isConnected) return false;
      input.focus({ preventScroll: true });
      if (document.activeElement !== input) return false;
      // 首次真正聚焦成功就结束请求；之后不再用定时器反复 focus，
      // 因此组件重渲染或用户转去正文都不会产生第二次可见焦点框。
      completePageTitleFocus(page.id);
      return true;
    };
    const scheduleFocus = () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      focusFrame = window.requestAnimationFrame(() => {
        focusFrame = null;
        focusAsNewPage();
        if (focusOnce()) return;
        // 仅当首帧 DOM 尚未可聚焦时兜底一次；成功过的 input 永不重试。
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          focusOnce();
        }, 50);
      });
    };

    document.addEventListener(
      "pointerdown",
      stopAutoFocusOnUserPointerDown,
      true,
    );
    const unsubscribe = subscribePageTitleFocus((pageId) => {
      if (pageId === page.id && isPageTitleFocusRequested(page.id)) {
        scheduleFocus();
      }
    });
    // pendingPageId 是 React 外部状态：请求可能发生在 render 与本 layout effect
    // 订阅建立之间。订阅后立即补读一次，避免错过已经派发的事件；StrictMode
    // 重挂载时也会从当前 pending 恢复，但成功聚焦后请求已完成，不会重复 focus。
    if (isPageTitleFocusRequested(page.id)) {
      scheduleFocus();
    }
    return () => {
      unsubscribe();
      document.removeEventListener(
        "pointerdown",
        stopAutoFocusOnUserPointerDown,
        true,
      );
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [focusAsNewPage, page.id]);

  const commit = useCallback(async (moveToBody = false) => {
    if (committingRef.current) return;
    const nextTitle = valueRef.current.trim() || UNTITLED_PAGE_TITLE;
    if (INVALID_FILENAME_CHARS.test(nextTitle)) {
      toast.error('标题不能包含 \\ / : * ? " < > |');
      inputRef.current?.focus();
      return;
    }
    const storedTitle = page.localFilePath
      ? currentTitle
      : extractTitleFromContent(page.content).trim();
    if (nextTitle === currentTitle && storedTitle === currentTitle) {
      setValue(nextTitle);
      if (moveToBody) {
        window.dispatchEvent(new CustomEvent("goose-note:focus-editor-body"));
      }
      return;
    }

    committingRef.current = true;
    try {
      if (page.localFilePath) {
        // 重命名层已预判同名并自动加 (1)/(2)，成功后以落盘基名回写输入框
        await usePages.getState().renameLocalPageFile(page.id, nextTitle);
        const latestPath =
          usePages.getState().pages[page.id]?.localFilePath ?? null;
        const finalTitle = latestPath
          ? splitFilePath(latestPath).base || nextTitle
          : nextTitle;
        setValue(finalTitle);
      } else {
        usePages.getState().updatePage(page.id, {
          content: withInternalPageTitle(page.content, nextTitle),
        });
        setValue(nextTitle);
      }
      if (moveToBody) {
        window.dispatchEvent(new CustomEvent("goose-note:focus-editor-body"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("重命名失败", { description: message });
      inputRef.current?.focus();
    } finally {
      committingRef.current = false;
    }
  }, [currentTitle, page, setValue, valueRef]);

  return (
    <input
      ref={inputRef}
      value={value}
      {...imeInputProps}
      onBlur={() => {
        if (isComposing()) return;
        // 新建页切换期间编辑器会短暂抢焦；聚焦请求尚未完成时忽略这次
        // 程序性 blur，避免把空输入提前恢复为“未命名”。
        if (isPageTitleFocusRequested(page.id)) return;
        if (skipNextBlurCommitRef.current) {
          skipNextBlurCommitRef.current = false;
          return;
        }
        void commit();
      }}
      onKeyDown={(event) => {
        if (isComposing(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          skipNextBlurCommitRef.current = true;
          event.currentTarget.blur();
          void commit(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setValue(currentTitle);
          skipNextBlurCommitRef.current = true;
          event.currentTarget.blur();
        }
      }}
      aria-label="笔记标题"
      title="点击编辑笔记标题"
      spellCheck={false}
      autoComplete="off"
      className="h-8 min-w-0 flex-1 rounded-[7px] border border-transparent bg-transparent px-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-[var(--goose-interactive-hover)] focus:border-primary/45 focus:bg-[hsl(var(--goose-editor-bg))] focus:ring-2 focus:ring-primary/15"
    />
  );
}
