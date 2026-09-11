// LaTeX OCR 推理模块（CommonJS，由 preload/services.js require）。
//
// 参考 RapidAI/RapidLaTeXOCR（pix2tex 的 ONNX 导出版）的 Python 推理管线，
// 在 Node 侧用 onnxruntime-node 完成离线公式识别：
//   预处理(nativeImage 取像素 → 灰度/反色/裁剪/pad/归一化)
//   → image_resizer 迭代预测宽度 → encoder 前向
//   → 自回归 decoder 循环（逐步 session.run + argmax 贪心）
//   → tokenizer 解码 → post_process 压缩空白。
//
// 引擎产物落地于 <userData>/f-provider/latex/，结构：
//   latex/
//     onnxruntime-node/   （从 npm 复制的完整包，含平台原生二进制）
//     models/
//       encoder.onnx / decoder.onnx / image_resizer.onnx / tokenizer.json
//
// onnxruntime-node 通过绝对路径 require（asar 外的 userData 目录），
// 其内部原生二进制相对自身解析，故须完整复制整个包目录。

const fs = require('node:fs')
const path = require('node:path')

// Electron sandboxed preload 不提供 setImmediate（仅暴露浏览器侧 setTimeout 等），
// 而 onnxruntime-node/dist/backend.js 在 session.run() 与 createInferenceSessionHandler()
// 里直接调用全局 setImmediate，把同步 native 调用推到下一 tick。缺失即抛
// "setImmediate is not defined"。用 setTimeout(0) 等价 polyfill（语义一致：异步执行）。
// 必须在 require('onnxruntime-node') 之前执行。
if (typeof globalThis.setImmediate !== 'function') {
  globalThis.setImmediate = (cb, ...args) => setTimeout(cb, 0, ...args)
}

// ─── 模型超参（pix2tex config.yaml / RapidLaTeXOCR 默认）─────────────────
const CFG = {
  maxW: 672,
  maxH: 192,
  minW: 32,
  minH: 32,
  patch: 32,
  mean: 0.7931,
  std: 0.1738,
  bos: 1,
  eos: 2,
  maxSeqLen: 512
}

/**
 * 创建 LaTeX OCR 推理器。
 * @param {string} latexDir 引擎数据根目录（<userData>/f-provider/latex）
 */
function createLatexOcr(latexDir) {
  const ort = require(path.join(latexDir, 'onnxruntime-node'))
  const modelsDir = path.join(latexDir, 'models')

  let tokenizer = null
  let resizerSession = null
  let encoderSession = null
  let decoderSession = null

  // ─── tokenizer 加载 ──────────────────────────────────────────────────
  // tokenizer.json 为 HuggingFace ByteLevel BPE：model.vocab = {token: id}。
  // 解码：按 id 取 token 字符串拼接 → Ġ 替换为空格 → 去特殊 token → strip。
  function loadTokenizer() {
    if (tokenizer) return tokenizer
    const raw = JSON.parse(fs.readFileSync(path.join(modelsDir, 'tokenizer.json'), 'utf8'))
    const vocab = raw.model.vocab || {}
    const maxId = Object.values(vocab).reduce((m, id) => Math.max(m, id), 0)
    const idToToken = new Array(maxId + 1)
    for (const [tok, id] of Object.entries(vocab)) idToToken[id] = tok
    tokenizer = { idToToken }
    return tokenizer
  }

  /** 解码 token id 序列为 LaTeX 字符串（对齐 pix2tex token2str）。 */
  function detokenize(ids) {
    const { idToToken } = loadTokenizer()
    let s = ''
    for (const id of ids) {
      const tok = idToToken[id]
      if (tok === undefined) continue
      if (tok === '[BOS]' || tok === '[EOS]' || tok === '[PAD]') continue
      s += tok
    }
    s = s.split(' ').join('').replace(/Ġ/g, ' ')
    return s.trim()
  }

  // ─── ONNX 会话懒加载 ───────────────────────────────────────────────────
  async function loadSessions() {
    if (encoderSession) return
    const opts = {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      enableCpuMemArena: false
    }
    resizerSession = await ort.InferenceSession.create(path.join(modelsDir, 'image_resizer.onnx'), opts)
    encoderSession = await ort.InferenceSession.create(path.join(modelsDir, 'encoder.onnx'), opts)
    decoderSession = await ort.InferenceSession.create(path.join(modelsDir, 'decoder.onnx'), opts)
  }

  // ─── 图像加载（nativeImage 取 RGBA 像素）─────────────────────────────
  function loadPixels(imagePath) {
    const { nativeImage } = require('electron')
    let img
    if (/^data:/i.test(imagePath)) img = nativeImage.createFromDataURL(imagePath)
    else img = nativeImage.createFromPath(imagePath)
    const { width, height } = img.getSize()
    const bitmap = img.toBuffer ? img.toBuffer() : img.toBitmap()
    const L = new Float32Array(width * height)
    const A = new Float32Array(width * height)
    for (let i = 0; i < width * height; i++) {
      const r = bitmap[i * 4], g = bitmap[i * 4 + 1], b = bitmap[i * 4 + 2], a = bitmap[i * 4 + 3]
      L[i] = (r * 299 + g * 587 + b * 114) / 1000
      A[i] = a
    }
    return { L, A, width, height }
  }

  // ─── padCore：归一化 + 阈值反色 + 非零 bbox 裁剪 + 32 白边填充 ────────
  // 对齐 pix2tex pad() 的后半段（从已得灰度 data 开始）。
  // 输入 data 为灰度数组（Float32 或 Uint8），输出裁剪+填充后的 Uint8 灰度图。
  function padCore(data, width, height) {
    // 归一化到 0~255
    let dMin = Infinity, dMax = -Infinity
    for (let i = 0; i < data.length; i++) {
      if (data[i] < dMin) dMin = data[i]
      if (data[i] > dMax) dMax = data[i]
    }
    const range = dMax - dMin || 1
    const norm = new Float32Array(data.length)
    for (let i = 0; i < data.length; i++) norm[i] = ((data[i] - dMin) / range) * 255

    // 阈值 128：均值>128 白底黑字；否则黑底白字并反色使背景变白
    const threshold = 128
    let mean = 0
    for (let i = 0; i < norm.length; i++) mean += norm[i]
    mean /= norm.length
    const gray = new Uint8Array(width * height)
    if (mean > threshold) {
      for (let i = 0; i < norm.length; i++) gray[i] = norm[i] < threshold ? 255 : 0
    } else {
      for (let i = 0; i < norm.length; i++) gray[i] = norm[i] > threshold ? 255 : 0
      for (let i = 0; i < norm.length; i++) norm[i] = 255 - norm[i]
    }

    // findNonZero → bbox
    let minX = width, minY = height, maxX = -1, maxY = -1, found = false
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (gray[y * width + x] !== 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          found = true
        }
      }
    }
    if (!found) { minX = 0; minY = 0; maxX = width - 1; maxY = height - 1 }
    const bw = maxX - minX + 1, bh = maxY - minY + 1

    // 裁剪 norm 到 bbox
    const rect = new Uint8Array(bw * bh)
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++)
        rect[y * bw + x] = Math.round(norm[(minY + y) * width + (minX + x)])

    // pad 到 32 倍数，白(255)填充
    const padW = Math.ceil(bw / CFG.patch) * CFG.patch
    const padH = Math.ceil(bh / CFG.patch) * CFG.patch
    const padded = new Uint8Array(padW * padH).fill(255)
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++)
        padded[y * padW + x] = rect[y * bw + x]
    return { data: padded, width: padW, height: padH }
  }

  // ─── 首次 pad：从 RGBA 提取灰度（luminance 或 255-alpha）再 padCore ──
  function padFirst(L, A, width, height) {
    let aMin = 255, aMax = 0
    for (let i = 0; i < A.length; i++) { if (A[i] < aMin) aMin = A[i]; if (A[i] > aMax) aMax = A[i] }
    const alphaVarZero = aMax === aMin
    const data = new Float32Array(width * height)
    for (let i = 0; i < data.length; i++) data[i] = alphaVarZero ? L[i] : 255 - A[i]
    return padCore(data, width, height)
  }

  // ─── sinc 函数（PIL LANCZOS 核）────────────────────────────────────
  function sinc(x) {
    if (x === 0) return 1
    const px = Math.PI * x
    return Math.sin(px) / px
  }

  // ─── LANCZOS 核（a=3，对齐 PIL.Image.Resampling.LANCZOS）──────────
  function lanczosKernel(x, a) {
    if (x === 0) return 1
    if (Math.abs(x) >= a) return 0
    return sinc(x) * sinc(x / a)
  }

  // ─── 1D LANCZOS 重采样（输入为一维行/列数组）──────────────────────
  // 对齐 PIL 的像素中心映射：src_pos = (dst_idx + 0.5) * scale - 0.5
  // src 始终是一维数组（水平时为一行、垂直时为一列），故下标统一用 src[sc]。
  function lanczosResize1D(src, srcLen, dstLen) {
    const a = 3
    const scale = srcLen / dstLen
    // PIL 缩小时增大 support 以保留高频细节
    const support = Math.min(a, scale > 1 ? scale * a : a)
    const dst = new Float64Array(dstLen)
    for (let di = 0; di < dstLen; di++) {
      const center = (di + 0.5) * scale - 0.5
      const left = Math.ceil(center - support)
      const right = Math.floor(center + support)
      let sum = 0, wsum = 0
      for (let si = left; si <= right; si++) {
        const sc = Math.max(0, Math.min(srcLen - 1, si))
        const w = lanczosKernel(si - center, a)
        if (w === 0) continue
        sum += src[sc] * w
        wsum += w
      }
      dst[di] = wsum !== 0 ? sum / wsum : 0
    }
    return dst
  }

  // ─── LANCZOS 缩放（对齐 PIL.Image.Resampling.LANCZOS）───────────────
  function resizeGrayLanczos(src, sw, sh, dw, dh) {
    // 可分离：先水平方向（每行 src[y*sw..] → tmp[y*dw..]），再垂直方向
    const tmp = new Float64Array(sh * dw)
    for (let y = 0; y < sh; y++) {
      const row = src.subarray ? src.subarray(y * sw, y * sw + sw) : src.slice(y * sw, y * sw + sw)
      const resized = lanczosResize1D(row, sw, dw)
      for (let x = 0; x < dw; x++) tmp[y * dw + x] = resized[x]
    }
    const dst = new Uint8Array(dw * dh)
    for (let x = 0; x < dw; x++) {
      const col = new Float64Array(sh)
      for (let y = 0; y < sh; y++) col[y] = tmp[y * dw + x]
      const resized = lanczosResize1D(col, sh, dh)
      for (let y = 0; y < dh; y++) {
        dst[y * dw + x] = Math.max(0, Math.min(255, Math.round(resized[y])))
      }
    }
    return dst
  }

  // ─── 双线性缩放（PIL 像素中心映射）──────────────────────────────────
  function resizeGrayBilinear(src, sw, sh, dw, dh) {
    const dst = new Uint8Array(dw * dh)
    for (let dy = 0; dy < dh; dy++) {
      const sy = (dy + 0.5) * sh / dh - 0.5
      const y0 = Math.floor(sy)
      const y1 = Math.min(y0 + 1, sh - 1)
      const wy = Math.max(0, Math.min(1, sy - y0))
      const y0c = Math.max(0, y0)
      for (let dx = 0; dx < dw; dx++) {
        const sx = (dx + 0.5) * sw / dw - 0.5
        const x0 = Math.floor(sx)
        const x1 = Math.min(x0 + 1, sw - 1)
        const wx = Math.max(0, Math.min(1, sx - x0))
        const x0c = Math.max(0, x0)
        const p00 = src[y0c * sw + x0c], p01 = src[y0c * sw + x1]
        const p10 = src[y1 * sw + x0c], p11 = src[y1 * sw + x1]
        const v = (1 - wx) * (1 - wy) * p00 + wx * (1 - wy) * p01 + (1 - wx) * wy * p10 + wx * wy * p11
        dst[dy * dw + dx] = Math.max(0, Math.min(255, Math.round(v)))
      }
    }
    return dst
  }

  // ─── 通用缩放：放大用 BILINEAR、缩小用 LANCZOS（对齐 pix2tex cli.py）──
  function resizeGray(src, sw, sh, dw, dh) {
    if (dw >= sw && dh >= sh) return resizeGrayBilinear(src, sw, sh, dw, dh)
    return resizeGrayLanczos(src, sw, sh, dw, dh)
  }

  // ─── minmax_size：超 max 缩放、不足 min 补白 ──────────────────────────
  function minmaxSize(data, width, height) {
    let w = width, h = height, img = data
    const rW = w / CFG.maxW, rH = h / CFG.maxH
    if (rW > 1 || rH > 1) {
      const maxR = Math.max(rW, rH)
      w = Math.max(1, Math.floor(width / maxR))
      h = Math.max(1, Math.floor(height / maxR))
      img = resizeGray(data, width, height, w, h)
    }
    const pw = Math.max(w, CFG.minW), ph = Math.max(h, CFG.minH)
    if (pw !== w || ph !== h) {
      const padded = new Uint8Array(pw * ph).fill(255)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) padded[y * pw + x] = img[y * w + x]
      img = padded; w = pw; h = ph
    }
    return { data: img, width: w, height: h }
  }

  // ─── 归一化为 [1,1,H,W] float32 张量数据 ─────────────────────────────
  function normalizeGray(data, w, h) {
    const meanPix = CFG.mean * 255, stdPix = CFG.std * 255
    const tensor = new Float32Array(w * h)
    for (let i = 0; i < data.length; i++) tensor[i] = (data[i] - meanPix) / stdPix
    return tensor
  }

  // ─── 基础预处理（无 resizer）：pad → minmax → 归一化 ─────────────────
  function preprocessNoResize(imagePath) {
    const { L, A, width, height } = loadPixels(imagePath)
    const padded = padFirst(L, A, width, height)
    const sized = minmaxSize(padded.data, padded.width, padded.height)
    const tensor = normalizeGray(sized.data, sized.width, sized.height)
    return { data: tensor, width: sized.width, height: sized.height }
  }

  // ─── image_resizer 迭代：预测最优宽度并缩放（≤10 次）─────────────────
  // 对齐 pix2tex cli.py 的 resize 循环：
  //   input_image = pad→minmax 的灰度图（固定基准）
  //   r=1,w=baseW,h=baseH；每轮 h*=r，把 input_image resize 到 (w,h)，
  //   再 pad→minmax→归一化，喂 resizer 得预测宽 predW=(argmax+1)*32；
  //   predW==当前宽则收敛，否则 r=predW/当前宽、w=predW 继续。
  async function loopImageResizer(imagePath) {
    // 基准图：pad → minmax（灰度 uint8，未归一化）
    const { L, A, width, height } = loadPixels(imagePath)
    const padded = padFirst(L, A, width, height)
    const base = minmaxSize(padded.data, padded.width, padded.height)
    const baseW = base.width, baseH = base.height

    let r = 1, w = baseW, h = baseH
    const resizerInputName = resizerSession.inputNames[0]
    for (let iter = 0; iter < 10; iter++) {
      h = Math.round(h * r)
      // 把基准图 resize 到 (w, h)，再 pad → minmax → 归一化
      const resized = resizeGray(base.data, baseW, baseH, w, h)
      const rePadded = padCore(resized, w, h)
      const reSized = minmaxSize(rePadded.data, rePadded.width, rePadded.height)
      const tensor = normalizeGray(reSized.data, reSized.width, reSized.height)
      const input = new ort.Tensor('float32', tensor, [1, 1, reSized.height, reSized.width])
      const out = await resizerSession.run({ [resizerInputName]: input })
      const logits = out[resizerSession.outputNames[0]].data
      let bestIdx = 0, bestVal = -Infinity
      for (let i = 0; i < logits.length; i++) if (logits[i] > bestVal) { bestVal = logits[i]; bestIdx = i }
      const predW = (bestIdx + 1) * CFG.patch
      if (predW === reSized.width) {
        return { data: tensor, width: reSized.width, height: reSized.height }
      }
      r = predW / reSized.width
      w = predW
    }
    // 未收敛：回退用基准图归一化结果
    const tensor = normalizeGray(base.data, baseW, baseH)
    return { data: tensor, width: baseW, height: baseH }
  }

  // ─── encoder 前向 → context（Tensor）──────────────────────────────────
  async function encode(imgTensor, w, h) {
    const input = new ort.Tensor('float32', imgTensor, [1, 1, h, w])
    const out = await encoderSession.run({ [encoderSession.inputNames[0]]: input })
    return out[encoderSession.outputNames[0]]
  }

  // ─── decoder 自回归循环（argmax 贪心；temperature→0 等价贪心）─────────
  async function decode(context) {
    const inNames = decoderSession.inputNames
    const outName = decoderSession.outputNames[0]
    const out = [CFG.bos]
    for (let step = 0; step < CFG.maxSeqLen; step++) {
      const x = out.slice(-CFG.maxSeqLen)
      const maskArr = new Uint8Array(x.length).fill(1)
      const xTensor = new ort.Tensor('int64', BigInt64Array.from(x.map((v) => BigInt(v))), [1, x.length])
      const maskTensor = new ort.Tensor('bool', maskArr, [1, x.length])
      const feeds = {}
      feeds[inNames[0]] = xTensor
      feeds[inNames[1]] = maskTensor
      feeds[inNames[2]] = context
      const outs = await decoderSession.run(feeds)
      const logits = outs[outName].data
      const dims = outs[outName].dims
      let last
      if (dims.length === 3) {
        const vocab = dims[2]
        const offset = (dims[1] - 1) * vocab
        last = logits.subarray ? logits.subarray(offset, offset + vocab) : logits.slice(offset, offset + vocab)
      } else {
        last = logits
      }
      let bestId = 0, bestVal = -Infinity
      for (let v = 0; v < last.length; v++) if (last[v] > bestVal) { bestVal = last[v]; bestId = v }
      if (bestId === CFG.eos) break
      out.push(bestId)
    }
    return out.slice(1)
  }

  // ─── post_process：压缩 LaTeX 中多余空白 ─────────────────────────────
  function postProcess(s) {
    const textReg = /(\\(operatorname|mathrm|text|mathbf)\s?\*?\s\{[^}]*?\})/g
    const names = []
    let m
    while ((m = textReg.exec(s)) !== null) names.push(m[0].replace(/ /g, ''))
    s = s.replace(textReg, () => names.shift() || '')
    const letter = '[a-zA-Z]', noletter = '[\\W_^\\d]'
    let news = s
    while (true) {
      s = news
      news = s.replace(new RegExp('(?!\\\\ )(' + noletter + ')\\s+?(' + noletter + ')', 'g'), '$1$2')
      news = news.replace(new RegExp('(?!\\\\ )(' + noletter + ')\\s+?(' + letter + ')', 'g'), '$1$2')
      news = news.replace(new RegExp('(' + letter + ')\\s+?(' + noletter + ')', 'g'), '$1$2')
      if (news === s) break
    }
    return s
  }

  // ─── 主入口 ──────────────────────────────────────────────────────────
  async function recognize(imagePath, opts) {
    opts = opts || {}
    await loadSessions()
    let imgData
    if (opts.noResize || !resizerSession) {
      imgData = preprocessNoResize(imagePath)
    } else {
      imgData = await loopImageResizer(imagePath)
    }
    const context = await encode(imgData.data, imgData.width, imgData.height)
    const ids = await decode(context)
    const latexRaw = detokenize(ids)
    const latex = postProcess(latexRaw)
    return { latex, rawIds: ids }
  }

  function dispose() {
    resizerSession = null
    encoderSession = null
    decoderSession = null
    tokenizer = null
  }

  /** 诊断：打印各 session 的输入输出名（验证用）。 */
  async function probe() {
    await loadSessions()
    return {
      resizer: { inputs: resizerSession.inputNames, outputs: resizerSession.outputNames },
      encoder: { inputs: encoderSession.inputNames, outputs: encoderSession.outputNames },
      decoder: { inputs: decoderSession.inputNames, outputs: decoderSession.outputNames }
    }
  }

  return { recognize, dispose, probe, CFG, loadTokenizer }
}

module.exports = { createLatexOcr, CFG }
