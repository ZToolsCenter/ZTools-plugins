/**
 * 生成插件 logo（512x512 PNG，零依赖，node 自带 zlib）。
 *
 * 设计：蓝色渐变圆角方块 + 两个对话气泡，左泡「文」右泡「A」，
 * 纯几何绘制（SDF + 4x 超采样抗锯齿）。
 *
 * 用法：node scripts/make-logo.cjs <输出路径>
 *
 * @author yhx
 */

const fs = require('node:fs')
const zlib = require('node:zlib')

const W = 512
const SS = 4 // 超采样倍数

/* ---------------- 颜色 ---------------- */

function lerp(a, b, t) { return a + (b - a) * t }
function mixColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
}
const BG_TOP = [43, 50, 232]    // #2B32E8
const BG_BOT = [90, 124, 255]   // #5A7CFF
const BLUE = [41, 50, 225]      // #2932E1 字形色
const WHITE = [255, 255, 255]

/* ---------------- SDF 几何 ---------------- */

/** 圆角矩形符号距离（<=0 在内部） */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

/** 点到线段距离（圆头描边用） */
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay
  const apx = px - ax, apy = py - ay
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)))
  return Math.hypot(apx - abx * t, apy - aby * t)
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r
}

/** 三角形符号距离（气泡尾巴用） */
function sdTriangle(px, py, p0, p1, p2) {
  const e = [[p0, p1], [p1, p2], [p2, p0]]
  let d = Infinity
  let s = 1
  for (const [a, b] of e) {
    const ex = b[0] - a[0], ey = b[1] - a[1]
    const wx = px - a[0], wy = py - a[1]
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t))
    const c = [px < a[0] ? 0 : px > b[0] ? 0 : wx * ex - 0, 0] // 占位，下面用标准法
    void c
    const cross = ex * wy - ey * wx
    if (cross < 0) s = -s // 只对凸三角形方向有效，这里按顺时针定义
  }
  // 用重心/半平面统一判定内外（更稳）
  const sign = (() => {
    let inside = true
    const pts = [p0, p1, p2]
    // 保证逆时针：有向面积
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
    for (let i = 0; i < 3; i++) {
      const a = pts[i], b = pts[(i + 1) % 3]
      const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
      if (area > 0 ? cross < 0 : cross > 0) inside = false
    }
    return inside ? -1 : 1
  })()
  void s
  return sign * d
}

/* ---------------- 气泡与字形 ---------------- */

/**
 * 气泡 = 圆角矩形 + 尾巴。
 * dir: 'down'（尾巴在底部左侧，向下指）| 'up'（尾巴在顶部左侧，向上指）
 */
function bubbleD(px, py, cx, cy, hw, hh, r, dir) {
  const rect = sdRoundRect(px, py, cx, cy, hw, hh, r)
  let tail
  if (dir === 'down') {
    const x0 = cx - hw + 34, x1 = x0 + 52, y0 = cy + hh - 2
    tail = sdTriangle(px, py, [x0, y0], [x1, y0], [x0, y0 + 46])
  } else {
    const x0 = cx - hw + 26, x1 = x0 + 52, y0 = cy - hh + 2
    tail = sdTriangle(px, py, [x0, y0], [x1, y0], [x0, y0 - 46])
  }
  return Math.min(rect, tail)
}

/** 「文」字形（中心 cx,cy，高度约 110） */
function wenD(px, py, cx, cy) {
  const d = []
  d.push(sdCircle(px, py, cx, cy - 52, 6.5))                 // 丶
  d.push(sdSegment(px, py, cx - 34, cy - 26, cx + 34, cy - 26) - 5) // 一
  d.push(sdSegment(px, py, cx - 34, cy - 6, cx + 34, cy + 52) - 5)  // 乂 撇
  d.push(sdSegment(px, py, cx + 34, cy - 6, cx - 34, cy + 52) - 5)  // 乂 捺
  return Math.min(...d)
}

/** 「A」字形（中心 cx,cy，高度约 90） */
function aD(px, py, cx, cy) {
  const d = []
  d.push(sdSegment(px, py, cx - 30, cy + 40, cx, cy - 44) - 5)
  d.push(sdSegment(px, py, cx, cy - 44, cx + 30, cy + 40) - 5)
  d.push(sdSegment(px, py, cx - 18, cy + 12, cx + 18, cy + 12) - 5)
  return Math.min(...d)
}

/* ---------------- 组合场景 ---------------- */

/** 返回某采样点的颜色 [r,g,b]（不透明度由调用方按 alpha 计算） */
function sceneShape(px, py) {
  // 背景圆角方块
  const bgD = sdRoundRect(px, py, W / 2, W / 2, W / 2 - 8, W / 2 - 8, 104)
  if (bgD > 0) return null
  const t = Math.max(0, Math.min(1, py / W))
  const bg = mixColor(BG_TOP, BG_BOT, t)

  // 气泡：右下白泡（带 A）压在左上文泡下面
  const dA = bubbleD(px, py, 316, 318, 104, 74, 34, 'up')
  const dWen = bubbleD(px, py, 196, 190, 104, 74, 34, 'down')

  // 「文」「A」字形只画在各自泡内
  const inWen = dWen <= 0
  const inA = dA <= 0 && dA < dWen
  const dGlyphWen = wenD(px, py, 196, 188)
  const dGlyphA = aD(px, py, 318, 320)

  if (inWen && dGlyphWen <= 0) return BLUE
  if (inA && dGlyphA <= 0) return BLUE
  if (dWen <= 0) return WHITE
  if (dA <= 0) return WHITE
  return bg
}

/* ---------------- 渲染（4x 超采样） ---------------- */

const rgba = Buffer.alloc(W * W * 4)
const step = 1 / SS
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) * step
        const py = y + (sy + 0.5) * step
        const c = sceneShape(px, py)
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1 }
      }
    }
    const n = SS * SS
    const off = (y * W + x) * 4
    if (a > 0) {
      const cov = a / n
      rgba[off] = Math.round(r / a)
      rgba[off + 1] = Math.round(g / a)
      rgba[off + 2] = Math.round(b / a)
      rgba[off + 3] = Math.round(cov * 255)
    }
  }
}

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgbaBuf, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // 位深
  ihdr[9] = 6   // RGBA
  // 原始数据：每行前加 filter 0
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgbaBuf.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const out = process.argv[2] || 'logo.png'
fs.writeFileSync(out, encodePng(rgba, W, W))
console.log('written:', out, fs.statSync(out).size, 'bytes')
