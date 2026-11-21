const ACTION_INTENT_PREFIX = "ai-action:";
const OPEN_ONLY_INTENT_PREFIX = "ai-open:";

export interface ResolvedAiEntryIntent {
  action: string | null;
  requestKey: string;
}

/** Generic assistant entry points must never inherit a prior one-shot action. */
export function createAiEntryIntent(action: string, sequence: number): string {
  if (action === "ai_chat") return `${OPEN_ONLY_INTENT_PREFIX}${sequence}`;
  return `${ACTION_INTENT_PREFIX}${sequence}:${action}`;
}

/** Supports plain legacy actions while giving repeated explicit actions unique identities. */
export function resolveAiEntryIntent(value: string): ResolvedAiEntryIntent {
  if (value === "ai_chat") return { action: null, requestKey: value };
  if (value.startsWith(OPEN_ONLY_INTENT_PREFIX)) return { action: null, requestKey: value };
  if (!value.startsWith(ACTION_INTENT_PREFIX)) return { action: value, requestKey: value };
  const separator = value.indexOf(":", ACTION_INTENT_PREFIX.length);
  if (separator < 0) return { action: value, requestKey: value };
  return {
    requestKey: value,
    action: value.slice(separator + 1)
  };
}

/** Maps user-facing quick actions to their dedicated built-in Skills. */
export function resolveAiSkillId(action: string): string | null {
  if (action === "polish") return "polish";
  if (action === "summarize") return "quick-summarize";
  return null;
}
