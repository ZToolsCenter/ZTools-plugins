const fs = require('node:fs')
const path = require('node:path')
const { createV2exService } = require('./v2ex-service.cjs')
const { createSystemProxyRequest, requestAvatarDataUrl } = require('./proxy-request.cjs')

const v2exService = createV2exService(createSystemProxyRequest())
const avatarCache = new Map()

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
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
  // 显式通过 macOS 系统 HTTPS 代理使用 Node 请求，避免渲染页跨域限制和 ZTools 会话未继承代理的问题。
  getV2exTopics(kind) {
    return v2exService.getTopics(kind)
  },
  getV2exTopic(topicId) {
    return v2exService.getTopic(topicId)
  },
  getV2exReplies(topicId) {
    return v2exService.getReplies(topicId)
  },
  getV2exAvatar(url) {
    if (!avatarCache.has(url)) avatarCache.set(url, requestAvatarDataUrl(url))
    return avatarCache.get(url).catch((error) => {
      avatarCache.delete(url)
      throw error
    })
  }
}
