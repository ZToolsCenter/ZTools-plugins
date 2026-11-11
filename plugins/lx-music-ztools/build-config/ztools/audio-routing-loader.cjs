// Do not turn on Web Audio after a rejected output switch while claiming default output.
module.exports = source => {
  source = source.replaceAll('\r\n', '\n')
  if (source.includes('const showTip = ref(false)')) {
    const warning = "if (visible) showTip.value = appSetting['player.mediaDeviceId'] != 'default'"
    if (!source.includes(warning)) throw new Error('LX sound effect routing notice contract changed')
    return source.replace(warning, "if (visible) showTip.value = typeof window.AudioContext?.prototype?.setSinkId !== 'function'")
      .replace("{{ $t('player__sound_effect_features_tip') }}", '当前宿主仅支持系统默认音频输出；均衡器、卷积、声像和变调仍可使用。')
  }
  const before = "        await setMediaDeviceId('default').catch(_ => _)"
  if (!source.includes(before)) throw new Error('LX playback spectrum routing contract changed')
  const capability = require('node:path').join(__dirname, '../../src/ztools/audio-capabilities.cjs').replaceAll('\\', '/')
  return source.replace('<script>', `<script>\nimport { getAudioCapabilities } from ${JSON.stringify(capability)}`)
    .replace("if (newSetting && appSetting['player.mediaDeviceId'] != 'default') {", "if (newSetting && appSetting['player.mediaDeviceId'] != 'default' && !getAudioCapabilities(navigator.mediaDevices, window.Audio, window.AudioContext).select) {")
    .replace(before, `        try { await setMediaDeviceId('default') } catch (error) {
          await dialog({ message: '无法切换到系统默认输出，请检查音频设备后重试。', confirmButtonText: t('ok') })
          return
        }`)
}
