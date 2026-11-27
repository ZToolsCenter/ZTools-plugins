import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const distPreload = path.resolve('dist/preload')

if (!fs.existsSync(distPreload)) {
  console.error('dist/preload not found, run vite build first')
  process.exit(1)
}

console.log('Installing preload dependencies into dist/preload ...')
execSync('npm install --omit=dev', { cwd: distPreload, stdio: 'inherit' })
console.log('Preload dependencies ready.')
