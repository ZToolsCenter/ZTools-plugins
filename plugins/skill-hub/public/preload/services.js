const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const http = require('node:http')
const os = require('node:os')
const { exec } = require('node:child_process')
const AdmZip = require('adm-zip')
const tar = require('tar')
const { extract } = require('extract-zip')

function homeDir() {
  return os.homedir()
}

function expandPath(p) {
  if (!p) return ''
  return p.replace(/^~/, homeDir())
}

function isWindows() {
  return process.platform === 'win32'
}

function isMacOS() {
  return process.platform === 'darwin'
}

window.services = {
  // === 原始保留服务 ===
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matchs[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },

  // === 路径工具 ===
  expandPath,
  homeDir,
  isWindows,
  isMacOS,
  pathJoin: (...parts) => path.join(...parts),
  pathExists(p) {
    const full = expandPath(p)
    try {
      fs.lstatSync(full)
      return true
    } catch {
      return false
    }
  },
  mkdir(dir) {
    fs.mkdirSync(expandPath(dir), { recursive: true })
  },
  openFolder(dir) {
    const fullPath = expandPath(dir)
    if (!fs.existsSync(fullPath)) return
    const cmd = isWindows() ? `explorer "${fullPath}"` : process.platform === 'darwin' ? `open "${fullPath}"` : `xdg-open "${fullPath}"`
    exec(cmd)
  },
  readDir(dir) {
    try {
      return fs.readdirSync(expandPath(dir), { withFileTypes: true }).map((d) => ({
        name: d.name,
        path: path.join(expandPath(dir), d.name),
        isDirectory: d.isDirectory(),
        isFile: d.isFile(),
        isSymlink: d.isSymbolicLink(),
      }))
    } catch {
      return []
    }
  },
  readFileText(filePath) {
    return fs.readFileSync(expandPath(filePath), { encoding: 'utf-8' })
  },
  writeFile(filePath, content) {
    const full = expandPath(filePath)
    this.mkdir(path.dirname(full))
    fs.writeFileSync(full, content, { encoding: 'utf-8' })
  },
  removeFile(filePath) {
    const full = expandPath(filePath)
    try {
      fs.lstatSync(full)
      fs.rmSync(full, { recursive: true })
    } catch {}
  },
  copyFile(src, dest) {
    const fullSrc = expandPath(src)
    const fullDest = expandPath(dest)
    this.mkdir(path.dirname(fullDest))
    try {
      fs.lstatSync(fullDest)
      fs.rmSync(fullDest, { recursive: true })
    } catch {}
    fs.cpSync(fullSrc, fullDest, { recursive: true })
  },
  stat(p) {
    try {
      const s = fs.statSync(expandPath(p))
      return { exists: true, isDirectory: s.isDirectory(), isFile: s.isFile(), isSymlink: s.isSymbolicLink(), size: s.size, mtime: s.mtime.toISOString() }
    } catch {
      return { exists: false }
    }
  },

  // === Symlink 支持 ===
  createSymlink(target, linkPath) {
    const fullTarget = expandPath(target)
    const fullLink = expandPath(linkPath)
    this.mkdir(path.dirname(fullLink))
    try {
      fs.lstatSync(fullLink)
      fs.rmSync(fullLink, { recursive: true })
    } catch {}
    if (isWindows()) {
      try {
        const stats = fs.statSync(fullTarget)
        if (stats.isDirectory()) {
          fs.symlinkSync(fullTarget, fullLink, 'junction')
        } else {
          fs.symlinkSync(fullTarget, fullLink, 'file')
        }
      } catch (e) {
        throw new Error(`Cannot create symlink: target "${fullTarget}" does not exist or is not accessible`)
      }
    } else {
      fs.symlinkSync(fullTarget, fullLink)
    }
    return fullLink
  },
  readSymlink(linkPath) {
    try {
      return fs.readlinkSync(expandPath(linkPath))
    } catch {
      return null
    }
  },

  // === 下载 ===
  downloadFile(url, _redirectCount) {
    const redirectCount = (_redirectCount || 0)
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects'))
      }
      const client = url.startsWith('https') ? https : http
      const chunks = []
      client.get(url, { headers: { 'User-Agent': 'skill-hub' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(this.downloadFile(res.headers.location, redirectCount + 1))
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: ${res.statusCode}`))
        }
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
      }).on('error', reject)
    })
  },
  downloadFileTo(url, destPath) {
    return this.downloadFile(url).then((content) => {
      const full = expandPath(destPath)
      this.mkdir(path.dirname(full))
      fs.writeFileSync(full, content)
      return full
    })
  },

  // === GitHub API ===
  fetchGitHubAPI(url, token) {
    return new Promise((resolve, reject) => {
      const headers = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'skill-hub',
      }
      if (token) headers['Authorization'] = `Bearer ${token}`
      https.get(url, { headers }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            try {
              const err = JSON.parse(data)
              reject(new Error(err.message || `GitHub API: ${res.statusCode}`))
            } catch {
              reject(new Error(`GitHub API: ${res.statusCode}`))
            }
            return
          }
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error('Invalid JSON from GitHub API'))
          }
        })
        res.on('error', reject)
      }).on('error', reject)
    })
  },
  fetchGitHubText(url, token) {
    return new Promise((resolve, reject) => {
      const headers = {
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'skill-hub',
      }
      if (token) headers['Authorization'] = `Bearer ${token}`
      https.get(url, { headers }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error(`GitHub raw: ${res.statusCode}`))
          else resolve(data)
        })
        res.on('error', reject)
      }).on('error', reject)
    })
  },

  // === 压缩包解压 ===
  extractZip(zipPath, dest) {
    const fullZip = expandPath(zipPath)
    const fullDest = expandPath(dest)
    this.mkdir(fullDest)
    const zip = new AdmZip(fullZip)
    zip.extractAllTo(fullDest, true)
    return fullDest
  },
  extractBufferZip(buffer, dest) {
    const fullDest = expandPath(dest)
    this.mkdir(fullDest)
    const zip = new AdmZip(Buffer.from(buffer))
    zip.extractAllTo(fullDest, true)
    return fullDest
  },
  async extractTarGz(tarPath, dest) {
    const fullTar = expandPath(tarPath)
    const fullDest = expandPath(dest)
    this.mkdir(fullDest)
    await tar.x({ file: fullTar, C: fullDest })
    return fullDest
  },

  // === SKILL.md 扫描 ===
  scanForSkills(rootDir) {
    const fullRoot = expandPath(rootDir)
    const results = []
    if (!fs.existsSync(fullRoot)) return results
    try {
      const entries = fs.readdirSync(fullRoot, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = path.join(fullRoot, entry.name)
        let isDir = entry.isDirectory()
        let isSymlinkEntry = entry.isSymbolicLink ? entry.isSymbolicLink() : false

        if (!isDir && !isSymlinkEntry) {
          try {
            const st = fs.statSync(entryPath)
            isDir = st.isDirectory()
          } catch {}
        }

        if (isDir || isSymlinkEntry) {
          const skillPath = path.join(entryPath, 'SKILL.md')
          if (fs.existsSync(skillPath)) {
            const content = fs.readFileSync(skillPath, 'utf-8')
            let isSymlink = isSymlinkEntry
            if (!isSymlink) {
              try {
                const lstats = fs.lstatSync(entryPath)
                isSymlink = lstats.isSymbolicLink()
              } catch {}
            }
            results.push({
              name: entry.name,
              dir: entryPath,
              skillFile: skillPath,
              content,
              isSymlink,
              manifest: parseSkillFrontmatter(content),
            })
          }
        }
      }
    } catch {}
    return results
  },
  scanForSkillFiles(dirs) {
    const all = []
    for (const dir of dirs) {
      const found = this.scanForSkills(dir)
      all.push(...found)
    }
    return all
  },
  parseSkillFile(filePath) {
    const full = expandPath(filePath)
    if (!fs.existsSync(full)) return null
    const content = fs.readFileSync(full, 'utf-8')
    return { content, manifest: parseSkillFrontmatter(content) }
  },

  // === Skill Update Check ===
  async checkSkillUpdate(repo, skillPath, token) {
    const pathCandidates = [
      skillPath ? `${skillPath}/SKILL.md` : null,
      skillPath ? `skills/${skillPath}/SKILL.md` : null,
      skillPath ? `agent-skills/${skillPath}/SKILL.md` : null,
      'SKILL.md',
    ].filter(Boolean)
    for (const branch of ['main', 'master']) {
      for (const p of pathCandidates) {
        const url = `https://raw.githubusercontent.com/${repo}/${branch}/${p}`
        try {
          const text = await this.fetchGitHubText(url, token)
          return text
        } catch (err) {
          if (err.message?.includes('404')) continue
          throw err
        }
      }
    }
    return null
  },
  async updateSkillFromGitHub(repo, skillPath, targetDir, token) {
    let buffer
    for (const branch of ['main', 'master']) {
      try {
        buffer = await this.downloadFile(`https://api.github.com/repos/${repo}/zipball/${branch}`)
        break
      } catch (err) {
        if (branch === 'master') throw err
      }
    }
    const tempDir = path.join(homeDir(), '.cache/skill-hub/')
    fs.mkdirSync(tempDir, { recursive: true })
    const extractDir = path.join(tempDir, `update-${Date.now()}`)
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true })
    this.extractBufferZip(buffer, extractDir)
    const extractedItems = this.readDir(extractDir)
    const rootDir = extractedItems.find((d) => d.isDirectory)
    const sourceRoot = rootDir ? rootDir.path : extractDir
    const pathCandidates = [
      skillPath,
      `skills/${skillPath}`,
      `agent-skills/${skillPath}`,
    ]
    let skillSourceDir = ''
    for (const p of pathCandidates) {
      const candidate = path.join(sourceRoot, p)
      if (fs.existsSync(candidate)) { skillSourceDir = candidate; break }
    }
    if (!skillSourceDir) { fs.rmSync(extractDir, { recursive: true }); return false }
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true })
    fs.mkdirSync(targetDir, { recursive: true })
    this.copyFile(skillSourceDir, targetDir)
    fs.rmSync(extractDir, { recursive: true })
    return true
  },

  // === Skills Repo ===
  getStateDir() {
    const stateDir = path.join(window.ztools.getPath('userData'), 'skills-repo')
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true })
    }
    return stateDir
  },
}

function parseSkillFrontmatter(content) {
  const manifest = { name: '', description: '', author: '', tags: [], format: 'opencode', language: 'en' }
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    manifest.name = path.basename(process.cwd())
  } else {
    const lines = match[1].split('\n')
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (!kv) { i++; continue }
      const [, key, val] = kv
      if (key === 'tags') {
        manifest.tags = val.replace(/[[\]']/g, '').split(',').map((t) => t.trim()).filter(Boolean)
      } else if (key === 'name') manifest.name = val.trim()
      else if (key === 'description') {
        let d = val.trim()
        const blockMatch = d.match(/^([>|])([+-]?)$/)
        if (blockMatch) {
          const style = blockMatch[1]
          const chomp = blockMatch[2]
          const blockLines = []
          i++
          while (i < lines.length) {
            const next = lines[i]
            if (next === '' || next.startsWith(' ') || next.startsWith('\t')) {
              blockLines.push(next.trimEnd())
              i++
            } else {
              break
            }
          }
          i--
          if (style === '>') {
            const paragraphs = []
            let current = []
            for (const bl of blockLines) {
              if (bl === '') {
                if (current.length) { paragraphs.push(current.join(' ')); current = [] }
              } else {
                current.push(bl)
              }
            }
            if (current.length) paragraphs.push(current.join(' '))
            d = paragraphs.join('\n\n')
            if (chomp === '+' && blockLines.length > 0) {
              const trailing = blockLines.reduce((n, l) => l === '' ? n + 1 : 0, 0)
              for (let t = 0; t < trailing; t++) d += '\n'
            }
          } else {
            d = blockLines.join('\n').trimEnd()
          }
        } else if (d === '' || d === '""' || d === "''") {
          const nextIdx = i + 1
          if (nextIdx < lines.length && (lines[nextIdx].startsWith(' ') || lines[nextIdx].startsWith('\t'))) {
            const blockLines = []
            i++
            while (i < lines.length) {
              const curr = lines[i]
              if (curr.startsWith(' ') || curr.startsWith('\t')) {
                blockLines.push(curr.trimEnd())
                i++
              } else {
                break
              }
            }
            i--
            d = blockLines.join(' ').replace(/\s+/g, ' ').trim()
          }
        }
        if (d.startsWith('[') && d.endsWith(']')) {
          d = d.slice(1, -1).trim()
        }
        manifest.description = d
      }
      else if (key === 'author') manifest.author = val.trim()
      else if (key === 'format') manifest.format = val.trim()
      else if (key === 'language') manifest.language = val.trim()
      i++
    }
  }
  if (!manifest.description) {
    const bodyStart = match ? match[0].length : 0
    const body = normalized.slice(bodyStart).trim()
    const firstLine = body.split('\n').find((l) => l.trim() && !l.startsWith('#'))
    if (firstLine) manifest.description = firstLine.trim().slice(0, 200)
  }
  return manifest
}
