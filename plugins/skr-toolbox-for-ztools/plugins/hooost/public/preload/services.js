const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { exec, execSync } = require('node:child_process')
const { promisify } = require('node:util')

const APP_DIR_NAME = 'hooost'
const execAsync = promisify(exec)

function escapePowerShellArg(value) {
  return String(value).replace(/'/g, "''")
}

function runCommand(command, options = {}) {
  execSync(command, { stdio: 'ignore', ...options })
}

async function runCommandAsync(command, options = {}) {
  await execAsync(command, { windowsHide: true, ...options })
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function getDataDir() {
  if (os.platform() === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      APP_DIR_NAME
    )
  }

  return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME)
}

function getHostsPath() {
  return os.platform() === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts'
}

function getBackupsDir() {
  const dir = path.join(getDataDir(), 'backups')
  ensureDir(dir)
  return dir
}

function getTmpDir() {
  const dir = path.join(getDataDir(), 'tmp')
  ensureDir(dir)
  return dir
}

function createTimestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').substring(0, 15)
}

function createBackupFileName(name) {
  const safeName = name ? String(name).replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown'
  return `${createTimestamp()}_${safeName}.hosts`
}

function backupCurrentHosts(name) {
  const hostsPath = getHostsPath()
  const backupPath = path.join(getBackupsDir(), createBackupFileName(name))
  fs.copyFileSync(hostsPath, backupPath)
  return backupPath
}

function createTempHostsFile(content) {
  const tmpFile = path.join(getTmpDir(), `hosts_${Date.now()}`)
  fs.writeFileSync(tmpFile, content, { encoding: 'utf-8' })
  return tmpFile
}

function removeTempFile(filePath) {
  if (!filePath) return

  try {
    fs.unlinkSync(filePath)
  } catch {
    // ignore
  }
}

function copyFileElevatedOnWindows(sourcePath, targetPath) {
  const source = escapePowerShellArg(sourcePath)
  const target = escapePowerShellArg(targetPath)
  const innerCommand = `$ErrorActionPreference = 'Stop'; Copy-Item -LiteralPath '${source}' -Destination '${target}' -Force`
  const encodedCommand = Buffer.from(innerCommand, 'utf16le').toString('base64')

  runCommand(
    `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}'"`
  )
}

function copyFileWithPrivilege(sourcePath, targetPath) {
  try {
    fs.copyFileSync(sourcePath, targetPath)
    return
  } catch {
    copyFileElevatedOnWindows(sourcePath, targetPath)
  }
}

function isWritable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function ensureMacHostsWritable(hostsPath) {
  if (isWritable(hostsPath)) return

  const chmodCommand = `chmod go+w ${JSON.stringify(hostsPath)}`

  try {
    await runCommandAsync(chmodCommand)
    return
  } catch {
    const appleScript = `do shell script ${JSON.stringify(chmodCommand)} with administrator privileges`
    await runCommandAsync(`osascript -e ${JSON.stringify(appleScript)}`)
  }
}

async function writeHostsContent(content, hostsPath, platform) {
  if (platform === 'win32') {
    const tmpFile = createTempHostsFile(content)

    try {
      copyFileWithPrivilege(tmpFile, hostsPath)
    } finally {
      removeTempFile(tmpFile)
    }
    return
  }

  if (platform === 'darwin') {
    await ensureMacHostsWritable(hostsPath)
  }

  fs.writeFileSync(hostsPath, content, { encoding: 'utf-8' })
}

function flushDns(platform) {
  try {
    if (platform === 'win32') {
      runCommand('ipconfig /flushdns')
      return
    }

    if (platform === 'darwin') {
      runCommand('dscacheutil -flushcache')
      runCommand('killall -HUP mDNSResponder')
      return
    }
  } catch {
    // ignore
  }
}

function getBackupEntries() {
  return fs
    .readdirSync(getBackupsDir())
    .filter((file) => file.endsWith('.hosts'))
    .sort()
    .reverse()
    .map((file) => {
      const fullPath = path.join(getBackupsDir(), file)
      let stat = null

      try {
        stat = fs.statSync(fullPath)
      } catch {
        stat = null
      }

      return {
        filename: file,
        path: fullPath,
        createdAt: stat ? stat.mtime.toISOString() : '',
      }
    })
}

window.services = {
  getSystemInfo() {
    const platform = os.platform()
    return {
      platform: platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux',
      hostsPath: getHostsPath(),
      dataDir: getDataDir(),
    }
  },

  getThemeInfo() {
    return window.ztools.getThemeInfo()
  },

  onThemeChange(callback) {
    window.ztools.onThemeChange(callback)
  },

  readHosts() {
    return fs.readFileSync(getHostsPath(), { encoding: 'utf-8' })
  },

  listBackups() {
    return getBackupEntries()
  },

  async applyHosts(content, envName) {
    const hostsPath = getHostsPath()
    const platform = os.platform()
    const normalizedContent = platform === 'win32' ? content : content.replace(/\r\n/g, '\n')
    const backupPath = backupCurrentHosts(envName)

    try {
      await writeHostsContent(normalizedContent, hostsPath, platform)
      flushDns(platform)
      return { success: true, backupPath }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        backupPath,
      }
    }
  },

  async restoreBackup(backupPath) {
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: '备份文件不存在' }
    }

    const hostsPath = getHostsPath()
    const platform = os.platform()
    const content = fs.readFileSync(backupPath, { encoding: 'utf-8' })

    try {
      backupCurrentHosts('pre-restore')
    } catch {
      // ignore
    }

    try {
      await writeHostsContent(content, hostsPath, platform)
      flushDns(platform)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
}
