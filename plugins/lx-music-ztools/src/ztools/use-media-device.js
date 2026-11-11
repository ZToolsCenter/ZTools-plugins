import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { pause } from '@renderer/core/player/action'
import { setMediaDeviceId } from '@renderer/plugins/player'
import { isPlay } from '@renderer/store/player/state'
import { appSetting, saveMediaDeviceId } from '@renderer/store/setting'
import { getAudioCapabilities } from './audio-capabilities.cjs'

export default () => {
  const mediaDevices = navigator.mediaDevices
  const capability = getAudioCapabilities(mediaDevices, window.Audio, window.AudioContext)
  if (!capability.select) {
    const restoreDefault = () => { if (appSetting['player.mediaDeviceId'] !== 'default') saveMediaDeviceId('default') }
    restoreDefault()
    const unwatch = watch(() => appSetting['player.mediaDeviceId'], restoreDefault)
    onBeforeUnmount(unwatch)
    return
  }
  let disposed = false, revision = 0, queue = Promise.resolve(), applied = null, desired = appSetting['player.mediaDeviceId']
  const report = error => console.error('音频输出设备切换失败：', error)
  const describe = error => [error?.name, error?.message || String(error)].filter(Boolean).join('：')
  const notify = message => {
    if (disposed) return
    window.lxAudioOutputMessage = message
    window.dispatchEvent(new window.CustomEvent('lx:audio-output-error', { detail: message }))
  }
  const save = id => { if (!disposed) { desired = id; saveMediaDeviceId(id) } }
  const identity = device => [device.deviceId, device.groupId || '', device.label || ''].join('\u0000')
  const refresh = (deviceChange = false) => {
    desired = appSetting['player.mediaDeviceId']
    const ownRevision = ++revision
    const active = () => !disposed && ownRevision === revision
    queue = queue.then(async () => {
      if (!active()) return
      let devices
      try { devices = (await mediaDevices.enumerateDevices()).filter(device => device.kind === 'audiooutput') }
      catch (error) {
        if (active()) {
          report(error); save(applied?.deviceId || 'default')
          notify('无法读取音频输出设备，已保留上一次成功的设备设置。请检查设备后重试。' + describe(error))
        }
        return
      }
      if (!active()) return
      const requested = appSetting['player.mediaDeviceId'] || 'default'
      const device = devices.find(device => device.deviceId === requested) || devices.find(device => device.deviceId === 'default') || { deviceId: 'default', label: '', groupId: '' }
      const changed = applied && identity(applied) !== identity(device)
      if (deviceChange && changed) {
        window.app_event.playerDeviceChanged()
        if (appSetting['player.isMediaDeviceRemovedStopPlay'] && isPlay.value) {
          window.lx.isPlayedStop = true
          pause()
        }
      }
      if (applied && applied.deviceId === device.deviceId && requested === device.deviceId) {
        applied = device
        notify('')
        return
      }
      try {
        await setMediaDeviceId(device.deviceId)
        applied = device
        if (!active()) return
        save(device.deviceId)
        notify('')
      } catch (error) {
        if (!active()) return
        report(error)
        try {
          await setMediaDeviceId('default')
          applied = devices.find(device => device.deviceId === 'default') || { deviceId: 'default', label: '', groupId: '' }
          if (!active()) return
          save('default')
          notify('音频输出设备切换失败，已恢复系统默认输出。请检查设备后重新选择。' + describe(error))
        } catch (fallbackError) {
          if (active()) {
            report(fallbackError); save(applied?.deviceId || 'default')
            notify('音频输出设备切换失败，系统默认输出也切换失败；已保留上一次成功的设备设置。请检查设备后重试。' + describe(fallbackError))
          }
        }
      }
    }).catch(error => { if (!disposed) report(error) })
    return queue
  }
  const unwatch = watch(() => appSetting['player.mediaDeviceId'], id => {
    if (desired !== id) void refresh()
  })
  const changed = () => refresh(true)
  if (capability.watch) mediaDevices.addEventListener('devicechange', changed)
  void refresh()
  onBeforeUnmount(() => {
    disposed = true; revision++; unwatch()
    if (capability.watch) mediaDevices.removeEventListener('devicechange', changed)
  })
}
