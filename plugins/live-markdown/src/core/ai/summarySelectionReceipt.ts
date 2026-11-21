import { unwrapJsonResponseEnvelope } from "./jsonResponseEnvelope";

const encoder = new TextEncoder();
export const MAX_SUMMARY_SELECTION_RECEIPT_BYTES = 16 * 1024;
export const MAX_SUMMARY_SELECTION_IDS = 64;

function invalidJson(): never {
  throw new Error("未能读取摘要证据清单，请修改指令或缩小范围。原文未修改。");
}

/** Parses one raw or fully fenced JSON receipt while keeping the source-ID gate strict. */
export function parseSummarySelectionReceipt(response: string, candidateIds: readonly string[]): string[] {
  if (response.length > MAX_SUMMARY_SELECTION_RECEIPT_BYTES || encoder.encode(response).byteLength > MAX_SUMMARY_SELECTION_RECEIPT_BYTES) {
    throw new Error("摘要证据输出超过上限，原文未修改。");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(unwrapJsonResponseEnvelope(response)) as unknown; }
  catch { return invalidJson(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("摘要证据清单格式无效，原文未修改。");
  }
  const receipt = parsed as { ids?: unknown };
  if (Object.keys(parsed).length !== 1 || !Object.hasOwn(receipt, "ids")) {
    throw new Error("摘要证据清单格式无效，原文未修改。");
  }
  const ids = receipt.ids;
  const known = new Set(candidateIds);
  if (!Array.isArray(ids) || ids.length > MAX_SUMMARY_SELECTION_IDS || ids.some((id) => typeof id !== "string" || !known.has(id)) || new Set(ids).size !== ids.length) {
    throw new Error("摘要包含无法回溯的事实 ID，原文未修改。");
  }
  return ids as string[];
}
