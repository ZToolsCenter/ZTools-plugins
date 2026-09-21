import '@gutenye/ocr-node'
import { Detection, Recognition } from './node_modules/@gutenye/ocr-common/build/models/index.js'
import { clusterTable } from '../src/lib/tableModel.js'
import { planTableSplits } from '../bin/onnx_table_split.mjs'
import { sortReadingOrder } from '../bin/onnx_text_order.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const MODELS_DIR = new URL('./node_modules/@gutenye/ocr-models/assets/', import.meta.url).pathname
const MODELS = {
  detectionPath: MODELS_DIR + 'ch_PP-OCRv4_det_infer.onnx',
  recognitionPath: MODELS_DIR + 'ch_PP-OCRv4_rec_infer.onnx',
  dictionaryPath: MODELS_DIR + 'ppocr_keys_v1.txt'
}

const imagePath = process.argv[2] || '/Users/ztocwst/WorkBuddy/2026-09-04-10-19-48/native-ocr-publish-backup/screenshots/sample-doc.png'

const detection = await Detection.create({ models: MODELS })
const recognition = await Recognition.create({ models: MODELS })

const source = (await import('node:fs/promises')).readFile(imagePath)
const lineImages = await detection.run(imagePath)
console.log('detection lines:', lineImages.length)

const PNG = (await import('pngjs')).PNG
const buf = await (await import('node:fs/promises')).readFile(imagePath)
const png = PNG.sync.read(buf)
const sourceWidth = png.width, sourceHeight = png.height

const makeImage = (args) => new lineImages[0].image.constructor(args)
const plan = planTableSplits(lineImages, { sourceWidth, sourceHeight, makeImage })
console.log('after split:', plan.images.length, 'segments')
const splitCount = plan.images.length - lineImages.length
console.log('added segments:', splitCount)

// 与 bin/onnx_ocr_server.mjs 的 recognizeSingle 保持一致：逐张解码，绕过 afAfRec 同行合并
async function recognizeSingle(recognition, lineImage) {
  const image = await lineImage.image.resize({ height: 48 })
  const modelData = recognition.imageToInput(image, {})
  const output = await recognition.runModel({ modelData, onnxOptions: {} })
  const lines = (recognition.decodeText(output) || []).filter(Boolean)
  const best = lines.sort((a, b) => (b.mean || 0) - (a.mean || 0))[0]
  return best && best.mean >= 0.5 ? String(best.text || '') : ''
}

const lines = []
for (let index = 0; index < plan.images.length; index += 1) {
  const lineImage = plan.images[index]
  const box = plan.boxes[index] || lineImage.box
  const text = await recognizeSingle(recognition, lineImage)
  if (!box || !box.length) { lines.push({ text, box: null }); continue }
  const xs = box.map((p) => p[0] / sourceWidth)
  const ys = box.map((p) => p[1] / sourceHeight)
  const left = Math.min(...xs), right = Math.max(...xs)
  const top = Math.min(...ys), bottom = Math.max(...ys)
  lines.push({ text, box: { x: left, y: 1 - bottom, w: right - left, h: bottom - top } })
}

console.log('\n=== final lines (reading order) ===')
const orderedLines = sortReadingOrder(lines.map((l) => {
  if (!l.box) return { ...l, box: null }
  const left = l.box.x * sourceWidth
  const top = (1 - l.box.y - l.box.h) * sourceHeight
  const w = l.box.w * sourceWidth
  const h = l.box.h * sourceHeight
  return { ...l, box: [[left, top], [left + w, top], [left + w, top + h], [left, top + h]] }
}))
for (const l of orderedLines) {
  const cy = l.box ? (l.box[0][1] / sourceHeight).toFixed(3) : 'no-box'
  console.log(`y≈${cy} | ${l.text.slice(0, 30)}`)
}

const t = clusterTable(lines, 0.6)
console.log('\n=== clusterTable(factor=0.6) ===')
console.log('rowClusters:', t.rowClusters.length, '| colClusters:', t.colClusters.length)
console.log('grid:', t.grid.length, 'rows x', (t.grid[0] || []).length, 'cols')
for (const row of t.grid) console.log(JSON.stringify(row))
