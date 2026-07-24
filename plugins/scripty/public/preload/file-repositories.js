'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { RepositoryError } = require('./metadata-repository')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const RESERVED_SCRIPT_ROOT_NAMES = new Set(['package.json', 'package-lock.json', 'requirements.txt', 'node_modules', '.venv', '.transactions'])
const SCRIPT_EXTENSIONS = Object.freeze({
  javascript: 'js',
  python: 'py',
  powershell: 'ps1',
  shell: 'sh'
})
/** Extensions Scripty knows how to run; a task may only reference scripts carrying one of these. */
const RUNNABLE_SCRIPT_EXTENSIONS = Object.freeze(new Set(['js', 'mjs', 'cjs', 'py', 'ps1', 'sh']))
const DEFAULT_MAX_SCRIPT_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_LOG_CHUNK_BYTES = 256 * 1024

/** Validates a canonical managed folder path without requiring a script extension. */
function normalizeManagedFolderPath(relativePath, allowRoot = false) {
  if (allowRoot && (relativePath === '' || relativePath === null || relativePath === undefined)) return ''
  if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0') || relativePath.includes('\\')) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '目录路径必须是使用 / 分隔的相对路径')
  }
  const normalized = path.posix.normalize(relativePath.trim())
  const segments = normalized.split('/')
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '目录路径不能离开托管目录')
  }
  if (segments.some(segment => WINDOWS_RESERVED_NAME_PATTERN.test(segment) || /[. ]$/.test(segment) || /[<>:"|?*\x00-\x1f]/.test(segment))) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '目录路径包含系统保留字符或名称')
  }
  if (RESERVED_SCRIPT_ROOT_NAMES.has(segments[0].toLocaleLowerCase())) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '目录路径与 Scripty 保留目录冲突')
  }
  return normalized
}

/** Rejects identifiers that could escape a fixed repository through path fragments. */
function assertEntityId(id, label) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new RepositoryError('INVALID_ID', `${label} 不是有效的 UUID`)
  }
}

/** Validates a canonical relative script path and prevents dependency or parent-directory traversal. */
function normalizeManagedScriptPath(relativePath, language) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0') || relativePath.includes('\\')) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '脚本路径必须是使用 / 分隔的相对路径')
  }
  const normalized = path.posix.normalize(relativePath.trim())
  const segments = normalized.split('/')
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '脚本路径不能离开托管目录')
  }
  if (segments.some(segment => WINDOWS_RESERVED_NAME_PATTERN.test(segment) || /[. ]$/.test(segment) || /[<>:"|?*\x00-\x1f]/.test(segment))) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '脚本路径包含系统保留字符或名称')
  }
  if (RESERVED_SCRIPT_ROOT_NAMES.has(segments[0].toLocaleLowerCase())) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '脚本路径与依赖环境目录冲突')
  }
  // 脚本扩展名不再受语言约束：语言由创建时的显式选择决定，路径只做安全校验。
  return normalized
}

/** Reports whether a script's relative path ends in an extension Scripty can execute as a task. */
function isRunnableScriptPath(relativePath) {
  const extension = path.posix.extname(String(relativePath ?? '')).slice(1).toLocaleLowerCase()
  return RUNNABLE_SCRIPT_EXTENSIONS.has(extension)
}

/** Creates a readable path from the script name while retaining the language's conventional extension. */
function createManagedScriptPath(name, language, fallbackId = randomUUID()) {
  const extension = SCRIPT_EXTENSIONS[language]
  if (!extension) throw new RepositoryError('VALIDATION_ERROR', '不支持的脚本语言')
  const source = typeof name === 'string' ? name.trim().replace(/\.(?:js|mjs|cjs|py|ps1|sh)$/i, '') : ''
  const baseName = source
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 80) || `script-${String(fallbackId).slice(0, 8)}`
  return normalizeManagedScriptPath(`${baseName}.${extension}`, language)
}

/** Resolves a canonical relative path below the scripts root and rejects symlinked ancestors. */
function resolveManagedScriptPath(scriptsDirectory, relativePath, language, allowMissingLeaf = true) {
  const normalized = normalizeManagedScriptPath(relativePath, language)
  const target = path.join(scriptsDirectory, ...normalized.split('/'))
  const relative = path.relative(scriptsDirectory, target)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '脚本路径不能离开托管目录')
  }
  let current = scriptsDirectory
  const segments = normalized.split('/')
  for (let index = 0; index < segments.length - (allowMissingLeaf ? 1 : 0); index += 1) {
    current = path.join(current, segments[index])
    if (!fs.existsSync(current)) {
      if (allowMissingLeaf) break
      throw new RepositoryError('SCRIPT_MISSING', '托管脚本不存在')
    }
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) {
      throw new RepositoryError('PATH_NOT_ALLOWED', '脚本路径不能经过符号链接或普通文件')
    }
  }
  return { normalized, target }
}

/** Converts one supported language and script ID into the legacy backup filename. */
function createManagedScriptFileName(scriptId, language) {
  assertEntityId(scriptId, '脚本 ID')
  const extension = SCRIPT_EXTENSIONS[language]
  if (!extension) throw new RepositoryError('VALIDATION_ERROR', '不支持的脚本语言')
  return `${scriptId}.${extension}`
}

/** Converts one run ID into its fixed log filename. */
function createLogFileName(runId) {
  assertEntityId(runId, '运行 ID')
  return `${runId}.log`
}

/** Calculates the lowercase SHA-256 used by script metadata and export validation. */
function calculateSha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

/** Returns the largest prefix that ends on a complete UTF-8 character boundary. */
function getCompleteUtf8Length(buffer) {
  if (buffer.length === 0) return 0
  let leadIndex = buffer.length - 1
  while (leadIndex >= 0 && (buffer[leadIndex] & 0xc0) === 0x80) leadIndex -= 1
  if (leadIndex < 0) return 0

  const leadByte = buffer[leadIndex]
  let expectedLength = 1
  if ((leadByte & 0xe0) === 0xc0) expectedLength = 2
  else if ((leadByte & 0xf0) === 0xe0) expectedLength = 3
  else if ((leadByte & 0xf8) === 0xf0) expectedLength = 4
  return buffer.length - leadIndex < expectedLength ? leadIndex : buffer.length
}

/** Maps native file-system failures to the stable repository error vocabulary. */
function mapFileError(error, fallbackCode, message) {
  const codeBySystemError = {
    EACCES: 'PERMISSION_DENIED',
    EPERM: 'PERMISSION_DENIED',
    ENOSPC: 'DISK_FULL',
    ENOENT: 'SCRIPT_MISSING'
  }
  return new RepositoryError(codeBySystemError[error?.code] ?? fallbackCode, message, error)
}

/** Writes bytes through a same-directory temporary file before atomically replacing the target. */
function atomicWriteFile(filePath, content) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let fileDescriptor
  try {
    fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600)
    fs.writeFileSync(fileDescriptor, content)
    fs.fsyncSync(fileDescriptor)
    fs.closeSync(fileDescriptor)
    fileDescriptor = undefined
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try {
        fs.closeSync(fileDescriptor)
      } catch {}
    }
    try {
      fs.rmSync(temporaryPath, { force: true })
    } catch {}
    throw mapFileError(error, 'WRITE_FAILED', `无法写入 ${path.basename(filePath)}`)
  }
}

class ManagedScriptRepository {
  /** Creates a script repository rooted at Scripty's fixed managed scripts directory. */
  constructor(scriptsDirectory, maxScriptBytes = DEFAULT_MAX_SCRIPT_BYTES) {
    if (!path.isAbsolute(scriptsDirectory)) throw new TypeError('scriptsDirectory 必须是绝对路径')
    this.scriptsDirectory = scriptsDirectory
    this.maxScriptBytes = maxScriptBytes
  }

  /** Creates the managed scripts directory without touching existing source files or recovery state. */
  initialize() {
    try {
      fs.mkdirSync(this.scriptsDirectory, { recursive: true })
    } catch (error) {
      throw mapFileError(error, 'WRITE_FAILED', '无法创建托管脚本目录')
    }
  }

  /** Migrates legacy UUID files into readable paths and clears markers only after verified cleanup. */
  migrateLegacyFiles(metadataRepository) {
    let scripts = metadataRepository.read('scripts')
    if (scripts.some(script => !script.relativePath)) {
      const used = new Set()
      scripts = [...scripts].sort((left, right) => left.id.localeCompare(right.id)).map(script => {
        let relativePath = createManagedScriptPath(script.name, script.language, script.id)
        let counter = 0
        while (used.has(relativePath.toLocaleLowerCase())) {
          counter += 1
          const dot = relativePath.lastIndexOf('.')
          relativePath = `${relativePath.slice(0, dot)}-${script.id.slice(0, 8)}${counter > 1 ? `-${counter}` : ''}${relativePath.slice(dot)}`
        }
        used.add(relativePath.toLocaleLowerCase())
        return {
          ...script,
          relativePath,
          legacyManagedFileName: script.managedFileName ?? createManagedScriptFileName(script.id, script.language)
        }
      }).sort((left, right) => metadataRepository.read('scripts').findIndex(item => item.id === left.id) - metadataRepository.read('scripts').findIndex(item => item.id === right.id))
      metadataRepository.write('scripts', scripts)
    }
    let nextScripts = scripts.slice()
    for (const script of scripts) {
      if (!script.legacyManagedFileName) continue
      const legacyPath = path.join(this.scriptsDirectory, script.legacyManagedFileName)
      const targetPath = this.getFilePath(script, script.language)
      try {
        if (path.resolve(legacyPath) === path.resolve(targetPath)) {
          if (!fs.existsSync(targetPath) || calculateSha256(fs.readFileSync(targetPath)) !== script.contentHash) {
            throw new RepositoryError('MIGRATION_FAILED', '托管脚本内容与元数据不一致')
          }
        } else if (fs.existsSync(targetPath)) {
          const targetContent = fs.readFileSync(targetPath)
          if (calculateSha256(targetContent) !== script.contentHash) {
            throw new RepositoryError('MIGRATION_FAILED', `脚本路径 ${script.relativePath} 已存在不同内容`)
          }
        } else if (fs.existsSync(legacyPath)) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true })
          fs.copyFileSync(legacyPath, targetPath, fs.constants.COPYFILE_EXCL)
          if (calculateSha256(fs.readFileSync(targetPath)) !== script.contentHash) {
            fs.rmSync(targetPath, { force: true })
            throw new RepositoryError('MIGRATION_FAILED', '脚本文件迁移后哈希不一致')
          }
        } else {
          throw new RepositoryError('MIGRATION_FAILED', '旧版托管脚本文件缺失')
        }
        if (path.resolve(legacyPath) !== path.resolve(targetPath)) fs.rmSync(legacyPath, { force: true })
        nextScripts = nextScripts.map(item => {
          if (item.id !== script.id) return item
          const { managedFileName, legacyManagedFileName, ...migrated } = item
          return migrated
        })
        metadataRepository.write('scripts', nextScripts)
      } catch (error) {
        if (error instanceof RepositoryError) throw error
        throw mapFileError(error, 'MIGRATION_FAILED', '无法迁移旧版脚本文件')
      }
    }
    return nextScripts
  }

  /** Resolves a script entity or relative path to its controlled file inside the real directory tree. */
  getFilePath(scriptOrPath, language) {
    const relativePath = typeof scriptOrPath === 'object' && scriptOrPath
      ? scriptOrPath.relativePath ?? scriptOrPath.managedFileName
      : UUID_PATTERN.test(scriptOrPath) ? createManagedScriptFileName(scriptOrPath, language) : scriptOrPath
    return resolveManagedScriptPath(this.scriptsDirectory, relativePath, language, true).target
  }

  /** Atomically stores UTF-8 source at a visible relative path and returns synchronized metadata. */
  write(scriptOrPath, language, content) {
    if (typeof content !== 'string') {
      throw new RepositoryError('VALIDATION_ERROR', '脚本内容必须是字符串')
    }
    const size = Buffer.byteLength(content, 'utf8')
    if (size > this.maxScriptBytes) {
      throw new RepositoryError('FILE_TOO_LARGE', `脚本大小不能超过 ${this.maxScriptBytes} 字节`)
    }
    this.initialize()
    const requestedPath = UUID_PATTERN.test(scriptOrPath)
      ? createManagedScriptFileName(scriptOrPath, language)
      : scriptOrPath
    const { normalized: relativePath, target } = resolveManagedScriptPath(this.scriptsDirectory, requestedPath, language, true)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    atomicWriteFile(target, Buffer.from(content, 'utf8'))
    return { relativePath, managedFileName: relativePath, contentHash: calculateSha256(content), size }
  }

  /** Creates source only when its relative path is unused, preventing accidental overwrite of real files. */
  create(relativePath, language, content) {
    const { target } = resolveManagedScriptPath(this.scriptsDirectory, relativePath, language, true)
    if (fs.existsSync(target)) throw new RepositoryError('NAME_CONFLICT', '脚本路径已存在')
    return this.write(relativePath, language, content)
  }

  /** Reads one managed UTF-8 source file and reports a missing script distinctly. */
  read(scriptOrPath, language) {
    const filePath = this.getFilePath(scriptOrPath, language)
    try {
      const stat = fs.lstatSync(filePath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new RepositoryError('PATH_NOT_ALLOWED', '托管脚本不是普通文件')
      if (stat.size > this.maxScriptBytes) {
        throw new RepositoryError('FILE_TOO_LARGE', `脚本大小不能超过 ${this.maxScriptBytes} 字节`)
      }
      return fs.readFileSync(filePath, 'utf8')
    } catch (error) {
      if (error instanceof RepositoryError) throw error
      throw mapFileError(error, 'READ_FAILED', '无法读取托管脚本')
    }
  }

  /** Removes only the controlled source file and prunes empty parent folders below the scripts root. */
  remove(scriptOrPath, language) {
    const filePath = this.getFilePath(scriptOrPath, language)
    try {
      fs.rmSync(filePath, { force: true })
      let directory = path.dirname(filePath)
      while (directory !== this.scriptsDirectory) {
        if (fs.readdirSync(directory).length > 0) break
        fs.rmdirSync(directory)
        directory = path.dirname(directory)
      }
    } catch (error) {
      throw mapFileError(error, 'WRITE_FAILED', '无法删除托管脚本')
    }
  }

  /** Checks whether the controlled script path currently resolves to a non-symlinked regular file. */
  exists(scriptOrPath, language) {
    try {
      const stat = fs.lstatSync(this.getFilePath(scriptOrPath, language))
      return stat.isFile() && !stat.isSymbolicLink()
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'SCRIPT_MISSING') return false
      throw mapFileError(error, 'READ_FAILED', '无法检查托管脚本')
    }
  }

  /** Returns whether a relative path conflicts with any managed script path under platform case rules. */
  hasPathConflict(relativePath, scripts, excludedId = null, platform = process.platform) {
    const key = platform === 'win32' ? relativePath.toLocaleLowerCase() : relativePath
    return scripts.some(script => {
      if (script.id === excludedId) return false
      const candidate = script.relativePath ?? script.managedFileName
      const candidateKey = platform === 'win32' ? candidate.toLocaleLowerCase() : candidate
      return candidateKey === key || candidateKey.startsWith(`${key}/`) || key.startsWith(`${candidateKey}/`)
    })
  }

  /** Creates one explicitly managed empty directory after validating every existing ancestor. */
  createFolder(relativePath) {
    const normalized = normalizeManagedFolderPath(relativePath)
    const target = path.join(this.scriptsDirectory, ...normalized.split('/'))
    const relative = path.relative(this.scriptsDirectory, target)
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new RepositoryError('PATH_NOT_ALLOWED', '目录路径不能离开托管目录')
    }
    let current = this.scriptsDirectory
    for (const segment of normalized.split('/')) {
      current = path.join(current, segment)
      if (!fs.existsSync(current)) continue
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RepositoryError('NAME_CONFLICT', '目录路径与现有文件冲突')
    }
    if (fs.existsSync(target)) throw new RepositoryError('NAME_CONFLICT', '目录已存在')
    try {
      fs.mkdirSync(target, { recursive: true })
      return normalized
    } catch (error) {
      throw mapFileError(error, 'WRITE_FAILED', '无法创建托管目录')
    }
  }

  /** Moves one managed file or folder within the repository without following symbolic links. */
  movePath(sourcePath, targetPath, kind, language) {
    const normalizeFolder = value => String(value).startsWith('.transactions-delete-') ? String(value) : normalizeManagedFolderPath(value)
    const sourceNormalized = kind === 'folder'
      ? normalizeFolder(sourcePath)
      : normalizeManagedScriptPath(sourcePath, language)
    const targetNormalized = kind === 'folder'
      ? normalizeFolder(targetPath)
      : normalizeManagedScriptPath(targetPath, language)
    if (kind === 'folder' && targetNormalized.startsWith(`${sourceNormalized}/`)) {
      throw new RepositoryError('PATH_NOT_ALLOWED', '目录不能移动到自身内部')
    }
    const source = path.join(this.scriptsDirectory, ...sourceNormalized.split('/'))
    const target = path.join(this.scriptsDirectory, ...targetNormalized.split('/'))
    try {
      const sourceStat = fs.lstatSync(source)
      if (sourceStat.isSymbolicLink() || (kind === 'folder' ? !sourceStat.isDirectory() : !sourceStat.isFile())) {
        throw new RepositoryError('PATH_NOT_ALLOWED', '待移动路径类型无效')
      }
      let parent = this.scriptsDirectory
      for (const segment of targetNormalized.split('/').slice(0, -1)) {
        parent = path.join(parent, segment)
        if (!fs.existsSync(parent)) break
        const parentStat = fs.lstatSync(parent)
        if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new RepositoryError('PATH_NOT_ALLOWED', '目标路径经过无效目录')
      }
      if (fs.existsSync(target)) throw new RepositoryError('NAME_CONFLICT', '目标路径已存在')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.renameSync(source, target)
      return targetNormalized
    } catch (error) {
      if (error instanceof RepositoryError) throw error
      throw mapFileError(error, 'WRITE_FAILED', '无法移动托管路径')
    }
  }

  /**
   * Copies one managed script file to a new relative path, mirroring movePath's
   * validation. Returns normalized target path plus the copied file's hash/size
   * so the service layer can persist fresh metadata without re-reading the file.
   */
  copyScriptFile(sourcePath, targetPath, language) {
    const sourceNormalized = normalizeManagedScriptPath(sourcePath, language)
    const targetNormalized = normalizeManagedScriptPath(targetPath, language)
    const source = path.join(this.scriptsDirectory, ...sourceNormalized.split('/'))
    const target = path.join(this.scriptsDirectory, ...targetNormalized.split('/'))
    try {
      const sourceStat = fs.lstatSync(source)
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new RepositoryError('PATH_NOT_ALLOWED', '待复制路径类型无效')
      }
      if (sourceStat.size > this.maxScriptBytes) {
        throw new RepositoryError('FILE_TOO_LARGE', `脚本大小不能超过 ${this.maxScriptBytes} 字节`)
      }
      let parent = this.scriptsDirectory
      for (const segment of targetNormalized.split('/').slice(0, -1)) {
        parent = path.join(parent, segment)
        if (!fs.existsSync(parent)) break
        const parentStat = fs.lstatSync(parent)
        if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new RepositoryError('PATH_NOT_ALLOWED', '目标路径经过无效目录')
      }
      if (fs.existsSync(target)) throw new RepositoryError('NAME_CONFLICT', '目标路径已存在')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
      const content = fs.readFileSync(target, 'utf8')
      return { relativePath: targetNormalized, contentHash: calculateSha256(content), size: sourceStat.size }
    } catch (error) {
      if (error instanceof RepositoryError) throw error
      throw mapFileError(error, 'WRITE_FAILED', '无法复制托管脚本')
    }
  }

  /**
   * Recursively copies a managed folder tree to a new relative path. Refuses to
   * copy a folder into itself (matching movePath). On any mid-copy failure the
   * partial target tree is removed so the repository is left consistent.
   * Returns the normalized target plus the list of copied file entry paths.
   */
  copyFolderTree(sourcePath, targetPath) {
    const sourceNormalized = normalizeManagedFolderPath(sourcePath)
    const targetNormalized = normalizeManagedFolderPath(targetPath)
    if (targetNormalized === sourceNormalized || targetNormalized.startsWith(`${sourceNormalized}/`)) {
      throw new RepositoryError('PATH_NOT_ALLOWED', '目录不能复制到自身或其子目录')
    }
    const source = path.join(this.scriptsDirectory, ...sourceNormalized.split('/'))
    const target = path.join(this.scriptsDirectory, ...targetNormalized.split('/'))
    let parent = this.scriptsDirectory
    for (const segment of targetNormalized.split('/').slice(0, -1)) {
      parent = path.join(parent, segment)
      if (!fs.existsSync(parent)) break
      const parentStat = fs.lstatSync(parent)
      if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new RepositoryError('PATH_NOT_ALLOWED', '目标路径经过无效目录')
    }
    const sourceStat = fs.lstatSync(source)
    if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
      throw new RepositoryError('PATH_NOT_ALLOWED', '待复制目录类型无效')
    }
    if (fs.existsSync(target)) throw new RepositoryError('NAME_CONFLICT', '目标路径已存在')
    const copiedFiles = []
    const walk = (currentSource, currentTarget) => {
      fs.mkdirSync(currentTarget, { recursive: true })
      for (const entry of fs.readdirSync(currentSource)) {
        const from = path.join(currentSource, entry)
        const to = path.join(currentTarget, entry)
        const stat = fs.lstatSync(from)
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) walk(from, to)
        else {
          if (stat.size > this.maxScriptBytes) {
            throw new RepositoryError('FILE_TOO_LARGE', `脚本大小不能超过 ${this.maxScriptBytes} 字节`)
          }
          fs.copyFileSync(from, to)
          copiedFiles.push(path.relative(target, to).split(path.sep).join('/'))
        }
      }
    }
    try {
      walk(source, target)
      return { relativePath: targetNormalized, copiedFiles }
    } catch (error) {
      try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
      if (error instanceof RepositoryError) throw error
      throw mapFileError(error, 'WRITE_FAILED', '无法复制托管目录')
    }
  }

  /** Removes an explicitly managed empty folder; recursive content removal is coordinated by the service layer. */
  removeFolder(relativePath) {
    const normalized = String(relativePath).startsWith('.transactions-delete-') ? String(relativePath) : normalizeManagedFolderPath(relativePath)
    const target = path.join(this.scriptsDirectory, ...normalized.split('/'))
    try {
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RepositoryError('PATH_NOT_ALLOWED', '托管目录类型无效')
      fs.rmdirSync(target)
    } catch (error) {
      if (error instanceof RepositoryError) throw error
      throw mapFileError(error, error?.code === 'ENOTEMPTY' ? 'REFERENCE_CONFLICT' : 'WRITE_FAILED', '无法删除托管目录')
    }
  }
}

class LogFileRepository {
  /** Creates a log repository rooted at Scripty's fixed logs directory. */
  constructor(logsDirectory, maxChunkBytes = DEFAULT_MAX_LOG_CHUNK_BYTES) {
    if (!path.isAbsolute(logsDirectory)) throw new TypeError('logsDirectory 必须是绝对路径')
    this.logsDirectory = logsDirectory
    this.maxChunkBytes = maxChunkBytes
  }

  /** Creates the logs directory without modifying existing run output. */
  initialize() {
    try {
      fs.mkdirSync(this.logsDirectory, { recursive: true })
    } catch (error) {
      throw mapFileError(error, 'WRITE_FAILED', '无法创建日志目录')
    }
  }

  /** Resolves a run ID to its only permitted log path. */
  getFilePath(runId) {
    return path.join(this.logsDirectory, createLogFileName(runId))
  }

  /** Creates or truncates one run log before the process begins producing output. */
  create(runId) {
    this.initialize()
    const logFileName = createLogFileName(runId)
    atomicWriteFile(path.join(this.logsDirectory, logFileName), Buffer.alloc(0))
    return logFileName
  }

  /** Appends one UTF-8 log chunk and flushes it so history survives a later process failure. */
  append(runId, chunk) {
    const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
    let fileDescriptor
    try {
      fileDescriptor = fs.openSync(this.getFilePath(runId), 'a', 0o600)
      fs.writeSync(fileDescriptor, content)
      fs.fsyncSync(fileDescriptor)
    } catch (error) {
      throw mapFileError(error, 'WRITE_FAILED', '无法追加运行日志')
    } finally {
      if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor)
    }
    return content.length
  }

  /**
   * Reads a bounded byte range from one run log.
   * Offsets are byte positions; the returned nextOffset can be sent back unchanged for pagination.
   * A chunk may exceed the requested length by at most three bytes when needed to return one complete UTF-8 character.
   */
  readChunk(runId, offset, length) {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RepositoryError('VALIDATION_ERROR', '日志 offset 必须是非负整数')
    }
    if (!Number.isInteger(length) || length < 1 || length > this.maxChunkBytes) {
      throw new RepositoryError(
        'VALIDATION_ERROR',
        `日志 length 必须是 1 到 ${this.maxChunkBytes} 之间的整数`
      )
    }

    let fileDescriptor
    try {
      const filePath = this.getFilePath(runId)
      const size = fs.statSync(filePath).size
      if (offset > size) throw new RepositoryError('VALIDATION_ERROR', '日志 offset 超出文件范围')
      const readLength = Math.min(length, size - offset)
      const lookaheadLength = Math.min(readLength + 3, size - offset)
      const buffer = Buffer.alloc(lookaheadLength)
      fileDescriptor = fs.openSync(filePath, 'r')
      const bytesRead = fs.readSync(fileDescriptor, buffer, 0, lookaheadLength, offset)
      const candidate = buffer.subarray(0, Math.min(readLength, bytesRead))
      const completeLength = offset + readLength >= size
        ? candidate.length
        : getCompleteUtf8Length(candidate)
      if (completeLength === 0 && bytesRead > candidate.length) {
        const expandedLength = getCompleteUtf8Length(buffer.subarray(0, bytesRead))
        if (expandedLength > 0) {
          const nextOffset = offset + expandedLength
          return {
            content: buffer.subarray(0, expandedLength).toString('utf8'),
            offset,
            nextOffset,
            end: nextOffset >= size
          }
        }
      }
      const nextOffset = offset + completeLength
      return {
        content: candidate.subarray(0, completeLength).toString('utf8'),
        offset,
        nextOffset,
        end: nextOffset >= size
      }
    } catch (error) {
      if (error instanceof RepositoryError) throw error
      const mapped = mapFileError(error, 'READ_FAILED', '无法读取运行日志')
      if (mapped.code === 'SCRIPT_MISSING') mapped.code = 'NOT_FOUND'
      throw mapped
    } finally {
      if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor)
    }
  }

  /** Returns one controlled log's byte size for cleanup summaries without reading its contents. */
  getSize(runId) {
    try {
      return fs.statSync(this.getFilePath(runId)).size
    } catch (error) {
      const mapped = mapFileError(error, 'READ_FAILED', '无法读取运行日志大小')
      if (mapped.code === 'SCRIPT_MISSING') mapped.code = 'NOT_FOUND'
      throw mapped
    }
  }

  /** Removes only the controlled log file associated with one run. */
  remove(runId) {
    try {
      fs.rmSync(this.getFilePath(runId), { force: true })
    } catch (error) {
      throw mapFileError(error, 'WRITE_FAILED', '无法删除运行日志')
    }
  }
}

module.exports = {
  DEFAULT_MAX_LOG_CHUNK_BYTES,
  DEFAULT_MAX_SCRIPT_BYTES,
  LogFileRepository,
  ManagedScriptRepository,
  RESERVED_SCRIPT_ROOT_NAMES,
  RUNNABLE_SCRIPT_EXTENSIONS,
  SCRIPT_EXTENSIONS,
  atomicWriteFile,
  calculateSha256,
  createLogFileName,
  createManagedScriptFileName,
  createManagedScriptPath,
  isRunnableScriptPath,
  normalizeManagedFolderPath,
  normalizeManagedScriptPath,
  resolveManagedScriptPath
}
