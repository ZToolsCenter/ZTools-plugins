const fs = require('node:fs')
const path = require('node:path')
const { isImageFile } = require('./paths')

function collectFromDir(dir, recursive, result, seen) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && recursive) {
      collectFromDir(full, recursive, result, seen)
    } else if (entry.isFile() && isImageFile(full)) {
      if (!seen.has(full)) {
        seen.add(full)
        result.push(full)
      }
    }
  }
}

function collectImagesFromPaths(paths, recursive) {
  const result = []
  const seen = new Set()
  for (const p of paths) {
    if (!p || !fs.existsSync(p)) continue
    const stat = fs.statSync(p)
    if (stat.isDirectory()) {
      collectFromDir(p, recursive, result, seen)
    } else if (stat.isFile() && isImageFile(p)) {
      if (!seen.has(p)) {
        seen.add(p)
        result.push(p)
      }
    }
  }
  return result
}

module.exports = { collectImagesFromPaths }
