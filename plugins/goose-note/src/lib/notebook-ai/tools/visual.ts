import { tool } from "ai";
import { z } from "zod";

export const showDiagramInputSchema = z.object({
  title: z.string().optional().describe("图形标题（可选）"),
  language: z.literal("mermaid").describe("图形 DSL 类型，固定为 mermaid"),
  source: z
    .string()
    .trim()
    .min(1)
    .describe("Mermaid DSL 源码，不要包含 ```mermaid 代码围栏"),
});

export const showSvgInputSchema = z.object({
  title: z.string().optional().describe("SVG 标题（可选）"),
  svg: z
    .string()
    .trim()
    .min(1)
    .describe("完整 SVG 标记，从 <svg> 开始，到 </svg> 结束"),
});

/**
 * showTable — 在对话中渲染表格卡片。
 * execute 原样返回 input，UI 层根据 output-available 状态渲染 TableCard。
 */
export const showTable = tool({
  description:
    "在对话里显示一个表格卡片，用于展示结构化数据。列名放在 columns，每行数据对应 rows 里的一个字符串数组。",
  inputSchema: z.object({
    title: z.string().optional().describe("表格标题（可选）"),
    columns: z.array(z.string()).describe("列名列表"),
    rows: z
      .array(z.array(z.string()))
      .describe("数据行，每行长度与 columns 一致"),
  }),
  execute: async (input) => input,
});

/**
 * showChart — 在对话中渲染 ECharts 图表卡片。
 * execute 原样返回 input，UI 层根据 output-available 状态渲染 ChartCard。
 */
export const showChart = tool({
  description:
    "在对话里显示一个图表卡片（折线/柱状/饼图），用于数值对比和趋势分析。",
  inputSchema: z.object({
    type: z
      .enum(["bar", "line", "pie"])
      .describe("图表类型：bar 柱状图、line 折线图、pie 饼图"),
    title: z.string().optional().describe("图表标题（可选）"),
    categories: z
      .array(z.string())
      .optional()
      .describe("X 轴分类标签，饼图时可省略"),
    series: z
      .array(
        z.object({
          name: z.string().describe("系列名称"),
          data: z.array(z.number()).describe("数值列表"),
        }),
      )
      .describe("数据系列，饼图时 data 长度应与 categories 一致"),
  }),
  execute: async (input) => input,
});

/**
 * showDiagram — 在对话中渲染 Mermaid 图形卡片。
 * 用于流程图、时序图、结构/关系/架构图等可由 Mermaid DSL 表达的图形。
 */
export const showDiagram = tool({
  description:
    "在对话里显示一个 Mermaid 图形卡片，用于流程图、时序图、架构图、关系图等结构化图形。source 只写 Mermaid DSL，不要包裹代码围栏。",
  inputSchema: showDiagramInputSchema,
  execute: async (input) => input,
});

/**
 * showSvg — 在对话中渲染原生 SVG artifact。
 * 仅用于用户明确要求 SVG / 矢量图 / 图标 / 示意图时。
 */
export const showSvg = tool({
  description:
    "在对话里显示一个 SVG 矢量图卡片。仅当用户明确要求 SVG、矢量图、图标或示意图时使用。svg 必须是完整 <svg>...</svg>，不要包含脚本、事件属性、foreignObject、外链图片或外链资源。",
  inputSchema: showSvgInputSchema,
  execute: async (input) => input,
});
