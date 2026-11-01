import { requiredProbeCases } from "./clipboard-format-g0-cases.mjs";
import { validateWindowsFormatReceipts } from "./clipboard-format-g0-windows-receipts.mjs";

const scopes = { darwin: "isolated-named-pasteboard", win32: "isolated-window-station" };
const statuses = new Set(["pass", "fail", "not-run"]);
const detailCodes = new Set(["case-passed", "case-failed", "case-not-run"]);
const unverifiedCodes = new Set([
  "general-clipboard-monitoring", "delayed-source-rendering", "target-application-paste",
  "signed-host-integration", "os-atomic-commit", "windows-version-matrix",
  "CF_DIB", "CF_DIBV5", "CF_BITMAP", "CF_HDROP", "CF_TEXT", "CF_OEMTEXT", "CF_LOCALE",
  "metafile-palette", "other-registered-formats", "cross-platform-sync", "privacy-policy-integration",
  "jpeg-tiff-codecs", "file-reference-codecs", "url-color-codecs", "table-application-fidelity",
  "native-read-timeout", "partial-write-fault-injection", "rss-watchdog",
  "legacy-nsfilenames-file-lists", "legacy-color-pasteboard", "legacy-color-pasteboard-codec",
  "file-operation-cut-move-semantics", "image-decode-stress-fixtures", "image-decoder-stress",
]);
const formats = new Set(["public.utf8-plain-text", "public.utf16-external-plain-text", "public.html", "public.rtf", "public.png",
  "public.jpeg", "public.tiff", "public.url", "public.file-url",
  "public.utf8-tab-separated-values-text", "com.apple.cocoa.pasteboard.color"]);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const shortString = (value, max = 512) => typeof value === "string" && value.length > 0 && value.length <= max;
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function strict(value, keys) {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new TypeError("Probe metadata contains undeclared fields");
  }
}
function analysis(value) {
  strict(value, ["encodingCheck", "byteOrder", "byteOrderMark", "nullTerminated", "rejected"]);
  if ((value.encodingCheck !== undefined && !["decoded-text-matches", "canonical-unicode-equivalent"].includes(value.encodingCheck)) ||
      (value.byteOrder !== undefined && !["little-endian", "big-endian"].includes(value.byteOrder)) ||
      ["byteOrderMark", "nullTerminated", "rejected"].some(key => value[key] !== undefined && typeof value[key] !== "boolean")) {
    throw new TypeError("Invalid encoding evidence");
  }
}
function representation(value) {
  strict(value, ["nativeName", "byteLength", "sha256", "fidelity", "derivedFrom", "encodingCheck",
    "byteOrder", "byteOrderMark", "nullTerminated", "itemIndex", "analysis", "formatKind", "codec"]);
  if (!formats.has(value.nativeName) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 ||
      value.byteLength > 200 * 1024 * 1024 || !hash(value.sha256) ||
      (value.fidelity !== undefined && !["exact", "compatible", "reference"].includes(value.fidelity)) ||
      (value.derivedFrom !== undefined && !formats.has(value.derivedFrom)) ||
      (value.itemIndex !== undefined && (!Number.isInteger(value.itemIndex) || value.itemIndex < 0 || value.itemIndex >= 32))) {
    throw new TypeError("Invalid format byte evidence");
  }
  if ((value.formatKind !== undefined && !["image", "url", "file-reference", "tabular-text", "color"].includes(value.formatKind)) ||
      (value.codec !== undefined && !["imageio-jpeg", "imageio-tiff", "url-utf8", "file-url-utf8", "utf8-tsv", "nscolor-secure-archive"].includes(value.codec))) {
    throw new TypeError("Invalid declared format codec metadata");
  }
  analysis(Object.fromEntries(["encodingCheck", "byteOrder", "byteOrderMark", "nullTerminated"].filter(key => value[key] !== undefined).map(key => [key, value[key]])));
  if (value.analysis !== undefined) analysis(value.analysis);
}
function array(value, limit) { if (!Array.isArray(value) || value.length > limit) throw new TypeError("Unbounded probe metadata"); }
function summary(value) {
  strict(value, ["planned", "captured", "compatibleAliases", "codecFixtures"]);
  for (const key of ["planned", "captured"]) {
    array(value[key], 32);
    for (const item of value[key]) {
      strict(item, ["itemIndex", "representations"]);
      if (!Number.isInteger(item.itemIndex) || item.itemIndex < 0 || item.itemIndex >= 32) throw new TypeError("Invalid item index");
      array(item.representations, 32);
      item.representations.forEach(representation);
    }
  }
  for (const key of ["compatibleAliases", "codecFixtures"]) {
    array(value[key], 128);
    value[key].forEach(representation);
  }
}

export function validateProbeReport(value, expectedPlatform) {
  strict(value, ["schemaVersion", "platform", "scope", "success", "cases", "environment", "unverified", "formatSummary", "windowsFormatReceipts"]);
  if (value.schemaVersion !== 1 || value.platform !== expectedPlatform ||
      scopes[expectedPlatform] === undefined || value.scope !== scopes[expectedPlatform]) {
    throw new TypeError("Probe version, platform or isolation scope is invalid");
  }
  strict(value.environment, ["osVersion", "architecture", "codePage"]);
  if (expectedPlatform === "win32"
    ? !Number.isInteger(value.environment.codePage) || value.environment.codePage <= 0 || value.environment.codePage > 65535
    : value.environment.codePage !== undefined) {
    throw new TypeError("Windows reports require an explicit valid ACP; other platforms cannot claim one");
  }
  if (typeof value.success !== "boolean" || !Array.isArray(value.cases) ||
      value.cases.length === 0 || value.cases.length > 128 ||
      !shortString(value.environment.osVersion) || !shortString(value.environment.architecture, 40) ||
      !Array.isArray(value.unverified) || value.unverified.length === 0 || value.unverified.length > 40 ||
      value.unverified.some(item => !unverifiedCodes.has(item))) {
    throw new TypeError("Probe result is missing bounded cases, environment or unverified scope");
  }
  const ids = new Set();
  for (const item of value.cases) {
    strict(item, ["id", "status", "detailCode"]);
    if (!shortString(item.id, 120) || !/^[a-zA-Z0-9_.:-]+$/u.test(item.id) || ids.has(item.id) ||
        !statuses.has(item.status) || (item.detailCode !== undefined && !detailCodes.has(item.detailCode))) {
      throw new TypeError("Probe case identity, status or detail code is invalid");
    }
    if (item.detailCode !== undefined && item.detailCode !== { pass: "case-passed", fail: "case-failed", "not-run": "case-not-run" }[item.status]) {
      throw new TypeError("Probe detail code contradicts its status");
    }
    ids.add(item.id);
  }
  const requiredIds = requiredProbeCases[expectedPlatform];
  if (value.success && (ids.size !== requiredIds.length || requiredIds.some(id => !ids.has(id)))) {
    throw new TypeError("Probe success requires the complete frozen platform case set");
  }
  if (value.success !== value.cases.every(item => item.status === "pass")) {
    throw new TypeError("Probe success requires every declared case to pass");
  }
  if (expectedPlatform !== "win32" && Object.hasOwn(value, "windowsFormatReceipts")) {
    throw new TypeError("Windows format receipts are only valid in Windows reports");
  }
  if (expectedPlatform === "win32") {
    if (Object.hasOwn(value, "formatSummary")) {
      throw new TypeError("Apple format summaries are not valid in Windows reports");
    }
    if (value.success && !Object.hasOwn(value, "windowsFormatReceipts")) {
      throw new TypeError("Successful Windows reports require format receipt metadata");
    }
    validateWindowsFormatReceipts(Object.hasOwn(value, "windowsFormatReceipts") ? value.windowsFormatReceipts : [], {
      success: value.success,
      cases: value.cases,
      codePage: value.environment.codePage,
    });
  }
  if (value.formatSummary !== undefined) summary(value.formatSummary);
  return value;
}

export function createG0Receipt({ platform, architecture, execution, sourceHashes, commands,
  nativeReport, binarySha256, runtime, errorCode }) {
  if (!["PASS", "FAIL", "NOT-RUN"].includes(execution)) throw new TypeError("Invalid execution state");
  if (execution === "PASS") {
    if (!record(runtime) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(runtime.node ?? "") ||
        !(runtime.electron === null || /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(runtime.electron ?? ""))) {
      throw new TypeError("A passing receipt requires a valid runtime fingerprint");
    }
    if (!record(sourceHashes) || Object.keys(sourceHashes).length === 0 ||
        !Object.keys(sourceHashes).some(key => key.startsWith("native/clipboard-format/")) ||
        !Object.keys(sourceHashes).some(key => key.startsWith("scripts/")) ||
        Object.entries(sourceHashes).some(([key, value]) => key.includes("..") || key.startsWith("/") || !hash(value))) {
      throw new TypeError("A passing receipt requires native and runner source hashes");
    }
    if (!Array.isArray(commands) || commands.length < 2 ||
        commands.some(entry => !record(entry) || !shortString(entry.command, 4096) ||
          !Array.isArray(entry.args) || entry.args.length === 0 || entry.args.some(arg => typeof arg !== "string") ||
          !Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0 || entry.timeoutMs > 60_000) ||
        commands.at(-1).args.length !== 1 || commands.at(-1).args[0] !== "--self-test") {
      throw new TypeError("A passing receipt requires build and self-test commands");
    }
    const resource = commands.at(-1).resources;
    if (!record(resource) || resource.terminationConfirmed !== true || resource.stdinReleased !== true ||
        !Number.isSafeInteger(resource.memoryLimitBytes) || resource.memoryLimitBytes <= 0 ||
        !Number.isSafeInteger(resource.memorySamples) || resource.memorySamples < 1 ||
        !Number.isSafeInteger(resource.peakRssBytes) || resource.peakRssBytes <= 0 ||
        resource.peakRssBytes > resource.memoryLimitBytes || resource.monitorErrors !== 0) {
      throw new TypeError("A passing native receipt requires successful resource observation and confirmed termination");
    }
  }
  if (execution === "PASS" && (nativeReport === undefined || !validateProbeReport(nativeReport, platform).success || !hash(binarySha256))) {
    throw new TypeError("A passing probe receipt requires successful isolated native evidence and binary digest");
  }
  return {
    schemaVersion: 1, stage: "G0", createdAt: new Date().toISOString(), platform, architecture,
    execution, sourceHashes, commands, ...(runtime === undefined ? {} : { runtime }),
    ...(binarySha256 === undefined ? {} : { binarySha256 }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(nativeReport === undefined ? {} : { nativeReport }),
    gateComplete: false,
    remainingGates: {
      generalClipboardMonitoring: "NOT-RUN", delayedSourceRendering: "NOT-RUN",
      installedHostAndElectron: "NOT-RUN", signedPackaging: "NOT-RUN", actualTargetApplications: "NOT-RUN",
      standardFormatMatrix: "NOT-RUN", nativeReadTimeout: "NOT-RUN", partialWriteFaultInjection: "NOT-RUN",
      rssWatchdog: "NOT-RUN",
      windows10FullMatrix: "NOT-RUN", windows11FullMatrix: "NOT-RUN", crossPlatformSync: "NOT-RUN",
    },
  };
}
