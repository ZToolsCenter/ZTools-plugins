import type { AiTaskRunnerOptions } from "./aiTaskRunner";

export class AiTaskCancelledError extends Error {
  constructor() { super("AI 任务已取消。"); this.name = "AiTaskCancelledError"; }
}
export class AiTaskDeadlineError extends Error {
  constructor() { super("AI 任务超过时间上限，结果未写入文档。"); this.name = "AiTaskDeadlineError"; }
}

export interface AiInvocationLimits {
  timeoutMs?: number;
  maxOutputBytes?: number;
  silent?: boolean;
  outputSchema?: Record<string, unknown>;
}
export interface AiTaskExecution {
  readonly remainingCalls: number;
  assertRunning(): void;
  invoke(prompt: string, systemPrompt: string, maxTokens: number, limits?: AiInvocationLimits): Promise<string>;
}

/** One budget and cancellation fence for planning and every content chunk. */
export function createAiTaskExecution(options: AiTaskRunnerOptions): AiTaskExecution {
  const now = options.now ?? Date.now;
  const deadlineAt = now() + Math.min(options.maxDurationMs ?? 300_000, 300_000);
  const maxCalls = Math.min(options.maxCalls ?? 64, 64);
  let callCount = 0;
  let active = 0;
  let taskOutputBytes = 0;
  const assertRunning = () => {
    if (options.signal?.aborted || !options.isCurrent()) throw new AiTaskCancelledError();
    if (now() >= deadlineAt) { options.abortCurrent(); throw new AiTaskDeadlineError(); }
  };
  return {
    get remainingCalls() { return maxCalls - callCount; },
    assertRunning,
    async invoke(prompt, systemPrompt, maxTokens, limits = {}) {
      assertRunning();
      if (callCount >= maxCalls) throw new Error("AI 子请求超过 64 次安全上限，结果未写入文档。");
      const outputLimit = Math.min(limits.maxOutputBytes ?? 1_048_576, 2_097_152 - taskOutputBytes);
      if (outputLimit <= 0) throw new Error("本次任务累计输出超过 2 MiB 上限，原文未修改。");
      const requestIndex = ++callCount;
      active = requestIndex;
      options.onRequestStart?.(requestIndex);
      const duration = Math.min(deadlineAt - now(), limits.timeoutMs ?? Infinity);
      let settled = false;
      let bytes = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let removeAbort = () => undefined as void;
      let rejectOverflow: (cause: Error) => void = () => undefined;
      const overflow = new Promise<never>((_resolve, reject) => { rejectOverflow = reject; });
      const output = Promise.resolve().then(() => {
        assertRunning();
        return options.invoke(prompt, systemPrompt, maxTokens, (chunk) => {
          if (settled || active !== requestIndex || !options.isCurrent() || options.signal?.aborted) return;
          const size = new TextEncoder().encode(chunk).byteLength;
          bytes += size;
          taskOutputBytes += size;
          if (bytes > outputLimit) {
            options.abortCurrent();
            rejectOverflow(new Error("模型输出超过本次任务安全上限，原文未修改。"));
            return;
          }
          if (!limits.silent) options.onChunk?.(chunk);
        }, limits.outputSchema);
      });
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          options.abortCurrent();
          reject(new AiTaskDeadlineError());
        }, Math.max(0, duration));
      });
      const cancelled = new Promise<never>((_resolve, reject) => {
        if (!options.signal) return;
        const onAbort = () => { options.abortCurrent(); reject(new AiTaskCancelledError()); };
        options.signal.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => options.signal?.removeEventListener("abort", onAbort);
        if (options.signal.aborted) onAbort();
      });
      try {
        const result = await Promise.race([output, timeout, cancelled, overflow]);
        assertRunning();
        const resultBytes = new TextEncoder().encode(result).byteLength;
        taskOutputBytes += Math.max(0, resultBytes - bytes);
        if (resultBytes > outputLimit || taskOutputBytes > 2_097_152) {
          throw new Error("模型输出超过本次任务安全上限，原文未修改。");
        }
        return result;
      } finally {
        settled = true;
        if (active === requestIndex) active = 0;
        if (timer !== undefined) clearTimeout(timer);
        removeAbort();
      }
    }
  };
}
