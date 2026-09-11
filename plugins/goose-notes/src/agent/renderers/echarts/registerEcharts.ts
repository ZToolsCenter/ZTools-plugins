/**
 * ECharts 按需注册（非全量 import "echarts"）。
 *
 * Chart：bar / line / pie / scatter / heatmap（简化格式）+ radar（AI 原生 option 常见）
 * Component：grid / tooltip / legend / title / visualMap / dataset / transform / radar
 * Renderer：svg（EChartsBlock / ChartCard 统一，文字可选中复制）
 *
 * AI 可能输出任意原生 ECharts JSON；未注册的 series.type 会渲染空白，
 * 此处宁可多注册常用 Cartesian / 极坐标类型，也不回退全量包。
 */
import * as echarts from "echarts/core";
import {
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
} from "echarts/charts";
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  RadarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  DatasetComponent,
  TransformComponent,
  RadarComponent,
  CanvasRenderer,
  SVGRenderer,
]);

export { echarts };
