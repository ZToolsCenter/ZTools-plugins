const fs = require('node:fs')
const path = require('node:path')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matchs[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  // 导出模板数据为 JSON 文件
  exportToFile(jsonStr) {
    const filePath = window.ztools.showSaveDialog({
      title: '导出代码模板',
      defaultPath: 'code-snippets.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (filePath) {
      fs.writeFileSync(filePath, jsonStr, { encoding: 'utf-8' })
      return true
    }
    return false
  },
  // 从 JSON 文件导入模板数据
  importFromFile() {
    const filePaths = window.ztools.showOpenDialog({
      title: '导入代码模板',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (filePaths && filePaths[0]) {
      const content = fs.readFileSync(filePaths[0], { encoding: 'utf-8' })
      return content
    }
    return null
  }
}
