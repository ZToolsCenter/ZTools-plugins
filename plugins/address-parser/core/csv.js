(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AddressCsv = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HEADERS = ["序号", "姓名", "电话", "省", "市", "区县", "详细地址", "完整原文", "缺失字段"];

  function protectFormula(value) {
    const text = String(value == null ? "" : value);
    const startsWithControl = /^[\t\r]/.test(text);
    const formulaAfterWhitespace = /^[\u0000-\u0020]*[=+\-@]/.test(text);
    return startsWithControl || formulaAfterWhitespace ? "'" + text : text;
  }

  function escapeCell(value) {
    const text = protectFormula(value).replace(/"/g, '""');
    return /[",\r\n]/.test(text) ? '"' + text + '"' : text;
  }

  function formatPhoneCell(value) {
    const phone = String(value == null ? "" : value).trim();
    if (!phone) return "";
    // Excel 会把纯数字座机当成数值并移除前导零。只有经过严格数字校验时，
    // 才生成一个固定文本公式；其他输入仍走通用公式注入防护。
    if (/^\d{7,20}$/.test(phone)) return '="' + phone + '"';
    return escapeCell(phone);
  }

  function recordsToCsv(records, options) {
    const includeBom = !options || options.includeBom !== false;
    const lines = [HEADERS.map(escapeCell).join(",")];
    (records || []).forEach(function (record, index) {
      const missing = (record.missingFields || []).map(function (field) {
        const titles = { name: "姓名", phone: "电话", province: "省", city: "市", district: "区县", detail: "详细地址" };
        return titles[field] || field;
      }).join("、");
      lines.push([
        escapeCell(record.id || index + 1),
        escapeCell(record.name),
        formatPhoneCell(record.phone),
        escapeCell(record.province),
        escapeCell(record.city),
        escapeCell(record.district),
        escapeCell(record.detail),
        escapeCell(record.original),
        escapeCell(missing)
      ].join(","));
    });
    return (includeBom ? "\uFEFF" : "") + lines.join("\r\n") + "\r\n";
  }

  return { HEADERS: HEADERS, escapeCell: escapeCell, formatPhoneCell: formatPhoneCell, recordsToCsv: recordsToCsv };
});
