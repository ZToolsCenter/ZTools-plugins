"use strict";

const fs = require("fs");
const path = require("path");
const { createExportService } = require("./core/exporter.cjs");

const saveCsv = createExportService({
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

window.addressParserBridge = Object.freeze({ saveCsv });
