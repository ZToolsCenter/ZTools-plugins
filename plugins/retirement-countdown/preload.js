window.ztools.onPluginEnter(() => {
  if (typeof window.ztools.setExpendHeight === 'function') {
    window.ztools.setExpendHeight(560)
  }
})

window.retireApi = {
  loadConfig() {
    try {
      return window.ztools.dbStorage.getItem('retire-config') || null
    } catch (e) {
      return null
    }
  },
  saveConfig(config) {
    window.ztools.dbStorage.setItem('retire-config', config)
  },
  isDark() {
    try {
      return !!window.ztools.isDarkColors()
    } catch (e) {
      return false
    }
  }
}
