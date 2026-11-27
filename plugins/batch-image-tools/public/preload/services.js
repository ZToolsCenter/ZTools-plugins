const fs = require('node:fs')
const path = require('node:path')
const sharp = require('./lib/sharp-loader')
const { getExtension, isImageFile } = require('./lib/paths')
const { collectImagesFromPaths } = require('./lib/collect')
const { processOneImage } = require('./processors/single')
const { processMerge } = require('./processors/merge')
const { renameOneImage } = require('./processors/rename')

function saveBase64Image(base64Url) {
  const match = /^data:image\/([a-z0-9+]+);base64,/i.exec(base64Url)
  if (!match) {
    throw new Error('无效的图片数据')
  }
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  const downloads = window.ztools.getPath('downloads')
  const filePath = path.join(downloads, 'paste-' + Date.now() + '.' + ext)
  fs.writeFileSync(filePath, base64Url.substring(match[0].length), { encoding: 'base64' })
  return filePath
}

window.services = {
  isImageFile,
  collectImages: (paths, recursive = true) => collectImagesFromPaths(paths, recursive),
  saveBase64Image,

  getImageInfo: async (filePath) => {
    const stat = fs.statSync(filePath)
    const meta = await sharp(filePath, { failOn: 'none' }).metadata()
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      width: meta.width || 0,
      height: meta.height || 0,
      format: meta.format || getExtension(filePath)
    }
  },

  getThumbnail: async (filePath, size = 64) => {
    const buf = await sharp(filePath, { failOn: 'none' })
      .resize(size, size, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer()
    return 'data:image/jpeg;base64,' + buf.toString('base64')
  },

  processOne: processOneImage,
  processMerge,
  renameOne: renameOneImage
}
