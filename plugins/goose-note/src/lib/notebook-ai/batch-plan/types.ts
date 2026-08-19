import type { JSONContent, Page } from "@/types";

export type BatchPlanOperationInput =
  | {
      type: "create";
      operationId: string;
      title: string;
      markdown: string;
      parentId?: string;
    }
  | {
      type: "edit";
      operationId: string;
      pageId: string;
      /** 完整正文；title 存在时同时改标题。 */
      markdown: string;
      title?: string;
    }
  | {
      type: "delete";
      operationId: string;
      pageIds: string[];
    }
  | {
      type: "search_replace";
      operationId: string;
      pageId: string;
      /** 来自 readPage 的精确片段。 */
      oldString: string;
      /** 替换内容；空字符串表示删除该片段。 */
      newString: string;
      /** 是否替换全部匹配；默认 false。 */
      replaceAll?: boolean;
    };

export interface BatchPlanInput {
  title: string;
  summary: string;
  operations: BatchPlanOperationInput[];
}

export type BatchPlanStatus =
  | "prepared"
  | "invalid"
  | "executing"
  | "completed"
  | "failed"
  | "undone"
  | "undo-conflicted";

export interface PageRevision {
  updatedAt: number;
  contentSignature: string;
}

export interface FrozenPageSnapshot {
  pageId: string;
  page: Page;
  revision: PageRevision;
}

export interface BatchOperationResult {
  operationId: string;
  type: BatchPlanOperationInput["type"];
  ok: boolean;
  pageIds: string[];
  error?: string;
}

export interface BatchPlanJournal {
  version: 1;
  toolCallId: string;
  runId: string;
  notebookId: string;
  input: BatchPlanInput;
  selectedOperationIds: string[];
  status: BatchPlanStatus;
  /** 已写入日志、即将执行的操作；用于崩溃后的人工诊断与恢复。 */
  executingOperationId?: string;
  executingStartedAt?: number;
  before: Record<string, FrozenPageSnapshot>;
  /** delete 操作在 prepare 时展开的根节点及所有未删除子孙页面。 */
  affectedPageIdsByOperationId: Record<string, string[]>;
  /** delete 操作独有的垃圾箱批次标记，用于中断恢复时证明删除归属。 */
  deleteBatchIdsByOperationId: Record<string, string>;
  /** prepare 时为内置笔记 create 操作预分配的稳定页面 ID。 */
  plannedPageIds: Record<string, string>;
  /** 本地 create / rename 在审批时冻结的目标路径。 */
  plannedLocalPaths: Record<string, string>;
  /** 本地页面执行成功后的路径，用于撤回前冲突检查。 */
  localPathAfterByPageId: Record<string, string>;
  /** 本地 delete 的可恢复暂存路径；原文件不会直接永久删除。 */
  localTrashPathsByPageId: Record<string, string>;
  /** 已创建页的 pageId，或已写入/删除页的执行后版本。 */
  after: Record<string, PageRevision>;
  createdPageIds: Record<string, string>;
  results: BatchOperationResult[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type BatchPlanPrepareResult =
  | { ok: true; journal: BatchPlanJournal }
  | { ok: false; error: string; journal?: BatchPlanJournal };

export type BatchPlanExecuteResult =
  | { ok: true; journal: BatchPlanJournal; results: BatchOperationResult[] }
  | {
      ok: false;
      journal: BatchPlanJournal;
      error: string;
      results: BatchOperationResult[];
    };
