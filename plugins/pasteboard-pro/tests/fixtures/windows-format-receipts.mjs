const shared = { fidelity: "representation-bytes-preserved", materialization: "current-clipboard-format-bytes" };
const rowsByGroup = [
  ["receipt-rich-formats", [
    ["text", "CF_UNICODETEXT", "unicode-text", "utf16le-null-terminated"],
    ["html", "HTML Format", "cf-html", "cf-html-offset-format"],
    ["rtf", "Rich Text Format", "rtf", "rtf-bytes"],
    ["png", "PNG", "png", "png-bytes"],
    ["image-png", "image/png", "png", "png-bytes"],
  ]],
  ["receipt-tiff", [["tiff", "CF_TIFF", "classic-tiff", "tiff6-bytes"]]],
  ["receipt-native-images", [
    ["dib", "CF_DIB", "dib", "windows-dib"],
    ["dibv5", "CF_DIBV5", "dibv5", "windows-dibv5"],
    ["bitmap", "CF_BITMAP", "bitmap-rgb24", "dib24-rendered", {
      fidelity: "visible-rgb-compatible", materialization: "win32-getdibits-24bpp-top-down" }],
    ["palette", "CF_PALETTE", "logpalette", "logpalette-v0300", {
      fidelity: "palette-entries-preserved", materialization: "win32-getpaletteentries-logpalette-v0300" }],
  ]],
  ["receipt-files-wide", [["file-list", "CF_HDROP", "hdrop", "utf16le-dropfiles"]]],
  ["receipt-ansi-oem-locale", [
    ["text-acp", "CF_TEXT", "ansi-text", "windows-acp-raw"],
    ["text-oem", "CF_OEMTEXT", "oem-text", "windows-oemcp-raw"],
    ["locale", "CF_LOCALE", "locale-lcid", "windows-lcid-le"],
  ]],
  ["receipt-url-wide-ansi", [
    ["url-ansi", "UniformResourceLocator", "url-ansi", "windows-acp-url", { urlCodePage: 1252 }],
    ["url-wide", "UniformResourceLocatorW", "url-wide", "utf16le-url-null-terminated"],
  ]],
  ["receipt-files-ansi", [["file-list", "CF_HDROP", "hdrop", "ansi-dropfiles", { validationCodePage: 1252 }]]],
];

export function makeWindowsFormatReceipts() {
  return rowsByGroup.map(([caseId, rows], groupIndex) => {
    const revision = 20 + groupIndex;
    return {
      caseId,
      sourceRevision: groupIndex === 0 ? 0xffff_ffff : revision,
      expectedRevision: groupIndex === 0 ? 0xffff_ffff : revision,
      writeRevision: groupIndex === 0 ? 1 : revision + 1,
      readbackRevision: groupIndex === 0 ? 1 : revision + 1,
      observedRevision: groupIndex === 0 ? 1 : revision + 1,
      helperCodePage: 1252,
      helperOemCodePage: 437,
      sourceOrigin: "unknown",
      formats: rows.map(([key, nativeName, codec, encoding, overrides = {}], index) => {
        const checksum = String((groupIndex + index + 1) % 16).repeat(64);
        return {
          key, nativeName, codec, encoding, fidelity: overrides.fidelity ?? shared.fidelity,
          materialization: overrides.materialization ?? shared.materialization,
          planned: { byteLength: 1, sha256: checksum },
          readback: { byteLength: 1, sha256: checksum },
          comparison: "exact",
          ...(overrides.urlCodePage === undefined ? {} : { urlCodePage: overrides.urlCodePage }),
          ...(overrides.validationCodePage === undefined ? {} : { validationCodePage: overrides.validationCodePage }),
        };
      }),
    };
  });
}
