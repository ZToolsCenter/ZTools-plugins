const fs = require('node:fs')
const path = require('node:path')

const pluginJsonPath = path.join(__dirname, '..', 'dist', 'plugin.json')

if (!fs.existsSync(pluginJsonPath)) {
  process.exit(0)
}

const pluginConfig = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'))
delete pluginConfig.development
fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginConfig, null, 2) + '\n')
