const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')

const BING_HOST = 'cn.bing.com'
const BING_API = '/HPImageArchive.aspx?format=js'
// npanuhin/Bing-Wallpaper-Archive：2009 年至今的全量归档，免费无频控
const ARCHIVE_API = 'https://bing.npanuhin.me'

// 通过 window 对象向渲染进程注入 nodejs 能力
window.bingpaper = {
  // ---------- 数据获取 ----------

  // 拉取最近两周壁纸列表：中国区 + 国际区（ensearch=1）各取 idx=0&n=8 + idx=8&n=7，
  // 按 urlbase 去重（同一张图会出现在多个市场）、enddate 倒序，实测约 28 张
  async fetchList() {
    const requests = [
      `${BING_API}&idx=0&n=8`,
      `${BING_API}&idx=8&n=7`,
      `${BING_API}&idx=0&n=8&ensearch=1`,
      `${BING_API}&idx=8&n=7&ensearch=1`
    ].map((u) => this._getJson(u))
    const results = await Promise.allSettled(requests)
    const images = []
    const seen = new Set()
    for (const r of results) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value.images)) continue
      for (const img of r.value.images) {
        // 同一张图在不同市场的 urlbase 后缀不同（_ZH-CN / _EN-CN），基础 id 才是去重键；
        // 中国区请求排在前面，先到先得即可保留中文标题
        const key = img.urlbase ? img.urlbase.split('_')[0] : img.enddate
        if (img.urlbase && !seen.has(key)) {
          seen.add(key)
          images.push(img)
        }
      }
    }
    if (images.length === 0) {
      throw new Error('Bing 接口请求失败')
    }
    images.sort((a, b) => (a.enddate < b.enddate ? 1 : -1))
    return images
  },

  // 历史归档（npanuhin/Bing-Wallpaper-Archive）：按年拉取中国区数据，映射为与官方接口相同的结构。
  // 归档 bing_url 是 Bing 官方 UHD 直链，可提取 urlbase → 缩略图走 640x360、下载/设壁纸走 UHD CDN；
  // 归档自身直链（it.url，约 1920x1080）作为无 urlbase 时的兜底。CN-zh 数据从 2024-04 开始。
  async fetchArchive(year) {
    const data = await this._getJson(`${ARCHIVE_API}/CN-zh.${year}.json`)
    if (!Array.isArray(data)) {
      throw new Error('归档数据格式异常')
    }
    return data
      .map((it) => {
        const m = /th\?id=(.+?)_(?:UHD|1920x1080)\.jpg/.exec(it.bing_url || '')
        // 规范成与官方接口一致的 urlbase 形态（带 /th?id= 前缀）
        const urlbase = m ? `/th?id=${m[1]}` : ''
        return {
          startdate: (it.date || '').replace(/-/g, ''),
          enddate: (it.date || '').replace(/-/g, ''),
          url: it.url || '',
          urlbase,
          copyright: [it.caption, it.copyright].filter(Boolean).join(' · '),
          title: it.title || it.caption || '',
          story: it.description || '',
          archived: true
        }
      })
      .sort((a, b) => (a.enddate < b.enddate ? 1 : -1))
  },

  // ---------- 文件下载 ----------

  // 下载图片到指定路径；已存在则直接跳过；返回最终路径
  async download(urlPath, savePath) {
    if (fs.existsSync(savePath)) {
      return savePath
    }
    fs.mkdirSync(path.dirname(savePath), { recursive: true })
    const url = urlPath.startsWith('http') ? urlPath : `https://${BING_HOST}${urlPath}`
    const buf = await this._downloadBinary(url)
    fs.writeFileSync(savePath, buf)
    return savePath
  },

  // 缩略图：Node 下载到本地临时缓存后转 data URL。
  // 部分环境下渲染进程直连 Bing CDN 会失败（QUIC/代理），Node 走普通 TCP 稳定；
  // 磁盘缓存后重复翻页不再走网络。
  async thumbDataUrl(url) {
    const key = crypto.createHash('md5').update(url).digest('hex')
    const dir = path.join(os.tmpdir(), 'bingpaper-thumbs')
    const file = path.join(dir, `${key}.jpg`)
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, await this._downloadBinary(url))
    }
    return 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64')
  },

  // 默认保存目录：~/Pictures/BingPaper
  defaultSaveDir() {
    return path.join(os.homedir(), 'Pictures', 'BingPaper')
  },

  // 确保目录存在，返回传入路径
  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true })
    return dir
  },

  // 文件名：Bing_20260917_UHD.jpg（不含目录）
  buildFileName(enddate, resolution) {
    return `Bing_${enddate}_${resolution}.jpg`
  },

  // 拼接图片 URL：resolution 为 '640x360' | '1920x1080' | 'UHD'。
  // 官方接口 urlbase 自带 '/' 前缀，归档提取的没有——这里统一补齐，否则会拼出 cn.bing.comOHR... 的非法主机名
  imageUrl(urlbase, resolution) {
    const base = urlbase.startsWith('/') ? urlbase : '/' + urlbase
    return `https://${BING_HOST}${base}_${resolution}.jpg`
  },

  // ---------- 系统交互 ----------

  // 设为桌面壁纸（Windows）：PowerShell P/Invoke SystemParametersInfo(SPI_SETDESKWALLPAPER)
  setWallpaper(filePath) {
    // PowerShell 单引号字符串内反斜杠是字面量，只需把单引号翻倍转义
    const psPath = filePath.replace(/'/g, "''")
    const script = [
      "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Wallpaper {[DllImport(\"user32.dll\", CharSet = CharSet.Auto)]public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);}'",
      `[Wallpaper]::SystemParametersInfo(20, 0, '${psPath}', 3)`
    ].join('\r\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { timeout: 30000 },
        (err, stdout) => {
          if (err) {
            reject(new Error(`设置壁纸失败: ${err.message}`))
          } else {
            resolve(stdout.trim())
          }
        }
      )
    })
  },

  // 弹出系统目录选择框，返回所选目录或 null
  pickDirectory(title) {
    const picked = window.ztools.showOpenDialog({
      title,
      properties: ['openDirectory', 'createDirectory']
    })
    return picked && picked.length > 0 ? picked[0] : null
  },

  // ---------- 内部工具 ----------

  // GET JSON，带重定向跟随
  _getJson(urlPath) {
    return this._request(urlPath.startsWith('http') ? urlPath : `https://${BING_HOST}${urlPath}`)
      .then((body) => JSON.parse(body))
  },

  _request(url, redirects = 3) {
    return new Promise((resolve, reject) => {
      https
        .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 bingpaper' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
            res.resume()
            this._request(res.headers.location, redirects - 1).then(resolve, reject)
            return
          }
          if (res.statusCode !== 200) {
            res.resume()
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks)))
          res.on('error', reject)
        })
        .on('error', reject)
    })
  },

  _downloadBinary(url) {
    return this._request(url)
  }
}
