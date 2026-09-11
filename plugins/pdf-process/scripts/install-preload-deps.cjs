const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

if (process.env.PDF_PROCESS_PRELOAD_INSTALLING === '1') {
  process.exit(0)
}

const preloadDir = path.resolve(__dirname, '..', 'public', 'preload')
const lockPath = path.join(preloadDir, 'package-lock.json')
const stampPath = path.join(preloadDir, 'node_modules', '.pdf-process-lock')
const lockHash = fs.existsSync(lockPath)
  ? crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex')
  : null
const requiredPackages = [
  '@pdf-lib/fontkit',
  'docx',
  'exceljs',
  'pdf-lib',
  'pdfjs-dist',
  'pptxgenjs',
]

const installationIsCurrent =
  lockHash &&
  fs.existsSync(stampPath) &&
  fs.readFileSync(stampPath, 'utf8').trim() === lockHash &&
  requiredPackages.every((name) =>
    fs.existsSync(path.join(preloadDir, 'node_modules', ...name.split('/'), 'package.json')),
  )

if (installationIsCurrent) {
  console.log('Preload dependencies are up to date')
  process.exit(0)
}

const npmExecPath = process.env.npm_execpath
const env = {
  ...process.env,
  PDF_PROCESS_PRELOAD_INSTALLING: '1',
}

const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const npmCli = [npmExecPath, bundledNpmCli].find((candidate) => candidate && fs.existsSync(candidate))
const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmArgs = fs.existsSync(lockPath)
  ? ['ci', '--omit=optional', '--no-audit', '--no-fund']
  : ['install', '--omit=optional', '--no-audit', '--no-fund']
const args = npmCli ? [npmCli, ...npmArgs] : npmArgs

const result = spawnSync(command, args, {
  cwd: preloadDir,
  env,
  stdio: 'inherit',
  shell: !npmCli && process.platform === 'win32',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

if (result.status !== 0) process.exit(result.status ?? 1)

if (lockHash) fs.writeFileSync(stampPath, lockHash + '\n')
