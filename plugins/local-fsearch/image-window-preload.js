const { readImage } = require('./images.cjs')
const path = require('node:path')
window.imagePreviewApi = { readImage, name: target => path.basename(target) }
