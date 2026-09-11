const fs = require('node:fs')
const path = require('node:path')

function safeFileName(fileName) {
  return path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 120)
}

function selectSavePath(fileName, extension, mimeType) {
  const defaultPath = path.join(window.ztools.getPath('downloads'), safeFileName(fileName))
  return window.ztools.showSaveDialog({
    title: `保存 ${extension.toUpperCase()} 图标`,
    defaultPath,
    filters: [{ name: `${extension.toUpperCase()} (${mimeType})`, extensions: [extension] }]
  })
}

window.iconServices = {
  saveTextFile(fileName, content) {
    const filePath = selectSavePath(fileName, 'svg', 'image/svg+xml')
    if (!filePath) return null
    fs.writeFileSync(filePath, content, { encoding: 'utf8' })
    return filePath
  },

  saveBase64File(fileName, dataUrl) {
    const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl)
    if (!match) throw new Error('Invalid PNG data URL')

    const filePath = selectSavePath(fileName, 'png', 'image/png')
    if (!filePath) return null
    fs.writeFileSync(filePath, Buffer.from(match[1], 'base64'))
    return filePath
  }
}
