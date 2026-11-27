import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve('dist')
const pluginJson = path.join(distDir, 'plugin.json')
const outputZip = path.resolve('batch-image-tools.zip')

if (!fs.existsSync(pluginJson)) {
  console.error('dist/ 未就绪，请先执行: npm run build')
  process.exit(1)
}

if (fs.existsSync(outputZip)) {
  fs.unlinkSync(outputZip)
}

const distGlob = path.join(distDir, '*').replace(/\\/g, '/')

if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${distGlob}' -DestinationPath '${outputZip}' -Force"`,
    { stdio: 'inherit' }
  )
} else {
  execSync(`cd "${distDir}" && zip -r "${outputZip}" .`, { stdio: 'inherit', shell: true })
}

console.log(`\n插件包已生成: ${outputZip}`)
console.log('在 ZTools → 已安装插件 → 更多 → 导入本地插件，选择此 zip 文件')
