const WebSocket = require('ws')
const { v4: uuidv4 } = require('uuid')

/** 方法参考：https://github.com/wxxxcxx/ms-ra-forwarder */
class Service {
  // ws = null
  // executorMap = undefined
  // bufferMap = undefined
  // heartbeatTimer = undefined

  constructor() {
    this.executorMap = new Map()
    this.bufferMap = new Map()
  }

  async sendHeartbeat() {
    if (this.ws && this.ws.readyState == WebSocket.OPEN) {
      // const requestId = randomBytes(16).toString('hex').toLowerCase()
      const requestId = uuidv4().toLowerCase().replace(/-/g, '')
      // console.debug(`发送心跳：${requestId}`)
      const ssml
        = '<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xmlns:emo="http://www.w3.org/2009/10/emotionml" version="1.0" xml:lang="en-US"><voice name="en-US-JennyNeural"><prosody rate="0%" pitch="0%">滴答</prosody></voice></speak>'
      const ssmlMessage
        = `X-Timestamp:${new Date()}\r\n`
        + `X-RequestId:${requestId}\r\n`
        + `Content-Type:application/ssml+xml\r\n`
        + `Path:ssml\r\n\r\n${
          ssml}`
      await this.ws.ping()
      await this.ws.send(ssmlMessage, (ssmlError) => {})
    }
  }

  async connect() {
    // const connectionId = randomBytes(16).toString('hex').toUpperCase()
    const connectionId = uuidv4().toLowerCase().replace(/-/g, '')
    const url = `wss://eastus.api.speech.microsoft.com/cognitiveservices/websocket/v1?TrafficType=AzureDemo&X-ConnectionId=${connectionId}`
    const ws = new WebSocket(url, {
      host: 'eastus.tts.speech.microsoft.com',
      origin: 'https://azure.microsoft.com',
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
        // 服务器会自动断开空闲的连接
        this.ws = null
        if (this.heartbeatTimer) {
          clearTimeout(this.heartbeatTimer)
          this.heartbeatTimer = null
        }
        for (const [key, value] of this.executorMap) {
          value.reject(`连接已关闭: ${reason} ${code}`)
        }
        this.executorMap.clear()
        this.bufferMap.clear()
        console.info(`连接已关闭： ${reason} ${code}`)
      })

      ws.on('message', (message, isBinary) => {
        const pattern = /X-RequestId:([a-z|0-9]*)/
        // let pattern = /X-RequestId:(?<id>[a-z|0-9]*)/
        if (!isBinary) {
          // console.debug('收到文本消息：%s')
          const data = message.toString()
          if (data.includes('Path:turn.start')) {
            // 开始传输
            const matches = data.match(pattern)
            const requestId = matches[1]
            // console.debug(`开始传输：${requestId}`)
            this.bufferMap.set(requestId, Buffer.from([]))
          }
          else if (data.includes('Path:turn.end')) {
            // 结束传输
            const matches = data.match(pattern)
            const requestId = matches[1]

            const executor = this.executorMap.get(requestId)
            if (executor) {
              this.executorMap.delete(matches[1])
              const result = this.bufferMap.get(requestId)
              executor.resolve(result)
            }
            // console.debug(`传输完成：${requestId}`)
          }
        }
        else if (isBinary) {
          const separator = 'Path:audio\r\n'
          const data = message
          const contentIndex = data.indexOf(separator) + separator.length

          const headers = data.slice(2, contentIndex).toString()
          const matches = headers.match(pattern)
          const requestId = matches[1]

          const content = data.slice(contentIndex)

          // console.debug(
          //   `收到音频片段：${requestId} Length: ${content.length}`,
          // )
          let buffer = this.bufferMap.get(requestId)
          if (buffer) {
            buffer = Buffer.concat([buffer, content])
            this.bufferMap.set(requestId, buffer)
            // console.debug(`保存片段：${requestId}`)
          }
          else {
            // console.debug(`忽略片段：${requestId}`)
          }
        }
      })
      ws.on('error', (error) => {
        console.log(error)
        console.error(`连接失败： ${error}`)
        reject(`连接失败： ${error}`)
      })
      ws.on('ping', (data) => {
        // console.debug('received ping %s', data)
        ws.pong(data)
        console.debug('sent pong %s', data)
      })
      ws.on('pong', (data) => {
        // console.debug('received pong %s', data)
      })
    })
  }

  async convert(ssml, format) {
    if (this.ws == null || this.ws.readyState != WebSocket.OPEN) {
      console.info('准备连接服务器……')
      const connection = await this.connect()
      this.ws = connection
      console.info('连接成功！')
    }
    // const requestId = randomBytes(16).toString('hex').toLowerCase()
    const requestId = uuidv4().toLowerCase().replace(/-/g, '')
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
      console.info(`开始转换：${requestId}`)
      console.debug(`准备发送配置请求：${requestId}\n`)
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
        console.debug(`准备发送SSML消息：${requestId}\n`)
        this.ws.send(ssmlMessage, (ssmlError) => {
          if (ssmlError) {
            console.error(`SSML消息发送失败：${requestId}\n`, ssmlError)
          }
        })
      })
    })

    // 收到请求, 清除超时定时器
    if (this.heartbeatTimer) {
      console.debug('收到新的请求, 清除超时定时器')
      clearTimeout(this.heartbeatTimer)
    }
    // 设置定时器, 超过10秒没有收到请求, 发送一个请求以维持连接。
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, 10000)

    const data = await Promise.race([
      result,
      new Promise((resolve, reject) => {
        // 如果超过 60 秒没有返回结果, 则清除请求并返回超时
        setTimeout(() => {
          this.executorMap.delete(requestId)
          this.bufferMap.delete(requestId)
          reject('转换超时')
        }, 60000)
      }),
    ])
    console.info(`转换完成：${requestId}`)
    console.info(`剩余 ${this.executorMap.size} 个任务`)
    return data
  }
}

module.exports = new Service()
