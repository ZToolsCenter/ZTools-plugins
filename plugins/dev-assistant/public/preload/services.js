const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const crypto = require('node:crypto')

// ztools / uTools 宿主 API 面兼容
function getHost () {
  return (typeof window !== 'undefined' && (window.ztools || window.utools)) || null
}

function getDownloadsPath () {
  const host = getHost()
  if (host?.getPath) return host.getPath('downloads')
  // 退化到系统家目录，避免 preload 加载时 host 尚未注入导致崩溃
  return require('node:os').homedir()
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile (file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile (text) {
    const filePath = path.join(getDownloadsPath(), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile (base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(getDownloadsPath(), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  async translateWithBaidu ({ query, appId, secretKey }) {
    const text = String(query ?? '').trim()
    const id = String(appId ?? '').trim()
    const key = String(secretKey ?? '').trim()

    if (!text) throw new Error('请输入需要命名的中文或短语')
    if (!id || !key) throw new Error('请先填写百度翻译 App ID 和密钥')

    return baiduTranslateToEnglish(text, id, key)
  }
}

function baiduTranslateToEnglish (query, appId, secretKey) {
  const salt = Date.now().toString()
  const sign = md5(appId + query + salt + secretKey)
  const params = new URLSearchParams({
    q: query,
    from: 'auto',
    to: 'en',
    appid: appId,
    salt,
    sign
  })

  return requestJson('https://fanyi-api.baidu.com/api/trans/vip/translate?' + params.toString())
    .then((body) => {
      if (body.error_code) {
        throw new Error(`百度翻译错误 ${body.error_code}: ${body.error_msg || '未知错误'}`)
      }

      const translated = Array.isArray(body.trans_result)
        ? body.trans_result.map((item) => item.dst).filter(Boolean).join(' ')
        : ''

      if (!translated.trim()) throw new Error('未得到有效英文结果')
      return translated
    })
}

function requestJson (url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`百度翻译请求失败，HTTP ${res.statusCode}`))
          return
        }

        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(new Error(`百度翻译响应解析失败：${err.message}`))
        }
      })
    })

    req.setTimeout(10000, () => {
      req.destroy(new Error('百度翻译请求超时'))
    })
    req.on('error', (err) => {
      reject(new Error(`百度翻译请求失败，请检查网络或 API 配置：${err.message}`))
    })
  })
}

function md5 (text) {
  return crypto.createHash('md5').update(text).digest('hex')
}
