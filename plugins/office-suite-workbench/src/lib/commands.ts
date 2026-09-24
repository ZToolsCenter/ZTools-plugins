import type { OfficeFormat } from "../types";

export type QuickActionId = "outline" | "text" | "stats" | "issues" | "validate" | "screenshot";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  description: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "outline", label: "结构速览", description: "读取文档层级与关键节点" },
  { id: "text", label: "提取正文", description: "抽取可检索的纯文本内容" },
  { id: "stats", label: "内容统计", description: "查看页数、字数、形状和工作表" },
  { id: "issues", label: "格式体检", description: "定位溢出、格式和结构问题" },
  { id: "validate", label: "结构校验", description: "按 OpenXML schema 验证文件" },
  { id: "screenshot", label: "视觉预览", description: "渲染页面或幻灯片检查布局" }
];

export const RECIPES: Record<OfficeFormat, Array<{ title: string; command: (path: string) => string[] }>> = {
  word: [
    { title: "查找所有一级标题", command: path => ["query", path, "paragraph[style=Heading1]", "--json"] },
    { title: "检查非 Arial 正文字体", command: path => ["query", path, "paragraph[style=Normal] > run[font!=Arial]", "--json"] },
    { title: "导出带批注的文本", command: path => ["view", path, "annotated"] }
  ],
  excel: [
    { title: "列出含公式单元格", command: path => ["query", path, "cell:has(formula)", "--json"] },
    { title: "检查空白单元格", command: path => ["query", path, "cell:empty", "--json"] },
    { title: "读取首个工作表", command: path => ["get", path, "/sheet[1]", "--depth", "2", "--json"] }
  ],
  powerpoint: [
    { title: "检查缺少替代文本的图片", command: path => ["query", path, "picture:no-alt", "--json"] },
    { title: "列出所有幻灯片", command: path => ["get", path, "/", "--depth", "1", "--json"] },
    { title: "生成整套联系表", command: path => ["view", path, "screenshot", "--grid", "auto"] }
  ]
};

export function detectFormat(filePath: string): OfficeFormat | null {
  const extension = filePath.trim().toLowerCase().split(".").pop();
  if (extension === "docx") return "word";
  if (extension === "xlsx") return "excel";
  if (extension === "pptx") return "powerpoint";
  return null;
}

export function buildQuickCommand(action: QuickActionId, filePath: string): string[] {
  switch (action) {
    case "outline":
      return ["view", filePath, "outline"];
    case "text":
      return ["view", filePath, "text", "--max-lines", "240"];
    case "stats":
      return ["view", filePath, "stats", "--json"];
    case "issues":
      return ["view", filePath, "issues", "--limit", "100", "--json"];
    case "validate":
      return ["validate", filePath, "--json"];
    case "screenshot":
      return detectFormat(filePath) === "powerpoint"
        ? ["view", filePath, "screenshot", "--grid", "auto"]
        : ["view", filePath, "screenshot", "--page", "1"];
  }
}

export function formatCommand(argv: string[]): string {
  return argv.map(quoteArgument).join(" ");
}

export function quoteArgument(value: string): string {
  if (/^[A-Za-z0-9_./:@=,+-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

export function normalizeFilePayload(payload: unknown): string[] {
  const collected = new Set<string>();

  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      if (detectFormat(value)) collected.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    for (const key of ["path", "filePath", "payload", "files", "filePaths"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  };

  visit(payload, 0);
  return [...collected];
}
