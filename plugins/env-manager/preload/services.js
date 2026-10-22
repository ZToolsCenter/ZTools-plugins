const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { exec, execFileSync } = require('node:child_process')

// 内联 URL 验证函数，避免依赖 validator 包
function isValidURL(str) {
  if (!str || typeof str !== 'string') return false
  try {
    const url = new URL(str)
    // 只允许 http 和 https 协议
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (e) {
    return false
  }
}

function getRegExePath() {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'reg.exe')
}

function getPowerShellPath() {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function regQuery(keyPath) {
  return execFileSync(getRegExePath(), ['query', keyPath], {
    encoding: 'utf-8',
    windowsHide: true,
    // 环境变量（尤其 PATH）可能很长，默认 1MB 容易触发 ENOBUFS
    maxBuffer: 1024 * 1024 * 50
  })
}

function regAdd(scope, name, value) {
  // 写入操作不需要 stdout；保留 stderr 用于权限/错误判断
  return execFileSync(getRegExePath(), ['add', scope, '/v', name, '/t', 'REG_EXPAND_SZ', '/d', value, '/f'], {
    encoding: 'utf-8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 50,
    stdio: ['ignore', 'ignore', 'pipe']
  })
}

function regDelete(scope, name) {
  return execFileSync(getRegExePath(), ['delete', scope, '/v', name, '/f'], {
    encoding: 'utf-8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 50,
    stdio: ['ignore', 'ignore', 'pipe']
  })
}

/**
 * 通过 UAC 提权执行环境变量修改
 * 用 Base64 传递参数避免命令行的引号转义问题，并检查提升进程的退出码
 */
function regAddElevated(scope, name, value) {
  const isSystem = scope.includes('HKLM') || scope.includes('SYSTEM')
  
  const base64Name = Buffer.from(name, 'utf-8').toString('base64')
  const base64Value = Buffer.from(value, 'utf-8').toString('base64')
  
  // 构建临时执行脚本 (无命令行转义困扰)
  const ps1File = path.join(os.tmpdir(), '_utools_env_uac_add_' + Date.now() + '.ps1')
  const psScript = `
$ErrorActionPreference = 'Stop'
try {
  $name = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Name}'))
  $value = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Value}'))
  $keyPath = '${isSystem ? 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' : 'Environment'}'
  $baseKey = ${isSystem ? '[Microsoft.Win32.Registry]::LocalMachine' : '[Microsoft.Win32.Registry]::CurrentUser'}
  $key = $baseKey.OpenSubKey($keyPath, $true)
  if ($null -eq $key) { exit 1 }
  $key.SetValue($name, $value, [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $key.Close()
  exit 0
} catch {
  exit 1
}
`
  
  fs.writeFileSync(ps1File, psScript, { encoding: 'utf-8' })
  
  const runPsCmd = `
$ErrorActionPreference = 'Stop'
try {
  $proc = Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${ps1File.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru
  if ($null -ne $proc) {
    exit $proc.ExitCode
  }
} catch {
  exit 1223
}
exit 1
`
  
  try {
    execFileSync(getPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', runPsCmd], {
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 50,
      timeout: 120000 // 2分钟超时容等待用户 UAC 弹窗处理
    })
  } catch (error) {
    if (error.status === 1223 || (error.stderr && (error.stderr.includes('Canceled') || error.stderr.includes('被用户取消')))) {
      throw new Error('Canceled by user')
    }
    throw new Error('提权执行修改失败，退出码: ' + error.status)
  } finally {
    try { fs.unlinkSync(ps1File) } catch (_) { /* 忽略 */ }
  }
}

/**
 * 通过 UAC 提权执行环境变量删除操作
 */
function regDeleteElevated(scope, name) {
  const isSystem = scope.includes('HKLM') || scope.includes('SYSTEM')
  
  const base64Name = Buffer.from(name, 'utf-8').toString('base64')
  const ps1File = path.join(os.tmpdir(), '_utools_env_uac_del_' + Date.now() + '.ps1')
  
  const psScript = `
$ErrorActionPreference = 'Stop'
try {
  $name = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Name}'))
  $keyPath = '${isSystem ? 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' : 'Environment'}'
  $baseKey = ${isSystem ? '[Microsoft.Win32.Registry]::LocalMachine' : '[Microsoft.Win32.Registry]::CurrentUser'}
  $key = $baseKey.OpenSubKey($keyPath, $true)
  if ($null -ne $key) {
    if ($null -ne $key.GetValue($name)) {
      $key.DeleteValue($name)
    }
    $key.Close()
  }
  exit 0
} catch {
  exit 1
}
`
  
  fs.writeFileSync(ps1File, psScript, { encoding: 'utf-8' })
  
  const runPsCmd = `
$ErrorActionPreference = 'Stop'
try {
  $proc = Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${ps1File.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru
  if ($null -ne $proc) {
    exit $proc.ExitCode
  }
} catch {
  exit 1223
}
exit 1
`
  
  try {
    execFileSync(getPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', runPsCmd], {
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 50,
      timeout: 120000
    })
  } catch (error) {
    if (error.status === 1223 || (error.stderr && (error.stderr.includes('Canceled') || error.stderr.includes('被用户取消')))) {
      throw new Error('Canceled by user')
    }
    throw new Error('提权执行删除失败，退出码: ' + error.status)
  } finally {
    try { fs.unlinkSync(ps1File) } catch (_) { /* 忽略 */ }
  }
}

// ---------------------------------------------------------------------------
// 批量提权：导入配置时一次性写入/删除多个系统环境变量，只弹一次 UAC
// ---------------------------------------------------------------------------

function toBase64(text) {
  return Buffer.from(String(text == null ? '' : text), 'utf-8').toString('base64')
}

/**
 * 生成临时 ps1 并通过 UAC 提权执行
 */
function runElevatedPowerShell(psScript, failMessage) {
  const ps1File = path.join(
    os.tmpdir(),
    '_ztools_env_uac_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.ps1'
  )
  fs.writeFileSync(ps1File, psScript, { encoding: 'utf-8' })

  const runPsCmd = `
$ErrorActionPreference = 'Stop'
try {
  $proc = Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${ps1File.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru
  if ($null -ne $proc) {
    exit $proc.ExitCode
  }
} catch {
  exit 1223
}
exit 1
`

  try {
    execFileSync(getPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', runPsCmd], {
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 50,
      timeout: 300000
    })
  } catch (error) {
    if (error.status === 1223 || (error.stderr && (error.stderr.includes('Canceled') || error.stderr.includes('被用户取消')))) {
      throw new Error('Canceled by user')
    }
    throw new Error(failMessage + '，退出码: ' + error.status)
  } finally {
    try { fs.unlinkSync(ps1File) } catch (_) { /* 忽略 */ }
  }
}

/**
 * 通过一次 UAC 提权批量写入系统环境变量
 * @param {{name: string, value: string}[]} entries
 */
function regBatchAddElevated(entries) {
  const items = entries.map(function (item) {
    return "  @{ n = '" + toBase64(item.name) + "'; v = '" + toBase64(item.value) + "' }"
  }).join(",\n")

  const psScript = `
$ErrorActionPreference = 'Stop'
try {
  $keyPath = 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
  $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($keyPath, $true)
  if ($null -eq $key) { exit 1 }
  $entries = @(
${items}
  )
  foreach ($e in $entries) {
    $name = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($e.n))
    $value = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($e.v))
    $key.SetValue($name, $value, [Microsoft.Win32.RegistryValueKind]::ExpandString)
  }
  $key.Close()
  exit 0
} catch {
  exit 1
}
`

  runElevatedPowerShell(psScript, '提权执行修改失败')
}

/**
 * 通过一次 UAC 提权批量删除系统环境变量
 * @param {string[]} names
 */
function regBatchDeleteElevated(names) {
  const items = names.map(function (name) {
    return "  @{ n = '" + toBase64(name) + "' }"
  }).join(",\n")

  const psScript = `
$ErrorActionPreference = 'Stop'
try {
  $keyPath = 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
  $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($keyPath, $true)
  if ($null -eq $key) { exit 1 }
  $entries = @(
${items}
  )
  foreach ($e in $entries) {
    $name = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($e.n))
    if ($null -ne $key.GetValue($name)) {
      $key.DeleteValue($name)
    }
  }
  $key.Close()
  exit 0
} catch {
  exit 1
}
`

  runElevatedPowerShell(psScript, '提权执行删除失败')
}

// 缓存管理员权限检查结果（在整个 preload 生命周期内）
let _isAdminCached = null
function isCurrentProcessAdmin() {
  if (_isAdminCached !== null) return _isAdminCached
  try {
    const testKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
    const testVarName = '_UTOOLS_ADMIN_TEST_'
    execFileSync(getRegExePath(), ['add', testKey, '/v', testVarName, '/t', 'REG_SZ', '/d', 'test', '/f'], {
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 50,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    execFileSync(getRegExePath(), ['delete', testKey, '/v', testVarName, '/f'], {
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 50,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    _isAdminCached = true
  } catch (_) {
    _isAdminCached = false
  }
  return _isAdminCached
}

function validateExportFolder(exportFolder) {
  if (!exportFolder) {
    return { valid: false, message: '请先设置默认导出文件夹' }
  }
  if (!fs.existsSync(exportFolder)) {
    return { valid: false, message: '默认导出文件夹不存在' }
  }

  const stat = fs.statSync(exportFolder)
  if (!stat.isDirectory()) {
    return { valid: false, message: '默认导出路径不是文件夹' }
  }

  return { valid: true }
}

function writeJsonFile(filePath, data) {
  const jsonStr = JSON.stringify(data, null, 2)
  fs.writeFileSync(filePath, jsonStr, { encoding: 'utf-8' })
}

function listConfigBackupFiles(exportFolder) {
  return fs.readdirSync(exportFolder)
    .filter(function (fileName) {
      return fileName.toLowerCase().endsWith('.json')
    })
    .map(function (fileName) {
      const filePath = path.join(exportFolder, fileName)
      try {
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) return null
        const data = readConfigBackupFile(filePath)
        return {
          name: fileName,
          path: filePath,
          mtimeMs: stat.mtimeMs,
          exportTimeMs: getConfigExportTimeMs(data)
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function cleanupConfigBackupFiles(exportFolder, maxFiles) {
  if (maxFiles === undefined || maxFiles === null || maxFiles === '') return []

  const normalizedMaxFiles = Math.max(1, Math.floor(Number(maxFiles) || 1))
  const files = listConfigBackupFiles(exportFolder).sort(compareBackupFilesNewestFirst)
  const removedFiles = files.slice(normalizedMaxFiles)

  removedFiles.forEach(function (file) {
    moveFileToRecycleBin(file.path)
  })

  return removedFiles.map(function (file) { return file.path })
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys)
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce(function (result, key) {
      result[key] = sortObjectKeys(value[key])
      return result
    }, {})
  }

  return value
}

function normalizeConfigForCompare(config) {
  const clone = JSON.parse(JSON.stringify(config || {}))
  if (clone && typeof clone === 'object' && !Array.isArray(clone)) {
    delete clone.exportTime
  }
  return sortObjectKeys(clone)
}

function getConfigCompareKey(config) {
  return JSON.stringify(normalizeConfigForCompare(config))
}

function getConfigExportTimeMs(config) {
  const time = new Date(config && config.exportTime ? config.exportTime : 0).getTime()
  return Number.isNaN(time) ? 0 : time
}

function compareBackupFilesNewestFirst(a, b) {
  if (a.exportTimeMs !== b.exportTimeMs) return b.exportTimeMs - a.exportTimeMs
  if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
  return b.name.localeCompare(a.name)
}

function isConfigBackupData(data) {
  const envVars = data && typeof data === 'object' ? data.env_vars : null
  if (!envVars || typeof envVars !== 'object') return false
  return Array.isArray(envVars.system_vars) || Array.isArray(envVars.user_vars)
}

function isPathInFolder(filePath, folderPath) {
  const resolvedFile = path.resolve(filePath)
  const resolvedFolder = path.resolve(folderPath)
  const relativePath = path.relative(resolvedFolder, resolvedFile)
  return !!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function readConfigBackupFile(filePath) {
  const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
  const data = JSON.parse(content)
  if (!isConfigBackupData(data)) {
    throw new Error('不是有效的配置备份文件')
  }
  return data
}

function isPathLikeExportItem(value) {
  const text = String(value || '')
  return /^[a-zA-Z]:[\\/]/.test(text)
    || /^\\\\/.test(text)
    || /%[^%]+%/.test(text)
    || text.includes('\\')
    || text.includes('/')
}

function countPathItems(vars) {
  return (Array.isArray(vars) ? vars : []).reduce(function (count, item) {
    const name = String(item && item.name ? item.name : '').toLowerCase()
    const value = String(item && item.value ? item.value : '')
    const parts = value.split(';').map(function (pathItem) {
      return pathItem.trim()
    }).filter(Boolean)

    if (parts.length <= 1) return count
    if (name === 'path') return count + parts.length
    if (name.includes('path') && parts.some(isPathLikeExportItem)) return count + parts.length
    return count
  }, 0)
}

function moveFileToRecycleBin(filePath) {
  const resolvedPath = path.resolve(filePath)
  if (!fs.existsSync(resolvedPath)) return

  const escapedPath = resolvedPath.replace(/'/g, "''")
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$target = '${escapedPath}'
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
  $target,
  [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
  [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
)
`

  execFileSync(getPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf-8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10
  })
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile: function (file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },

  // 文本写入到下载目录
  writeTextFile: function (text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },

  // 图片写入到下载目录
  writeImageFile: function (base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },

  // ===== 环境变量管理 API =====

  /**
   * 获取所有环境变量
   */
  getEnvVars: function () {
    try {
      // 读取系统环境变量
      const systemResult = regQuery('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
      const systemVars = this._parseRegOutput(systemResult)

      // 读取用户环境变量
      const userResult = regQuery('HKCU\\Environment')
      const userVars = this._parseRegOutput(userResult)

      return {
        systemVars: systemVars.sort(function (a, b) { return a.name.localeCompare(b.name) }),
        userVars: userVars.sort(function (a, b) { return a.name.localeCompare(b.name) })
      }
    } catch (error) {
      console.error('获取环境变量失败:', error)
      throw new Error('获取环境变量失败: ' + error.message)
    }
  },

  /**
   * 解析注册表输出
   */
  _parseRegOutput: function (output) {
    const vars = []
    const lines = output.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      // 跳过空行和标题行
      if (!line || line.startsWith('HKEY_') || line.includes('End of search')) continue

      // 匹配格式: NAME    REG_SZ/REG_EXPAND_SZ    VALUE
      const match = line.match(/^(\S+)\s+(REG_SZ|REG_EXPAND_SZ|REG_MULTI_SZ)\s+(.*)$/)
      if (match) {
        vars.push({
          name: match[1].trim(),
          value: match[3].trim()
        })
      }
    }

    return vars
  },

  /**
   * 设置环境变量
   */
  setEnvVar: function (name, value, isSystem) {
    if (isSystem === undefined) isSystem = false

    try {
      const scope = isSystem ? 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' : 'HKCU\\Environment'
      
      if (isSystem && !isCurrentProcessAdmin()) {
        regAddElevated(scope, name, value)
      } else {
        regAdd(scope, name, value)
      }

      return { success: true }
    } catch (error) {
      console.error('设置环境变量失败:', error)
      const errorMsg = error.message || error.toString()
      // 如果是被 PowerShell 错误处理，或者提权失败的情况
      if (errorMsg.includes('Canceled by user') || errorMsg.includes('被用户取消')) {
        throw new Error('操作已取消：用户拒绝了 UAC 授权')
      }
      if (errorMsg.includes('Access is denied') || errorMsg.includes('拒绝访问') || errorMsg.indexOf('拒绝') !== -1 || errorMsg.includes('denied')) {
        throw new Error('权限不足：提权失败或被拒绝')
      }
      throw new Error('设置环境变量失败: ' + errorMsg)
    }
  },

  /**
   * 删除环境变量
   */
  deleteEnvVar: function (name, isSystem) {
    if (isSystem === undefined) isSystem = false

    try {
      const scope = isSystem ? 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' : 'HKCU\\Environment'
      
      if (isSystem && !isCurrentProcessAdmin()) {
        regDeleteElevated(scope, name)
      } else {
        regDelete(scope, name)
      }

      return { success: true }
    } catch (error) {
      console.error('删除环境变量失败:', error)
      const errorMsg = error.message || error.toString()
      if (errorMsg.includes('Canceled by user') || errorMsg.includes('被用户取消')) {
        throw new Error('操作已取消：用户拒绝了 UAC 授权')
      }
      if (errorMsg.includes('Access is denied') || errorMsg.includes('拒绝访问') || errorMsg.indexOf('拒绝') !== -1 || errorMsg.includes('denied')) {
        throw new Error('权限不足：提权失败或被拒绝')
      }
      throw new Error('删除环境变量失败: ' + errorMsg)
    }
  },

  /**
   * 批量设置环境变量
   * 系统变量在无管理员权限时通过一次 UAC 提权完成，不会因为无权限而跳过
   */
  setEnvVarsBatch: function (vars, isSystem) {
    if (!Array.isArray(vars) || vars.length === 0) return { success: true, updated: 0 }
    if (isSystem === undefined) isSystem = false

    const scope = isSystem
      ? 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
      : 'HKCU\\Environment'

    try {
      if (isSystem && !isCurrentProcessAdmin()) {
        regBatchAddElevated(vars)
      } else {
        vars.forEach(function (item) {
          regAdd(scope, item.name, item.value)
        })
      }
      return { success: true, updated: vars.length }
    } catch (error) {
      console.error('批量设置环境变量失败:', error)
      const errorMsg = error.message || error.toString()
      if (errorMsg.includes('Canceled by user') || errorMsg.includes('被用户取消')) {
        throw new Error('操作已取消：用户拒绝了 UAC 授权')
      }
      if (errorMsg.includes('Access is denied') || errorMsg.includes('拒绝访问') || errorMsg.indexOf('拒绝') !== -1 || errorMsg.includes('denied')) {
        throw new Error('权限不足：提权失败或被拒绝')
      }
      throw new Error('批量设置环境变量失败: ' + errorMsg)
    }
  },

  /**
   * 批量删除环境变量
   * 系统变量在无管理员权限时通过一次 UAC 提权完成
   */
  deleteEnvVarsBatch: function (names, isSystem) {
    if (!Array.isArray(names) || names.length === 0) return { success: true, deleted: 0 }
    if (isSystem === undefined) isSystem = false

    const scope = isSystem
      ? 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
      : 'HKCU\\Environment'

    try {
      if (isSystem && !isCurrentProcessAdmin()) {
        regBatchDeleteElevated(names)
      } else {
        names.forEach(function (name) {
          regDelete(scope, name)
        })
      }
      return { success: true, deleted: names.length }
    } catch (error) {
      console.error('批量删除环境变量失败:', error)
      const errorMsg = error.message || error.toString()
      if (errorMsg.includes('Canceled by user') || errorMsg.includes('被用户取消')) {
        throw new Error('操作已取消：用户拒绝了 UAC 授权')
      }
      if (errorMsg.includes('Access is denied') || errorMsg.includes('拒绝访问') || errorMsg.indexOf('拒绝') !== -1 || errorMsg.includes('denied')) {
        throw new Error('权限不足：提权失败或被拒绝')
      }
      throw new Error('批量删除环境变量失败: ' + errorMsg)
    }
  },

  /**
   * 检查是否有管理员权限
   */
  checkAdminPrivileges: function () {
    return isCurrentProcessAdmin()
  },

  /**
   * 导出环境变量到文件
   */
  exportEnvVars: function (data, filePath) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8' })
      return { success: true, path: filePath }
    } catch (error) {
      throw new Error('导出失败: ' + error.message)
    }
  },

  /**
   * 导出环境变量（使用默认路径）
   */
  exportEnvVarsWithDefaultPath: function (data, fileName) {
    try {
      const exportPath = window.ztools.getPath('documents')
      const filePath = path.join(exportPath, fileName)
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8' })
      return { success: true, path: filePath }
    } catch (error) {
      throw new Error('导出失败: ' + error.message)
    }
  },

  /**
   * 路径拼接
   */
  joinPath: function () {
    return path.join.apply(path, arguments)
  },

  /**
   * 从文件导入环境变量
   */
  importEnvVars: function (filePath) {
    try {
      const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
      const data = JSON.parse(content)
      return { success: true, data: data }
    } catch (error) {
      throw new Error('导入失败: ' + error.message)
    }
  },

  /**
   * 打开文件夹
   */
  openFolder: function (folderPath) {
    try {
      if (fs.existsSync(folderPath)) {
        exec('explorer "' + folderPath + '"')
        return { success: true }
      } else {
        throw new Error('路径不存在')
      }
    } catch (error) {
      throw new Error('打开文件夹失败: ' + error.message)
    }
  },

  /**
   * 在资源管理器中显示文件
   */
  revealInExplorer: function (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        exec('explorer /select,"' + filePath + '"')
        return { success: true }
      } else {
        throw new Error('文件不存在')
      }
    } catch (error) {
      throw new Error('打开失败: ' + error.message)
    }
  },

  /**
   * 导出JSON配置文件
   */
  exportConfig: function (configData, defaultFileName, exportFolder, maxFiles) {
    if (!defaultFileName) defaultFileName = 'config.json'

    try {
      if (exportFolder) {
        const folderCheck = validateExportFolder(exportFolder)
        if (!folderCheck.valid) return { success: false, message: folderCheck.message }

        const filePath = path.join(exportFolder, defaultFileName)
        writeJsonFile(filePath, configData)
        const removedFiles = cleanupConfigBackupFiles(exportFolder, maxFiles)
        return { success: true, path: filePath, removedFiles: removedFiles }
      }

      const savePath = window.ztools.showSaveDialog({
        title: '保存配置文件',
        defaultPath: path.join(window.ztools.getPath('documents'), defaultFileName),
        buttonLabel: '保存',
        filters: [
          { name: 'JSON文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (savePath) {
        writeJsonFile(savePath, configData)
        return { success: true, path: savePath }
      }
      return { success: false, message: '用户取消保存' }
    } catch (error) {
      return { success: false, message: error.message }
    }
  },

  /**
   * 列出默认导出目录中的配置备份文件
   */
  listExportConfigFiles: function (exportFolder) {
    try {
      const folderCheck = validateExportFolder(exportFolder)
      if (!folderCheck.valid) return { success: false, message: folderCheck.message }

      const files = fs.readdirSync(exportFolder)
        .filter(function (fileName) {
          return fileName.toLowerCase().endsWith('.json')
        })
        .map(function (fileName) {
          const filePath = path.join(exportFolder, fileName)
          try {
            const stat = fs.statSync(filePath)
            if (!stat.isFile()) return null

            const data = readConfigBackupFile(filePath)
            const systemVars = data.env_vars?.system_vars || []
            const userVars = data.env_vars?.user_vars || []
            const systemPathItemCount = countPathItems(systemVars)
            const userPathItemCount = countPathItems(userVars)
            return {
              name: fileName,
              path: filePath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              exportTime: data.exportTime || '',
              systemVarCount: systemVars.length,
              userVarCount: userVars.length,
              systemPathItemCount: systemPathItemCount,
              userPathItemCount: userPathItemCount,
              pathItemCount: systemPathItemCount + userPathItemCount
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)
        .sort(function (a, b) {
          if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
          return a.name.localeCompare(b.name)
        })

      return { success: true, files: files }
    } catch (error) {
      return { success: false, message: error.message }
    }
  },

  /**
   * 清理默认导出目录中配置内容完全相同的重复备份文件
   */
  cleanupDuplicateConfigFiles: function (exportFolder, currentConfig) {
    try {
      const folderCheck = validateExportFolder(exportFolder)
      if (!folderCheck.valid) return { success: false, message: folderCheck.message }

      const currentConfigKey = currentConfig ? getConfigCompareKey(currentConfig) : ''
      const files = fs.readdirSync(exportFolder)
        .filter(function (fileName) {
          return fileName.toLowerCase().endsWith('.json')
        })
        .map(function (fileName) {
          const filePath = path.join(exportFolder, fileName)
          try {
            const stat = fs.statSync(filePath)
            if (!stat.isFile()) return null

            const data = readConfigBackupFile(filePath)
            const configKey = getConfigCompareKey(data)
            return {
              name: fileName,
              path: filePath,
              mtimeMs: stat.mtimeMs,
              exportTimeMs: getConfigExportTimeMs(data),
              configKey: configKey,
              matchesCurrent: !!currentConfigKey && configKey === currentConfigKey
            }
          } catch {
            return null
          }
        })
        .filter(Boolean)

      const groups = files.reduce(function (result, file) {
        if (!result.has(file.configKey)) result.set(file.configKey, [])
        result.get(file.configKey).push(file)
        return result
      }, new Map())

      const removedFiles = []
      let duplicateGroupCount = 0
      let currentMatchCount = 0
      let currentMatchRemovedCount = 0

      groups.forEach(function (group) {
        group.sort(compareBackupFilesNewestFirst)
        if (group[0] && group[0].matchesCurrent) currentMatchCount = group.length
        if (group.length <= 1) return

        duplicateGroupCount += 1
        group.slice(1).forEach(function (file) {
          moveFileToRecycleBin(file.path)
          removedFiles.push({
            name: file.name,
            path: file.path,
            matchesCurrent: file.matchesCurrent
          })
          if (file.matchesCurrent) currentMatchRemovedCount += 1
        })
      })

      return {
        success: true,
        removedCount: removedFiles.length,
        removedFiles: removedFiles,
        duplicateGroupCount: duplicateGroupCount,
        currentMatchCount: currentMatchCount,
        currentMatchRemovedCount: currentMatchRemovedCount
      }
    } catch (error) {
      return { success: false, message: error.message }
    }
  },

  /**
   * 读取默认导出目录中的配置备份文件
   */
  readExportConfigFile: function (filePath, exportFolder) {
    try {
      const folderCheck = validateExportFolder(exportFolder)
      if (!folderCheck.valid) return { success: false, message: folderCheck.message }
      if (!filePath || !isPathInFolder(filePath, exportFolder)) {
        return { success: false, message: '配置文件不在默认导出文件夹内' }
      }
      if (!filePath.toLowerCase().endsWith('.json')) {
        return { success: false, message: '只支持读取 JSON 配置文件' }
      }

      const stat = fs.statSync(filePath)
      if (!stat.isFile()) return { success: false, message: '配置文件不存在' }

      return {
        success: true,
        path: filePath,
        data: readConfigBackupFile(filePath)
      }
    } catch (error) {
      return { success: false, message: error.message }
    }
  },

  /**
   * 选择默认导出文件夹
   */
  selectExportFolder: function (defaultPath) {
    try {
      const openPath = window.ztools.showOpenDialog({
        title: '选择默认导出文件夹',
        defaultPath: defaultPath || window.ztools.getPath('documents'),
        buttonLabel: '选择',
        properties: ['openDirectory', 'createDirectory']
      })

      if (openPath && openPath.length > 0) {
        return { success: true, path: openPath[0] }
      }
      return { success: false, message: '用户取消选择' }
    } catch (error) {
      return { success: false, message: error.message }
    }
  },

  /**
   * 导入JSON配置文件
   */
  importConfig: function () {
    try {
      const openPath = window.ztools.showOpenDialog({
        title: '选择配置文件',
        defaultPath: window.ztools.getPath('documents'),
        buttonLabel: '导入',
        filters: [
          { name: 'JSON文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (openPath && openPath.length > 0) {
        const filePath = openPath[0]
        const content = fs.readFileSync(filePath, { encoding: 'utf-8' })
        const config = JSON.parse(content)
        return { success: true, data: config, path: filePath }
      }
      return { success: false, message: '用户取消选择' }
    } catch (error) {
      return { success: false, message: error.message }
    }
  },

  /**
   * 检查路径是否存在(检查目录和文件)
   */
  checkPathExists: function (pathStr) {
    try {
      // 去除 file: 前缀
      let cleanPath = pathStr.replace(/^file:/, '')

      // 展开环境变量
      cleanPath = this.expandEnvVars(cleanPath)

      // 检查路径是否存在
      return fs.existsSync(cleanPath)
    } catch (error) {
      return false
    }
  },

  /**
   * 判断路径是否为目录(不是文件)
   * 返回 null 表示路径不存在,false 表示是文件,true 表示是目录
   */
  isDirectory: function (pathStr) {
    try {
      let cleanPath = pathStr.replace(/^file:/, '')
      // 展开环境变量
      cleanPath = this.expandEnvVars(cleanPath)

      if (!fs.existsSync(cleanPath)) {
        return null // 路径不存在
      }
      const stat = fs.statSync(cleanPath)
      return stat.isDirectory()
    } catch (error) {
      return null
    }
  },

  /**
   * 展开路径中的环境变量
   * 例如: %USERPROFILE%\.dotnet\tools -> C:\Users\username\.dotnet\tools
   */
  expandEnvVars: function (pathStr) {
    if (!pathStr || typeof pathStr !== 'string') return pathStr

    // 匹配 %VAR% 格式的环境变量
    return pathStr.replace(/%([^%]+)%/g, function (match, varName) {
      // 从 process.env 中获取环境变量值
      return process.env[varName] || match
    })
  },

  /**
   * 判断字符串是否为路径格式
   */
  isPathLike: function (str) {
    if (!str || typeof str !== 'string') return false
    // 去除 file: 前缀
    const cleanStr = str.replace(/^file:/, '')
    // Windows路径模式: C:\... 或 \\... 或包含 \ 或 / 或 包含 %...%
    return /^[a-zA-Z]:[\\|/]/.test(cleanStr) || /^\\\\/.test(cleanStr) || cleanStr.includes('\\') || (cleanStr.includes('/') && !cleanStr.includes('://')) || /%[^%]+%/.test(cleanStr)
  },

  /**
   * 打开文件或文件夹
   * 使用系统默认应用程序打开
   */
  shellOpenPath: function (pathStr) {
    try {
      let cleanPath = pathStr.replace(/^file:/, '')
      // 展开环境变量
      cleanPath = this.expandEnvVars(cleanPath)

      if (!fs.existsSync(cleanPath)) {
        throw new Error('路径不存在')
      }
      window.ztools.shellOpenPath(cleanPath)
      return { success: true }
    } catch (error) {
      throw new Error('打开失败: ' + error.message)
    }
  },

  /**
   * 在文件资源管理器中显示文件/文件夹
   */
  shellShowItemInFolder: function (pathStr) {
    try {
      let cleanPath = pathStr.replace(/^file:/, '')
      // 展开环境变量
      cleanPath = this.expandEnvVars(cleanPath)

      if (!fs.existsSync(cleanPath)) {
        throw new Error('路径不存在')
      }
      window.ztools.shellShowItemInFolder(cleanPath)
      return { success: true }
    } catch (error) {
      throw new Error('打开失败: ' + error.message)
    }
  },

  /**
   * 判断字符串是否为有效的 URL（http 或 https）
   */
  isURL: function (str) {
    if (!str || typeof str !== 'string') return false
    const trimmed = str.trim()
    // 只检测 http 和 https 协议
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return false
    }
    // 使用内联的 URL 验证函数
    return isValidURL(trimmed)
  },

  /**
   * 使用系统默认浏览器打开 URL
   */
  openURL: function (url) {
    try {
      if (!this.isURL(url)) {
        throw new Error('无效的 URL')
      }
      // 使用 ZTools 原生 API，在开发和打包环境中都能工作
      window.ztools.shellOpenExternal(url.trim())
      return { success: true }
    } catch (error) {
      throw new Error('打开链接失败: ' + error.message)
    }
  }
}
