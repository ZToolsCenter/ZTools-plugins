const fs = require('node:fs')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
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
