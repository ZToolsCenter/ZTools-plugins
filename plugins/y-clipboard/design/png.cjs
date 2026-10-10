/**
 * 极简 PNG 解码 + 像素度量工具（CommonJS，零依赖）
 *
 * 为什么自己解：仓库不引第三方包，而 design/ 下的校验脚本只要读几个数字。
 * 支持 8 位深、非隔行、灰度/RGB/RGBA/灰度+Alpha 的 PNG（设计稿导出的都是这类）。
 *
 * 被 design/sharpness.cjs（度量截图清晰度）与 design/check-cats.mts
 * （比较图标素材是否撞车）复用。
 */

const fs = require('node:fs')
const zlib = require('node:zlib')

/** 读文件并解码 */
function decodePng(file) {
  return decodePngBuffer(fs.readFileSync(file))
}

function decodePngBuffer(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')

  let pos = 8
  let ihdr = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12]
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }

  if (!ihdr) throw new Error('缺 IHDR')
  if (ihdr.depth !== 8) throw new Error('只支持 8 位深，实际 ' + ihdr.depth)
  if (ihdr.interlace !== 0) throw new Error('不支持隔行扫描')

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType]
  if (!channels) throw new Error('不支持的颜色类型 ' + ihdr.colorType)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const { width, height } = ihdr
  const stride = width * channels
  const out = Buffer.alloc(stride * height)

  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= channels ? prev[i - channels] : 0
      let v = line[i]
      switch (filter) {
        case 0:
          break
        case 1:
          v += a
          break
        case 2:
          v += b
          break
        case 3:
          v += (a + b) >> 1
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default:
          throw new Error('未知 filter ' + filter)
      }
      cur[i] = v & 0xff
    }
  }

  return { width, height, channels, data: out }
}

/**
 * 区域内"水平相邻像素亮度差"的平均（越高越锐利）。
 * 用来量化"图片放大后糊不糊"：插值放大会拉出过渡带，高频能量就低。
 */
function sharpness(img, x0, y0, x1, y1) {
  const { width, channels, data } = img
  const lum = (x, y) => {
    const i = (y * width + x) * channels
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  let sum = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      sum += Math.abs(lum(x + 1, y) - lum(x, y))
      n++
    }
  }
  return n ? sum / n : 0
}

/** 整图 RGB 通道均值（用来判断素材底色是深是浅） */
function avgColor(img, box) {
  const { width, channels, data } = img
  const [x0, y0, x1, y1] = box || [0, 0, width, img.height]
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      n++
    }
  }
  return [r / n, g / n, b / n]
}

module.exports = { decodePng, decodePngBuffer, sharpness, avgColor }
