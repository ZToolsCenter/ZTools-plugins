// Keep LX dialogs and confirmation text; replace only the persistence boundary.
module.exports = function adaptBackup(source) {
  source = source.replace(/\r\n/g, '\n')
  function replace(name, next, body) {
    const start = source.indexOf(`    const ${name} = `)
    const end = source.indexOf(`    const ${next} = `, start)
    if (start < 0 || end < 0) throw new Error('LX backup contract changed: ' + name)
    source = source.slice(0, start) + `    const ${name} = async(path) => {
      try { await window.lxHost.invoke('backup:${body.action}', { kind: '${body.kind}', path }) }
      catch (error) { console.error(error); await dialog({ message: String(error.message || error), confirmButtonText: t('confirm_button_text') }) }
    }
` + source.slice(end)
  }
  for (const [name, next, kind, action] of [
    ['importAllData', 'handleImportAllData', 'all', 'import'], ['exportAllData', 'handleExportAllData', 'all', 'export'],
    ['importSetting', 'handleImportSetting', 'settings', 'import'], ['exportSetting', 'handleExportSetting', 'settings', 'export'],
    ['importPlayList', 'handleImportPlayList', 'lists', 'import'], ['exportPlayList', 'handleExportPlayList', 'lists', 'export'],
  ]) replace(name, next, { kind, action })
  // Pass the chosen capability unchanged; the file service owns suffix creation.
  for (const format of ['txt', 'csv']) {
    const append = `          if (!path.endsWith('.${format}')) path += '.${format}'\n`
    if (!source.includes(append)) throw new Error('LX list export filename shape changed: ' + format)
    source = source.replace(append, '')
  }
  return source
}
