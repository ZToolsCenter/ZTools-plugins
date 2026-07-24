import { existsSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import packageJson from '../package.json' with { type: 'json' }

const rootDir = resolve(new URL('..', import.meta.url).pathname)
const distDir = join(rootDir, 'dist')
const packageName = `${packageJson.name}-v${packageJson.version}.zip`
const packagePath = join(rootDir, packageName)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    ...options
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('npm', ['run', 'build'])

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(`Package failed: ${distDir} is not a directory.`)
  process.exit(1)
}

if (!existsSync(join(distDir, 'plugin.json'))) {
  console.error('Package failed: dist/plugin.json was not found.')
  process.exit(1)
}

rmSync(packagePath, { force: true })

// 使用跨平台的 JSZip 库代替系统 zip 命令
const JSZip = (await import('jszip')).default
const zip = new JSZip()

// 递归添加文件到 zip
function addFilesToZip(dirPath, zipFolder) {
  if (!zipFolder) {
    throw new Error(`Failed to obtain zip folder for ${dirPath}`)
  }
  const files = readdirSync(dirPath)
  for (const file of files) {
    const filePath = join(dirPath, file)
    const stat = statSync(filePath)

    if (stat.isDirectory()) {
      const sub = zipFolder.folder(file)
      if (!sub) {
        throw new Error(`Failed to create zip subfolder ${file}`)
      }
      addFilesToZip(filePath, sub)
    } else {
      const content = readFileSync(filePath)
      zipFolder.file(file, content)
    }
  }
}

// 直接以 zip 根作为容器；JSZip 的 zip 对象本身即为根目录
addFilesToZip(distDir, zip)

const content = await zip.generateAsync({ type: 'nodebuffer' })
writeFileSync(packagePath, content)

console.log(`\nCreated ${basename(packagePath)}`)
