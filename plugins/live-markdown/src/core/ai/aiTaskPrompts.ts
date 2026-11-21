export type AiTaskAction =
  | "continue" | "polish" | "proofread" | "diagram" | "summarize"
  | "academic-polish" | "tech-spec" | "custom" | "mermaid-architect"
  | "quick-summarize" | "content-expand" | "typo-proofread";

export interface AiActionDefinition {
  id: AiTaskAction;
  label: string;
  prompt: string;
  system?: string;
}

export const AI_ACTIONS: AiActionDefinition[] = [
  { id: "polish", label: "润色", prompt: "请对以下 Markdown 正文进行润色，保持原意、结构与事实。", system: "优化表达，保持原意和 Markdown 结构。" },
  { id: "proofread", label: "校对", prompt: "请校对以下 Markdown 正文中的错别字、标点和中英文间距；正确内容保持原样。", system: "严格校对，只修正错字、标点和间距，禁止润色、改写或扩充正确内容。保持原意与 Markdown 结构。" },
  { id: "summarize", label: "总结", prompt: "为以下 Markdown 文档提取核心摘要与关键结论。", system: "忠于原文总结，不补充未提及事实。" },
  { id: "continue", label: "续写", prompt: "基于给出的全文上下文，沿用原文语气与结构续写 2-3 段。只输出新增内容。", system: "只续写一次，不重复上下文，不输出客套话。" },
  { id: "diagram", label: "图表", prompt: "基于以下内容生成有效的 Mermaid 图表代码块，只输出代码块。", system: "仅输出 Mermaid Markdown 代码块。" },
  { id: "academic-polish", label: "学术润色", prompt: "", system: "保持论证严谨与术语一致，输出完整 Markdown。" },
  { id: "tech-spec", label: "技术方案", prompt: "", system: "按清晰的技术方案结构整理，保留已知事实，输出完整 Markdown。" }
];

export const CONSERVATIVE_AI_ACTIONS = new Set<AiTaskAction>([
  "polish", "proofread", "academic-polish", "typo-proofread"
]);

export function resolveAiSemanticAction(action: AiTaskAction, skillCategory?: string): AiTaskAction {
  if (skillCategory === "summary") return "summarize";
  if (skillCategory === "diagram") return "diagram";
  if (action === "quick-summarize") return "summarize";
  if (action === "mermaid-architect") return "diagram";
  if (action === "typo-proofread") return "proofread";
  return action;
}

export function isConservativeAiAction(action: AiTaskAction, skillId?: string, skillCategory?: string): boolean {
  if (skillId && skillCategory === "summary") return false;
  return CONSERVATIVE_AI_ACTIONS.has(action);
}

export function isReplacementAiAction(action: AiTaskAction, skillCategory?: string): boolean {
  const semanticAction = resolveAiSemanticAction(action, skillCategory);
  return !["summarize", "continue", "diagram"].includes(semanticAction) &&
    skillCategory !== "summary" && skillCategory !== "diagram";
}
