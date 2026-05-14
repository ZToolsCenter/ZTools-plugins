const fs = require('node:fs')
const path = require('node:path')

window.services = {
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
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
  getFileInfo(filePath) {
    const stats = fs.statSync(filePath)
    const ext = path.extname(filePath)
    const name = path.basename(filePath, ext)
    const dir = path.dirname(filePath)
    return {
      path: filePath,
      name,
      ext,
      fullName: path.basename(filePath),
      dir,
      size: stats.size,
      createTime: stats.birthtime,
      modifyTime: stats.mtime
    }
  },
  renameFile(oldPath, newName) {
    const dir = path.dirname(oldPath)
    const newPath = path.join(dir, newName)
    if (fs.existsSync(newPath)) {
      throw new Error('目标文件已存在: ' + newName)
    }
    fs.renameSync(oldPath, newPath)
    return newPath
  },
  copyFile(oldPath, newName) {
    const dir = path.dirname(oldPath)
    const newPath = path.join(dir, newName)
    if (fs.existsSync(newPath)) {
      throw new Error('目标文件已存在: ' + newName)
    }
    fs.copyFileSync(oldPath, newPath)
    return newPath
  },
  batchRename(files, rule, copyMode = false) {
    const results = []
    let numberStart = rule.number ? rule.number.start : 1
    for (const file of files) {
      try {
        const info = this.getFileInfo(file)
        let newName = rule.prefix + info.name + rule.suffix + info.ext
        if (rule.replace && rule.replace.from) {
          newName = rule.prefix + info.name.replace(new RegExp(rule.replace.from, 'g'), rule.replace.to || '') + rule.suffix + info.ext
        }
        if (rule.number) {
          const numStr = String(numberStart).padStart(rule.number.digits || 2, '0')
          newName = rule.prefix + numStr + rule.suffix + info.ext
          numberStart++
        }
        const newPath = copyMode ? this.copyFile(file, newName) : this.renameFile(file, newName)
        results.push({ success: true, oldPath: file, newPath, newName })
      } catch (err) {
        results.push({ success: false, oldPath: file, error: err.message })
      }
    }
    return results
  },
  previewRename(files, rule) {
    const results = []
    let numberStart = rule.number ? rule.number.start : 1
    for (const file of files) {
      try {
        const info = this.getFileInfo(file)
        let newName = rule.prefix + info.name + rule.suffix + info.ext
        if (rule.replace && rule.replace.from) {
          newName = rule.prefix + info.name.replace(new RegExp(rule.replace.from, 'g'), rule.replace.to || '') + rule.suffix + info.ext
        }
        if (rule.number) {
          const numStr = String(numberStart).padStart(rule.number.digits || 2, '0')
          newName = rule.prefix + numStr + rule.suffix + info.ext
          numberStart++
        }
        results.push({ oldName: info.fullName, newName, path: file })
      } catch (err) {
        results.push({ oldName: path.basename(file), newName: '', path: file, error: err.message })
      }
    }
    return results
  }
}
