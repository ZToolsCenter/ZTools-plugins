/**
 * 输入区：Codex 式卡内布局 — ContextBar + 输入卡（缩略图 / textarea / 底栏控件）。
 * 阻断 chip 在卡上方；无 Key 仍挡发送。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  ArrowUp,
  FileText,
  ImagePlus,
  KeyRound,
  Paperclip,
  Plus,
  Square,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import {
  getActiveCredentialMissingMessage,
  hasActiveCredential,
  modelSupportsVision,
  resolveEffectiveModelId,
} from "@/lib/ai-provider";
import {
  OFFICE_ATTACHMENT_MAX_COUNT,
  isOfficeFile,
  parseOfficeFile,
  type OfficeAttachment,
} from "@/lib/agent/officeAttachments";
import {
  USER_IMAGE_MAX_COUNT,
  attachmentToDataUrl,
  compressImageBlob,
  compressImageFile,
  type UserImageAttachment,
} from "@/lib/agent/userImages";
import { useAgentChats } from "@/stores/useAgentChats";
import { useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";
import { Button } from "@/lib/heroui";
import { buiComposerLoader } from "./aiMotionPresets";
import { LoadingState } from "./beautiful-ui/LoadingState";
import { PromptBarChrome } from "./beautiful-ui/PromptBarChrome";
import { ComposerContextBar } from "./ComposerContextBar";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { ModelSelector } from "./ModelSelector";
import { PermissionModeControl } from "./PermissionModeControl";
import { ReasoningLevelControl } from "./ReasoningLevelControl";

const DRAFT_PERSIST_MS = 400;

/** 统一附件：图片 + Office */
const COMPOSER_ACCEPT =
  "image/*,.docx,.xlsx,.pptx,.doc,.xls,.ppt,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** 供全局快捷键聚焦（Mod+J） */
export const AGENT_COMPOSER_SELECTOR = "[data-agent-composer]";

export interface ComposerProps {
  conversationId: string;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSend: (
    text: string,
    images?: UserImageAttachment[],
    /** Office 解析文本已拼入 text；此字段供会话元数据展示 */
    office?: OfficeAttachment[],
  ) => boolean | void;
  onStop?: () => void;
}

function openAiSettings() {
  window.dispatchEvent(
    new CustomEvent("goose-agent:open-settings", {
      detail: { section: "ai" },
    }),
  );
}

export function Composer({
  conversationId,
  isStreaming,
  disabled,
  placeholder = "输入消息…",
  onSend,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState(() =>
    useAgentChats.getState().getComposerDraft(conversationId),
  );
  const [images, setImages] = useState<UserImageAttachment[]>([]);
  const [officeFiles, setOfficeFiles] = useState<OfficeAttachment[]>([]);
  const imagesRef = useRef<UserImageAttachment[]>([]);
  const officeRef = useRef<OfficeAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [parsingOffice, setParsingOffice] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSeqRef = useRef(0);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    officeRef.current = officeFiles;
  }, [officeFiles]);

  useEffect(() => {
    setValue(useAgentChats.getState().getComposerDraft(conversationId));
    setImages([]);
    setOfficeFiles([]);
    if (draftTimerRef.current != null) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
  }, [conversationId]);

  useEffect(() => {
    return () => {
      draftSeqRef.current += 1;
      if (draftTimerRef.current != null) {
        clearTimeout(draftTimerRef.current);
      }
    };
  }, []);

  const persistDraft = useCallback(
    (text: string) => {
      const seq = ++draftSeqRef.current;
      if (draftTimerRef.current != null) {
        clearTimeout(draftTimerRef.current);
      }
      draftTimerRef.current = setTimeout(() => {
        draftTimerRef.current = null;
        if (seq !== draftSeqRef.current) return;
        useAgentChats.getState().setComposerDraft(conversationId, text);
      }, DRAFT_PERSIST_MS);
    },
    [conversationId],
  );

  const handleChange = (next: string) => {
    setValue(next);
    persistDraft(next);
  };

  const ai = useSettings((s) => s.ai);
  // 有消息后工作区已绑定，隐藏整条 ContextBar（与 isStreaming 无关）
  const messageCount =
    useAgentChats((s) => s.conversations[conversationId]?.messages.length) ?? 0;
  const showContextBar = messageCount === 0;
  const hasCredential = hasActiveCredential(ai);
  // 与 handleSend / AgentSession 视觉检查同一 effective 模型
  const effectiveModelId = resolveEffectiveModelId(ai);
  const canSee = modelSupportsVision(
    effectiveModelId,
    ai.customModelOptions,
    ai.customProviderId,
  );
  const showVisionBlock = images.length > 0 && !canSee;

  const addImages = useCallback(async (files: File[] | Blob[]) => {
    if (files.length === 0) return;

    const room = USER_IMAGE_MAX_COUNT - imagesRef.current.length;
    if (room <= 0) {
      toast.error(`最多添加 ${USER_IMAGE_MAX_COUNT} 张图片`);
      return;
    }

    const toProcess = files.slice(0, room);
    if (files.length > room) {
      toast.error(`最多添加 ${USER_IMAGE_MAX_COUNT} 张图片`);
    }

    const added: UserImageAttachment[] = [];
    for (const item of toProcess) {
      try {
        const att =
          item instanceof File
            ? await compressImageFile(item)
            : await compressImageBlob(item);
        added.push(att);
      } catch (err) {
        const msg =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : "图片处理失败";
        toast.error(msg);
      }
    }
    if (added.length === 0) return;
    setImages((prev) => {
      const nextRoom = USER_IMAGE_MAX_COUNT - prev.length;
      if (nextRoom <= 0) {
        toast.error(`最多添加 ${USER_IMAGE_MAX_COUNT} 张图片`);
        return prev;
      }
      return [...prev, ...added.slice(0, nextRoom)];
    });
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const removeOffice = useCallback((id: string) => {
    setOfficeFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const addOfficeFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const room = OFFICE_ATTACHMENT_MAX_COUNT - officeRef.current.length;
    if (room <= 0) {
      toast.error(`最多添加 ${OFFICE_ATTACHMENT_MAX_COUNT} 个文档`);
      return;
    }
    const toProcess = files.slice(0, room);
    if (files.length > room) {
      toast.error(`最多添加 ${OFFICE_ATTACHMENT_MAX_COUNT} 个文档`);
    }

    setParsingOffice(true);
    const added: OfficeAttachment[] = [];
    let okCount = 0;
    let failCount = 0;
    try {
      for (const file of toProcess) {
        try {
          const att = await parseOfficeFile(file);
          added.push(att);
          if (att.parseError) {
            failCount += 1;
            toast.error(`「${att.filename}」解析失败`, {
              description: att.parseError.slice(0, 120),
            });
          } else {
            okCount += 1;
          }
        } catch (err) {
          failCount += 1;
          const msg =
            err instanceof Error && err.message.trim()
              ? err.message.trim()
              : "文档处理失败";
          toast.error(msg);
        }
      }
    } finally {
      setParsingOffice(false);
    }
    if (added.length === 0) return;
    setOfficeFiles((prev) => {
      const nextRoom = OFFICE_ATTACHMENT_MAX_COUNT - prev.length;
      if (nextRoom <= 0) return prev;
      return [...prev, ...added.slice(0, nextRoom)];
    });
    // 批量成功时一条轻提示；单文件成功不打扰
    if (okCount > 1 && failCount === 0) {
      toast.success(`已添加 ${okCount} 个文档`);
    } else if (okCount === 1 && failCount === 0 && toProcess.length === 1) {
      // 单文件静默；芯片条可见即可
    } else if (okCount > 0 && failCount > 0) {
      toast.success(`已添加 ${okCount} 个文档，${failCount} 个解析失败`);
    }
  }, []);

  const addMixedFiles = useCallback(
    async (files: File[]) => {
      const imagesList = files.filter(
        (f) => f.type.startsWith("image/") || (!f.type && /\.(png|jpe?g|gif|webp)$/i.test(f.name)),
      );
      const officeList = files.filter((f) => isOfficeFile(f));
      const other = files.filter(
        (f) => !imagesList.includes(f) && !officeList.includes(f),
      );
      if (other.length > 0) {
        toast.error("仅支持图片与 Office/PDF 文档");
      }
      if (imagesList.length > 0) void addImages(imagesList);
      if (officeList.length > 0) void addOfficeFiles(officeList);
    },
    [addImages, addOfficeFiles],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled || isStreaming) return;
      const items = event.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length === 0) return;
      // 有图时优先收图，避免把图当文本粘贴
      event.preventDefault();
      void addImages(imageFiles);
    },
    [disabled, isStreaming, addImages],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (disabled || isStreaming) return;
      if (!event.dataTransfer?.types?.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    },
    [disabled, isStreaming],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    // 仅离开卡片外层时取消高亮
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      if (disabled || isStreaming) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) {
        toast.error("请拖入图片或 Office 文档");
        return;
      }
      void addMixedFiles(files);
    },
    [disabled, isStreaming, addMixedFiles],
  );

  const handlePickFiles = useCallback(() => {
    if (disabled || isStreaming || parsingOffice) return;
    fileInputRef.current?.click();
  }, [disabled, isStreaming, parsingOffice]);

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const list = event.target.files;
      if (!list || list.length === 0) return;
      void addMixedFiles(Array.from(list));
      // 允许再次选同一文件
      event.target.value = "";
    },
    [addMixedFiles],
  );

  const handleSend = useCallback(() => {
    if (disabled || isStreaming || parsingOffice) return;
    const text = value.trim();
    if (!text && images.length === 0 && officeFiles.length === 0) return;
    if (!hasCredential) {
      toast.error("请先配置凭证", {
        description: getActiveCredentialMissingMessage(ai),
        action: {
          label: "打开 AI 设置",
          onClick: () => openAiSettings(),
        },
      });
      return;
    }

    // 双保险：有图且当前模型不支持视觉
    if (images.length > 0) {
      const modelId = resolveEffectiveModelId(ai);
      if (!modelSupportsVision(modelId, ai.customModelOptions, ai.customProviderId)) {
        toast.error("当前模型不支持看图，请切换支持视觉的模型");
        return;
      }
    }

    // 用户原文 + Office 附件：AgentSession 负责拼模型可见正文与 displayText
    const accepted = onSend(
      text,
      images.length > 0 ? images.slice() : undefined,
      officeFiles.length > 0 ? officeFiles.slice() : undefined,
    );
    if (accepted === false) return;

    setValue("");
    setImages([]);
    setOfficeFiles([]);
    draftSeqRef.current += 1;
    if (draftTimerRef.current != null) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    useAgentChats.getState().clearComposerDraft(conversationId);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [
    disabled,
    isStreaming,
    parsingOffice,
    value,
    images,
    officeFiles,
    onSend,
    conversationId,
    hasCredential,
    ai,
  ]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && isStreaming) {
      event.preventDefault();
      onStop?.();
      return;
    }
    // Enter 发送；Shift+Enter 换行。IME 组字中不触发发送。
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.shiftKey) return;
    event.preventDefault();
    handleSend();
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const canSend =
    !disabled &&
    !isStreaming &&
    hasCredential &&
    !showVisionBlock &&
    (value.trim().length > 0 || images.length > 0 || officeFiles.length > 0);

  return (
    <div
      data-tour="composer"
      className="agent-composer shrink-0 bg-transparent px-3 pb-2.5 pt-1.5"
      aria-label="输入区"
    >
      <div className="mx-auto flex w-full max-w-[640px] min-w-0 flex-col gap-1.5">
        {/* 仅阻断/提醒：chip，非段落（无工作区不再提示，ContextBar 已覆盖） */}
        {!hasCredential || showVisionBlock ? (
          <div className="flex flex-wrap items-center gap-1 px-0.5" role="status">
            {!hasCredential ? (
              <button
                type="button"
                onClick={() => openAiSettings()}
                className={cn(
                  "inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-danger-border",
                  "bg-danger-faint px-2 text-[11px] font-medium text-fg",
                  "hover:bg-danger-soft transition-colors duration-150",
                )}
              >
                <KeyRound size={11} strokeWidth={1.75} className="shrink-0" />
                <span className="truncate">未配置凭证 · 点此设置</span>
              </button>
            ) : null}
            {showVisionBlock ? (
              <span
                className={cn(
                  "inline-flex h-6 max-w-full items-center gap-1 rounded-full",
                  "bg-bg px-2 text-[11px] text-fg-faint",
                )}
              >
                <ImagePlus size={11} strokeWidth={1.75} className="shrink-0" />
                <span className="truncate">当前模型不支持看图</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {showContextBar ? <ComposerContextBar disabled={disabled} /> : null}

        <PromptBarChrome
          active={isStreaming}
          loader={
            isStreaming ? (
              <LoadingState
                variant={buiComposerLoader.variant}
                label={buiComposerLoader.label}
              />
            ) : null
          }
        >
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "flex w-full flex-col gap-1 rounded-[12px] border border-border-soft bg-bg p-2",
              "transition-[border-color,box-shadow] duration-150",
              "focus-within:border-border-strong focus-within:shadow-[0_0_0_1px_var(--color-border-strong)]",
              dragOver && "border-accent shadow-[0_0_0_1px_var(--color-accent)]",
            )}
          >
            {/* 附件条：图片缩略图 + Office 芯片 */}
            {images.length > 0 || officeFiles.length > 0 ? (
              <div
                className="flex flex-wrap gap-1.5 px-0.5"
                aria-label={`已添加 ${images.length} 张图片、${officeFiles.length} 个文档`}
              >
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="group relative size-14 shrink-0 overflow-hidden rounded-[10px] border border-border-soft bg-surface"
                  >
                    <img
                      src={attachmentToDataUrl(img)}
                      alt=""
                      className="size-full object-cover"
                      draggable={false}
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className={cn(
                        "absolute right-0.5 top-0.5 inline-flex size-5 items-center justify-center",
                        "rounded-full border border-border bg-surface text-fg-muted",
                        "hover:bg-surface-hover hover:text-fg",
                        "transition-colors duration-150",
                      )}
                      title="移除图片"
                      aria-label="移除图片"
                    >
                      <X size={11} strokeWidth={2} />
                    </button>
                  </div>
                ))}
                {officeFiles.map((doc) => {
                  const parseFailed = Boolean(doc.parseError);
                  const sizeKb = Math.max(
                    1,
                    Math.round(doc.byteLength / 1024),
                  );
                  return (
                    <div
                      key={doc.id}
                      className={cn(
                        "group relative flex max-w-[12rem] items-center gap-1.5 rounded-[10px] border bg-surface px-2 py-1.5",
                        parseFailed
                          ? "border-[var(--color-timer-low)]"
                          : "border-border-soft",
                      )}
                      title={
                        parseFailed
                          ? `解析失败：${doc.parseError}`
                          : `${doc.filename}（约 ${sizeKb} KB）`
                      }
                    >
                      <FileText
                        size={14}
                        strokeWidth={1.75}
                        className={cn(
                          "shrink-0",
                          parseFailed
                            ? "text-[var(--color-timer-low)]"
                            : "text-fg-faint",
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-[11px]",
                            parseFailed
                              ? "text-[var(--color-timer-low)]"
                              : "text-fg-muted",
                          )}
                        >
                          {doc.filename}
                        </span>
                        {parseFailed ? (
                          <span className="block truncate text-[10px] text-[var(--color-timer-low)]">
                            解析失败
                          </span>
                        ) : (
                          <span className="block truncate text-[10px] text-fg-faint">
                            {sizeKb} KB
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeOffice(doc.id)}
                        className={cn(
                          "inline-flex size-5 shrink-0 items-center justify-center",
                          "rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg",
                          "transition-colors duration-150",
                        )}
                        title="移除文档"
                        aria-label={`移除文档 ${doc.filename}`}
                      >
                        <X size={11} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* 全宽输入 */}
            <textarea
              ref={textareaRef}
              data-agent-composer
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={disabled}
              rows={1}
              placeholder={isStreaming ? "正在生成…" : placeholder}
              className={cn(
                "min-h-[36px] max-h-[160px] w-full resize-none rounded-lg border-0 bg-transparent",
                "px-1 py-1.5 text-fg placeholder:text-fg-faint",
                "focus-visible:outline-none",
                "disabled:opacity-50",
              )}
              style={{
                fontSize: "var(--font-size-chat)",
                lineHeight: "var(--line-height-chat)",
              }}
              aria-label="消息输入"
            />

            {/* 卡内底栏：左 +/权限 · 右 模型|思考 / 用量 / 发送 */}
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex min-w-0 items-center gap-1">
                <Button
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  onPress={handlePickFiles}
                  isDisabled={
                    disabled ||
                    isStreaming ||
                    parsingOffice ||
                    (images.length >= USER_IMAGE_MAX_COUNT &&
                      officeFiles.length >= OFFICE_ATTACHMENT_MAX_COUNT)
                  }
                  className={cn(
                    "size-8 min-w-8 shrink-0 rounded-md",
                    "border border-border-soft bg-transparent text-fg-muted",
                    "hover:bg-surface-hover hover:text-fg",
                    "disabled:opacity-35 disabled:hover:bg-transparent",
                  )}
                  aria-label={
                    parsingOffice
                      ? "正在解析文档…"
                      : "添加图片或 Office 文档"
                  }
                >
                  {parsingOffice ? (
                    <Paperclip size={15} strokeWidth={1.75} className="animate-pulse" />
                  ) : (
                    <Plus size={15} strokeWidth={1.75} />
                  )}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={COMPOSER_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                  tabIndex={-1}
                />
                <PermissionModeControl disabled={disabled} />
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <div className="inline-flex items-center rounded-md border border-border-soft">
                  <ModelSelector
                    compact
                    disabled={disabled || isStreaming}
                  />
                  <div
                    className="h-4 w-px shrink-0 bg-border-soft"
                    aria-hidden
                  />
                  <ReasoningLevelControl
                    compact
                    disabled={disabled || isStreaming}
                  />
                </div>
                <ContextUsageIndicator
                  conversationId={conversationId}
                  disabled={disabled}
                />
                {isStreaming ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => onStop?.()}
                    className={cn(
                      "agent-composer-action h-8 shrink-0 gap-1.5 rounded-[10px]",
                      "bg-surface-hover px-2.5 text-[12px] font-medium text-fg",
                      "hover:bg-surface-active active:bg-surface-active",
                    )}
                    aria-label="停止生成（Esc）"
                  >
                    <Square
                      size={13}
                      strokeWidth={1.75}
                      className="fill-current agent-icon-pop"
                    />
                    停止
                  </Button>
                ) : (
                  <Button
                    isIconOnly
                    size="sm"
                    onPress={handleSend}
                    isDisabled={!canSend}
                    className={cn(
                      "agent-composer-action agent-send-btn size-8 min-w-8 shrink-0 rounded-full",
                      "bg-accent text-accent-fg",
                      "hover:bg-accent-hover active:bg-accent-active",
                      "disabled:opacity-35 disabled:hover:bg-accent",
                      canSend && "agent-send-btn--ready",
                    )}
                    aria-label={
                      !hasCredential
                        ? "请先配置凭证"
                        : "发送（Enter）· 换行（Shift+Enter）"
                    }
                  >
                    {!hasCredential && (value.trim() || images.length > 0) ? (
                      <AlertCircle
                        size={14}
                        strokeWidth={1.75}
                        className="agent-icon-pop"
                      />
                    ) : (
                      <ArrowUp
                        size={15}
                        strokeWidth={2}
                        className="agent-icon-pop"
                      />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </PromptBarChrome>
      </div>
    </div>
  );
}
