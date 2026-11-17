import { describe, expect, it } from "vitest";
import { clearDocumentRecovery, DOCUMENT_RECOVERY_KEY, persistDocumentRecovery, readDocumentRecovery, RecoveryStorage } from "../../src/core/documentRecovery";
import { LoadedDocument } from "../../src/types/typora";

function memoryStorage(): RecoveryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }
  };
}

const document: LoadedDocument = { path: null, name: "Draft.md", dir: "", content: "unsaved", isDirty: true, mtimeMs: 1 };

describe("document recovery", () => {
  it("persists and restores a dirty draft after an interrupted close", () => {
    const storage = memoryStorage();
    expect(persistDocumentRecovery(document, storage, { path: null, content: "" })).toBe(true);
    expect(storage.getItem(DOCUMENT_RECOVERY_KEY)).toContain("unsaved");
    expect(readDocumentRecovery(storage)).toMatchObject({ ...document, recoveryNeedsSaveAs: false, recoveryBaselineKnown: true, recoveryBaselineContent: "", recoveryBaselinePath: null });
  });

  it("clears recovery for clean documents and rejects malformed records", () => {
    const storage = memoryStorage();
    persistDocumentRecovery(document, storage, { path: null, content: "" });
    expect(persistDocumentRecovery({ ...document, isDirty: false }, storage, { path: null, content: "" })).toBe(true);
    expect(readDocumentRecovery(storage)).toBeNull();
    storage.setItem(DOCUMENT_RECOVERY_KEY, "{");
    expect(readDocumentRecovery(storage)).toBeNull();
    expect(clearDocumentRecovery(storage)).toBe(true);
  });

  it("keeps the disk baseline separate from recovered dirty content", () => {
    const storage = memoryStorage();
    const saved = { ...document, path: "/notes/draft.md", content: "unsaved" };
    expect(persistDocumentRecovery(saved, storage, { path: saved.path, content: "disk baseline" })).toBe(true);
    expect(readDocumentRecovery(storage)).toMatchObject({
      content: "unsaved", recoveryNeedsSaveAs: false, recoveryBaselineKnown: true,
      recoveryBaselineContent: "disk baseline", recoveryBaselinePath: saved.path
    });
  });

  it("requires Save As for legacy records with no provable baseline", () => {
    const storage = memoryStorage();
    storage.setItem(DOCUMENT_RECOVERY_KEY, JSON.stringify({ version: 1, document: { ...document, path: "/notes/draft.md" } }));
    expect(readDocumentRecovery(storage)).toMatchObject({ recoveryNeedsSaveAs: true, recoveryBaselineKnown: false });
    persistDocumentRecovery({ ...document, path: "/notes/draft.md" }, storage, { path: "/notes/draft.md", content: "unknown", known: false });
    expect(readDocumentRecovery(storage)).toMatchObject({ recoveryNeedsSaveAs: true, recoveryBaselineKnown: false });
  });
});
