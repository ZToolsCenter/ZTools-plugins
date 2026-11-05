import type { PasteItem } from "@pasteboard-pro/core";

const KIND_LABELS: Record<PasteItem["kind"], string> = {
  text: "文本", rich_text: "富文本", html: "网页文本", url: "链接",
  image: "图片", pdf: "PDF", color: "颜色", files: "文件",
};

export function itemKindLabel(kind: PasteItem["kind"]): string { return KIND_LABELS[kind]; }

export function copiedTimeLabel(copiedAt: string, now = Date.now()): string {
  const timestamp = Date.parse(copiedAt);
  if (!Number.isFinite(timestamp)) return "时间未知";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}小时前`;
  if (minutes < 10_080) return `${Math.floor(minutes / 1_440)}天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}

export function itemLink(item: PasteItem): URL | undefined {
  try {
    const url = new URL(item.payload.text?.trim() ?? "");
    return ["http:", "https:"].includes(url.protocol) ? url : undefined;
  } catch { return undefined; }
}

export function fileNames(item: PasteItem): string[] {
  return (item.payload.filePaths ?? []).map((file) => file.split(/[\\/]/).pop() || file);
}

export function itemSummary(item: PasteItem, imageDimensions?: string): string {
  const kind = itemKindLabel(item.kind);
  if (item.kind === "image") return imageDimensions ? `${kind} · ${imageDimensions}` : kind;
  if (item.kind === "url") return `${kind}${itemLink(item) ? ` · ${itemLink(item)!.hostname}` : ""}`;
  if (item.kind === "files") return `${kind} · ${fileNames(item).length} 项`;
  if (item.kind === "pdf") return "文件 · PDF";
  if (item.kind === "color") return `${kind} · ${item.payload.text ?? ""}`;
  return `${kind} · ${Array.from(item.payload.text ?? item.ocrText ?? "").length} 字符`;
}
