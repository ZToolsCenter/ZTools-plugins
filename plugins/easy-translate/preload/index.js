/** 涉及node业务 */

// const google = require('./googleTranslateApi')
const fs = require('node:fs')
const ali = require('./alicloudApi')
const baiduImg = require('./baiduImg')
const mstts = require('./mstts')
const request = require('./request')
// const googleT = require('./google/browser/googleT')

// transImg
window.utools = {
  ...window.ztools
}

// 设置请求头
ztools.http.setHeaders({
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) uTools/7.2.1 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36'
})


const _setImmediate = setImmediate
const _clearImmediate = clearImmediate
process.once('loaded', () => {
  global.setImmediate = _setImmediate
  global.clearImmediate = _clearImmediate
})

// 提供给web的方法
window.servers = {
  // 谷歌翻译
  googleTextTranslateByLocal: (params) => {
    // return googleT.run(params)
    return {
      result: '暂不支持本地翻译',
    }
  },

  // 阿里翻译
  aliTextTranslate: (params, credential) => {
    return ali.textTranslate(params, credential)
  },

  // 语音朗读
  voiceReading: async (Format, SSML) => {
    const mp3buffer = await mstts.getTTSData(
      Format,
      SSML,
    )
    return mp3buffer
  },

  // 图片翻译
  transImg: async (params, keyConfig) => {
    return baiduImg.transImg(params, keyConfig)
  },

  // 网络请求
  request,

  // 将 base64 编码数据转换为 Buffer 数据
  baseToBuffer(img) {
    return Buffer.from(img.replace(/^data:image\/png;base64,/, ''), 'base64')
  },

  // 使用 utools 复制图片数据
  copyImg(img) {
    return utools.copyImage(this.baseToBuffer(img))
  },

  // 使用 utools 将图片保存到本地
  saveImg(img) {
    const path = utools.showSaveDialog({
      title: '保存图片',
      defaultPath: `${utools.getPath('pictures')}/${Date.now()}.png`,
    })
    if (path) {
      fs.writeFileSync(path, this.baseToBuffer(img))
      return true
    }
  },

  // 截图
  async screenCapture() {
    return new Promise((resolve) => {
      utools.screenCapture((base64Str) => {
        resolve(base64Str)
      })
    })
  },

  // 打开文件选择窗口
  openFileDialog() {
    return utools.showOpenDialog({
      title: '选择图片',
    })
  },

  // 读取图片文件数据
  readImgFile(path) {
    return fs.readFileSync(path)
  },

  // 监听插件从后台进入前台, 如果改事件已经触发, 则返回上次触发返回的数据
  pluginEnterData: null,
  onPluginEnter(callback) {
    if (this.pluginEnterData) {
      callback(this.pluginEnterData)
    }
    else {
      window.utools.onPluginEnter((params) => {
        callback(params)
      })
    }
  },
}

// 主动监听进入事件, 避免错过的数据
window.utools.onPluginEnter((params) => {
  window.servers.pluginEnterData = params
})
