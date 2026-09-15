"use strict";

function sanitizeFileName(value) {
  const cleaned = String(value || "收货地址解析结果.csv")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return cleaned || "收货地址解析结果.csv";
}

function createExportService(dependencies) {
  const fs = dependencies.fs;
  const path = dependencies.path;
  const showSaveDialog = dependencies.showSaveDialog;
  const getDownloadsPath = dependencies.getDownloadsPath;

  return async function saveCsv(content, suggestedName) {
    if (typeof content !== "string" || content.length === 0) throw new TypeError("导出内容不能为空");
    if (Buffer.byteLength(content, "utf8") > 20 * 1024 * 1024) throw new RangeError("导出内容不能超过 20 MB");
    const fileName = sanitizeFileName(suggestedName);
    const downloads = typeof getDownloadsPath === "function" ? getDownloadsPath() : "";
    const defaultPath = downloads ? path.join(downloads, fileName) : fileName;
    let selectedPath = await Promise.resolve(showSaveDialog({
      title: "导出地址表格",
      buttonLabel: "导出 CSV",
      defaultPath: defaultPath,
      filters: [{ name: "CSV 表格", extensions: ["csv"] }]
    }));
    if (!selectedPath) return { canceled: true };
    if (path.extname(selectedPath).toLowerCase() !== ".csv") selectedPath += ".csv";
    const output = content.charCodeAt(0) === 0xFEFF ? content : "\uFEFF" + content;
    fs.writeFileSync(selectedPath, output, { encoding: "utf8", flag: "w" });
    return { canceled: false, path: selectedPath };
  };
}

module.exports = { createExportService: createExportService, sanitizeFileName: sanitizeFileName };
