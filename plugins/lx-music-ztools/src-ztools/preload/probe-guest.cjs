const { contextBridge } = require('electron')
const { createHash } = require('node:crypto')

// This isolated world contains trusted code only; no Node handle crosses the bridge.
contextBridge.exposeInMainWorld('lxProbe', {
  md5(value) { return createHash('md5').update(String(value)).digest('hex') },
})
window.addEventListener('beforeunload', event => { event.returnValue = false })
