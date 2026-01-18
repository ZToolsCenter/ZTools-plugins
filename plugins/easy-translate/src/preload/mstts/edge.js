const crypto = require('node:crypto')
const { v4: uuidv4 } = require('uuid')
const WebSocket = require('ws')

const randomBytes = crypto.randomBytes

class Service {
  constructor() {
    this.executorMap = new Map()
    this.bufferMap = new Map()
  }

  async connect() {
    const connectionId = randomBytes(16).toString('hex').toLowerCase()
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=${connectionId}`
    const ws = new WebSocket(url, {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.66 Safari/537.36 Edg/103.0.1264.44',
      },
    })
    return new Promise((resolve, reject) => {
      ws.on('open', () => {
        resolve(ws)
      })
      ws.on('close', (code, reason) => {
        // 服务器会自动断开空闲超过30秒的连接
        this.ws = null
        if (this.timer) {
          clearTimeout(this.timer)
          this.timer = null
        }
        for (const [key, value] of this.executorMap) {
          value.reject(`连接已关闭: ${reason} ${code}`)
        }
        this.executorMap.clear()
        this.bufferMap.clear()
        console.info(`连接已关闭： ${reason} ${code}`)
      })

      ws.on('message', (message, isBinary) => {
        const pattern = /X-RequestId:(?<id>[a-z|0-9]*)/
        if (!isBinary) {
          console.debug('收到文本消息：%s', message)
          const data = message.toString()
          if (data.includes('Path:turn.start')) {
            // 开始传输
            const matches = data.match(pattern)
            const requestId = matches.groups.id
            console.debug(`开始传输：${requestId}……`)
            this.bufferMap.set(requestId, Buffer.from([]))
          }
          else if (data.includes('Path:turn.end')) {
            // 结束传输
            const matches = data.match(pattern)
            const requestId = matches.groups.id

            const executor = this.executorMap.get(requestId)
            if (executor) {
              this.executorMap.delete(matches.groups.id)
              const result = this.bufferMap.get(requestId)
              executor.resolve(result)
              console.debug(`传输完成：${requestId}……`)
            }
            else {
              console.debug(`请求已被丢弃：${requestId}`)
            }
          }
        }
        else if (isBinary) {
          const separator = 'Path:audio\r\n'
          const data = message
          const contentIndex = data.indexOf(separator) + separator.length

          const headers = data.slice(2, contentIndex).toString()
          const matches = headers.match(pattern)
          const requestId = matches.groups.id

          const content = data.slice(contentIndex)

          console.debug(
            `收到音频片段：${requestId} Length: ${content.length}\n${headers}`,
          )

          let buffer = this.bufferMap.get(requestId)
          if (buffer) {
            buffer = Buffer.concat([buffer, content])
            this.bufferMap.set(requestId, buffer)
          }
          else {
            console.debug(`请求已被丢弃：${requestId}`)
          }
        }
      })
      ws.on('error', (error) => {
        console.error(`连接失败： ${error}`)
        reject(`连接失败： ${error}`)
      })
      ws.on('ping', (data) => {
        console.debug('ping %s', data)
      })
      ws.on('pong', (data) => {
        console.debug('pong %s', data)
      })
    })
  }

  async convert(ssml, format) {
    console.log({
      ssml,
      format,
    })
    if (this.ws == null || this.ws.readyState != WebSocket.OPEN) {
      console.info('edge    准备连接服务器……')
      const connection = await this.connect()
      this.ws = connection
      console.info('连接成功！')
    }
    const requestId = randomBytes(16).toString('hex').toLowerCase()
    const result = new Promise((resolve, reject) => {
      // 等待服务器返回后这个方法才会返回结果
      this.executorMap.set(requestId, {
        resolve,
        reject,
      })
      // 发送配置消息
      const configData = {
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: 'false',
                wordBoundaryEnabled: 'false',
              },
              outputFormat: format,
            },
          },
        },
      }
      const configMessage
        = `X-Timestamp:${new Date()}\r\n`
        + `Content-Type:application/json; charset=utf-8\r\n`
        + `Path:speech.config\r\n\r\n${
          JSON.stringify(configData)}`
      console.info(`开始转换：${requestId}……`)
      console.debug(`准备发送配置请求：${requestId}\n`, configMessage)
      this.ws.send(configMessage, (configError) => {
        if (configError) {
          console.error(`配置请求发送失败：${requestId}\n`, configError)
        }

        // 发送SSML消息
        const ssmlMessage
          = `X-Timestamp:${new Date()}\r\n`
          + `X-RequestId:${requestId}\r\n`
          + `Content-Type:application/ssml+xml\r\n`
          + `Path:ssml\r\n\r\n${
            ssml}`
        console.debug(`准备发送SSML消息：${requestId}\n`, ssmlMessage)
        this.ws.send(ssmlMessage, (ssmlError) => {
          if (ssmlError) {
            console.error(`SSML消息发送失败：${requestId}\n`, ssmlError)
          }
          else {
            console.log(`SSML消息发送成功`)
          }
        })
      })
    })

    // 收到请求, 清除超时定时器
    if (this.timer) {
      console.debug('收到新的请求, 清除超时定时器')
      clearTimeout(this.timer)
    }
    // 设置定时器, 超过10秒没有收到请求, 主动断开连接
    console.debug('创建新的超时定时器')
    this.timer = setTimeout(() => {
      if (this.ws && this.ws.readyState == WebSocket.OPEN) {
        console.debug('已经 10 秒没有请求, 主动关闭连接')
        this.ws.close(1000)
        this.timer = null
      }
    }, 10000)

    const data = await Promise.race([
      result,
      new Promise((resolve, reject) => {
        // 如果超过 20 秒没有返回结果, 则清除请求并返回超时
        setTimeout(() => {
          this.executorMap.delete(requestId)
          this.bufferMap.delete(requestId)
          reject('转换超时')
        }, 10000)
      }),
    ])
    console.info(`转换完成：${requestId}`)
    console.info(`剩余 ${this.executorMap.size} 个任务`)
    return data
  }
}

module.exports = Service
