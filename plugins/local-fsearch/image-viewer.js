window.mountImageViewer = function (body, image, sizeLabel) {
  const toolbar = document.createElement('div'); toolbar.className = 'image-zoom-toolbar'
  toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', '图片缩放')
  const stage = document.createElement('div'); stage.className = 'image-stage'; stage.tabIndex = 0
  stage.setAttribute('role', 'region'); stage.setAttribute('aria-label', '图片预览画布')
  stage.title = '滚轮以指针为中心缩放 · 任意比例均可拖动'
  const frame = document.createElement('div'); frame.className = 'image-frame'; frame.append(stage)
  image.draggable = false; stage.append(image)
  const percent = document.createElement('output'); percent.setAttribute('aria-live', 'polite')
  let scale = 1, fitted = true, drag = null, left = 0, top = 0
  const viewWidth = () => stage.offsetWidth - 2 * stage.clientLeft
  const viewHeight = () => stage.offsetHeight - 2 * stage.clientTop
  const fit = () => Math.min(1, viewWidth() / image.naturalWidth, viewHeight() / image.naturalHeight)
  const minScale = () => Math.min(0.1, fit())
  function button(text, label, action) {
    const control = document.createElement('button'); control.type = 'button'; control.textContent = text
    control.setAttribute('aria-label', label); control.onclick = action; return control
  }
  const out = button('−', '缩小', () => zoom(scale / 1.25))
  const plus = button('+', '放大', () => zoom(scale * 1.25))
  const fitButton = button('适应窗口', '适应窗口', () => zoom(fit(), true))
  const actual = button('原始大小', '原始大小', () => zoom(1))
  function position(x, y) {
    left = x; top = y
    image.style.transform = `translate(${x}px, ${y}px)`
  }
  function zoom(next, isFit = false, event) {
    if (!stage.clientWidth || !stage.clientHeight) return
    const view = stage.getBoundingClientRect(), before = image.getBoundingClientRect()
    const x = event?.clientX ?? view.left + stage.clientWidth / 2
    const y = event?.clientY ?? view.top + stage.clientHeight / 2
    // 滚轮的锚点可以在图像外。夹紧到边缘会让留白上的指针把图片吸过来。
    const ratio = (value, start, span) => {
      if (!span) return 0.5
      const fraction = (value - start) / span
      return event ? fraction : Math.max(0, Math.min(1, fraction))
    }
    const u = ratio(x, before.left, before.width), v = ratio(y, before.top, before.height)
    fitted = isFit; scale = Math.max(minScale(), Math.min(8, next))
    const width = Math.max(1, Math.floor(image.naturalWidth * scale))
    const height = Math.max(1, Math.floor(image.naturalHeight * scale))
    image.style.width = width + 'px'; image.style.height = height + 'px'
    position(isFit ? (viewWidth() - width) / 2 : x - view.left - stage.clientLeft - u * width,
      isFit ? (viewHeight() - height) / 2 : y - view.top - stage.clientTop - v * height)
    percent.textContent = `${Number((scale * 100).toFixed(scale < 0.1 ? 1 : 0))}%`
    out.disabled = scale <= minScale(); plus.disabled = scale >= 8
    fitButton.setAttribute('aria-pressed', String(fitted)); actual.setAttribute('aria-pressed', String(!fitted && scale === 1))
  }
  toolbar.append(out, percent, plus, fitButton, actual)
  const info = document.createElement('p'); info.textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${sizeLabel}`
  body.replaceChildren(toolbar, frame, info)
  zoom(fit(), true)
  const resize = new ResizeObserver(() => { if (fitted && stage.isConnected) zoom(fit(), true) })
  resize.observe(stage)
  stage.addEventListener('wheel', event => {
    if (!event.deltaY) return
    event.preventDefault()
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1)
    zoom(scale * Math.pow(1.25, -Math.max(-240, Math.min(240, delta)) / 100), false, event)
  }, { passive: false })
  stage.addEventListener('keydown', event => {
    const action = { '+': () => zoom(scale * 1.25), '=': () => zoom(scale * 1.25), '-': () => zoom(scale / 1.25), '0': () => zoom(fit(), true), '1': () => zoom(1) }[event.key]
    if (action) { event.preventDefault(); action() }
  })
  stage.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0) return
    event.preventDefault(); stage.focus({ preventScroll: true }); stage.setPointerCapture(event.pointerId)
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top }
    stage.classList.add('dragging')
  })
  stage.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId || (event.clientX === drag.x && event.clientY === drag.y && fitted)) return
    fitted = false; fitButton.setAttribute('aria-pressed', 'false')
    position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
  })
  stage.addEventListener('lostpointercapture', () => { drag = null; stage.classList.remove('dragging') })
  return () => resize.disconnect()
}
