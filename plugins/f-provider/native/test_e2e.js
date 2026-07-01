// End-to-end OCR test. Run: node test_e2e.js
const path = require('node:path')
const fs = require('node:fs')
const addon = require('./index.js')

const dataDir = path.join(__dirname, 'wco_data')
const imgPath = process.argv[2] || 'C:\\Users\\98014\\AppData\\Local\\Temp\\ocr_test.png'

if (!fs.existsSync(path.join(dataDir, 'WeChatOCR.exe'))) {
  console.error('ERROR: wco_data missing WeChatOCR.exe at', dataDir)
  process.exit(1)
}

console.log('init()...', dataDir)
addon.init(dataDir)
console.log('init ok')

console.log('ocr()...', imgPath)
const t0 = Date.now()
addon.ocr(imgPath).then((res) => {
  console.log('ocr done in', Date.now() - t0, 'ms')
  console.log('ok:', res.ok, 'taskId:', res.taskId)
  if (res.lines) {
    for (const line of res.lines) {
      // text is already decoded UTF-8 from the native addon
      console.log(`  [${line.rate.toFixed(3)}] "${line.text}"  box=(${line.left.toFixed(0)},${line.top.toFixed(0)})-(${line.right.toFixed(0)},${line.bottom.toFixed(0)})`)
    }
  } else {
    console.log('  error:', res.error)
  }
  addon.dispose()
}).catch((e) => {
  console.error('ocr rejected:', e)
  addon.dispose()
  process.exit(1)
})
