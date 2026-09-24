// 灰度图缩放（PIL 兼容实现），供 ONNX 公式识别服务与单元测试共用。
//
// 【为什么必须抗锯齿】
// 公式识别管线会把图片先缩到「模型预测的目标宽度」（常见 160～672px）。若缩放时
// 不做抗锯齿（即只对每个目标像素做 4 邻域点采样），在缩小 3～7 倍时等于对源图做
// 点抽样，细笔画会断裂、产生摩尔纹，模型于是把 `1` 认成 `I`、`=` 认成 `\equiv`。
//
// 正确做法与 PIL 一致：把滤波器支撑域（support）按缩放比例放大，
// 让每个目标像素真正「积分」它覆盖到的所有源像素。
// 实测（1006x185 → 160x47，与真实管线收敛宽度一致）：
//   点采样：MAE 4.89，最大误差 115，6.6% 像素偏差 > 32 灰阶
//   PIL 兼容：MAE 0.18，最大误差 22，0% 像素偏差 > 32 灰阶
//
// filterName: 'bilinear' | 'lanczos'，对应 PIL 的
// Resampling.BILINEAR / Resampling.LANCZOS，系数计算对齐 PIL precompute_coeffs。

export function sinc(x) {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/**
 * 复刻 CPython 浮点 `a // b` 的语义（float_divmod）。
 *
 * 直接用 `Math.floor(a / b)` 会在整除边界上偏 1。典型例子：
 *   1088 // (1088/672) —— 数学上正好是 672，但 1088/672 的双精度表示略大于真值，
 *   于是 CPython 得到 671，而 Math.floor 得到 672。
 * numpy 的 `np.array(size) // max(ratios)` 走的是同一套 C 实现，因此只要不逐位对齐，
 * minmax_size 的输出宽度就会和 Python 差 1px。
 *
 * 算法照抄 CPython Objects/floatobject.c 的 float_divmod。
 */
export function pyFloorDiv(a, b) {
  if (b === 0) return 0;
  const mod0 = a % b; // JS % 与 C fmod 同语义
  let div = (a - mod0) / b;
  if (mod0 !== 0) {
    if ((b < 0) !== (mod0 < 0)) div -= 1;
  }
  let floordiv = Math.floor(div);
  if (div - floordiv > 0.5) floordiv += 1;
  return floordiv;
}

/**
 * @param {Uint8Array} src 源灰度数组，长度 wSrc*hSrc
 * @param {number} wSrc
 * @param {number} hSrc
 * @param {number} wDst
 * @param {number} hDst
 * @param {'bilinear'|'lanczos'} [filterName]
 * @returns {Uint8Array} 缩放后灰度数组，长度 wDst*hDst
 */
export function resizeGray(src, wSrc, hSrc, wDst, hDst, filterName) {
  const dst = new Uint8Array(wDst * hDst);
  if (!wDst || !hDst || !wSrc || !hSrc) return dst;
  const isLanczos = filterName === 'lanczos';

  // PIL precompute_coeffs：filterscale = max(1, scale)，support 随 filterscale 放大
  const buildCoeffs = (inSize, outSize) => {
    const scale = inSize / outSize;
    const filterscale = Math.max(1, scale);
    const support = (isLanczos ? 3 : 1) * filterscale;
    const ss = 1 / filterscale;
    const coeffs = [];
    for (let i = 0; i < outSize; i += 1) {
      const center = (i + 0.5) * scale;
      let xmin = Math.floor(center - support + 0.5);
      if (xmin < 0) xmin = 0;
      let xmax = Math.floor(center + support + 0.5);
      if (xmax > inSize) xmax = inSize;
      if (xmax <= xmin) {
        xmin = Math.max(0, Math.min(xmin, inSize - 1));
        xmax = xmin + 1;
      }
      const k = [];
      let ww = 0;
      for (let x = xmin; x < xmax; x += 1) {
        const t = (x - center + 0.5) * ss;
        let w;
        if (isLanczos) {
          w = Math.abs(t) < 3 ? sinc(t) * sinc(t / 3) : 0;
        } else {
          w = Math.abs(t) < 1 ? 1 - Math.abs(t) : 0;
        }
        k.push(w);
        ww += w;
      }
      if (ww > 0) {
        for (let j = 0; j < k.length; j += 1) k[j] /= ww;
      }
      coeffs.push({ start: xmin, k });
    }
    return coeffs;
  };

  const cw = buildCoeffs(wSrc, wDst);
  const ch = buildCoeffs(hSrc, hDst);

  // 水平 pass
  const tmp = new Float32Array(wDst * hSrc);
  for (let y = 0; y < hSrc; y += 1) {
    const row = y * wSrc;
    const orow = y * wDst;
    for (let x = 0; x < wDst; x += 1) {
      const { start, k } = cw[x];
      let v = 0;
      for (let j = 0; j < k.length; j += 1) v += src[row + start + j] * k[j];
      tmp[orow + x] = v;
    }
  }

  // 垂直 pass
  for (let y = 0; y < hDst; y += 1) {
    const { start, k } = ch[y];
    const orow = y * wDst;
    for (let x = 0; x < wDst; x += 1) {
      let v = 0;
      for (let j = 0; j < k.length; j += 1) v += tmp[(start + j) * wDst + x] * k[j];
      dst[orow + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return dst;
}

export default resizeGray;
