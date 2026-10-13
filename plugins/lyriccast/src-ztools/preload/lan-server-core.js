'use strict'
/**
 * lan-server-core.js — 词投(LyricCast)插件的 WebSocket 服务端核心(推送协议 v1.1)。
 *
 * 纯 Node 模块,不依赖 window / Electron,可在普通 Node 进程中单元测试;
 * preload/server.js 是它接入 ZTools 的薄适配层。
 *
 * 职责:
 * - 监听 0.0.0.0:<port>,校验 hello.token(错误回 error 并断开,不泄漏任何数据);
 * - 多设备接入、按"playing 优先 → 最近快照优先"选活跃设备(UI 可手动切换);
 * - 链路层存活(协议 §6.1):每 10 秒向设备发 ws PING 帧,距上次 PONG ≥ 45s
 *   才 terminate(时间制,容忍息屏时 WiFi 省电缓冲的包延迟);
 *   v1.0 的"20 秒无应用消息即断开"watchdog 已废除(息屏断连主因);
 * - 断线宽限期:设备断开后保留 30 秒"墓碑"记录,期间 getPosition 仍可插值,
 *   UI 展示灰化降级;超时后清理;
 * - seq 乱序丢弃(协议 §2.9):同一连接内 seq 回退的 state 丢弃,snapshot 无条件接受;
 * - getPosition():按协议 §5 用"sentAt − 时钟偏差"为锚点插值出当前进度;
 * - 单帧消息上限 2MB(ws maxPayload);日志不打印 token。
 */
const { WebSocketServer } = require('ws')

const PROTOCOL_V = 1
const HELLO_TIMEOUT_MS = 10_000
const PC_PING_INTERVAL_MS = 10_000
/**
 * 判死改为时间制:距上次 PONG ≥ 45s 才 terminate(v1.1 的"连续 2 个周期 20s"
 * 在手机息屏/WiFi 省电缓冲场景会把只是变慢的连接误杀,是后台断连主因之一)。
 */
const PONG_DEAD_MS = 45_000
/** 断线墓碑保留时长(UI 宽限期,协议 §6.3) */
const LAPSE_GRACE_MS = 30_000
const OFFSET_EMA_ALPHA = 0.3

/**
 * 纯函数:设备的应用层消息是否已过期(协议 §6.2,仅 playing 时判 stale)。
 * 独立导出便于单测;服务端只在 getSnapshot 里附带展示,超时动作由 UI 决定。
 */
function isAppStale(device, nowMs, staleMs = 24_000) {
  const st = device.lastState
  if (!st || !st.playback || st.playback.state !== 'playing') return false
  return nowMs - (device.lastAppMessageAt || 0) > staleMs
}

class LanServerCore {
  /**
   * @param {object} options
   * @param {number} options.port 监听端口(默认 18765)
   * @param {string} options.token 配对 Token(≥16 位,校验失败直接拒绝)
   * @param {object} [options.logger] 注入的日志对象(默认 console;测试可传静默实现)
   */
  constructor(options) {
    this.port = options.port || 18765
    this.token = options.token || ''
    this.logger = options.logger || console
    this.onEvent = null // (event) => void,由适配层/UI 订阅

    /** @type {import('ws').WebSocketServer|null} */
    this.wss = null
    /** @type {Map<string, object>} deviceId → 在线设备状态 */
    this.devices = new Map()
    /** @type {Map<string, object>} deviceId → 断线墓碑(宽限期内保留,协议 §6.3) */
    this.lapsed = new Map()
    this.activeDeviceId = null
    this._timers = []
  }

  /** 启动监听;端口占用等错误通过 rejected Promise 返回。 */
  start() {
    if (this.wss) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      const wss = new WebSocketServer({
        port: this.port,
        host: '0.0.0.0',
        path: '/relay',
        maxPayload: 2 * 1024 * 1024
      })
      wss.on('listening', () => {
        settled = true
        this.logger.log(`[lan-server] listening on 0.0.0.0:${this.port}/relay`)
        this._startTimers()
        resolve()
      })
      wss.on('error', (err) => {
        if (!settled) reject(err)
        else this.logger.error(`[lan-server] server error: ${err.message}`)
        this._emit({ kind: 'server-error', message: err.message })
      })
      wss.on('connection', (ws, req) => this._onConnection(ws, req))
      this.wss = wss
    })
  }

  /** 停止监听并断开全部设备。 */
  stop() {
    this._timers.forEach(clearInterval)
    this._timers = []
    if (this.wss) {
      for (const device of this.devices.values()) this._close(device.ws, 1001, 'server shutdown')
      const wss = this.wss
      this.wss = null
      try {
        wss.close()
      } catch (_) { /* 已关闭时忽略 */ }
    }
    this.devices.clear()
    this.lapsed.clear()
    this.activeDeviceId = null
    this._emit({ kind: 'snapshot' })
  }

  // ==================== 连接生命周期 ====================

  _onConnection(ws, req) {
    const peer = `${req.socket.remoteAddress}:${req.socket.remotePort}`
    this.logger.log(`[lan-server] connection from ${peer}`)

    /** @type {object} */
    const device = {
      ws,
      peer,
      deviceId: null,
      deviceName: '',
      appVersion: '',
      authed: false,
      lastState: null, // 最近一次协议 state/snapshot 消息
      lastStateAt: 0,
      lastAppMessageAt: Date.now(), // 最近一次应用层消息(state/snapshot/artwork/ping/pong)
      lastSeq: 0, // 本连接已处理的最大 seq(协议 §2.9),新连接重置
      awaitingPong: 0, // 已发未回的 ws PING 计数(仅诊断展示,判死用 lastPongAt 时间制)
      lastPongAt: Date.now(), // 最近一次收到 ws PONG 的时刻(判死基准,协议 §6.1)
      disconnectedAt: null, // 非 null 表示已断线(墓碑态)
      rttMs: -1,
      clockOffsetMs: 0, // 手机钟 − PC 钟 的 EMA 估计
      artwork: new Map() // trackId → {mime, dataBase64}
    }

    // 10 秒内必须完成 hello,防呆滞连接占位(手机亮屏瞬间进程可能被 ROM 短暂
    // 冻结,握手先于应用代码完成,hello 略晚到达;过短的超时会把它误杀并触发
    // 客户端 "closed 1005",故从 5s 放宽到 10s)
    const helloTimer = setTimeout(() => {
      if (!device.authed) {
        this.logger.log(`[lan-server] ${peer} hello timeout, closing`)
        this._close(ws, 1000, 'hello timeout')
      }
    }, HELLO_TIMEOUT_MS)
    if (helloTimer.unref) helloTimer.unref()

    ws.on('message', (raw) => {
      device.lastAppMessageAt = Date.now()
      let msg
      try {
        msg = JSON.parse(raw.toString('utf8'))
      } catch (_) {
        this._send(ws, { type: 'error', v: PROTOCOL_V, code: 'bad_message', message: 'invalid JSON' })
        this._close(ws, 1003, 'invalid json')
        return
      }
      if (!device.authed) {
        clearTimeout(helloTimer)
        this._handleHello(device, msg)
        return
      }
      this._handleMessage(device, msg)
    })

    // 链路层 PONG:任何 ws PONG 帧都会到达这里(对端对协议帧的回应)
    ws.on('pong', () => {
      device.awaitingPong = 0
      device.lastPongAt = Date.now()
    })

    ws.on('close', () => {
      clearTimeout(helloTimer)
      if (!device.deviceId) return // 被 hello 顶替过的旧连接,不再占有设备记录
      // 当前记录仍是本连接 → 转入墓碑(宽限期),不在 devices 里参与活跃选择
      if (this.devices.get(device.deviceId) === device) {
        this.devices.delete(device.deviceId)
        device.disconnectedAt = Date.now()
        this.lapsed.set(device.deviceId, device)
        this.logger.log(`[lan-server] ${device.deviceName || peer} disconnected (grace ${LAPSE_GRACE_MS}ms)`)
        this._emit({ kind: 'link', deviceId: device.deviceId, disconnectedAt: device.disconnectedAt })
        this._emit({ kind: 'snapshot' })
      } else if (this.lapsed.get(device.deviceId) === device) {
        this._emit({ kind: 'snapshot' })
      }
    })
      ws.on('error', () => { /* close 事件会跟进 */ })
  }

  /** 握手:第一条消息必须是 hello;token/版本不对直接拒绝。 */
  _handleHello(device, msg) {
    if (msg.type !== 'hello') {
      this._send(device.ws, { type: 'error', v: PROTOCOL_V, code: 'bad_message', message: 'expected hello first' })
      this._close(device.ws, 1003, 'expected hello first')
      return
    }
    if (typeof msg.token !== 'string' || msg.token !== this.token) {
      this.logger.log(`[lan-server] ${device.peer} rejected: bad_token`)
      this._send(device.ws, { type: 'error', v: PROTOCOL_V, code: 'bad_token', message: 'invalid token' })
      this._close(device.ws, 1008, 'invalid token')
      return
    }
    if (Number(msg.v) > PROTOCOL_V) {
      this._send(device.ws, { type: 'error', v: PROTOCOL_V, code: 'unsupported_version', message: 'please upgrade the PC plugin' })
      this._close(device.ws, 1008, 'unsupported version')
      return
    }
    device.authed = true
    device.deviceId = String(msg.deviceId || device.peer)
    device.deviceName = String(msg.deviceName || device.deviceId)
    device.appVersion = String(msg.appVersion || '')

    // 同一设备重连:顶掉旧连接,保留最新(协议 §7);并清除其墓碑
    const existing = this.devices.get(device.deviceId)
    if (existing && existing.ws !== device.ws) {
      existing.deviceId = null // 防止 close 时误删新记录
      this._close(existing.ws, 1000, 'superseded by new connection')
    }
    this.lapsed.delete(device.deviceId)
    this.devices.set(device.deviceId, device)
    if (!this.activeDeviceId || !this._findDevice(this.activeDeviceId)) {
      this.activeDeviceId = this._autoSelect()
    }
    this.logger.log(`[lan-server] device connected: ${device.deviceName} (${device.deviceId})`)
    this._send(device.ws, { type: 'hello_ack', v: PROTOCOL_V, serverTime: Date.now() })
    this._emit({ kind: 'snapshot' })
  }

  /** 已认证设备的业务消息路由。 */
  _handleMessage(device, msg) {
    switch (msg.type) {
      case 'state':
      case 'snapshot': {
        // 乱序丢弃(协议 §2.9):连接内 seq 回退的 state 丢弃;snapshot 无条件接受并重置基准
        const seq = Number(msg.seq)
        if (msg.type === 'state' && Number.isFinite(seq) && seq < device.lastSeq) {
          this.logger.log(`[lan-server] stale state seq=${seq} < ${device.lastSeq}, dropped`)
          break
        }
        if (Number.isFinite(seq)) device.lastSeq = seq
        device.lastState = msg
        device.lastStateAt = Date.now()
        // 新设备首发快照后,若当前无活跃设备则接管(墓碑不参与)
        if (!this.activeDeviceId || !this._findDevice(this.activeDeviceId)) {
          this.activeDeviceId = this._autoSelect()
        }
        // state 与 snapshot 载荷同构(协议 §2.8),对 UI 统一按 state 事件分发
        this._emit({
          kind: 'state',
          deviceId: device.deviceId,
          state: msg,
          meta: {
            recvAt: Date.now(),
            clockOffsetMs: device.clockOffsetMs,
            lastAppMessageAt: device.lastAppMessageAt
          }
        })
        this._emit({ kind: 'snapshot' })
        break
      }
      case 'artwork':
        if (msg.trackId && typeof msg.dataBase64 === 'string') {
          device.artwork.set(msg.trackId, { mime: String(msg.mime || 'image/jpeg'), dataBase64: msg.dataBase64 })
          // 只保留当前与上一首的封面,防内存膨胀
          if (device.artwork.size > 4) {
            const oldest = device.artwork.keys().next().value
            device.artwork.delete(oldest)
          }
          this._emit({ kind: 'artwork', deviceId: device.deviceId, trackId: msg.trackId, artwork: device.artwork.get(msg.trackId) })
        }
        break
      case 'ping':
        this._send(device.ws, { type: 'pong', v: PROTOCOL_V, t: msg.t, serverTime: Date.now() })
        break
      case 'pong': {
        const now = Date.now()
        const rtt = now - Number(msg.t)
        if (rtt >= 0 && rtt < 5_000) {
          device.rttMs = rtt
          // serverTime 产生于约 tSend + rtt/2(PC 钟)时刻 ⇒ 偏差 = serverTime − (t + rtt/2)
          const sample = Number(msg.serverTime) - (Number(msg.t) + rtt / 2)
          device.clockOffsetMs =
            device.rttMs === -1 ? sample : device.clockOffsetMs * (1 - OFFSET_EMA_ALPHA) + sample * OFFSET_EMA_ALPHA
        }
        break
      }
      default:
        this.logger.log(`[lan-server] unknown type "${msg.type}" from ${device.deviceId} (ignored)`)
    }
  }

  // ==================== 对 UI 的查询 ====================

  /** 在线设备与墓碑合并查找(墓碑在宽限期内仍可插值,协议 §6.3)。 */
  _findDevice(deviceId) {
    return this.devices.get(deviceId) || this.lapsed.get(deviceId) || null
  }

  /** 设备列表与活跃设备的只读快照,供 UI 渲染。 */
  getSnapshot() {
    const now = Date.now()
    const mapDevice = (d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      appVersion: d.appVersion,
      rttMs: d.rttMs,
      clockOffsetMs: Math.round(d.clockOffsetMs),
      connectedAt: d.lastStateAt,
      hasState: !!d.lastState,
      link: d.disconnectedAt ? 'lapsed' : isAppStale(d, now) ? 'stale' : 'connected',
      lastAppMessageAt: d.lastAppMessageAt,
      disconnectedAt: d.disconnectedAt
    })
    // 在线设备在前,宽限期墓碑随后(UI 据此展示灰化降级)
    const devices = [
      ...[...this.devices.values()].map(mapDevice),
      ...[...this.lapsed.values()].map(mapDevice)
    ]
    return {
      listening: !!this.wss,
      port: this.port,
      devices,
      activeDeviceId: this.activeDeviceId
    }
  }

  /** UI 手动切换活跃设备。 */
  setActiveDevice(deviceId) {
    if (!deviceId || this._findDevice(deviceId)) {
      this.activeDeviceId = deviceId
      this._emit({ kind: 'snapshot' })
    }
  }

  /** UI 请求设备重发封面/快照(发往活跃设备)。 */
  sendToActive(message) {
    const device = this._findDevice(this.activeDeviceId)
    if (device) this._send(device.ws, message)
  }

  /**
   * 插值当前播放进度(协议 §5)。
   * @param {string} [deviceId] 缺省用活跃设备
   * @param {number} [nowMs] 当前 PC 时钟毫秒;默认 Date.now(),测试可注入固定值
   * @returns {{positionMs:number, known:boolean, state:string, speed:number,
   *            durationMs:number, trackId:string, title:string, artist:string}|null}
   */
  getPosition(deviceId, nowMs) {
    const device = this._findDevice(deviceId || this.activeDeviceId)
    const st = device && device.lastState
    if (!st || !st.playback || !st.track) return null
    const now = Number(nowMs) || Date.now()
    const known = st.playback.positionKnown === true && Number(st.playback.positionMs) >= 0
    const durationMs = Number(st.track.durationMs) || 0
    let positionMs = Number(st.playback.positionMs)
    if (known) {
      const anchorPc = Number(st.sentAt) - device.clockOffsetMs // 手机钟 → PC 钟
      if (st.playback.state === 'playing') {
        positionMs += (now - anchorPc) * Number(st.playback.speed || 0)
      }
      positionMs = Math.max(0, positionMs)
      if (durationMs > 0) positionMs = Math.min(positionMs, durationMs)
      positionMs = Math.round(positionMs)
    }
    return {
      positionMs: known ? positionMs : -1,
      known,
      state: String(st.playback.state || 'none'),
      speed: Number(st.playback.speed) || 0,
      durationMs,
      trackId: String(st.track.id || ''),
      title: String(st.track.title || ''),
      artist: String(st.track.artist || '')
    }
  }

  /** 活跃设备的指定曲目封面(或最近一帧)。 */
  getArtwork(deviceId, trackId) {
    const device = this._findDevice(deviceId || this.activeDeviceId)
    if (!device) return null
    if (trackId && device.artwork.has(trackId)) return device.artwork.get(trackId)
    const last = [...device.artwork.values()].pop()
    return last || null
  }

  // ==================== 内部 ====================

  /** 活跃设备选择:playing 优先,其次最近快照(仅在线设备,协议 §1)。 */
  _autoSelect() {
    let best = null
    for (const device of this.devices.values()) {
      if (!best) { best = device; continue }
      const bestPlaying = best.lastState && best.lastState.playback && best.lastState.playback.state === 'playing'
      const playing = device.lastState && device.lastState.playback && device.lastState.playback.state === 'playing'
      if (playing && !bestPlaying) { best = device; continue }
      if (playing === bestPlaying && device.lastStateAt > best.lastStateAt) best = device
    }
    return best ? best.deviceId : null
  }

  _startTimers() {
    // 唯一的周期任务:ping/pong 判死 + 墓碑清理(职责全在 _pingAll,
    // 10s 节奏相对 45s 判死阈值足够);不要在此调用不存在的方法
    this._timers.push(setInterval(() => this._pingAll(), PC_PING_INTERVAL_MS))
  }

  /**
   * 链路层 ping(协议 §6.1)+ 墓碑清理。每 10 秒:
   * - 距上次 PONG ≥ PONG_DEAD_MS(45s)→ terminate(硬断,半开连接不等握手)。
   *   时间制而非"连续 N 个周期":息屏/切后台瞬间 WiFi 省电模式会把下行包缓冲
   *   数十秒,手机端锁都在但 PONG 迟到,固定周期会把这类健康连接误杀;
   * - 否则发 ws PING 帧并计数(awaitingPong 仅用于诊断展示);
   * - 宽限期结束的墓碑移除(此后 UI 自行冻结显示,协议 §6.3)。
   */
  _pingAll() {
    const now = Date.now()
    for (const device of this.devices.values()) {
      const lastPong = device.lastPongAt > 0 ? device.lastPongAt : now
      if (now - lastPong >= PONG_DEAD_MS) {
        this.logger.log(`[lan-server] no pong for ${now - lastPong}ms, terminate: ${device.deviceName}`)
        try { device.ws.terminate() } catch (_) { this._close(device.ws, 1000, 'dead link') }
        continue
      }
      try {
        device.ws.ping()
        device.awaitingPong = (device.awaitingPong || 0) + 1
      } catch (err) {
        this.logger.log(`[lan-server] ping failed: ${err && err.message}`)
      }
    }
    for (const [deviceId, device] of this.lapsed) {
      if (now - device.disconnectedAt > LAPSE_GRACE_MS) {
        this.lapsed.delete(deviceId)
        this.logger.log(`[lan-server] grace period ended for ${device.deviceName}`)
        if (this.activeDeviceId === deviceId && !this._findDevice(deviceId)) {
          this.activeDeviceId = this._autoSelect()
        }
        this._emit({ kind: 'snapshot' })
      }
    }
  }

  _send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
  }

  /**
   * 优雅关闭:必须携带状态码与原因,否则 OkHttp 客户端会把"无状态码 close 帧"
   * 报成 closed(1005),线上排障时无法区分关闭来源(hello 超时/顶替/停服/协议错)。
   * ws 库对已半关闭的 socket 抛异常时退化为 terminate(硬断)。
   */
  _close(ws, code = 1000, reason = '') {
    try {
      ws.close(code, reason)
    } catch (_) {
      try { ws.terminate() } catch (_) {}
    }
  }

  _emit(event) {
    if (this.onEvent) {
      try { this.onEvent(event) } catch (err) { this.logger.error(`[lan-server] onEvent handler failed: ${err.message}`) }
    }
  }
}


module.exports = { LanServerCore, PROTOCOL_V, isAppStale, PC_PING_INTERVAL_MS, PONG_DEAD_MS, LAPSE_GRACE_MS }
