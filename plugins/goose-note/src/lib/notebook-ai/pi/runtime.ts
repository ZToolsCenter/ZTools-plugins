import { useSettings } from "@/stores/useSettings";

export type NotebookAiRuntime = "legacy" | "pi";

const RUNTIME_STORAGE_KEY = "goose-ai-runtime";

/**
 * 解析当前 Agent 运行时。
 * 优先级：localStorage 覆盖 → settings.ai.runtime → 默认 pi。
 * localStorage 便于验收与回退：`goose-ai-runtime=legacy|pi`。
 */
export function resolveNotebookAiRuntime(): NotebookAiRuntime {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(RUNTIME_STORAGE_KEY)?.trim();
      if (raw === "legacy" || raw === "pi") return raw;
    } catch {
      // ignore storage failures
    }
  }

  const fromSettings = useSettings.getState().ai.runtime;
  if (fromSettings === "legacy" || fromSettings === "pi") {
    return fromSettings;
  }
  return "pi";
}

export function setNotebookAiRuntimeOverride(
  runtime: NotebookAiRuntime | null,
): void {
  if (typeof window === "undefined") return;
  try {
    if (!runtime) {
      window.localStorage.removeItem(RUNTIME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(RUNTIME_STORAGE_KEY, runtime);
    }
  } catch {
    // ignore
  }
}
