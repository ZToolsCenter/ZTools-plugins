import type {
  BatchPlanInput,
  BatchPlanOperationInput,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * 兼容模型常见的批量计划省略：operationId 可由应用按顺序生成；删除单页时
 * pageId 可代替 pageIds。最终仍统一成执行器需要的严格、确定性结构。
 */
export function normalizeBatchPlanOperations(
  value: unknown,
): BatchPlanOperationInput[] {
  if (!Array.isArray(value)) return [];
  const usedOperationIds = new Set<string>();

  return value.flatMap((operation, index): BatchPlanOperationInput[] => {
    if (!isRecord(operation)) return [];
    const rawType = operation.type ?? operation.action;
    const type =
      rawType === "create_page" || rawType === "createPage"
        ? "create"
        : rawType === "edit_page" || rawType === "editPage"
          ? "edit"
          : rawType === "delete_page" || rawType === "deletePage"
            ? "delete"
            : rawType === "searchReplace" ||
                rawType === "str_replace" ||
                rawType === "strReplace" ||
                rawType === "replace_in_page" ||
                rawType === "replaceInPage"
              ? "search_replace"
              : rawType;
    if (
      type !== "create" &&
      type !== "edit" &&
      type !== "delete" &&
      type !== "search_replace"
    ) {
      return [];
    }

    const requestedOperationId = optionalText(operation.operationId);
    let operationId = requestedOperationId ?? `${type}-${index + 1}`;
    if (!requestedOperationId) {
      let suffix = 2;
      while (usedOperationIds.has(operationId)) {
        operationId = `${type}-${index + 1}-${suffix}`;
        suffix += 1;
      }
    }
    usedOperationIds.add(operationId);

    if (type === "create") {
      const title = requiredText(operation.title);
      const markdown = requiredText(operation.markdown);
      const parentId = optionalText(operation.parentId);
      if (!title || !markdown) return [];
      return [
        {
          type,
          operationId,
          title,
          markdown,
          ...(parentId ? { parentId } : {}),
        },
      ];
    }

    if (type === "edit") {
      const pageId = requiredText(operation.pageId);
      const markdown = requiredText(operation.markdown);
      const title = optionalText(operation.title);
      if (!pageId || !markdown) return [];
      return [
        {
          type,
          operationId,
          pageId,
          markdown,
          ...(title ? { title } : {}),
        },
      ];
    }

    if (type === "search_replace") {
      const pageId = requiredText(operation.pageId);
      const oldString =
        typeof operation.oldString === "string"
          ? operation.oldString
          : typeof operation.old_string === "string"
            ? operation.old_string
            : typeof operation.find === "string"
              ? operation.find
              : typeof operation.search === "string"
                ? operation.search
                : null;
      const newString =
        typeof operation.newString === "string"
          ? operation.newString
          : typeof operation.new_string === "string"
            ? operation.new_string
            : typeof operation.replace === "string"
              ? operation.replace
              : typeof operation.replacement === "string"
                ? operation.replacement
                : null;
      const replaceAllRaw = operation.replaceAll ?? operation.replace_all;
      const replaceAll =
        replaceAllRaw === true || replaceAllRaw === "true"
          ? true
          : replaceAllRaw === false || replaceAllRaw === "false"
            ? false
            : undefined;
      if (!pageId || oldString === null || oldString === "" || newString === null) {
        return [];
      }
      return [
        {
          type,
          operationId,
          pageId,
          oldString,
          newString,
          ...(replaceAll !== undefined ? { replaceAll } : {}),
        },
      ];
    }

    const pageIds = [
      ...(Array.isArray(operation.pageIds) ? operation.pageIds : []),
      operation.pageId,
    ].flatMap((pageId) => {
      const normalized = optionalText(pageId);
      return normalized ? [normalized] : [];
    });
    const uniquePageIds = [...new Set(pageIds)];
    return [{ type, operationId, pageIds: uniquePageIds }];
  });
}

export function normalizeBatchPlanInput(
  value: unknown,
  options?: { fallbackRunId?: string; fallbackTitle?: string },
):
  | (BatchPlanInput & { runId: string })
  | null {
  if (!isRecord(value)) return null;
  const plan = isRecord(value.plan) ? value.plan : value;
  const operations = Array.isArray(plan.operations)
    ? plan.operations
    : plan.changes;
  const runId =
    requiredText(plan.runId) ??
    requiredText(value.runId) ??
    optionalText(options?.fallbackRunId);
  const title =
    requiredText(plan.title) ??
    requiredText(value.title) ??
    optionalText(options?.fallbackTitle);
  const summary =
    requiredText(plan.summary) ??
    requiredText(value.summary) ??
    title;
  if (!runId || !title || !summary || !Array.isArray(operations)) {
    return null;
  }

  return {
    runId,
    title,
    summary,
    operations: normalizeBatchPlanOperations(operations),
  };
}
