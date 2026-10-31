const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')

const MAX_ICON_BYTES = 1024 * 1024

async function getBrowserIcon(profile, options = {}) {
  const platform = options.platform || process.platform
  const env = options.env || process.env
  const files = options.files || fs.promises
  const execute = options.execFile || execFile
  const trace = options.trace || (() => {})
  const controller = new AbortController()
  const { signal } = controller
  let timer

  const checkCancelled = () => {
    if (signal.aborted) throw new Error('图标任务已取消')
  }
  const run = (program, args, extra = {}) =>
    new Promise((resolve, reject) => {
      checkCancelled()
      execute(
        program,
        args,
        {
          windowsHide: true,
          shell: false,
          encoding: 'utf8',
          maxBuffer: 2 * MAX_ICON_BYTES,
          signal,
          ...extra
        },
        (error, stdout) => (error ? reject(error) : resolve(String(stdout).trim()))
      )
    })
  const exists = async (target, directory = false) => {
    checkCancelled()
    try {
      const stat = await files.stat(target)
      checkCancelled()
      return directory ? stat.isDirectory() : stat.isFile()
    } catch {
      checkCancelled()
      return false
    }
  }
  const readLimited = async (target, maxBytes = MAX_ICON_BYTES) => {
    checkCancelled()
    const stat = await files.stat(target)
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes)
      throw new Error('图标文件大小无效')
    const buffer = await files.readFile(target, { signal })
    checkCancelled()
    if (buffer.length > maxBytes) throw new Error('图标文件过大')
    return buffer
  }
  const readImage = async (target) => {
    const mime = {
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp'
    }[path.extname(target).toLowerCase()]
    if (!mime) throw new Error('不支持的图标格式')
    const buffer = await readLimited(target)
    return `data:${mime};base64,${buffer.toString('base64')}`
  }

  async function resolveExecutable(value) {
    const paths = platform === 'win32' ? path.win32 : path.posix
    if (paths.isAbsolute(value)) {
      if (await exists(value)) return value
      throw new Error('未找到程序，请检查启动路径')
    }
    if (!/^[\w.+-]+$/.test(value)) throw new Error('请填写完整程序路径或程序短名')
    if (platform === 'win32') {
      if (!/\.exe$/i.test(value)) throw new Error('请选择 .exe 程序')
      for (const root of ['HKCU\\Software', 'HKLM\\Software', 'HKLM\\Software\\Wow6432Node']) {
        try {
          const output = await run('reg.exe', [
            'query',
            `${root}\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${value}`,
            '/ve'
          ])
          const target = output
            .match(/REG_(?:EXPAND_)?SZ\s+(.+)$/im)?.[1]
            ?.trim()
            .replace(/^"|"$/g, '')
          const expanded = target?.replace(/%([^%]+)%/g, (all, key) => env[key] || all)
          if (expanded && (await exists(expanded))) return expanded
        } catch {
          checkCancelled()
        }
      }
    }
    const aliases =
      platform === 'linux'
        ? {
            'google-chrome': ['google-chrome-stable'],
            'microsoft-edge': ['microsoft-edge-stable'],
            chromium: ['chromium-browser']
          }[value] || []
        : []
    for (const directory of String(env.PATH || env.Path || '')
      .split(platform === 'win32' ? ';' : ':')
      .filter(Boolean)) {
      for (const command of [value, ...aliases]) {
        const candidate = paths.join(directory.replace(/^"|"$/g, ''), command)
        if (await exists(candidate)) return candidate
      }
    }
    throw new Error('未找到程序，请手动选择启动路径')
  }

  async function windowsIcon(value) {
    if (!/\.exe$/i.test(value)) throw new Error('请选择 .exe 程序')
    const executable = await resolveExecutable(value)
    trace('resolved', { strategy: 'windowsFile' })
    // Pass the path through the environment rather than interpolating PowerShell code
    const script =
      'Add-Type -AssemblyName System.Drawing; $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:ZTOOLS_BROWSER_ICON_TARGET); if ($null -eq $icon) { exit 1 }; $bitmap = $icon.ToBitmap(); $stream = New-Object System.IO.MemoryStream; try { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($stream.ToArray()) } finally { $stream.Dispose(); $bitmap.Dispose(); $icon.Dispose() }'
    const base64 = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: { ...env, ZTOOLS_BROWSER_ICON_TARGET: executable }
      }
    )
    if (
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
      Buffer.from(base64, 'base64').length > MAX_ICON_BYTES
    )
      throw new Error('程序未返回有效图标')
    return `data:image/png;base64,${base64}`
  }

  async function macIcon(value) {
    let bundle = value.match(/^(.+?\.app)(?:\/|$)/i)?.[1]
    if (!bundle && value === 'open') {
      const index = profile.args?.indexOf('-a') ?? -1
      const name = index >= 0 ? profile.args[index + 1] : ''
      if (name?.endsWith('.app') && path.posix.isAbsolute(name)) bundle = name
      else if (name && /^[\w .-]+$/.test(name)) {
        for (const directory of [
          '/Applications',
          '/System/Applications',
          path.join(env.HOME || os.homedir(), 'Applications')
        ]) {
          const candidate = path.posix.join(directory, `${name}.app`)
          if (await exists(candidate, true)) {
            bundle = candidate
            break
          }
        }
      }
    }
    if (!bundle || !(await exists(bundle, true)))
      throw new Error('请选择 .app 应用或其内部启动程序')
    trace('resolved', { strategy: 'macBundle' })
    const iconName = await run('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleIconFile',
      path.posix.join(bundle, 'Contents/Info.plist')
    ])
    const filename = path.posix.basename(iconName)
    const source = path.posix.join(
      bundle,
      'Contents/Resources',
      /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.icns`
    )
    if (!/\.icns$/i.test(source)) return readImage(source)
    const directory = await files.mkdtemp(path.join(os.tmpdir(), 'web-quick-open-icon-'))
    const output = path.join(directory, 'icon.png')
    try {
      await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '128', source, '--out', output])
      return await readImage(output)
    } finally {
      // Remove only this task's known output and empty temporary directory
      await files.unlink(output).catch(() => {})
      await files.rmdir(directory).catch(() => {})
    }
  }

  async function linuxIcon(value) {
    const executable = await resolveExecutable(value)
    const command = path.posix.basename(executable)
    trace('resolved', { strategy: 'linuxDesktop' })
    const home = env.HOME || os.homedir()
    const dataDirectories = [
      ...new Set([
        env.XDG_DATA_HOME || path.posix.join(home, '.local/share'),
        ...String(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
          .split(':')
          .filter(Boolean),
        '/var/lib/snapd/desktop'
      ])
    ]
    const desktopNames = [
      ...new Set([command, path.posix.basename(value), command.replace(/-stable$/, '')])
    ]
    const iconNames = [...desktopNames]
    for (const directory of dataDirectories) {
      for (const name of desktopNames) {
        try {
          const text = (
            await readLimited(
              path.posix.join(directory, 'applications', `${name}.desktop`),
              128 * 1024
            )
          ).toString('utf8')
          const section = text.split(/^\[Desktop Entry\]\s*$/m)[1]?.split(/^\[/m)[0] || ''
          const icon = section.match(/^Icon\s*=\s*(.+)$/m)?.[1]?.trim()
          if (icon && !iconNames.includes(icon)) iconNames.unshift(icon)
        } catch {
          checkCancelled()
        }
      }
    }
    for (const name of iconNames) {
      if (path.posix.isAbsolute(name)) {
        try {
          return await readImage(name)
        } catch {
          checkCancelled()
          continue
        }
      }
      if (!/^[\w.+-]+$/.test(name)) continue
      for (const directory of dataDirectories) {
        const candidates = [path.posix.join(directory, 'pixmaps', name)]
        for (const theme of ['hicolor', 'Adwaita']) {
          for (const size of ['128x128', '64x64', '48x48', '256x256', 'scalable']) {
            candidates.push(path.posix.join(directory, 'icons', theme, size, 'apps', name))
          }
        }
        for (const candidate of candidates) {
          for (const extension of path.posix.extname(name) ? [''] : ['.png', '.svg']) {
            try {
              return await readImage(candidate + extension)
            } catch {
              checkCancelled()
            }
          }
        }
      }
    }
    throw new Error('未找到该程序的图标，请上传图片')
  }

  try {
    return await Promise.race([
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          trace('timeout')
          reject(new Error('获取浏览器图标超时（2 秒）'))
          controller.abort()
        }, options.timeoutMs || 2000)
      }),
      (async () => {
        const value = String(profile?.path || '').trim()
        if (!value || /[\0\r\n]/.test(value) || /\.(bat|cmd|ps1|sh|command|js|vbs)$/i.test(value))
          throw new Error('请选择有效的浏览器程序')
        if (platform === 'win32') return windowsIcon(value)
        if (platform === 'darwin') return macIcon(value)
        if (platform === 'linux') return linuxIcon(value)
        throw new Error('不支持的操作系统')
      })()
    ])
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

module.exports = { getBrowserIcon }
