const fs = require('node:fs')
const path = require('node:path')

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
  }
}

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const urlParser = require('node:url');

/**
 * 检查目录是否存在，不存在则新建
 * @param directoryPath
 */
window.checkOrCreateDirectory = (directoryPath) => {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath)
  }
  return directoryPath
}

/**
 * 检查收藏目录是否存在，不存在则新建
 */
window.checkOrCreateCollectedDirectory = () => window.checkOrCreateDirectory(`${ztools.getPath('userData')}/ztoolsCollectedEmoticons`)

/**
 * 二次复制策略,gif直接使用copyFile,其他格式先使用copyImage,失败则使用copyFile重试复制
 * @param destFile
 * @returns {*}
 */
window.tryCopy = (destFile) => {
  // 如果是gif，则用文件函数复制,copyFile方法一般不会失败
  if (destFile.endsWith("gif")) {
    return ztools.copyFile(destFile)
  }

  // 其他格式尝试使用copyImage方法,但是可能失败,则使用copyFile重试
  let copyResult = ztools.copyImage(destFile)
  if (!copyResult) {
    copyResult = ztools.copyFile(destFile)
  }

  return copyResult
}
/**
 * 复制图片到剪贴板
 * @param filePath
 */
window.copyImage = ({imgSrc, fileSrc}, callback) => {
  let localFilePath = fileSrc.replace("file://", "")

  // 根据原始的图片链接，创建本地图片路径
  let destFile = composeFilePath(imgSrc)
  if (!fs.existsSync(destFile)) {
    fs.copyFileSync(localFilePath, destFile)
  }

  const copyResult = window.tryCopy(destFile)

  if (!copyResult) {
    ztools.showNotification("复制失败,麻烦告知作者操作流程进行问题排查,感谢~")
    return
  }
  callback && callback()
  ztools.hideMainWindow()
}

// 移除本地文件
window.removeFile = (filePath) => fs.existsSync(filePath) && fs.unlinkSync(filePath)

/**
 * 根据url地址，组装收藏表情包本地随机文件路径
 * @param url
 * @returns {`${string}/${string}.${string}`}
 */
window.composeCollectedFilePath = (url) => window.composeFilePath(url, {downloadPath: window.checkOrCreateCollectedDirectory()})

/**
 * 根据url超链接，组装本地随机文件路径
 * @param url
 * @param config
 * @returns {`${string}/${string}.${string}`}
 */
window.composeFilePath = (url, config = {}) => {
  // 文件名采用随机方式，避免文件冲突
  let fileName = `${crypto.createHash('md5').update(url).digest('hex')}`
  // 所有静态和动态类型图片，都统一使用gif格式,避免发出去的表情包不动
  let fileSuffix = config['fileSuffix'] || '.gif'
  // 组装文件路径,需要将文件后缀拼接上/未指定下载目录，使用temp目录
  return `${config['downloadPath'] || ztools.getPath("temp")}/${fileName}${fileSuffix}`
}

/**
 * 下载远程文件到本地
 * @param url
 * @param filePath
 * @param config
 * @returns {Promise<unknown>}
 */
const downloadRemoteFile = (url, filePath, config) => {
  const {host, path} = urlParser.parse(url)
  const request = url.startsWith('https') ? https : http

  return new Promise(resolve => request.get({
    host: `${host.replace('https://', '').replace('http://', '')}`,
    path: path,
    method: 'get',
    headers: config['headers'] || {}
  }, res => {
    res.pipe(fs.createWriteStream(filePath))
        .on('close', () => resolve(filePath))
  }))
}

const fetchHostMap = (host) => {
  if (host === 'img.soutula.com') {
    return 'https://fabiaoqing.com/'
  }

  if (host === 'img.adoutu.com') {
    return 'https://www.adoutu.com/'
  }
  return host
}

/**
 * 下载图片到本地临时目录
 * @param url
 * @param config
 */
window.downloadImage = async (url, config = {}) => {
  // 默认组装Referer header头
  const {host} = urlParser.parse(url)
  config = Object.assign({'headers': {'Referer': fetchHostMap(host)}, ...config})

  // 组装文件路径,需要将文件后缀拼接上
  const filePath = composeFilePath(url, config)
  // 旧表情包
  const checkFilePath = composeFilePath(url, Object.assign(config, {fileSuffix: '.jpg'}))

  if (!fs.existsSync(filePath) && fs.existsSync(checkFilePath)) {
    // 历史表情包存在,直接复制成新的路径
    fs.cpSync(checkFilePath, filePath)
    return {
      imgSrc: url, fileSrc: `file://${checkFilePath}`,
    }
  }


  if (!fs.existsSync(filePath)) {
    await downloadRemoteFile(url, filePath, config)
  }

  // 二次检查，文件存在且不符合要求则删除掉
  if (fs.existsSync(filePath)) {
    const {size: fileSize} = fs.statSync(filePath)

    // 不存在的文件或者小于1k的图表，删除缓存并跳过
    if (fileSize < 1024) {
      fs.unlinkSync(filePath)
      return null
    }
  }

  return {
    imgSrc: url, fileSrc: `file://${filePath}`,
  }
}

/**
 * 使用浏览器打开超链接
 * @param link
 * @returns {*}
 */
window.openLink = (link) => ztools.shellOpenExternal(link)
