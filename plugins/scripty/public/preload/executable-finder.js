'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/**
 * 通用的可执行文件查找器
 *
 * 跨平台查找 node、npm、python、pip 等可执行文件的绝对路径。
 *
 * 策略：
 * - macOS/Linux: 通过用户交互式登录 shell 查询 PATH
 * - Windows: 使用 where.exe 查找，必要时重新读取用户 PATH
 */

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set(['.com', '.exe'])
const SHELL_QUERY_TIMEOUT_MS = 5000

/** Reads an environment variable using Windows' case-insensitive key semantics. */
function readEnvironmentValue(environment, name, platform) {
  if (platform !== 'win32') return environment?.[name]
  const matchedKey = Object.keys(environment ?? {}).find(key => key.toLocaleLowerCase() === name.toLocaleLowerCase())
  return matchedKey ? environment[matchedKey] : undefined
}

/** Checks if a file is executable and runnable. */
function isExecutableFile(candidate, platform, fileSystem = fs) {
  try {
    const stats = fileSystem.statSync(candidate)
    if (!stats.isFile()) return false
    if (platform !== 'win32') {
      try {
        fileSystem.accessSync(candidate, fs.constants.X_OK)
      } catch {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

/**
 * Finds executables on Windows using where.exe.
 * Returns the first match or null if not found.
 */
function findOnWindows(commandName, environment, spawnProcess = spawn) {
  return new Promise((resolve) => {
    const child = spawnProcess('where.exe', [commandName], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: environment
    })

    let stdout = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })

    const timeoutHandle = setTimeout(() => {
      try { child.kill() } catch {}
      resolve(null)
    }, SHELL_QUERY_TIMEOUT_MS)

    child.once('error', () => {
      clearTimeout(timeoutHandle)
      resolve(null)
    })

    child.once('close', (code) => {
      clearTimeout(timeoutHandle)
      if (code !== 0) {
        resolve(null)
        return
      }

      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      if (lines.length === 0) {
        resolve(null)
        return
      }

      // Return the first match
      const firstMatch = lines[0].trim()
      if (isExecutableFile(firstMatch, 'win32')) {
        resolve(firstMatch)
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * Finds executables on macOS/Linux using an interactive login shell.
 * This ensures we get the user's full PATH including version managers.
 */
function findOnUnix(commandName, platform, homeDirectory, spawnProcess = spawn) {
  return new Promise((resolve) => {
    // Use login shell to get full PATH with proper environment
    const shell = platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
    const shellArgs = ['-l', '-c', `command -v ${commandName}`]

    // Build environment - preserve more variables for proper shell initialization
    const env = {
      HOME: homeDirectory,
      USER: process.env.USER,
      LOGNAME: process.env.LOGNAME,
      SHELL: shell
    }

    // Preserve PATH if available to help shell initialization
    if (process.env.PATH) {
      env.PATH = process.env.PATH
    }

    // Preserve XDG directories for mise and other tools
    if (process.env.XDG_DATA_HOME) {
      env.XDG_DATA_HOME = process.env.XDG_DATA_HOME
    }
    if (process.env.XDG_CONFIG_HOME) {
      env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME
    }

    const child = spawnProcess(shell, shellArgs, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8')
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8')
      })
    }

    const timeoutHandle = setTimeout(() => {
      try { child.kill('SIGTERM') } catch {}
      resolve(null)
    }, SHELL_QUERY_TIMEOUT_MS)

    child.once('error', () => {
      clearTimeout(timeoutHandle)
      resolve(null)
    })

    child.once('close', (code) => {
      clearTimeout(timeoutHandle)
      if (code !== 0) {
        resolve(null)
        return
      }

      const executablePath = stdout.trim()
      if (executablePath && path.isAbsolute(executablePath) && isExecutableFile(executablePath, platform)) {
        resolve(executablePath)
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * 通用的可执行文件查找函数
 *
 * @param {string} commandName - 命令名称 (如 'node', 'npm', 'python', 'pip')
 * @param {object} options - 配置选项
 * @param {string} options.platform - 平台标识 (默认: process.platform)
 * @param {object} options.environment - 环境变量 (默认: process.env)
 * @param {string} options.homeDirectory - 用户主目录 (默认: os.homedir())
 * @param {function} options.spawnProcess - spawn 函数 (默认: child_process.spawn)
 * @returns {Promise<string|null>} 可执行文件的绝对路径，未找到时返回 null
 */
async function findExecutable(commandName, options = {}) {
  const {
    platform = process.platform,
    environment = process.env,
    homeDirectory = require('node:os').homedir(),
    spawnProcess = spawn
  } = options

  if (typeof commandName !== 'string' || !commandName.trim()) {
    return null
  }

  const trimmedCommand = commandName.trim()

  // If it's already an absolute path, verify it exists
  if (path.isAbsolute(trimmedCommand)) {
    return isExecutableFile(trimmedCommand, platform) ? trimmedCommand : null
  }

  // Platform-specific lookup
  if (platform === 'win32') {
    return await findOnWindows(trimmedCommand, environment, spawnProcess)
  } else {
    return await findOnUnix(trimmedCommand, platform, homeDirectory, spawnProcess)
  }
}

/**
 * 批量查找多个可执行文件
 *
 * @param {string[]} commandNames - 命令名称数组
 * @param {object} options - 配置选项 (同 findExecutable)
 * @returns {Promise<Map<string, string|null>>} 命令名到路径的映射
 */
async function findExecutables(commandNames, options = {}) {
  const results = new Map()

  for (const commandName of commandNames) {
    const executablePath = await findExecutable(commandName, options)
    results.set(commandName, executablePath)
  }

  return results
}

/**
 * 创建带缓存的可执行文件查找器
 *
 * @param {object} options - 配置选项
 * @returns {object} 带 find 和 clearCache 方法的查找器对象
 */
function createExecutableFinder(options = {}) {
  const cache = new Map()

  return {
    /**
     * 查找可执行文件 (带缓存)
     * @param {string} commandName - 命令名称
     * @returns {Promise<string|null>} 可执行文件路径
     */
    async find(commandName) {
      if (cache.has(commandName)) {
        return cache.get(commandName)
      }

      const result = await findExecutable(commandName, options)
      cache.set(commandName, result)
      return result
    },

    /**
     * 批量查找多个可执行文件 (带缓存)
     * @param {string[]} commandNames - 命令名称数组
     * @returns {Promise<Map<string, string|null>>} 命令名到路径的映射
     */
    async findMany(commandNames) {
      const results = new Map()
      const toFind = []

      for (const commandName of commandNames) {
        if (cache.has(commandName)) {
          results.set(commandName, cache.get(commandName))
        } else {
          toFind.push(commandName)
        }
      }

      if (toFind.length > 0) {
        const newResults = await findExecutables(toFind, options)
        for (const [commandName, executablePath] of newResults) {
          cache.set(commandName, executablePath)
          results.set(commandName, executablePath)
        }
      }

      return results
    },

    /**
     * 清除缓存
     * @param {string} [commandName] - 可选的命令名称，不提供则清除全部
     */
    clearCache(commandName) {
      if (commandName) {
        cache.delete(commandName)
      } else {
        cache.clear()
      }
    }
  }
}

module.exports = {
  findExecutable,
  findExecutables,
  createExecutableFinder,
  findOnWindows,
  findOnUnix,
  isExecutableFile,
  readEnvironmentValue
}
