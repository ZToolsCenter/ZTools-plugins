/**
 * uTools → ZTools 兼容层（提醒弹窗页）。
 * 原版弹窗逻辑（remind.min.js）原样运行，本脚本补齐宿主差异：
 *
 * 1. window.utools 别名：指向 window.ztools（isDarkColors / dbStorage）。
 * 2. window.require shim：remind.min.js 顶部的
 *    require('../../components/remind/config.js') 返回等价纯数据配置。
 * 3. window.comSetTimeout / comClearTimeout：原 preload 注入的定时器别名。
 * 4. window.IpcRendererUtils.winClose()：原 preload 通过 ipcRenderer.sendTo
 *    通知主窗口销毁弹窗；ZTools 下改用 ztools.sendToParent，并以
 *    window.close() 兜底。
 * 5. 模拟原 preload 的 init 消息：页面就绪 500ms 后调用
 *    window.initData({ id })，id 来自 URL 查询参数（由 preload 拼接）。
 */
;(function () {
  'use strict'

  var zt = window.ztools
  if (!zt) {
    if (document.body) {
      document.body.innerHTML =
        '<div style="padding:40px;color:#333;font-family:sans-serif">缺少 ZTools 宿主环境。</div>'
    }
    return
  }

  // ── 1) utools 别名 ──
  window.utools = zt

  // ── 2) require shim（内容与 ../../config.js 的 config 字段一致）──
  var pluginRootUrl = new URL('../../', window.location.href).href
  function fileUrl(relative) {
    return new URL(relative, pluginRootUrl).href
  }

  var configModule = {
    config: {
      id: 'styleConfig',
      logo: fileUrl('assets/images/1.gif'),
      openLogo: true,
      backgroundColor: '#ffffff',
      color: '#000000',
      fontSize: '28',
      title: '下班！'
    }
  }

  window.require = function (request) {
    var normalized = String(request || '').replace(/\\/g, '/')
    if (/components\/remind\/config\.js$/.test(normalized)) {
      return configModule
    }
    throw new Error(
      'ZTools 兼容层：页面 require 仅支持 components/remind/config.js，收到 ' + request
    )
  }

  // ── 3) 定时器别名 ──
  window.comSetTimeout = function (handler, timeout) {
    return window.setTimeout(handler, timeout)
  }
  window.comClearTimeout = function (id) {
    window.clearTimeout(id)
  }

  // ── 4) 窗口关闭（对应原 IpcRendererUtils.winClose）──
  window.IpcRendererUtils = {
    winClose: function () {
      try {
        zt.sendToParent('remind:popup-close')
      } catch (error) {
        /* 主窗口可能已退出 */
      }
      try {
        window.close()
      } catch (error) {
        /* 忽略 */
      }
    }
  }

  // ── 5) init 消息（原 preload：ipcRenderer.on('init') → 500ms 后回调 initData）──
  function deliverInit() {
    window.setTimeout(function () {
      if (typeof window.initData === 'function') {
        var id = new URLSearchParams(window.location.search).get('id') || ''
        window.initData({ id: id })
      }
    }, 500)
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    deliverInit()
  } else {
    document.addEventListener('DOMContentLoaded', deliverInit)
  }
})()
