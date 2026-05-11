/**
 * 自定义构建脚本
 * 执行 Vite 打包后，将 preload 所需的 node_modules 复制到 dist 目录
 */

import { execSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🔨 开始构建...\n')

// 1. 执行类型检查
console.log('1. 执行类型检查 (vue-tsc)...')
try {
  execSync('npx vue-tsc', { stdio: 'inherit' })
  console.log('✅ 类型检查通过\n')
} catch (err) {
  console.error('❌ 类型检查失败\n')
  process.exit(1)
}

// 2. 执行 Vite 打包
console.log('2. 执行 Vite 打包...')
try {
  execSync('npx vite build', { stdio: 'inherit' })
  console.log('✅ Vite 打包完成\n')
} catch (err) {
  console.error('❌ Vite 打包失败\n')
  process.exit(1)
}

// 3. 复制 preload 所需的 node_modules 到 dist/preload
console.log('3. 复制 preload 所需的 node_modules...')

const sourceModulesPath = path.join(process.cwd(), 'node_modules')
const targetModulesPath = path.join(process.cwd(), 'dist', 'preload', 'node_modules')

// preload 所需的依赖列表（只复制必要的包，减少 dist 体积）
const requiredModules = [
  'fastify',
  '@fastify/cors',
  '@fastify/multipart',
  '@fastify/static',
  'ws',
  // 这些包的依赖也会被自动复制
]

// 检查源 node_modules 是否存在
if (!fs.existsSync(sourceModulesPath)) {
  console.error('❌ 根目录 node_modules 不存在，请先运行 npm install')
  process.exit(1)
}

// 创建目标目录
if (!fs.existsSync(targetModulesPath)) {
  fs.mkdirSync(targetModulesPath, { recursive: true })
}

/**
 * 递归复制目录
 */
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * 读取包的依赖列表（包括 peerDependencies 和 dependencies）
 */
function getPackageDependencies(modulePath) {
  const packageJsonPath = path.join(modulePath, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    return []
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const dependencies = Object.keys(packageJson.dependencies || {})
    const peerDependencies = Object.keys(packageJson.peerDependencies || {})
    return [...new Set([...dependencies, ...peerDependencies])]
  } catch {
    return []
  }
}

/**
 * 收集所有需要复制的包（包括依赖）
 */
function collectAllModules(modules, collected = new Set()) {
  const modulesToProcess = []

  for (const modName of modules) {
    if (collected.has(modName)) continue

    collected.add(modName)
    const modPath = path.join(sourceModulesPath, modName)

    if (fs.existsSync(modPath)) {
      modulesToProcess.push(modName)
      const deps = getPackageDependencies(modPath)
      if (deps.length > 0) {
        const subModules = collectAllModules(deps, collected)
        modulesToProcess.push(...subModules)
      }
    }
  }

  return [...new Set(modulesToProcess)]
}

// 收集所有需要复制的模块
const allModulesToCopy = collectAllModules(requiredModules)

console.log(`   需要复制 ${allModulesToCopy.length} 个模块:\n   - ${allModulesToCopy.slice(0, 10).join(', ')}${allModulesToCopy.length > 10 ? '...' : ''}\n`)

// 复制所有需要的模块
for (const modName of allModulesToCopy) {
  const srcPath = path.join(sourceModulesPath, modName)
  const destPath = path.join(targetModulesPath, modName)

  if (fs.existsSync(srcPath)) {
    copyDirRecursive(srcPath, destPath)
    console.log(`   ✓ ${modName}`)
  }
}

console.log('\n✅ node_modules 复制完成')
console.log('\n🎉 构建成功！dist 目录已准备就绪。\n')
