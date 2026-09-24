import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(root, '..')
const dependencies = ['diff']

// preload 以 CommonJS 直接加载依赖，因此构建产物必须保留可读依赖源码。
for (const dependency of dependencies) {
  const source = path.join(projectRoot, 'node_modules', dependency)
  const target = path.join(projectRoot, 'dist', 'node_modules', dependency)
  if (!fs.existsSync(source)) throw new Error(`${dependency} dependency is missing; run npm install before building`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true })
  console.log(`Copied preload dependency: ${path.relative(projectRoot, target)}`)
}
