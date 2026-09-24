"use strict";

const fs = require("node:fs/promises");
const iconv = require("iconv-lite");

function decodeText(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef,0xbb,0xbf]))) return buffer.subarray(3).toString("utf8");
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff,0xfe]))) return buffer.subarray(2).toString("utf16le");
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe,0xff]))) return iconv.decode(buffer.subarray(2), "utf16-be");
  const utf8 = buffer.toString("utf8");
  const replacements = (utf8.match(/\uFFFD/g) || []).length;
  return replacements > Math.max(2, utf8.length * 0.002) ? iconv.decode(buffer, "gb18030") : utf8;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripHtml(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n").trim();
}

function markdownToHtml(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (heading) {
      if (inList) { output.push("</ul>"); inList = false; }
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet) {
      if (!inList) { output.push("<ul>"); inList = true; }
      output.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
    } else if (!line.trim()) {
      if (inList) { output.push("</ul>"); inList = false; }
    } else output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inList) output.push("</ul>");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif;max-width:860px;margin:48px auto;padding:0 28px;line-height:1.7;color:#172234}h1,h2,h3{line-height:1.25}code{background:#eef2f7;padding:.12em .35em;border-radius:4px}</style></head><body>${output.join("\n")}</body></html>`;
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function serializeDelimited(rows, delimiter) {
  return rows.map(row => row.map(value => {
    const text = value == null ? "" : String(value);
    return /["\r\n,\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(delimiter)).join("\n");
}

function jsonToRows(value) {
  if (!Array.isArray(value)) return [["value"], [typeof value === "object" ? JSON.stringify(value) : String(value)]];
  if (!value.length) return [];
  if (value.every(item => Array.isArray(item))) return value;
  if (value.every(item => item && typeof item === "object" && !Array.isArray(item))) {
    const headers = [...new Set(value.flatMap(item => Object.keys(item)))];
    return [headers, ...value.map(item => headers.map(header => {
      const cell = item[header];
      return cell && typeof cell === "object" ? JSON.stringify(cell) : cell ?? "";
    }))];
  }
  return [["value"], ...value.map(item => [item])];
}

function rowsToJson(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((header, index) => String(header || `column_${index + 1}`));
  return rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

async function readSource(filePath, sourceFormat) {
  const text = decodeText(await fs.readFile(filePath));
  if (sourceFormat === "html") return { text: stripHtml(text), html: text, rows: null, json: null };
  if (sourceFormat === "json") {
    const json = JSON.parse(text);
    return { text: JSON.stringify(json, null, 2), html: null, rows: jsonToRows(json), json };
  }
  if (sourceFormat === "csv" || sourceFormat === "tsv") {
    const rows = parseDelimited(text, sourceFormat === "csv" ? "," : "\t");
    return { text, html: null, rows, json: rowsToJson(rows) };
  }
  return { text, html: sourceFormat === "md" ? markdownToHtml(text) : null, rows: null, json: null };
}

function convertStructured(source, sourceFormat, targetFormat) {
  if (targetFormat === "txt") return source.text;
  if (targetFormat === "md") return sourceFormat === "html" ? source.text : source.text;
  if (targetFormat === "html") return source.html || markdownToHtml(source.text);
  if (targetFormat === "json") return JSON.stringify(source.json ?? (source.rows ? rowsToJson(source.rows) : source.text.split(/\r?\n/).map(value => ({ value }))), null, 2);
  if (targetFormat === "csv" || targetFormat === "tsv") {
    const rows = source.rows || source.text.split(/\r?\n/).map(value => [value]);
    return serializeDelimited(rows, targetFormat === "csv" ? "," : "\t");
  }
  throw new Error(`Unsupported structured target: ${targetFormat}`);
}

module.exports = { decodeText, escapeHtml, stripHtml, markdownToHtml, parseDelimited, serializeDelimited, jsonToRows, rowsToJson, readSource, convertStructured };
