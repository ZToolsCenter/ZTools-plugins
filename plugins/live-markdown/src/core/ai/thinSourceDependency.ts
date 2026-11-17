import { analyzeEvidenceQuestion } from "./thinEvidenceFields";

/** A field question naming an entity already present in the authorized source
 * may read that source, even when the user omits the word "document". This is
 * only dependency detection; the evidence executor still owns relation checks. */
export function referencesDocumentFields(instruction: string, source: string): boolean {
  if (!source) return false;
  const question = analyzeEvidenceQuestion(instruction, []);
  if (!question.fields.length || !question.requestedSubjects.length) return false;
  const normalized = source.normalize("NFC").toLowerCase();
  return question.requestedSubjects.some(({ key }) => {
    let from = normalized.indexOf(key);
    while (from !== -1) {
      const before = normalized[from - 1] ?? "";
      const after = normalized[from + key.length] ?? "";
      if (!/[\p{L}\p{N}_-]/u.test(before) && !/[\p{L}\p{N}_-]/u.test(after)) return true;
      from = normalized.indexOf(key, from + Math.max(1, key.length));
    }
    return false;
  });
}
