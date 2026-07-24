const fs = require('node:fs')
const path = require('node:path')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录，ext 可选指定后缀（如 '.md'）
  writeTextFile(text, ext) {
    try {
      const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + (ext || '.txt'))
      fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
      return filePath
    } catch (err) {
      console.error('Failed to write text file:', err)
      return null
    }
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    try {
      const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
      if (!matchs) return null
      const filePath = path.join(
        window.ztools.getPath('downloads'),
        Date.now().toString() + '.' + matchs[1]
      )
      fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
      return filePath
    } catch (err) {
      console.error('Failed to write image file:', err)
      return null
    }
  }
}
