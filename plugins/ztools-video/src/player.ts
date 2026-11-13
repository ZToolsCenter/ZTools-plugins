import { createApp, h, shallowRef } from 'vue'
import PlaybackDetails from './components/PlaybackDetails.vue'
import type { PlaybackRequest } from './types'
import './main.css'

const request = shallowRef<PlaybackRequest>()
const stop = window.videoPlayback?.subscribe(value => { request.value = value })
const app = createApp({ render: () => h(PlaybackDetails, { request: request.value }) })
app.mount('#app')
window.addEventListener('pagehide', () => { stop?.(); app.unmount() }, { once: true })
