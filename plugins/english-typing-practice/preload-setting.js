const { ipcRenderer } = require('electron')

ipcRenderer.on('win-info', (event, data) => {
  // console.log('win-info:', data)
})

function getMainWinInfo() {}

window.getMainWinInfo = getMainWinInfo

// ----------
// console.log('load preload setting')
