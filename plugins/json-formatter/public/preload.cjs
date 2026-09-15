const { clipboard, dialog } = require('electron')

window.jsonFormatterBridge = Object.freeze({
  readClipboardText: () => clipboard.readText(),
  saveJson: async (text) => {
    const result = await dialog.showSaveDialog({
      title: '保存 JSON',
      defaultPath: 'formatted.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return false
    require('node:fs').writeFileSync(result.filePath, text, 'utf8')
    return true
  }
})
