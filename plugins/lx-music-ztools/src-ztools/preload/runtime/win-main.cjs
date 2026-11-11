const context = require('./context.cjs')
const { WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../upstream/common/ipcNames.cjs')
const selections = []
let cancelling = false
let settling = 0
const sync = data => context.bridge.emit(names.sync_action, data)
const showSelection = () => { const selected = selections[0]; if (selected) sync({ action: 'select_mode', data: { deviceName: selected.deviceName, type: selected.type } }) }

// Original main services notify the existing renderer; they never create another player/window.
module.exports = {
  sendTaskbarButtonClick(action, data) { context.bridge.emit(names.player_action_on_button_click, { action, data }) },
  sendClientStatus(data) { sync({ action: 'client_status', data }) },
  sendServerStatus(data) { sync({ action: 'server_status', data }) },
  sendSelectMode(deviceName, type, listener) {
    if (cancelling) { listener(null); return }
    selections.push({ deviceName, type, listener })
    if (selections.length === 1 && !settling) showSelection()
  },
  chooseSyncMode(mode, type) {
    const selected = selections[0]
    if (!selected) return
    if (type && selected.type !== type) throw new Error('同步选择类型已变化，请重新选择')
    selections.shift(); settling++
    try { selected.listener(mode) }
    finally { if (!--settling) showSelection() }
  },
  removeSelectModeListener() {
    // Original getSyncMode cleans its own selected listener synchronously.
    // It must not cancel the next dialog waiting in this host-owned queue.
    if (settling) return
    cancelling = true
    try { for (const selected of selections.splice(0)) selected.listener(null) }
    finally { cancelling = false; sync({ action: 'close_select_mode' }) }
  },
  sendCloseSelectMode() { sync({ action: 'close_select_mode' }) },
}
