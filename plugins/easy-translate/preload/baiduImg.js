const fs = require ('node:fs')
const os = require ('node:os')
const path = require('node:path')
const md5 = require('md5')
const urllib = require('urllib')

const cuid = 'APICUID'
const paste = '1'
const mac = 'mac'
const version = '3'

// 得到一个两数之间的随机整数
function getRandomInt(min, max) {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min)) + min // 不含最大值, 含最小值
}

module.exports = {
  async transImg(params, keyConfig) {
    const { from, to, file: fileBolb } = params
    const { appid, token } = keyConfig
    const salt = getRandomInt(1000001, 10000000).toString()

    const arrayBuffer = await fileBolb.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const tempDir = os.tmpdir()
    const tempFilePath = path.join (tempDir, `${Math.random().toString(36).substring(2)}.png`)
    fs.writeFileSync(tempFilePath, buffer)
    const sign = md5(`${appid}${md5(buffer)}${salt}${cuid}${mac}${token}`)

    const data = {
      from,
      to,
      appid,
      salt,
      cuid,
      mac,
      version,
      paste,
      sign,
      image: buffer,
    }

    const url = 'https://fanyi-api.baidu.com/api/trans/sdk/picture'

    return urllib.request(url, {
      method: 'POST',
      data,
      files: {
        image: buffer,
      },
      contentType: 'multipart/form-data',
      dataType: 'json',
    })
  },
}
