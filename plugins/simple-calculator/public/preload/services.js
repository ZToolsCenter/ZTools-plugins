const fs = require('node:fs')
const path = require('node:path')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 保存文本文件 - 弹出系统保存对话框
  saveTextFile(text, defaultName) {
    try {
      // 尝试使用 ZTools 提供的保存对话框
      const result = window.ztools.showSaveDialog({
        title: '保存计算草稿',
        defaultPath: path.join(window.ztools.getPath('documents'), defaultName),
        filters: [
          { name: '文本文件', extensions: ['txt'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result) {
        fs.writeFileSync(result, text, { encoding: 'utf-8' })
        return result
      }
      return null
    } catch (e) {
      // 降级方案：写入下载目录
      const filePath = path.join(window.ztools.getPath('downloads'), defaultName)
      fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
      return filePath
    }
  }
}
