const _mockWindow = {
  id: 1,
  focused: true,
  top: 0,
  left: 0,
  width: 800,
  height: 600,
  type: 'normal',
  state: 'normal'
}

window.browser.windows.create.callsFake(({ url }) => {
  window.openIframe && window.openIframe(url)
  return Promise.resolve({ ..._mockWindow, id: Date.now() })
})
window.browser.windows.update.callsFake(() => Promise.resolve({ ..._mockWindow }))
window.browser.windows.get.callsFake((windowId) => Promise.resolve({ ..._mockWindow, id: windowId || 1 }))
window.browser.windows.getAll.callsFake(() => Promise.resolve([{ ..._mockWindow }]))
window.browser.windows.getCurrent.callsFake(() => Promise.resolve({ ..._mockWindow }))
window.browser.windows.getLastFocused.callsFake(() => Promise.resolve({ ..._mockWindow }))
window.browser.windows.remove.callsFake(() => Promise.resolve())
