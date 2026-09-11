import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/**
 * 定义 json-render 的 Catalog。
 * 声明了 AI 可以使用的组件和它们的 props 类型。
 * 使用 @json-render/react/schema 中预定义的 schema，无需自己 defineSchema。
 */

export const jsonRenderCatalog = defineCatalog(schema, {
  actions: {},
  components: {
    Card: {
      props: z.object({
        className: z.string().optional(),
      }),
      description:
        "A card container with rounded corners and subtle shadow. Use as a top-level wrapper for grouped content.",
    },
    CardHeader: {
      props: z.object({
        className: z.string().optional(),
      }),
      description: "Header section inside a Card, typically contains title and description.",
    },
    CardTitle: {
      props: z.object({
        text: z.string().describe("The title text"),
        className: z.string().optional(),
      }),
      description: "Title text inside a CardHeader.",
    },
    CardDescription: {
      props: z.object({
        text: z.string().describe("The description text"),
        className: z.string().optional(),
      }),
      description: "Description/subtitle text inside a CardHeader.",
    },
    CardContent: {
      props: z.object({
        className: z.string().optional(),
      }),
      description: "Main content area inside a Card.",
    },
    CardFooter: {
      props: z.object({
        className: z.string().optional(),
      }),
      description: "Footer section inside a Card, typically contains action buttons.",
    },
    Button: {
      props: z.object({
        label: z.string().describe("Button text label"),
        variant: z
          .enum(["default", "destructive", "outline", "secondary", "ghost", "link"])
          .optional()
          .describe("Button visual style"),
        size: z.enum(["default", "sm", "lg", "icon"]).optional().describe("Button size"),
        disabled: z.boolean().optional(),
        className: z.string().optional(),
      }),
      description:
        "A clickable button. Use inside CardFooter or as standalone action trigger.",
    },
    Input: {
      props: z.object({
        placeholder: z.string().optional().describe("Placeholder text"),
        value: z.string().optional().describe("Current input value"),
        disabled: z.boolean().optional(),
        type: z.string().optional().describe("Input type: text, number, email, etc."),
        className: z.string().optional(),
      }),
      description: "A text input field. Use with Label for form-like interfaces.",
    },
    Label: {
      props: z.object({
        text: z.string().describe("Label text"),
        htmlFor: z.string().optional().describe("Associated input id"),
        className: z.string().optional(),
      }),
      description: "Text label for form inputs.",
    },
    Separator: {
      props: z.object({
        className: z.string().optional(),
      }),
      description: "A horizontal divider line. Use to separate content sections.",
    },
    Text: {
      props: z.object({
        content: z.string().describe("The text content to display"),
        size: z.enum(["xs", "sm", "base", "lg", "xl"]).optional().describe("Text size"),
        color: z
          .enum(["default", "muted", "primary", "secondary", "destructive"])
          .optional()
          .describe("Text color style"),
        className: z.string().optional(),
      }),
      description:
        "A plain text paragraph or span. Use for any text content that doesn't fit other components.",
    },
    FlexRow: {
      props: z.object({
        gap: z.enum(["1", "2", "3", "4", "6", "8"]).optional().describe("Gap between items"),
        align: z.enum(["start", "center", "end", "stretch"]).optional().describe("Vertical alignment"),
        justify: z.enum(["start", "center", "end", "between"]).optional().describe("Horizontal alignment"),
        className: z.string().optional(),
      }),
      description:
        "A horizontal flex container for laying out items in a row. Use for button groups, metric rows, etc.",
    },
    FlexCol: {
      props: z.object({
        gap: z.enum(["1", "2", "3", "4", "6", "8"]).optional().describe("Gap between items"),
        align: z.enum(["start", "center", "end", "stretch"]).optional().describe("Horizontal alignment"),
        className: z.string().optional(),
      }),
      description:
        "A vertical flex container for stacking items. Use as the default layout for card content.",
    },
    Grid: {
      props: z.object({
        cols: z
          .union([z.literal("2"), z.literal("3"), z.literal("4")])
          .optional()
          .describe("Number of columns (2, 3, or 4)"),
        gap: z.enum(["1", "2", "3", "4", "6", "8"]).optional().describe("Gap between grid items"),
        className: z.string().optional(),
      }),
      description:
        "A CSS grid container. Use for card grids, metric grids, comparison grids, etc.",
    },
    DataTable: {
      props: z.object({
        columns: z.array(z.string()).describe("Column header labels"),
        rows: z.array(z.array(z.string())).describe("Table rows, each row is an array of cell strings matching column count"),
        caption: z.string().optional().describe("Optional table caption shown below"),
        className: z.string().optional(),
      }),
      description:
        "A data table with column headers and rows. Use for structured tabular data. Provide columns as string array and rows as 2D string array.",
    },
    Progress: {
      props: z.object({
        value: z.number().min(0).max(100).describe("Progress value 0-100"),
        label: z.string().optional().describe("Optional label shown above the bar"),
        className: z.string().optional(),
      }),
      description:
        "A progress bar showing completion percentage (0-100). Use for tasks, loading states, skill levels.",
    },
    Badge: {
      props: z.object({
        text: z.string().describe("Badge label text"),
        variant: z
          .enum(["default", "secondary", "destructive", "outline"])
          .optional()
          .describe("Badge visual style: default (primary), secondary, destructive (red), outline"),
        className: z.string().optional(),
      }),
      description:
        "A small inline badge/tag for status labels, categories, or counts. Use inside FlexRow for tag groups.",
    },
    Stat: {
      props: z.object({
        label: z.string().describe("Metric label, e.g. 'Total Revenue'"),
        value: z.string().describe("Primary metric value, e.g. '$12,345'"),
        delta: z.string().optional().describe("Change value, e.g. '+12%' or '-3.2'"),
        trend: z.enum(["up", "down", "flat"]).optional().describe("Trend direction affecting delta color"),
        className: z.string().optional(),
      }),
      description:
        "A single metric/stat display with label, value, and optional delta trend. Use inside Grid for metric dashboards.",
    },
  },
});

/**
 * 获取给 AI 的 json-render 说明片段。
 * 插入到 system prompt 中，告诉 AI 何时以及如何使用 json-render。
 */
export function getJsonRenderPromptFragment(): string {
  return `
# json-render

用户要求界面、仪表盘、表单或卡片布局时，用 \`\`\`json-render\`\`\` 输出 Spec，不要输出完整 HTML。

可用组件：
${jsonRenderCatalog.componentNames.map((name) => `- ${name}`).join("\n")}

\`\`\`json-render
{
  "root": "card-1",
  "elements": {
    "card-1": { "type": "Card", "children": ["header-1", "content-1"] },
    "header-1": { "type": "CardHeader", "children": ["title-1"] },
    "title-1": { "type": "CardTitle", "props": { "text": "标题" } },
    "content-1": { "type": "CardContent", "children": ["text-1"] },
    "text-1": { "type": "Text", "props": { "content": "内容文本" } }
  }
}
\`\`\`

- 顶层用 Card；标题区用 CardHeader、CardTitle、CardDescription；主体用 CardContent。
- 横向用 FlexRow，纵向用 FlexCol，等宽网格用 Grid（2-4 列），指标用 Stat。
- 表格用 DataTable（columns + rows）；进度用 Progress（0-100）；标签用 Badge。
- 每个元素要有唯一 key，children 用 key 数组引用。
- 不用 className 控制布局。
`.trim();
}
