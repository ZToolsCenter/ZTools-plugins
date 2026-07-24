;(function () {
  var originalEl = document.getElementById('inputOriginal')
  var resultEl = document.getElementById('inputResult')
  var variantEl = document.getElementById('variant')

  if (window.ztools && window.ztools.isDarkColors && window.ztools.isDarkColors()) {
    document.body.classList.add('dark')
  }

  function resizeHeight() {
    setTimeout(function () {
      var h = document.body.scrollHeight
      if (window.ztools && window.ztools.setExpendHeight) {
        window.ztools.setExpendHeight(h + 48)
      }
    }, 80)
  }

  function applyVariant() {
    if (window.nodeAPI && window.nodeAPI.setVariant) {
      window.nodeAPI.setVariant(variantEl.value)
    }
  }

  variantEl.addEventListener('change', function () {
    applyVariant()
    resizeHeight()
  })
  applyVariant()

  function onTextChange() {
    resizeHeight()
  }
  originalEl.addEventListener('input', onTextChange)
  resultEl.addEventListener('input', onTextChange)

  document.getElementById('btnToSimp').addEventListener('click', function () {
    if (!window.nodeAPI) return
    applyVariant()
    resultEl.value = window.nodeAPI.toSimplified(originalEl.value)
    resizeHeight()
  })

  document.getElementById('btnToTrad').addEventListener('click', function () {
    if (!window.nodeAPI) return
    applyVariant()
    resultEl.value = window.nodeAPI.toTraditional(originalEl.value)
    resizeHeight()
  })

  document.getElementById('btnCopy').addEventListener('click', function () {
    var t = resultEl.value
    if (!t) {
      if (window.ztools && window.ztools.showNotification) {
        window.ztools.showNotification('没有可复制的内容')
      }
      return
    }
    if (window.ztools && window.ztools.copyText) {
      window.ztools.copyText(t)
      window.ztools.showNotification('已复制转换结果')
    }
  })

  window.addEventListener('plugin-enter', function (e) {
    var action = e.detail || {}
    var payload = action.payload
    if (action.code === 'convert-clipboard' && typeof payload === 'string') {
      applyVariant()
      originalEl.value = payload
      resultEl.value = ''
    }
    resizeHeight()
  })

  resizeHeight()
})()
