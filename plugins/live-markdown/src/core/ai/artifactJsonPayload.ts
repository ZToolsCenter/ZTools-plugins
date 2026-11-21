import { unwrapJsonResponseEnvelope } from "./jsonResponseEnvelope";

const MAX_JSON_BYTES = 32_768;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 4_096;
const MAX_RENDERED_JSON_BYTES = 131_072;
const encoder = new TextEncoder();

function assertBoundedJsonValue(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) throw new Error("JSON 数据超过节点数或深度限制。");
    if (current.value === null || typeof current.value === "string" || typeof current.value === "boolean") continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) throw new Error("JSON 数值必须是有限数值。");
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (typeof current.value === "object" &&
        (Object.getPrototypeOf(current.value) === Object.prototype || Object.getPrototypeOf(current.value) === null)) {
      for (const child of Object.values(current.value as Record<string, unknown>)) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    throw new Error("JSON 数据包含无效值。");
  }
}

/** Parses model-provided JSON text under fixed byte, depth, and node limits. */
export function parseArtifactJsonPayload(raw: string): unknown {
  if (encoder.encode(raw).byteLength > MAX_JSON_BYTES) throw new Error("JSON 数据超过 32 KiB 上限。");
  let value: unknown;
  try { value = JSON.parse(unwrapJsonResponseEnvelope(raw)) as unknown; }
  catch { throw new Error("JSON payload 不是完整 JSON 文档。"); }
  assertBoundedJsonValue(value);
  return value;
}

/** Pretty-serializes bounded JSON data for the program-owned language fence. */
export function stringifyArtifactJsonPayload(value: unknown): string | undefined {
  try { assertBoundedJsonValue(value); }
  catch { return undefined; }
  try {
    const result = JSON.stringify(value, null, 2);
    return result !== undefined && encoder.encode(result).byteLength <= MAX_RENDERED_JSON_BYTES ? result : undefined;
  } catch {
    return undefined;
  }
}
