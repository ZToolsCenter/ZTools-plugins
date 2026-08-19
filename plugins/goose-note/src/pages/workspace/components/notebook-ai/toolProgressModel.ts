import { formatNotebookAiError } from "@/lib/notebook-ai/errors";

export interface ToolProgressPart {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { approved?: boolean };
  toolCallId?: string;
}

export interface ProgressStep {
  label: string;
  detail: string;
  status: "running" | "done" | "error" | "waiting";
}

const INPUT_ONLY_STATES = new Set([
  "call",
  "partial-call",
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(text: string, max = 28) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function isInputOnly(part: ToolProgressPart) {
  return INPUT_ONLY_STATES.has(part.state ?? "");
}

const SKILL_LABELS: Record<string, string> = {
  createNoote: "新建笔记",
  updateNote: "修改笔记",
  deleteNote: "删除笔记",
  searchNotes: "搜索笔记",
  chat: "对话",
  visual: "可视化",
  webResearch: "网页研究",
};

export function getToolProgressStepStatus(
  part: ToolProgressPart,
  isMessageStreaming?: boolean,
): ProgressStep["status"] {
  if (part.state === "output-error" || part.errorText) return "error";
  if (
    part.type === "tool-executeBatchPlan" &&
    part.state === "output-available" &&
    readObject(part.output)?.ok === false
  ) {
    return "error";
  }
  if (part.state === "approval-requested") return "done";
  if (isInputOnly(part)) return isMessageStreaming ? "running" : "waiting";
  return "done";
}

function countOutput(output: unknown) {
  return Array.isArray(output) ? output.length : undefined;
}

export function getToolProgressStepText(
  part: ToolProgressPart,
): Pick<ProgressStep, "label" | "detail"> {
  const input = readObject(part.input);
  const output = readObject(part.output);
  const outputCount = countOutput(part.output);
  const outputError = asString(output?.error) || asString(part.errorText);
  const title =
    asString(input?.title) ||
    asString(output?.title) ||
    asString(input?.pageId) ||
    asString(output?.pageId);

  if (part.type === "tool-loadSkill") {
    const skill = asString(input?.skill);
    const skillLabel = SKILL_LABELS[skill] || "所需";
    return {
      label: "加载能力",
      detail: output ? `已加载${skillLabel}能力` : `正在加载${skillLabel}能力`,
    };
  }

  if (part.type === "tool-listNotebooks") {
    return {
      label: "查看记事本",
      detail:
        outputCount === undefined
          ? "正在查看可用记事本"
          : `已查看 ${outputCount} 个记事本`,
    };
  }

  if (part.type === "tool-listPages") {
    return {
      label: "查看页面列表",
      detail:
        outputCount === undefined
          ? "正在查看当前笔记本页面"
          : `已查看 ${outputCount} 个页面`,
    };
  }

  if (part.type === "tool-searchNotes") {
    const query = truncate(asString(input?.query) || "关键词");
    return {
      label: "搜索笔记",
      detail:
        outputCount === undefined
          ? `正在搜索“${query}”`
          : outputCount > 0
            ? `搜索“${query}”，找到 ${outputCount} 条`
            : `搜索“${query}”，没有匹配结果`,
    };
  }

  if (part.type === "tool-searchWeb") {
    const query = truncate(asString(input?.query) || "关键词");
    if (outputError)
      return { label: "联网搜索", detail: formatNotebookAiError(outputError) };
    return {
      label: "联网搜索",
      detail: output ? `已完成“${query}”的联网搜索` : `正在搜索“${query}”`,
    };
  }

  if (part.type === "tool-readWebPage") {
    const url = asString(input?.url);
    const host = (() => {
      try {
        return url ? new URL(url).hostname : "网页";
      } catch {
        return "网页";
      }
    })();
    if (outputError)
      return { label: "读取网页", detail: formatNotebookAiError(outputError) };
    return {
      label: "读取网页",
      detail: output
        ? `已读取 ${truncate(host)}`
        : `正在读取 ${truncate(host)}`,
    };
  }

  if (part.type === "tool-readPage") {
    if (outputError)
      return { label: "读取笔记", detail: formatNotebookAiError(outputError) };
    return {
      label: "读取笔记",
      detail: title ? `已读取《${truncate(title)}》` : "正在读取当前笔记",
    };
  }

  if (part.type === "tool-createPage") {
    return {
      label: "创建页面",
      detail: title ? `创建《${truncate(title)}》` : "正在创建新页面",
    };
  }

  if (part.type === "tool-updatePage") {
    const ok = output?.ok === true;
    const needsMarkdown = output?.needsMarkdown === true;
    return {
      label: "写入页面",
      detail: needsMarkdown
        ? "等待完整正文后再写入"
        : ok
          ? title
            ? `已写入《${truncate(title)}》`
            : "已写入当前页"
          : title
            ? `正在写入《${truncate(title)}》`
            : "正在写入当前页",
    };
  }

  if (part.type === "tool-replaceInPage") {
    const replacedCount =
      typeof output?.replacedCount === "number"
        ? output.replacedCount
        : undefined;
    return {
      label: "替换内容",
      detail:
        replacedCount === undefined
          ? title
            ? `正在替换《${truncate(title)}》`
            : "正在替换页面内容"
          : replacedCount > 0
            ? title
              ? `《${truncate(title)}》已替换 ${replacedCount} 处`
              : `已替换 ${replacedCount} 处`
            : title
              ? `《${truncate(title)}》没有找到可替换内容`
              : "没有找到可替换内容",
    };
  }

  if (part.type === "tool-appendToPage") {
    const ok = output?.ok === true;
    return {
      label: "追加内容",
      detail: outputError
        ? formatNotebookAiError(outputError)
        : ok
          ? title
            ? `已追加到《${truncate(title)}》`
            : "已追加到当前页"
          : title
            ? `正在追加到《${truncate(title)}》`
            : "正在追加页面内容",
    };
  }

  if (part.type === "tool-renamePage") {
    const ok = output?.ok === true;
    return {
      label: "重命名页面",
      detail: outputError
        ? formatNotebookAiError(outputError)
        : ok
          ? title
            ? `已重命名为《${truncate(title)}》`
            : "已完成重命名"
          : title
            ? `正在重命名为《${truncate(title)}》`
            : "正在重命名页面",
    };
  }

  if (part.type === "tool-deletePages") {
    const deletedCount =
      typeof output?.deletedCount === "number"
        ? output.deletedCount
        : undefined;
    return {
      label: "删除页面",
      detail: outputError
        ? formatNotebookAiError(outputError)
        : deletedCount === undefined
          ? "正在把页面移入垃圾箱"
          : `已删除 ${deletedCount} 个页面`,
    };
  }

  if (part.type === "tool-executeBatchPlan") {
    const operationCount = Array.isArray(input?.operations)
      ? input.operations.length
      : Array.isArray(readObject(input?.plan)?.changes)
        ? (readObject(input?.plan)?.changes as unknown[]).length
        : 0;
    const executionFailed =
      part.state === "output-error" ||
      Boolean(part.errorText) ||
      (part.state === "output-available" && output?.ok === false);
    if (executionFailed) {
      return {
        label: "生成批量计划",
        detail: formatNotebookAiError(part.errorText || output?.error, {
          phase: part.approval?.approved === true ? "execute" : "prepare",
        }),
      };
    }
    if (
      part.state === "approval-requested" ||
      part.state === "approval-responded" ||
      (part.state === "output-available" &&
        output?.status === "prepared" &&
        output?.needsApproval === true)
    ) {
      return {
        label: "生成批量计划",
        detail: operationCount
          ? `已生成 ${operationCount} 项操作，等待审批`
          : "计划已生成，等待审批",
      };
    }
    return {
      label: "生成批量计划",
      detail: title
        ? `正在生成《${truncate(title)}》`
        : "正在整理批量操作与审批内容",
    };
  }

  if (part.type === "tool-showTable") {
    return {
      label: "展示表格",
      detail: title ? `已生成表格《${truncate(title)}》` : "已生成表格",
    };
  }

  if (part.type === "tool-showChart") {
    return {
      label: "展示图表",
      detail: title ? `已生成图表《${truncate(title)}》` : "已生成图表",
    };
  }

  if (part.type === "tool-showDiagram") {
    return {
      label: "展示图形",
      detail: title ? `已生成图形《${truncate(title)}》` : "已生成图形",
    };
  }

  if (part.type === "tool-showSvg") {
    return {
      label: "展示 SVG",
      detail: title ? `已生成 SVG《${truncate(title)}》` : "已生成 SVG",
    };
  }

  return {
    label: "处理内容",
    detail: part.output !== undefined ? "已完成本步骤" : "正在处理请求",
  };
}

export function buildToolProgressSteps(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
): ProgressStep[] {
  return parts.map((part) => ({
    ...getToolProgressStepText(part),
    status: getToolProgressStepStatus(part, isMessageStreaming),
  }));
}

function buildSummary(steps: ProgressStep[]) {
  const errorStep = steps.find((step) => step.status === "error");
  if (errorStep) return errorStep.detail;

  return steps
    .filter((step) => step.status === "done" || step.status === "running")
    .slice(-3)
    .map((step) => step.detail)
    .join("、");
}

export function getToolProgressSummary(
  parts: ToolProgressPart[],
  isMessageStreaming?: boolean,
) {
  return buildSummary(buildToolProgressSteps(parts, isMessageStreaming));
}
