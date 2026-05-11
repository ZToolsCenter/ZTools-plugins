const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEFAULT_LIMIT = 200
const PUSH_LIMIT = 6
const PUSH_PREFIX_RE = /^[ '\u2018\u2019]+/

let currentTask = null

function normalizeText(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function parseTokens(input) {
  const tokens = []
  const tokenRegex = /"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’|(\S+)/g
  let match

  while ((match = tokenRegex.exec(input)) !== null) {
    let raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    const quoted = match[1] !== undefined || match[2] !== undefined || match[3] !== undefined || match[4] !== undefined
    if (!raw) continue

    let escapedMinus = false
    if (!quoted && raw.startsWith('\\-')) {
      raw = raw.slice(1)
      escapedMinus = true
    }

    let excluded = false
    if (!quoted && !escapedMinus && raw.startsWith('-') && raw.length > 1) {
      excluded = true
      raw = raw.slice(1)
    }

    if (!raw) continue
    tokens.push({ raw, quoted, excluded })
  }

  return tokens
}

function escapeForQuery(value, keepWildcard) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\*/g, keepWildcard ? '*' : '\\*')
}

function buildNameClause(term) {
  if (term.quoted) {
    const exact = escapeForQuery(term.raw, false)
    return `(kMDItemFSName == "${exact}"cd || kMDItemDisplayName == "${exact}"cd)`
  }

  const useWildcard = term.raw.includes('*')
  const escaped = escapeForQuery(term.raw, useWildcard)
  const pattern = useWildcard ? escaped : `*${escaped}*`
  return `(kMDItemFSName == "${pattern}"cd || kMDItemDisplayName == "${pattern}"cd)`
}

function buildMdfindQuery(input) {
  const text = normalizeText(input)
  if (!text) {
    return 'kMDItemFSName == "*"cd'
  }

  const tokens = parseTokens(text)
  if (!tokens.length) {
    return 'kMDItemFSName == "*"cd'
  }

  const clauses = tokens.map((term) => {
    const clause = buildNameClause(term)
    return term.excluded ? `!${clause}` : clause
  })

  return clauses.join(' && ')
}

function safeReadPathInfo(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return {
      path: filePath,
      name: path.basename(filePath),
      dir: path.dirname(filePath),
      ext: path.extname(filePath).slice(1).toLowerCase(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  } catch (error) {
    return {
      path: filePath,
      name: path.basename(filePath),
      dir: path.dirname(filePath),
      ext: path.extname(filePath).slice(1).toLowerCase(),
      isDirectory: false,
      size: 0,
      mtimeMs: 0
    }
  }
}

function abortCurrentTask() {
  if (!currentTask) return false
  if (currentTask.process.exitCode === null && !currentTask.process.killed) {
    currentTask.cancelled = true
    currentTask.process.kill('SIGTERM')
    return true
  }
  return false
}

function resolveSearchDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) return undefined

  try {
    const stat = fs.statSync(directory)
    return stat.isDirectory() ? directory : undefined
  } catch (error) {
    return undefined
  }
}

function runMdfind(queryExpression, directory, limit) {
  abortCurrentTask()

  return new Promise((resolve, reject) => {
    const args = []
    if (directory) {
      args.push('-onlyin', directory)
    }
    args.push(queryExpression)

    const process = spawn('mdfind', args)
    const task = {
      process,
      cancelled: false,
      reachedLimit: false
    }
    currentTask = task

    const seen = new Set()
    const results = []
    let stderrBuffer = ''
    let stdoutBuffer = ''
    let stdoutRemainder = ''

    process.stdout.on('data', (chunk) => {
      const chunkText = chunk.toString('utf8')
      stdoutBuffer += chunkText
      const text = stdoutRemainder + chunkText
      const lines = text.split(/\r?\n/)
      stdoutRemainder = lines.pop() || ''

      for (const line of lines) {
        const filePath = line.trim()
        if (!filePath || seen.has(filePath)) continue

        seen.add(filePath)
        results.push(safeReadPathInfo(filePath))

        if (results.length >= limit) {
          task.reachedLimit = true
          process.kill('SIGTERM')
          break
        }
      }
    })

    process.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf8')
    })

    process.on('error', (error) => {
      if (currentTask === task) {
        currentTask = null
      }
      reject(error)
    })

    process.on('close', (code) => {
      if (currentTask === task) {
        currentTask = null
      }

      if (task.cancelled || task.reachedLimit) {
        resolve(results)
        return
      }

      if (code !== 0) {
        const message = [stderrBuffer.trim(), stdoutBuffer.trim()].filter(Boolean).join('\n')
        reject(new Error(message || `mdfind exited with code ${code}`))
        return
      }

      if (stdoutRemainder) {
        const filePath = stdoutRemainder.trim()
        if (filePath && !seen.has(filePath) && results.length < limit) {
          results.push(safeReadPathInfo(filePath))
        }
      }

      resolve(results)
    })
  })
}

async function searchFiles(queryText, options = {}) {
  const text = normalizeText(queryText)
  if (!text) return []

  const limitValue = Number.isFinite(options.limit) ? Math.floor(options.limit) : DEFAULT_LIMIT
  const limit = Math.max(1, Math.min(limitValue, 1000))
  const directory = resolveSearchDirectory(options.directory)

  const queryExpression = buildMdfindQuery(text)
  return runMdfind(queryExpression, directory, limit)
}

function extractPushKeyword(payload) {
  const text = normalizeText(payload)
  if (!text) return ''
  return text.replace(PUSH_PREFIX_RE, '').trim()
}

function mapPushItems(files) {
  return files.map((item) => ({
    text: item.name,
    title: item.path,
    icon: 'logo.png',
    tags: [item.isDirectory ? '目录' : '文件']
  }))
}

window.fileSearchApi = {
  searchFiles({ query, directory, limit } = {}) {
    return searchFiles(query, { directory, limit })
  },
  abortSearch() {
    return abortCurrentTask()
  },
  openPath(targetPath) {
    if (typeof targetPath === 'string' && targetPath) {
      window.ztools.shellOpenPath(targetPath)
    }
  },
  showInFinder(targetPath) {
    if (typeof targetPath === 'string' && targetPath) {
      window.ztools.shellShowItemInFolder(targetPath)
    }
  },
  copyText(text) {
    return window.ztools.copyText(String(text))
  },
  getPath(name) {
    return window.ztools.getPath(name)
  },
  readCurrentFolderPath() {
    return window.ztools.readCurrentFolderPath()
  },
  isMac() {
    if (typeof window.ztools.isMacOs === 'function') return window.ztools.isMacOs()
    if (typeof window.ztools.isMacOS === 'function') return window.ztools.isMacOS()
    return false
  }
}

if (window.ztools && typeof window.ztools.onMainPush === 'function') {
  window.ztools.onMainPush(
    async (action) => {
      const query = extractPushKeyword(action.payload)
      if (!query) return []

      const files = await searchFiles(query, { limit: PUSH_LIMIT + 1 })
      const pushed = mapPushItems(files.slice(0, PUSH_LIMIT))
      if (files.length > PUSH_LIMIT) {
        pushed.push({ text: '进入插件查看更多…', enter: true })
      }
      return pushed
    },
    (action) => {
      if (!action || !action.option) return
      if (action.option.enter) return true

      const targetPath = action.option.title
      if (targetPath) {
        window.ztools.shellOpenPath(targetPath)
        window.ztools.hideMainWindow(true)
      }
    }
  )
}
