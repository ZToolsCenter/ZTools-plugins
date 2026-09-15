// 公式识别（LaTeX OCR）核心逻辑，从 onnx_formula_server.mjs 抽取为独立模块，
// 使其可被 import（onnx_formula_server.mjs 顶层调用 main() 故无法被 import）。
// 推理管线严格对齐 Python 版 RapidLaTeXOCR（MIT）：
//   PreProcess(pad/minmax/to_gray/normalize/transpose) → loop_image_resizer
//   → EncoderDecoder（encoder 出 context，decoder 自回归）→ TokenizerCls.token2str。
// 注意：tokenizer 解码用纯 JS 实现 ByteLevel BPE，不引入原生依赖。

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-node';
import { resizeGray } from './onnx_gray_resize.mjs';
import { ImageRaw } from './onnx_image_raw.mjs';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 模型路径（位于 onnx-runtime/assets/formula/ 下，与 OCR 资产隔离）
// ---------------------------------------------------------------------------
const FORMULA_DIR = path.join(RUNTIME_DIR, 'assets', 'formula');
const MODEL_PATHS = {
  resizer: path.join(FORMULA_DIR, 'image_resizer.onnx'),
  encoder: path.join(FORMULA_DIR, 'encoder.onnx'),
  decoder: path.join(FORMULA_DIR, 'decoder.onnx'),
  tokenizer: path.join(FORMULA_DIR, 'tokenizer.json'),
};

// config.yaml 中的超参
const MAX_WIDTH = 672;
const MAX_HEIGHT = 192;
const MIN_WIDTH = 32;
const MIN_HEIGHT = 32;
const BOS_TOKEN = 1;
const EOS_TOKEN = 2;
const MAX_SEQ_LEN = 512;
// config.yaml 的解码温度。T=1e-5 意味着参考实现的 softmax+采样已退化为贪心，
// 因此本实现直接 argmax，不再使用该值（保留仅为注明来源与量级）。
const TEMPERATURE = 0.00001; // ≈ 贪心
const DIVABLE = 32;
// 额外候选宽度（resizer 自洽解的倍数）。每多一个候选 ≈ 多一次完整解码，
// 故默认只补 0.75x / 0.5x 两档（总耗时约 3x）；FORMULA_MULTI=0 可退回单候选。
const MULTI_WIDTH_FACTORS = (() => {
  if (process.env.FORMULA_MULTI === '0') return [];
  const raw = process.env.FORMULA_FACTORS;
  if (raw) {
    return raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  }
  return [0.75, 0.5];
})();
const MEAN = 0.7931 * 255; // 202.2405
const STD = 0.1738 * 255; // 44.319

// ---------------------------------------------------------------------------
// 预处理（对齐 utils.py PreProcess）
// ---------------------------------------------------------------------------

// 灰度缩放（PIL 兼容 + 抗锯齿）抽到独立模块，便于单元测试。
// 详见 bin/onnx_gray_resize.mjs 顶部的说明（为什么必须抗锯齿）。
// 在白色背景上把灰度图 pad 到 32 的倍数（对齐 utils.py PreProcess.pad）。
// 入参 gray 为 Uint8 灰度（0=黑墨，255=白底），返回 {data,width,height}。
// 这里补全 Python 版的两处细节：
//   1) 对比拉伸 (data-min)/(max-min)*255，避免灰阶漂移；
//   2) 若整体偏暗（白字黑底）则反相，统一成「黑墨白底」再裁。
function padGrayToMultiple(gray, width, height) {
  const threshold = 128;
  // 对比拉伸
  let mn = 255, mx = 0;
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] < mn) mn = gray[i];
    if (gray[i] > mx) mx = gray[i];
  }
  let data = gray;
  if (mx > mn) {
    data = new Uint8Array(gray.length);
    const span = mx - mn;
    for (let i = 0; i < gray.length; i += 1) {
      data[i] = Math.round(((gray[i] - mn) / span) * 255);
    }
  }
  // 反相：白字黑底 → 黑字白底
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i];
  const mean = data.length ? sum / data.length : 255;
  let working = data;
  if (mean <= threshold) {
    working = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 1) working[i] = 255 - data[i];
  }
  // 求墨迹（暗像素）包围盒
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (working[y * width + x] < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  let cropW, cropH, crop;
  if (maxX < 0) {
    // 全白：给一个最小空白块
    cropW = 1; cropH = 1; crop = new Uint8Array([255]);
  } else {
    cropW = maxX - minX + 1;
    cropH = maxY - minY + 1;
    crop = new Uint8Array(cropW * cropH);
    for (let y = 0; y < cropH; y += 1) {
      for (let x = 0; x < cropW; x += 1) {
        crop[y * cropW + x] = working[(minY + y) * width + (minX + x)];
      }
    }
  }
  const pw = Math.ceil(cropW / DIVABLE) * DIVABLE || DIVABLE;
  const ph = Math.ceil(cropH / DIVABLE) * DIVABLE || DIVABLE;
  const out = new Uint8Array(pw * ph).fill(255);
  for (let y = 0; y < cropH; y += 1) {
    for (let x = 0; x < cropW; x += 1) {
      out[y * pw + x] = crop[y * cropW + x];
    }
  }
  return { data: out, width: pw, height: ph };
}

// minmax_size：超过 max 等比缩小，小于 min 补白。返回 {data,width,height}。
function minmaxSize(gray, width, height) {
  let w = width, h = height, data = gray;
  if (MAX_WIDTH && MAX_HEIGHT) {
    const rW = width / MAX_WIDTH;
    const rH = height / MAX_HEIGHT;
    const r = Math.max(rW, rH);
    if (r > 1) {
      w = Math.max(1, Math.floor(width / r));
      h = Math.max(1, Math.floor(height / r));
      data = resizeGray(gray, width, height, w, h, 'bilinear');
    }
  }
  if (MIN_WIDTH && MIN_HEIGHT) {
    const nw = Math.max(w, MIN_WIDTH);
    const nh = Math.max(h, MIN_HEIGHT);
    if (nw !== w || nh !== h) {
      const out = new Uint8Array(nw * nh).fill(255);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          out[y * nw + x] = data[y * w + x];
        }
      }
      data = out; w = nw; h = nh;
    }
  }
  return { data, width: w, height: h };
}

// 归一化 + 转置为 (1,1,H,W) float32（对齐 normalize + transpose_and_four_dim）。
function normalizeAndTranspose(gray, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = (gray[i] - MEAN) / STD;
  }
  return { data: out, dims: [1, 1, height, width] };
}

// 由 RGBA 得到灰度（对齐 PIL convert("LA") 的亮度通道），白底。
function rgbaToGray(rgba, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

// 显式参数版 pre_process：返回 final(1,1,H,W) 与 pad 后灰度图。
// 对齐 main.py pre_process：resize(input,(w,h)) → minmax_size → pad → normalize → transpose。
// 注意 resize 滤波器：main.py 中 r > 1 用 BILINEAR，否则用 LANCZOS（降采样主力）。
function preProcessEx(inputGray, inW, inH, r, w, h) {
  const resized = resizeGray(inputGray, inW, inH, w, h, r > 1 ? 'bilinear' : 'lanczos');
  const mm = minmaxSize(resized, w, h);
  const padded = padGrayToMultiple(mm.data, mm.width, mm.height);
  const norm = normalizeAndTranspose(padded.data, padded.width, padded.height);
  return { final: norm, pad: padded };
}

// ---------------------------------------------------------------------------
// 解码器自回归（对齐 models.py Decoder）
// ---------------------------------------------------------------------------
// resizer 用纯 argmax（对齐 main.py 中 np.argmax(resizer_res, axis=-1)）
function argmax(arr) {
  let best = 0;
  let bestV = -Infinity;
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] > bestV) { bestV = arr[i]; best = i; }
  }
  return best;
}

// 对齐 models.py Decoder 的下一步 token 选择。
// 参考实现的链路是：top-k(filter_thres=0.9) → softmax(logits/T) → np.random 多项式采样。
// 但 config.yaml 里 T=1e-5，softmax 已近乎 one-hot：只有当 top-2 logits 差值 ≲1e-5 时
// 多项式采样才会真正随机二选一 —— 这会让同一张图两次识别结果不同。
// 实测把这些并列点直接取「数值最大」比掷骰子更准（真实截图 e^{iπ}+1=0 由错→对），
// 于是这里简化为 argmax：语义等价、结果确定可复现，还省掉每步对整个词表排序的开销。
function nextToken(logits) {
  let best = 0;
  let bestV = -Infinity;
  for (let i = 0; i < logits.length; i += 1) {
    if (logits[i] > bestV) { bestV = logits[i]; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Tokenizer（对齐 utils.py TokenizerCls，纯 JS ByteLevel BPE）
// ---------------------------------------------------------------------------
class FormulaTokenizer {
  constructor(jsonPath) {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const model = raw.model || {};
    this.idToToken = {};
    if (model.vocab) {
      for (const [tok, id] of Object.entries(model.vocab)) {
        this.idToToken[id] = tok;
      }
    }
    // added_tokens（[BOS]/[EOS]/[PAD] 等）
    this.addedTokens = {};
    if (Array.isArray(raw.added_tokens)) {
      for (const t of raw.added_tokens) {
        if (t && typeof t.id === 'number') {
          this.addedTokens[t.id] = t.content;
          this.idToToken[t.id] = t.content;
        }
      }
    }
    this.byteToChar = {};
    this.charToByte = {};
    const bs = [];
    for (let b = 33; b <= 126; b += 1) bs.push(b);
    for (let b = 161; b <= 172; b += 1) bs.push(b);
    for (let b = 174; b <= 255; b += 1) bs.push(b);
    let n = 0;
    for (let b = 0; b < 256; b += 1) {
      if (bs.includes(b)) {
        this.byteToChar[b] = String.fromCharCode(b);
        this.charToByte[String.fromCharCode(b)] = b;
      } else {
        const c = 256 + n;
        this.byteToChar[b] = String.fromCharCode(c);
        this.charToByte[String.fromCharCode(c)] = b;
        n += 1;
      }
    }
  }

  // ids（不含 bos，可能含 eos）→ LaTeX 字符串
  decode(ids) {
    const pieces = [];
    for (const id of ids) {
      if (id === EOS_TOKEN) break;
      if (id === BOS_TOKEN) continue;
      const tok = this.idToToken[id];
      if (tok == null) continue;
      if (tok.startsWith('[') && tok.endsWith(']')) continue; // 特殊 token 跳过
      pieces.push(tok);
    }
    const joined = pieces.join('');
    const bytes = [];
    for (const ch of joined) {
      if (ch === 'Ġ') bytes.push(32);
      else if (this.charToByte[ch] !== undefined) bytes.push(this.charToByte[ch]);
    }
    let text = Buffer.from(bytes).toString('utf8');
    // 不做空白折叠：交由 postProcess 严格对齐 Python 的 post_process。
    return text;
  }
}

// 对齐 main.py post_process：去掉 LaTeX 中多余的空白，但保留 \operatorname/\mathrm/\text/\mathbf 内容与 "\ " 转义空格。
const TEXT_RE = /(\\(?:operatorname|mathrm|text|mathbf)\s?\*? \{.*?\})/g;
const LETTER = '[a-zA-Z]';
const NOLETTER = '[\\W_^\\d]';

function postProcess(input) {
  let s = input;
  // 先摘出 \text{...} 等宏内部名字（去空格），后续逐块还原
  const names = [];
  s = s.replace(TEXT_RE, (m) => {
    const inner = /^\\(?:operatorname|mathrm|text|mathbf)\s?\*? \{(.*?)\}$/.exec(m);
    const name = inner ? inner[1].replace(/ /g, '') : m;
    names.push(name);
    return name;
  });
  // 迭代消除相邻符号之间的空格（对齐 Python 的三条正则，注意 (?!\ ) 例外）
  let news = s;
  do {
    s = news;
    news = s.replace(new RegExp(`(?!\\\\ )(${NOLETTER})\\s+?(${NOLETTER})`, 'g'), '$1$2');
    news = news.replace(new RegExp(`(?!\\\\ )(${NOLETTER})\\s+?(${LETTER})`, 'g'), '$1$2');
    news = news.replace(new RegExp(`(${LETTER})\\s+?(${NOLETTER})`, 'g'), '$1$2');
  } while (news !== s);
  return s;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
export async function loadFormulaSessions() {
  for (const p of Object.values(MODEL_PATHS)) {
    await fs.access(p);
  }
  const opts = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: false,
    logSeverityLevel: 4,
  };
  const resizer = await ort.InferenceSession.create(MODEL_PATHS.resizer, opts);
  const encoder = await ort.InferenceSession.create(MODEL_PATHS.encoder, opts);
  const decoder = await ort.InferenceSession.create(MODEL_PATHS.decoder, opts);
  const tokenizer = new FormulaTokenizer(MODEL_PATHS.tokenizer);
  // 调试信息：把各模型输入签名打到 stderr
  process.stderr.write(
    `[formula] resizer inputs=${resizer.inputNames} outputs=${resizer.outputNames}\n`
  );
  process.stderr.write(
    `[formula] encoder inputs=${encoder.inputNames} outputs=${encoder.outputNames}\n`
  );
  process.stderr.write(
    `[formula] decoder inputs=${decoder.inputNames} outputs=${decoder.outputNames}\n`
  );
  return { resizer, encoder, decoder, tokenizer };
}

function runResizer(session, tensor) {
  return session.run({ [session.inputNames[0]]: tensor }).then((out) => {
    const t = out[session.outputNames[0]];
    return Array.from(t.data);
  });
}

async function runEncoder(session, tensor) {
  const out = await session.run({ [session.inputNames[0]]: tensor });
  return out[session.outputNames[0]]; // Tensor(float32)
}

async function runDecoder(session, tokens, mask, context) {
  const feeds = {};
  feeds[session.inputNames[0]] = new ort.Tensor('int64', BigInt64Array.from(tokens.map((t) => BigInt(t))), [1, tokens.length]);
  feeds[session.inputNames[1]] = new ort.Tensor('bool', Uint8Array.from(tokens.map(() => 1)), [1, tokens.length]);
  feeds[session.inputNames[2]] = context;
  const out = await session.run(feeds);
  return out[session.outputNames[0]]; // Tensor(float32) [1, t, V]
}

// 指定 token 上的 log-softmax 值（T=1）。用于给候选宽度的解码结果打分。
function logProbAt(logits, token) {
  let mx = -Infinity;
  for (let i = 0; i < logits.length; i += 1) if (logits[i] > mx) mx = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) sum += Math.exp(logits[i] - mx);
  return logits[token] - mx - Math.log(sum);
}

// 退化重复率：unique 3-gram / 3-gram 总数。正常 LaTeX 接近 1；
// 自回归跑飞（如 `e^{e^{e^{...}}}`）会明显偏低。用于给打虚高分的退化序列折价。
function trigramDiversity(text) {
  if (text.length < 12) return 1;
  const n = text.length - 2;
  const seen = new Set();
  for (let i = 0; i < n; i += 1) seen.add(text.slice(i, i + 3));
  return seen.size / n;
}

// 允许的最低 3-gram 多样性。低于此值视为跑飞，强制大幅折价。
const MIN_TRIGRAM_DIVERSITY = 0.35;

// 单张 (1,1,H,W) 张量 → encoder → decoder 自回归 → { text, score, steps }。
// score = 每个 token 的平均对数概率（长度归一，便于跨长度比较）。
async function decodeTensor(sessions, tensor) {
  const context = await runEncoder(sessions.encoder, tensor);
  const tokens = [BOS_TOKEN];
  let lp = 0;
  let steps = 0;
  for (let step = 0; step < MAX_SEQ_LEN; step += 1) {
    const out = await runDecoder(sessions.decoder, tokens, null, context);
    const dims = out.dims; // [1, t, V]
    const V = dims[dims.length - 1];
    const t = dims[dims.length - 2];
    const logits = out.data;
    const start = (t - 1) * V;
    const last = logits.subarray ? logits.subarray(start, start + V) : logits.slice(start, start + V);
    const best = nextToken(last);
    lp += logProbAt(last, best);
    steps += 1;
    tokens.push(best);
    if (best === EOS_TOKEN) break;
  }
  const decoded = sessions.tokenizer.decode(tokens.slice(1)); // 去掉 bos
  const text = postProcess(decoded);
  const div = trigramDiversity(text);
  const penalty = div < MIN_TRIGRAM_DIVERSITY ? -2 : 0;
  return { text, score: (steps ? lp / steps : -Infinity) + penalty, raw: steps ? lp / steps : -Infinity, div, steps };
}

// 按指定宽度等比放大/缩小（单步，不做 resizer 迭代），返回喂 encoder 的张量。
// h 用 floor：对齐 Python `int(h * r)` 的向零截断。
function tensorAtWidth(input, w) {
  const fh = Math.max(1, Math.floor((input.height * w) / input.width));
  const { final } = preProcessEx(input.data, input.width, input.height, 1, w, fh);
  return new ort.Tensor('float32', final.data, final.dims);
}

export async function recognizeFormula(sessions, imagePath, opts = {}) {
  const withScore = opts.withScore === true;
  const src = await ImageRaw.open(imagePath);
  // 1) 首轮 pad：RGBA → 灰度 → bbox 裁剪 + 补白
  const gray0 = rgbaToGray(src.data, src.width, src.height);
  const padded0 = padGrayToMultiple(gray0, src.width, src.height);
  // 2) minmax
  const input = minmaxSize(padded0.data, padded0.width, padded0.height);

  let r = 1;
  let w = input.width;
  let h = input.height;
  let finalTensor = null;
  let finalW = 0;
  let finalH = 0;
  for (let iter = 0; iter < 10; iter += 1) {
    // 对齐 Python `h = int(h * r)`：int() 是向零截断，这里 h*r 恒为正 → floor。
    // 早期用 Math.round 会每轮多出 1px，多轮累积后比例逐渐走偏。
    h = Math.max(1, Math.floor(h * r));
    const { final, pad } = preProcessEx(input.data, input.width, input.height, r, w, h);
    const tensor = new ort.Tensor('float32', final.data, final.dims);
    const resizerOut = await runResizer(sessions.resizer, tensor);
    const argmaxIdx = argmax(resizerOut);
    const wPred = (argmaxIdx + 1) * DIVABLE;
    finalTensor = tensor;
    finalW = pad.width;
    finalH = pad.height;
    if (wPred === pad.width) break;
    w = wPred; // 对齐 Python：每轮把 resize 宽度更新为上一轮预测宽度，否则比例永不匹配
    r = wPred / pad.width;
  }

  // 【多候选宽度 + 置信度择优】
  // resizer 的自洽解（wPred == pad.width 就 break）有时会停在「墨迹高度几乎顶满画布」
  // 的那一档（h/finalH ≈ 0.97）。此时字号相对画布偏大，模型会把 e 读成 \Theta、
  // = 读成 \perp，整条公式系统性读错 —— 用户反馈的「截图字迹一大就失真」正是这一类。
  // 对策：在自洽解之外再补 0.75x / 0.5x 两档更「松」的宽度，各自走一遍 encoder+decoder，
  // 用解码器自身的平均对数概率（长度归一）挑最优。实测该图 0.5x 档给出完全正确的
  // e^{i\pi}+1=0，而自洽解档是乱码。
  // 调试开关（生产不设即可）：
  //   FORMULA_MULTI=0        关掉多候选，退回单宽度（= 旧行为），用于 A/B
  //   FORMULA_FACTORS=a,b    自定义相对倍数（默认 0.75,0.5）
  //   FORMULA_CAND_W=a,b     直接点名绝对宽度（会吸附到 32 的倍数），用于扫描定位
  //   FORMULA_REPORT=1       把每档的分数与文本打到 stderr
  const candWidths = [{ w: finalW, tensor: finalTensor }];
  const seen = new Set([finalW]);
  const sweep = (process.env.FORMULA_CAND_W || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
  if (sweep.length) {
    for (const vw0 of sweep) {
      const vw = Math.min(MAX_WIDTH, Math.max(DIVABLE, Math.round(vw0 / DIVABLE) * DIVABLE));
      if (seen.has(vw)) continue;
      seen.add(vw);
      candWidths.push({ w: vw, tensor: tensorAtWidth(input, vw) });
    }
  }
  for (const f of MULTI_WIDTH_FACTORS) {
    const vw = Math.min(MAX_WIDTH, Math.max(DIVABLE, Math.round((finalW * f) / DIVABLE) * DIVABLE));
    if (seen.has(vw)) continue;
    seen.add(vw);
    candWidths.push({ w: vw, tensor: tensorAtWidth(input, vw) });
  }

  let best = null;
  const report = [];
  for (const cand of candWidths) {
    const res = await decodeTensor(sessions, cand.tensor);
    report.push(`w=${cand.w} score=${res.score.toFixed(4)} raw=${res.raw.toFixed(4)} div=${res.div.toFixed(2)} steps=${res.steps} text=${res.text}`);
    if (!best || res.score > best.score) best = { ...res, w: cand.w };
  }
  if (process.env.FORMULA_REPORT) {
    const inkFrac = finalH ? (h / finalH).toFixed(2) : '?';
    process.stderr.write(`[formula] keepW=${finalW} keepH=${finalH} inkFrac=${inkFrac} cands=${candWidths.length}\n`);
    for (const line of report) process.stderr.write(`[cand] ${line}\n`);
    process.stderr.write(`[cand] => pick w=${best.w}\n`);
  }
  // withScore 时返回 { text, score, raw }：score = 择优用的平均对数概率+惩罚项，raw = 纯长度归一平均对数概率
  //（前端置信度可视化用 raw 展示；不带 withScore 保持旧契约只回 text，调用方零改动）。
  if (withScore) return { text: best.text, score: best.score, raw: best.raw };
  return best.text;
}

// 仅供测试/调试导出：preProcess 链上的纯函数。
export const __formulaInternals = {
  padGrayToMultiple,
  minmaxSize,
  normalizeAndTranspose,
  rgbaToGray,
  preProcessEx,
  postProcess,
  FORMULA_DIR,
};
