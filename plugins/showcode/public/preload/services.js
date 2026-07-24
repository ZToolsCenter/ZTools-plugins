const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')

function run(command, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf-8',
        maxBuffer: 8 * 1024 * 1024,
        timeout,
      },
      (error, stdout) => resolve(error ? '' : stdout)
    )
  })
}

function cleanFontName(font) {
  return String(font || '')
    .replace(/\.(otf|ttc|ttf|woff2?)$/i, '')
    .replace(/\s*\((TrueType|OpenType|Type 1)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueFonts(fonts) {
  return [...new Set(fonts.map(cleanFontName).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
}

function walkFontFiles(directories) {
  const names = []

  const walk = (dir) => {
    if (!dir || !fs.existsSync(dir)) return

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }

      if (/\.(otf|ttc|ttf|woff2?)$/i.test(entry.name)) {
        names.push(entry.name)
      }
    }
  }

  directories.forEach(walk)
  return uniqueFonts(names)
}

function collectFontNames(value, names = []) {
  if (!value || typeof value !== 'object') return names

  if (Array.isArray(value)) {
    value.forEach((item) => collectFontNames(item, names))
    return names
  }

  for (const [key, field] of Object.entries(value)) {
    if (
      typeof field === 'string' &&
      ['family', 'full_name', 'fullname', 'display_name'].includes(key.toLowerCase())
    ) {
      names.push(field)
    } else {
      collectFontNames(field, names)
    }
  }

  return names
}

async function getMacFonts() {
  const output = await run('/usr/sbin/system_profiler', ['SPFontsDataType', '-json'], 10000)

  if (!output) {
    return walkFontFiles([
      '/System/Library/Fonts',
      '/Library/Fonts',
      path.join(os.homedir(), 'Library/Fonts'),
    ])
  }

  try {
    return uniqueFonts(collectFontNames(JSON.parse(output)))
  } catch {
    return walkFontFiles([
      '/System/Library/Fonts',
      '/Library/Fonts',
      path.join(os.homedir(), 'Library/Fonts'),
    ])
  }
}

async function getLinuxFonts() {
  const output = await run('fc-list', [':', 'family'], 6000)

  if (!output) {
    return walkFontFiles([
      '/usr/share/fonts',
      '/usr/local/share/fonts',
      path.join(os.homedir(), '.fonts'),
      path.join(os.homedir(), '.local/share/fonts'),
    ])
  }

  return uniqueFonts(
    output
      .split('\n')
      .flatMap((line) => line.split(','))
  )
}

async function getWindowsFonts() {
  const script = [
    "$paths = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'",
    'foreach ($path in $paths) {',
    '  if (Test-Path $path) {',
    '    (Get-ItemProperty $path).PSObject.Properties |',
    "      Where-Object { $_.Name -notmatch '^PS' } |",
    "      ForEach-Object { $_.Name -replace '\\s*\\((TrueType|OpenType|Type 1)\\)\\s*$', '' }",
    '  }',
    '}',
  ].join('; ')

  const output =
    (await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], 8000)) ||
    (await run('pwsh.exe', ['-NoProfile', '-Command', script], 8000))

  if (!output) {
    return walkFontFiles([path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')])
  }

  return uniqueFonts(output.split('\n'))
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  async readFile(file) {
    return fs.promises.readFile(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  async writeTextFile(text, filename = `${Date.now().toString()}.txt`) {
    const filePath = path.join(window.ztools.getPath('downloads'), path.basename(filename))
    await fs.promises.writeFile(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  async writeImageFile(base64Url, filename) {
    const imageBase64Match = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    const svgBase64Match = /^data:image\/svg\+xml(?:;charset=[^;,]+)?;base64,/i.exec(base64Url)
    const svgMatch = /^data:image\/svg\+xml(?:;charset=[^;,]+)?,/i.exec(base64Url)
    const base64Match = imageBase64Match || svgBase64Match
    const extension = imageBase64Match ? imageBase64Match[1] : svgMatch || svgBase64Match ? 'svg' : 'png'
    const baseName = filename ? path.basename(filename) : `${Date.now().toString()}.${extension}`
    const filePath = path.join(window.ztools.getPath('downloads'), baseName)

    if (svgMatch) {
      await fs.promises.writeFile(filePath, decodeURIComponent(base64Url.substring(svgMatch[0].length)), {
        encoding: 'utf-8',
      })
      return filePath
    }

    if (!base64Match) {
      throw new Error('Unsupported image data URL.')
    }

    await fs.promises.writeFile(filePath, base64Url.substring(base64Match[0].length), {
      encoding: 'base64',
    })
    return filePath
  },
  async getSystemFonts() {
    if (process.platform === 'darwin') return getMacFonts()
    if (process.platform === 'win32') return getWindowsFonts()
    return getLinuxFonts()
  }
}
