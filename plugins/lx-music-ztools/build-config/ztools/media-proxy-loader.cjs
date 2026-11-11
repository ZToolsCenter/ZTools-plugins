// Keep the original player ownership; adapt only network-resource resolution.
module.exports = function adaptMediaProxy(source) {
  source = source.replaceAll('\r\n', '\n')
  const file = this.resourcePath.replaceAll('\\', '/')
  const replace = (before, after) => {
    if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error('LX media resource shape changed: ' + file)
    source = source.replace(before, after)
  }
  if (file.endsWith('/core/player/action.ts')) {
    replace(`  void getMusicPlayUrl(musicInfo, isRefresh).then((url) => {
    if (!url) return
    setResource(url)`, `  void getMusicPlayUrl(musicInfo, isRefresh).then(async(url) => {
    if (!url || window.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return
    const resource = await window.lxHost.invoke<string>('media:resource', url)
    if (window.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return
    setResource(resource)`)
    replace(`  }).catch((err: any) => {
    console.log(err)
    setAllStatus(err.message)`, `  }).catch((err: any) => {
    if (window.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return
    console.log(err)
    setAllStatus(err.message)`)
  } else if (file.endsWith('/usePlayer/usePreloadNextMusic.ts')) {
    replace(`const checkMusicUrl = async(url: string): Promise<boolean> => {
  initAudio()`, `const checkMusicUrl = async(url: string, owner: LX.Player.PlayMusicInfo): Promise<boolean> => {
  if (preloadMusicInfo.info !== owner) return true
  url = await window.lxHost.invoke<string>('media:resource', url)
  if (preloadMusicInfo.info !== owner) return true
  initAudio()`)
    replace('const result = await checkMusicUrl(url)', 'const result = await checkMusicUrl(url, info).catch(() => false)')
    replace('void checkMusicUrl(url)', 'void checkMusicUrl(url, info).catch(() => {})')
    replace("      console.log('preload url', url)\n", '')
    replace("        console.log('preload url refresh', url)\n", '')
  } else throw new Error('Unexpected LX media resource module: ' + file)
  return source
}
