const fs = require('node:fs')
const path = require('node:path')

const PADDLE_EXE_NAMES = [
  'PaddleOCR-json.exe',
  'PaddleOCR-json',
  'RapidOCR-json.exe',
  'RapidOCR-json'
]

function findPaddleExe(root, maxDepth) {
  maxDepth = maxDepth == null ? 4 : maxDepth
  const walk = (dir, depth) => {
    if (depth > maxDepth || !fs.existsSync(dir)) return ''
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_) {
      return ''
    }
    for (const ent of entries) {
      if (ent.isFile() && PADDLE_EXE_NAMES.includes(ent.name)) {
        return path.join(dir, ent.name)
      }
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const hit = walk(path.join(dir, ent.name), depth + 1)
        if (hit) return hit
      }
    }
    return ''
  }
  return walk(root, 0)
}

/** PaddleOCR-json 用相对路径找 models/，CWD 不对就报 det_model_dir does not exist。 */
function paddleSpawnArgs(exePath, imagePath) {
  return {
    cwd: path.dirname(exePath),
    args: ['-image_path=' + imagePath, '-models_path=' + path.join(path.dirname(exePath), 'models')]
  }
}

module.exports = { findPaddleExe, PADDLE_EXE_NAMES, paddleSpawnArgs }
