"use strict";

// Windows 系统 OCR 的 stdout 传输协议（供 public/preload.js 与 tests/ 共用）。
//
// 问题背景
// --------
// `bin/ocr-winrt.ps1` 由 powershell.exe 执行，stdout 的字节由
// `[Console]::OutputEncoding` 决定。该设置在「没有真实控制台 + stdout 被重定向
// 到管道」的宿主里可能被**静默忽略**（脚本里那两行 try/catch 会吞掉失败），于是
// 输出退回系统 OEM 代码页 —— 中文 Windows 是 936(GBK)。Node 侧若固定按 UTF-8
// 解码，GBK 中文就会被解成乱码，也就是「识别结果全是中文乱码」的现象。
//
// 方案
// ----
// 不再依赖任何代码页。PowerShell 端把 JSON 转成 UTF-8 字节再 Base64，Base64 的
// 字符集只有 [A-Za-z0-9+/=]，**任何**代码页写出的字节都完全相同，于是 936 / 950
// / 932 / 1252 下行为一致，下游无需知道、也无法被对方的代码页影响。
//
// 协议
// ----
//   NOCR1:<base64(UTF-8 JSON)>
// 成功：{ ok: true,  width, height, lines: [{ text, box: { x, y, w, h } }] }
// 失败：{ ok: false, code, message }
// 旧版脚本直接输出明文 JSON，本模块仍兼容（见 decodeWinRtStdout 的 legacy 分支）。

const PROTOCOL_PREFIX = "NOCR1:";

function toBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw == null) return Buffer.alloc(0);
  return Buffer.from(String(raw), "utf8");
}

// 把脚本 stdout 解成 payload 对象；无法识别时返回 null。
// 传入 Buffer 最佳（字节精确）；传入字符串时按 utf8 解释，仅用于旧调用点。
function decodeWinRtStdout(raw) {
  const buf = toBuffer(raw);
  if (!buf.length) return null;

  // base64 是纯 ASCII，用 latin1 读不会破坏任何字节，也便于逐字节判断。
  const ascii = buf.toString("latin1");

  // 新协议：在一行里定位前缀再取后面的 base64。
  // 用「按行找」而不是「必须以此开头」，是为了容忍 PowerShell 在 payload 之前
  // 往 stdout 打的 warning / Add-Type 提示，以及可能存在的 UTF-8 BOM。
  const line = ascii.split(/\r?\n/).find((text) => text.includes(PROTOCOL_PREFIX));
  if (line !== undefined) {
    const at = line.indexOf(PROTOCOL_PREFIX) + PROTOCOL_PREFIX.length;
    const b64 = line.slice(at).trim();
    if (!b64) return null;
    let json;
    try {
      json = Buffer.from(b64, "base64").toString("utf8");
    } catch (_) {
      throw new Error("Windows OCR 返回内容无法解码（协议 NOCR1）");
    }
    try {
      return JSON.parse(json);
    } catch (_) {
      throw new Error("Windows OCR 返回内容不是合法 JSON（协议 NOCR1）");
    }
  }

  // legacy：旧脚本直接输出明文 JSON。按 utf8 解码（旧脚本已尝试设成 UTF-8），
  // 并跳过 BOM 与前导杂字符，从第一个 '{' 开始解析。
  const text = buf.toString("utf8");
  const start = text.indexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch (_) {
    throw new Error("Windows OCR 返回内容无法解析（legacy 协议）");
  }
}

// payload → { text, lines }。ok:false 时抛出携带原始错误信息的 Error。
// lines 既可能是数组也可能被 PowerShell 折叠成单个对象（仅 1 行时），两者都接。
function payloadToOcrResult(payload) {
  if (!payload) return { text: "", lines: [] };
  if (payload.ok === false || payload.error) {
    throw new Error(String(payload.message || "Windows OCR 识别失败"));
  }
  const items = Array.isArray(payload.lines)
    ? payload.lines
    : (payload.lines ? [payload.lines] : []);
  const lines = [];
  for (const item of items) {
    if (!item || typeof item.text !== "string") continue;
    const line = { text: item.text };
    const box = item.box;
    if (box && Number.isFinite(Number(box.x))) {
      line.box = { x: Number(box.x), y: Number(box.y), w: Number(box.w), h: Number(box.h) };
    }
    lines.push(line);
  }
  return { text: lines.map((line) => line.text).join("\n"), lines };
}

// 失败时优先用 base64 信封里的 message（不受代码页影响）。
// 取不到才退回 stderr；stderr 若已被解成替换字符(U+FFFD) 就不要再把乱码抛给用户。
function errorMessageFromOutput(raw, stderrText, fallback) {
  try {
    const payload = decodeWinRtStdout(raw);
    if (payload && payload.message) return String(payload.message);
  } catch (_) {
    // 信封本身不可解析，继续走下面的兜底。
  }
  const text = String(stderrText || "").trim();
  if (text && !text.includes("\uFFFD")) return text;
  return fallback || "Windows OCR 识别失败";
}

module.exports = {
  PROTOCOL_PREFIX,
  decodeWinRtStdout,
  payloadToOcrResult,
  errorMessageFromOutput
};
