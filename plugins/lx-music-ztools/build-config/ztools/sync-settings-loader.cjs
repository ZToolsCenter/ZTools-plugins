// Keep vendor immutable and apply a backup's sync settings as one lifecycle change.
module.exports = function adaptSyncSettings(source) {
  source = source.replaceAll('\r\n', '\n')
  const start = source.indexOf("  watch(() => appSetting['sync.mode']")
  const end = source.indexOf("  watch(() => appSetting['network.proxy.enable']", start)
  if (start < 0 || end < 0) throw new Error('LX sync setting watcher shape changed')
  return source.slice(0, start) + `  let syncSettingsEpoch = 0
  watch(() => [
    appSetting['sync.mode'], appSetting['sync.enable'],
    appSetting['sync.server.port'], appSetting['sync.client.host'],
  ] as const, async([mode, enable, port, host], [previousMode, previousEnable, previousPort, previousHost]) => {
    sync.mode = mode
    sync.enable = enable
    sync.server.port = port
    sync.client.host = host
    const changed = mode !== previousMode || enable !== previousEnable ||
      (mode === 'server' ? port !== previousPort : host !== previousHost)
    if (!changed) return
    const epoch = ++syncSettingsEpoch
    const action = mode === 'server' ? 'enable_server' : 'enable_client'
    try {
      // Always retire the prior role first, including a new empty/invalid target.
      await sendSyncAction({ action, data: { enable: false, port, host } })
      if (epoch !== syncSettingsEpoch || !enable || !(mode === 'server' ? port : host)) return
      await sendSyncAction({ action, data: { enable: true, port, host } })
    } catch (error) { console.log(error) }
  })

` + source.slice(end)
}
