import Ocr from '@gutenye/ocr-node'
import { clusterTable } from '../src/lib/tableModel.js'

const imagePath = process.argv[2] || '/Users/ztocwst/WorkBuddy/2026-09-04-10-19-48/native-ocr-publish-backup/screenshots/sample-doc.png'

const ocr = await Ocr.create()
const result = await ocr.detect(imagePath)
console.log('raw result type:', Array.isArray(result) ? `array[${result.length}]` : typeof result)
console.log('raw[0]:', JSON.stringify(result[0]))

// 按插件 preload 的归一化方式处理（onnx_ocr_backend 多边形 → box，y 底部原点）
const items = (Array.isArray(result) ? result : []).map((item) => {
  const polygon = Array.isArray(item?.box) ? item.box : []
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return { text: item.text, polygon }
})

// 拿图像尺寸：detect 结果若含 width/height 用之，否则用 sips 已知 1000x700
let width = 1000, height = 700
if (result && result.width && result.height) { width = result.width; height = result.height }

const lines = items.map((item) => {
  const polygon = item.polygon.map((p) => [p[0] / width, p[1] / height])
  const xs = polygon.map((p) => p[0])
  const ys = polygon.map((p) => p[1])
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return {
    text: item.text,
    box: { x: left, y: 1 - bottom, w: right - left, h: bottom - top }
  }
})

console.log('\n=== lines (normalized, y bottom-origin) ===')
for (const l of lines) {
  console.log(`w=${l.box.w.toFixed(3)} h=${l.box.h.toFixed(3)} cx=${(l.box.x + l.box.w / 2).toFixed(3)} cy=${(l.box.y + l.box.h / 2).toFixed(3)} | ${l.text.slice(0, 30)}`)
}

const t = clusterTable(lines, 0.6)
console.log('\n=== clusterTable(factor=0.6) ===')
console.log('rowClusters:', t.rowClusters.length, '| colClusters:', t.colClusters.length)
console.log('colClusters cx:', t.colClusters.map((c) => c.cx.toFixed(3)).join(', '))
console.log('grid:', t.grid.length, 'rows x', (t.grid[0] || []).length, 'cols')
