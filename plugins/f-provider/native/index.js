'use strict';
// Loader that resolves the compiled .node relative to this file, so the preload
// can `require('../native')` from anywhere without caring about the build path.
const path = require('node:path')

const candidates = [
  path.join(__dirname, 'build', 'Release', 'wechat_ocr.node'),
  path.join(__dirname, 'build', 'Debug', 'wechat_ocr.node'),
]

let addon = null
let loadError = null
for (const p of candidates) {
  try {
    addon = require(p)
    break
  } catch (e) {
    loadError = e
  }
}

if (!addon) {
  // Re-throw a friendly error pointing at the build step.
  const platformHint = process.platform === 'win32'
    ? '(requires VS Build Tools + Python)'
    : process.platform === 'darwin'
    ? '(requires Xcode Command Line Tools)'
    : '(requires build-essential)';

  const hint =
    `Failed to load wechat_ocr.node. Run \`npm run build\` in this directory ${platformHint}.`
  throw loadError ? new Error(hint + '\n' + loadError.message) : new Error(hint)
}

module.exports = addon
