const context = require('./context.cjs')
const { CMMON_EVENT_NAME } = require('../upstream/common/ipcNames.cjs')
module.exports = {
  updateSetting(patch = {}) {
    const before = context.lx.settings.get()
    const setting = context.lx.settings.update(patch)
    const updatedSettingKeys = Object.keys(patch).filter(key => !Object.is(before[key], setting[key]))
    const updatedSetting = Object.fromEntries(updatedSettingKeys.map(key => [key, setting[key]]))
    context.bridge.setSnapshot(CMMON_EVENT_NAME.get_app_setting, setting)
    return { setting, updatedSettingKeys, updatedSetting }
  },
  saveAppHotKeyConfig(config) {
    context.lx.appHotKeyConfig = structuredClone(config)
    context.lx.database.prepare("INSERT INTO plugin_kv VALUES ('hotkey','config',?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(JSON.stringify(config))
  },
}
