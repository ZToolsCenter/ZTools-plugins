const fs = require('node:fs')
const path = require('node:path')

window.services = {
  readLinuxCmd: () => {
    try {
      const fullPath = path.join(__dirname, '..', "md")
      console.log("linux cmd resources: ", fullPath)

      const files = fs.readdirSync(fullPath)
      return files.filter(file => file.endsWith('.md')).map(file => {
        const filePath = path.join(fullPath, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        let desc = ""
        if (lines.length > 3) {
          desc = lines[3].replace(/\r/g, '').replace(/\n/g, '')
        }

        return {
          name: file.replace('.md', ''),
          path: path.join('md', file),
          desc: desc,
        }
      })
    } catch (error) {
      console.error('读取目录失败:', error)
      return []
    }
  },
  readLinuxCmdContent: (name) => {
    try {
      const fullPath = path.join(__dirname, '..', "md", name + '.md')
      console.log("readLinuxCmdContent: ", fullPath)
      return fs.readFileSync(fullPath, 'utf-8')
    } catch (error) {
      console.error('读取文件失败:', error)
      return ''
    }
  }
}
