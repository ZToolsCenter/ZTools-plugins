const fs = require('node:fs')
const path = require('node:path')
window.utools = {
  ...window.ztools,
  onPluginOut: () => {
    // window.close();
    console.log('onPluginOut')
  }
}
// const { powerSaveBlocker } = require('electron');
// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 获取插件目录
  getPluginPath() {
    return path.resolve(__dirname, "..")
  },
  // 读取目录
  readDir(path) {
    try {
      return fs.readdirSync(path, { withFileTypes: true }).map(dirent => ({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        isFile: dirent.isFile()
      }))
    } catch (e) {
      return []
    }
  },
  // 路径拼接
  pathJoin(...paths) {
    return path.join(...paths)
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  }
}
// 前端页面调用示例
// // 读取文件
// const fileContent = window.services.readFile('path/to/file.txt')
// // 写入文本文件
// const textFilePath = window.services.writeTextFile('Hello, World!')
// // 写入图片文件
// const imageFilePath = window.services.writeImageFile('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==')

// window.services.powerSaveBlocker = powerSaveBlocker

window.electronAPI = {
  closeCurrentWindow: () => {
    console.log('closeCurrentWindow')
    window.close();
  }
};