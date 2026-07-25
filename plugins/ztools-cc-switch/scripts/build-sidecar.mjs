import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const crateDir = path.join(root, 'rust-sidecar')
const outputDir = path.join(root, 'preload', 'bin')
const platform = process.platform
const arch = process.arch
const supported = ['darwin', 'win32', 'linux'].includes(platform) && ['arm64', 'x64'].includes(arch)

if (!supported) throw new Error(`当前平台没有 sidecar 命名规则：${platform}-${arch}`)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function installBinary(source, filename) {
  const destination = path.join(outputDir, filename)
  const temporaryDestination = `${destination}.${process.pid}.tmp`
  mkdirSync(outputDir, { recursive: true })
  try {
    // Never rewrite a running executable in place. On macOS that can leave the
    // child process stuck in an uninterruptible exit state while the file is
    // being replaced. A complete temporary copy followed by rename is atomic.
    copyFileSync(source, temporaryDestination)
    if (platform !== 'win32') chmodSync(temporaryDestination, 0o755)
    renameSync(temporaryDestination, destination)
  } finally {
    rmSync(temporaryDestination, { force: true })
  }
  console.log(`Sidecar ready: ${path.relative(root, destination)}`)
}

const manifestPath = path.join(crateDir, 'Cargo.toml')
const executable = platform === 'win32' ? 'cc-switch-sidecar.exe' : 'cc-switch-sidecar'

if (platform === 'darwin') {
  // ZTools' platform declaration distinguishes operating systems, not CPU
  // architectures. Build both macOS targets so one reviewed package works on
  // Apple Silicon and Intel hosts regardless of the CI runner architecture.
  const targets = [
    { rust: 'aarch64-apple-darwin', ztools: 'arm64' },
    { rust: 'x86_64-apple-darwin', ztools: 'x64' }
  ]
  const installed = spawnSync('rustup', ['target', 'list', '--installed'], { cwd: root, encoding: 'utf8' })
  if (installed.error) throw installed.error
  if (installed.status !== 0) process.exit(installed.status ?? 1)

  for (const target of targets) {
    if (!installed.stdout.split(/\r?\n/).includes(target.rust)) run('rustup', ['target', 'add', target.rust])
    run('cargo', ['build', '--release', '--target', target.rust, '--manifest-path', manifestPath])
    installBinary(
      path.join(crateDir, 'target', target.rust, 'release', executable),
      `cc-switch-sidecar-darwin-${target.ztools}`
    )
  }
} else {
  run('cargo', ['build', '--release', '--manifest-path', manifestPath])
  installBinary(
    path.join(crateDir, 'target', 'release', executable),
    `cc-switch-sidecar-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`
  )
}
