/**
 * 构建后处理脚本
 * 用于清理 plugin.json 中的开发环境配置
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginJsonPath = path.resolve(__dirname, '../dist/plugin.json')

/**
 * 清理 plugin.json
 * 移除开发环境配置，准备生产环境部署
 */
function cleanPluginJson() {
  if (!fs.existsSync(pluginJsonPath)) {
    console.error('Error: dist/plugin.json not found.')
    process.exit(1)
  }

  try {
    const content = fs.readFileSync(pluginJsonPath, 'utf8')
    const config = JSON.parse(content)

    if (config.development) {
      delete config.development
      console.log('Successfully removed "development" from plugin.json')
    } else {
      console.log('"development" key not found in plugin.json, skipping.')
    }

    fs.writeFileSync(pluginJsonPath, JSON.stringify(config, null, 2), 'utf8')
    console.log('dist/plugin.json has been processed for production.')
  } catch (error) {
    console.error('Error processing plugin.json:', error)
    process.exit(1)
  }
}

cleanPluginJson()
