/**
 * 量化一张 PNG 某个区域"有多清晰"（一次性验证工具，不进 npm test）
 *
 *   node design/sharpness.cjs <png> <x0> <y0> <x1> <y1>
 *
 * 原理：放大糊掉的图，相邻像素之间是插值出来的过渡带 —— 高频能量低；
 * 按目标尺寸真实渲染的图，边缘锐利 —— 高频能量高。
 * 这里算区域内"水平相邻像素亮度差的平均值"，越大越锐利。
 *
 * 解码器与 check-cats.mts 共用（design/png.cjs）。
 */

const { decodePng, sharpness } = require('./png.cjs')

const [file, x0, y0, x1, y1] = process.argv.slice(2)
const img = decodePng(file)
const box = [
  Number(x0) || 0,
  Number(y0) || 0,
  Number(x1) || img.width,
  Number(y1) || img.height,
]
console.log(
  JSON.stringify({
    尺寸: `${img.width}x${img.height}`,
    区域: box.join(','),
    锐利度: Number(sharpness(img, ...box).toFixed(3)),
  })
)
