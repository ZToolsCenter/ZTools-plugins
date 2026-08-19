import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useTabs } from "@/stores/useTabs";
import { v4 as uuidv4 } from "uuid";
import {
  buildAiPageContent,
  normalizeAiMarkdown,
} from "@/lib/notebook-ai/markdown";
import { importMarkdownFragment } from "@/lib/export/markdown/parse";
import { normalizePageContent } from "@/components/editor/utils/blocknote-content";
import {
  getPageTitle,
  withInternalPageTitle,
} from "@/components/editor/utils/page-title";
import {
  getPageContentSignature,
  guardNotebookForAiWrite,
  guardPageForAiWrite,
  writePageContentSafely,
} from "@/lib/notebook-ai/pageWriteGuard";
import { formatBatchPlanErrors } from "@/lib/notebook-ai/errors";
import { recordHistorySnapshot } from "@/lib/history/snapshot";
import { reloadEditorIfActive } from "@/lib/notebook-ai/liveWriter";
import type { JSONContent } from "@/types";
import { readBatchPlanJournal, writeBatchPlanJournal } from "./journal";
import {
  applySearchReplacePreservingBlocks,
  mergeFullEditPreservingUnchangedBlocks,
} from "./surgicalApply";
import { tryConvertEditToSearchReplace } from "./editToSearchReplace";
import { jsonContentToMarkdown } from "@/lib/export/markdown/serialize";
import type {
  BatchOperationResult,
  BatchPlanExecuteResult,
  BatchPlanInput,
  BatchPlanJournal,
  BatchPlanOperationInput,
  BatchPlanPrepareResult,
  FrozenPageSnapshot,
  PageRevision,
} from "./types";

const inFlight = new Map<string, Promise<BatchPlanExecuteResult>>();

function normalizePath(filePath: string): string {
  const slashPath = filePath.replace(/\\/g, "/");
  const prefix =
    slashPath.match(/^[A-Za-z]:/)?.[0] ??
    (slashPath.startsWith("/") ? "/" : "");
  const rest =
    prefix === "/" ? slashPath.slice(1) : slashPath.slice(prefix.length);
  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  const joined = segments.join("/");
  return prefix === "/"
    ? `/${joined}`
    : `${prefix}${joined ? `/${joined}` : ""}`;
}

function comparisonPath(filePath: string): string {
  const normalized = normalizePath(filePath).replace(/\/$/, "");
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const file = comparisonPath(filePath);
  const root = comparisonPath(rootPath);
  return file.startsWith(`${root}/`);
}

async function assertLocalPathInsideRoot(
  filePath: string,
  rootPath: string,
  options: { targetMayNotExist?: boolean } = {},
): Promise<void> {
  if (!isPathInsideRoot(filePath, rootPath)) {
    throw new Error("本地文件位于笔记本根目录之外");
  }
  const fs = typeof window !== "undefined" ? window.gooseFs : undefined;
  if (!fs?.realpathAsync) return;
  const canonicalRoot = await fs.realpathAsync(rootPath);
  const canonicalTarget = await fs.realpathAsync(
    options.targetMayNotExist ? dirname(filePath) : filePath,
  );
  const targetForComparison = options.targetMayNotExist
    ? `${canonicalTarget ?? ""}/placeholder.md`
    : (canonicalTarget ?? "");
  if (
    !canonicalRoot ||
    !canonicalTarget ||
    !isPathInsideRoot(targetForComparison, canonicalRoot)
  ) {
    throw new Error("本地文件的真实路径位于笔记本根目录之外");
  }
}

function dirname(filePath: string): string {
  const normalized = normalizePath(filePath);
  const index = normalized.lastIndexOf("/");
  return index <= 0
    ? normalized.slice(0, Math.max(index, 1))
    : normalized.slice(0, index);
}

function basenameWithoutMarkdownExtension(filePath: string): string {
  return (
    normalizePath(filePath)
      .split("/")
      .pop()
      ?.replace(/\.(md|markdown)$/i, "") ?? ""
  );
}

function markdownExtension(filePath: string): string {
  return normalizePath(filePath).match(/\.(md|markdown)$/i)?.[0] ?? ".md";
}

function sanitizeLocalTitle(title: string): string {
  return (title.trim() || "无标题").replace(/[\\/:*?"<>|]/g, "_");
}

async function pathExists(filePath: string): Promise<boolean> {
  const fs = typeof window !== "undefined" ? window.gooseFs : undefined;
  if (!fs) return false;
  try {
    return fs.existsAsync
      ? await fs.existsAsync(filePath)
      : fs.exists(filePath);
  } catch {
    return false;
  }
}

function pageAtLocalPath(filePath: string) {
  const key = comparisonPath(filePath);
  return Object.values(usePages.getState().pages).find(
    (page) => page.localFilePath && comparisonPath(page.localFilePath) === key,
  );
}

async function allocatePlannedLocalPath(params: {
  directory: string;
  title: string;
  extension?: string;
  currentPath?: string;
  reserved: Set<string>;
}): Promise<string> {
  const base = sanitizeLocalTitle(params.title);
  const extension = params.extension ?? ".md";
  for (let suffix = 0; suffix <= 99; suffix += 1) {
    const name = suffix === 0 ? base : `${base} (${suffix})`;
    const candidate = normalizePath(`${params.directory}/${name}${extension}`);
    const key = comparisonPath(candidate);
    const isCurrent = params.currentPath
      ? comparisonPath(params.currentPath) === key
      : false;
    const occupiedByPage = Object.values(usePages.getState().pages).some(
      (page) =>
        page.localFilePath &&
        comparisonPath(page.localFilePath) === key &&
        (!params.currentPath ||
          comparisonPath(page.localFilePath) !==
            comparisonPath(params.currentPath)),
    );
    if (
      !params.reserved.has(key) &&
      !occupiedByPage &&
      (isCurrent || !(await pathExists(candidate)))
    ) {
      params.reserved.add(key);
      return candidate;
    }
  }
  throw new Error("无法生成可用的本地文件名");
}

async function makeLocalPlanPaths(
  notebookId: string,
  input: BatchPlanInput,
): Promise<{
  plannedLocalPaths: Record<string, string>;
  localTrashPathsByPageId: Record<string, string>;
  deleteBatchIdsByOperationId: Record<string, string>;
}> {
  const notebook = useNotebooks.getState().notebooks[notebookId];
  if (notebook?.source !== "local-folder") {
    return {
      plannedLocalPaths: {},
      localTrashPathsByPageId: {},
      deleteBatchIdsByOperationId: {},
    };
  }
  if (!notebook.localPath) {
    throw new Error("本地文件系统不可用");
  }
  const requiresFileOperation = input.operations.some(
    (operation) =>
      operation.type === "create" ||
      operation.type === "delete" ||
      (operation.type === "edit" && Boolean(operation.title?.trim())),
  );
  if (
    requiresFileOperation &&
    (typeof window === "undefined" || !window.gooseFs)
  ) {
    throw new Error("本地文件系统不可用");
  }

  const root = normalizePath(notebook.localPath);
  const reserved = new Set<string>();
  const plannedLocalPaths: Record<string, string> = {};
  const localTrashPathsByPageId: Record<string, string> = {};
  const deleteBatchIdsByOperationId: Record<string, string> = {};

  for (const operation of input.operations) {
    if (operation.type === "create") {
      const parent = operation.parentId
        ? usePages.getState().pages[operation.parentId]
        : undefined;
      const directory = parent?.localFilePath
        ? parent.isFolder
          ? parent.localFilePath
          : dirname(parent.localFilePath)
        : root;
      await assertLocalPathInsideRoot(
        `${normalizePath(directory)}/placeholder.md`,
        root,
        { targetMayNotExist: true },
      );
      plannedLocalPaths[operation.operationId] = await allocatePlannedLocalPath(
        {
          directory,
          title: operation.title,
          reserved,
        },
      );
      continue;
    }

    if (operation.type === "edit") {
      const page = usePages.getState().pages[operation.pageId];
      if (!page?.localFilePath) continue;
      await assertLocalPathInsideRoot(page.localFilePath, root);
      if (operation.title?.trim()) {
        plannedLocalPaths[operation.operationId] =
          await allocatePlannedLocalPath({
            directory: dirname(page.localFilePath),
            title: operation.title,
            extension: markdownExtension(page.localFilePath),
            currentPath: page.localFilePath,
            reserved,
          });
      }
      continue;
    }

    if (operation.type === "search_replace") {
      const page = usePages.getState().pages[operation.pageId];
      if (page?.localFilePath) {
        await assertLocalPathInsideRoot(page.localFilePath, root);
      }
      continue;
    }

    if (operation.type !== "delete") continue;

    const deleteBatchId = `ai-batch-${operation.operationId}-${uuidv4()}`;
    deleteBatchIdsByOperationId[operation.operationId] = deleteBatchId;
    for (const pageId of expandDeletePageIds(notebookId, operation.pageIds)) {
      const page = usePages.getState().pages[pageId];
      if (!page?.localFilePath) continue;
      await assertLocalPathInsideRoot(page.localFilePath, root);
      const relativePath = normalizePath(page.localFilePath)
        .slice(root.length)
        .replace(/^\//, "");
      localTrashPathsByPageId[pageId] = normalizePath(
        `${root}/.goose/ai-batch-trash/${deleteBatchId}/${relativePath}`,
      );
    }
  }

  return {
    plannedLocalPaths,
    localTrashPathsByPageId,
    deleteBatchIdsByOperationId,
  };
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function revisionOf(page: {
  updatedAt: number;
  content: unknown;
}): PageRevision {
  return {
    updatedAt: page.updatedAt,
    contentSignature: getPageContentSignature(page.content),
  };
}

function sameRevision(current: PageRevision, expected: PageRevision) {
  return (
    current.updatedAt === expected.updatedAt &&
    current.contentSignature === expected.contentSignature
  );
}

function validateInput(input: BatchPlanInput): string | null {
  if (!input.title.trim() || !input.summary.trim())
    return "计划标题和摘要不能为空";
  if (input.operations.length < 1 || input.operations.length > 50)
    return "计划操作数必须在 1 到 50 之间";
  const ids = new Set<string>();
  /** pageId → 首次占用该页的操作类型；允许多个 search_replace 串联同一页。 */
  const pageMode = new Map<string, "edit" | "search_replace" | "delete">();
  for (const operation of input.operations) {
    if (!operation.operationId.trim() || ids.has(operation.operationId))
      return "operationId 必须唯一且不能为空";
    ids.add(operation.operationId);
    if (
      operation.type === "create" &&
      (!operation.title.trim() || !operation.markdown.trim())
    )
      return "创建操作缺少标题或完整正文";
    if (operation.type === "edit") {
      if (!operation.pageId || !operation.markdown.trim())
        return "编辑操作缺少页面或完整正文";
      const existing = pageMode.get(operation.pageId);
      if (existing)
        return "同一页面不能在一个计划中同时使用 edit 与其他写入/删除";
      pageMode.set(operation.pageId, "edit");
    }
    if (operation.type === "search_replace") {
      if (!operation.pageId || !operation.oldString)
        return "局部替换操作缺少页面或 oldString";
      const existing = pageMode.get(operation.pageId);
      if (existing && existing !== "search_replace")
        return "同一页面不能在一个计划中混合 search_replace 与 edit/delete";
      pageMode.set(operation.pageId, "search_replace");
    }
    if (operation.type === "delete") {
      if (!operation.pageIds.length) return "删除操作至少需要一个页面";
      for (const pageId of operation.pageIds) {
        if (!pageId) return "删除操作至少需要一个页面";
        const existing = pageMode.get(pageId);
        if (existing)
          return "同一页面不能在一个计划中重复编辑或删除";
        pageMode.set(pageId, "delete");
      }
    }
  }
  return null;
}

function invalidJournal(
  toolCallId: string,
  runId: string,
  notebookId: string,
  input: BatchPlanInput,
  error: string,
): BatchPlanJournal {
  const now = Date.now();
  return {
    version: 1,
    toolCallId,
    runId,
    notebookId,
    input: clone(input),
    selectedOperationIds: [],
    status: "invalid",
    before: {},
    affectedPageIdsByOperationId: {},
    deleteBatchIdsByOperationId: {},
    plannedPageIds: {},
    plannedLocalPaths: {},
    localPathAfterByPageId: {},
    localTrashPathsByPageId: {},
    after: {},
    createdPageIds: {},
    results: [],
    error,
    createdAt: now,
    updatedAt: now,
  };
}

function expandDeletePageIds(notebookId: string, rootIds: string[]): string[] {
  const pages = usePages.getState().pages;
  const expanded = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const pageId = stack.pop()!;
    if (expanded.has(pageId)) continue;
    const page = pages[pageId];
    if (!page || page.workspaceId !== notebookId || page.trashedAt) continue;
    expanded.add(pageId);
    Object.values(pages).forEach((candidate) => {
      if (
        candidate.workspaceId === notebookId &&
        !candidate.trashedAt &&
        candidate.parentId === pageId
      )
        stack.push(candidate.id);
    });
  }
  return [...expanded];
}

/**
 * 误用整页 edit 做局部修改时，在 prepare 阶段拆成 search_replace，
 * 以保留未改动块的 id/props。带 title 的 edit 不转换（标题+正文保持原子）。
 */
function convertPartialEditsInPlan(
  input: BatchPlanInput,
  notebookId: string,
): BatchPlanInput {
  const pages = usePages.getState().pages;
  const nextOps: BatchPlanOperationInput[] = [];
  let changed = false;

  for (let index = 0; index < input.operations.length; index += 1) {
    const operation = input.operations[index]!;
    if (operation.type !== "edit") {
      nextOps.push(operation);
      continue;
    }
    // 改标题时保持 edit，避免 title 与 body 拆开
    if (operation.title?.trim()) {
      nextOps.push(operation);
      continue;
    }

    const page = pages[operation.pageId];
    if (
      !page ||
      page.workspaceId !== notebookId ||
      Boolean(page.trashedAt)
    ) {
      nextOps.push(operation);
      continue;
    }

    const oldMarkdown = jsonContentToMarkdown(page.content as any);
    const converted = tryConvertEditToSearchReplace({
      pageId: operation.pageId,
      oldMarkdown,
      newMarkdown: operation.markdown,
      baseOperationId: operation.operationId,
    });

    if (!converted || converted.length === 0) {
      nextOps.push(operation);
      continue;
    }

    // 保守上限：后续原操作按 1:1 计；任一步超 50 则保留该条 edit
    const remainingAfter = input.operations.length - index - 1;
    const totalIfConvert = nextOps.length + converted.length + remainingAfter;
    if (totalIfConvert > 50) {
      nextOps.push(operation);
      continue;
    }

    nextOps.push(...converted);
    changed = true;
  }

  if (!changed) return input;
  // 若多次扩展后仍超上限，整体回退
  if (nextOps.length > 50) return input;
  const candidate: BatchPlanInput = {
    ...input,
    operations: nextOps,
  };
  // 转换后必须仍能通过 pageMode / 唯一 id 校验，否则回退原计划
  if (validateInput(candidate)) return input;
  return candidate;
}

export async function prepareBatchPlan(params: {
  toolCallId: string;
  runId: string;
  notebookId: string;
  input: BatchPlanInput;
}): Promise<BatchPlanPrepareResult> {
  const existing = readBatchPlanJournal(params.toolCallId, params.runId);
  if (existing)
    return existing.status === "invalid"
      ? { ok: false, error: existing.error || "计划无效", journal: existing }
      : { ok: true, journal: existing };
  const inputError = validateInput(params.input);
  const notebookGuard = guardNotebookForAiWrite(params.notebookId);
  if (inputError || !notebookGuard.ok) {
    const error =
      inputError ??
      (!notebookGuard.ok ? notebookGuard.error : "目标笔记本不可写入");
    const journal = writeBatchPlanJournal(
      invalidJournal(
        params.toolCallId,
        params.runId,
        params.notebookId,
        params.input,
        error,
      ),
    );
    return { ok: false, error: journal.error!, journal };
  }

  // 局部 edit → search_replace；后续冻结/路径规划均使用转换后的计划
  const planInput = convertPartialEditsInPlan(
    params.input,
    params.notebookId,
  );

  const before: Record<string, FrozenPageSnapshot> = {};
  const affectedPageIdsByOperationId: Record<string, string[]> = {};
  let localPlanPaths: Awaited<ReturnType<typeof makeLocalPlanPaths>>;
  try {
    localPlanPaths = await makeLocalPlanPaths(params.notebookId, planInput);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "本地文件计划准备失败";
    const journal = writeBatchPlanJournal(
      invalidJournal(
        params.toolCallId,
        params.runId,
        params.notebookId,
        planInput,
        message,
      ),
    );
    return { ok: false, error: message, journal };
  }
  const deleteBatchIdsByOperationId: Record<string, string> = {
    ...localPlanPaths.deleteBatchIdsByOperationId,
  };
  const plannedPageIds: Record<string, string> = {};
  const operationOwnerByPageId = new Map<string, string>();
  for (const operation of planInput.operations) {
    if (
      operation.type === "create" &&
      useNotebooks.getState().notebooks[params.notebookId]?.source !==
        "local-folder"
    )
      plannedPageIds[operation.operationId] = uuidv4();
    if (operation.type === "create" && operation.parentId) {
      const parent = usePages.getState().pages[operation.parentId];
      if (
        !parent ||
        parent.workspaceId !== params.notebookId ||
        Boolean(parent.trashedAt)
      ) {
        const message = "新页面的父级不存在、已在垃圾箱中或不属于当前笔记本";
        const journal = writeBatchPlanJournal(
          invalidJournal(
            params.toolCallId,
            params.runId,
            params.notebookId,
            planInput,
            message,
          ),
        );
        return { ok: false, error: message, journal };
      }
    }
    if (operation.type === "delete") {
      const requestedIds = new Set(operation.pageIds);
      for (const pageId of operation.pageIds) {
        const page = usePages.getState().pages[pageId];
        if (
          !page ||
          page.workspaceId !== params.notebookId ||
          Boolean(page.trashedAt)
        ) {
          const message = "删除目标不存在、已在垃圾箱中或不属于当前笔记本";
          const journal = writeBatchPlanJournal(
            invalidJournal(
              params.toolCallId,
              params.runId,
              params.notebookId,
              planInput,
              message,
            ),
          );
          return { ok: false, error: message, journal };
        }
        let parentId = page.parentId;
        while (parentId) {
          if (requestedIds.has(parentId)) {
            const message = "删除目标包含重复的父子页面，请只保留父页面";
            const journal = writeBatchPlanJournal(
              invalidJournal(
                params.toolCallId,
                params.runId,
                params.notebookId,
                planInput,
                message,
              ),
            );
            return { ok: false, error: message, journal };
          }
          parentId = usePages.getState().pages[parentId]?.parentId;
        }
      }
    }
    const pageIds =
      operation.type === "edit" || operation.type === "search_replace"
        ? [operation.pageId]
        : operation.type === "delete"
          ? expandDeletePageIds(params.notebookId, operation.pageIds)
          : [];
    if (operation.type === "delete")
      affectedPageIdsByOperationId[operation.operationId] = pageIds;
    if (
      operation.type === "delete" &&
      !deleteBatchIdsByOperationId[operation.operationId]
    )
      deleteBatchIdsByOperationId[operation.operationId] =
        `ai-batch-${params.runId}-${uuidv4()}`;
    for (const pageId of pageIds) {
      const owner = operationOwnerByPageId.get(pageId);
      // 允许多个 search_replace 串联同一页；edit/delete 仍互斥。
      const allowSharedSearchReplace =
        operation.type === "search_replace" &&
        owner?.startsWith("search_replace:");
      if (owner && owner !== operation.operationId && !allowSharedSearchReplace) {
        const message = "编辑或删除操作的目标页面树发生重叠";
        const journal = writeBatchPlanJournal(
          invalidJournal(
            params.toolCallId,
            params.runId,
            params.notebookId,
            planInput,
            message,
          ),
        );
        return { ok: false, error: message, journal };
      }
      operationOwnerByPageId.set(
        pageId,
        operation.type === "search_replace"
          ? `search_replace:${operation.operationId}`
          : operation.operationId,
      );
      const guard = guardPageForAiWrite(pageId, {
        expectedNotebookId: params.notebookId,
      });
      if (!guard.ok) {
        const journal = writeBatchPlanJournal(
          invalidJournal(
            params.toolCallId,
            params.runId,
            params.notebookId,
            planInput,
            guard.error,
          ),
        );
        return { ok: false, error: guard.error, journal };
      }
      before[pageId] = {
        pageId,
        page: clone(guard.page),
        revision: {
          updatedAt: guard.updatedAt,
          contentSignature: guard.contentSignature,
        },
      };
    }
  }
  const now = Date.now();
  const journal: BatchPlanJournal = {
    version: 1,
    toolCallId: params.toolCallId,
    runId: params.runId,
    notebookId: params.notebookId,
    input: clone(planInput),
    selectedOperationIds: planInput.operations.map(
      (operation) => operation.operationId,
    ),
    status: "prepared",
    before,
    affectedPageIdsByOperationId,
    deleteBatchIdsByOperationId,
    plannedPageIds,
    plannedLocalPaths: localPlanPaths.plannedLocalPaths,
    localPathAfterByPageId: {},
    localTrashPathsByPageId: localPlanPaths.localTrashPathsByPageId,
    after: {},
    createdPageIds: {},
    results: [],
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, journal: writeBatchPlanJournal(journal) };
}

function selectedOperations(journal: BatchPlanJournal) {
  const selected = new Set(journal.selectedOperationIds);
  return journal.input.operations.filter((operation) =>
    selected.has(operation.operationId),
  );
}

function successfulOperationIds(journal: BatchPlanJournal) {
  return new Set(
    journal.results
      .filter((result) => result.ok)
      .map((result) => result.operationId),
  );
}

function pendingOperations(journal: BatchPlanJournal) {
  const completed = successfulOperationIds(journal);
  return selectedOperations(journal).filter(
    (operation) => !completed.has(operation.operationId),
  );
}

async function preflight(journal: BatchPlanJournal): Promise<string | null> {
  const notebook = guardNotebookForAiWrite(journal.notebookId);
  if (!notebook.ok) return notebook.error;
  const pageIds = new Set<string>();
  for (const operation of pendingOperations(journal)) {
    const plannedLocalPath = journal.plannedLocalPaths[operation.operationId];
    if (operation.type === "create" && plannedLocalPath) {
      if (
        pageAtLocalPath(plannedLocalPath) ||
        (await pathExists(plannedLocalPath))
      ) {
        return "本地新建目标在审批后已被占用";
      }
    }
    if (operation.type === "create" && operation.parentId) {
      const parent = usePages.getState().pages[operation.parentId];
      if (
        !parent ||
        parent.workspaceId !== journal.notebookId ||
        Boolean(parent.trashedAt)
      ) {
        return "新页面的父级在审批后发生变化";
      }
    }
    if (operation.type === "edit" || operation.type === "search_replace") {
      pageIds.add(operation.pageId);
    }
    if (operation.type === "delete") {
      const frozenPageIds =
        journal.affectedPageIdsByOperationId[operation.operationId] ??
        operation.pageIds;
      const currentPageIds = expandDeletePageIds(
        journal.notebookId,
        operation.pageIds,
      );
      if (
        frozenPageIds.length !== currentPageIds.length ||
        frozenPageIds.some((pageId) => !currentPageIds.includes(pageId))
      ) {
        return "删除目标的页面树在审批后发生变化";
      }
      frozenPageIds.forEach((pageId) => pageIds.add(pageId));
    }
  }
  for (const pageId of pageIds) {
    const snapshot = journal.before[pageId];
    if (!snapshot) return "冻结计划缺少目标页面快照";
    const guard = guardPageForAiWrite(pageId, {
      expectedNotebookId: journal.notebookId,
      expectedRevision: snapshot.revision,
    });
    if (!guard.ok) return guard.error;
    const beforePath = snapshot.page.localFilePath;
    if (
      beforePath &&
      comparisonPath(guard.page.localFilePath ?? "") !==
        comparisonPath(beforePath)
    ) {
      return "本地文件路径在审批后发生变化";
    }
    const operation = pendingOperations(journal).find(
      (candidate) => candidate.type === "edit" && candidate.pageId === pageId,
    );
    const targetPath = operation
      ? journal.plannedLocalPaths[operation.operationId]
      : undefined;
    if (
      targetPath &&
      comparisonPath(targetPath) !== comparisonPath(beforePath ?? "") &&
      (pageAtLocalPath(targetPath) || (await pathExists(targetPath)))
    ) {
      return "本地重命名目标在审批后已被占用";
    }
    const trashPath = journal.localTrashPathsByPageId[pageId];
    if (
      trashPath &&
      (pageAtLocalPath(trashPath) || (await pathExists(trashPath)))
    ) {
      return "本地删除暂存目标在审批后已被占用";
    }
  }
  return null;
}

function resultForOperation(journal: BatchPlanJournal, operationId: string) {
  return journal.results.find(
    (result) => result.operationId === operationId && result.ok,
  );
}

function plannedContent(
  operation: Extract<
    BatchPlanInput["operations"][number],
    { type: "create" | "edit" }
  >,
  journal: BatchPlanJournal,
) {
  if (operation.type === "create") {
    const isLocal =
      useNotebooks.getState().notebooks[journal.notebookId]?.source ===
      "local-folder";
    if (isLocal) {
      const markdown = normalizeAiMarkdown(operation.markdown).trim();
      const content = markdown ? importMarkdownFragment(markdown) : [];
      return normalizePageContent(content, {
        ensureFirstTitle: false,
      }) as JSONContent;
    }
    return buildAiPageContent(operation.title, operation.markdown);
  }

  // full edit：用块级 merge 保留未改动块的 id / props
  const beforePage = journal.before[operation.pageId].page;
  const beforeContent = beforePage.content;
  const isLocal = Boolean(beforePage.localFilePath);
  if (isLocal) {
    return mergeFullEditPreservingUnchangedBlocks(
      beforeContent,
      normalizeAiMarkdown(operation.markdown),
      { ensureFirstTitle: false },
    ).content;
  }

  const title =
    operation.title?.trim() || getPageTitle(beforePage) || "无标题";
  const merged = mergeFullEditPreservingUnchangedBlocks(
    beforeContent,
    normalizeAiMarkdown(operation.markdown),
    { ensureFirstTitle: true },
  );
  const blocks = Array.isArray(merged.content)
    ? merged.content
    : (merged.content as { content?: unknown } | null)?.content;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return buildAiPageContent(title, operation.markdown);
  }
  if (operation.title?.trim()) {
    return withInternalPageTitle(merged.content, title);
  }
  return merged.content;
}

function plannedSearchReplaceContent(
  operation: Extract<
    BatchPlanInput["operations"][number],
    { type: "search_replace" }
  >,
  journal: BatchPlanJournal,
): JSONContent {
  const before = journal.before[operation.pageId];
  const applied = applySearchReplacePreservingBlocks(
    before.page.content,
    operation.oldString,
    operation.newString,
    { replaceAll: operation.replaceAll === true },
  );
  if (!applied.ok) throw new Error(applied.error);
  return applied.content;
}

function appendRecoveredSuccess(
  journal: BatchPlanJournal,
  result: BatchOperationResult,
  after: Record<string, PageRevision>,
  createdPageId?: string,
) {
  return writeBatchPlanJournal({
    ...journal,
    results: resultForOperation(journal, result.operationId)
      ? journal.results
      : [...journal.results, result],
    after: { ...journal.after, ...after },
    createdPageIds: createdPageId
      ? { ...journal.createdPageIds, [result.operationId]: createdPageId }
      : journal.createdPageIds,
    executingOperationId: undefined,
    executingStartedAt: undefined,
  });
}

/** 将崩溃时已写 intent、但还来不及记录 result 的操作安全归类。 */
async function recoverInterruptedOperation(
  journal: BatchPlanJournal,
): Promise<BatchPlanJournal> {
  const operationId = journal.executingOperationId;
  if (!operationId) return journal;
  const operation = journal.input.operations.find(
    (item) => item.operationId === operationId,
  );
  if (!operation) {
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: "执行日志指向不存在的操作",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  if (resultForOperation(journal, operationId)) {
    return writeBatchPlanJournal({
      ...journal,
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  if (operation.type === "create") {
    const plannedLocalPath = journal.plannedLocalPaths[operationId];
    const plannedPageId = journal.plannedPageIds[operationId];
    const page = plannedLocalPath
      ? pageAtLocalPath(plannedLocalPath)
      : plannedPageId
        ? usePages.getState().pages[plannedPageId]
        : undefined;
    if (!page)
      if (plannedLocalPath && (await pathExists(plannedLocalPath))) {
        return writeBatchPlanJournal({
          ...journal,
          status: "failed",
          error: "中断创建的本地文件已存在但尚未安全载入，已停止恢复",
          executingOperationId: undefined,
          executingStartedAt: undefined,
        });
      }
    if (!page)
      return writeBatchPlanJournal({
        ...journal,
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    const expected = getPageContentSignature(
      plannedContent(operation, journal),
    );
    if (
      page.workspaceId !== journal.notebookId ||
      getPageContentSignature(page.content) !== expected
    ) {
      return writeBatchPlanJournal({
        ...journal,
        status: "failed",
        error: "中断创建页与冻结计划不一致，已停止恢复",
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    }
    return appendRecoveredSuccess(
      journal,
      { operationId, type: "create", ok: true, pageIds: [page.id] },
      { [page.id]: revisionOf(page) },
      page.id,
    );
  }
  if (operation.type === "edit") {
    const page = usePages.getState().pages[operation.pageId];
    const before = journal.before[operation.pageId];
    if (!page || !before)
      return writeBatchPlanJournal({
        ...journal,
        status: "failed",
        error: "中断编辑的目标页不存在",
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    const plannedLocalPath = journal.plannedLocalPaths[operationId];
    const currentPath = page.localFilePath;
    if (
      sameRevision(revisionOf(page), before.revision) &&
      (!plannedLocalPath ||
        comparisonPath(currentPath ?? "") ===
          comparisonPath(before.page.localFilePath ?? ""))
    )
      return writeBatchPlanJournal({
        ...journal,
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    const expected = getPageContentSignature(
      plannedContent(operation, journal),
    );
    if (
      getPageContentSignature(page.content) === expected &&
      (!plannedLocalPath ||
        comparisonPath(currentPath ?? "") === comparisonPath(plannedLocalPath))
    ) {
      return appendRecoveredSuccess(
        currentPath
          ? {
              ...journal,
              localPathAfterByPageId: {
                ...journal.localPathAfterByPageId,
                [operation.pageId]: currentPath,
              },
            }
          : journal,
        { operationId, type: "edit", ok: true, pageIds: [operation.pageId] },
        { [operation.pageId]: revisionOf(page) },
      );
    }
    if (
      plannedLocalPath &&
      before.page.localFilePath &&
      sameRevision(revisionOf(page), before.revision) &&
      comparisonPath(currentPath ?? "") === comparisonPath(plannedLocalPath)
    ) {
      try {
        await usePages
          .getState()
          .renameLocalPageFile(
            operation.pageId,
            basenameWithoutMarkdownExtension(before.page.localFilePath),
          );
        return writeBatchPlanJournal({
          ...journal,
          executingOperationId: undefined,
          executingStartedAt: undefined,
        });
      } catch {
        // 继续走失败分支，避免覆盖无法证明状态的本地文件。
      }
    }
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: "中断编辑后的内容与冻结计划不一致，已停止恢复",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  if (operation.type === "search_replace") {
    const page = usePages.getState().pages[operation.pageId];
    const before = journal.before[operation.pageId];
    if (!page || !before)
      return writeBatchPlanJournal({
        ...journal,
        status: "failed",
        error: "中断局部替换的目标页不存在",
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    if (sameRevision(revisionOf(page), before.revision)) {
      return writeBatchPlanJournal({
        ...journal,
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    }
    try {
      const expected = getPageContentSignature(
        plannedSearchReplaceContent(operation, journal),
      );
      if (getPageContentSignature(page.content) === expected) {
        return appendRecoveredSuccess(
          page.localFilePath
            ? {
                ...journal,
                localPathAfterByPageId: {
                  ...journal.localPathAfterByPageId,
                  [operation.pageId]: page.localFilePath,
                },
              }
            : journal,
          {
            operationId,
            type: "search_replace",
            ok: true,
            pageIds: [operation.pageId],
          },
          { [operation.pageId]: revisionOf(page) },
        );
      }
    } catch {
      // fall through to failed
    }
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: "中断局部替换后的内容与冻结计划不一致，已停止恢复",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  if (operation.type !== "delete") {
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: "中断操作类型暂不支持恢复",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  const affected =
    journal.affectedPageIdsByOperationId[operationId] ?? operation.pageIds;
  const localSnapshots = affected.flatMap((pageId) => {
    const snapshot = journal.before[pageId];
    return snapshot?.page.localFilePath ? [snapshot] : [];
  });
  if (localSnapshots.length > 0) {
    const allStaged = (
      await Promise.all(
        localSnapshots.map(async (snapshot) => {
          const originalPath = snapshot.page.localFilePath!;
          const trashPath = journal.localTrashPathsByPageId[snapshot.pageId];
          return (
            Boolean(trashPath) &&
            !(await pathExists(originalPath)) &&
            (await pathExists(trashPath))
          );
        }),
      )
    ).every(Boolean);
    if (allStaged) {
      removeLocalSnapshotsFromStore(localSnapshots);
      return appendRecoveredSuccess(
        journal,
        { operationId, type: "delete", ok: true, pageIds: affected },
        {},
      );
    }
    const allBefore = (
      await Promise.all(
        localSnapshots.map(async (snapshot) => {
          const trashPath = journal.localTrashPathsByPageId[snapshot.pageId];
          return (
            (await pathExists(snapshot.page.localFilePath!)) &&
            (!trashPath || !(await pathExists(trashPath)))
          );
        }),
      )
    ).every(Boolean);
    if (allBefore) {
      return writeBatchPlanJournal({
        ...journal,
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
    }
    const restoreErrors = await restoreLocalDelete(localSnapshots, journal);
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: restoreErrors.length
        ? `本地删除中断，且 ${restoreErrors.length} 个文件未能恢复`
        : "本地删除中断，已恢复暂存文件",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  const pages = usePages.getState().pages;
  const deleteBatchId = journal.deleteBatchIdsByOperationId[operationId];
  if (!deleteBatchId) {
    return writeBatchPlanJournal({
      ...journal,
      status: "failed",
      error: "中断删除缺少可验证的批次标记",
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  const allDeleted = affected.every((pageId) => {
    const page = pages[pageId];
    return !!page?.trashedAt && page.trashBatchId === deleteBatchId;
  });
  if (allDeleted) {
    return appendRecoveredSuccess(
      journal,
      { operationId, type: "delete", ok: true, pageIds: affected },
      Object.fromEntries(
        affected.map((pageId) => [pageId, revisionOf(pages[pageId]!)]),
      ),
    );
  }
  const allBefore = affected.every((pageId) => {
    const page = pages[pageId];
    const before = journal.before[pageId];
    return (
      !!page && !!before && sameRevision(revisionOf(page), before.revision)
    );
  });
  if (allBefore)
    return writeBatchPlanJournal({
      ...journal,
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  for (const rootId of operation.pageIds) {
    const page = usePages.getState().pages[rootId];
    if (page?.trashedAt && page.trashBatchId === deleteBatchId) {
      usePages.getState().restorePage(rootId);
    }
  }
  return writeBatchPlanJournal({
    ...journal,
    status: "failed",
    error: "删除操作在中断时只完成了一部分，已尝试恢复已删除根页面",
    executingOperationId: undefined,
    executingStartedAt: undefined,
  });
}

async function rememberBefore(pageId: string, journal: BatchPlanJournal) {
  const snapshot = journal.before[pageId];
  if (!snapshot) return;
  await recordHistorySnapshot({
    pageId,
    workspaceId: journal.notebookId,
    content: clone(snapshot.page.content),
    trigger: "pre-op",
    isMilestone: true,
    label: `AI 批量计划 ${journal.input.title} 前`,
  });
}

async function renameLocalPath(
  oldPath: string,
  newPath: string,
): Promise<void> {
  const fs = typeof window !== "undefined" ? window.gooseFs : undefined;
  if (!fs) throw new Error("本地文件系统不可用");
  const created = await Promise.resolve(fs.mkdir(dirname(newPath)));
  if (!created) throw new Error("无法创建本地文件暂存目录");
  const renamed = await Promise.resolve(fs.rename(oldPath, newPath));
  if (!renamed) throw new Error("本地文件移动失败");
}

function removeLocalSnapshotsFromStore(snapshots: FrozenPageSnapshot[]): void {
  const ids = new Set(snapshots.map((snapshot) => snapshot.pageId));
  usePages.setState((state) => {
    const pages = { ...state.pages };
    const dirtyLocalPageIds = { ...state.dirtyLocalPageIds };
    ids.forEach((pageId) => {
      delete pages[pageId];
      delete dirtyLocalPageIds[pageId];
    });
    return {
      pages,
      dirtyLocalPageIds,
      activePageId:
        state.activePageId && ids.has(state.activePageId)
          ? null
          : state.activePageId,
    };
  });
  ids.forEach((pageId) => useTabs.getState().removeDeletedPage(pageId));
}

function restoreLocalSnapshotsToStore(snapshots: FrozenPageSnapshot[]): void {
  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      ...Object.fromEntries(
        snapshots.map((snapshot) => [snapshot.pageId, clone(snapshot.page)]),
      ),
    },
  }));
}

async function stageLocalDelete(
  snapshots: FrozenPageSnapshot[],
  journal: BatchPlanJournal,
): Promise<void> {
  const staged: FrozenPageSnapshot[] = [];
  try {
    for (const snapshot of snapshots) {
      const originalPath = snapshot.page.localFilePath;
      const trashPath = journal.localTrashPathsByPageId[snapshot.pageId];
      if (!originalPath || !trashPath) {
        throw new Error("本地删除计划缺少可恢复路径");
      }
      await renameLocalPath(originalPath, trashPath);
      staged.push(snapshot);
    }
    removeLocalSnapshotsFromStore(snapshots);
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const snapshot of [...staged].reverse()) {
      const originalPath = snapshot.page.localFilePath!;
      const trashPath = journal.localTrashPathsByPageId[snapshot.pageId];
      try {
        await renameLocalPath(trashPath, originalPath);
      } catch {
        rollbackErrors.push(originalPath);
      }
    }
    throw new Error(
      rollbackErrors.length
        ? `本地删除失败，且 ${rollbackErrors.length} 个文件未能恢复`
        : error instanceof Error
          ? error.message
          : "本地删除失败",
      { cause: error },
    );
  }
}

async function restoreLocalDelete(
  snapshots: FrozenPageSnapshot[],
  journal: BatchPlanJournal,
): Promise<string[]> {
  const errors: string[] = [];
  const restored: FrozenPageSnapshot[] = [];
  for (const snapshot of snapshots) {
    const originalPath = snapshot.page.localFilePath;
    const trashPath = journal.localTrashPathsByPageId[snapshot.pageId];
    if (!originalPath || !trashPath) {
      errors.push(`页面 ${snapshot.pageId} 缺少本地恢复路径`);
      continue;
    }
    if (await pathExists(originalPath)) {
      errors.push(`原路径 ${originalPath} 已被占用`);
      continue;
    }
    if (!(await pathExists(trashPath))) {
      errors.push(`暂存文件 ${trashPath} 不存在`);
      continue;
    }
    try {
      await renameLocalPath(trashPath, originalPath);
      restored.push(snapshot);
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `无法恢复 ${originalPath}`,
      );
    }
  }
  if (restored.length) restoreLocalSnapshotsToStore(restored);
  return errors;
}

async function compensate(journal: BatchPlanJournal): Promise<string[]> {
  const errors: string[] = [];
  const restoredContentPages = new Set<string>();
  for (const result of [...journal.results].reverse()) {
    if (!result.ok) continue;
    if (result.type === "create") {
      const pageId = journal.createdPageIds[result.operationId];
      const page = pageId ? usePages.getState().pages[pageId] : undefined;
      const after = pageId ? journal.after[pageId] : undefined;
      if (pageId && page && after && sameRevision(revisionOf(page), after)) {
        const deleted = await usePages.getState().deletePage(pageId);
        if (deleted) useTabs.getState().removeDeletedPage(pageId);
        else errors.push(`无法撤回新建页面 ${pageId}`);
      } else if (pageId) {
        errors.push(`新建页面 ${pageId} 已变化，未撤回`);
      }
      continue;
    }
    if (result.type === "delete") {
      const localSnapshots = result.pageIds.flatMap((pageId) => {
        const snapshot = journal.before[pageId];
        return snapshot?.page.localFilePath ? [snapshot] : [];
      });
      if (localSnapshots.length > 0) {
        errors.push(...(await restoreLocalDelete(localSnapshots, journal)));
        continue;
      }
      for (const pageId of result.pageIds) {
        const page = usePages.getState().pages[pageId];
        const after = journal.after[pageId];
        if (page?.trashedAt && after && sameRevision(revisionOf(page), after)) {
          const restored = usePages.getState().restorePage(pageId);
          if (!restored.ok) errors.push(`无法恢复页面 ${pageId}`);
        } else if (page?.trashedAt) {
          errors.push(`垃圾箱页面 ${pageId} 已变化，未恢复`);
        }
      }
      continue;
    }
    for (const pageId of result.pageIds) {
      if (restoredContentPages.has(pageId)) continue;
      const snapshot = journal.before[pageId];
      const after = journal.after[pageId];
      if (snapshot && after) {
        restoredContentPages.add(pageId);
        const restored = await writePageContentSafely(
          pageId,
          clone(snapshot.page.content),
          {
            expectedNotebookId: journal.notebookId,
            expectedRevision: after,
          },
        );
        if (restored.ok) reloadEditorIfActive(pageId);
        else errors.push(restored.error);
        const originalPath = snapshot.page.localFilePath;
        const currentPath = usePages.getState().pages[pageId]?.localFilePath;
        if (
          restored.ok &&
          originalPath &&
          currentPath &&
          comparisonPath(originalPath) !== comparisonPath(currentPath)
        ) {
          try {
            const restoredPageId = await usePages
              .getState()
              .renameLocalPageFile(
                pageId,
                basenameWithoutMarkdownExtension(originalPath),
              );
            const restoredPath =
              usePages.getState().pages[restoredPageId]?.localFilePath;
            if (
              !restoredPath ||
              comparisonPath(restoredPath) !== comparisonPath(originalPath)
            ) {
              errors.push(`无法恢复页面 ${pageId} 的原文件名`);
            }
          } catch (error) {
            errors.push(
              error instanceof Error
                ? error.message
                : `无法恢复页面 ${pageId} 的原文件名`,
            );
          }
        }
      }
    }
  }
  return errors;
}

async function writeSearchReplaceFromLatest(
  operation: Extract<
    BatchPlanInput["operations"][number],
    { type: "search_replace" }
  >,
  working: BatchPlanJournal,
) {
  const before = working.before[operation.pageId];
  if (!before) throw new Error("冻结计划缺少目标页面快照");

  const attempt = async () => {
    const livePage = usePages.getState().pages[operation.pageId];
    if (!livePage) throw new Error("目标页不存在");
    const alreadyWrote = Boolean(working.after[operation.pageId]);
    // 同页后续项必须基于当前正文和当前修订，不能再用批准瞬间的旧快照。
    const baseContent = alreadyWrote ? livePage.content : before.page.content;
    const expectedRevision = alreadyWrote
      ? revisionOf(livePage)
      : before.revision;
    const applied = applySearchReplacePreservingBlocks(
      baseContent,
      operation.oldString,
      operation.newString,
      { replaceAll: operation.replaceAll === true },
    );
    if (!applied.ok) throw new Error(applied.error);
    const saved = await writePageContentSafely(operation.pageId, applied.content, {
      expectedNotebookId: working.notebookId,
      expectedRevision,
    });
    return saved;
  };

  let saved = await attempt();
  if (
    !saved.ok &&
    saved.code === "page-changed" &&
    working.after[operation.pageId]
  ) {
    saved = await attempt();
  }
  if (!saved.ok) throw new Error(saved.error);
}

async function run(journal: BatchPlanJournal): Promise<BatchPlanExecuteResult> {
  if (journal.status === "completed")
    return { ok: true, journal, results: journal.results };
  if (journal.status === "invalid")
    return {
      ok: false,
      journal,
      error: journal.error || "计划无效",
      results: journal.results,
    };
  if (journal.selectedOperationIds.length === 0) {
    const invalid = writeBatchPlanJournal({
      ...journal,
      status: "invalid",
      error: "至少选择一项操作后才能执行",
    });
    return {
      ok: false,
      journal: invalid,
      error: invalid.error!,
      results: invalid.results,
    };
  }
  const recovered = await recoverInterruptedOperation(journal);
  if (recovered.status === "failed") {
    return {
      ok: false,
      journal: recovered,
      error: recovered.error || "中断恢复失败",
      results: recovered.results,
    };
  }
  const conflict = await preflight(recovered);
  if (conflict) {
    const failed = writeBatchPlanJournal({
      ...recovered,
      status: "failed",
      error: conflict,
    });
    return {
      ok: false,
      journal: failed,
      error: conflict,
      results: failed.results,
    };
  }
  let working = writeBatchPlanJournal({
    ...recovered,
    status: "executing",
    error: undefined,
  });
  for (const operation of pendingOperations(working)) {
    // 每项真正写入前先持久化 intent；崩溃后不会把“未开始”误报成成功。
    working = writeBatchPlanJournal({
      ...working,
      executingOperationId: operation.operationId,
      executingStartedAt: Date.now(),
    });
    let result: BatchOperationResult;
    try {
      if (operation.type === "create") {
        const content = plannedContent(operation, working);
        const plannedLocalPath =
          working.plannedLocalPaths[operation.operationId];
        let pageId: string;
        if (plannedLocalPath) {
          const created = await usePages.getState().createLocalPageRecord({
            workspaceId: working.notebookId,
            parentId: operation.parentId,
            title: operation.title,
            content,
          });
          if (!created) throw new Error("创建本地文件页面失败");
          pageId = created;
          const actualPath = usePages.getState().pages[pageId]?.localFilePath;
          if (
            !actualPath ||
            comparisonPath(actualPath) !== comparisonPath(plannedLocalPath)
          ) {
            await usePages.getState().deletePage(pageId);
            throw new Error("本地新建目标在执行时发生变化，已取消创建");
          }
        } else {
          pageId = working.plannedPageIds[operation.operationId];
          if (!pageId) throw new Error("冻结计划缺少预分配页面 ID");
          if (usePages.getState().pages[pageId]) {
            throw new Error("预分配页面 ID 已存在，拒绝重复创建");
          }
          const created = usePages.getState().createPageRecord({
            id: pageId,
            workspaceId: working.notebookId,
            parentId: operation.parentId,
            content,
          });
          if (created !== pageId) throw new Error("创建页面返回了非预分配 ID");
        }
        const page = usePages.getState().pages[pageId];
        if (!page) throw new Error("创建页面后未找到页面");
        working = {
          ...working,
          createdPageIds: {
            ...working.createdPageIds,
            [operation.operationId]: pageId,
          },
          after: { ...working.after, [pageId]: revisionOf(page) },
        };
        result = {
          operationId: operation.operationId,
          type: operation.type,
          ok: true,
          pageIds: [pageId],
        };
      } else if (operation.type === "edit") {
        await rememberBefore(operation.pageId, working);
        const before = working.before[operation.pageId];
        const originalPath = before.page.localFilePath;
        const plannedLocalPath =
          working.plannedLocalPaths[operation.operationId];
        let renamed = false;
        if (
          originalPath &&
          plannedLocalPath &&
          comparisonPath(originalPath) !== comparisonPath(plannedLocalPath)
        ) {
          const renamedPageId = await usePages
            .getState()
            .renameLocalPageFile(
              operation.pageId,
              basenameWithoutMarkdownExtension(plannedLocalPath),
            );
          const actualPath =
            usePages.getState().pages[renamedPageId]?.localFilePath;
          if (
            !actualPath ||
            comparisonPath(actualPath) !== comparisonPath(plannedLocalPath)
          ) {
            if (actualPath && originalPath) {
              try {
                await usePages
                  .getState()
                  .renameLocalPageFile(
                    operation.pageId,
                    basenameWithoutMarkdownExtension(originalPath),
                  );
              } catch {
                // 保留失败现场，由执行日志提示人工恢复。
              }
            }
            throw new Error("本地文件重命名结果与审批计划不一致");
          }
          renamed = true;
        }
        const saved = await writePageContentSafely(
          operation.pageId,
          plannedContent(operation, working),
          {
            expectedNotebookId: working.notebookId,
            expectedRevision: before.revision,
          },
        );
        if (!saved.ok) {
          if (renamed && originalPath) {
            await usePages
              .getState()
              .renameLocalPageFile(
                operation.pageId,
                basenameWithoutMarkdownExtension(originalPath),
              );
          }
          throw new Error(saved.error);
        }
        const page = usePages.getState().pages[operation.pageId]!;
        working = {
          ...working,
          after: { ...working.after, [operation.pageId]: revisionOf(page) },
          localPathAfterByPageId: page.localFilePath
            ? {
                ...working.localPathAfterByPageId,
                [operation.pageId]: page.localFilePath,
              }
            : working.localPathAfterByPageId,
        };
        reloadEditorIfActive(operation.pageId);
        result = {
          operationId: operation.operationId,
          type: operation.type,
          ok: true,
          pageIds: [operation.pageId],
        };
      } else if (operation.type === "search_replace") {
        await rememberBefore(operation.pageId, working);
        await writeSearchReplaceFromLatest(operation, working);
        const page = usePages.getState().pages[operation.pageId]!;
        working = {
          ...working,
          after: { ...working.after, [operation.pageId]: revisionOf(page) },
          localPathAfterByPageId: page.localFilePath
            ? {
                ...working.localPathAfterByPageId,
                [operation.pageId]: page.localFilePath,
              }
            : working.localPathAfterByPageId,
        };
        const nextSamePage = pendingOperations(working).some(
          (candidate) =>
            candidate.operationId !== operation.operationId &&
            candidate.type === "search_replace" &&
            candidate.pageId === operation.pageId &&
            !working.results.some(
              (item) => item.operationId === candidate.operationId && item.ok,
            ),
        );
        // 同页后续项还要写：先不刷新编辑器，避免中间修订把后面的项卡死。
        if (!nextSamePage) reloadEditorIfActive(operation.pageId);
        result = {
          operationId: operation.operationId,
          type: operation.type,
          ok: true,
          pageIds: [operation.pageId],
        };
      } else if (operation.type === "delete") {
        const affectedPageIds =
          working.affectedPageIdsByOperationId[operation.operationId] ??
          operation.pageIds;
        for (const pageId of affectedPageIds)
          await rememberBefore(pageId, working);
        const localSnapshots = affectedPageIds.flatMap((pageId) => {
          const snapshot = working.before[pageId];
          return snapshot?.page.localFilePath ? [snapshot] : [];
        });
        if (localSnapshots.length > 0) {
          if (localSnapshots.length !== affectedPageIds.length) {
            throw new Error("删除计划不能混合本地文件和内置页面");
          }
          await stageLocalDelete(localSnapshots, working);
          result = {
            operationId: operation.operationId,
            type: operation.type,
            ok: true,
            pageIds: [...affectedPageIds],
          };
          working = writeBatchPlanJournal({
            ...working,
            results: [...working.results, result],
            executingOperationId: undefined,
            executingStartedAt: undefined,
          });
          continue;
        }
        const deletedRootIds: string[] = [];
        const deleteBatchId =
          working.deleteBatchIdsByOperationId[operation.operationId];
        if (!deleteBatchId) throw new Error("冻结计划缺少删除批次标记");
        for (const pageId of operation.pageIds) {
          const deleted = await usePages
            .getState()
            .deletePage(pageId, { trashBatchId: deleteBatchId });
          if (!deleted) {
            const restoreErrors: string[] = [];
            for (const deletedRootId of [...deletedRootIds].reverse()) {
              const restored = usePages.getState().restorePage(deletedRootId);
              if (!restored.ok) restoreErrors.push(deletedRootId);
            }
            throw new Error(
              restoreErrors.length > 0
                ? `删除页面 ${pageId} 失败，且 ${restoreErrors.length} 个已删除页面未能恢复`
                : `删除页面 ${pageId} 失败，已恢复本项此前删除的页面`,
            );
          }
          deletedRootIds.push(pageId);
          for (const affectedPageId of affectedPageIds) {
            const page = usePages.getState().pages[affectedPageId];
            if (page)
              working = {
                ...working,
                after: { ...working.after, [affectedPageId]: revisionOf(page) },
              };
          }
        }
        affectedPageIds.forEach((pageId) =>
          useTabs.getState().removeDeletedPage(pageId),
        );
        result = {
          operationId: operation.operationId,
          type: operation.type,
          ok: true,
          pageIds: [...affectedPageIds],
        };
      } else {
        const unsupported: never = operation;
        throw new Error(
          `暂不支持的操作类型: ${(unsupported as { type?: string }).type ?? "unknown"}`,
        );
      }
    } catch (error) {
      result = {
        operationId: operation.operationId,
        type: operation.type,
        ok: false,
        pageIds:
          operation.type === "delete"
            ? operation.pageIds
            : operation.type === "edit" ||
                operation.type === "search_replace"
              ? [operation.pageId]
              : [],
        error: error instanceof Error ? error.message : "执行失败",
      };
      working = writeBatchPlanJournal({
        ...working,
        results: [...working.results, result],
        status: "failed",
        error: result.error,
        executingOperationId: undefined,
        executingStartedAt: undefined,
      });
      const compensationErrors = await compensate(working);
      if (compensationErrors.length > 0) {
        working = writeBatchPlanJournal({
          ...working,
          error: formatBatchPlanErrors([
            result.error ?? "",
            ...compensationErrors,
          ]),
        });
      }
      return {
        ok: false,
        journal: working,
        error: working.error!,
        results: working.results,
      };
    }
    working = writeBatchPlanJournal({
      ...working,
      results: [...working.results, result],
      executingOperationId: undefined,
      executingStartedAt: undefined,
    });
  }
  working = writeBatchPlanJournal({ ...working, status: "completed" });
  return { ok: true, journal: working, results: working.results };
}

export function executePreparedBatchPlan(
  toolCallId: string,
  runId: string,
): Promise<BatchPlanExecuteResult> {
  const key = `${toolCallId}:${runId}`;
  const current = inFlight.get(key);
  if (current) return current;
  const journal = readBatchPlanJournal(toolCallId, runId);
  if (!journal) return Promise.reject(new Error("未找到批量计划"));
  const promise = run(journal).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function undoBatchPlan(
  toolCallId: string,
  runId: string,
): Promise<BatchPlanExecuteResult> {
  const journal = readBatchPlanJournal(toolCallId, runId);
  if (!journal) throw new Error("未找到批量计划");
  if (journal.status === "undone")
    return { ok: true, journal, results: journal.results };
  if (journal.status !== "completed")
    return {
      ok: false,
      journal,
      error: "只有已完成的批量计划可以撤回",
      results: journal.results,
    };
  for (const [pageId, after] of Object.entries(journal.after)) {
    const page = usePages.getState().pages[pageId];
    if (!page || !sameRevision(revisionOf(page), after)) {
      const conflicted = writeBatchPlanJournal({
        ...journal,
        status: "undo-conflicted",
        error: "页面在批量执行后已被修改，拒绝覆盖",
      });
      return {
        ok: false,
        journal: conflicted,
        error: conflicted.error!,
        results: conflicted.results,
      };
    }
  }
  for (const [pageId, expectedPath] of Object.entries(
    journal.localPathAfterByPageId,
  )) {
    const currentPath = usePages.getState().pages[pageId]?.localFilePath;
    if (
      !currentPath ||
      comparisonPath(currentPath) !== comparisonPath(expectedPath)
    ) {
      const conflicted = writeBatchPlanJournal({
        ...journal,
        status: "undo-conflicted",
        error: "本地文件路径在批量执行后已变化，拒绝覆盖",
      });
      return {
        ok: false,
        journal: conflicted,
        error: conflicted.error!,
        results: conflicted.results,
      };
    }
  }
  const successfulLocalDeletePageIds = new Set(
    journal.results.flatMap((result) =>
      result.ok && result.type === "delete" ? result.pageIds : [],
    ),
  );
  for (const [pageId, trashPath] of Object.entries(
    journal.localTrashPathsByPageId,
  ).filter(([pageId]) => successfulLocalDeletePageIds.has(pageId))) {
    const originalPath = journal.before[pageId]?.page.localFilePath;
    if (
      !originalPath ||
      (await pathExists(originalPath)) ||
      !(await pathExists(trashPath))
    ) {
      const conflicted = writeBatchPlanJournal({
        ...journal,
        status: "undo-conflicted",
        error: "本地删除文件的恢复路径已变化，拒绝覆盖",
      });
      return {
        ok: false,
        journal: conflicted,
        error: conflicted.error!,
        results: conflicted.results,
      };
    }
  }
  const compensationErrors = await compensate(journal);
  if (compensationErrors.length > 0) {
    const conflicted = writeBatchPlanJournal({
      ...journal,
      status: "undo-conflicted",
      error: formatBatchPlanErrors(compensationErrors),
    });
    return {
      ok: false,
      journal: conflicted,
      error: conflicted.error!,
      results: conflicted.results,
    };
  }
  const undone = writeBatchPlanJournal({
    ...journal,
    status: "undone",
    error: undefined,
  });
  return { ok: true, journal: undone, results: undone.results };
}
