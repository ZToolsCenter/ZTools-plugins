import { tool } from "ai";
import { z } from "zod";
import type { NotebookAiAgentContext } from "../types";
import { executePreparedBatchPlan, prepareBatchPlan } from "./executor";
import { normalizeBatchPlanInput } from "./input";

const optionalOperationId = z
  .string()
  .min(1)
  .optional()
  .describe("可选的操作唯一标识；省略时由应用自动生成");

const canonicalOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    operationId: optionalOperationId,
    title: z.string().min(1),
    markdown: z.string().min(1),
    parentId: z.string().min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal("edit"),
    operationId: optionalOperationId,
    pageId: z.string().min(1),
    markdown: z.string().min(1),
    title: z.string().min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal("delete"),
    operationId: optionalOperationId,
    pageIds: z.array(z.string().min(1)).min(1),
  }).strict(),
  z.object({
    type: z.literal("search_replace"),
    operationId: optionalOperationId,
    pageId: z.string().min(1),
    oldString: z.string().min(1),
    /** 可为空字符串，表示删除匹配片段。 */
    newString: z.string(),
    replaceAll: z.boolean().optional(),
  }).strict(),
]);

/** 模型可见的唯一工具契约；旧格式只在 repair hook 内部兼容。 */
export const executeBatchPlanInputSchema = z
  .object({
    runId: z.string().min(1).optional(),
    title: z.string().min(1),
    summary: z.string().min(1),
    operations: z.array(canonicalOperationSchema).min(1).max(50),
  })
  .strict();

type CanonicalOperation = z.infer<typeof canonicalOperationSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalType(value: unknown) {
  switch (value) {
    case "create":
    case "create_page":
    case "createPage":
      return "create" as const;
    case "edit":
    case "edit_page":
    case "editPage":
      return "edit" as const;
    case "delete":
    case "delete_page":
    case "deletePage":
      return "delete" as const;
    case "search_replace":
    case "searchReplace":
    case "str_replace":
    case "strReplace":
    case "replace_in_page":
    case "replaceInPage":
      return "search_replace" as const;
    default:
      return null;
  }
}

function parseChanges(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function repairOperation(value: unknown): CanonicalOperation | null {
  if (!isRecord(value)) return null;
  const fromType = value.type === undefined ? null : canonicalType(value.type);
  const fromAction = value.action === undefined ? null : canonicalType(value.action);
  if (
    (value.type !== undefined && !fromType) ||
    (value.action !== undefined && !fromAction) ||
    (!fromType && !fromAction) ||
    (fromType && fromAction && fromType !== fromAction)
  ) {
    return null;
  }
  const type = fromType ?? fromAction;
  if (!type) return null;

  const operationId = typeof value.operationId === "string" ? value.operationId : undefined;
  if (type === "create") {
    return {
      type,
      ...(operationId ? { operationId } : {}),
      title: value.title as string,
      markdown: value.markdown as string,
      ...(typeof value.parentId === "string" ? { parentId: value.parentId } : {}),
    };
  }
  if (type === "edit") {
    return {
      type,
      ...(operationId ? { operationId } : {}),
      pageId: value.pageId as string,
      markdown: value.markdown as string,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
    };
  }
  if (type === "search_replace") {
    const oldString =
      typeof value.oldString === "string"
        ? value.oldString
        : typeof value.old_string === "string"
          ? value.old_string
          : typeof value.find === "string"
            ? value.find
            : typeof value.search === "string"
              ? value.search
              : undefined;
    const newString =
      typeof value.newString === "string"
        ? value.newString
        : typeof value.new_string === "string"
          ? value.new_string
          : typeof value.replace === "string"
            ? value.replace
            : typeof value.replacement === "string"
              ? value.replacement
              : undefined;
    const replaceAllRaw = value.replaceAll ?? value.replace_all;
    const replaceAll =
      typeof replaceAllRaw === "boolean" ? replaceAllRaw : undefined;
    if (oldString === undefined || newString === undefined) return null;
    return {
      type,
      ...(operationId ? { operationId } : {}),
      pageId: value.pageId as string,
      oldString,
      newString,
      ...(replaceAll !== undefined ? { replaceAll } : {}),
    };
  }

  const pageIds = Array.isArray(value.pageIds)
    ? value.pageIds
    : typeof value.pageId === "string"
      ? [value.pageId]
      : value.pageIds;
  return {
    type,
    ...(operationId ? { operationId } : {}),
    pageIds: pageIds as string[],
  };
}

/**
 * 只修复可证明等价的旧批量计划。不会从 Markdown/XML/空内容推断写入操作。
 */
export function repairExecuteBatchPlanInput(input: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const plan = isRecord(value.plan) ? value.plan : null;
  const source = value.changes !== undefined ? value : plan;
  if (!source || source.changes === undefined) return null;
  const changes = parseChanges(source.changes);
  if (!changes || changes.length === 0) return null;

  const operations = changes.map(repairOperation);
  if (operations.some((operation) => !operation)) return null;
  const candidate = {
    ...(typeof (source.runId ?? value.runId) === "string"
      ? { runId: source.runId ?? value.runId }
      : {}),
    title: source.title ?? value.title,
    summary: source.summary ?? value.summary,
    operations,
  };
  const parsed = executeBatchPlanInputSchema.safeParse(candidate);
  return parsed.success ? JSON.stringify(parsed.data) : null;
}

/**
 * 所有笔记写操作都必须通过此入口。输入是模型已经完整生成的冻结结果。
 * 工具 execute 先冻结计划：全部为 create 时 prepare 成功后立即执行；
 * 含 edit/search_replace/delete 时只返回 prepared 审批卡，真正写入由用户批准后触发。
 *
 * 不使用 AI SDK 的 needsApproval：旧 uTools Chromium 在大工具参数结束后偶发无法
 * 收到 approval-request，导致模型已完成但 UI 永久停在 streaming。应用本来就有
 * 独立的本地审批执行器，因此直接返回 prepared / completed 状态更简单也更可靠。
 */
export async function prepareBatchPlanForApproval(
  input: unknown,
  options: {
    toolCallId: string;
    notebookId: string;
  },
) {
  const fallbackRunId = `batch-${options.toolCallId}`;
  const normalized = normalizeBatchPlanInput(input, {
    fallbackRunId,
    fallbackTitle: "笔记变更计划",
  });
  if (!normalized) {
    return {
      ok: false as const,
      needsApproval: false,
      toolCallId: options.toolCallId,
      runId: fallbackRunId,
      status: "invalid" as const,
      error: "批量计划参数不完整",
      operationCount: 0,
    };
  }

  const { runId, ...planInput } = normalized;
  try {
    const prepared = await prepareBatchPlan({
      toolCallId: options.toolCallId,
      runId,
      notebookId: options.notebookId,
      input: planInput,
    });
    if (!prepared.ok) {
      return {
        ok: false as const,
        needsApproval: false,
        toolCallId: options.toolCallId,
        runId,
        status: "invalid" as const,
        error: prepared.error,
        operationCount: normalized.operations.length,
      };
    }

    const isCreateOnly = normalized.operations.every(
      (operation) => operation.type === "create",
    );
    if (isCreateOnly) {
      try {
        const result = await executePreparedBatchPlan(
          options.toolCallId,
          runId,
        );
        const appliedCount = result.results.filter((item) => item.ok).length;
        return {
          ok: result.ok,
          needsApproval: false as const,
          toolCallId: options.toolCallId,
          runId,
          status: result.journal.status,
          appliedCount,
          selectedCount: result.journal.selectedOperationIds.length,
          canUndo: result.ok && result.journal.status === "completed",
          ...(result.ok ? {} : { error: result.error }),
          results: result.results,
          operationCount: normalized.operations.length,
        };
      } catch (error) {
        return {
          ok: false as const,
          needsApproval: false as const,
          toolCallId: options.toolCallId,
          runId,
          status: "invalid" as const,
          error: error instanceof Error ? error.message : "批量计划执行失败",
          operationCount: normalized.operations.length,
        };
      }
    }

    return {
      ok: true as const,
      needsApproval: true,
      toolCallId: options.toolCallId,
      runId,
      status: "prepared" as const,
      operationCount: normalized.operations.length,
    };
  } catch (error) {
    return {
      ok: false as const,
      needsApproval: false,
      toolCallId: options.toolCallId,
      runId,
      status: "invalid" as const,
      error: error instanceof Error ? error.message : "批量计划准备失败",
      operationCount: normalized.operations.length,
    };
  }
}

export const executeBatchPlan = tool({
  description:
    '准备并处理笔记变更计划。全部为 create 时 prepare 成功后自动写入；含 edit/search_replace/delete 时只生成审批卡，不立即写入。局部修改必须用 search_replace（oldString 须为 readPage 返回的精确片段，newString 可为空表示删除该片段，replaceAll 可选）；若误用 edit 且仅为局部差异，服务端会自动拆成 search_replace。整页重写才用 edit。参数格式：{title:"整理笔记",summary:"更新账号页",operations:[{type:"search_replace",pageId:"page-1",oldString:"旧片段",newString:"新片段"}]}。返回后停止；仅 create 时无需等待审批。',
  inputSchema: executeBatchPlanInputSchema,
  execute: async (input, { experimental_context, toolCallId }) => {
    const context = experimental_context as NotebookAiAgentContext;
    return prepareBatchPlanForApproval(input, {
      toolCallId,
      notebookId: context.notebookId,
    });
  },
});
