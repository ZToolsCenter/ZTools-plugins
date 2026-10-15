/**
 * uTools → ZTools 兼容层（主页面）。
 * 原版页面与逻辑（index.html + index.min.js）原样运行，本脚本补齐宿主差异：
 *
 * 1. window.utools 别名：指向 window.ztools（dbStorage / onPluginEnter /
 *    isDarkColors / isDev / showNotification / showOpenDialog / isMacOS /
 *    hideMainWindow / getPrimaryDisplay 等 API 名称一致）。
 * 2. window.utoolMusics：内置提示音地址（原 preload/config.js 职责）。
 * 3. window.require shim：页面顶部的 require('./components/remind/config.js')
 *    在 ZTools 页面（无 Node 环境）下返回等价的纯数据配置。
 * 4. window.comSetInterval / comClearInterval / comSetTimeout / comClearTimeout：
 *    原 preload 通过 require('timers') 注入的定时器别名。
 * 5. window.openWindow(page, id)：移植原 preload 的 openWindow/setTheme——
 *    读取 openRemind_{id} 的弹窗位置配置，计算窗口几何后经 remindBridge
 *    创建独立弹窗，并保留原版 300ms 防抖。
 */
;(function () {
  'use strict'

  var zt = window.ztools
  if (!zt) {
    if (document.body) {
      document.body.innerHTML =
        '<div style="padding:40px;color:#333;font-family:sans-serif">缺少 ZTools 宿主环境，请在 ZTools 中运行本插件。</div>'
    }
    return
  }

  // ── 1) utools 别名 ──
  window.utools = zt

  // ── 2) 资源地址（file:// URL，主页面与弹窗均可直接引用）──
  var pluginRootUrl = new URL('.', window.location.href).href
  function fileUrl(relative) {
    return new URL(relative, pluginRootUrl).href
  }

  // ── 2.5) 旧版（Vue 重写版）数据迁移 ──
  // 早期移植版把提醒方式存在 mode 字段，原版读 remindCount；
  // 同一插件名共用 dbStorage，旧条目需一次性转换，否则列表显示 undefined 且不触发。
  function migrateLegacyData() {
    try {
      var list = zt.dbStorage.getItem('remindList')
      if (Array.isArray(list) && list.length) {
        var changed = false
        var migrated = list.map(function (item) {
          if (!item || typeof item !== 'object') return item
          if (item.remindCount === undefined && item.mode !== undefined) {
            var next = {}
            for (var key in item) {
              if (Object.prototype.hasOwnProperty.call(item, key)) next[key] = item[key]
            }
            next.remindCount = item.mode
            delete next.mode
            // 旧版音乐存相对路径（相对主页面），弹窗页目录深度不同，转为绝对 file:// URL
            if (next.music && !/^(https?:|file:|data:)/i.test(String(next.music))) {
              next.music = fileUrl(String(next.music).replace(/^\.\//, ''))
            }
            changed = true
            return next
          }
          return item
        })
        if (changed) zt.dbStorage.setItem('remindList', migrated)
      }

      var style = zt.dbStorage.getItem('styleConfig')
      if (style && typeof style === 'object' && style.logo && !/^(https?:|file:|data:)/i.test(String(style.logo))) {
        style.logo = fileUrl(String(style.logo).replace(/^\.\//, ''))
        zt.dbStorage.setItem('styleConfig', style)
      }
    } catch (error) {
      /* 数据迁移失败不阻断插件启动 */
    }
  }
  migrateLegacyData()

  window.utoolMusics = {
    music1: fileUrl('assets/music/1.mp3'),
    music2: fileUrl('assets/music/2.mp3'),
    music3: fileUrl('assets/music/3.mp3')
  }

  // ── 3) require shim（内容与 components/remind/config.js 一致，logo 换为 file:// URL）──
  var remindWindowConfig = {
    id: 'remind',
    src: 'index.html',
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
      return remindWindowConfig
    }
    throw new Error(
      'ZTools 兼容层：页面 require 仅支持 components/remind/config.js，收到 ' + request
    )
  }

  // ── 4) 定时器别名 ──
  window.comSetInterval = function (handler, timeout) {
    return window.setInterval(handler, timeout)
  }
  window.comClearInterval = function (id) {
    window.clearInterval(id)
  }
  window.comSetTimeout = function (handler, timeout) {
    return window.setTimeout(handler, timeout)
  }
  window.comClearTimeout = function (id) {
    window.clearTimeout(id)
  }

  // ── 5) openWindow（移植原 preload 的 setTheme 几何计算）──
  var lastOpenAt = 0

  function computeGeometry(currentDate) {
    var size = { width: 1280, height: 720 }
    try {
      var display = zt.getPrimaryDisplay && zt.getPrimaryDisplay()
      var area = display && (display.workAreaSize || display.workArea)
      if (area && area.width > 0 && area.height > 0) {
        size = area
      }
    } catch (error) {
      /* 无法获取屏幕信息时使用默认尺寸 */
    }

    // 全屏烟花
    if (currentDate && currentDate.fireworkFull) {
      return { width: size.width, height: size.height, x: 0, y: 0 }
    }

    var boxWidth = 500
    var boxHeight = 250
    var offset = 50
    var type = currentDate && currentDate.openType
    var positions = {
      rightBottom: [size.width - boxWidth - offset, size.height - boxHeight - offset],
      rightCenter: [size.width - boxWidth - offset, size.height / 2 - boxHeight / 2],
      rightTop: [size.width - boxWidth - offset, offset],
      leftBottom: [offset, size.height - boxHeight - offset],
      leftCenter: [offset, size.height / 2 - boxHeight / 2],
      leftTop: [offset, offset]
    }
    var position = positions[type]
    if (position) {
      return {
        width: boxWidth,
        height: boxHeight,
        x: Math.round(position[0]),
        y: Math.round(position[1])
      }
    }
    // 中间：不传尺寸与坐标，沿用 Electron 默认窗口大小并自动居中（与原版一致）
    return {}
  }

  window.openWindow = function (page, id) {
    var bridge = window.remindBridge
    if (!bridge || typeof bridge.openRemindWindow !== 'function') {
      if (zt.showNotification) zt.showNotification('宿主弹窗能力不可用')
      return
    }

    var currentDate = {}
    try {
      currentDate = zt.dbStorage.getItem('openRemind_' + id) || {}
    } catch (error) {
      currentDate = {}
    }
    var geometry = computeGeometry(currentDate)

    var run = function () {
      var result = bridge.openRemindWindow({
        id: String(id),
        width: geometry.width,
        height: geometry.height,
        x: geometry.x,
        y: geometry.y
      })
      if (result && result.ok === false && zt.showNotification) {
        zt.showNotification(result.error || '提醒弹窗打开失败')
      }
    }

    // 原版 300ms 防抖：连续触发时隔 300ms 串行打开
    var now = Date.now()
    if (now - lastOpenAt < 300) {
      window.setTimeout(function () {
        lastOpenAt = Date.now()
        run()
      }, 300)
    } else {
      lastOpenAt = Date.now()
      run()
    }
  }
})()
