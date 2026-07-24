const { clipboard } = require('electron')

let OpenCC
try {
  OpenCC = require('opencc-js')
} catch (e) {
  console.error(
    '[繁简转换] 未安装依赖。请在插件根目录打开终端执行: npm install'
  )
  throw e
}
OpenCC = OpenCC && OpenCC.default ? OpenCC.default : OpenCC

function readClipboardTextTrimmed() {
  try {
    return (clipboard.readText() || '').trim()
  } catch (e) {
    return ''
  }
}

/** 从主搜索框选中「剪贴板」推送项时，暂存全文供进入 UI 后注入 */
let pendingClipText = null

function buildConverters(variant) {
  const fromTrad = variant === 'hk' ? 'hk' : 'tw'
  return {
    toSimplified: OpenCC.Converter({ from: fromTrad, to: 'cn' }),
    toTraditional: OpenCC.Converter({ from: 'cn', to: fromTrad })
  }
}

let converters = buildConverters('tw')

window.nodeAPI = {
  setVariant: function (v) {
    converters = buildConverters(v === 'hk' ? 'hk' : 'tw')
  },
  toSimplified: function (text) {
    return converters.toSimplified(text || '')
  },
  toTraditional: function (text) {
    return converters.toTraditional(text || '')
  }
}

if (window.ztools && typeof window.ztools.onMainPush === 'function') {
  window.ztools.onMainPush(
    function () {
      var text = readClipboardTextTrimmed()
      if (!text) return []
      var oneLine = text.replace(/\s+/g, ' ')
      var preview =
        oneLine.length > 40 ? oneLine.slice(0, 40) + '…' : oneLine
      return [
        {
          icon: 'logo.png',
          text: '繁简转换（剪贴板）',
          title: '繁简转换（剪贴板）',
          description: preview,
          _clipboardText: text
        }
      ]
    },
    function (selectData) {
      if (selectData && typeof selectData._clipboardText === 'string') {
        pendingClipText = selectData._clipboardText
      }
      return true
    }
  )
}

if (window.ztools && typeof window.ztools.onPluginEnter === 'function') {
  window.ztools.onPluginEnter(function (action) {
    var detail = action
    if (pendingClipText != null) {
      detail = Object.assign({}, action, {
        code: 'convert-clipboard',
        type: 'text',
        payload: pendingClipText
      })
      pendingClipText = null
    }
    window.dispatchEvent(new CustomEvent('plugin-enter', { detail: detail }))
  })
}
