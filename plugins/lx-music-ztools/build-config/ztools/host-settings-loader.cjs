// Explain host-owned desktop features while retaining every music/data control.
module.exports = function adaptHostSettings(source) {
  source = source.replaceAll('\r\n', '\n')
  const file = this.resourcePath.replaceAll('\\', '/')
  const disable = id => {
    const pattern = `base-checkbox(id="${id}" `
    if (!source.includes(pattern)) throw new Error('LX host setting shape changed: ' + id)
    source = source.replace(pattern, `base-checkbox(id="${id}" disabled title="此功能由 ZTools 管理或尚无公开接口" `)
  }
  const note = (id, text) => { const end = source.indexOf('\n', source.indexOf(`dt#${id} `)); source = source.slice(0, end) + `\ndd\n  p.small ${text}` + source.slice(end) }
  if (file.endsWith('/SettingBasic.vue')) {
    disable('setting_start_in_fullscreen'); disable('setting_to_tray')
    source = source.replace('name="setting_window_size" need', 'name="setting_window_size" need').replace(':disabled="isFullscreen" :value="item.id"', ':disabled="true" :value="item.id"')
    source = source.replace('name="setting_basic_control_btn_position" need', 'name="setting_basic_control_btn_position" need disabled')
    note('basic', '插件窗口大小、全屏、托盘与关闭按钮由 ZTools 管理。隐藏插件会继续播放；终止插件才会停止服务。')
  } else if (file.endsWith('/SettingPlay.vue')) {
    disable('setting_player_power_save_blocker'); disable('setting_player_showTaskProgess'); disable('setting_player_showStatusBarLyric')
    const capability = require('node:path').join(__dirname, '../../src/ztools/audio-capabilities.cjs').replaceAll('\\', '/')
    source = source.replace('<script>', `<script>\nimport { getAudioCapabilities } from ${JSON.stringify(capability)}`)
      .replace('    const mediaDevices = ref([])', `    const audioCapability = getAudioCapabilities(navigator.mediaDevices, window.Audio, window.AudioContext)
    const mediaDeviceError = ref(window.lxAudioOutputMessage || '')
    const onAudioOutputError = event => { mediaDeviceError.value = event.detail || '' }
    window.addEventListener('lx:audio-output-error', onAudioOutputError)
    onBeforeUnmount(() => window.removeEventListener('lx:audio-output-error', onAudioOutputError))
    const mediaDevices = ref([])`)
      .replace('const devices = await navigator.mediaDevices.enumerateDevices()', 'if (!audioCapability.select) return\n      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])')
      .replace("    navigator.mediaDevices.addEventListener('devicechange', getMediaDevice)", "    if (audioCapability.watch) navigator.mediaDevices.addEventListener('devicechange', getMediaDevice)")
      .replace("      navigator.mediaDevices.removeEventListener('devicechange', getMediaDevice)", "      if (audioCapability.watch) navigator.mediaDevices.removeEventListener('devicechange', getMediaDevice)")
      .replace('base-selection.gap-left(v-model="mediaDeviceId"', 'base-selection.gap-left(:disabled="!audioCapability.select || !mediaDevices.length" v-model="mediaDeviceId"')
      .replace('item-key="deviceId" item-name="label" @change="handleMediaDeviceIdChnage")', 'item-key="deviceId" item-name="label" @change="handleMediaDeviceIdChnage")\n    p.small(v-if="mediaDeviceError" role="alert") {{ mediaDeviceError }}')
      .replace('base-checkbox(id="setting_player_isMediaDeviceRemovedStopPlay" ', 'base-checkbox(id="setting_player_isMediaDeviceRemovedStopPlay" :disabled="!audioCapability.watch" ')
      .replace('      mediaDevices,', '      mediaDevices,\n      audioCapability,\n      mediaDeviceError,')
      .replace(/    const handleMediaDeviceIdChnage = async\(\) => \{[\s\S]*?\n    watch\(\(\) => appSetting\['player.mediaDeviceId'\]/, `    const handleMediaDeviceIdChnage = async() => {
      if (!audioCapability.select) { mediaDeviceId.value = appSetting['player.mediaDeviceId']; return }
      appSetting['player.mediaDeviceId'] = mediaDeviceId.value
    }
    watch(() => appSetting['player.mediaDeviceId']`)
      .replace("if (appSetting['player.mediaDeviceId'] != 'default') {", "if (enabled && appSetting['player.mediaDeviceId'] != 'default' && !audioCapability.select) {")
      .replace("        await setMediaDeviceId('default').catch(_ => _)\n        saveMediaDeviceId('default')", `        try { await setMediaDeviceId('default') } catch (error) {
          isMaxOutputChannelCount.value = appSetting['player.isMaxOutputChannelCount']
          await dialog({ message: '无法切换到系统默认输出，请检查音频设备后重试。', confirmButtonText: t('ok') })
          return
        }
        saveMediaDeviceId('default')`)
      .replace("    const handleUpdateMaxOutputChannelCount = async(enabled) => {", "    watch(() => appSetting['player.isMaxOutputChannelCount'], value => { isMaxOutputChannelCount.value = value })\n    const handleUpdateMaxOutputChannelCount = async(enabled) => {")
    note('play', '阻止系统睡眠、Windows 任务栏进度/缩略图按钮和系统状态栏歌词尚无可用的 ZTools 公开接口。音频设备枚举或输出切换能力不可用时使用系统默认输出；设备变化事件不可用时禁用设备移除后暂停。')
  } else if (file.endsWith('/SettingDesktopLyric.vue')) {
    disable('setting_desktop_lyric_fullscreen_hide')
    const capability = require('node:path').join(__dirname, '../../src/ztools/audio-capabilities.cjs').replaceAll('\\', '/')
    source = source.replace('<script>', `<script>\nimport { getAudioCapabilities } from ${JSON.stringify(capability)}\nimport { dialog } from '@renderer/plugins/Dialog'\nimport { setMediaDeviceId } from '@renderer/plugins/player'`)
      .replace("updateSetting({ 'desktopLyric.audioVisualization': $event })", 'handleAudioVisualization($event)')
      .replace('    const changeLineGap = (step) => {', `    const handleAudioVisualization = async(enabled) => {
      if (enabled && appSetting['player.mediaDeviceId'] !== 'default' && !getAudioCapabilities(navigator.mediaDevices, window.Audio, window.AudioContext).select) {
        const confirm = await dialog.confirm({ message: t('setting__player_audio_visualization_tip'), cancelButtonText: t('cancel_button_text'), confirmButtonText: t('confirm_button_text') })
        if (!confirm) return
        try { await setMediaDeviceId('default') } catch (error) {
          await dialog({ message: '无法切换到系统默认输出，请检查音频设备后重试。', confirmButtonText: t('ok') })
          return
        }
        updateSetting({ 'player.mediaDeviceId': 'default', 'desktopLyric.audioVisualization': true })
      } else updateSetting({ 'desktopLyric.audioVisualization': enabled })
    }
    const changeLineGap = (step) => {`)
      .replace('      changeLineGap,', '      changeLineGap,\n      handleAudioVisualization,')
    note('desktop_lyric', '桌面歌词沿用原 LX 页面。自动检测其他应用全屏并隐藏尚无 ZTools 公开接口，可使用 LX 桌面歌词指令手动开关。')
  } else if (file.endsWith('/SettingOther.vue')) {
    disable('setting_transparent_window')
    source = source.replace('name="setting_tray_theme"', 'name="setting_tray_theme" disabled')
    source = source.replace(':disabled="isDisabledResourceCacheClear"', ':disabled="true"')
    const start = source.indexOf('    const refreshCacheSize = () => {'), end = source.indexOf('    const clearResourceCache', start)
    if (start < 0 || end < 0) throw new Error('LX resource-cache settings shape changed')
    source = source.slice(0, start) + "    const refreshCacheSize = () => { cacheSize.value = '由 ZTools 管理' }\n" + source.slice(end)
    source = source.replace('dt#other ', 'dd\n  p(role="alert" v-if="cacheError") {{ cacheError }}\ndt#other ')
      .replace('    const otherSourceCount = ref(0)', `    const cacheError = ref('')
    const showCacheError = cause => { cacheError.value = String(cause?.message || cause) }
    const runCacheAction = async(busy, clear, refresh) => {
      cacheError.value = ''
      busy.value = true
      try { await clear(); await refresh() }
      catch (cause) { showCacheError(cause) }
      finally { busy.value = false }
    }
    const otherSourceCount = ref(0)`)
      .replace('      trayThemeList,', '      trayThemeList,\n      cacheError,')
    for (const [clear, refresh, count, busy] of [
      ['clearOtherSource', 'refreshOtherSourceCount', 'getOtherSourceCount', 'isDisabledOtherSourceCacheClear'],
      ['clearMusicUrl', 'refreshMusicUrlCount', 'getMusicUrlCount', 'isDisabledMusicUrlCacheClear'],
      ['clearLyricRaw', 'refreshLyricRawCount', 'getLyricRawCount', 'isDisabledLyricRawCacheClear'],
      ['clearLyricEdited', 'refreshLyricEditedCount', 'getLyricEditedCount', 'isDisabledLyricEditedCacheClear'],
    ]) {
      const action = `      void ${clear}().then(() => {\n        ${refresh}()\n        ${busy}.value = false\n      })`
      if (!source.includes(action)) throw new Error('LX cache cleanup settings shape changed: ' + clear)
      source = source.replace(action, `      await runCacheAction(${busy}, ${clear}, ${refresh})`)
        .replace(`      void ${count}().then`, `      return ${count}().then`)
        .replace(`    ${refresh}()\n`, `    void ${refresh}().catch(showCacheError)\n`)
    }
    note('other', '透明窗口、托盘图标与浏览器资源缓存由 ZTools 管理。下方的歌曲地址、歌词、换源缓存和不喜欢列表保留独立管理。')
  }
  return require('./prune-settings.cjs')(source, file)
}
