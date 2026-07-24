const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// ============================================
// 通过 window 向渲染进程注入 nodejs 能力
// ============================================
window.services = {
  getConfigPath() {
    const userDataPath = window.ztools.getPath('userData') || path.join(os.homedir(), '.ztools')
    return path.join(userDataPath, 'webapp-configs.json')
  },

  readConfig() {
    try {
      const configPath = this.getConfigPath()
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, { encoding: 'utf-8' })
        return JSON.parse(data)
      }
    } catch (e) {
      console.error('读取配置失败:', e)
    }
    return []
  },

  saveConfig(configs) {
    try {
      const configPath = this.getConfigPath()
      const dir = path.dirname(configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), { encoding: 'utf-8' })
      return true
    } catch (e) {
      console.error('保存配置失败:', e)
      return false
    }
  }
}
