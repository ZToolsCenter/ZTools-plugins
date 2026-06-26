const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')

if (!fs.existsSync(distDir)) {
  console.error('dist/ directory not found. Run `pnpm build` first.')
  process.exit(1)
}

const pluginJson = JSON.parse(fs.readFileSync(path.join(distDir, 'plugin.json'), 'utf-8'))
const pluginName = pluginJson.name || 'skill-hub'
const version = pluginJson.version || '1.0.0'
const zipName = `${pluginName}-${version}.zip`
const AdmZip = require(path.join(projectRoot, 'public', 'preload', 'node_modules', 'adm-zip'))
const zip = new AdmZip()

function addDirToZip(zipInstance, dirPath, zipPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    const entryPath = zipPath ? `${zipPath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      addDirToZip(zipInstance, fullPath, entryPath)
    } else {
      zipInstance.addLocalFile(fullPath, path.dirname(entryPath) || '.')
    }
  }
}

addDirToZip(zip, distDir, '')

const tmpPath = path.join(distDir, zipName)
zip.writeZip(tmpPath)

function getDownloadsDir() {
  if (process.platform === 'win32') {
    try {
      const psScript = `(New-Object -ComObject Shell.Application).NameSpace('Shell:Downloads').Self.Path`
      const result = execSync(`powershell -NoProfile -Command "${psScript}"`, { encoding: 'utf-8' }).trim()
      if (result && fs.existsSync(result)) return result
    } catch {}
  }
  return path.join(os.homedir(), 'Downloads')
}

const downloadsDir = getDownloadsDir()
fs.mkdirSync(downloadsDir, { recursive: true })
const outputPath = path.join(downloadsDir, zipName)
fs.copyFileSync(tmpPath, outputPath)
fs.unlinkSync(tmpPath)

const stats = fs.statSync(outputPath)
const sizeKB = (stats.size / 1024).toFixed(1)
console.log(`Plugin zip moved to: ${outputPath} (${sizeKB} KB)`)
