// MFD（Math Formula Detection，Pix2Text mfd-1.5 / CnSTD YoloDetector，MIT）核心模块。
// 纯 JS 移植 ultralytics model.predict 的最小等价路径（letterbox(auto=False) → ONNX →
// [1,4+nc,N] 解码 → per-class NMS(iou=0.7) → 反 letterbox → 原图 xyxy）。
// 与 mfd-spike.mjs 的算法逐行一致，但改为可 import 的模块、并支持 longSide 参数。
//
// 关键：本文件不顶层 import onnxruntime-node（避免单测环境缺少该原生依赖时无法加载）。
// 真正的 ONNX 调用在 loadMfdSession / detectFormulaBoxes 内部用动态 import 完成。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const MFD_DIR = path.join(RUNTIME_DIR, 'assets', 'mfd');
export const MFD_MODEL_NAME = 'pix2text-mfd-1.5.onnx';
export const CLASS_NAMES = ['embedding', 'isolated']; // 0=行内公式 1=独立公式

// ---------------------------------------------------------------------------
// 纯函数（可单测，无需 ONNX）
// ---------------------------------------------------------------------------

// 双线性缩放：half-pixel center + clamp，cv2/ultralytics 兼容。src/dst 为 RGB。
export function resizeBilinear3(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 3);
  const fx = sw / dw;
  const fy = sh / dh;
  const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  for (let y = 0; y < dh; y += 1) {
    const srcY = (y + 0.5) * fy - 0.5;
    const y0f = Math.floor(srcY);
    const wy = srcY - y0f;
    const y0 = cl(y0f, 0, sh - 1);
    const y1 = cl(y0f + 1, 0, sh - 1);
    for (let x = 0; x < dw; x += 1) {
      const srcX = (x + 0.5) * fx - 0.5;
      const x0f = Math.floor(srcX);
      const wx = srcX - x0f;
      const x0 = cl(x0f, 0, sw - 1);
      const x1 = cl(x0f + 1, 0, sw - 1);
      const o = (y * dw + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const p00 = src[(y0 * sw + x0) * 3 + c];
        const p01 = src[(y0 * sw + x1) * 3 + c];
        const p10 = src[(y1 * sw + x0) * 3 + c];
        const p11 = src[(y1 * sw + x1) * 3 + c];
        out[o + c] =
          p00 * (1 - wx) * (1 - wy) + p01 * wx * (1 - wy) + p10 * (1 - wx) * wy + p11 * wx * wy;
      }
    }
  }
  return out;
}

// ultralytics LetterBox(auto=False)：等比缩放到 (newH,newW) 并灰边填充。
// 返回画布 + 还原所需参数（r/left/top/unpadW/unpadH）。
export function letterbox(rgb, w, h, newH, newW, pad = 114) {
  const r = Math.min(newH / h, newW / w);
  const unpadW = Math.round(w * r);
  const unpadH = Math.round(h * r);
  const dw = (newW - unpadW) / 2;
  const dh = (newH - unpadH) / 2;
  const top = Math.round(dh - 0.1);
  const bottom = Math.round(dh + 0.1);
  const left = Math.round(dw - 0.1);
  const right = Math.round(dw + 0.1);
  const scaled = resizeBilinear3(rgb, w, h, unpadW, unpadH);
  const cw = unpadW + left + right;
  const ch = unpadH + top + bottom;
  const canvas = new Uint8ClampedArray(cw * ch * 3).fill(pad);
  for (let y = 0; y < unpadH; y += 1) {
    for (let x = 0; x < unpadW; x += 1) {
      const s = (y * unpadW + x) * 3;
      const d = ((y + top) * cw + (x + left)) * 3;
      canvas[d] = scaled[s];
      canvas[d + 1] = scaled[s + 1];
      canvas[d + 2] = scaled[s + 2];
    }
  }
  return { canvas, cw, ch, r, left, top, unpadW, unpadH };
}

// 由 longSide 求目标尺寸：较长边 = longSide，保持长宽比（对齐 Pix2Text ratio=768/w）。
export function computeTarget(w, h, longSide) {
  if (w >= h) {
    const newW = longSide;
    const newH = Math.max(1, Math.round((h * longSide) / w));
    return { newW, newH };
  }
  const newH = longSide;
  const newW = Math.max(1, Math.round((w * longSide) / h));
  return { newW, newH };
}

// letterbox 后的画布尺寸（不真正分配画布，供会话缓存按尺寸分桶）。
export function letterboxCanvasSize(w, h, longSide) {
  const { newW, newH } = computeTarget(w, h, longSide);
  const r = Math.min(newH / h, newW / w);
  const unpadW = Math.round(w * r);
  const unpadH = Math.round(h * r);
  const dw = (newW - unpadW) / 2;
  const dh = (newH - unpadH) / 2;
  const left = Math.round(dw - 0.1);
  const right = Math.round(dw + 0.1);
  const top = Math.round(dh - 0.1);
  const bottom = Math.round(dh + 0.1);
  const cw = unpadW + left + right;
  const ch = unpadH + top + bottom;
  return { cw, ch };
}

export function mfdModelPath(opts = {}) {
  return opts.modelPath || path.join(MFD_DIR, MFD_MODEL_NAME);
}

export async function checkMfdModel(opts = {}) {
  await fs.access(mfdModelPath(opts));
}

// 会话按画布尺寸缓存：onnxruntime 在同一会话内跨不同输入尺寸推理会触发
// "Shape mismatch attempting to re-use buffer" 直接崩进程。但实测该内存模式缓存在
// 执行提供者（EP）层、跨会话共享，单纯按尺寸分桶仍会崩。最终方案见 detectFormulaBoxes：
// 把 letterbox 画布统一 pad 成 longSide×longSide 的方阵，使会话永远只见到一种输入尺寸
// （内容位置 r/left/top 不变，反 letterbox 还原依然精确）。此处保留 getMfdSession 作为
// 单例取用入口（同一形状恒为同一个会话）。
const mfdSessionCache = new Map();

export async function getMfdSession(cw, ch, opts = {}) {
  const key = `${cw}x${ch}`;
  const hit = mfdSessionCache.get(key);
  if (hit) return hit;
  const session = await loadMfdSession(opts);
  mfdSessionCache.set(key, session);
  return session;
}

export function iou(a, b) {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return ua <= 0 ? 0 : inter / ua;
}

// per-class NMS。同一类按 score 降序，保留与已保留框 IoU <= iouThresh 的框。
export function nms(list, iouThresh = 0.7) {
  const out = [];
  const byClass = new Map();
  for (const b of list) {
    if (!byClass.has(b.cls)) byClass.set(b.cls, []);
    byClass.get(b.cls).push(b);
  }
  for (const group of byClass.values()) {
    group.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const b of group) {
      if (kept.every((k) => iou(b, k) <= iouThresh)) kept.push(b);
    }
    out.push(...kept);
  }
  return out.slice(0, 300);
}

// [1, 4+nc, N] → 候选框（xyxy, letterbox 像素坐标）。类别分数已 sigmoid，直接阈值。
export function decodeBoxes(output, conf = 0.25) {
  const dims = output.dims;
  const nc = dims[1] - 4;
  const N = dims[2];
  const data = output.data;
  const at = (c, i) => data[c * N + i];
  const cands = [];
  for (let i = 0; i < N; i += 1) {
    let best = -1;
    let bestC = -1;
    for (let c = 0; c < nc; c += 1) {
      const s = at(4 + c, i);
      if (s > best) {
        best = s;
        bestC = c;
      }
    }
    if (best < conf) continue;
    const cx = at(0, i);
    const cy = at(1, i);
    const bw = at(2, i);
    const bh = at(3, i);
    cands.push({
      x1: cx - bw / 2,
      y1: cy - bh / 2,
      x2: cx + bw / 2,
      y2: cy + bh / 2,
      score: best,
      cls: bestC,
    });
  }
  return cands;
}

// 公式裁剪外边距（boxPad）：MFD 框在裁剪喂给公式引擎前向外扩的像素数。
// 过小会裁掉紧贴边缘的字形（识别率下降），过大可能裹入邻行文字。上限 40px。
export function clampBoxPad(v, max = 40) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, Math.round(n));
}

// CJK 字符集（与 onnx_mixed_merge.mjs 的 CJK_CHAR_RE 口径一致；本文件不 import 它，避免
// 纯函数模块之间产生无谓依赖）。
const CJK_CHAR_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff01-\uff5e]/;

// 统计与 box 相交的字符框数量。相交口径（二选一即算命中，注释写清以便复核）：
//   ① 矩形相交面积 > 0（宽、高同时有正重叠）；
//   ② 字符框中心点落在 box 内（容纳「字符框比公式框略大、只有边缘擦过」的情形）。
// filter 可选：仅统计满足条件的字符（例如只数 CJK）。
// 非法输入（box 非 4 元有限数 / textLines 非数组）一律返回 0，不让 NaN 传播。
function countOverlappingChars(box, textLines, filter) {
  if (!Array.isArray(box) || box.length !== 4) return 0;
  if (!box.every((v) => Number.isFinite(v))) return 0;
  if (!Array.isArray(textLines)) return 0;
  let n = 0;
  for (const tl of textLines) {
    if (!tl || !Array.isArray(tl.chars)) continue;
    for (const ch of tl.chars) {
      const cb = ch && Array.isArray(ch.box) ? ch.box : null;
      if (!cb || cb.length !== 4 || !cb.every((v) => Number.isFinite(v))) continue;
      const ow = Math.min(cb[2], box[2]) - Math.max(cb[0], box[0]);
      const oh = Math.min(cb[3], box[3]) - Math.max(cb[1], box[1]);
      const cx = (cb[0] + cb[2]) / 2;
      const cy = (cb[1] + cb[3]) / 2;
      const hit = (ow > 0 && oh > 0)
        || (cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3]);
      if (!hit) continue;
      if (filter && !filter(ch)) continue;
      n += 1;
    }
  }
  return n;
}

// 该公式框是否真的压在正文文字上（与至少 minOverlapChars 个字符框相交）。
// 用于区分「MFD 在正文里误检的单字母」（与文字重叠）与「真正的孤立小公式」（不重叠）。
export function overlapsTextChars(box, textLines, minOverlapChars = 1) {
  return countOverlappingChars(box, textLines, null) >= minOverlapChars;
}

// 「疑似普通文字」判定（保守版）：LaTeX 去空格后是纯 1–2 个字母/数字（无 \ ^ _ { } 等任何数学结构）。
// MFD 对普通段落里的单字母/双字母常误检为行内公式；识别结果本身是最好的证据——
// 公式引擎读出来只是 "ab"/"1" 的框几乎不可能是真公式。
// 注意：本函数只做**字形**判定，没有文本上下文时无法区分「正文误检的 x」与「真的孤立小公式 $x$」。
// 判据所缺的上下文由 isTrivialFormulaLatex 补齐（见下）。
export function isTinyTextLatex(latex) {
  const s = String(latex || "").replace(/\s+/g, "");
  return /^[0-9a-zA-Z]{1,2}$/.test(s);
}

// LaTeX 装饰命令/包裹结构（剥离后仅剩内容本身，不改变可见字形）。
const TEX_DECOR_CMD =
  /\\(?:boldsymbol|bm|mathrm|mathbf|mathcal|mathit|mathsf|mathtt|mathfrak|mathbb|text|operatorname|textstyle|displaystyle|scriptstyle|limits|nolimits)/g;

// 「疑似普通文字」判定（激进版，仅用于 embedding/行内框）：
// 反复剥离装饰命令（\boldsymbol{x} → x）、花括号与首尾标点后，若剩余可见字形是
// 纯 1–2 个 ASCII 字母/数字，判为普通文字。实测误检会读成 {\boldsymbol{\gamma}}, 、
// {\textstyle\bigwedge}\varepsilon 这类命令包裹形式，字面正则拦不住，必须剥壳。
// 注意：剥离后仍含反斜杠命令（\alpha、\frac…）或上下标/比较符（^ _ = < > |）的不是
// 纯文字 —— 单符号真公式保留。仅对 embedding 应用：独立类型的单符号大概率是真公式。
export function isTinyTextLatexLoose(latex) {
  let s = String(latex || "").trim();
  if (!s) return false;
  for (let i = 0; i < 6; i += 1) {
    const prev = s;
    s = s.replace(TEX_DECOR_CMD, "");
    s = s.replace(/[{}]/g, "");
    s = s.replace(/^[,.;:!?"'()[\]\s]+|[,.;:!?"'()[\]\s]+$/g, "");
    if (s === prev) break;
  }
  if (/\\|[\^_=<>|]/.test(s)) return false;
  const glyphs = s.replace(/\s+/g, "");
  return /^[0-9a-zA-Z]{1,2}$/.test(glyphs);
}

// 按框类型套用对应过滤档位，并用**文本上下文**区分「正文误检」与「真正的孤立小公式」。
//
// 背景（v1.1.0 修复）：旧实现只看识别结果字形，把 MFD 正文误检（段落里的单/双字母）与真实的
// 孤立小公式（论文里的 $x$、$n$、$2$）一并丢掉，后者是论文/试卷里的高频内容，属于数据丢失。
// 新判据：字形 tiny **且**该公式框真的压在文本行字符框上，才判为正文误检。
//
// context（可选）：{ box, textLines, warnings }
//   - box：该公式框 [x1,y1,x2,y2]（原图像素坐标）；缺 box 或 textLines 视为「无上下文」。
//   - textLines：[{ text, box, chars:[{c,box}] }]；无 chars 的行走不到重叠判定。
//   - warnings：可选数组，用于透传「无上下文时退化为旧规则」的提示。
// 无上下文时**退化为旧行为**（保持既有调用方语义不变），并写一条 warning 说明原因。
export function isTrivialFormulaLatex(latex, type, context) {
  const isolated = String(type) === "isolated";
  const tiny = isolated
    ? isTinyTextLatex(latex)
    : isTinyTextLatex(latex) || isTinyTextLatexLoose(latex);
  if (!tiny) return false; // 非 tiny（含 \alpha、x^2、Softmax…）一律保留

  const ctx = context && typeof context === 'object' ? context : null;
  const warnings = ctx && Array.isArray(ctx.warnings) ? ctx.warnings : null;
  const box = ctx && Array.isArray(ctx.box) ? ctx.box : null;
  const textLines = ctx && Array.isArray(ctx.textLines) && ctx.textLines.length ? ctx.textLines : null;
  const tag = String(latex == null ? '' : latex).slice(0, 12);

  if (!box || !textLines) {
    // 没有文本上下文（例如只有 boxes、没有 textLines 的调用路径）：无法区分真假，退化为旧规则。
    if (warnings) {
      warnings.push(`缺少文本上下文，tiny 公式「${tag}」已按旧规则过滤（可能误杀孤立小公式）`);
    }
    return true;
  }

  const overlaps = overlapsTextChars(box, textLines, 1);
  if (isolated) {
    // 独立框：与正文文字重叠 → MFD 正文误检，丢弃；完全不重叠 → 真正的孤立小公式，保留。
    return overlaps;
  }
  // 行内框：要求「框内无 CJK 且压在正文文字上」才判为误检。框内出现 CJK 时不做 tiny 过滤，
  // 交给 filterCjkFormulaBoxes（框内 CJK ≥2 才丢）统一处置，避免两处口径打架。
  const hasCjk = countOverlappingChars(box, textLines, (ch) => CJK_CHAR_RE.test(ch.c || '')) > 0;
  return !hasCjk && overlaps;
}

// 反 letterbox：画布坐标 → 原图坐标。
export function inverseLetterbox(box, lb) {
  return [
    (box[0] - lb.left) / lb.r,
    (box[1] - lb.top) / lb.r,
    (box[2] - lb.left) / lb.r,
    (box[3] - lb.top) / lb.r,
  ];
}

// ---------------------------------------------------------------------------
// ONNX 推理（动态 import onnxruntime-node）
// ---------------------------------------------------------------------------

export async function loadMfdSession(opts = {}) {
  const ort = await import('onnxruntime-node');
  const modelPath = opts.modelPath || path.join(MFD_DIR, MFD_MODEL_NAME);
  await fs.access(modelPath);
  const so = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: false,
    // 关键：MFD 输入尺寸随图片变化（768×可变高）。开启 memory pattern 后，onnxruntime
    // 会按首张图的形状缓存复用缓冲区，第二张不同高度的图推理时触发
    // "Shape mismatch attempting to re-use buffer" 直接崩进程。关闭后每次按实际形状分配。
    enableMemPattern: false,
    logSeverityLevel: 4,
  };
  const session = await ort.InferenceSession.create(modelPath, so);
  process.stderr.write(`[mfd] inputs=${session.inputNames} outputs=${session.outputNames}\n`);
  return session;
}

// image: ImageRaw（{ data: RGBA, width, height }）。
// 返回 { boxes: [{ type, score, box:[x1,y1,x2,y2] }], image: { w, h } }，坐标在原图像素空间。
export async function detectFormulaBoxes(session, image, opts = {}) {
  const longSide = opts.longSide ?? 768;
  const conf = opts.conf ?? 0.25;
  const iouThresh = opts.iou ?? 0.7;
  // 零/负尺寸守卫：ImageRaw.decode 对合法的 0×0 PNG 不抛错，能一路走到这里。若无守卫，
  // computeTarget → newH = Math.max(1, Math.round(0/0)) = NaN → letterbox r = NaN →
  // inverseLetterbox 除以 NaN → 框全为 NaN（且不报错）。直接返回与正常路径**同构**的空结果。
  if (!image || !(image.width > 0) || !(image.height > 0)) {
    return {
      boxes: [],
      image: { w: (image && image.width) || 0, h: (image && image.height) || 0 },
    };
  }
  const { data, width: w, height: h } = image;
  // RGBA → RGB
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  const { newW, newH } = computeTarget(w, h, longSide);
  const lb = letterbox(rgb, w, h, newH, newW);

  const ort = await import('onnxruntime-node');
  // 关键：onnxruntime 在 CPU EP 层按输入尺寸缓存内存模式，跨会话共享；同一会话（或同模型）
  // 一旦遇到不同输入尺寸就会 "Shape mismatch attempting to re-use buffer" 直接崩进程。
  // 因此无论原图比例如何，一律把 letterbox 画布 pad 成 longSide×longSide 的方阵再推理，
  // 保证会话永远只见到唯一一种输入尺寸。内容仍在 (left, top) 原位置、缩放比 r 不变，
  // 反 letterbox 还原（仅依赖 r/left/top）完全精确，检测精度与矩形输入一致。
  const S = longSide;
  const square = new Uint8ClampedArray(S * S * 3).fill(114);
  for (let y = 0; y < lb.ch; y += 1) {
    for (let x = 0; x < lb.cw; x += 1) {
      const s = (y * lb.cw + x) * 3;
      const d = ((y + lb.top) * S + (x + lb.left)) * 3;
      square[d] = lb.canvas[s];
      square[d + 1] = lb.canvas[s + 1];
      square[d + 2] = lb.canvas[s + 2];
    }
  }
  const area = S * S;
  const chw = new Float32Array(3 * area);
  for (let i = 0; i < area; i += 1) {
    chw[i] = square[i * 3] / 255;
    chw[area + i] = square[i * 3 + 1] / 255;
    chw[2 * area + i] = square[i * 3 + 2] / 255;
  }
  const tensor = new ort.Tensor('float32', chw, [1, 3, S, S]);
  const out = await session.run({ images: tensor });
  const output = out.output0;
  const cands = decodeBoxes(output, conf);
  const kept = nms(cands, iouThresh).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const boxes = kept.map((b) => {
    const orig = inverseLetterbox([b.x1, b.y1, b.x2, b.y2], lb);
    return {
      type: CLASS_NAMES[b.cls] ?? String(b.cls),
      score: b.score,
      box: [
        Math.round(orig[0]),
        Math.round(orig[1]),
        Math.round(orig[2]),
        Math.round(orig[3]),
      ],
    };
  });
  return { boxes, image: { w, h } };
}
