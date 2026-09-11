/**
 * 助手消息 Markdown 渲染（streamdown + shiki 高亮 + mermaid）。
 * 开启代码/表格/图表控件；图片支持下载与复制到剪贴板。
 */
import {
  memo,
  useCallback,
  useState,
  type ComponentProps,
} from "react";
import { Check, Copy, Download } from "lucide-react";
import {
  Streamdown,
  type Components,
  type PluginConfig,
} from "streamdown";
import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { cn } from "@/lib/utils";
import { triggerBlobDownload } from "./artifacts/download";

export interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * @streamdown/code 与 streamdown 各自锁定的 shiki 类型偶发不完全一致
 * （BundledLanguage 字面量差集），运行时兼容，断言为 PluginConfig。
 */
const STREAMDOWN_PLUGINS = {
  code,
  mermaid,
} as unknown as PluginConfig;

/** 大陆简体：控件 title / aria */
const STREAMDOWN_ZH = {
  close: "关闭",
  copied: "已复制",
  copyCode: "复制代码",
  copyLink: "复制链接",
  copyTable: "复制表格",
  copyTableAsCsv: "复制为 CSV",
  copyTableAsMarkdown: "复制为 Markdown",
  copyTableAsTsv: "复制为 TSV",
  downloadDiagram: "下载图表",
  downloadDiagramAsMmd: "下载为 Mermaid 源码",
  downloadDiagramAsPng: "下载为 PNG",
  downloadDiagramAsSvg: "下载为 SVG",
  downloadFile: "下载文件",
  downloadImage: "下载图片",
  downloadTable: "下载表格",
  downloadTableAsCsv: "下载为 CSV",
  downloadTableAsMarkdown: "下载为 Markdown",
  exitFullscreen: "退出全屏",
  externalLinkWarning: "即将打开外部网站。",
  imageNotAvailable: "图片不可用",
  mermaidFormatMmd: "MMD",
  mermaidFormatPng: "PNG",
  mermaidFormatSvg: "SVG",
  openExternalLink: "打开外部链接？",
  openLink: "打开链接",
  tableFormatCsv: "CSV",
  tableFormatMarkdown: "Markdown",
  tableFormatTsv: "TSV",
  viewFullscreen: "全屏查看",
} as const;

const CONTROLS = {
  code: { copy: true, download: true },
  table: { copy: true, download: true, fullscreen: false },
  mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
} as const;

/** 浅色 / 深色 shiki 主题（与 .dark 类切换对齐） */
const SHIKI_THEME = ["github-light", "github-dark"] as const;

function filenameFromSrc(src: string, alt?: string): string {
  try {
    const path = new URL(src, window.location.origin).pathname;
    const base = path.split("/").pop() || "";
    if (base.includes(".")) return base;
  } catch {
    /* ignore */
  }
  const stem = (alt || "image").replace(/[^\w\u4e00-\u9fff.-]+/g, "_").slice(0, 48);
  return `${stem || "image"}.png`;
}

async function fetchImageBlob(src: string): Promise<Blob> {
  if (src.startsWith("data:")) {
    const res = await fetch(src);
    return res.blob();
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`图片加载失败（${res.status}）`);
  return res.blob();
}

type MdImgProps = Record<string, unknown> & {
  src?: string;
  alt?: string;
  className?: string;
  width?: string | number;
  height?: string | number;
  node?: unknown;
};

/**
 * 图片：hover 显示下载 + 复制；复制优先 ClipboardItem image/*，
 * 不支持时退化为下载。
 */
function MarkdownImage({
  src,
  alt,
  className,
  width,
  height,
  node: _node,
  ...rest
}: MdImgProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const onLoad = useCallback(() => {
    setLoaded(true);
    setFailed(false);
  }, []);

  const onError = useCallback(() => {
    setLoaded(false);
    setFailed(true);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!src) return;
    try {
      const blob = await fetchImageBlob(src);
      triggerBlobDownload(blob, filenameFromSrc(src, alt || undefined));
    } catch {
      try {
        window.open(src, "_blank", "noopener,noreferrer");
      } catch {
        /* ignore */
      }
    }
  }, [src, alt]);

  const handleCopy = useCallback(async () => {
    if (!src) return;
    try {
      const blob = await fetchImageBlob(src);
      const type = blob.type || "image/png";
      if (
        typeof ClipboardItem !== "undefined" &&
        navigator.clipboard?.write
      ) {
        // 部分环境只接受 image/png
        let itemBlob = blob;
        if (type !== "image/png" && type.startsWith("image/")) {
          try {
            itemBlob = await new Promise<Blob>((resolve, reject) => {
              const img = new Image();
              const objectUrl = URL.createObjectURL(blob);
              const cleanup = () => URL.revokeObjectURL(objectUrl);
              img.onload = () => {
                try {
                  const canvas = document.createElement("canvas");
                  canvas.width = img.naturalWidth || img.width;
                  canvas.height = img.naturalHeight || img.height;
                  const ctx = canvas.getContext("2d");
                  if (!ctx) {
                    cleanup();
                    reject(new Error("canvas"));
                    return;
                  }
                  ctx.drawImage(img, 0, 0);
                  canvas.toBlob((b) => {
                    cleanup();
                    if (b) resolve(b);
                    else reject(new Error("toBlob"));
                  }, "image/png");
                } catch (e) {
                  cleanup();
                  reject(e);
                }
              };
              img.onerror = () => {
                cleanup();
                reject(new Error("img"));
              };
              img.crossOrigin = "anonymous";
              img.src = objectUrl;
            });
          } catch {
            itemBlob = blob;
          }
        }
        await navigator.clipboard.write([
          new ClipboardItem({ [itemBlob.type || "image/png"]: itemBlob }),
        ]);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
        return;
      }
      // 无图剪贴板：退化为下载
      triggerBlobDownload(blob, filenameFromSrc(src, alt || undefined));
    } catch {
      await handleDownload();
    }
  }, [src, alt, handleDownload]);

  if (!src) return null;

  const showActions =
    (loaded || width != null || height != null) && !failed;

  return (
    <span className="agent-md-image-wrap group/mdimg relative my-2 inline-block max-w-full">
      <img
        src={src}
        alt={alt || ""}
        width={width}
        height={height}
        className={cn(
          "max-w-full rounded-lg border border-border-soft",
          failed && "hidden",
          className,
        )}
        onLoad={onLoad}
        onError={onError}
        {...(rest as ComponentProps<"img">)}
      />
      {failed ? (
        <span className="text-[12px] italic text-fg-faint">图片不可用</span>
      ) : null}
      {showActions ? (
        <span className="agent-md-image-actions pointer-events-none absolute right-2 bottom-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/mdimg:pointer-events-auto group-hover/mdimg:opacity-100">
          <button
            type="button"
            className="agent-md-icon-btn"
            title="复制图片"
            aria-label="复制图片"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleCopy();
            }}
          >
            {copied ? (
              <Check className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Copy className="size-3.5" strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            className="agent-md-icon-btn"
            title="下载图片"
            aria-label="下载图片"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleDownload();
            }}
          >
            <Download className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
      ) : null}
    </span>
  );
}

const MD_COMPONENTS = {
  img: MarkdownImage,
} as Components;

function MarkdownContentInner({
  content,
  isStreaming = false,
  className,
}: MarkdownContentProps) {
  const mode = isStreaming ? "streaming" : "static";

  return (
    <Streamdown
      mode={mode}
      isAnimating={Boolean(isStreaming)}
      parseIncompleteMarkdown
      plugins={STREAMDOWN_PLUGINS}
      shikiTheme={[...SHIKI_THEME]}
      controls={CONTROLS}
      lineNumbers={false}
      animated={false}
      caret={undefined}
      translations={STREAMDOWN_ZH}
      components={MD_COMPONENTS}
      className={cn("agent-md", className)}
    >
      {content}
    </Streamdown>
  );
}

export const MarkdownContent = memo(MarkdownContentInner);
