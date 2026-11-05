import { types } from "node:util";

export const FOUNDATION_CASE_IDS = Object.freeze([
  "private-root-created",
  "root-owner-dacl-verified",
  "private-file-created",
  "file-owner-dacl-verified",
  "file-identity-stable",
  "file-flush-write-handle",
  "mismatched-identity-rejected",
  "null-dacl-rejected",
  "empty-dacl-rejected",
  "additional-principal-rejected",
  "file-kind-mismatch-rejected",
  "reparse-object-rejected",
  "hardlink-object-rejected",
  "directory-flush-call-observed",
  "owned-fixture-cleanup",
]);

const POSITIVE_CASES = new Set([
  "private-root-created", "root-owner-dacl-verified", "private-file-created",
  "file-owner-dacl-verified", "file-identity-stable", "file-flush-write-handle",
  "owned-fixture-cleanup",
]);
const NEGATIVE_CASES = new Set(FOUNDATION_CASE_IDS.filter(id =>
  !POSITIVE_CASES.has(id) && id !== "directory-flush-call-observed"));
const FAILURE_REASONS = new Set([
  "unexpected-success", "invalid-request", "token-unavailable",
  "unsupported-security-context", "create-failed", "inspection-failed",
  "acl-rejected", "type-rejected", "reparse-rejected", "hardlink-rejected",
  "identity-mismatch", "file-flush-failed", "close-failed",
  "cleanup-incomplete", "cleanup-failed",
]);
const FIXED_FIELDS = Object.freeze({
  schemaVersion: 1,
  probe: "windows-storage-foundation",
  isolation: "owned-temporary-directory",
  namespaceDurability: "NOT-VERIFIED",
  productionStorageEnabled: false,
  gateComplete: false,
});
const REPORT_KEYS = Object.freeze([
  "schemaVersion", "probe", "execution", "isolation", "namespaceDurability",
  "productionStorageEnabled", "gateComplete", "directoryFlushCall", "cases",
]);
const CASE_KEYS = Object.freeze(["id", "status", "reason"]);
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const MAX_REPORT_BYTES = 16 * 1024;

function fail() {
  throw new TypeError("Invalid Windows storage probe report");
}

function isProxy(value) {
  try {
    return types.isProxy(value);
  } catch {
    fail();
  }
}

function ownDataObject(value, keys) {
  if (isProxy(value)) fail();
  let array;
  try {
    array = Array.isArray(value);
  } catch {
    fail();
  }
  if (value === null || typeof value !== "object" || array) fail();
  let prototype;
  let ownKeys;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch {
    fail();
  }
  if (prototype !== Object.prototype && prototype !== null) fail();
  if (ownKeys.length !== keys.length ||
      ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) fail();

  const values = Object.create(null);
  try {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail();
      values[key] = descriptor.value;
    }
  } catch {
    fail();
  }
  return values;
}

function exactArray(value, length) {
  if (isProxy(value)) fail();
  let array;
  try {
    array = Array.isArray(value);
  } catch {
    fail();
  }
  if (!array) fail();
  let prototype;
  let ownKeys;
  let lengthDescriptor;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    fail();
  }
  if (prototype !== Array.prototype || !lengthDescriptor ||
      !Object.hasOwn(lengthDescriptor, "value") || lengthDescriptor.value !== length ||
      ownKeys.length !== length + 1 ||
      !ownKeys.includes("length")) fail();
  const result = [];
  try {
    for (let index = 0; index < length; index += 1) {
      if (!ownKeys.includes(String(index))) fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail();
      result.push(descriptor.value);
    }
  } catch {
    fail();
  }
  return result;
}

function expectedExecution(cases) {
  if (cases.every(item => item.status === "PASS")) return "PASS";
  if (cases.every(item => item.status === "NOT-RUN")) return "NOT-RUN";
  return "FAIL";
}

export function validateStorageProbeReport(value) {
  const report = ownDataObject(value, REPORT_KEYS);
  for (const [key, expected] of Object.entries(FIXED_FIELDS)) {
    if (report[key] !== expected) fail();
  }
  if (!["PASS", "FAIL", "NOT-RUN"].includes(report.execution) ||
      !["not-run", "api-success", "api-rejected"].includes(report.directoryFlushCall)) fail();

  const rawCases = exactArray(report.cases, FOUNDATION_CASE_IDS.length);
  const cases = rawCases.map((item, index) => {
    const normalized = ownDataObject(item, CASE_KEYS);
    const id = FOUNDATION_CASE_IDS[index];
    if (normalized.id !== id || !["PASS", "FAIL", "NOT-RUN"].includes(normalized.status) ||
        typeof normalized.reason !== "string") fail();

    if (normalized.status === "PASS") {
      const allowed = id === "directory-flush-call-observed"
        ? normalized.reason === "api-observed"
        : POSITIVE_CASES.has(id)
          ? normalized.reason === "ok"
          : NEGATIVE_CASES.has(id) && normalized.reason === "expected-rejection";
      if (!allowed) fail();
    } else if (normalized.status === "NOT-RUN") {
      if (normalized.reason !== "prerequisite-unavailable") fail();
    } else if (!FAILURE_REASONS.has(normalized.reason)) {
      fail();
    }
    return { id, status: normalized.status, reason: normalized.reason };
  });

  const directoryCase = cases.find(item => item.id === "directory-flush-call-observed");
  if (directoryCase.status === "PASS") {
    if (!["api-success", "api-rejected"].includes(report.directoryFlushCall)) fail();
  } else if (report.directoryFlushCall !== "not-run") {
    fail();
  }
  if (report.execution !== expectedExecution(cases)) fail();

  return {
    schemaVersion: FIXED_FIELDS.schemaVersion,
    probe: FIXED_FIELDS.probe,
    execution: report.execution,
    isolation: FIXED_FIELDS.isolation,
    namespaceDurability: FIXED_FIELDS.namespaceDurability,
    productionStorageEnabled: FIXED_FIELDS.productionStorageEnabled,
    gateComplete: FIXED_FIELDS.gateComplete,
    directoryFlushCall: report.directoryFlushCall,
    cases,
  };
}

export function parseStorageProbeReport(input) {
  let raw;
  try {
    if (isProxy(input)) fail();
    if (typeof input === "string") {
      raw = input;
    } else if (input instanceof Uint8Array) {
      if (input.byteLength > MAX_REPORT_BYTES) fail();
      if (input.byteLength >= 3 &&
          input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) fail();
      raw = UTF8.decode(input);
    } else {
      fail();
    }
  } catch {
    fail();
  }
  if (raw.length === 0 || raw.length > MAX_REPORT_BYTES ||
      [...raw].some(character => character.codePointAt(0) > 0x7f) ||
      !raw.endsWith("\n") || raw.endsWith("\n\n")) fail();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail();
  }
  const normalized = validateStorageProbeReport(parsed);
  if (JSON.stringify(normalized) + "\n" !== raw) fail();
  return normalized;
}

export function describeStorageProbeReport() {
  return {
    schemaVersion: FIXED_FIELDS.schemaVersion,
    probe: FIXED_FIELDS.probe,
    execution: "NOT-RUN",
    isolation: FIXED_FIELDS.isolation,
    namespaceDurability: FIXED_FIELDS.namespaceDurability,
    productionStorageEnabled: FIXED_FIELDS.productionStorageEnabled,
    gateComplete: FIXED_FIELDS.gateComplete,
    directoryFlushCall: "not-run",
    cases: FOUNDATION_CASE_IDS.map(id => ({
      id,
      status: "NOT-RUN",
      reason: "prerequisite-unavailable",
    })),
  };
}
