// Keep desktop-only backup values compatible without reactivating removed controls.
module.exports = function adaptHostLifecycle(source) {
  source = source.replaceAll('\r\n', '\n')
  const file = this.resourcePath.replaceAll('\\', '/')
  if (file.endsWith('/useApp/index.ts')) {
    const fullscreen = "isFullscreen.value = appSetting['common.startInFullscreen']"
    if (!source.includes(fullscreen)) throw new Error('LX initial fullscreen contract changed')
    return source.replace(fullscreen, 'isFullscreen.value = false // Outer fullscreen belongs to ZTools.')
  }
  const watcher = /  watch\(\(\) => appSetting\['common.windowSizeId'\], \(index\) => \{[\s\S]*?\n  \}\)\n/
  if (!watcher.test(source)) throw new Error('LX desktop dimension watcher contract changed')
  return source.replace(watcher, '  // Old windowSizeId values remain backup data, not a host resize command.\n')
}
