import * as actions from '@renderer/core/player'
import * as audio from '@renderer/plugins/player'
import { getListMusics, addListMusics } from '@renderer/store/list/action'
import { musicInfo, isPlay } from '@renderer/store/player/state'
import { watch } from '@common/utils/vueTools'

// createAudio is idempotent and shares the original engine's single audio element.
audio.createAudio()
export function getState() {
  const previous = window.lxHost.readSnapshot('player:state')
  return { ...previous, status: isPlay.value ? 'playing' : audio.isEmpty() ? 'stoped' : 'paused',
    name: musicInfo.name, singer: musicInfo.singer, albumName: musicInfo.album,
    picUrl: musicInfo.pic || '', lyric: musicInfo.lrc || '', tlyric: musicInfo.tlrc || '',
    rlyric: musicInfo.rlrc || '', lxlyric: musicInfo.lxlrc || '',
    progress: audio.getCurrentTime(), duration: audio.getDuration(), playbackRate: audio.getPlaybackRate(), mute: audio.getMute() }
}
export async function dispatch(command) {
  switch (command.type) {
    case 'playList':
      if (typeof command.listId !== 'string' || !Number.isInteger(command.index) || command.index < 0) throw new Error('Invalid playback position')
      if (!(await getListMusics(command.listId))[command.index]) throw new Error('Playlist track does not exist')
      actions.playList(command.listId, command.index); break
    case 'play': actions.play(); break
    case 'search': {
      const result = await window.lxCatalog.search(command)
      const track = result.list[command.index ?? 0]
      if (!track) throw new Error('No search result to play')
      await addListMusics('default', [track])
      const tracks = await getListMusics('default')
      actions.playList('default', tracks.findIndex(item => item.id === track.id))
      break
    }
    case 'pause': actions.pause(); break
    case 'playPause': actions.togglePlay(); break
    case 'prev': await actions.playPrev(); break
    case 'next': await actions.playNext(); break
    case 'collect': actions.collectMusic(); break
    case 'unCollect': actions.uncollectMusic(); break
    case 'seek':
      if (!Number.isFinite(command.value) || command.value < 0 || command.value > audio.getDuration()) throw new Error('Invalid seek position')
      window.app_event.setProgress(command.value); break
    case 'volume':
      if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1) throw new Error('Invalid volume')
      window.app_event.setVolume(command.value); break
    case 'mute':
      if (typeof command.value !== 'boolean') throw new Error('Invalid mute state')
      window.app_event.setVolumeIsMute(command.value); break
    default: throw new Error('Unknown player command')
  }
}
export function subscribe(listener) {
  const notify = () => listener(getState())
  const disposers = [audio.onTimeupdate(notify), audio.onPlaying(notify), audio.onPause(notify), audio.onLoadeddata(notify), watch(musicInfo, notify)]
  notify()
  return () => disposers.forEach(dispose => dispose())
}
window.lxPlayer = { getState, dispatch, subscribe }
