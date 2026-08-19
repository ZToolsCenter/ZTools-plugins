import { readDbStorageJSON, writeDbStorageJSON } from "@/lib/storage";
import type { BatchPlanJournal } from "./types";

const KEY_PREFIX = "gn:notebook-ai:batch-plan:";

export function batchPlanJournalKey(toolCallId: string, runId: string) {
  return `${KEY_PREFIX}${toolCallId}:${runId}`;
}

export function readBatchPlanJournal(
  toolCallId: string,
  runId: string,
): BatchPlanJournal | null {
  const journal = readDbStorageJSON<BatchPlanJournal | null>(
    batchPlanJournalKey(toolCallId, runId),
    null,
  );
  if (!journal) return null;
  return {
    ...journal,
    affectedPageIdsByOperationId: journal.affectedPageIdsByOperationId ?? {},
    deleteBatchIdsByOperationId: journal.deleteBatchIdsByOperationId ?? {},
    plannedPageIds: journal.plannedPageIds ?? {},
    plannedLocalPaths: journal.plannedLocalPaths ?? {},
    localPathAfterByPageId: journal.localPathAfterByPageId ?? {},
    localTrashPathsByPageId: journal.localTrashPathsByPageId ?? {},
  };
}

export function writeBatchPlanJournal(
  journal: BatchPlanJournal,
): BatchPlanJournal {
  const next = { ...journal, updatedAt: Date.now() };
  writeDbStorageJSON(batchPlanJournalKey(next.toolCallId, next.runId), next);
  return next;
}

export function updateBatchPlanSelection(
  toolCallId: string,
  runId: string,
  selectedOperationIds: string[],
): BatchPlanJournal | null {
  const journal = readBatchPlanJournal(toolCallId, runId);
  if (!journal) return null;
  const allowed = new Set(
    journal.input.operations.map((operation) => operation.operationId),
  );
  const unique = [...new Set(selectedOperationIds)].filter((id) =>
    allowed.has(id),
  );
  return writeBatchPlanJournal({ ...journal, selectedOperationIds: unique });
}
