'use strict'
/**
 * server.js — 词投(LyricCast)插件的 preload 适配层(ZTools 加载的入口)。
 *
 * 核心 WebSocket 服务端在 ./lan-server-core.js(纯 Node,可独立测试);
 * 本文件把它接到 window.services 上,UI(dist 里的 Vue 应用)直接调用,
 * 无需 IPC —— preload 与页面共享 window 上下文(ZTools:contextIsolation 关闭)。
 *
 * 依赖:本目录 package.json 为 commonjs,`npm install` 后 node_modules/ws 随插件分发;
 * 不得压缩/混淆(ZTools 发布要求),源码保持可读。
 */
const os = require('node:os')
const { LanServerCore } = require('./lan-server-core')

const DEFAULT_PORT = 18765
// 本地开发兜底 Token;实际使用时 UI 会生成随机 Token 并持久化到 ztools.dbStorage
const FALLBACK_TOKEN = 'please-change-this-token'

/** @type {LanServerCore|null} 当前服务实例(插件视图常驻,随插件终止销毁) */
let core = null
/** @type {Array<(event: object) => void>} UI 事件订阅者 */
const subscribers = []

/**
 * 常见虚拟网卡网段(VMware host-only / Clash fake-ip 等):连接不了真实局域网,
 * 排序时垫底,降低二维码首位地址不可达的概率(手机端还有同网段优选兜底)。
 */
const VIRTUAL_ADDRESS_PATTERNS = [/^192\.168\.56\./, /^192\.168\.232\./, /^198\.18\./]

/** 地址排序权重:普通 192.168/10 段最先,172 段次之,虚拟网卡段垫底,其余最后。 */
function addressRank(address) {
  if (VIRTUAL_ADDRESS_PATTERNS.some((pattern) => pattern.test(address))) return 3
  if (/^192\.168\./.test(address) || /^10\./.test(address)) return 0
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1
  return 2
}

/**
 * 枚举本机局域网 IPv4 地址,供 UI 展示给手机端填写。
 * 结果按 addressRank 排序:真实内网地址在前,虚拟网卡地址垫底。
 * @returns {string[]}
 */
function localAddresses() {
  const result = []
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) result.push(info.address)
    }
  }
  return result.sort((a, b) => addressRank(a) - addressRank(b))
}

/**
 * 持久化读取(优先 ztools.dbStorage,Node 直测环境退化为内存对象)。
 * @param {string} key
 * @param {any} fallback
 */
function storageGet(key, fallback) {
  try {
    if (window.ztools && window.ztools.dbStorage) {
      const value = window.ztools.dbStorage.getItem(key)
      return value === null || value === undefined ? fallback : value
    }
  } catch (_) { /* 存储不可用时静默退化 */ }
  return fallback
}

/** 与 storageGet 配对的写入。 */
function storageSet(key, value) {
  try {
    if (window.ztools && window.ztools.dbStorage) {
      window.ztools.dbStorage.setItem(key, value)
    }
  } catch (_) { /* 同上 */ }
}

function emit(event) {
  for (const cb of subscribers) {
    try { cb(event) } catch (_) { /* 单个订阅者异常不影响其他 */ }
  }
}

window.services = {
  /** 本机局域网 IPv4 列表 */
  localAddresses,

  /**
   * 词投(LyricCast)服务控制面。所有方法同步/Promise 混合,UI 侧按需 await。
   */
  lanLyrics: {
    /**
     * 启动(或按新配置重启)服务。
     * @param {{port?:number, token?:string}} [config] 缺省读持久化配置,再退默认值
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    async start(config) {
      const saved = storageGet('lanlyrics.config', {})
      const port = Number(config && config.port) || Number(saved.port) || DEFAULT_PORT
      const token = String((config && config.token) || saved.token || FALLBACK_TOKEN)
      if (config) storageSet('lanlyrics.config', { port, token })

      if (core) {
        if (core.port === port && core.token === token) return { ok: true }
        core.stop()
        core = null
      }
      core = new LanServerCore({ port, token, logger: console })
      core.onEvent = (event) => {
        if (event.kind === 'snapshot' || event.kind === 'state' || event.kind === 'artwork' || event.kind === 'link' || event.kind === 'server-error') {
          emit(event)
        }
      }
      try {
        await core.start()
      } catch (err) {
        const message = err && err.message ? err.message : String(err)
        console.error('[lyriccast] start failed:', message)
        core = null
        emit({ kind: 'server-error', message })
        return { ok: false, error: message }
      }
      emit({ kind: 'snapshot' })
      return { ok: true }
    },

    /** 停止服务(一般不需要调用;插件终止时随进程销毁)。 */
    stop() {
      if (core) {
        core.stop()
        core = null
        emit({ kind: 'snapshot' })
      }
    },

    /**
     * 读取当前状态快照:监听状态、设备列表、活跃设备、本机地址与配置。
     */
    getSnapshot() {
      const saved = storageGet('lanlyrics.config', {})
      return {
        ...(core ? core.getSnapshot() : { listening: false, port: Number(saved.port) || DEFAULT_PORT, devices: [], activeDeviceId: null }),
        addresses: localAddresses(),
        token: String(saved.token || FALLBACK_TOKEN)
      }
    },

    /** UI 手动切换活跃设备。 */
    setActiveDevice(deviceId) {
      if (core) core.setActiveDevice(deviceId)
    },

    /** 插值当前进度(见 lan-server-core.getPosition)。 */
    getPosition(deviceId) {
      return core ? core.getPosition(deviceId) : null
    },

    /** 活跃设备的封面(deviceId 传 null 用活跃设备)。 */
    getArtwork(trackId) {
      return core ? core.getArtwork(null, trackId) : null
    },

    /** 请求活跃设备重发封面。 */
    requestArtwork() {
      if (core) core.sendToActive({ type: 'request', v: 1, what: 'artwork' })
    },

    /** 请求活跃设备重发完整快照。 */
    requestState() {
      if (core) core.sendToActive({ type: 'request', v: 1, what: 'state' })
    },

    /**
     * 订阅服务事件(kind: snapshot | state | artwork | server-error)。
     * @param {(event: object) => void} cb
     * @returns {() => void} 取消订阅
     */
    subscribe(cb) {
      subscribers.push(cb)
      return () => {
        const index = subscribers.indexOf(cb)
        if (index >= 0) subscribers.splice(index, 1)
      }
    },

    /** 生成随机 Token(≥16 位,UI 保存配置时使用)。 */
    generateToken() {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      let token = ''
      for (let i = 0; i < 24; i++) token += alphabet[Math.floor(Math.random() * alphabet.length)]
      return token
    },

    /** 持久化保存配置(不重启;要生效请再调用 start)。 */
    saveConfig(config) {
      const saved = storageGet('lanlyrics.config', {})
      const next = {
        port: Number(config.port) || Number(saved.port) || DEFAULT_PORT,
        token: String(config.token || saved.token || FALLBACK_TOKEN)
      }
      storageSet('lanlyrics.config', next)
      return next
    }
  }
}
