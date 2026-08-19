import { useCallback, useMemo, type RefObject } from "react";
import type { EditorRef } from "@/components/editor/core/Editor";
import { sanitizeSvgMarkup } from "@/lib/notebook-ai/svgSanitizer";
import { svgMarkupToPngBlob } from "@/lib/imageExport/svgToPng";
import { ArtifactActions } from "./ArtifactActions";
import { ArtifactPanZoom } from "./ArtifactPanZoom";
import { createSvgArtifactBlocks, insertArtifactBlocks } from "./insertArtifact";

interface SvgArtifactCardProps {
  title?: string;
  svg: string;
  editorRef?: RefObject<EditorRef | null>;
}

export function SvgArtifactCard({ title, svg, editorRef }: SvgArtifactCardProps) {
  const sanitizedSvg = useMemo(() => sanitizeSvgMarkup(svg), [svg]);

  const capturePng = useCallback(async () => {
    if (!sanitizedSvg.trim()) throw new Error("SVG 无法显示");
    return svgMarkupToPngBlob(sanitizedSvg);
  }, [sanitizedSvg]);

  return (
    <div className="group relative my-2 overflow-hidden rounded-[8px] bg-[var(--goose-interactive-hover)]">
      <ArtifactActions
        copySource={sanitizedSvg}
        onCopyImage={async () => capturePng()}
        onDownloadImage={capturePng}
        downloadImageFilename="artifact.png"
        onInsert={() =>
          insertArtifactBlocks(
            editorRef,
            createSvgArtifactBlocks(title, sanitizedSvg),
          )
        }
      />
      {title ? (
        <div className="px-3 py-2 text-xs font-medium text-foreground">
          {title}
        </div>
      ) : null}
      {sanitizedSvg ? (
        <ArtifactPanZoom contentKey={sanitizedSvg} minHeight={280}>
          <div
            aria-hidden="true"
            className="notebook-ai-artifact-svg"
            // Model SVG is allowlisted by sanitizeSvgMarkup before rendering.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
          />
        </ArtifactPanZoom>
      ) : (
        <div className="flex min-h-[180px] items-center justify-center px-3 py-4 text-xs text-muted-foreground">
          SVG 无法显示
        </div>
      )}
    </div>
  );
}
