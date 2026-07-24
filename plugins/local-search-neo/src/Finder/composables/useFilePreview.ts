import { ref, watch, type ComputedRef } from "vue";
import {
  formatBytes,
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
  type FinderResult,
} from "../core/finderLogic";

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
  selectedItem: ComputedRef<FinderResult | undefined>;
}

export function useFilePreview({ selectedItem }: UseFilePreviewOptions) {
  const previewKind = ref<PreviewKind>("empty");
  const previewContent = ref("");
  const previewSource = ref("");
  const previewEncoding = ref("");
  const previewLanguage = ref("");
  const previewStatus = ref("未开启预览");

  let previewLoadSequence = 0;

  async function loadPreview() {
    const sequence = ++previewLoadSequence;
    resetPreview();

    const item = selectedItem.value;
    if (!item) {
      previewStatus.value = "选择文件后预览";
      return;
    }

    if (!item.fullPath) {
      previewStatus.value = "缺少文件路径，无法预览";
      return;
    }

    const fileInfo = await window.services.getFileInfo(item.fullPath);
    if (sequence !== previewLoadSequence) return;

    if (!fileInfo.exists) {
      previewStatus.value = "文件不存在，无法预览";
      return;
    }

    const previewItem = { ...item, ...fileInfo };
    if (previewItem.isDirectory) {
      loadDirectoryTreePreview(previewItem);
      return;
    }

    if (loadMediaPreview(previewItem)) return;
    if (loadArchiveTreePreview(previewItem)) return;
    loadTextLikePreview(previewItem);
  }

  function loadMediaPreview(item: FinderResult) {
    if (!item.fullPath) return false;

    if (isImagePreviewCandidate(item)) {
      previewKind.value = "image";
      previewSource.value = window.services.getFileUrl(item.fullPath);
      previewStatus.value = "图片预览";
      return true;
    }

    if (isVideoPreviewCandidate(item)) {
      previewKind.value = "video";
      previewSource.value = window.services.getFileUrl(item.fullPath);
      previewStatus.value = "视频预览";
      return true;
    }

    if (isAudioPreviewCandidate(item)) {
      previewKind.value = "audio";
      previewSource.value = window.services.getFileUrl(item.fullPath);
      previewStatus.value = "音频预览";
      return true;
    }

    if (isPdfPreviewCandidate(item)) {
      previewKind.value = "pdf";
      previewSource.value = item.fullPath;
      previewStatus.value = "PDF 预览";
      return true;
    }

    return false;
  }

  function loadDirectoryTreePreview(item: FinderResult) {
    if (!item.fullPath) return;

    try {
      const tree = window.services.printDirectoryTree(item.fullPath);
      previewKind.value = "tree";
      previewContent.value = tree.text;
      previewLanguage.value = "目录";
      previewStatus.value = tree.truncated ? "目录结构 · 已截断" : "目录结构";
    } catch (error: unknown) {
      previewStatus.value = error instanceof Error ? error.message : "目录预览失败";
    }
  }

  function loadArchiveTreePreview(item: FinderResult) {
    if (!item.fullPath) return false;

    const blockedReason = getArchiveTreePreviewBlockedReason(item);
    if (blockedReason) {
      resetPreview();
      previewStatus.value = blockedReason;
      return true;
    }

    if (!isArchiveTreePreviewCandidate(item)) return false;

    try {
      const tree = window.services.printArchiveTree(item.fullPath);
      previewKind.value = "tree";
      previewContent.value = tree.text;
      previewLanguage.value = "压缩包";
      previewStatus.value = tree.truncated ? "文件结构 · 已截断" : "文件结构";
      return true;
    } catch (error: unknown) {
      previewStatus.value = error instanceof Error ? error.message : "压缩包预览失败";
      return true;
    }
  }

  function loadTextLikePreview(item: FinderResult) {
    if (!item.fullPath) return;

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
        previewStatus.value = "当前格式不支持预览";
        return;
      }

      previewKind.value = textPreviewKind ?? "text";
      previewContent.value = preview.text;
      previewEncoding.value = preview.encoding;
      previewLanguage.value = getCodePreviewLanguage(item) ?? "plaintext";
      previewStatus.value = getTextPreviewStatus(
        previewKind.value,
        item,
        textPreviewBytes,
        textPreviewDirection,
      );
    } catch (error: unknown) {
      resetPreview();
      previewStatus.value = error instanceof Error ? error.message : "预览失败";
    }
  }

  function resetPreview() {
    previewKind.value = "empty";
    previewContent.value = "";
    previewSource.value = "";
    previewEncoding.value = "";
    previewLanguage.value = "";
  }

  watch([selectedItem], () => void loadPreview(), { immediate: true });

  return {
    previewKind,
    previewContent,
    previewSource,
    previewEncoding,
    previewLanguage,
    previewStatus,
  };
}

function getTextPreviewKind(
  item: Pick<FinderResult, "name" | "extension" | "size" | "isDirectory">,
): PreviewKind | undefined {
  if (isMarkdownPreviewCandidate(item)) return "markdown";
  if (isCodePreviewCandidate(item)) return "code";
  if (isTextPreviewCandidate(item)) return "text";
  return undefined;
}

function getTextPreviewStatus(
  kind: PreviewKind,
  item: Pick<FinderResult, "name" | "extension" | "isDirectory">,
  bytes: number,
  direction: "start" | "end",
) {
  if (kind === "markdown") return "Markdown 预览";
  if (kind === "code") return `${getCodePreviewLanguage(item) ?? "plaintext"} · 代码预览`;
  return `显示${direction === "end" ? "后" : "前"} ${formatBytes(bytes)} 内容`;
}
