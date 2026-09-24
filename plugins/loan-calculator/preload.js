/**
 * ZTools 贷款计算器插件 preload
 * 规范：不压缩、不混淆，保持清晰可读
 *
 * 存储说明：
 * ZTools 的 ztools.db 为「文档型」存储（put(doc) 会自动写 doc._id），
 * 且写入走 IPC 到主进程，签名用错会直接在主进程抛 Uncaught Exception（try/catch 拦截不到）。
 * 为避免该不稳定路径，历史记录统一用插件页面自带的 localStorage 持久化，
 * 渲染进程与 preload 均可访问，且不会触发主进程崩溃。
 */

(function () {
  const storageKey = 'loan-calculator-history'

  function read () {
    try {
      const raw = window.localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) : []
    } catch (e) {
      return []
    }
  }

  function write (data) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(data))
    } catch (e) {
      // 存储不可用，静默忽略
    }
  }

  const api = {
    read,
    write,
    // 添加一条记录，最多保留 10 条
    add: (item) => {
      const list = read()
      list.unshift(item)
      if (list.length > 10) list.length = 10
      write(list)
    },
    // 读取全部历史（供「历史记录」界面使用）
    list: () => read(),
    // 删除指定时间戳的记录
    remove: (ts) => {
      const list = read().filter((it) => it.ts !== ts)
      write(list)
      return list
    },
    // 清空历史
    clear: () => write([])
  }

  // 暴露给渲染进程：优先 contextBridge（隔离开启时），否则直接挂 window
  try {
    if (
      typeof window !== 'undefined' &&
      window.contextBridge &&
      typeof window.contextBridge.exposeInMainWorld === 'function'
    ) {
      window.contextBridge.exposeInMainWorld('loanApi', api)
      return
    }
  } catch (e) {
    // 忽略，走下方兜底
  }
  try {
    window.loanApi = api
  } catch (e) {
    // 极端情况下 window 不可写，放弃暴露
  }
})()
