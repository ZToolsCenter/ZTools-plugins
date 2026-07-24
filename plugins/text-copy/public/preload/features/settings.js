const { createListEntry, renderList, leaveLater } = require('../core/host')
const { isNotificationEnabled, toggleNotificationEnabled, toStatusText } = require('../core/settings')

function buildEntries() {
  return [
    createListEntry(
      `复制后需要系统通知（${toStatusText(isNotificationEnabled())})`,
      '点击该选项即可切换开关'
    ),
  ]
}

function createSettingsFeature() {
  return {
    mode: 'list',
    args: {
      enter(action, callbackSetList) {
        renderList(callbackSetList, buildEntries())
      },
      select(action, itemData, callbackSetList) {
        toggleNotificationEnabled()
        renderList(callbackSetList, buildEntries())
        leaveLater(800)
      },
    },
  }
}

module.exports = {
  createSettingsFeature,
}
