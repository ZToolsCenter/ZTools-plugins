import { parentPort, workerData } from "node:worker_threads";
import {
  ScanWorkerResponseV2Schema,
  ScanWorkerTaskV2Schema,
  type ScanScopeV2,
  type ScanWorkerResponseV2,
  type ScanWorkerTaskV2,
} from "./content-scanner-v2-contracts";
import { compileScanPolicyV2 } from "./content-scan-rules";
import { projectHtmlPrivacyV2, projectUrlTextV2 } from "./content-html-projector";
import { projectCfHtmlPrivacyV2 } from "./content-cf-html-projector";
import { projectRtfPrivacyV2 } from "./content-rtf-projector";

type ScanStatusV2 = "passed" | "blocked" | "not-scanned";
type ScanPlanV2 = Readonly<{ scopes: readonly ScanScopeV2[] }>;

// This caps the decoded Unicode scalar count at 10 MiB. UTF-8 is conservatively
// limited to 10 MiB of bytes; UTF-16 is limited to 20 MiB of bytes. These byte
// ceilings ensure the decoder cannot allocate an unbounded string before the
// scalar-count check, while allowing up to 10 Mi scalars in single-unit text.
const MAX_DECODED_CHARACTERS = 10 * 1024 * 1024;
const MAX_UTF8_BYTES = MAX_DECODED_CHARACTERS;
const MAX_UTF16_BYTES = MAX_DECODED_CHARACTERS * 2;

function allNotScanned(task: ScanWorkerTaskV2): ScanWorkerResponseV2 {
  return {
    schemaVersion: 1,
    requestId: task.requestId,
    policyRevision: task.policy.revision,
    representationKey: task.codec.representationKey,
    checks: task.request.requiredScopes.map((scope) => ({
      scope,
      status: "not-scanned",
    })),
  };
}

function bindingsMatch(task: ScanWorkerTaskV2): boolean {
  return (
    task.schemaVersion === 1 &&
    task.request.policyRevision === task.policy.revision &&
    task.request.representationKey === task.codec.representationKey &&
    task.request.contentKind === task.codec.contentKind
  );
}

function makeScanPlan(task: ScanWorkerTaskV2): ScanPlanV2 | undefined {
  const scopes = task.request.requiredScopes;
  if (task.codec.contentKind === "text") {
    if (scopes.length !== 1 || scopes[0] !== "text") return undefined;
    return { scopes };
  }
  if (task.codec.contentKind === "url") {
    if (
      scopes.length !== 2 ||
      !scopes.includes("text") ||
      !scopes.includes("links")
    ) {
      return undefined;
    }
    return { scopes };
  }
  if (task.codec.contentKind === "rich-text") {
    if (
      (task.codec.richTextFormat !== "html" && task.codec.richTextFormat !== "rtf") ||
      (task.codec.richTextFormat === "html" &&
       (task.codec.encoding === undefined || task.codec.termination === undefined)) ||
      scopes.length !== 2 ||
      scopes[0] !== "text" ||
      scopes[1] !== "links"
    ) return undefined;
    return { scopes };
  }
  return undefined;
}

function isTerminator(bytes: Uint8Array, encoding: string): boolean {
  if (encoding === "utf-8") return bytes.length > 0 && bytes[bytes.length - 1] === 0;
  return (
    bytes.length >= 2 &&
    bytes[bytes.length - 1] === 0 &&
    bytes[bytes.length - 2] === 0
  );
}

function hasInteriorNul(text: string): boolean {
  return text.includes("\u0000");
}

function scalarCountWithinLimit(value: string): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > MAX_DECODED_CHARACTERS) return false;
  }
  return true;
}

function decodeTrustedText(task: ScanWorkerTaskV2): string | undefined {
  const { bytes } = task.request;
  const encoding = task.codec.encoding;
  if (encoding === undefined) return undefined;
  if (encoding !== "utf-8" && encoding !== "utf-16le" && encoding !== "utf-16be") {
    return undefined;
  }

  const termination = task.codec.termination ?? "none";
  if (termination !== "none" && termination !== "nul") return undefined;
  if (encoding !== "utf-8" && bytes.byteLength % 2 !== 0) return undefined;

  const terminatorBytes = encoding === "utf-8" ? 1 : 2;
  const maximumBytes =
    (encoding === "utf-8" ? MAX_UTF8_BYTES : MAX_UTF16_BYTES) +
    (termination === "nul" ? terminatorBytes : 0);
  if (bytes.byteLength > maximumBytes) return undefined;

  let projectedBytes: Uint8Array = bytes;
  if (termination === "nul") {
    if (bytes.byteLength < terminatorBytes || !isTerminator(bytes, encoding)) {
      return undefined;
    }
    // Strip only the final, codec-sized NUL unit. Any earlier NUL is rejected
    // after fatal decoding below, including multiple terminal NUL units.
    projectedBytes = bytes.subarray(0, bytes.byteLength - terminatorBytes);
  }

  let decoded: string;
  try {
    decoded = new TextDecoder(encoding, { fatal: true }).decode(projectedBytes);
  } catch {
    return undefined;
  }
  if (hasInteriorNul(decoded) || !scalarCountWithinLimit(decoded)) return undefined;
  return decoded;
}

function scanValidatedTask(task: ScanWorkerTaskV2): ScanWorkerResponseV2 {
  if (!bindingsMatch(task)) return allNotScanned(task);

  const plan = makeScanPlan(task);
  if (plan === undefined) return allNotScanned(task);

  const policy = compileScanPolicyV2(task.policy);
  if (policy === undefined) return allNotScanned(task);

  const statusByScope = new Map<ScanScopeV2, ScanStatusV2>();
  if (task.codec.contentKind === "rich-text" && task.codec.richTextFormat === "rtf") {
    if (task.request.bytes.byteLength > MAX_UTF8_BYTES) return allNotScanned(task);
    // This searchable byte view is supplementary; only the RTF parser's explicit
    // document/font code pages and Unicode semantics can establish completeness.
    const rawMatched = policy.matches(new TextDecoder("windows-1252").decode(task.request.bytes));
    let projection: ReturnType<typeof projectRtfPrivacyV2> | undefined;
    try { projection = projectRtfPrivacyV2(task.request.bytes); } catch { /* Raw matches still block. */ }
    const matched = rawMatched ||
      (projection?.textValues.some((value) => policy.matches(value)) ?? false) ||
      (projection?.linkValues.some((value) => policy.matches(value)) ?? false);
    return {
      schemaVersion: 1, requestId: task.requestId, policyRevision: task.policy.revision,
      representationKey: task.codec.representationKey,
      checks: plan.scopes.map((scope) => ({ scope, status: matched ? "blocked" :
        (scope === "text" ? projection?.textComplete : projection?.linksComplete) ? "passed" : "not-scanned" })),
    };
  }
  if (task.codec.contentKind === "rich-text" && task.codec.htmlContainer === "cf-html") {
    let projection: ReturnType<typeof projectCfHtmlPrivacyV2> | undefined;
    let rawMatched = false;
    try {
      // Lossy decoding preserves searchable valid runs around malformed bytes;
      // strict structural/UTF-8 validation below still controls all pass states.
      const rawText = new TextDecoder("utf-8").decode(task.request.bytes);
      rawMatched = policy.matches(rawText);
    } catch {
      // A raw match cannot be established from an unsupported byte view.
    }
    try {
      projection = projectCfHtmlPrivacyV2(task.request.bytes);
    } catch {
      // Known raw/header matches above still block; malformed structure stays unavailable.
    }

    const headerMatched = projection?.headerValueProjections.some((value) => policy.matches(value)) ?? false;
    const htmlProjection = projection?.htmlProjection;
    const htmlTextMatched = htmlProjection !== undefined &&
      (policy.matches(htmlProjection.decodedSource) || htmlProjection.textValues.some((value) => policy.matches(value)));
    const htmlLinksMatched = htmlProjection?.linkValues.some((value) => policy.matches(value)) ?? false;
    const matched = rawMatched || headerMatched || htmlTextMatched || htmlLinksMatched;
    statusByScope.set("text", matched ? "blocked" : projection?.textComplete ? "passed" : "not-scanned");
    statusByScope.set("links", matched ? "blocked" : projection?.linksComplete ? "passed" : "not-scanned");
    return {
      schemaVersion: 1,
      requestId: task.requestId,
      policyRevision: task.policy.revision,
      representationKey: task.codec.representationKey,
      checks: plan.scopes.map((scope) => ({
        scope,
        status: statusByScope.get(scope) ?? "not-scanned",
      })),
    };
  }

  const text = decodeTrustedText(task);
  if (text === undefined) return allNotScanned(task);
  const rawMatched = policy.matches(text);
  if (task.codec.contentKind === "rich-text") {
    let projection: ReturnType<typeof projectHtmlPrivacyV2> | undefined;
    try {
      const terminatorBytes = task.codec.termination === "nul"
        ? task.codec.encoding === "utf-8" ? 1 : 2
        : 0;
      projection = projectHtmlPrivacyV2(text, task.request.bytes.byteLength - terminatorBytes);
    } catch {
      // Raw source matches remain blocking even if static projection fails.
    }
    const decodedSourceMatched = projection !== undefined && policy.matches(projection.decodedSource);
    const staticMatched = projection?.textValues.some((value) => policy.matches(value)) ?? false;
    const linksMatched = projection?.linkValues.some((value) => policy.matches(value)) ?? false;
    const rawOrStaticMatched = rawMatched || decodedSourceMatched || staticMatched;
    statusByScope.set(
      "text",
      rawOrStaticMatched ? "blocked" : projection?.textComplete ? "passed" : "not-scanned",
    );
    statusByScope.set(
      "links",
      rawOrStaticMatched || linksMatched
        ? "blocked"
        : projection?.linksComplete
          ? "passed"
          : "not-scanned",
    );
    return {
      schemaVersion: 1,
      requestId: task.requestId,
      policyRevision: task.policy.revision,
      representationKey: task.codec.representationKey,
      checks: plan.scopes.map((scope) => ({
        scope,
        status: statusByScope.get(scope) ?? "not-scanned",
      })),
    };
  }

  if (task.codec.contentKind === "text") {
    statusByScope.set("text", rawMatched ? "blocked" : "passed");
  } else {
    // The raw URL string is inspected by both the text and links scopes.
    statusByScope.set("text", rawMatched ? "blocked" : "passed");
    const projection = projectUrlTextV2(text);
    const decodedMatched = projection.values.some((value) => policy.matches(value));
    statusByScope.set(
      "links",
      rawMatched || decodedMatched
        ? "blocked"
        : projection.complete
          ? "passed"
          : "not-scanned",
    );
  }

  return {
    schemaVersion: 1,
    requestId: task.requestId,
    policyRevision: task.policy.revision,
    representationKey: task.codec.representationKey,
    checks: plan.scopes.map((scope) => ({
      scope,
      status: statusByScope.get(scope) ?? "not-scanned",
    })),
  };
}

function responseForWorkerData(rawTask: unknown): ScanWorkerResponseV2 | undefined {
  const parsedTask = ScanWorkerTaskV2Schema.safeParse(rawTask);
  if (!parsedTask.success) return undefined;

  let response: ScanWorkerResponseV2;
  try {
    response = scanValidatedTask(parsedTask.data);
  } catch {
    // Validated bindings allow a fixed safe unavailable response. No exception
    // details or content-derived diagnostics cross the worker boundary.
    response = allNotScanned(parsedTask.data);
  }

  const parsedResponse = ScanWorkerResponseV2Schema.safeParse(response);
  return parsedResponse.success ? parsedResponse.data : undefined;
}

// This module is an entrypoint exclusively for worker_threads. Importing it on
// the main thread performs no task-data read, scan, post, or diagnostic output.
if (parentPort !== null) {
  const response = responseForWorkerData(workerData);
  if (response !== undefined) {
    try {
      parentPort.postMessage(response);
    } catch {
      // Closing without a message is the safe outcome if the structured clone
      // or parent connection fails.
    }
  }
  parentPort.close();
}
