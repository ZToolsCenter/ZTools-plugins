// 微信 OCR（Windows）返回结果的解析与归一化（纯 CJS，不依赖 electron）。
//
// WHY THIS FILE: Windows 上我们通过 PowerShell P/Invoke 调用本机微信自带的
// wxocr.dll，回调给的是 `const char *`（一段 JSON 字符串）。这段 JSON 的确切
// 结构由微信版本决定、没有公开契约，实测不同版本会出现在 `results` /
// `ocr_result` / `lines` 下的差异，框也可能是 4 点多边形或 x/y/w/h。
// 与其在 PowerShell 里写脆弱的字符串处理（无法单测），不如：
//   - ps1 只做「调用 + 把原始字节按 base64 输出 + 附带图片尺寸」
//   - 解析/归一化全部放在这里，用单测锁定容错行为
//
// 坐标系：输入是像素、原点左上；输出统一为归一化 0..1、原点左下（与 macOS
// Vision / ONNX 两条链路一致，渲染层不再做引擎分支）。

const TEXT_KEYS = ["text", "Text", "content", "Content", "value", "Value"];
const ARRAY_KEYS = ["results", "ocr_result", "ocrResult", "lines", "items", "data", "list"];
const BOX_KEYS = ["box", "Box", "poly", "points", "boxPoints", "box_points", "rect"];

function decodeResultBytes(input) {
  if (typeof input === "string") return input;
  if (!input || typeof input.length !== "number") return "";
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!bytes.length) return "";
  // 微信输出的编码没有承诺：先按 UTF-8 严格解，失败再按 GBK（936）解。
  // 顺序不能反 —— GBK 几乎不会解码失败，反着用会把 UTF-8 中文解成乱码。
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    try {
      return new TextDecoder("gbk").decode(bytes);
    } catch (_) {
      return bytes.toString("latin1");
    }
  }
}

function pickFirst(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function isPolygon(value) {
  if (!Array.isArray(value) || value.length < 3) return false;
  return value.every((point) => Array.isArray(point) && point.length >= 2
    && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
}

// 统一成像素包围盒 {left, top, right, bottom}；识别不出则返回 null。
function toPixelBox(item) {
  if (!item || typeof item !== "object") return null;
  const raw = pickFirst(item, BOX_KEYS);
  if (isPolygon(raw)) {
    const xs = raw.map((point) => Number(point[0]));
    const ys = raw.map((point) => Number(point[1]));
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // {x,y,w,h} 或 {left,top,right,bottom}
    const x = Number(raw.x);
    const y = Number(raw.y);
    const w = Number(raw.w);
    const h = Number(raw.h);
    if ([x, y, w, h].every(Number.isFinite)) {
      return { left: x, top: y, right: x + w, bottom: y + h };
    }
    const left = Number(raw.left);
    const top = Number(raw.top);
    const right = Number(raw.right);
    const bottom = Number(raw.bottom);
    if ([left, top, right, bottom].every(Number.isFinite)) return { left, top, right, bottom };
  }
  // 扁平的 x/y/w/h
  const x = Number(item.x);
  const y = Number(item.y);
  const w = Number(item.w !== undefined ? item.w : item.width);
  const h = Number(item.h !== undefined ? item.h : item.height);
  if ([x, y, w, h].every(Number.isFinite)) {
    return { left: x, top: y, right: x + w, bottom: y + h };
  }
  return null;
}

function findItems(root) {
  if (Array.isArray(root)) return root;
  if (!root || typeof root !== "object") return [];
  for (const key of ARRAY_KEYS) {
    if (Array.isArray(root[key])) return root[key];
  }
  return [];
}

// 微信可能同时返回一个非零 errcode：这类响应必须当失败处理，否则会被
// 「解析出 0 行」伪装成「图里没有文字」。
function assertNoError(root) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return;
  const code = pickFirst(root, ["errcode", "errCode", "code"]);
  if (code === undefined || code === null) return;
  const numeric = Number(code);
  if (Number.isFinite(numeric) && numeric !== 0) {
    const message = pickFirst(root, ["errmsg", "errMsg", "message", "msg"]) || "";
    throw new Error(`微信 OCR 返回错误 ${numeric}${message ? `: ${message}` : ""}`);
  }
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeBox(box, width, height) {
  const x = clamp01(box.left / width);
  const w = clamp01((box.right - box.left) / width);
  // 原点从左下：top/bottom 需要翻转
  const y = clamp01(1 - box.bottom / height);
  const h = clamp01((box.bottom - box.top) / height);
  return { x, y, w, h };
}

/**
 * 解析微信 OCR 的原始返回。
 * @param {Buffer|Uint8Array|string} input 原始字节或已解码文本
 * @param {{width?: number, height?: number}} [sizeHint] 图片尺寸（ps1 侧读取）
 * @returns {{width: number, height: number, lines: Array<{text: string, box?: object}>}}
 */
function parseWeChatResult(input, sizeHint = {}) {
  const text = decodeResultBytes(input);
  if (!text || !text.trim()) {
    throw new Error("微信 OCR 没有返回任何内容（可能是微信版本不支持该图片）");
  }
  let root;
  try {
    root = JSON.parse(text);
  } catch (_) {
    const snippet = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`微信 OCR 返回值不是 JSON：${snippet}`);
  }
  assertNoError(root);

  const items = findItems(root);
  const lines = [];
  for (const item of items) {
    if (typeof item === "string") {
      const value = item.trim();
      if (value) lines.push({ text: value });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rawText = pickFirst(item, TEXT_KEYS);
    const value = rawText === undefined || rawText === null ? "" : String(rawText).trim();
    if (!value) continue;
    const pixelBox = toPixelBox(item);
    lines.push(pixelBox ? { text: value, pixelBox } : { text: value });
  }

  // 尺寸优先级：调用方给的真实图片尺寸 > 返回值里自带的 > 用最大坐标兜底
  let width = Number(sizeHint.width);
  let height = Number(sizeHint.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    const w = Number(pickFirst(root, ["width", "Width", "imageWidth", "imgWidth"]));
    const h = Number(pickFirst(root, ["height", "Height", "imageHeight", "imgHeight"]));
    width = Number.isFinite(w) && w > 0 ? w : 0;
    height = Number.isFinite(h) && h > 0 ? h : 0;
  }
  if ((!width || !height) && lines.length) {
    let maxX = 0;
    let maxY = 0;
    for (const line of lines) {
      if (!line.pixelBox) continue;
      maxX = Math.max(maxX, line.pixelBox.right);
      maxY = Math.max(maxY, line.pixelBox.bottom);
    }
    if (!width && maxX > 0) width = maxX;
    if (!height && maxY > 0) height = maxY;
  }
  if (!width || !height) {
    // 没有尺寸就无法归一化：保留文本、丢掉坐标，总比整条失败好。
    return { width: 0, height: 0, lines: lines.map((line) => ({ text: line.text })) };
  }

  return {
    width,
    height,
    lines: lines.map((line) => (line.pixelBox
      ? { text: line.text, box: normalizeBox(line.pixelBox, width, height) }
      : { text: line.text })),
  };
}

module.exports = {
  decodeResultBytes,
  toPixelBox,
  normalizeBox,
  parseWeChatResult,
};
