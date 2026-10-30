const MAX_BYTES = 20 * 1024 * 1024;
const UINT32_MAX = 0xffff_ffff;

export const windowsReceiptCaseIds = Object.freeze([
  "receipt-rich-formats",
  "receipt-tiff",
  "receipt-native-images",
  "receipt-files-wide",
  "receipt-ansi-oem-locale",
  "receipt-url-wide-ansi",
  "receipt-files-ansi",
  "receipt-sha256-known-answers",
  "receipt-invalid-binding-rejected",
]);

export const requiredWindowsReceiptGroups = Object.freeze(windowsReceiptCaseIds.slice(0, 7));

const groupFields = ["caseId", "sourceRevision", "expectedRevision", "writeRevision",
  "readbackRevision", "observedRevision", "helperCodePage", "helperOemCodePage",
  "sourceOrigin", "formats"];
const formatFields = ["key", "nativeName", "codec", "encoding", "fidelity", "materialization",
  "planned", "readback", "comparison", "validationCodePage", "urlCodePage"];
const digestFields = ["byteLength", "sha256"];

const shared = Object.freeze({ fidelity: "representation-bytes-preserved",
  materialization: "current-clipboard-format-bytes" });
const fixedFormats = Object.freeze({
  text: { nativeName: "CF_UNICODETEXT", codec: "unicode-text", encoding: "utf16le-null-terminated", ...shared },
  html: { nativeName: "HTML Format", codec: "cf-html", encoding: "cf-html-offset-format", ...shared },
  rtf: { nativeName: "Rich Text Format", codec: "rtf", encoding: "rtf-bytes", ...shared },
  png: { nativeName: "PNG", codec: "png", encoding: "png-bytes", ...shared },
  "image-png": { nativeName: "image/png", codec: "png", encoding: "png-bytes", ...shared },
  tiff: { nativeName: "CF_TIFF", codec: "classic-tiff", encoding: "tiff6-bytes", ...shared },
  dib: { nativeName: "CF_DIB", codec: "dib", encoding: "windows-dib", ...shared },
  dibv5: { nativeName: "CF_DIBV5", codec: "dibv5", encoding: "windows-dibv5", ...shared },
  bitmap: { nativeName: "CF_BITMAP", codec: "bitmap-rgb24", encoding: "dib24-rendered",
    fidelity: "visible-rgb-compatible", materialization: "win32-getdibits-24bpp-top-down" },
  palette: { nativeName: "CF_PALETTE", codec: "logpalette", encoding: "logpalette-v0300",
    fidelity: "palette-entries-preserved", materialization: "win32-getpaletteentries-logpalette-v0300" },
  "file-list": { nativeName: "CF_HDROP", codec: "hdrop", encoding: null, ...shared },
  "text-acp": { nativeName: "CF_TEXT", codec: "ansi-text", encoding: "windows-acp-raw", ...shared },
  "text-oem": { nativeName: "CF_OEMTEXT", codec: "oem-text", encoding: "windows-oemcp-raw", ...shared },
  locale: { nativeName: "CF_LOCALE", codec: "locale-lcid", encoding: "windows-lcid-le", ...shared },
  "url-ansi": { nativeName: "UniformResourceLocator", codec: "url-ansi", encoding: "windows-acp-url", ...shared },
  "url-wide": { nativeName: "UniformResourceLocatorW", codec: "url-wide", encoding: "utf16le-url-null-terminated", ...shared },
});

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const validCodePage = value => Number.isInteger(value) && value > 0 && value <= 65535;

function strict(value, allowed, message) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new TypeError(message);
  }
}

function validateDigest(value) {
  strict(value, digestFields, "Windows format digest has undeclared fields");
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || value.byteLength > MAX_BYTES ||
      !sha256(value.sha256)) {
    throw new TypeError("Windows format byte evidence is invalid");
  }
}

function validateFormat(value, helperCodePage) {
  strict(value, formatFields, "Windows format receipt contains undeclared fields");
  if (typeof value.key !== "string" || !Object.hasOwn(fixedFormats, value.key)) {
    throw new TypeError("Windows format key is not allowlisted");
  }
  const descriptor = fixedFormats[value.key];
  if (value.nativeName !== descriptor.nativeName || value.codec !== descriptor.codec ||
      value.fidelity !== descriptor.fidelity || value.materialization !== descriptor.materialization) {
    throw new TypeError("Windows format identity or materialization is not allowlisted");
  }

  if (value.key === "file-list") {
    if (!["utf16le-dropfiles", "ansi-dropfiles"].includes(value.encoding)) {
      throw new TypeError("CF_HDROP encoding is not allowlisted");
    }
    const ansi = value.encoding === "ansi-dropfiles";
    if (ansi !== Object.hasOwn(value, "validationCodePage") ||
        (ansi && value.validationCodePage !== helperCodePage)) {
      throw new TypeError("ANSI CF_HDROP requires the matching helper ACP validation context");
    }
  } else if (value.encoding !== descriptor.encoding) {
    throw new TypeError("Windows format encoding is not allowlisted");
  }

  if (value.key === "url-ansi") {
    if (!Object.hasOwn(value, "urlCodePage") || value.urlCodePage !== helperCodePage ||
        Object.hasOwn(value, "validationCodePage")) {
      throw new TypeError("ANSI URL receipt requires its matching ACP context");
    }
  } else if (Object.hasOwn(value, "urlCodePage")) {
    throw new TypeError("URL code-page metadata is only valid for UniformResourceLocator");
  }
  if (value.key !== "file-list" && Object.hasOwn(value, "validationCodePage")) {
    throw new TypeError("Validation code-page metadata is only valid for ANSI CF_HDROP");
  }

  validateDigest(value.planned);
  validateDigest(value.readback);
  if (![
    "exact",
    "visible-rgb-compatible",
  ].includes(value.comparison)) {
    throw new TypeError("Windows format comparison is invalid");
  }
  const exact = value.planned.byteLength === value.readback.byteLength &&
    value.planned.sha256 === value.readback.sha256;
  if ((value.comparison === "exact" && !exact) ||
      (value.comparison === "visible-rgb-compatible" && (value.key !== "bitmap" || exact))) {
    throw new TypeError("Windows format comparison contradicts its byte evidence");
  }
}

function validateGroup(value, passedCases) {
  strict(value, groupFields, "Windows receipt group contains undeclared fields");
  if (!requiredWindowsReceiptGroups.includes(value.caseId) || !passedCases.has(value.caseId)) {
    throw new TypeError("Windows receipt group has no associated passing receipt case");
  }
  const revisions = [value.sourceRevision, value.expectedRevision, value.writeRevision,
    value.readbackRevision, value.observedRevision];
  if (revisions.some(revision => !Number.isInteger(revision) || revision <= 0 || revision > UINT32_MAX) ||
      value.sourceRevision !== value.expectedRevision ||
      value.writeRevision !== value.readbackRevision || value.writeRevision !== value.observedRevision ||
      !validCodePage(value.helperCodePage) || !validCodePage(value.helperOemCodePage) ||
      value.sourceOrigin !== "unknown" || !Array.isArray(value.formats) ||
      value.formats.length === 0 || value.formats.length > 32) {
    throw new TypeError("Windows receipt binding or helper metadata is invalid");
  }

  const keys = new Set();
  let plannedTotal = 0;
  let readbackTotal = 0;
  for (const format of value.formats) {
    if (!record(format) || keys.has(format.key)) throw new TypeError("Windows receipt formats must be distinct");
    keys.add(format.key);
    validateFormat(format, value.helperCodePage);
    plannedTotal += format.planned.byteLength;
    readbackTotal += format.readback.byteLength;
    if (plannedTotal > MAX_BYTES || readbackTotal > MAX_BYTES) {
      throw new TypeError("Windows receipt format byte total exceeds its limit");
    }
  }

  const requiredKeys = {
    "receipt-rich-formats": ["text", "html", "rtf", "png", "image-png"],
    "receipt-tiff": ["tiff"],
    "receipt-native-images": ["dib", "dibv5", "bitmap", "palette"],
    "receipt-files-wide": ["file-list"],
    "receipt-ansi-oem-locale": ["text-acp", "text-oem", "locale"],
    "receipt-url-wide-ansi": ["url-ansi", "url-wide"],
    "receipt-files-ansi": ["file-list"],
  }[value.caseId];
  if (requiredKeys.some(key => !keys.has(key))) {
    throw new TypeError("Windows receipt group is missing required format coverage");
  }
  if (value.caseId === "receipt-files-wide" && value.formats.find(format => format.key === "file-list")?.encoding !== "utf16le-dropfiles") {
    throw new TypeError("Wide file-list receipt requires UTF-16 CF_HDROP evidence");
  }
  if (value.caseId === "receipt-files-ansi") {
    const ansiDrop = value.formats.find(format => format.key === "file-list");
    if (ansiDrop?.encoding !== "ansi-dropfiles" || ansiDrop.validationCodePage !== value.helperCodePage) {
      throw new TypeError("ANSI file-list receipt requires matching CF_HDROP validation code page evidence");
    }
  }
}

export function validateWindowsFormatReceipts(receipts, { success, cases, codePage } = {}) {
  if (typeof success !== "boolean" || !Array.isArray(cases) || !validCodePage(codePage) ||
      !Array.isArray(receipts) || receipts.length > requiredWindowsReceiptGroups.length) {
    throw new TypeError("Windows format receipts require bounded metadata and a valid ACP");
  }
  const passedCases = new Set();
  const caseIds = new Set();
  for (const item of cases) {
    if (!record(item) || typeof item.id !== "string" ||
        !["pass", "fail", "not-run"].includes(item.status) || caseIds.has(item.id)) {
      throw new TypeError("Windows receipt cases must have distinct valid statuses");
    }
    caseIds.add(item.id);
    if (item.status === "pass") passedCases.add(item.id);
  }
  const groupIds = new Set();
  for (const group of receipts) {
    if (!record(group) || groupIds.has(group.caseId)) throw new TypeError("Windows receipt groups must be distinct");
    groupIds.add(group.caseId);
    validateGroup(group, passedCases);
    if (group.helperCodePage !== codePage) {
      throw new TypeError("Windows receipt ACP differs from the report environment");
    }
  }
  if (success && requiredWindowsReceiptGroups.some(caseId => !groupIds.has(caseId))) {
    throw new TypeError("A successful Windows report requires all seven format receipt groups");
  }
  return receipts;
}
