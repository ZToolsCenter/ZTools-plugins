// IdeaDock 宿主适配层：业务代码只依赖此接口，不直接区分 uTools / ZTools。
(function () {
  'use strict'

  function api() {
    return window.utools || window.ztools || null
  }

  function call(name, ...args) {
    const host = api()
    if (!host || typeof host[name] !== 'function') return undefined
    return host[name](...args)
  }

  window.ideadockHost = {
    api,
    get name() {
      if (window.utools) return 'utools'
      if (window.ztools) return 'ztools'
      return 'browser'
    },
    get storage() {
      return api()?.dbStorage || null
    },
    get db() {
      return api()?.db || null
    },
    supports(name) {
      return typeof api()?.[name] === 'function'
    },
    onPluginEnter(handler) {
      return call('onPluginEnter', handler)
    },
    onPluginOut(handler) {
      return call('onPluginOut', handler)
    },
    outPlugin() {
      return call('outPlugin')
    },
    copyText(text) {
      return call('copyText', String(text))
    },
    copyFile(paths) {
      return call('copyFile', paths)
    },
    pasteTextAndExit(text) {
      const host = api()
      if (!host) return false
      if (typeof host.hideMainWindowPasteText === 'function') {
        host.hideMainWindowPasteText(String(text))
        if (typeof host.outPlugin === 'function') host.outPlugin()
        return true
      }
      if (typeof host.copyText === 'function') host.copyText(String(text))
      if (typeof host.outPlugin === 'function') host.outPlugin()
      return true
    },
    showOpenDialog(options) {
      return call('showOpenDialog', options)
    },
    createBrowserWindow(url, options, callback) {
      return call('createBrowserWindow', url, options, callback)
    },
    registerTool(name, handler) {
      return call('registerTool', name, handler)
    }
  }
})()
