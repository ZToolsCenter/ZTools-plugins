/**
 * Notebook AI composer — 附件（页面引用 + 图片）以 chip 形式内联在输入框中。
 * 文本与 @ 引用草稿按 notebook 持久化，切页 / 关面板 / 退出插件后可恢复。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ImagePlus, Send, Square } from "lucide-react";
import { ComposerPrimitive } from "@assistant-ui/react";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { LoadingState } from "./beautiful-ui/LoadingState";
import { PromptBar } from "./beautiful-ui/PromptBar";
import {
  AiComposerInput,
  type AiComposerInputHandle,
} from "@/components/editor/ai/composer/AiComposerInput";
import {
  normalizeAiComposerPayload,
  type AiComposerPayload,
  type AiFileReferenceAttrs,
  type AiReferenceSuggestionItem,
} from "@/components/editor/ai/composer/referenceLookup";
import {
  extractClipboardImageFiles,
  isImageUploadFile,
  resolveImageMimeForUpload,
} from "@/components/editor/utils/pasteClipboardImage";
import { useNotebookAiChats } from "@/stores/useNotebookAiChats";
import type { JSONContent } from "@/types";
import { ModelSelectorPopover } from "./ModelSelectorPopover";

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
/** 草稿走 zustand persist → uTools 同步写盘，必须防抖（含整行删除后的清空） */
const COMPOSER_DRAFT_PERSIST_MS = 500;
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export interface NotebookAiImageAttachment {
  file: File;
  previewUrl: string;
}

export interface ComposerHandle {
  /** 聚焦输入框 */
  focus: () => void;
  /** 打开面板后立即给输入框植入初始引用（当前页上下文） */
  insertReference: (reference: AiFileReferenceAttrs) => void;
}

interface ComposerProps {
  /** 用于按笔记本持久化输入草稿 */
  notebookId: string;
  onSend: (
    payload: AiComposerPayload,
    images: NotebookAiImageAttachment[],
  ) => boolean | void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPages?: (query: string) => AiReferenceSuggestionItem[];
  onEscape?: () => void;
  /** 全屏时输入区居中加宽 */
  layout?: "side-panel" | "fullscreen";
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      notebookId,
      onSend,
      isStreaming,
      disabled,
      placeholder = "向 AI 提问，/ 调用 Skill，@ 引用笔记或本地文件…",
      searchPages,
      onEscape,
      layout = "side-panel",
    },
    ref,
  ) {
    const isFullscreen = layout === "fullscreen";
    const inputRef = useRef<AiComposerInputHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const draftSeqRef = useRef(0);
    const [isEmpty, setIsEmpty] = useState(true);
    const [autoFocusToken, setAutoFocusToken] = useState(0);
    const [dropActive, setDropActive] = useState(false);
    // 仅在挂载时读一次草稿作种子；运行中由 onContentChange 写回 store，
    // 避免把 store 回灌成受控值导致 contenteditable 选区被重建。
    const [seedContent] = useState<JSONContent | null>(() =>
      useNotebookAiChats.getState().getComposerDraft(notebookId),
    );

    const cancelPendingDraftPersist = useCallback(() => {
      draftSeqRef.current += 1;
      if (draftTimerRef.current != null) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    }, []);

    useEffect(() => {
      return () => {
        cancelPendingDraftPersist();
      };
    }, [cancelPendingDraftPersist]);

    const handleEscape = useCallback(() => {
      onEscape?.();
    }, [onEscape]);

    const handleContentChange = useCallback(
      (content: JSONContent | null) => {
        // 防抖写 uTools：英文快打也会打到同步 dbStorage；拼音中间态已在 input 层跳过
        const seq = ++draftSeqRef.current;
        if (draftTimerRef.current != null) {
          clearTimeout(draftTimerRef.current);
        }
        draftTimerRef.current = setTimeout(() => {
          draftTimerRef.current = null;
          if (seq !== draftSeqRef.current) return;
          useNotebookAiChats.getState().setComposerDraft(notebookId, content);
        }, COMPOSER_DRAFT_PERSIST_MS);
      },
      [notebookId],
    );

    const handleSubmit = useCallback(() => {
      if (disabled || isStreaming) return;
      const input = inputRef.current;
      const payload = input?.getPayload();
      if (!payload) return;

      const images = input?.resolveImages(payload) ?? [];
      if (!payload.promptText.trim() && images.length === 0) return;

      const normalized = normalizeAiComposerPayload(payload);
      const accepted = onSend(normalized.payload, images);
      if (accepted === false) return;

      input?.clear();
      cancelPendingDraftPersist();
      useNotebookAiChats.getState().clearComposerDraft(notebookId);
      setIsEmpty(true);
      setAutoFocusToken((token) => token + 1);
    }, [disabled, isStreaming, onSend, notebookId, cancelPendingDraftPersist]);

    const addImageFiles = useCallback((selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      const accepted = selectedFiles
        .filter(isImageUploadFile)
        .filter((file) =>
          SUPPORTED_IMAGE_MEDIA_TYPES.has(resolveImageMimeForUpload(file)),
        )
        .map((file) => {
          const mediaType = resolveImageMimeForUpload(file);
          return file.type === mediaType
            ? file
            : new File([file], file.name, {
                type: mediaType,
                lastModified: file.lastModified,
              });
        });

      if (accepted.length === 0) {
        toast.error("请选择 PNG、JPEG、WebP 或 GIF 图片。");
        return;
      }

      inputRef.current?.insertImages(accepted);
    }, []);

    const handleImageInput = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(event.target.files ?? []);
        event.target.value = "";
        addImageFiles(selectedFiles);
      },
      [addImageFiles],
    );

    /** 粘贴图片 → 插入到光标处（Mac 截图常只有 items，files 为空） */
    const handleDockPaste = useCallback(
      (event: React.ClipboardEvent) => {
        if (disabled || isStreaming) return;
        const imageFiles = extractClipboardImageFiles(event.clipboardData);
        if (imageFiles.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        addImageFiles(imageFiles);
      },
      [addImageFiles, disabled, isStreaming],
    );

    /** 拖入图片：允许 drop + 轻量高亮 */
    const handleDockDragOver = useCallback(
      (event: React.DragEvent) => {
        if (disabled || isStreaming) return;
        const types = Array.from(event.dataTransfer?.types ?? []);
        if (
          !types.includes("Files") &&
          !types.some((t) => t.startsWith("image/"))
        ) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      },
      [disabled, isStreaming],
    );

    const handleDockDragLeave = useCallback((event: React.DragEvent) => {
      const related = event.relatedTarget as Node | null;
      if (related && event.currentTarget.contains(related)) return;
      setDropActive(false);
    }, []);

    const handleDockDrop = useCallback(
      (event: React.DragEvent) => {
        setDropActive(false);
        if (disabled || isStreaming) return;
        const imageFiles = extractClipboardImageFiles(event.dataTransfer);
        if (imageFiles.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        addImageFiles(imageFiles);
      },
      [addImageFiles, disabled, isStreaming],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          inputRef.current?.focus();
        },
        insertReference: (reference: AiFileReferenceAttrs) => {
          inputRef.current?.insertReference(reference);
        },
      }),
      [],
    );

    // isEmpty 在 IME 会话里会滞后；发送按钮不因 isEmpty 禁用，避免「有字点不了」
    // 真正空内容由 handleSubmit 读 DOM 拦截。
    const canClickSend = !isStreaming && !disabled;
    const sendLooksReady = canClickSend && !isEmpty;

    return (
      <ComposerPrimitive.Root
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className={cn("shrink-0", isFullscreen ? "px-6 py-3" : "px-3 py-2.5")}
      >
        <div
          className={cn(
            "mx-auto w-full",
            isFullscreen ? "max-w-[720px]" : "max-w-none",
          )}
        >
          <PromptBar streaming={isStreaming}>
            <div
              className={cn(
                "bui-root flex flex-col rounded-[16px] bg-[var(--goose-interactive-hover)] px-3 py-2.5",
                "shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.22)]",
                "transition-colors duration-150",
                dropActive &&
                  "ring-2 ring-[var(--goose-interactive-selected)] ring-offset-1 ring-offset-background",
              )}
              data-drop-active={dropActive ? "true" : undefined}
              onPaste={handleDockPaste}
              onDragEnter={handleDockDragOver}
              onDragOver={handleDockDragOver}
              onDragLeave={handleDockDragLeave}
              onDrop={handleDockDrop}
            >
              <AiComposerInput
                ref={inputRef}
                placeholder={placeholder}
                autoFocusToken={autoFocusToken}
                initialContent={seedContent}
                onContentChange={handleContentChange}
                onSubmit={handleSubmit}
                onEscape={handleEscape}
                onIsEmptyChange={setIsEmpty}
                searchPages={searchPages}
                referencePlacement="inline"
                variant="panel"
                disabled={disabled || isStreaming}
                maxImageBytes={MAX_IMAGE_FILE_BYTES}
                maxImageCount={MAX_IMAGE_ATTACHMENTS}
                onImageRejected={(message) => toast.error(message)}
              />

              <div className="mt-1.5 flex items-center gap-1">
                <ModelSelectorPopover disabled={disabled} />
                <div className="flex-1" />

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  onChange={handleImageInput}
                  disabled={disabled || isStreaming}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || isStreaming}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="上传图片"
                  title="上传图片"
                >
                  <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
                </button>

                {isStreaming ? (
                  <>
                    <LoadingState
                      variant="Dots"
                      compact
                      label=""
                      showElapsed={false}
                    />
                    <ComposerPrimitive.Cancel
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]",
                        "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]",
                        "transition-colors duration-150",
                      )}
                      aria-label="停止生成"
                      title="停止生成"
                    >
                      <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </ComposerPrimitive.Cancel>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canClickSend}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]",
                      "transition-colors duration-150",
                      sendLooksReady
                        ? "bg-[#58d7b8]/15 text-[#58d7b8] hover:brightness-110"
                        : "cursor-not-allowed text-muted-foreground opacity-50",
                    )}
                    aria-label="发送消息"
                    title="发送消息"
                  >
                    <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </div>
            </div>
          </PromptBar>
        </div>
      </ComposerPrimitive.Root>
    );
  },
);

Composer.displayName = "Composer";
