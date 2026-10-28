/**
 * y-clipboard logo 渲染器（无第三方依赖）
 *
 * 逐像素求值 + 3x3 超采样：先把 sample 点逆变换回形状的用户坐标系，
 * 再依次做 roundRect / polygon 命中测试，最后 source-over 合成。
 * 输出 512x512 RGBA PNG（圆角区域真透明）。
 */
const fs = require('fs')
const zlib = require('zlib')

const W = 512
const H = 512
const SS = 3

/* ---------------- 基础数学 ---------------- */

const lerp = (a, b, t) => a + (b - a) * t

function grad(p, stops) {
  // userSpaceOnUse: (40,24) -> (472,488)，与 SVG 定义一致
  const x0 = 40, y0 = 24, x1 = 472, y1 = 488
  const dx = x1 - x0, dy = y1 - y0
  let t = ((p[0] - x0) * dx + (p[1] - y0) * dy) / (dx * dx + dy * dy)
  t = Math.max(0, Math.min(1, t))
  return [
    lerp(stops[0][0], stops[1][0], t),
    lerp(stops[0][1], stops[1][1], t),
    lerp(stops[0][2], stops[1][2], t)
  ]
}

function inRect(p, x, y, w, h, r) {
  r = r || 0
  const dx = Math.abs(p[0] - (x + w / 2)) - (w / 2 - r)
  const dy = Math.abs(p[1] - (y + h / 2)) - (h / 2 - r)
  const mx = Math.max(dx, 0), my = Math.max(dy, 0)
  return mx * mx + my * my <= r * r
}

function inPoly(p, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function rot(p, deg, c) {
  const a = (deg * Math.PI) / 180, s = Math.sin(a), co = Math.cos(a)
  const dx = p[0] - c[0], dy = p[1] - c[1]
  return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co]
}

function over(dst, r, g, b, a) {
  if (a <= 0) return dst
  const da = dst[3]
  const oa = a + da * (1 - a)
  if (oa <= 0) { dst[0] = dst[1] = dst[2] = dst[3] = 0; return dst }
  for (let i = 0; i < 3; i++) {
    const s = [r, g, b][i]
    dst[i] = (s * a + dst[i] * da * (1 - a)) / oa
  }
  dst[3] = oa
  return dst
}

const white = () => [255, 255, 255, 1]

/* ---------------- 三个方案 ---------------- */

const STOPS = {
  a: [[78, 141, 247], [47, 91, 232]],
  b: [[56, 189, 248], [37, 99, 235]],
  c: [[42, 59, 95], [20, 30, 56]]
}

const BOLT_A = [[265, 167], [170, 281], [256, 281], [246, 357], [341, 243], [256, 243]]
const BOLT_C = [[272, 112], [232, 158], [252, 158], [236, 194], [284, 146], [262, 146]]

function sceneA(p) {
  let out = [0, 0, 0, 0]
  if (inRect(p, 0, 0, 512, 512, 116)) {
    const c = grad(p, STOPS.a); over(out, c[0], c[1], c[2], 1)
  }
  if (inRect(p, 158, 118, 196, 282, 30)) { const w = white(); over(out, w[0], w[1], w[2], 1) }
  if (inRect(p, 222, 92, 68, 52, 16)) { const w = white(); over(out, w[0], w[1], w[2], 1) }
  if (inPoly(p, BOLT_A)) { const c = grad(p, STOPS.a); over(out, c[0], c[1], c[2], 1) }
  return out
}

function sceneB(p) {
  let out = [0, 0, 0, 0]
  if (inRect(p, 0, 0, 512, 512, 116)) {
    const c = grad(p, STOPS.b); over(out, c[0], c[1], c[2], 1)
  }
  const m = rot(p, 10, [268, 256]) // 逆变换：SVG 里是 rotate(-10 268 256)
  if (inRect(m, 180, 112, 180, 258, 26)) { const w = white(); over(out, w[0], w[1], w[2], 1) }
  for (const l of [[206, 176, 128], [206, 210, 128], [206, 244, 86]]) {
    if (inRect(m, l[0], l[1], l[2], 13, 6.5)) {
      const c = grad(m, STOPS.b); over(out, c[0], c[1], c[2], 1)
    }
  }
  if (inRect(m, 238, 88, 64, 48, 14)) { const w = white(); over(out, w[0], w[1], w[2], 1) }
  for (const s of [[44, 176, 72, 0.95], [28, 230, 104, 0.8], [52, 284, 64, 0.65]]) {
    if (inRect(p, s[0], s[1], s[2], 15, 7.5)) over(out, 255, 255, 255, s[3])
  }
  return out
}

function sceneC(p) {
  let out = [0, 0, 0, 0]
  if (inRect(p, 0, 0, 512, 512, 116)) {
    const c = grad(p, STOPS.c); over(out, c[0], c[1], c[2], 1)
  }
  if (inRect(p, 160, 140, 192, 268, 28)) { const w = white(); over(out, w[0], w[1], w[2], 1) }
  for (const l of [[194, 204, 124], [194, 238, 124], [194, 272, 82]]) {
    if (inRect(p, l[0], l[1], l[2], 13, 6.5)) {
      const c = grad(p, STOPS.c); over(out, c[0], c[1], c[2], 1)
    }
  }
  if (inPoly(p, BOLT_C)) over(out, 255, 176, 32, 1)
  return out
}

const SCENES = { a: sceneA, b: sceneB, c: sceneC }

/* ---------------- 渲染 ---------------- */

function render(scene) {
  const buf = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = scene([x + (sx + 0.5) / SS, y + (sy + 0.5) / SS])
          r += c[0]; g += c[1]; b += c[2]; a += c[3]
        }
      }
      const n = SS * SS
      const i = (y * W + x) * 4
      buf[i] = Math.round(r / n)
      buf[i + 1] = Math.round(g / n)
      buf[i + 2] = Math.round(b / n)
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return buf
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
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

function writePng(path, buf) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc((W * 4 + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0 // filter: none
    buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
  fs.writeFileSync(path, png)
  return png.length
}

/* ---------------- 自检：ASCII 预览 + 像素探针 ---------------- */

function ascii(buf) {
  const step = 16
  let s = ''
  for (let y = 8; y < H; y += step) {
    for (let x = 8; x < W; x += step) {
      const i = (y * W + x) * 4
      const a = buf[i + 3]
      if (a < 96) { s += ' '; continue }
      const lum = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
      const warm = buf[i] - buf[i + 2]
      if (warm > 60) s += 'o'          // 琥珀
      else if (lum > 210) s += '#'     // 白
      else s += '.'                    // 蓝/深底
    }
    s += '\n'
  }
  return s
}

function probe(buf, label, points) {
  const out = []
  for (const [name, x, y] of points) {
    const i = (y * W + x) * 4
    out.push(`${name}(${x},${y})=rgba(${buf[i]},${buf[i + 1]},${buf[i + 2]},${buf[i + 3]})`)
  }
  console.log(`  ${label}: ${out.join('  ')}`)
}

const POINTS = [
  ['corner', 4, 4],
  ['bgTopL', 60, 40],
  ['board', 200, 160],
  ['boltMid', 240, 280],
  ['clip', 256, 110]
]

/* ---------------- PNG 结构校验 ---------------- */

function verifyPng(path) {
  const b = fs.readFileSync(path)
  const sigOk = Buffer.compare(b.slice(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) === 0
  let off = 8
  let idat = null
  const types = []
  while (off < b.length) {
    const len = b.readUInt32BE(off)
    const type = b.slice(off + 4, off + 8).toString('ascii')
    const body = b.slice(off + 4, off + 8 + len)
    const stored = b.readUInt32BE(off + 8 + len)
    if (crc32(body) !== stored) return { ok: false, why: `CRC 错误 @ ${type}` }
    types.push(type)
    if (type === 'IHDR') {
      if (b.readUInt32BE(off + 8) !== W || b.readUInt32BE(off + 12) !== H) {
        return { ok: false, why: 'IHDR 尺寸不符' }
      }
    }
    if (type === 'IDAT') idat = b.slice(off + 8, off + 8 + len)
    off += 12 + len
  }
  const raw = zlib.inflateSync(idat)
  const stride = W * 4 + 1 // 每行 1 字节过滤器
  const px = (x, y) => y * stride + 1 + x * 4
  return {
    ok: true,
    sigOk,
    chunks: types.join(','),
    rawSize: raw.length === stride * H,
    cornerAlpha: raw[px(4, 4) + 3],
    centerAlpha: raw[px(256, 256) + 3],
    centerRGB: [raw[px(256, 256)], raw[px(256, 256) + 1], raw[px(256, 256) + 2]]
  }
}

const dir = __dirname
for (const key of Object.keys(SCENES)) {
  const buf = render(SCENES[key])
  const size = writePng(require('path').join(dir, `logo-${key}.png`), buf)
  console.log(`\n=== Logo ${key.toUpperCase()} ===  ${size} bytes`)
  console.log(ascii(buf))
  probe(buf, 'probe', POINTS)
  const v = verifyPng(require('path').join(dir, `logo-${key}.png`))
  console.log(
    `  png: ok=${v.ok} sig=${v.sigOk} chunks=${v.chunks} rawOK=${v.rawSize} ` +
      `cornerA=${v.cornerAlpha} centerA=${v.centerAlpha}${v.why ? ' ' + v.why : ''}`
  )
}
