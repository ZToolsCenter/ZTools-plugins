import * as actions from '@renderer/store/download/action'
import { downloadList } from '@renderer/store/download/state'

// The original store/actions are the sole owner of UI and persisted task state.
const selected = ids => {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new TypeError('Invalid download task IDs')
  return downloadList.filter(task => ids.includes(task.id))
}
window.lxDownload = {
  create: actions.createDownloadTasks,
  getState: async () => JSON.parse(JSON.stringify(await actions.getDownloadList())),
  start: ids => actions.startDownloadTasks(selected(ids)),
  pause: ids => actions.pauseDownloadTasks(selected(ids)),
  remove: ids => actions.removeDownloadTasks(selected(ids).map(task => task.id)),
}
