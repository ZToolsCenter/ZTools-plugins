"use strict";

const fs = require("fs");
const path = require("path");
const { createExportService } = require("./core/exporter.cjs");
const { createFileDragGrantStore } = require("./core/file-drag-grants.cjs");

const MINIMUM_VERSION = "2.4.0";

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?\s*$/);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function isPrereleaseVersion(value) {
  return typeof value === "string" && /^\s*v?\d+\.\d+(?:\.\d+)?-/.test(value);
}

function hostCompatibility() {
  const ztools = window.ztools;
  if (!ztools) return { version: "", supported: true };
  let getAppVersion;
  try { getAppVersion = ztools.getAppVersion; } catch (_) { return { version: "", supported: false }; }
  if (typeof getAppVersion !== "function") return { version: "", supported: false };
  let version;
  try { version = getAppVersion.call(ztools); } catch (_) { return { version: "", supported: false }; }
  const current = parseVersion(version);
  const minimum = parseVersion(MINIMUM_VERSION);
  const atMinimum = Boolean(current && minimum) && current.every((part, index) => part === minimum[index]);
  const supported = Boolean(current && minimum) && !(
    atMinimum && isPrereleaseVersion(version)
  ) && (current[0] > minimum[0] || (current[0] === minimum[0] && (current[1] > minimum[1] || (current[1] === minimum[1] && current[2] >= minimum[2]))));
  return { version: typeof version === "string" ? version : "", supported };
}

const saveCsvFile = createExportService({
  fs,
  path,
  showSaveDialog(options) {
    if (!window.ztools || typeof window.ztools.showSaveDialog !== "function") {
      throw new Error("当前环境不支持保存对话框");
    }
    return window.ztools.showSaveDialog(options);
  },
  getDownloadsPath() {
    if (!window.ztools || typeof window.ztools.getPath !== "function") return "";
    return window.ztools.getPath("downloads") || "";
  }
});

const dragGrants = createFileDragGrantStore({
  fs,
  path,
  requiredExtension: ".csv"
});

async function saveCsv(content, suggestedName) {
  const result = await saveCsvFile(content, suggestedName);
  if (!result.canceled && result.path) dragGrants.grant(result.path);
  return result;
}

window.addressParserBridge = Object.freeze({
  saveCsv,
  hostCompatibility,
  canStartDrag() { return typeof window.ztools?.startDrag === "function"; },
  async startDrag(paths) {
    if (typeof window.ztools?.startDrag !== "function") throw new Error("请升级到 ZTools 3.2.0 以拖出文件。");
    const values = dragGrants.consume(paths);
    await Promise.resolve(window.ztools.startDrag(values.length === 1 ? values[0] : values));
  }
});

module.exports = { MINIMUM_VERSION, parseVersion, hostCompatibility };
