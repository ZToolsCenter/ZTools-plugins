import { useCallback, useMemo, type RefObject } from "react";
import type { EditorRef } from "@/components/editor/core/Editor";
import { sanitizeSvgMarkup } from "@/lib/notebook-ai/svgSanitizer";
import { svgMarkupToPngBlob } from "@/lib/imageExport/svgToPng";
import { useSettings } from "@/stores/useSettings";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { ArtifactActions } from "./ArtifactActions";
import { ArtifactPanZoom } from "./ArtifactPanZoom";
import { createSvgArtifactBlocks, insertArtifactBlocks } from "./insertArtifact";

interface SvgArtifactCardProps {
  title?: string;
  svg: string;
  editorRef?: RefObject<EditorRef | null>;
}

const EXPORT_PADDING = 48;
const EXPORT_PAPER_LIGHT = "#FFFEFA";
const EXPORT_PAPER_DARK = "#1F1E1C";

function canvasFilename(title?: string) {
  const base =
    title
      ?.trim()
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 40) || "图片";
  return `${base}.png`;
}

export function CanvasLoadingCard({ title }: { title?: string }) {
  return (
    <div
      className="notebook-ai-canvas-card my-2"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="notebook-ai-canvas-card-header">
        <div className="notebook-ai-canvas-card-title">{title?.trim() || "图片"}</div>
      </div>
      <div className="notebook-ai-canvas-card-loading">正在生成图片</div>
    </div>
  );
}

export function SvgArtifactCard({ title, svg, editorRef }: SvgArtifactCardProps) {
  const theme = useSettings((state) => state.theme);
  const resolvedTheme = useResolvedTheme(theme);
  const isDark = resolvedTheme === "dark";
  const sanitizedSvg = useMemo(() => sanitizeSvgMarkup(svg), [svg]);
  const filename = canvasFilename(title);

  const capturePng = useCallback(async () => {
    if (!sanitizedSvg.trim()) throw new Error("图片无法显示");
    return svgMarkupToPngBlob(sanitizedSvg, {
      padding: EXPORT_PADDING,
      backgroundColor: isDark ? EXPORT_PAPER_DARK : EXPORT_PAPER_LIGHT,
    });
  }, [isDark, sanitizedSvg]);

  return (
    <div className="notebook-ai-canvas-card my-2 overflow-hidden">
      <div className="notebook-ai-canvas-card-header">
        <div className="notebook-ai-canvas-card-title">{title?.trim() || "图片"}</div>
        {sanitizedSvg ? (
          <ArtifactActions
            copySource={sanitizedSvg}
            onCopyImage={async () => capturePng()}
            onDownloadImage={capturePng}
            downloadImageFilename={filename}
            onPreview={async () => {
              if (!sanitizedSvg.trim()) throw new Error("图片无法显示");
              return {
                kind: "svg",
                markup: sanitizedSvg,
                fileName: filename.replace(/\.png$/i, ".svg"),
                background: isDark ? EXPORT_PAPER_DARK : EXPORT_PAPER_LIGHT,
              };
            }}
            onInsert={() =>
              insertArtifactBlocks(
                editorRef,
                createSvgArtifactBlocks(title, sanitizedSvg),
              )
            }
          />
        ) : null}
      </div>
      {sanitizedSvg ? (
        <ArtifactPanZoom contentKey={sanitizedSvg} minHeight={280}>
          <div
            role="img"
            aria-label={title?.trim() || "图片"}
            className="notebook-ai-artifact-svg"
            // Model SVG is allowlisted by sanitizeSvgMarkup before rendering.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
        </ArtifactPanZoom>
      ) : (
        <div className="flex min-h-[180px] items-center justify-center px-3 py-4 text-xs text-muted-foreground">
          图片无法显示
        </div>
      )}
    </div>
  );
}
