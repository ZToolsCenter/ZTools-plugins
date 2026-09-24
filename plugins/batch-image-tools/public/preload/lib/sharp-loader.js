const fs = require('node:fs')
const path = require('node:path')

function loadSharp() {
  const localPath = path.join(__dirname, '..', 'node_modules', 'sharp')
  if (fs.existsSync(localPath)) {
    return require(localPath)
  }
  return require('sharp')
}

module.exports = loadSharp()
