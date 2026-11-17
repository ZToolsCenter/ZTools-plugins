import { LoadedDocument } from "../types/typora";

export const DOCUMENT_RECOVERY_KEY = "typora_ztools_recovery_v1";

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function persistDocumentRecovery(
  document: LoadedDocument,
  storage: RecoveryStorage,
  baseline: { path: string | null; content: string; known?: boolean }
): boolean {
  if (!document.isDirty) return clearDocumentRecovery(storage);
  try {
    storage.setItem(DOCUMENT_RECOVERY_KEY, JSON.stringify({
      version: 2,
      document,
      baseline: { path: baseline.path, content: baseline.known === false || !baseline.path ? null : baseline.content, known: baseline.known !== false },
      savedAt: Date.now()
    }));
    return true;
  } catch { return false; }
}

export function readDocumentRecovery(storage: RecoveryStorage): LoadedDocument | null {
  try {
    const parsed = JSON.parse(storage.getItem(DOCUMENT_RECOVERY_KEY) || "null") as {
      version?: number;
      document?: LoadedDocument;
      baseline?: { path?: string | null; content?: string | null; known?: boolean };
    } | null;
    if (![1, 2].includes(parsed?.version || 0) || !parsed?.document || typeof parsed.document.content !== "string" || typeof parsed.document.name !== "string") return null;
    const recovered: LoadedDocument = { ...parsed.document, isDirty: true };
    if (parsed.version !== 2 || !parsed.baseline || parsed.baseline.known === false || parsed.baseline.path !== recovered.path ||
      (recovered.path !== null && typeof parsed.baseline.content !== "string")) {
      return { ...recovered, recoveryNeedsSaveAs: true, recoveryBaselineKnown: false };
    }
    return {
      ...recovered,
      recoveryNeedsSaveAs: false,
      recoveryBaselineKnown: true,
      recoveryBaselineContent: parsed.baseline.content ?? "",
      recoveryBaselinePath: parsed.baseline.path ?? null
    };
  } catch { return null; }
}

export function clearDocumentRecovery(storage: RecoveryStorage): boolean {
  try { storage.removeItem(DOCUMENT_RECOVERY_KEY); return true; }
  catch { return false; }
}
