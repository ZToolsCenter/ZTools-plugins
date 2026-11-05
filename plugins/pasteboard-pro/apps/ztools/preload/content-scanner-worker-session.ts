import { Buffer } from "node:buffer";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type {
  ContentPolicyScanResultV2,
  ContentScanCheckV2,
} from "@pasteboard-pro/core";
import {
  ScanWorkerResponseV2Schema,
  type ScanScopeV2,
  type ScanWorkerTaskV2,
} from "./content-scanner-v2-contracts.js";

const MAX_WORKER_OUTPUT_BYTES = 16 * 1024;
// V8 heap limits do not cap ArrayBuffer/native allocation or total process RSS.
const WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,
});

export type ContentScannerSessionOutcomeV2 =
  | "passed"
  | "blocked"
  | "not-scanned"
  | "timeout"
  | "output-limit"
  | "protocol-rejected"
  | "worker-failed"
  | "disposed";

export type ContentScannerSessionFailureV2 = Extract<
  ContentScannerSessionOutcomeV2,
  "timeout" | "output-limit" | "protocol-rejected" | "worker-failed" | "disposed"
>;

export type ContentScannerSessionEventV2 = "timeout" | "terminated" | "protocol-rejected";
export type ContentScannerWorkerSessionV2 = Readonly<{
  result: Promise<Readonly<{ checks: ContentPolicyScanResultV2; outcome: ContentScannerSessionOutcomeV2 }>>;
  confirmed: Promise<void>;
  terminate(outcome: ContentScannerSessionFailureV2): void;
}>;

export function startContentScannerWorkerSessionV2(options: Readonly<{
  workerPath: string;
  task: ScanWorkerTaskV2;
  timeoutMs: number;
  onEvent(event: ContentScannerSessionEventV2): void;
}>): ContentScannerWorkerSessionV2 {
  let worker: Worker;
  let resolveResult!: (result: Readonly<{
    checks: ContentPolicyScanResultV2;
    outcome: ContentScannerSessionOutcomeV2;
  }>) => void;
  let confirm!: () => void;
  const result = new Promise<Readonly<{
    checks: ContentPolicyScanResultV2;
    outcome: ContentScannerSessionOutcomeV2;
  }>>((resolve) => {
    resolveResult = resolve;
  });
  const confirmed = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  let candidate: ContentPolicyScanResultV2 | undefined;
  let failureOutcome: ContentScannerSessionFailureV2 | undefined;
  let outputBytes = 0;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let exitConfirmed = false;
  let exitCodeObserved = 1;
  let stdoutDone = false;
  let stderrDone = false;
  let terminationRequested = false;
  let settled = false;

  function notify(event: ContentScannerSessionEventV2): void {
    try {
      options.onEvent(event);
    } catch {
      // Telemetry callbacks cannot affect scan outcomes.
    }
  }

  function settle(checks: ContentPolicyScanResultV2, outcome: ContentScannerSessionOutcomeV2): void {
    if (settled) return;
    settled = true;
    resolveResult(Object.freeze({ checks, outcome }));
  }

  function notScanned(scopes: readonly ScanScopeV2[]): ContentPolicyScanResultV2 {
    return Object.freeze(scopes.map((scope): ContentScanCheckV2 => Object.freeze({ scope, status: "not-scanned" })));
  }

  function finalizeExit(): void {
    if (!exitConfirmed || !stdoutDone || !stderrDone || settled) return;
    confirm();
    if (failureOutcome !== undefined) {
      settle(notScanned(options.task.request.requiredScopes), failureOutcome);
    } else if ((exitCodeObserved === 0 || terminationRequested) && candidate !== undefined) {
      const blocked = candidate.some((check) => check.status === "blocked");
      const passed = candidate.length > 0 && candidate.every((check) => check.status === "passed");
      settle(candidate, blocked ? "blocked" : passed ? "passed" : "not-scanned");
    } else {
      settle(notScanned(options.task.request.requiredScopes), "worker-failed");
    }
  }

  function confirmExit(exitCode: number): void {
    if (exitConfirmed) return;
    exitConfirmed = true;
    exitCodeObserved = exitCode;
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (terminationRequested) notify("terminated");
    // Readable data may be queued after Worker exit. Wait for both streams so a
    // late output-limit failure cannot arrive after an accepted result.
    finalizeExit();
  }

  function requestTermination(outcome?: ContentScannerSessionFailureV2): void {
    if (failureOutcome === undefined && outcome !== undefined) failureOutcome = outcome;
    if (exitConfirmed) { finalizeExit(); return; }
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
    if (terminationRequested) return;
    terminationRequested = true;
    // Failure to confirm termination never yields a terminal scan result or a
    // released lease. The owning host must handle an unresponsive runtime.
    try {
      void worker.terminate().then(
        (exitCode) => confirmExit(exitCode),
        () => {
          // Keep the caller's active lease until an exit event confirms termination.
        },
      );
    } catch {
      // Keep the caller's active lease until an exit event confirms termination.
    }
  }

  function terminate(outcome: ContentScannerSessionFailureV2): void {
    requestTermination(outcome);
  }

  function rejectProtocol(): void {
    if (failureOutcome !== undefined || exitConfirmed) return;
    notify("protocol-rejected");
    terminate("protocol-rejected");
  }

  function boundedResponse(value: unknown): boolean {
    // Receiver-side bounds only: Node structured-clones before this callback.
    // This API requires a trusted bundled worker; it is not pre-clone/RSS isolation.
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 5 || keys.some((key) => !["schemaVersion", "requestId", "policyRevision", "representationKey", "checks"].includes(key))) return false;
    let bytes = 64;
    for (const [key, limit] of [["requestId", 128], ["policyRevision", 512], ["representationKey", 128]] as const) {
      const field = Object.getOwnPropertyDescriptor(record, key);
      if (!field || !("value" in field) || typeof field.value !== "string" || field.value.length > limit) return false;
      bytes += Buffer.byteLength(field.value);
    }
    const checks = record.checks;
    if (record.schemaVersion !== 1 || !Array.isArray(checks) || checks.length > 6) return false;
    for (const row of checks) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 2) return false;
      for (const [key, limit] of [["scope", 32], ["status", 16]] as const) {
        const field = Object.getOwnPropertyDescriptor(row, key);
        if (!field || !("value" in field) || typeof field.value !== "string" || field.value.length > limit) return false;
        bytes += Buffer.byteLength(field.value);
      }
    }
    return bytes <= MAX_WORKER_OUTPUT_BYTES;
  }

  function acceptMessage(value: unknown): void {
    if (failureOutcome !== undefined || exitConfirmed) return;
    if (candidate !== undefined) {
      rejectProtocol();
      return;
    }
    let parsed: ReturnType<typeof ScanWorkerResponseV2Schema.safeParse>;
    try {
      if (!boundedResponse(value)) { rejectProtocol(); return; }
      parsed = ScanWorkerResponseV2Schema.safeParse(value);
    } catch {
      rejectProtocol();
      return;
    }
    if (!parsed.success) {
      rejectProtocol();
      return;
    }
    const response = parsed.data;
    const requestedScopes = options.task.request.requiredScopes;
    if (
      response.requestId !== options.task.requestId ||
      response.policyRevision !== options.task.request.policyRevision ||
      response.representationKey !== options.task.request.representationKey ||
      response.checks.length !== requestedScopes.length ||
      response.checks.some((check, index) => check.scope !== requestedScopes[index])
    ) {
      rejectProtocol();
      return;
    }
    candidate = Object.freeze(response.checks.map((check) =>
      Object.freeze({ scope: check.scope, status: check.status }),
    ));
    // A valid response does not prove the thread has stopped. Reap the one-shot
    // worker before exposing its checks or returning its capacity to the caller.
    requestTermination();
  }

  function countOutput(chunk: unknown): void {
    if (failureOutcome !== undefined || settled) return;
    let chunkBytes: number;
    if (typeof chunk === "string") chunkBytes = Buffer.byteLength(chunk);
    else if (Buffer.isBuffer(chunk)) chunkBytes = chunk.byteLength;
    else {
      terminate("worker-failed");
      return;
    }
    outputBytes += chunkBytes;
    if (outputBytes > MAX_WORKER_OUTPUT_BYTES) terminate("output-limit");
  }

  const workerOptions: WorkerOptions = {
    workerData: options.task,
    transferList: [options.task.request.bytes.buffer],
    resourceLimits: WORKER_RESOURCE_LIMITS,
    stdout: true,
    stderr: true,
  };
  timeoutTimer = setTimeout(() => {
    if (!exitConfirmed && failureOutcome === undefined) {
      notify("timeout");
      terminate("timeout");
    }
  }, options.timeoutMs);
  try {
    worker = new Worker(options.workerPath, workerOptions);
  } catch {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    throw new Error();
  }

  worker.on("message", (message: unknown) => acceptMessage(message));
  worker.on("messageerror", rejectProtocol);
  worker.on("error", () => terminate("worker-failed"));
  worker.on("exit", (code) => confirmExit(code));
  worker.stdout?.on("data", countOutput);
  worker.stderr?.on("data", countOutput);
  worker.stdout?.on("error", () => terminate("worker-failed"));
  worker.stderr?.on("error", () => terminate("worker-failed"));
  const stdoutFinished = () => { stdoutDone = true; finalizeExit(); };
  const stderrFinished = () => { stderrDone = true; finalizeExit(); };
  if (worker.stdout) {
    worker.stdout.on("end", stdoutFinished);
    worker.stdout.on("close", stdoutFinished);
  } else stdoutDone = true;
  if (worker.stderr) {
    worker.stderr.on("end", stderrFinished);
    worker.stderr.on("close", stderrFinished);
  } else stderrDone = true;

  return Object.freeze({ result, confirmed, terminate });
}
