import { expect, it } from "vitest";
import { isTaskDocumentCurrent } from "../../src/core/ai/taskSnapshot";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const start: AiDocumentSnapshot = { documentId: "doc", revision: 2, content: "hello", cursor: 0, selection: { from: 0, to: 2 }, selectionValid: true, readOnly: false };
it("permits cursor movement for a document task but stops stale content and changed selection dependencies", () => {
  expect(isTaskDocumentCurrent(start, { ...start, cursor: 4, selection: null }, false)).toBe(true);
  expect(isTaskDocumentCurrent(start, { ...start, cursor: 4, selection: null }, true)).toBe(false);
  expect(isTaskDocumentCurrent(start, { ...start, revision: 3 }, false)).toBe(false);
  expect(isTaskDocumentCurrent(start, { ...start, content: "changed" }, false)).toBe(false);
  expect(isTaskDocumentCurrent(start, { ...start, documentId: "other" }, false)).toBe(false);
  expect(isTaskDocumentCurrent(start, { ...start, cursor: 4 }, "cursor")).toBe(false);
  expect(isTaskDocumentCurrent(start, { ...start }, "cursor")).toBe(true);
  expect(isTaskDocumentCurrent(start, undefined, false)).toBe(false);
});
