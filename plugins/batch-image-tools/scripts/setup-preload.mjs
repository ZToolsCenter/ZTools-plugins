import { execSync } from 'node:child_process'
import path from 'node:path'

const preloadDir = path.resolve('public/preload')

console.log('Installing preload dependencies ...')
execSync('npm install --omit=dev', { cwd: preloadDir, stdio: 'inherit' })
