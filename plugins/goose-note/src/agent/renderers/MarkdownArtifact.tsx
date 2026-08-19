import React, { useMemo, type ReactNode } from "react";
import MarkdownIt from "markdown-it";
import { LoaderCircle } from "lucide-react";
import { Suspense } from "react";
const EChartsBlock = React.lazy(() =>
  import("./EChartsBlock").then((m) => ({ default: m.EChartsBlock })),
);
import { HtmlWidgetBlock } from "./HtmlWidgetBlock";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { registry } from "./json-render-registry";
import {
  type Segment,
  looksLikeStandaloneHtml,
  useDatavizSegments,
  useStreamingSegments,
} from "./useArtifactRender";
import { stripMarkdownHardBreaks } from "@/components/editor/core/EditorComposer";

export const md = new MarkdownIt({ html: false, linkify: true, typographer: false }).enable("table");

/* ── shared primitives ─────────────────────────────────────────── */

export function DatavizSurface({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col gap-4">{children}</div>;
}

export const MarkdownSegmentModule = React.memo(function MarkdownSegmentModule({ content }: { content: string }) {
  return (
    <section
      className="ai-markdown break-words text-sm leading-7"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: md.render(content) }}
    />
  );
});

/** 渲染单个 ECharts dataviz 块，带工具栏 */
export const EChartsSegment = React.memo(function EChartsSegment({ content }: { content: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const config = useMemo(() => {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [content]);

  if (!config) {
    return (
      <div className="ai-markdown break-words text-sm leading-7">
        <pre><code>{content}</code></pre>
      </div>
    );
  }

  return (
    <section className="relative overflow-visible">
      <Suspense fallback={<div style={{ minHeight: 240, width: "100%" }} />}>
        <EChartsBlock ref={ref} config={config} />
      </Suspense>
    </section>
  );
});

/** 渲染单个 HTML widget 块 */
export const HtmlWidgetSegment = React.memo(function HtmlWidgetSegment({ content }: { content: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  return (
    <section className="relative overflow-visible">
      <HtmlWidgetBlock ref={ref} html={content} />
    </section>
  );
});

/** 流式 HTML widget 块，生成中保持可视化预览 */
export const StreamingHtmlWidgetSegment = React.memo(function StreamingHtmlWidgetSegment({ content }: { content: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  return (
    <section className="relative overflow-visible">
      <HtmlWidgetBlock ref={ref} html={content} streaming={true} />
    </section>
  );
});

/** 图表/组件生成中的 loading 占位 — sticky 固定在顶部不随内容移动 */
export function DatavizLoadingPlaceholder({ type }: { type: "echarts" | "html" | "json-render" }) {
  const label =
    type === "echarts"
      ? "正在生成图表…"
      : type === "html"
        ? "正在生成交互组件…"
        : "正在生成界面组件…";
  return (
    <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-lg bg-background/90 px-3 py-2 text-sm text-muted-foreground backdrop-blur-sm">
      <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
      <span>{label}</span>
    </div>
  );
}

/** 渲染单个 json-render UI 块 */
export const JsonRenderSegment = React.memo(function JsonRenderSegment({ content }: { content: string }) {
  const spec = useMemo(() => {
    try {
      return JSON.parse(content) as import("@json-render/core").Spec;
    } catch {
      return null;
    }
  }, [content]);

  if (!spec) {
    return (
      <div className="ai-markdown break-words text-sm leading-7">
        <pre><code>{content}</code></pre>
      </div>
    );
  }

  return (
    <section className="relative overflow-visible">
      <JSONUIProvider registry={registry}>
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>
    </section>
  );
});

function segmentKey(seg: Segment, index: number): string {
  return `${seg.type}-${index}`;
}

/** 渲染 dataviz 段落列表（复用于最终态和流式态） */
export const DatavizSegmentList = React.memo(function DatavizSegmentList({
  segments,
  trailing,
}: {
  segments: Segment[];
  trailing?: ReactNode;
}) {
  return (
    <DatavizSurface>
      {segments.map((seg, i) => {
        const key = segmentKey(seg, i);
        if (seg.type === "echarts") {
          return <EChartsSegment key={key} content={seg.content} />;
        }
        if (seg.type === "html") {
          return <HtmlWidgetSegment key={key} content={seg.content} />;
        }
        if (seg.type === "json-render") {
          return <JsonRenderSegment key={key} content={seg.content} />;
        }
        return <MarkdownSegmentModule key={key} content={seg.content} />;
      })}
      {trailing}
    </DatavizSurface>
  );
});

/* ── streaming renderer ────────────────────────────────────────── */

/**
 * 流式输出阶段的 dataviz 感知渲染器。
 * 已完成的 echarts/html 块立即渲染为图表，未闭合的块显示 loading。
 */
export function StreamingDatavizText({
  text,
  streaming,
  streamPhaseLabel,
}: {
  text: string;
  streaming: boolean;
  streamPhaseLabel?: string;
}) {
  const { segments, hasIncompleteBlock, incompleteBlockType, incompleteContent } =
    useStreamingSegments(text, streaming);

  const hasDataviz = segments.some((s) => s.type !== "markdown") || hasIncompleteBlock;

  // 无 dataviz 内容时保持原始纯文本渲染
  if (!hasDataviz) {
    const cleanedText = stripMarkdownHardBreaks(text);
    if (!streaming && cleanedText) {
      return (
        <div
          className="ai-markdown break-words text-sm leading-7"
          dangerouslySetInnerHTML={{ __html: md.render(cleanedText) }}
        />
      );
    }
    return (
      <>
        <div className="whitespace-pre-wrap break-words text-sm leading-7">{cleanedText}</div>
        {streaming && (
          <div className="mt-2.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "200ms", animationDuration: "1s" }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "400ms", animationDuration: "1s" }} />
            {streamPhaseLabel && <span className="ml-1 text-xs text-muted-foreground/70">{streamPhaseLabel}</span>}
          </div>
        )}
      </>
    );
  }

  const standaloneStreamingHtml =
    streaming &&
    !hasIncompleteBlock &&
    segments.length === 1 &&
    segments[0]?.type === "markdown" &&
    looksLikeStandaloneHtml(segments[0].content);

  if (standaloneStreamingHtml) {
    return (
      <div className="break-words text-sm leading-7">
        <DatavizLoadingPlaceholder type="html" />
        <DatavizSurface>
          <StreamingHtmlWidgetSegment content={segments[0].content} />
        </DatavizSurface>
      </div>
    );
  }

  const streamingHtmlTrailing =
    hasIncompleteBlock && incompleteBlockType === "html" && incompleteContent ? (
      <StreamingHtmlWidgetSegment content={incompleteContent} />
    ) : undefined;

  const activeDatavizType =
    incompleteBlockType ??
    [...segments].reverse().find((seg) => seg.type !== "markdown")?.type ??
    "html";
  const leading =
    streaming && (hasIncompleteBlock || hasDataviz) ? (
      <DatavizLoadingPlaceholder type={activeDatavizType} />
    ) : undefined;

  return (
    <div className="break-words text-sm leading-7">
      {leading}
      <DatavizSegmentList segments={segments} trailing={streamingHtmlTrailing} />
      {streaming && !leading && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "200ms", animationDuration: "1s" }} />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "400ms", animationDuration: "1s" }} />
          {streamPhaseLabel && <span className="ml-1 text-xs text-muted-foreground/70">{streamPhaseLabel}</span>}
        </div>
      )}
    </div>
  );
}
