import * as echarts from "echarts";
import {
  getPalette,
  getSeriesColor,
  hexToRgba,
  HEATMAP_LIGHT,
  HEATMAP_DARK,
} from "./chartPalette";

// 与产品编辑器 / HtmlWidget 表面色对齐
export const TM = {
  light: {
    bg: "#ffffff",
    tc: "#141413",
    sc: "#5c5b57",
    muted: "#8a8880",
    gl: "rgba(31,30,29,0.08)",
    glStrong: "rgba(31,30,29,0.14)",
    tooltipBg: "rgba(255,255,255,0.96)",
    tooltipBorder: "rgba(31,30,29,0.08)",
    tooltipShadow: "0 10px 28px rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.06)",
    axisPointer: "rgba(79,70,229,0.08)",
    pieBorder: "#ffffff",
  },
  dark: {
    bg: "#2E2E2D",
    tc: "#faf9f5",
    sc: "#c2c0b6",
    muted: "#8a8880",
    gl: "rgba(222,220,209,0.08)",
    glStrong: "rgba(222,220,209,0.14)",
    tooltipBg: "rgba(46,46,45,0.96)",
    tooltipBorder: "rgba(222,220,209,0.12)",
    tooltipShadow: "0 12px 32px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3)",
    axisPointer: "rgba(129,140,248,0.12)",
    pieBorder: "#2E2E2D",
  },
};

export const CHART_MIN_HEIGHT = 220;
export const CHART_MAX_HEIGHT = 620;

export type ChartType = "bar" | "line" | "area" | "pie" | "scatter" | "heatmap";

export const KNOWN_TYPES = new Set<ChartType>([
  "bar",
  "line",
  "area",
  "pie",
  "scatter",
  "heatmap",
]);

export interface SimplifiedConfig {
  type: ChartType;
  title?: string;
  categories?: string[];
  yCategories?: string[];
  xAxisName?: string;
  yAxisName?: string;
  series: { name: string; data: unknown[] }[];
  visualMap?: { min?: number; max?: number };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function parseConfig(raw: Record<string, unknown>): SimplifiedConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type as string | undefined;
  if (!type || !KNOWN_TYPES.has(type as ChartType)) return null;
  const series = raw.series;
  if (!Array.isArray(series) || series.length === 0) return null;
  return raw as unknown as SimplifiedConfig;
}

/**
 * 检测 AI 是否输出了原生 ECharts option（而非我们的简化格式）。
 * 原生格式：没有 root type，series 数组的每项有 type 字段。
 */
export function isRawEChartsOption(raw: Record<string, unknown>): boolean {
  if (!raw || typeof raw !== "object") return false;
  const series = raw.series;
  if (!Array.isArray(series) || series.length === 0) return false;
  return (
    typeof (series[0] as Record<string, unknown>)?.type === "string" ||
    "xAxis" in raw ||
    "yAxis" in raw
  );
}

function verticalGradient(
  top: string,
  bottom: string,
): echarts.graphic.LinearGradient {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: top },
    { offset: 1, color: bottom },
  ]);
}

function areaGradient(hex: string): echarts.graphic.LinearGradient {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: hexToRgba(hex, 0.32) },
    { offset: 0.55, color: hexToRgba(hex, 0.1) },
    { offset: 1, color: hexToRgba(hex, 0.02) },
  ]);
}

function barGradient(hex: string, isDark: boolean): echarts.graphic.LinearGradient {
  // 顶部略亮、底部略深，增加体积感但不抢戏
  if (isDark) {
    return verticalGradient(hexToRgba(hex, 1), hexToRgba(hex, 0.72));
  }
  return verticalGradient(hex, hexToRgba(hex, 0.82));
}

export function buildOption(
  cfg: SimplifiedConfig,
  isDark: boolean,
  scale: number,
): echarts.EChartsOption {
  const t = isDark ? TM.dark : TM.light;
  const palette = getPalette(isDark);
  const multiSeries = cfg.series.length > 1;
  const isCartesian = cfg.type !== "pie";
  const actualType = cfg.type === "area" ? "line" : cfg.type;
  const inset = Math.round(16 * scale);
  const titleTop = Math.round(2 * scale);
  const titleFontSize = Math.max(13, Math.round(14 * scale));
  const labelFontSize = Math.max(11, Math.round(12 * scale));
  const labelSmallFontSize = Math.max(10, Math.round(11 * scale));
  const titleOffset = cfg.title ? Math.round(28 * scale) : 0;
  const legendOffset = multiSeries ? Math.round(26 * scale) : 0;
  const isLineLike = cfg.type === "line" || cfg.type === "area";

  /* ── base ──────────────────────────────────────────────────────── */
  const option: echarts.EChartsOption = {
    backgroundColor: "transparent",
    color: palette,
    textStyle: {
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      color: t.sc,
    },
    // 尊重系统「减少动态效果」偏好
    animation: typeof window === "undefined"
      ? true
      : !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    animationDuration: 720,
    animationEasing: "cubicOut",
    animationDurationUpdate: 360,
    title: cfg.title
      ? {
          text: cfg.title,
          left: inset,
          top: titleTop,
          textAlign: "left",
          textStyle: {
            color: t.tc,
            fontSize: titleFontSize,
            fontWeight: 600,
          },
        }
      : undefined,
    tooltip: {
      trigger: isCartesian ? "axis" : "item",
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      padding: [Math.round(8 * scale), Math.round(12 * scale)],
      textStyle: {
        color: t.tc,
        fontSize: labelFontSize,
        fontWeight: 500,
      },
      extraCssText: `border-radius:10px;box-shadow:${t.tooltipShadow};backdrop-filter:blur(10px);`,
      axisPointer: isCartesian
        ? {
            type: isLineLike ? "line" : "shadow",
            shadowStyle: { color: t.axisPointer },
            lineStyle: {
              color: isDark ? "rgba(129,140,248,0.45)" : "rgba(79,70,229,0.35)",
              width: 1,
              type: "dashed",
            },
            label: { show: false },
          }
        : undefined,
      // 饼图更友好的百分比
      ...(cfg.type === "pie"
        ? {
            formatter: "{b}<br/>{c}  ·  {d}%",
          }
        : {}),
    },
    legend: multiSeries
      ? {
          // 饼图 legend 放底部更稳；笛卡尔图放标题旁
          ...(cfg.type === "pie"
            ? {
                bottom: Math.round(4 * scale),
                left: "center",
              }
            : {
                top: titleTop + titleOffset - Math.round(2 * scale),
                left: inset,
                right: inset,
              }),
          icon: "circle",
          itemWidth: Math.round(8 * scale),
          itemHeight: Math.round(8 * scale),
          itemGap: Math.round(14 * scale),
          textStyle: {
            color: t.sc,
            fontSize: labelFontSize,
            fontWeight: 500,
          },
          pageTextStyle: { color: t.sc },
        }
      : undefined,
  };

  /* ── cartesian axes ────────────────────────────────────────────── */
  if (isCartesian && cfg.type !== "heatmap") {
    option.grid = {
      containLabel: true,
      left: inset,
      right: inset,
      top: inset + titleOffset + legendOffset,
      bottom: inset - Math.round(2 * scale),
    };
    option.xAxis = {
      type: "category",
      data: cfg.categories,
      name: cfg.xAxisName,
      nameTextStyle: { color: t.muted, fontSize: labelSmallFontSize },
      nameGap: Math.round(8 * scale),
      boundaryGap: isLineLike ? false : true,
      axisLabel: {
        color: t.muted,
        fontSize: labelSmallFontSize,
        margin: Math.round(10 * scale),
        hideOverlap: true,
      },
      axisLine: {
        show: true,
        lineStyle: { color: t.glStrong, width: 1 },
      },
      axisTick: { show: false },
      splitLine: { show: false },
    };
    option.yAxis = {
      type: "value",
      name: cfg.yAxisName,
      nameTextStyle: { color: t.muted, fontSize: labelSmallFontSize },
      nameGap: Math.round(10 * scale),
      axisLabel: {
        color: t.muted,
        fontSize: labelSmallFontSize,
        margin: Math.round(8 * scale),
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        show: true,
        lineStyle: {
          color: t.gl,
          type: "dashed",
          width: 1,
        },
      },
      splitNumber: 4,
    };
  }

  /* ── heatmap axes & visualMap ──────────────────────────────────── */
  if (cfg.type === "heatmap") {
    option.grid = {
      containLabel: true,
      left: inset,
      right: inset + Math.round(42 * scale),
      top: inset + titleOffset + legendOffset,
      bottom: inset - Math.round(2 * scale),
    };
    option.xAxis = {
      type: "category",
      data: cfg.categories,
      name: cfg.xAxisName,
      nameTextStyle: { color: t.muted, fontSize: labelSmallFontSize },
      axisLabel: { color: t.muted, fontSize: labelSmallFontSize },
      axisLine: { lineStyle: { color: t.glStrong } },
      axisTick: { show: false },
      splitArea: { show: true, areaStyle: { color: [t.gl, "transparent"] } },
    };
    option.yAxis = {
      type: "category",
      data: cfg.yCategories,
      name: cfg.yAxisName,
      nameTextStyle: { color: t.muted, fontSize: labelSmallFontSize },
      axisLabel: { color: t.muted, fontSize: labelSmallFontSize },
      axisLine: { lineStyle: { color: t.glStrong } },
      axisTick: { show: false },
      splitArea: { show: true, areaStyle: { color: [t.gl, "transparent"] } },
    };

    let vmMin = cfg.visualMap?.min ?? 0;
    let vmMax = cfg.visualMap?.max ?? 100;
    if (cfg.visualMap?.min == null || cfg.visualMap?.max == null) {
      const allValues: number[] = [];
      for (const s of cfg.series) {
        for (const d of s.data) {
          const val = Array.isArray(d)
            ? (d as number[])[2]
            : typeof d === "number"
              ? d
              : null;
          if (val != null && Number.isFinite(val)) allValues.push(val);
        }
      }
      if (allValues.length > 0) {
        if (cfg.visualMap?.min == null) vmMin = Math.min(...allValues);
        if (cfg.visualMap?.max == null) vmMax = Math.max(...allValues);
      }
    }

    option.visualMap = {
      min: vmMin,
      max: vmMax,
      calculable: true,
      orient: "vertical",
      right: Math.max(4, Math.round(4 * scale)),
      top: "middle",
      itemWidth: Math.round(10 * scale),
      itemHeight: Math.round(120 * scale),
      textStyle: { color: t.sc, fontSize: labelSmallFontSize },
      inRange: {
        color: isDark ? HEATMAP_DARK : HEATMAP_LIGHT,
      },
    };
  }

  /* ── series ────────────────────────────────────────────────────── */
  option.series = cfg.series.map((s, i) => {
    const color = getSeriesColor(i, isDark);
    const base: Record<string, unknown> = {
      name: s.name,
      data: s.data,
      type: actualType,
      animationDelay: (idx: number) => idx * 18 + i * 40,
    };

    if (cfg.type === "bar") {
      base.barMaxWidth = Math.round((multiSeries ? 28 : 40) * scale);
      base.barMinWidth = Math.round(6 * scale);
      base.barGap = "28%";
      base.barCategoryGap = "42%";
      base.itemStyle = {
        color: barGradient(color, isDark),
        borderRadius: multiSeries
          ? [Math.round(4 * scale), Math.round(4 * scale), 0, 0]
          : [Math.round(7 * scale), Math.round(7 * scale), 0, 0],
      };
      base.emphasis = {
        focus: "series",
        itemStyle: {
          shadowBlur: 12,
          shadowColor: hexToRgba(color, 0.35),
          shadowOffsetY: 3,
        },
      };
    }

    if (cfg.type === "line" || cfg.type === "area") {
      base.smooth = 0.35;
      base.symbol = "circle";
      base.symbolSize = Math.max(5, Math.round(6 * scale));
      // 多系列默认隐藏点，悬停再显示；单系列同样
      base.showSymbol = false;
      base.lineStyle = {
        width: Math.max(2, Math.round((multiSeries ? 2 : 2.5) * scale)),
        color,
        shadowColor: hexToRgba(color, multiSeries ? 0.12 : 0.25),
        shadowBlur: multiSeries ? 3 : 6,
        shadowOffsetY: multiSeries ? 1 : 2,
      };
      base.itemStyle = {
        color,
        borderColor: isDark ? TM.dark.bg : "#ffffff",
        borderWidth: 2,
      };
      base.emphasis = {
        focus: "series",
        scale: true,
        itemStyle: {
          borderWidth: 2,
          shadowBlur: 8,
          shadowColor: hexToRgba(color, 0.4),
        },
      };
      if (cfg.type === "area") {
        // 多系列面积降低不透明度，避免叠成泥
        base.areaStyle = {
          color: multiSeries
            ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: hexToRgba(color, 0.18) },
                { offset: 1, color: hexToRgba(color, 0.02) },
              ])
            : areaGradient(color),
          origin: "start",
        };
      } else if (!multiSeries) {
        // 单系列折线也给极轻面积，避免「光秃线」
        base.areaStyle = {
          color: areaGradient(color),
          opacity: 0.85,
        };
      }
    }

    if (cfg.type === "pie") {
      const isMultiRing = multiSeries;
      base.radius = isMultiRing
        ? [`${30 + i * 14}%`, `${42 + i * 14}%`]
        : ["44%", "70%"];
      base.center = ["50%", cfg.title || multiSeries ? "54%" : "50%"];
      base.padAngle = 2;
      base.minShowLabelAngle = 8;
      base.itemStyle = {
        borderRadius: Math.round(7 * scale),
        borderColor: t.pieBorder,
        borderWidth: Math.round(2.5 * scale),
      };
      base.label = {
        color: t.sc,
        fontSize: labelSmallFontSize,
        fontWeight: 500,
        formatter: "{b}\n{d}%",
        lineHeight: Math.round(16 * scale),
      };
      base.labelLine = {
        length: Math.round(12 * scale),
        length2: Math.round(8 * scale),
        smooth: 0.2,
        lineStyle: { color: t.glStrong, width: 1 },
      };
      base.emphasis = {
        scale: true,
        scaleSize: 6,
        itemStyle: {
          shadowBlur: 16,
          shadowColor: "rgba(0,0,0,0.18)",
        },
        label: {
          fontWeight: 600,
          color: t.tc,
        },
      };
      base.animationType = "scale";
      base.animationEasing = "cubicOut";
      // 中心留白更干净的环形；单环时不塞文字，避免拥挤
      if (!isMultiRing && i === 0) {
        base.avoidLabelOverlap = true;
      }
    }

    if (cfg.type === "scatter") {
      base.symbolSize = Math.max(8, Math.round(9 * scale));
      base.itemStyle = {
        color: hexToRgba(color, 0.78),
        borderColor: color,
        borderWidth: 1.5,
        shadowBlur: 6,
        shadowColor: hexToRgba(color, 0.25),
      };
      base.emphasis = {
        focus: "series",
        scale: 1.2,
        itemStyle: {
          shadowBlur: 12,
          shadowColor: hexToRgba(color, 0.4),
        },
      };
    }

    if (cfg.type === "heatmap") {
      base.label = {
        show: true,
        color: t.tc,
        fontSize: labelSmallFontSize,
        fontWeight: 500,
      };
      base.itemStyle = {
        borderColor: isDark ? "rgba(46,46,45,0.65)" : "rgba(255,255,255,0.85)",
        borderWidth: 1.5,
        borderRadius: 3,
      };
      base.emphasis = {
        itemStyle: {
          shadowBlur: 8,
          shadowColor: "rgba(0,0,0,0.2)",
        },
      };
    }

    return base as echarts.SeriesOption;
  });

  return option;
}

/**
 * 给原生 ECharts option 注入统一主题色与基础 tooltip（不破坏用户自定义 series）。
 */
export function polishRawOption(
  raw: echarts.EChartsOption,
  isDark: boolean,
): echarts.EChartsOption {
  const t = isDark ? TM.dark : TM.light;
  const palette = getPalette(isDark);
  const rawTooltip =
    typeof raw.tooltip === "object" && raw.tooltip ? raw.tooltip : {};
  return {
    ...raw,
    color: raw.color ?? palette,
    backgroundColor: "transparent",
    textStyle: {
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      color: t.sc,
      ...(raw.textStyle as object),
    },
    animation: raw.animation ?? true,
    animationDuration: raw.animationDuration ?? 720,
    animationEasing: raw.animationEasing ?? "cubicOut",
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: t.tc, fontSize: 12, fontWeight: 500 },
      extraCssText: `border-radius:10px;box-shadow:${t.tooltipShadow};backdrop-filter:blur(10px);`,
      ...rawTooltip,
    },
  } as echarts.EChartsOption;
}

export function getPreferredChartHeight(
  rawConfig: Record<string, unknown>,
  width: number,
  scale: number,
) {
  const minHeight = Math.round(CHART_MIN_HEIGHT * scale);
  const maxHeight = Math.round(CHART_MAX_HEIGHT * scale);
  const safeWidth = Math.max(width, 320);
  const parsed = parseConfig(rawConfig);

  if (!parsed) {
    return clamp(
      Math.round(240 * scale) + Math.round(Math.min(safeWidth, 720) * 0.12),
      minHeight,
      Math.round(420 * scale),
    );
  }

  const titleExtra = parsed.title ? Math.round(26 * scale) : 0;
  const legendExtra = parsed.series.length > 1 ? Math.round(24 * scale) : 0;

  switch (parsed.type) {
    case "pie":
      return clamp(
        Math.round(260 * scale) + titleExtra + legendExtra,
        minHeight,
        Math.round(440 * scale),
      );
    case "scatter":
      return clamp(
        Math.round(250 * scale) +
          Math.round(Math.min(safeWidth, 880) * 0.08) +
          titleExtra +
          legendExtra,
        minHeight,
        Math.round(460 * scale),
      );
    case "heatmap": {
      const rowCount = parsed.yCategories?.length ?? 0;
      const columnCount = parsed.categories?.length ?? 0;
      const baseHeight =
        Math.round(170 * scale) +
        rowCount * Math.round(22 * scale) +
        Math.min(columnCount, 10) * Math.round(2 * scale) +
        titleExtra +
        legendExtra;
      return clamp(baseHeight, Math.round(260 * scale), maxHeight);
    }
    default: {
      const categoryCount = parsed.categories?.length ?? 0;
      const seriesExtra =
        Math.max(0, parsed.series.length - 1) * Math.round(8 * scale);
      return clamp(
        Math.round(220 * scale) +
          titleExtra +
          legendExtra +
          Math.min(categoryCount, 12) * Math.round(9 * scale) +
          seriesExtra,
        minHeight,
        Math.round(420 * scale),
      );
    }
  }
}
