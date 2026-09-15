import { ref, watch, type ComputedRef } from "vue";
import { formatBytes } from "../core/formatters";
import type { FinderResult } from "../core/finderLogic";
import {
  getArchiveTreePreviewBlockedReason,
  getCodePreviewLanguage,
  isArchiveTreePreviewCandidate,
  isAudioPreviewCandidate,
  isCodePreviewCandidate,
  isImagePreviewCandidate,
  isLogPreviewCandidate,
  isMarkdownPreviewCandidate,
  isPdfPreviewCandidate,
  isTextPreviewCandidate,
  isVideoPreviewCandidate,
  type PreviewCandidate,
} from "../core/previewCandidate";

const PREVIEW_BYTES = 20 * 1024;
const LOG_PREVIEW_BYTES = 10 * 1024;

export type PreviewKind =
  | "empty"
  | "text"
  | "markdown"
  | "code"
  | "tree"
  | "pdf"
  | "image"
  | "video"
  | "audio";

interface UseFilePreviewOptions {
  activeItem: ComputedRef<FinderResult | undefined>;
}

export function useFilePreview({ activeItem }: UseFilePreviewOptions) {
  const previewKind = ref<PreviewKind>("empty");
  const previewContent = ref("");
  const previewSource = ref("");
  const previewEncoding = ref("");
  const previewLanguage = ref("");
  const previewStatus = ref("未开启预览");

  let previewLoadSequence = 0;

  async function loadPreview() {
    const sequence = ++previewLoadSequence;

    const item = activeItem.value;
    if (!item) {
      resetPreview();
      previewStatus.value = "选择文件后预览";
      return;
    }

    const fileInfo = await window.services.getFileInfo(item.fullPath);
    if (sequence !== previewLoadSequence) return;

    if (!fileInfo.exists) {
      resetPreview();
      previewStatus.value = "文件不存在，无法预览";
      return;
    }

    const previewItem = { ...item, ...fileInfo };
    if (previewItem.isDirectory) {
      await loadDirectoryTreePreview(previewItem, sequence);
      return;
    }

    if (loadMediaPreview(previewItem)) return;
    if (loadArchiveTreePreview(previewItem)) return;
    loadTextLikePreview(previewItem);
  }

  function setPreviewState(options: {
    kind: PreviewKind;
    content?: string;
    source?: string;
    encoding?: string;
    language?: string;
    status?: string;
  }) {
    previewKind.value = options.kind;
    previewContent.value = options.content ?? "";
    previewSource.value = options.source ?? "";
    previewEncoding.value = options.encoding ?? "";
    previewLanguage.value = options.language ?? "";
    previewStatus.value = options.status ?? "";
  }

  function loadMediaPreview(item: FinderResult) {
    if (isImagePreviewCandidate(item)) {
      setPreviewState({
        kind: "image",
        source: window.services.getFileUrl(item.fullPath),
      });
      return true;
    }

    if (isVideoPreviewCandidate(item)) {
      setPreviewState({
        kind: "video",
        source: window.services.getFileUrl(item.fullPath),
      });
      return true;
    }

    if (isAudioPreviewCandidate(item)) {
      setPreviewState({
        kind: "audio",
        source: window.services.getFileUrl(item.fullPath),
      });
      return true;
    }

    if (isPdfPreviewCandidate(item)) {
      setPreviewState({
        kind: "pdf",
        source: item.fullPath,
      });
      return true;
    }

    return false;
  }

  async function loadDirectoryTreePreview(item: FinderResult, sequence: number) {
    try {
      const tree = await window.services.printDirectoryTree(item.fullPath);
      if (sequence !== previewLoadSequence) return;
      setPreviewState({
        kind: "tree",
        content: tree.text,
        language: "目录",
        status: tree.truncated ? "目录结构 · 已截断" : "目录结构",
      });
    } catch (error: unknown) {
      if (sequence !== previewLoadSequence) return;
      resetPreview();
      previewStatus.value = error instanceof Error ? error.message : "目录预览失败";
    }
  }

  function loadArchiveTreePreview(item: FinderResult) {
    const blockedReason = getArchiveTreePreviewBlockedReason(item);
    if (blockedReason) {
      resetPreview();
      previewStatus.value = blockedReason;
      return true;
    }

    if (!isArchiveTreePreviewCandidate(item)) return false;

    try {
      const tree = window.services.printArchiveTree(item.fullPath);
      setPreviewState({
        kind: "tree",
        content: tree.text,
        language: "压缩包",
        status: tree.truncated ? "文件结构 · 已截断" : "文件结构",
      });
      return true;
    } catch (error: unknown) {
      resetPreview();
      previewStatus.value = error instanceof Error ? error.message : "压缩包预览失败";
      return true;
    }
  }

  function loadTextLikePreview(item: FinderResult) {
    const textPreviewKind = getTextPreviewKind(item);
    let shouldPreviewAsText = textPreviewKind !== undefined;

    if (!shouldPreviewAsText) {
      try {
        shouldPreviewAsText = window.services.isTextFile(item.fullPath);
      } catch {
        shouldPreviewAsText = false;
      }
    }

    if (!shouldPreviewAsText) {
      resetPreview();
      previewStatus.value = "当前格式不支持预览";
      return;
    }

    const textPreviewBytes = isLogPreviewCandidate(item) ? LOG_PREVIEW_BYTES : PREVIEW_BYTES;
    const textPreviewDirection = isLogPreviewCandidate(item) ? "end" : "start";

    try {
      const preview = window.services.readTextPreview(
        item.fullPath,
        textPreviewBytes,
        textPreviewDirection,
      );
      if (!preview.isText) {
        resetPreview();
        previewStatus.value = "当前格式不支持预览";
        return;
      }

      setPreviewState({
        kind: textPreviewKind ?? "text",
        content: preview.text,
        encoding: preview.encoding,
        language: getCodePreviewLanguage(item) ?? "plaintext",
        status: getTextPreviewStatus(
          textPreviewKind ?? "text",
          textPreviewBytes,
          textPreviewDirection,
        ),
      });
    } catch (error: unknown) {
      resetPreview();
      previewStatus.value = error instanceof Error ? error.message : "预览失败";
    }
  }

  function resetPreview() {
    setPreviewState({ kind: "empty" });
  }

  watch([activeItem], () => void loadPreview(), { immediate: true });

  return {
    previewKind,
    previewContent,
    previewSource,
    previewEncoding,
    previewLanguage,
    previewStatus,
  };
}

function getTextPreviewKind(item: PreviewCandidate): PreviewKind | undefined {
  if (isMarkdownPreviewCandidate(item)) return "markdown";
  if (isCodePreviewCandidate(item)) return "code";
  if (isTextPreviewCandidate(item)) return "text";
  return undefined;
}

function getTextPreviewStatus(kind: PreviewKind, bytes: number, direction: "start" | "end") {
  if (kind !== "text") return "";
  return `显示${direction === "end" ? "后" : "前"} ${formatBytes(bytes)} 内容`;
}
