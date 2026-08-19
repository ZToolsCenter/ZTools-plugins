/**
 * showChart 工具的输出渲染卡片
 * 与编辑器 EChartsBlock 共用 chartTheme / chartPalette，保证视觉一致
 */
import { useCallback, useEffect, useMemo, useRef, useId } from "react";
import { useSettings } from "@/stores/useSettings";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import {
  buildOption,
  type SimplifiedConfig,
  type ChartType,
} from "@/agent/renderers/echarts/chartTheme";
import { getPalette } from "@/agent/renderers/echarts/chartPalette";
import { calculateContentAwarePixelRatio } from "@/lib/imageExport/svgToPng";
import { ArtifactActions } from "./ArtifactActions";

interface ChartSeries {
  name: string;
  data: number[];
}

interface ChartCardProps {
  type: "bar" | "line" | "pie";
  title?: string;
  categories?: string[];
  series: ChartSeries[];
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("图表导出失败");
  const blob = await response.blob();
  if (!blob.size) throw new Error("图表导出为空");
  return blob;
}

export function ChartCard(props: ChartCardProps) {
  const theme = useSettings((state) => state.theme);
  const resolvedTheme = useResolvedTheme(theme);
  const isDark = resolvedTheme === "dark";
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{
    setOption: (o: unknown, opts?: { notMerge?: boolean }) => void;
    resize: () => void;
    dispose: () => void;
    getWidth: () => number;
    getHeight: () => number;
    getDataURL: (opts?: {
      type?: string;
      pixelRatio?: number;
      backgroundColor?: string;
    }) => string;
  } | null>(null);
  const uid = useId();

  const option = useMemo(() => {
    // 标题由卡片外层 DOM 展示，option 内不再重复画 title
    const cfg: SimplifiedConfig = {
      type: props.type as ChartType,
      categories: props.categories,
      series: props.series,
    };
    // AI 面板内固定 scale=1，避免跟编辑器字号耦合
    return {
      color: getPalette(isDark),
      ...buildOption(cfg, isDark, 1),
    };
  }, [props.type, props.categories, props.series, isDark]);

  // 初始化实例
  useEffect(() => {
    let disposed = false;
    let chart: typeof chartRef.current = null;

    const init = async () => {
      if (!containerRef.current) return;
      const echarts = await import("echarts");
      if (disposed || !containerRef.current) return;
      chart = echarts.init(containerRef.current, undefined, {
        renderer: "svg",
      }) as typeof chartRef.current;
      chartRef.current = chart;
      chart?.setOption(option, { notMerge: true });
    };

    void init();

    const handleResize = () => {
      chartRef.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    // 容器尺寸变化（侧栏拖拽）也要 resize
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      ro = new ResizeObserver(handleResize);
      ro.observe(containerRef.current);
    }

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      ro?.disconnect();
      chart?.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // 配置 / 主题变化时重绘
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  const capturePngDataUrl = useCallback(async () => {
    const chart = chartRef.current;
    if (!chart) throw new Error("图表尚未就绪");
    const width = Math.max(1, chart.getWidth?.() || containerRef.current?.clientWidth || 1);
    const height = Math.max(
      1,
      chart.getHeight?.() || containerRef.current?.clientHeight || 1,
    );
    // 面板里图表显示宽度往往只有几百 px，固定 2× 会糊；按内容抬到 4K 冗余
    const pixelRatio = calculateContentAwarePixelRatio(width, height);
    return chart.getDataURL({
      type: "png",
      pixelRatio,
      backgroundColor: "transparent",
    });
  }, []);

  const capturePngBlob = useCallback(async () => {
    return dataUrlToBlob(await capturePngDataUrl());
  }, [capturePngDataUrl]);

  return (
    <div className="notebook-ai-chart-card group relative my-2 overflow-hidden">
      <ArtifactActions
        onCopyImage={capturePngDataUrl}
        onDownloadImage={capturePngBlob}
        downloadImageFilename="chart.png"
      />
      {props.title ? (
        <div className="notebook-ai-chart-card-title">{props.title}</div>
      ) : null}
      <div
        ref={containerRef}
        className="notebook-ai-chart-card-canvas"
        style={{ width: "100%", height: props.type === "pie" ? 260 : 240 }}
        role="img"
        aria-label={props.title ?? "图表"}
      />
    </div>
  );
}
