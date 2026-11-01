import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  copyCapturedUint8ArrayV2,
  inspectCapturedUint8ArrayV2,
  maxFormatBytesV2,
} from "@pasteboard-pro/core";
import type {
  ContentPolicyScanRequestV2,
  ContentPolicyScanResultV2,
  ContentScanCheckV2,
} from "@pasteboard-pro/core";
import {
  ContentPolicyScanRequestV2Schema,
  ScanCodecV2Schema,
  ScanPolicyV2Schema,
  ScanScopeV2Schema,
  ScanWorkerTaskV2Schema,
  type ScanCodecV2,
  type ScanPolicyV2,
  type ScanScopeV2,
} from "./content-scanner-v2-contracts.js";
import {
  startContentScannerWorkerSessionV2,
  type ContentScannerSessionEventV2,
  type ContentScannerSessionOutcomeV2,
  type ContentScannerWorkerSessionV2,
} from "./content-scanner-worker-session.js";

const MAX_IN_FLIGHT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CONCURRENT = 1;
const ScanCodecListV2Schema = ScanCodecV2Schema.array().max(1024);

// `workerPath` must come from trusted preload setup; worker threads are not OS-process isolation.
export type BoundedContentScannerV2Options = Readonly<{
  workerPath: string;
  policy: ScanPolicyV2;
  codecs: readonly ScanCodecV2[];
  timeoutMs?: number;
  maxConcurrent?: number;
}>;

export type BoundedContentScannerV2 = Readonly<{
  scan(request: ContentPolicyScanRequestV2): Promise<ContentPolicyScanResultV2>;
  dispose(): Promise<void>;
  diagnostics(): Readonly<{
    started: number;
    active: number;
    completed: number;
    timeouts: number;
    terminated: number;
    protocolRejected: number;
    busy: number;
    lastOutcome: string | null;
  }>;
}>;

type ScannerOutcome = ContentScannerSessionOutcomeV2
  | "invalid-request"
  | "unsupported-kind"
  | "busy";

function invalidConfiguration(): never {
  throw new TypeError("Invalid content scanner configuration");
}

function freezePolicy(value: unknown): ScanPolicyV2 {
  let parsed: ReturnType<typeof ScanPolicyV2Schema.safeParse>;
  try {
    parsed = ScanPolicyV2Schema.safeParse(value);
  } catch {
    return invalidConfiguration();
  }
  if (!parsed.success) return invalidConfiguration();
  const contentRules = Object.freeze(parsed.data.contentRules.map((rule) =>
    Object.freeze(rule.type === "regex"
      ? { type: rule.type, value: rule.value, ...(rule.flags === undefined ? {} : { flags: rule.flags }) }
      : { type: rule.type, value: rule.value }),
  ));
  return Object.freeze({
    revision: parsed.data.revision,
    blockLikelySecrets: parsed.data.blockLikelySecrets,
    contentRules,
  });
}

function freezeCodecs(value: unknown): readonly ScanCodecV2[] {
  let parsed: ReturnType<typeof ScanCodecListV2Schema.safeParse>;
  try {
    parsed = ScanCodecListV2Schema.safeParse(value);
  } catch {
    return invalidConfiguration();
  }
  if (!parsed.success) return invalidConfiguration();
  const keys = new Set<string>();
  const codecs = parsed.data.map((codec) => {
    if (keys.has(codec.representationKey)) return invalidConfiguration();
    keys.add(codec.representationKey);
    return Object.freeze({
      representationKey: codec.representationKey,
      contentKind: codec.contentKind,
      ...(codec.richTextFormat === undefined ? {} : { richTextFormat: codec.richTextFormat }),
      ...(codec.htmlContainer === undefined ? {} : { htmlContainer: codec.htmlContainer }),
      ...(codec.encoding === undefined ? {} : { encoding: codec.encoding }),
      ...(codec.termination === undefined ? {} : { termination: codec.termination }),
    });
  });
  return Object.freeze(codecs);
}

function readFallbackScopes(value: unknown): readonly ScanScopeV2[] {
  try {
    if (typeof value !== "object" || value === null) return Object.freeze([]);
    const scopesField = Object.getOwnPropertyDescriptor(value, "requiredScopes");
    if (scopesField === undefined || !("value" in scopesField) || !Array.isArray(scopesField.value)) {
      return Object.freeze([]);
    }
    const lengthField = Object.getOwnPropertyDescriptor(scopesField.value, "length");
    const length = lengthField !== undefined && "value" in lengthField ? lengthField.value : 0;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 6) {
      return Object.freeze([]);
    }
    const scopes: ScanScopeV2[] = [];
    const seen = new Set<ScanScopeV2>();
    for (let index = 0; index < length; index += 1) {
      const entry = Object.getOwnPropertyDescriptor(scopesField.value, String(index));
      if (entry === undefined || !("value" in entry)) continue;
      const parsed = ScanScopeV2Schema.safeParse(entry.value);
      if (parsed.success && !seen.has(parsed.data)) {
        seen.add(parsed.data);
        scopes.push(parsed.data);
      }
    }
    return Object.freeze(scopes);
  } catch {
    return Object.freeze([]);
  }
}

function notScanned(scopes: readonly ScanScopeV2[]): ContentPolicyScanResultV2 {
  return Object.freeze(scopes.map((scope): ContentScanCheckV2 => Object.freeze({ scope, status: "not-scanned" })));
}

export function createBoundedContentScannerV2(options: BoundedContentScannerV2Options): BoundedContentScannerV2 {
  const configuration = (() => {
    try {
      if (typeof options !== "object" || options === null || typeof options.workerPath !== "string") {
        return invalidConfiguration();
      }
      const workerPath = options.workerPath;
      const policy = freezePolicy(options.policy);
      const codecs = freezeCodecs(options.codecs);
      const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
      const maxConcurrent = options.maxConcurrent === undefined ? DEFAULT_MAX_CONCURRENT : options.maxConcurrent;
      if (!isAbsolute(workerPath)) return invalidConfiguration();
      if (!Number.isInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 15_000) return invalidConfiguration();
      if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2) return invalidConfiguration();
      return { workerPath, policy, codecs, timeoutMs, maxConcurrent };
    } catch {
      return invalidConfiguration();
    }
  })();
  const { workerPath, policy, codecs, timeoutMs, maxConcurrent } = configuration;
  const codecByKey = new Map(codecs.map((codec) => [codec.representationKey, codec]));

  const sessions = new Map<ContentScannerWorkerSessionV2, number>();
  let closed = false;
  let disposePromise: Promise<void> | undefined;
  let started = 0;
  let completed = 0;
  let timeouts = 0;
  let terminated = 0;
  let protocolRejected = 0;
  let busy = 0;
  let leasedBytes = 0;
  let lastOutcome: ScannerOutcome | null = null;

  function completeImmediate(
    scopes: readonly ScanScopeV2[],
    outcome: ScannerOutcome,
  ): Promise<ContentPolicyScanResultV2> {
    completed += 1;
    lastOutcome = outcome;
    return Promise.resolve(notScanned(scopes));
  }

  function trackSession(
    session: ContentScannerWorkerSessionV2,
    byteLength: number,
  ): Promise<ContentPolicyScanResultV2> {
    sessions.set(session, byteLength);
    leasedBytes += byteLength;
    started += 1;
    void session.confirmed.then(() => {
      const lease = sessions.get(session);
      if (lease !== undefined) {
        sessions.delete(session);
        leasedBytes -= lease;
      }
    });
    return session.result.then(({ checks, outcome }) => {
      completed += 1;
      lastOutcome = outcome;
      return checks;
    });
  }

  function countSessionEvent(event: ContentScannerSessionEventV2): void {
    if (event === "timeout") timeouts += 1;
    else if (event === "terminated") terminated += 1;
    else if (event === "protocol-rejected") protocolRejected += 1;
  }

  function scan(request: ContentPolicyScanRequestV2): Promise<ContentPolicyScanResultV2> {
    const fallbackScopes = readFallbackScopes(request);
    if (closed) return completeImmediate(fallbackScopes, "disposed");

    let parsedRequest: ReturnType<typeof ContentPolicyScanRequestV2Schema.safeParse>;
    try {
      parsedRequest = ContentPolicyScanRequestV2Schema.safeParse(request);
    } catch {
      return completeImmediate(fallbackScopes, "invalid-request");
    }
    if (!parsedRequest.success) return completeImmediate(fallbackScopes, "invalid-request");
    const validated = parsedRequest.data;
    const scopes = Object.freeze([...validated.requiredScopes]);
    if (
      validated.policyRevision !== policy.revision ||
      codecByKey.get(validated.representationKey)?.contentKind !== validated.contentKind
    ) {
      return completeImmediate(scopes, "invalid-request");
    }

    const byteView = inspectCapturedUint8ArrayV2(validated.bytes);
    if (byteView === undefined || byteView.byteLength > maxFormatBytesV2(validated.contentKind)) {
      return completeImmediate(scopes, "invalid-request");
    }
    if (validated.contentKind !== "text" && validated.contentKind !== "url" && validated.contentKind !== "rich-text") {
      return completeImmediate(scopes, "unsupported-kind");
    }
    const codec = codecByKey.get(validated.representationKey);
    if (codec === undefined) return completeImmediate(scopes, "invalid-request");
    if (
      validated.contentKind === "rich-text" &&
      !((codec.richTextFormat === "rtf" && codec.encoding === undefined &&
         codec.termination === undefined && codec.htmlContainer === undefined) ||
        (codec.richTextFormat === "html" && codec.encoding !== undefined && codec.termination !== undefined &&
         (codec.htmlContainer !== "cf-html" ||
          (codec.encoding === "utf-8" && codec.termination === "none"))))
    ) {
      return completeImmediate(scopes, "unsupported-kind");
    }
    if (sessions.size >= maxConcurrent || leasedBytes + byteView.byteLength > MAX_IN_FLIGHT_BYTES) {
      busy += 1;
      return completeImmediate(scopes, "busy");
    }

    let ownedBytes: Uint8Array;
    let requestId: string;
    try {
      ownedBytes = copyCapturedUint8ArrayV2(byteView);
      requestId = randomUUID();
    } catch {
      return completeImmediate(scopes, "worker-failed");
    }
    const task = Object.freeze({
      schemaVersion: 1 as const,
      requestId,
      policy,
      codec,
      request: Object.freeze({
        policyRevision: validated.policyRevision,
        representationKey: validated.representationKey,
        itemIndex: validated.itemIndex,
        contentKind: validated.contentKind,
        requiredScopes: scopes,
        bytes: ownedBytes,
      }),
    });
    let validTask: ReturnType<typeof ScanWorkerTaskV2Schema.safeParse>;
    try {
      validTask = ScanWorkerTaskV2Schema.safeParse(task);
    } catch {
      return completeImmediate(scopes, "invalid-request");
    }
    if (!validTask.success) return completeImmediate(scopes, "invalid-request");

    try {
      const session = startContentScannerWorkerSessionV2({
        workerPath,
        task: validTask.data,
        timeoutMs,
        onEvent: countSessionEvent,
      });
      return trackSession(session, byteView.byteLength);
    } catch {
      return completeImmediate(scopes, "worker-failed");
    }
  }

  function dispose(): Promise<void> {
    if (disposePromise !== undefined) return disposePromise;
    closed = true;
    const active = [...sessions.keys()];
    active.forEach((session) => session.terminate("disposed"));
    disposePromise = Promise.all(active.map((session) => session.confirmed)).then(() => undefined);
    return disposePromise;
  }

  function diagnostics(): Readonly<{
    started: number;
    active: number;
    completed: number;
    timeouts: number;
    terminated: number;
    protocolRejected: number;
    busy: number;
    lastOutcome: string | null;
  }> {
    return Object.freeze({
      started,
      active: sessions.size,
      completed,
      timeouts,
      terminated,
      protocolRejected,
      busy,
      lastOutcome,
    });
  }

  return Object.freeze({ scan, dispose, diagnostics });
}
