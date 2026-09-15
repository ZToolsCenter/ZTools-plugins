const fs = require('node:fs')
const path = require('node:path')

// 生成安全的下载目录文件名，避免渲染进程传入路径片段或非法字符。
function sanitizeDownloadFileName(fileName, fallback) {
  const raw = typeof fileName === 'string' && fileName.trim() ? fileName.trim() : fallback
  return path.basename(raw).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || fallback
}

// 在下载目录中生成不覆盖既有文件的路径；同名文件已存在时自动追加序号。
function createUniqueDownloadPath(fileName) {
  const downloads = window.ztools.getPath('downloads')
  const parsed = path.parse(fileName)
  let index = 0
  let candidate = path.join(downloads, fileName)
  while (fs.existsSync(candidate)) {
    index += 1
    candidate = path.join(downloads, `${parsed.name}-${index}${parsed.ext}`)
  }
  return candidate
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile(text, ext = 'txt') {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.' + ext)
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 文本写入到指定绝对路径，用于工程保存覆盖或首次落盘；目标目录不存在时自动创建。
  writeTextFileToPath(text, filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // SVG 写入到下载目录，可传入文件名用于导出面板自定义前缀。
  writeSvgFile(svgText, fileName) {
    const safeFileName = sanitizeDownloadFileName(fileName, Date.now().toString() + '.svg')
    const targetName = safeFileName.endsWith('.svg') ? safeFileName : safeFileName + '.svg'
    const filePath = createUniqueDownloadPath(targetName)
    fs.writeFileSync(filePath, svgText, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录，可传入文件名用于导出面板输出多尺寸 PNG。
  writeImageFile(base64Url, fileName) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const ext = matchs[1]
    const safeFileName = sanitizeDownloadFileName(fileName, Date.now().toString() + '.' + ext)
    const targetName = safeFileName.endsWith('.' + ext) ? safeFileName : safeFileName + '.' + ext
    const filePath = createUniqueDownloadPath(targetName)
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  // ZIP 写入到下载目录，接收渲染进程生成的 Blob，用于多画板批量导出压缩包。
  async writeZipFile(zipBlob, fileName) {
    const safeFileName = sanitizeDownloadFileName(fileName, Date.now().toString() + '.zip')
    const targetName = safeFileName.endsWith('.zip') ? safeFileName : safeFileName + '.zip'
    const filePath = createUniqueDownloadPath(targetName)
    const arrayBuffer = await zipBlob.arrayBuffer()
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer))
    return filePath
  },
  // 图片写入到指定绝对路径（父目录自动创建，同名文件覆盖），文件名/扩展名由调用方保证。
  writeImageFileToPath(base64Url, filePath) {
    const matchs = /^data:image\/([a-z0-9.+-]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  // 二进制内容写入到下载目录（base64 编码），用于 ICO/ICNS 等自定义容器格式导出，扩展名以传入文件名为准。
  writeBinaryFile(base64, fileName) {
    const safeFileName = sanitizeDownloadFileName(fileName, Date.now().toString() + '.bin')
    const filePath = createUniqueDownloadPath(safeFileName)
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return filePath
  },
  // 二进制内容写入到指定绝对路径（父目录自动创建，同名文件覆盖）。
  writeBinaryFileToPath(base64, filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return filePath
  }
}
