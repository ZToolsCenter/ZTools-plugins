const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const rootDir = __dirname
const publicDir = path.join(rootDir, 'public')
const distDir = path.join(rootDir, 'dist')
const distPreloadDir = path.join(distDir, 'preload')

ensureExists(publicDir)
resetDir(distDir)
fs.mkdirSync(distPreloadDir, { recursive: true })

copyFile(
  path.join(publicDir, 'plugin.json'),
  path.join(distDir, 'plugin.json')
)
copyFile(
  path.join(publicDir, 'logo.png'),
  path.join(distDir, 'logo.png')
)
copyFile(
  path.join(publicDir, 'preload', 'package.json'),
  path.join(distPreloadDir, 'package.json')
)

execSync('npm run build:preload', {
  cwd: rootDir,
  stdio: 'inherit',
})

console.log('构建完成：preload/services.js 已由 Vite 打包')

function ensureExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    console.error(`${targetPath} 不存在`)
    process.exit(1)
  }
}

function resetDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true })
  fs.mkdirSync(targetPath, { recursive: true })
}

function copyFile(sourcePath, targetPath) {
  ensureExists(sourcePath)
  fs.copyFileSync(sourcePath, targetPath)
}
